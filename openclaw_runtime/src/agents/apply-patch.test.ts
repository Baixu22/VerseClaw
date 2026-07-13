/**
 * Characterization tests for the runtime apply_patch tool and parser.
 *
 * Snapshot of CURRENT behavior (envelope parsing, hunk application, workspace
 * boundary enforcement, summary/result shapes) for the ported coding tools.
 * Where a behavior looks questionable it carries a `characterization:` comment
 * — recorded, not endorsed. The result text/summary shape is a P0 producer
 * anchor point; these tests freeze it.
 */
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyPatch, createApplyPatchTool } from "./apply-patch.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "clawx-apply-patch-test-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function patchLines(...lines: string[]): string {
  return ["*** Begin Patch", ...lines, "*** End Patch"].join("\n");
}

describe("applyPatch: add", () => {
  it("adds a file from + lines, always with a trailing newline", async () => {
    const result = await applyPatch(
      patchLines("*** Add File: new.txt", "+hello", "+world"),
      { cwd: dir },
    );
    expect(await readFile(join(dir, "new.txt"), "utf-8")).toBe("hello\nworld\n");
    expect(result.summary).toEqual({ added: ["new.txt"], modified: [], deleted: [] });
    expect(result.text).toBe("Success. Updated the following files:\nA new.txt");
  });

  it("creates parent directories for nested add targets", async () => {
    const result = await applyPatch(
      patchLines("*** Add File: sub/deep/new.txt", "+content"),
      { cwd: dir },
    );
    expect(await readFile(join(dir, "sub", "deep", "new.txt"), "utf-8")).toBe("content\n");
    // Display paths are OS-native relative paths.
    expect(result.summary.added).toEqual([relative(dir, join(dir, "sub", "deep", "new.txt"))]);
  });
});

