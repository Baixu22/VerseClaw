/**
 * Send-keys support for process-controlled PTY sessions.
 * Encodes symbolic keys, hex bytes, and literal input before writing to a
 * live process stdin.
 */
import { getFinishedSession, type ProcessSession } from "./bash-process-registry.js";
import { awaitWithAbort } from "../utils/await-with-abort.js";
import { deriveSessionName } from "./bash-tools.shared.js";
import { encodeKeySequence, hasCursorModeSensitiveKeys } from "./pty-keys.js";
import type { AgentToolResult } from "./runtime/index.js";

/** Writable stdin surface shared by child-process and PTY session records. */
export type WritableStdin = {
  write: (data: string, cb?: (err?: Error | null) => void) => void;
  end: (cb?: (err?: Error | null) => void) => void;
  destroyed?: boolean;
  writable?: boolean;
  writableEnded?: boolean;
  writableFinished?: boolean;
};

function failText(text: string): AgentToolResult<unknown> {
  return {
    content: [
      {
        type: "text",
        text,
      },
    ],
    details: { status: "failed" },
  };
}

/** Acknowledge input against the process state observed after its write callback. */
export function buildProcessInputResult(
  session: ProcessSession,
  text: string,
): AgentToolResult<unknown> {
  const terminal = session.exited ? getFinishedSession(session.id) : undefined;
  const exitSignal = session.exitSignal ?? undefined;
  const exitCode = session.exitCode ?? null;
  const exitText = session.exited
    ? `Process exited with ${exitSignal ? `signal ${exitSignal}` : `code ${exitCode ?? "unknown"}`}.`
    : "";
  return {
    content: [
      {
        type: "text",
        text: [text, ...(session.exited ? [session.tail, exitText] : [])]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
    details: {
      // The owner may record a timeout even when the child exits zero. A cleared record cannot confirm success.
      status: session.exited ? (terminal?.status ?? "failed") : "running",
      sessionId: session.id,
      name: deriveSessionName(session.command),
      ...(session.exited ? { exitCode, exitSignal, aggregated: session.aggregated } : {}),
    },
  };
}

async function writeToStdin(stdin: WritableStdin, data: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  await awaitWithAbort(
    new Promise<void>((resolve, reject) => {
      stdin.write(data, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    }),
    signal,
  );
}

/** Encode and write requested key data into a running process session. */
export async function handleProcessSendKeys(params: {
  sessionId: string;
  session: ProcessSession;
  stdin: WritableStdin;
  keys?: string[];
  hex?: string[];
  literal?: string;
  signal?: AbortSignal;
}): Promise<AgentToolResult<unknown>> {
  const request = {
    keys: params.keys,
    hex: params.hex,
    literal: params.literal,
  };
  if (params.session.cursorKeyMode === "unknown" && hasCursorModeSensitiveKeys(request)) {
    // Arrow/keypad encodings depend on cursor key mode. Wait for startup output
    // to identify the mode before sending potentially wrong bytes.
    return failText(
      `Session ${params.sessionId} cursor key mode is not known yet. Poll or log until startup output appears, then retry send-keys.`,
    );
  }
  const cursorKeyMode =
    params.session.cursorKeyMode === "unknown" ? undefined : params.session.cursorKeyMode;
  const { data, warnings } = encodeKeySequence(request, cursorKeyMode);
  if (!data) {
    return failText("No key data provided.");
  }
  await writeToStdin(params.stdin, data, params.signal);
  return buildProcessInputResult(
    params.session,
    `Sent ${data.length} bytes to session ${params.sessionId}.` +
      (warnings.length ? `\nWarnings:\n- ${warnings.join("\n- ")}` : ""),
  );
}
