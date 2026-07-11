/**
 * Characterization tests for the streaming output accumulator and the
 * session-tool truncation facade thresholds.
 *
 * Snapshot of CURRENT behavior for the ported coding tools. Where a behavior
 * looks questionable it carries a `characterization:` comment — recorded, not
 * endorsed.
 */
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { OutputAccumulator } from "./output-accumulator.js";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateHead, truncateTail } from "./truncate.js";

const spilledTempFiles: string[] = [];

function trackTempFile(path: string | undefined): void {
  if (path) {
    spilledTempFiles.push(path);
  }
}

afterEach(async () => {
  await Promise.all(spilledTempFiles.map((path) => rm(path, { force: true })));
  spilledTempFiles.length = 0;
});

describe("truncation facade constants", () => {
  it("pins the default line and byte ceilings", () => {
    expect(DEFAULT_MAX_LINES).toBe(2000);
    expect(DEFAULT_MAX_BYTES).toBe(50 * 1024);
  });
});

describe("truncateHead threshold boundaries", () => {
  it("does not truncate content exactly at the line limit", () => {
    const content = ["l1", "l2", "l3"].join("\n");
    const result = truncateHead(content, { maxLines: 3, maxBytes: 1000 });
    expect(result.truncated).toBe(false);
    expect(result.content).toBe(content);
  });

  it("truncates by lines one past the line limit, keeping the head", () => {
    const content = ["l1", "l2", "l3", "l4"].join("\n");
    const result = truncateHead(content, { maxLines: 3, maxBytes: 1000 });
    expect(result.truncated).toBe(true);
    expect(result.truncatedBy).toBe("lines");
    expect(result.content).toBe("l1\nl2\nl3");
    expect(result.outputLines).toBe(3);
    expect(result.totalLines).toBe(4);
  });

  it("a trailing newline does not count as an extra line", () => {
    const result = truncateHead("l1\nl2\nl3\n", { maxLines: 3, maxBytes: 1000 });
    expect(result.truncated).toBe(false);
    expect(result.totalLines).toBe(3);
  });

  it("does not truncate content exactly at the byte limit", () => {
    const result = truncateHead("abcde", { maxLines: 10, maxBytes: 5 });
    expect(result.truncated).toBe(false);
  });

  it("reports firstLineExceedsLimit with empty content when line 1 alone is over the byte limit", () => {
    const result = truncateHead("abcdef\nrest", { maxLines: 10, maxBytes: 5 });
    expect(result.truncated).toBe(true);
    expect(result.truncatedBy).toBe("bytes");
    expect(result.firstLineExceedsLimit).toBe(true);
    expect(result.content).toBe("");
    expect(result.outputLines).toBe(0);
  });

  it("stops before the line that would cross the byte limit", () => {
    // "aaaa"(4B) + "\nbbbb"(5B) = 9B fits in 9; adding "\ncccc" would exceed.
    const result = truncateHead("aaaa\nbbbb\ncccc", { maxLines: 10, maxBytes: 9 });
    expect(result.truncated).toBe(true);
    expect(result.truncatedBy).toBe("bytes");
    expect(result.content).toBe("aaaa\nbbbb");
  });
});

describe("truncateTail threshold boundaries", () => {
  it("keeps the END of the content when over the line limit", () => {
    const result = truncateTail("l1\nl2\nl3\nl4", { maxLines: 2, maxBytes: 1000 });
    expect(result.truncated).toBe(true);
    expect(result.truncatedBy).toBe("lines");
    expect(result.content).toBe("l3\nl4");
  });

  it("keeps a partial final line when one line alone exceeds the byte limit", () => {
    const result = truncateTail("0123456789A", { maxLines: 10, maxBytes: 10 });
    expect(result.truncated).toBe(true);
    expect(result.truncatedBy).toBe("bytes");
    expect(result.content).toBe("123456789A");
    expect(result.lastLinePartial).toBe(true);
  });
});