describe("applyPatch: update", () => {
  it("replaces matched context lines and reports the file as modified", async () => {
    await writeFile(join(dir, "f.txt"), "one\ntwo\nthree\n", "utf-8");
    const result = await applyPatch(
      patchLines("*** Update File: f.txt", "@@", " one", "-two", "+TWO", " three"),
      { cwd: dir },
    );
    expect(await readFile(join(dir, "f.txt"), "utf-8")).toBe("one\nTWO\nthree\n");
    expect(result.summary).toEqual({ added: [], modified: ["f.txt"], deleted: [] });
  });

  it("locates the chunk via an @@ change-context line", async () => {
    await writeFile(join(dir, "f.txt"), "header\nsection A\nvalue: 1\nsection B\nvalue: 1\n", "utf-8");
    await applyPatch(
      patchLines("*** Update File: f.txt", "@@ section B", "-value: 1", "+value: 2"),
      { cwd: dir },
    );
    expect(await readFile(join(dir, "f.txt"), "utf-8")).toBe(
      "header\nsection A\nvalue: 1\nsection B\nvalue: 2\n",
    );
  });

  it("preserves the absence of a trailing newline", async () => {
    // characterization: current behavior, not necessarily desired — updated
    // files always come out with a trailing newline.
    await writeFile(join(dir, "f.txt"), "a\nb", "utf-8");
    await applyPatch(patchLines("*** Update File: f.txt", "@@", "-b", "+B"), { cwd: dir });
    expect(await readFile(join(dir, "f.txt"), "utf-8")).toBe("a\nB");
  });

  it("preserves CRLF endings while replacing matched context", async () => {
    // characterization: current behavior, not necessarily desired — patching a
    // CRLF file produces MIXED endings: untouched lines keep their \r, replaced
    // lines are written bare-LF, and the whole file is joined with \n.
    await writeFile(join(dir, "crlf.txt"), "one\r\ntwo\r\nthree\r\n", "utf-8");
    await applyPatch(patchLines("*** Update File: crlf.txt", "@@", "-two", "+TWO"), { cwd: dir });
    expect(await readFile(join(dir, "crlf.txt"), "utf-8")).toBe("one\r\nTWO\r\nthree\r\n");
  });

  it("preserves UTF-16BE encoding while applying an update", async () => {
    const filePath = join(dir, "utf16be.txt");
    const littleEndian = Buffer.from("one\ntwo", "utf16le");
    const bigEndian = Buffer.alloc(littleEndian.length);
    for (let index = 0; index < littleEndian.length; index += 2) {
      bigEndian[index] = littleEndian[index + 1];
      bigEndian[index + 1] = littleEndian[index];
    }
    await writeFile(filePath, Buffer.concat([Buffer.from([0xfe, 0xff]), bigEndian]));
    await applyPatch(
      patchLines("*** Update File: utf16be.txt", "@@", "-two", "+TWO"),
      { cwd: dir },
    );
    const onDisk = await readFile(filePath);
    expect([...onDisk.subarray(0, 2)]).toEqual([0xfe, 0xff]);
    const payload = onDisk.subarray(2);
    const swapped = Buffer.alloc(payload.length);
    for (let index = 0; index < payload.length; index += 2) {
      swapped[index] = payload[index + 1];
      swapped[index + 1] = payload[index];
    }
    expect(swapped.toString("utf16le")).toBe("one\nTWO");
  });

  it("supports Move to: writing the new path and removing the old one", async () => {
    await writeFile(join(dir, "old.txt"), "keep\nchange\n", "utf-8");
    const result = await applyPatch(
      patchLines(
        "*** Update File: old.txt",
        "*** Move to: renamed.txt",
        "@@",
        "-change",
        "+changed",
      ),
      { cwd: dir },
    );
    expect(existsSync(join(dir, "old.txt"))).toBe(false);
    expect(await readFile(join(dir, "renamed.txt"), "utf-8")).toBe("keep\nchanged\n");
    expect(result.summary.modified).toEqual(["renamed.txt"]);
  });

  it("fails with the expected-lines error when context does not match", async () => {
    await writeFile(join(dir, "f.txt"), "actual content\n", "utf-8");
    await expect(
      applyPatch(patchLines("*** Update File: f.txt", "@@", "-does not exist", "+x"), {
        cwd: dir,
      }),
    ).rejects.toThrowError("Failed to find expected lines in");
    // File is untouched after the failure.
    expect(await readFile(join(dir, "f.txt"), "utf-8")).toBe("actual content\n");
  });

  it("fails with a read error when the target file is missing", async () => {
    await expect(
      applyPatch(patchLines("*** Update File: missing.txt", "@@", "-a", "+b"), { cwd: dir }),
    ).rejects.toThrowError(/Failed to read file to update/);
  });
});

describe("applyPatch: delete", () => {
  it("deletes a file and reports it", async () => {
    await writeFile(join(dir, "gone.txt"), "bye\n", "utf-8");
    const result = await applyPatch(patchLines("*** Delete File: gone.txt"), { cwd: dir });
    expect(existsSync(join(dir, "gone.txt"))).toBe(false);
    expect(result.summary).toEqual({ added: [], modified: [], deleted: ["gone.txt"] });
    expect(result.text).toBe("Success. Updated the following files:\nD gone.txt");
  });
});

describe("applyPatch: multi-hunk summary", () => {
  it("orders the summary text A then M then D", async () => {
    await writeFile(join(dir, "m.txt"), "old\n", "utf-8");
    await writeFile(join(dir, "d.txt"), "x\n", "utf-8");
    const result = await applyPatch(
      patchLines(
        "*** Add File: a.txt",
        "+added",
        "*** Update File: m.txt",
        "@@",
        "-old",
        "+new",
        "*** Delete File: d.txt",
      ),
      { cwd: dir },
    );
    expect(result.text).toBe(
      "Success. Updated the following files:\nA a.txt\nM m.txt\nD d.txt",
    );
  });
});

