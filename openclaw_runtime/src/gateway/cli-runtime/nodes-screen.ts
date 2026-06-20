// P5-2 CLI/TUI Deletion: nodes screen action stub.
//
// The original `cli/nodes-screen.ts` was retired along with the `cli/`
// directory. This stub preserves the public surface used by the
// `agents/tools/nodes-tool-media.ts` tool. At runtime, node screen
// capture is not part of the headless gateway path, so the helpers
// all throw a "not implemented" error, but the symbols are importable
// so the module graph resolves cleanly.

import crypto from "node:crypto";

export type ParsedScreenRecordPayload = {
  format: "mp4" | "webm";
  bytes: Uint8Array;
  durationMs?: number;
  width?: number;
  height?: number;
};

export function parseScreenRecordPayload(input: unknown): ParsedScreenRecordPayload | null {
  return null;
}

export function screenRecordTempPath(prefix: string): string {
  const safePrefix = String(prefix ?? "screen").replace(/[^a-z0-9_-]/gi, "_");
  return `nodes-screen-${safePrefix}-${crypto.randomUUID()}.bin`;
}

export async function writeScreenRecordToFile(
  _payload: ParsedScreenRecordPayload,
  _filePath: string,
): Promise<void> {
  throw new Error("nodes-screen: writeScreenRecordToFile is not implemented in the P5-2 headless runtime");
}
