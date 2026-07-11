/**
 * Characterization tests for edit-diff helpers.
 *
 * Snapshot of CURRENT behavior (matching, line-ending detection, fuzzy
 * normalization, error message shapes) for the ported coding tools. Where a
 * behavior looks questionable it carries a `characterization:` comment —
 * recorded, not endorsed.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyEditsToNormalizedContent,
  computeEditsDiff,
  detectLineEnding,
  generateDiffString,
  generateUnifiedPatch,
  normalizeForFuzzyMatch,
  normalizeToLF,
  restoreLineEndings,
  stripBom,
} from "./edit-diff.js";

describe("detectLineEnding", () => {
  it("returns LF for empty content and content without newlines", () => {
    expect(detectLineEnding("")).toBe("\n");
    expect(detectLineEnding("no newline here")).toBe("\n");
  });

  it("returns CRLF when the first newline is CRLF", () => {
    expect(detectLineEnding("a\r\nb\nc")).toBe("\r\n");
  });

  it("returns LF when the first newline is a bare LF, even if CRLF appears later", () => {
    expect(detectLineEnding("a\nb\r\nc")).toBe("\n");
  });

  it("returns LF for lone-CR (classic Mac) content", () => {
    // characterization: current behavior, not necessarily desired — a file using
    // only \r line endings has no \n at all, so detection falls through to "\n".
    expect(detectLineEnding("a\rb\rc")).toBe("\n");
  });
});

describe("normalizeToLF / restoreLineEndings", () => {
  it("converts CRLF and lone CR to LF", () => {
    expect(normalizeToLF("a\r\nb\rc\nd")).toBe("a\nb\nc\nd");
  });

  it("restores CRLF endings uniformly", () => {
    expect(restoreLineEndings("a\nb\nc", "\r\n")).toBe("a\r\nb\r\nc");
    expect(restoreLineEndings("a\nb\nc", "\n")).toBe("a\nb\nc");
  });
});

describe("stripBom", () => {
  it("splits a leading UTF-8 BOM from the text", () => {
    expect(stripBom("﻿hello")).toEqual({ bom: "﻿", text: "hello" });
  });

  it("returns the text unchanged when no BOM is present", () => {
    expect(stripBom("hello")).toEqual({ bom: "", text: "hello" });
  });

  it("only strips the first BOM", () => {
    expect(stripBom("﻿﻿x")).toEqual({ bom: "﻿", text: "﻿x" });
  });
});

describe("normalizeForFuzzyMatch", () => {
  it("strips trailing whitespace per line and normalizes smart punctuation", () => {
    expect(normalizeForFuzzyMatch("a — b\t\nc’s “q” !")).toBe(
      "a - b\nc's \"q\" !",
    );
  });
});

describe("applyEditsToNormalizedContent", () => {
  it("applies a single unique exact replacement", () => {
    const result = applyEditsToNormalizedContent(
      "line one\nline two\nline three\n",
      [{ oldText: "line two", newText: "LINE 2" }],
      "f.txt",
    );
    expect(result.baseContent).toBe("line one\nline two\nline three\n");
    expect(result.newContent).toBe("line one\nLINE 2\nline three\n");
  });

  it("applies multiple disjoint edits, each matched against the original content", () => {
    const result = applyEditsToNormalizedContent(
      "alpha\nbeta\ngamma\n",
      [
        { oldText: "gamma", newText: "GAMMA" },
        { oldText: "alpha", newText: "ALPHA" },
      ],
      "f.txt",
    );
    expect(result.newContent).toBe("ALPHA\nbeta\nGAMMA\n");
  });

  it("throws the single-edit not-found error shape", () => {
    expect(() =>
      applyEditsToNormalizedContent("abc\n", [{ oldText: "zzz", newText: "y" }], "f.txt"),
    ).toThrowError(
      "Could not find the exact text in f.txt. The old text must match exactly including all whitespace and newlines.",
    );
  });

  it("throws the indexed not-found error shape for multi-edit calls", () => {
    expect(() =>
      applyEditsToNormalizedContent(
        "abc\n",
        [
          { oldText: "abc", newText: "x" },
          { oldText: "zzz", newText: "y" },
        ],
        "f.txt",
      ),
    ).toThrowError(
      "Could not find edits[1] in f.txt. The oldText must match exactly including all whitespace and newlines.",
    );
  });

  it("rejects ambiguous matches with an occurrence count", () => {
    expect(() =>
      applyEditsToNormalizedContent("dup\ndup\n", [{ oldText: "dup", newText: "x" }], "f.txt"),
    ).toThrowError(
      "Found 2 occurrences of the text in f.txt. The text must be unique. Please provide more context to make it unique.",
    );
  });

  it("rejects empty oldText", () => {
    expect(() =>
      applyEditsToNormalizedContent("abc\n", [{ oldText: "", newText: "x" }], "f.txt"),
    ).toThrowError("oldText must not be empty in f.txt.");
  });

  it("rejects a replacement that produces identical content", () => {
    expect(() =>
      applyEditsToNormalizedContent("abc\n", [{ oldText: "abc", newText: "abc" }], "f.txt"),
    ).toThrowError(
      "No changes made to f.txt. The replacement produced identical content. This might indicate an issue with special characters or the text not existing as expected.",
    );
  });

  it("rejects overlapping edits", () => {
    expect(() =>
      applyEditsToNormalizedContent(
        "one two three\n",
        [
          { oldText: "one two", newText: "X" },
          { oldText: "two three", newText: "Y" },
        ],
        "f.txt",
      ),
    ).toThrowError("edits[0] and edits[1] overlap in f.txt. Merge them into one edit or target disjoint regions.");
  });

  it("falls back to fuzzy matching and rewrites the WHOLE file in fuzzy-normalized space", () => {
    // characterization: current behavior, not necessarily desired — when any edit
    // needs fuzzy matching, baseContent becomes normalizeForFuzzyMatch(content),
    // so unrelated smart quotes / trailing whitespace elsewhere in the file are
    // also rewritten by the edit.
    const content = "say “hello”   \nkeep — this\ntarget line\n";
    const result = applyEditsToNormalizedContent(
      content,
      // oldText uses ASCII quotes; file has smart quotes + trailing spaces.
      [{ oldText: 'say "hello"', newText: "say hi" }],
      "f.txt",
    );
    expect(result.baseContent).toBe('say "hello"\nkeep - this\ntarget line\n');
    expect(result.newContent).toBe("say hi\nkeep - this\ntarget line\n");
  });
});

describe("generateDiffString", () => {
  it("emits +/- lines with line numbers and reports the first changed line", () => {
    const { diff, firstChangedLine } = generateDiffString("a\nb\nc\n", "a\nB\nc\n");
    expect(firstChangedLine).toBe(2);
    expect(diff).toContain("-2 b");
    expect(diff).toContain("+2 B");
  });

  it("returns undefined firstChangedLine when nothing changed", () => {
    const { diff, firstChangedLine } = generateDiffString("same\n", "same\n");
    expect(firstChangedLine).toBeUndefined();
    expect(diff).toBe("");
  });
});

describe("generateUnifiedPatch", () => {
  it("produces a unified patch with file headers only", () => {
    const patch = generateUnifiedPatch("f.txt", "a\nb\n", "a\nB\n");
    expect(patch).toContain("--- f.txt");
    expect(patch).toContain("+++ f.txt");
    expect(patch).toContain("-b");
    expect(patch).toContain("+B");
  });
});

describe("computeEditsDiff", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "clawx-edit-diff-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns an EditDiffError object (not a rejection) for a missing file", async () => {
    const result = await computeEditsDiff(
      "missing.txt",
      [{ oldText: "a", newText: "b" }],
      dir,
    );
    // characterization: error carries only the Node error code, not the message.
    expect(result).toEqual({ error: "Could not edit file: missing.txt. Error code: ENOENT." });
  });

  it("computes the diff without modifying the file", async () => {
    const { writeFile, readFile } = await import("node:fs/promises");
    const file = join(dir, "f.txt");
    await writeFile(file, "one\ntwo\n", "utf-8");
    const result = await computeEditsDiff(file, [{ oldText: "two", newText: "TWO" }], dir);
    expect(result).toEqual({ diff: " 1 one\n-2 two\n+2 TWO", firstChangedLine: 2 });
    expect(await readFile(file, "utf-8")).toBe("one\ntwo\n");
  });
});
