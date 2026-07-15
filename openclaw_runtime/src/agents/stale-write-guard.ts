/**
 * C2-2: full-file write stale guard (STORM-style).
 * Only blocks files this session has read when disk content diverged since last read.
 * Edit tool is intentionally not wrapped (oldText is implicit protection).
 */
import { codingObservability } from "../context-engine/coding-observability.js";
import type { FactStore } from "../context-engine/factstore/store.js";
import { checkFileFreshness } from "../context-engine/factstore/freshness.js";
import { getToolParamsRecord } from "./agent-tools.params.js";
import type { AnyAgentTool } from "./agent-tools.types.js";
import {
  getSessionReadHash,
  hashFileOnDisk,
  resolveWorkspaceFile,
} from "./session-read-hashes.js";
import { toFactRelPath } from "./fact-rel-path.js";

export type StaleWriteGuardOptions = {
  workspaceRoot: string;
  sessionId?: string;
  enabled?: boolean;
  factStore?: Pick<FactStore, "getFileRecord">;
  /** Override for tests. */
  readDiskHash?: (absolutePath: string) => string | undefined;
};

export class StaleWriteError extends Error {
  readonly code = "STALE_WRITE";
  constructor(relPath: string) {
    super(
      `Stale write blocked for ${relPath}: file changed since last read in this session. Re-read the file before writing.`,
    );
    this.name = "StaleWriteError";
  }
}

export function shouldBlockStaleWrite(params: {
  workspaceRoot: string;
  filePath: string;
  sessionId?: string;
  factStore?: Pick<FactStore, "getFileRecord">;
  readDiskHash?: (absolutePath: string) => string | undefined;
}): { block: boolean; relPath?: string; reason?: string } {
  const rel = toFactRelPath(params.filePath, params.workspaceRoot);
  if (!rel) {
    return { block: false };
  }
  const lastRead = getSessionReadHash(params.sessionId, rel);
  if (!lastRead) {
    // Never read in this session — do not block generators/external outputs.
    return { block: false, relPath: rel, reason: "unread" };
  }
  const abs = resolveWorkspaceFile(params.workspaceRoot, params.filePath);
  const diskHash = (params.readDiskHash ?? hashFileOnDisk)(abs);
  if (!diskHash) {
    // File missing: full write is create, not stale overwrite.
    return { block: false, relPath: rel, reason: "missing" };
  }
  if (diskHash === lastRead) {
    return { block: false, relPath: rel, reason: "fresh-read" };
  }
  // Disk diverged from last session read — optional FactStore corroboration.
  if (params.factStore) {
    const record = params.factStore.getFileRecord(params.workspaceRoot, rel);
    const freshness = checkFileFreshness(
      record
        ? {
            path: rel,
            producedHash: record.provenance.producedHash,
            producer: record.provenance.producer,
          }
        : undefined,
      diskHash,
    );
    // Block when disk != last-read; FactStore status is informational for metrics.
    void freshness;
  }
  return { block: true, relPath: rel, reason: "stale-since-read" };
}

export function wrapToolWithStaleWriteGuard(
  tool: AnyAgentTool,
  options: StaleWriteGuardOptions,
): AnyAgentTool {
  if (options.enabled !== true) {
    return tool;
  }
  return {
    ...tool,
    execute: async (toolCallId, args, signal, onUpdate) => {
      const record = getToolParamsRecord(args);
      const filePath = typeof record?.path === "string" ? record.path : undefined;
      if (filePath) {
        const decision = shouldBlockStaleWrite({
          workspaceRoot: options.workspaceRoot,
          filePath,
          sessionId: options.sessionId,
          factStore: options.factStore,
          readDiskHash: options.readDiskHash,
        });
        if (decision.block) {
          codingObservability.recordStaleBlock();
          throw new StaleWriteError(decision.relPath ?? filePath);
        }
        codingObservability.recordStaleAllowance();
      }
      return tool.execute(toolCallId, args, signal, onUpdate);
    },
  };
}
