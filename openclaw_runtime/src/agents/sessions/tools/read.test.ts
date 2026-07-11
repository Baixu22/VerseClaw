/**
 * Characterization tests for the built-in read session tool.
 *
 * These snapshot the CURRENT behavior of createReadToolDefinition().execute so
 * later encoding/truncation repairs (repair-plan batch 2+) have a regression
 * net. Several snapshotted behaviors are known-questionable (BOM retention,
 * UTF-16/binary mojibake, phantom trailing-line counting); each carries a
 * `characterization:` comment — recorded, not endorsed.
 *
 * Expected values for the encoding blind-spot cases are BUILT from char codes
 * (see NUL/BOM/REPLACEMENT below) rather than pasted raw bytes, so this source
 * stays reviewable text instead of a git-binary blob.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ImageContent, TextContent } from "../../../llm/types.js";
import { createReadToolDefinition } from "./read.js";

const BOM = String.fromCharCode(0xfeff); // U+FEFF byte-order mark
const REPLACEMENT = String.fromCharCode(0xfffd); // U+FFFD replacement character
const NUL = String.fromCharCode(0); // U+0000 null

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "clawx-read-test-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function executeRead(args: { path: string; offset?: number; limit?: number }) {
  const definition = createReadToolDefinition(dir);
  return definition.execute("test-call", args, undefined, undefined, undefined);
}

function textOf(result: { content: (TextContent | ImageContent)[] }): string {
  const first = result.content[0];
  if (first?.type !== "text") {
    throw new Error(`expected text content, got ${String(first?.type)}`);
  }
  return first.text;
}

describe("read tool: plain UTF-8", () => {
  it("returns file content verbatim with undefined details", async () => {
    await writeFile(join(dir, "plain.txt"), "hello\nworld\n", "utf-8");
    const result = await executeRead({ path: "plain.txt" });
    expect(result.content).toEqual([{ type: "text", text: "hello\nworld\n" }]);
    expect(result.details).toBeUndefined();
  });

  it("resolves relative paths against the tool cwd", async () => {
    await writeFile(join(dir, "rel.txt"), "via cwd", "utf-8");
    const result = await executeRead({ path: "rel.txt" });
    expect(textOf(result)).toBe("via cwd");
  });

  it("preserves CRLF line endings in the output text", async () => {
    await writeFile(join(dir, "crlf.txt"), "a\r\nb\r\n", "utf-8");
    const result = await executeRead({ path: "crlf.txt" });
    expect(textOf(result)).toBe("a\r\nb\r\n");
  });
});

describe("read tool: encoding blind spots", () => {
  it("keeps a UTF-8 BOM in the returned text", async () => {
    // characterization: current behavior, not necessarily desired — the BOM is
    // not stripped on read (edit.ts DOES strip it before matching), so a model
    // echoing this text as edit oldText will fail to match.
    await writeFile(
      join(dir, "bom.txt"),
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("hello")]),
    );
    const result = await executeRead({ path: "bom.txt" });
    expect(textOf(result)).toBe(`${BOM}hello`);
  });

  it("returns mojibake for a UTF-16LE file (no encoding detection)", async () => {
    // characterization: current behavior, not necessarily desired — the buffer
    // is decoded as UTF-8 unconditionally: the FF FE BOM becomes two U+FFFD and
    // each ASCII char is trailed by its UTF-16 high byte (NUL, U+0000).
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("hi", "utf16le")]);
    await writeFile(join(dir, "utf16.txt"), utf16);
    const result = await executeRead({ path: "utf16.txt" });
    expect(textOf(result)).toBe(`${REPLACEMENT}${REPLACEMENT}h${NUL}i${NUL}`);
  });

  it("returns control/replacement characters for a binary file (no binary detection)", async () => {
    // characterization: current behavior, not necessarily desired — non-image
    // binary data is decoded as UTF-8 text instead of being reported as binary.
    // Bytes 00/01/02 pass through as C0 control chars; ff/fe become U+FFFD.
    await writeFile(join(dir, "bin.dat"), Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe]));
    const result = await executeRead({ path: "bin.dat" });
    const expected =
      String.fromCharCode(0) +
      String.fromCharCode(1) +
      String.fromCharCode(2) +
      REPLACEMENT +
      REPLACEMENT;
    expect(textOf(result)).toBe(expected);
  });
});

describe("read tool: truncation boundaries", () => {
  it("does not truncate a file with exactly 2000 lines", async () => {
    const lines = Array.from({ length: 2000 }, (_, i) => `L${i + 1}`);
    await writeFile(join(dir, "exact.txt"), lines.join("\n"), "utf-8");
    const result = await executeRead({ path: "exact.txt" });
    expect(result.details).toBeUndefined();
    expect(textOf(result)).toBe(lines.join("\n"));
  });

  it("truncates a 2001-line file to 2000 lines with a continuation notice", async () => {
    const lines = Array.from({ length: 2001 }, (_, i) => `L${i + 1}`);
    await writeFile(join(dir, "over.txt"), lines.join("\n"), "utf-8");
    const result = await executeRead({ path: "over.txt" });
    const text = textOf(result);
    expect(text.endsWith("\n\n[Showing lines 1-2000 of 2001. Use offset=2001 to continue.]")).toBe(
      true,
    );
    expect(text.startsWith("L1\n")).toBe(true);
    expect(text).not.toContain("L2001");
    expect(result.details?.truncation).toMatchObject({
      truncated: true,
      truncatedBy: "lines",
      outputLines: 2000,
      totalLines: 2001,
    });
  });

  it("counts the phantom line after a trailing newline in the continuation notice", async () => {
    // characterization: current behavior, not necessarily desired — split("\n")
    // on a trailing-newline file yields a final empty element, so a 2001-line
    // file is reported as "of 2002" in the notice (details.truncation.totalLines
    // still says 2001).
    const lines = Array.from({ length: 2001 }, (_, i) => `L${i + 1}`);
    await writeFile(join(dir, "trailing.txt"), `${lines.join("\n")}\n`, "utf-8");
    const result = await executeRead({ path: "trailing.txt" });
    expect(
      textOf(result).endsWith("\n\n[Showing lines 1-2000 of 2002. Use offset=2001 to continue.]"),
    ).toBe(true);
    expect(result.details?.truncation).toMatchObject({ totalLines: 2001 });
  });

  it("truncates by bytes when long lines cross the 50KB limit first", async () => {
    // 60 lines x 1000 chars: 51 lines fit in 51200 bytes (1000 + 50*1001 = 51050).
    const lines = Array.from({ length: 60 }, () => "x".repeat(1000));
    await writeFile(join(dir, "bytes.txt"), lines.join("\n"), "utf-8");
    const result = await executeRead({ path: "bytes.txt" });
    expect(
      textOf(result).endsWith(
        "\n\n[Showing lines 1-51 of 60 (50.0KB limit). Use offset=52 to continue.]",
      ),
    ).toBe(true);
    expect(result.details?.truncation).toMatchObject({
      truncated: true,
      truncatedBy: "bytes",
      outputLines: 51,
      totalLines: 60,
    });
  });

  it("points at a bash fallback when the first requested line alone exceeds 50KB", async () => {
    await writeFile(join(dir, "huge-line.txt"), `${"x".repeat(52000)}\nsecond`, "utf-8");
    const result = await executeRead({ path: "huge-line.txt" });
    const text = textOf(result);
    expect(text).toBe(
      "[Line 1 is 50.8KB, exceeds 50.0KB limit. Use bash: sed -n '1p' 'huge-line.txt' | head -c 51200]",
    );
    expect(result.details?.truncation).toMatchObject({
      truncated: true,
      firstLineExceedsLimit: true,
    });
  });
});

describe("read tool: offset/limit", () => {
  it("starts at a 1-indexed offset", async () => {
    await writeFile(join(dir, "f.txt"), "one\ntwo\nthree", "utf-8");
    const result = await executeRead({ path: "f.txt", offset: 2 });
    expect(textOf(result)).toBe("two\nthree");
  });

  it("stops after limit lines and appends a continuation notice", async () => {
    await writeFile(join(dir, "f.txt"), "one\ntwo\nthree", "utf-8");
    const result = await executeRead({ path: "f.txt", limit: 2 });
    // characterization: "1 more lines" grammar for a single remaining line.
    expect(textOf(result)).toBe("one\ntwo\n\n[1 more lines in file. Use offset=3 to continue.]");
    expect(result.details).toBeUndefined();
  });

  it("combines offset and limit", async () => {
    await writeFile(join(dir, "f.txt"), "one\ntwo\nthree", "utf-8");
    const result = await executeRead({ path: "f.txt", offset: 2, limit: 1 });
    expect(textOf(result)).toBe("two\n\n[1 more lines in file. Use offset=3 to continue.]");
  });

  it("clamps limit=0 up to one line", async () => {
    // characterization: current behavior, not necessarily desired — limit=0 is
    // normalized to 1 rather than rejected or treated as "no lines".
    await writeFile(join(dir, "f.txt"), "one\ntwo\nthree", "utf-8");
    const result = await executeRead({ path: "f.txt", limit: 0 });
    expect(textOf(result)).toBe("one\n\n[2 more lines in file. Use offset=2 to continue.]");
  });

  it("returns empty text when offset targets the phantom line after a trailing newline", async () => {
    // characterization: current behavior, not necessarily desired — "a\nb\n"
    // splits into ["a","b",""], so offset=3 addresses the empty phantom line.
    await writeFile(join(dir, "f.txt"), "a\nb\n", "utf-8");
    const result = await executeRead({ path: "f.txt", offset: 3 });
    expect(textOf(result)).toBe("");
  });

  it("rejects an offset beyond the end, counting the phantom line in the total", async () => {
    // characterization: current behavior, not necessarily desired — the error
    // reports "3 lines total" for a 2-line file with a trailing newline.
    await writeFile(join(dir, "f.txt"), "a\nb\n", "utf-8");
    await expect(executeRead({ path: "f.txt", offset: 4 })).rejects.toThrowError(
      "Offset 4 is beyond end of file (3 lines total)",
    );
  });
});

describe("read tool: errors", () => {
  it("rejects with the raw Node ENOENT error for a missing path", async () => {
    await expect(executeRead({ path: "does-not-exist.txt" })).rejects.toThrowError(/ENOENT/);
  });
});

describe("read tool: images", () => {
  // 1x1 transparent PNG.
  const PNG_BASE64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

  it("returns a note plus inline image content for a PNG when auto-resize is off", async () => {
    await writeFile(join(dir, "tiny.png"), Buffer.from(PNG_BASE64, "base64"));
    const definition = createReadToolDefinition(dir, { autoResizeImages: false });
    const result = await definition.execute(
      "test-call",
      { path: "tiny.png" },
      undefined,
      undefined,
      undefined,
    );
    expect(result.content).toEqual([
      { type: "text", text: "Read image file [image/png]" },
      { type: "image", data: PNG_BASE64, mimeType: "image/png" },
    ]);
    expect(result.details).toBeUndefined();
  });
});