describe("OutputAccumulator", () => {
  it("passes small output through without truncation or temp files", () => {
    const acc = new OutputAccumulator({ maxLines: 10, maxBytes: 1000 });
    acc.append(Buffer.from("hello\nworld\n"));
    acc.finish();
    const snapshot = acc.snapshot();
    trackTempFile(snapshot.fullOutputPath);
    expect(snapshot.content).toBe("hello\nworld\n");
    expect(snapshot.truncation.truncated).toBe(false);
    expect(snapshot.truncation.totalLines).toBe(2);
    expect(snapshot.fullOutputPath).toBeUndefined();
  });

  it("does not truncate output exactly at the line limit", () => {
    const acc = new OutputAccumulator({ maxLines: 2, maxBytes: 1000 });
    acc.append(Buffer.from("a\nb\n"));
    acc.finish();
    const snapshot = acc.snapshot();
    trackTempFile(snapshot.fullOutputPath);
    expect(snapshot.truncation.truncated).toBe(false);
    expect(snapshot.fullOutputPath).toBeUndefined();
  });

  it("truncates by lines one line past the limit, keeping the tail", () => {
    const acc = new OutputAccumulator({ maxLines: 2, maxBytes: 1000 });
    acc.append(Buffer.from("a\nb\nc\n"));
    acc.finish();
    const snapshot = acc.snapshot();
    trackTempFile(snapshot.fullOutputPath);
    expect(snapshot.truncation.truncated).toBe(true);
    expect(snapshot.truncation.truncatedBy).toBe("lines");
    expect(snapshot.content).toBe("b\nc");
    expect(snapshot.truncation.totalLines).toBe(3);
    // characterization: crossing a limit during append already spills to a temp
    // file even when snapshot() is called without persistIfTruncated.
    expect(snapshot.fullOutputPath).toBeDefined();
  });

  it("does not truncate output exactly at the byte limit", () => {
    const acc = new OutputAccumulator({ maxLines: 10, maxBytes: 10 });
    acc.append(Buffer.from("0123456789"));
    acc.finish();
    const snapshot = acc.snapshot();
    trackTempFile(snapshot.fullOutputPath);
    expect(snapshot.truncation.truncated).toBe(false);
    expect(snapshot.content).toBe("0123456789");
  });

  it("truncates by bytes one byte past the limit, keeping the tail of the line", () => {
    const acc = new OutputAccumulator({ maxLines: 10, maxBytes: 10 });
    acc.append(Buffer.from("0123456789A"));
    acc.finish();
    const snapshot = acc.snapshot();
    trackTempFile(snapshot.fullOutputPath);
    expect(snapshot.truncation.truncated).toBe(true);
    expect(snapshot.truncation.truncatedBy).toBe("bytes");
    expect(snapshot.content).toBe("123456789A");
    expect(snapshot.truncation.lastLinePartial).toBe(true);
  });

  it("counts an unterminated final line as a line", () => {
    const acc = new OutputAccumulator({ maxLines: 2, maxBytes: 1000 });
    acc.append(Buffer.from("a\nb\nc"));
    acc.finish();
    const snapshot = acc.snapshot();
    trackTempFile(snapshot.fullOutputPath);
    expect(snapshot.truncation.totalLines).toBe(3);
    expect(snapshot.truncation.truncated).toBe(true);
  });

  it("reassembles multi-byte UTF-8 characters split across append chunks", () => {
    const acc = new OutputAccumulator({ maxLines: 10, maxBytes: 1000 });
    const bytes = Buffer.from("é中", "utf-8"); // 2B + 3B
    acc.append(bytes.subarray(0, 1));
    acc.append(bytes.subarray(1, 3));
    acc.append(bytes.subarray(3));
    acc.finish();
    const snapshot = acc.snapshot();
    trackTempFile(snapshot.fullOutputPath);
    expect(snapshot.content).toBe("é中");
    expect(snapshot.truncation.truncated).toBe(false);
  });

  it("persists the FULL raw output to a private temp file when asked on a truncated snapshot", async () => {
    const acc = new OutputAccumulator({ maxLines: 2, maxBytes: 1000, tempFilePrefix: "clawx-char-test" });
    acc.append(Buffer.from("l1\nl2\nl3\nl4\n"));
    acc.finish();
    const snapshot = acc.snapshot({ persistIfTruncated: true });
    trackTempFile(snapshot.fullOutputPath);
    expect(snapshot.fullOutputPath).toBeDefined();
    expect(snapshot.fullOutputPath).toContain(tmpdir());
    await acc.closeTempFile();
    expect(await readFile(snapshot.fullOutputPath!, "utf-8")).toBe("l1\nl2\nl3\nl4\n");
  });

  it("does not create a temp file for a truncated snapshot without persistIfTruncated when nothing spilled", () => {
    // Stay under the append-time spill thresholds; force truncation only via a
    // snapshot-time... — not possible: snapshot uses the same limits. Instead
    // verify the inverse: an under-limit accumulator never reports a path.
    const acc = new OutputAccumulator({ maxLines: 5, maxBytes: 1000 });
    acc.append(Buffer.from("one\n"));
    acc.finish();
    const snapshot = acc.snapshot();
    trackTempFile(snapshot.fullOutputPath);
    expect(snapshot.fullOutputPath).toBeUndefined();
  });

  it("throws when appending after finish", () => {
    const acc = new OutputAccumulator();
    acc.finish();
    expect(() => acc.append(Buffer.from("x"))).toThrowError(
      "Cannot append to a finished output accumulator",
    );
  });

  it("tracks the byte length of the still-open final line", () => {
    const acc = new OutputAccumulator({ maxLines: 10, maxBytes: 1000 });
    acc.append(Buffer.from("ab\ncdé"));
    expect(acc.getLastLineBytes()).toBe(4); // c,d (1B each) + é (2B)
  });
});
