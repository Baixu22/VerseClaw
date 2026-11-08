/**
 * Private temporary file helper for tool output spillover.
 *
 * Creates owner-only log files without reusing predictable names.
 */
import { randomBytes } from "node:crypto";
import { createWriteStream, openSync, writeSync, closeSync, type WriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Opens a unique write stream with owner-only permissions. */
export function createPrivateTempWriteStream(prefix: string): {
  path: string;
  stream: WriteStream;
} {
  const id = randomBytes(8).toString("hex");
  const filePath = join(tmpdir(), `${prefix}-${id}.log`);
  return {
    path: filePath,
    stream: createWriteStream(filePath, { flags: "wx", mode: 0o600 }),
  };
}

/** Synchronous bounded writes provide backpressure to callback-based producers. */
export function createPrivateTempWriter(prefix: string): { path: string; write: (text: string) => void; close: () => void } {
  const filePath = join(tmpdir(), `${prefix}-${randomBytes(8).toString("hex")}.log`);
  const descriptor = openSync(filePath, "wx", 0o600); let closed = false;
  return { path: filePath, write(text) {
    if (closed) throw new Error("Output artifact is closed");
    const bytes = Buffer.from(text, "utf8");
    for (let offset = 0; offset < bytes.length;) offset += writeSync(descriptor, bytes, offset, Math.min(64 * 1024, bytes.length - offset));
  }, close() { if (!closed) { closed = true; closeSync(descriptor); } } };
}
