/**
 * Characterization tests for the built-in write session tool.
 *
 * Snapshot of CURRENT behavior for the ported coding tools. Where a behavior
 * looks questionable it carries a `characterization:` comment — recorded, not
 * endorsed. The success-message byte-count in particular is known-suspect.
 */
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWriteToolDefinition } from "./write.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "clawx-write-test-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function executeWrite(args: { path: string; content: string }) {
  const definition = createWriteToolDefinition(dir);
  return definition.execute("test-call", args, undefined, undefined, undefined);
}

describe("write tool: create and overwrite", () => {
  it("creates a new file and reports the byte count in the success message", async () => {
    const result = await executeWrite({ path: "new.txt", content: "hello" });
    expect(result.content).toEqual([
      { type: "text", text: "Successfully wrote 5 bytes to new.txt" },
    ]);
    expect(result.details).toMatchObject({
      working_memory: { significance: "high" },
    });
    expect(await readFile(join(dir, "new.txt"), "utf-8")).toBe("hello");
  });

  it("overwrites an existing file", async () => {
    await writeFile(join(dir, "exists.txt"), "old content", "utf-8");
    const result = await executeWrite({ path: "exists.txt", content: "new" });
    expect(result.content[0]).toMatchObject({ text: "Successfully wrote 3 bytes to exists.txt" });
    expect(await readFile(join(dir, "exists.txt"), "utf-8")).toBe("new");
  });

  it("creates missing parent directories automatically", async () => {
    const result = await executeWrite({ path: "a/b/c/deep.txt", content: "x" });
    expect(result.content[0]).toMatchObject({ text: "Successfully wrote 1 bytes to a/b/c/deep.txt" });
    expect(await readFile(join(dir, "a", "b", "c", "deep.txt"), "utf-8")).toBe("x");
  });

  it("writes empty content", async () => {
    const result = await executeWrite({ path: "empty.txt", content: "" });
    expect(result.content[0]).toMatchObject({ text: "Successfully wrote 0 bytes to empty.txt" });
    expect(await readFile(join(dir, "empty.txt"), "utf-8")).toBe("");
  });
});

describe("write tool: line endings and byte counting", () => {
  it("writes CRLF content verbatim without normalizing line endings", async () => {
    // characterization: current behavior — write performs no line-ending
    // normalization; CRLF in, CRLF on disk.
    const content = "a\r\nb\r\nc";
    const result = await executeWrite({ path: "crlf.txt", content });
    const onDisk = await readFile(join(dir, "crlf.txt"));
    expect(onDisk.toString("utf-8")).toBe(content);
    expect(onDisk.includes(Buffer.from("\r\n"))).toBe(true);
    // The success message counts UTF-16 code units (content.length), which for
    // this all-ASCII string equals the byte count.
    expect(result.content[0]).toMatchObject({ text: "Successfully wrote 7 bytes to crlf.txt" });
  });

  it("reports content.length (code units), NOT UTF-8 byte length, in the success message", async () => {
    // characterization: current behavior, not necessarily desired — "bytes" in
    // the message is really String.length. "café" is 4 code units but 5 UTF-8
    // bytes; the file on disk is 5 bytes, yet the message says 4.
    const result = await executeWrite({ path: "unicode.txt", content: "café" });
    expect(result.content[0]).toMatchObject({ text: "Successfully wrote 4 bytes to unicode.txt" });
    const onDisk = await stat(join(dir, "unicode.txt"));
    expect(onDisk.size).toBe(5);
  });

  it("counts an astral emoji as its surrogate-pair length, diverging further from bytes", async () => {
    // characterization: "😀" is 2 UTF-16 code units but 4 UTF-8 bytes.
    const result = await executeWrite({ path: "emoji.txt", content: "😀" });
    expect(result.content[0]).toMatchObject({ text: "Successfully wrote 2 bytes to emoji.txt" });
    expect((await stat(join(dir, "emoji.txt"))).size).toBe(4);
  });
});
