/**
 * Characterization tests for the built-in edit session tool.
 *
 * Snapshot of CURRENT behavior of createEditToolDefinition().execute and
 * prepareArguments for the ported coding tools. Where a behavior looks
 * questionable it carries a `characterization:` comment — recorded, not
 * endorsed. Line-ending and BOM round-trip semantics are the load-bearing
 * snapshots here (repair-plan batch 2 wants to make them explicit).
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Edit } from "./edit-diff.js";
import { createEditToolDefinition, type EditToolInput } from "./edit.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "clawx-edit-test-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function executeEdit(args: { path: string; edits: Edit[] }) {
  const definition = createEditToolDefinition(dir);
  return definition.execute("test-call", args as EditToolInput, undefined, undefined, undefined);
}

async function executeEditError(args: { path: string; edits: Edit[] }): Promise<Error> {
  const outcome = await executeEdit(args).then(
    () => null,
    (error: unknown) => error,
  );
  expect(outcome).toBeInstanceOf(Error);
  return outcome as Error;
}

describe("edit tool: successful replacement", () => {
  it("applies a single unique replacement and returns diff/patch details", async () => {
    await writeFile(join(dir, "f.txt"), "one\ntwo\nthree\n", "utf-8");
    const result = await executeEdit({
      path: "f.txt",
      edits: [{ oldText: "two", newText: "TWO" }],
    });
    expect(result.content).toEqual([
      { type: "text", text: "Successfully replaced 1 block(s) in f.txt." },
    ]);
    expect(result.details).toMatchObject({
      diff: " 1 one\n-2 two\n+2 TWO\n 3 three",
      patch: expect.stringContaining("+TWO"),
      firstChangedLine: 2,
      working_memory: { significance: "high" },
      patchArtifacts: [
        expect.objectContaining({
          schema: "GitPatchArtifact/v1",
          file: "f.txt",
          status: "modified",
          contentKind: "text",
          completeness: "complete",
          lineage: { requestId: "test-call" },
        }),
      ],
    });
    expect(await readFile(join(dir, "f.txt"), "utf-8")).toBe("one\nTWO\nthree\n");
  });

  it("applies multiple disjoint edits in one call", async () => {
    await writeFile(join(dir, "f.txt"), "alpha\nbeta\ngamma\n", "utf-8");
    const result = await executeEdit({
      path: "f.txt",
      edits: [
        { oldText: "alpha", newText: "ALPHA" },
        { oldText: "gamma", newText: "GAMMA" },
      ],
    });
    expect(result.content[0]).toMatchObject({
      text: "Successfully replaced 2 block(s) in f.txt.",
    });
    expect(await readFile(join(dir, "f.txt"), "utf-8")).toBe("ALPHA\nbeta\nGAMMA\n");
  });
});

describe("edit tool: match failures", () => {
  it("appends the current file contents as a hint when the text is not found", async () => {
    // characterization: the not-found error gets the whole current file
    // appended after "Current file contents:".
    await writeFile(join(dir, "f.txt"), "short content\n", "utf-8");
    const error = await executeEditError({
      path: "f.txt",
      edits: [{ oldText: "nope", newText: "x" }],
    });
    expect(error.message).toBe(
      "Could not find the exact text in f.txt. The old text must match exactly including all whitespace and newlines." +
        "\nCurrent file contents:\nshort content\n",
    );
  });

  it("truncates the mismatch hint at 800 characters", async () => {
    await writeFile(join(dir, "f.txt"), "a".repeat(1000), "utf-8");
    const error = await executeEditError({
      path: "f.txt",
      edits: [{ oldText: "nope", newText: "x" }],
    });
    expect(error.message).toContain(`\nCurrent file contents:\n${"a".repeat(800)}\n... (truncated)`);
    expect(error.message).not.toContain("a".repeat(801));
  });

  it("reports ambiguous matches with an occurrence count and NO contents hint", async () => {
    await writeFile(join(dir, "f.txt"), "dup\ndup\n", "utf-8");
    const error = await executeEditError({
      path: "f.txt",
      edits: [{ oldText: "dup", newText: "x" }],
    });
    expect(error.message).toBe(
      "Found 2 occurrences of the text in f.txt. The text must be unique. Please provide more context to make it unique.",
    );
  });

  it("rejects an empty oldText", async () => {
    await writeFile(join(dir, "f.txt"), "content\n", "utf-8");
    const error = await executeEditError({
      path: "f.txt",
      edits: [{ oldText: "", newText: "x" }],
    });
    expect(error.message).toBe("oldText must not be empty in f.txt.");
  });

  it("rejects an empty edits array before touching the filesystem", async () => {
    const error = await executeEditError({ path: "f.txt", edits: [] });
    expect(error.message).toBe(
      "Edit tool input is invalid. edits must contain at least one replacement.",
    );
  });

  it("reports a missing file with the Node error code only", async () => {
    const error = await executeEditError({
      path: "missing.txt",
      edits: [{ oldText: "a", newText: "b" }],
    });
    expect(error.message).toBe("Could not edit file: missing.txt. Error code: ENOENT.");
  });
});

describe("edit tool: line-ending round trips", () => {
  it("preserves CRLF endings and converts inserted LF newlines to CRLF", async () => {
    await writeFile(join(dir, "crlf.txt"), "one\r\ntwo\r\nthree\r\n", "utf-8");
    await executeEdit({
      path: "crlf.txt",
      edits: [{ oldText: "two", newText: "TWO\nTWO-b" }],
    });
    expect(await readFile(join(dir, "crlf.txt"), "utf-8")).toBe(
      "one\r\nTWO\r\nTWO-b\r\nthree\r\n",
    );
  });

  it("preserves each existing ending in a mixed-endings file", async () => {
    // characterization: current behavior, not necessarily desired — the file
    // mixes CRLF and LF; because the first newline is CRLF, the whole file is
    // rewritten with CRLF, silently changing untouched lines.
    await writeFile(join(dir, "mixed.txt"), "one\r\ntwo\nthree\n", "utf-8");
    await executeEdit({ path: "mixed.txt", edits: [{ oldText: "two", newText: "TWO" }] });
    expect(await readFile(join(dir, "mixed.txt"), "utf-8")).toBe("one\r\nTWO\nthree\n");
  });

  it("preserves lone-CR (classic Mac) line endings", async () => {
    // characterization: current behavior, not necessarily desired — CR-only
    // files contain no \n, detection falls back to LF, and normalizeToLF has
    // already converted every \r, so the ending style is silently changed.
    await writeFile(join(dir, "cr.txt"), "one\rtwo\rthree", "utf-8");
    await executeEdit({ path: "cr.txt", edits: [{ oldText: "two", newText: "TWO" }] });
    expect(await readFile(join(dir, "cr.txt"), "utf-8")).toBe("one\rTWO\rthree");
  });
});

describe("edit tool: BOM handling", () => {
  it("matches oldText ignoring the BOM and re-attaches the BOM on write", async () => {
    await writeFile(
      join(dir, "bom.txt"),
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("alpha\nbeta\n")]),
    );
    await executeEdit({ path: "bom.txt", edits: [{ oldText: "alpha", newText: "ALPHA" }] });
    const onDisk = await readFile(join(dir, "bom.txt"));
    expect([...onDisk.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(onDisk.toString("utf-8")).toBe("﻿ALPHA\nbeta\n");
  });

  it("preserves UTF-16LE encoding and BOM while editing decoded text", async () => {
    const filePath = join(dir, "utf16le.txt");
    await writeFile(
      filePath,
      Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("alpha\r\nbeta", "utf16le")]),
    );
    await executeEdit({
      path: "utf16le.txt",
      edits: [{ oldText: "beta", newText: "BETA" }],
    });
    const onDisk = await readFile(filePath);
    expect([...onDisk.subarray(0, 2)]).toEqual([0xff, 0xfe]);
    expect(onDisk.subarray(2).toString("utf16le")).toBe("alpha\r\nBETA");
  });
});

describe("edit tool: fuzzy matching boundaries", () => {
  it("keeps untouched punctuation and trailing whitespace during a fuzzy edit", async () => {
    // characterization: current behavior, not necessarily desired — the edit
    // targets one line, but the untouched line's em-dash and smart quotes are
    // also rewritten to ASCII because replacement runs in fuzzy space.
    await writeFile(join(dir, "fuzzy.txt"), "say “hello”\nkeep — this\n", "utf-8");
    await executeEdit({
      path: "fuzzy.txt",
      edits: [{ oldText: 'say "hello"', newText: "say hi" }],
    });
    expect(await readFile(join(dir, "fuzzy.txt"), "utf-8")).toBe(
      "say hi\nkeep \u2014 this\n",
    );
  });
});

describe("edit tool: prepareArguments legacy shapes", () => {
  it("converts top-level oldText/newText into an edits array", () => {
    const definition = createEditToolDefinition(dir);
    const prepared = definition.prepareArguments?.({
      path: "f.txt",
      oldText: "a",
      newText: "b",
    }) as { path: string; edits: Edit[] };
    expect(prepared).toEqual({ path: "f.txt", edits: [{ oldText: "a", newText: "b" }] });
  });

  it("parses edits sent as a JSON string", () => {
    const definition = createEditToolDefinition(dir);
    const prepared = definition.prepareArguments?.({
      path: "f.txt",
      edits: JSON.stringify([{ oldText: "a", newText: "b" }]),
    }) as { path: string; edits: Edit[] };
    expect(prepared.edits).toEqual([{ oldText: "a", newText: "b" }]);
  });
});