describe("applyPatch: envelope validation", () => {
  it("rejects input without the Begin marker", async () => {
    await expect(applyPatch("not a patch", { cwd: dir })).rejects.toThrowError(
      "The first line of the patch must be '*** Begin Patch'",
    );
  });

  it("rejects a patch missing the End marker", async () => {
    await expect(
      applyPatch("*** Begin Patch\n*** Add File: x.txt\n+hi", { cwd: dir }),
    ).rejects.toThrowError("The last line of the patch must be '*** End Patch'");
  });

  it("rejects a marker-only patch with no hunks", async () => {
    await expect(applyPatch(patchLines(), { cwd: dir })).rejects.toThrowError(
      "No files were modified.",
    );
  });

  it("leniently unwraps a heredoc-wrapped patch", async () => {
    // characterization: models sometimes emit the bash heredoc wrapper; the
    // parser accepts <<EOF ... EOF around an otherwise valid envelope.
    const wrapped = ["<<EOF", "*** Begin Patch", "*** Add File: h.txt", "+hi", "*** End Patch", "EOF"].join("\n");
    await applyPatch(wrapped, { cwd: dir });
    expect(await readFile(join(dir, "h.txt"), "utf-8")).toBe("hi\n");
  });

  it("rejects an unknown hunk header", async () => {
    await expect(
      applyPatch(patchLines("*** Rename File: x.txt"), { cwd: dir }),
    ).rejects.toThrowError(/is not a valid hunk header/);
  });
});

describe("applyPatch: workspace boundary (workspaceOnly default)", () => {
  it("rejects relative paths escaping the cwd on add", async () => {
    await expect(
      applyPatch(patchLines("*** Add File: ../escape.txt", "+nope"), { cwd: dir }),
    ).rejects.toThrowError(/Path escapes sandbox root/);
    expect(existsSync(join(dir, "..", "escape.txt"))).toBe(false);
  });

  it("rejects absolute paths outside the cwd on add", async () => {
    const outside = join(tmpdir(), "clawx-apply-patch-escape-target.txt");
    await expect(
      applyPatch(patchLines(`*** Add File: ${outside}`, "+nope"), { cwd: dir }),
    ).rejects.toThrowError(/Path escapes sandbox root/);
    expect(existsSync(outside)).toBe(false);
  });

  it("rejects relative paths escaping the cwd on delete", async () => {
    await expect(
      applyPatch(patchLines("*** Delete File: ../victim.txt"), { cwd: dir }),
    ).rejects.toThrowError(/Path escapes sandbox root/);
  });

  it("allows escaping paths when workspaceOnly is explicitly false", async () => {
    // characterization: current behavior — the boundary is an option, not an
    // invariant. Write into a sibling temp dir we control, then clean it up.
    const sibling = await mkdtemp(join(tmpdir(), "clawx-apply-patch-outside-"));
    try {
      const target = join(sibling, "allowed.txt");
      await applyPatch(patchLines(`*** Add File: ${target}`, "+content"), {
        cwd: dir,
        workspaceOnly: false,
      });
      expect(await readFile(target, "utf-8")).toBe("content\n");
    } finally {
      await rm(sibling, { recursive: true, force: true });
    }
  });
});

describe("createApplyPatchTool", () => {
  it("returns tool-result content plus a summary in details", async () => {
    const tool = createApplyPatchTool({ cwd: dir });
    expect(tool.name).toBe("apply_patch");
    const result = await tool.execute(
      "test-call",
      { input: patchLines("*** Add File: via-tool.txt", "+hi") },
      undefined,
      undefined,
    );
    expect(result).toMatchObject({
      content: [{ type: "text", text: "Success. Updated the following files:\nA via-tool.txt" }],
      details: {
        summary: { added: ["via-tool.txt"], modified: [], deleted: [] },
        working_memory: { significance: "high" },
      },
    });
  });

  it("rejects empty input before parsing", async () => {
    const tool = createApplyPatchTool({ cwd: dir });
    await expect(
      tool.execute("test-call", { input: "   " }, undefined, undefined),
    ).rejects.toThrowError("Provide a patch input.");
  });
});
