/**
 * Capture native/PTY output before the process registry applies its first lossy
 * head/tail cap. The captured text is bounded and handed to the existing
 * Context Family archive owner on process exit.
 */
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ArchiveHandle } from "../../../shared/types/context-item.js";
import {
  createContextArchiveHandleForPayloadSync,
  createContextItemId,
} from "../context-engine/registry/context-item-registry.js";

const DEFAULT_MAX_RAW_OUTPUT_BYTES = 8 * 1024 * 1024;

function maxRawOutputBytes(): number {
  const parsed = Number(process.env.OPENCLAW_BASH_RAW_OUTPUT_MAX_BYTES);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_RAW_OUTPUT_BYTES;
}

export type RawOutputCaptureResult = {
  handle?: ArchiveHandle;
  charCount: number;
  byteCount: number;
  truncated: boolean;
  diagnostics: string[];
};

export type BashRawOutputCapture = {
  append: (stream: "stdout" | "stderr", chunk: string) => void;
  finalize: () => RawOutputCaptureResult | undefined;
  dispose: () => void;
};

export function createBashRawOutputCapture(params: {
  sessionId: string;
  itemKey: string;
  archiveRoot?: string;
  maxBytes?: number;
}): BashRawOutputCapture {
  const sessionId = params.sessionId.trim();
  if (!sessionId) {
    throw new Error("raw output capture requires a sessionId");
  }
  let root: string;
  try {
    root = mkdtempSync(join(tmpdir(), "openclaw-raw-output-"));
  } catch (error) {
    // Raw-output capture is a best-effort archival enrichment. A host whose
    // TEMP root is unwritable must degrade to "no capture", never fail the
    // exec tool: an aborted tool call leaves the model without a tool result
    // and strands the agent turn. See TF-0577.
    const message = error instanceof Error ? error.message : String(error);
    return {
      append() {},
      finalize() {
        return { charCount: 0, byteCount: 0, truncated: false, diagnostics: [message] };
      },
      dispose() {},
    };
  }
  const filePath = join(root, "raw-output.txt");
  const limit = Math.max(1, params.maxBytes ?? maxRawOutputBytes());
  let byteCount = 0;
  let charCount = 0;
  let truncated = false;
  let finalized = false;
  let failed = false;
  const diagnostics: string[] = [];

  const cleanup = () => {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // Temp cleanup must not change process lifecycle semantics.
    }
  };

  return {
    append(stream, chunk) {
      if (finalized || failed || truncated || !chunk) return;
      try {
        const bytes = Buffer.from(chunk, "utf8");
        const remaining = limit - byteCount;
        if (bytes.length > remaining) {
          const retained = bytes.subarray(0, Math.max(0, remaining));
          if (retained.length > 0) {
            appendFileSync(filePath, retained);
            byteCount += retained.length;
            charCount += retained.toString("utf8").length;
          }
          truncated = true;
          diagnostics.push(`output_truncated_at_${limit}_bytes_after_${stream}`);
          return;
        }
        appendFileSync(filePath, bytes);
        byteCount += bytes.length;
        charCount += chunk.length;
      } catch (error) {
        failed = true;
        diagnostics.push(error instanceof Error ? error.message : String(error));
      }
    },
    finalize() {
      if (finalized) return undefined;
      finalized = true;
      if (failed || byteCount === 0) {
        cleanup();
        return { charCount, byteCount, truncated, diagnostics };
      }
      try {
        const payload = readFileSync(filePath, "utf8");
        const handle = createContextArchiveHandleForPayloadSync({
          sessionId,
          itemId: createContextItemId(sessionId, "observation", params.itemKey),
          payload,
          ...(params.archiveRoot ? { archiveRoot: params.archiveRoot } : {}),
          source: { type: "tool_call", sessionId, label: "native-output" },
        });
        cleanup();
        return { handle, charCount, byteCount, truncated, diagnostics };
      } catch (error) {
        diagnostics.push(error instanceof Error ? error.message : String(error));
        cleanup();
        return { charCount, byteCount, truncated, diagnostics };
      }
    },
    dispose() {
      if (!finalized) {
        finalized = true;
        cleanup();
      }
    },
  };
}