/**
 * C5-2: patch-flow serial apply + destructive approval surface tests.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { applyPatchProposalsSerial, classifyPatchProposalDestructive } from "./patch-flow.js";

function patchLines(...lines: string[]): string {
  return ["*** Begin Patch", ...lines, "*** End Patch"].join("\n");
}

describe("patch-flow (C5-2)", () => {
  let root: string;
  afterEach(() => {
    if (root) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("serial-applies multi-worker proposals without direct worker disk writes", async () => {
    root = mkdtempSync(path.join(tmpdir(), "patch-flow-"));
    writeFileSync(path.join(root, "a.txt"), "one\n", "utf8");
    writeFileSync(path.join(root, "b.txt"), "two\n", "utf8");

    const results = await applyPatchProposalsSerial({
      cwd: root,
      proposals: [
        {
          workerId: "w1",
          patchText: patchLines("*** Update File: a.txt", "@@", "-one", "+ONE"),
          writeSet: ["a.txt"],
        },
        {
          workerId: "w2",
          patchText: patchLines("*** Update File: b.txt", "@@", "-two", "+TWO"),
          writeSet: ["b.txt"],
        },
      ],
    });

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(readFileSync(path.join(root, "a.txt"), "utf8")).toBe("ONE\n");
    expect(readFileSync(path.join(root, "b.txt"), "utf8")).toBe("TWO\n");
  });

  it("observes conflict when later proposal cannot apply", async () => {
    root = mkdtempSync(path.join(tmpdir(), "patch-flow-conflict-"));
    writeFileSync(path.join(root, "c.txt"), "base\n", "utf8");

    const results = await applyPatchProposalsSerial({
      cwd: root,
      proposals: [
        {
          workerId: "w1",
          patchText: patchLines("*** Update File: c.txt", "@@", "-base", "+first"),
        },
        {
          workerId: "w2",
          patchText: patchLines("*** Update File: c.txt", "@@", "-base", "+second"),
        },
      ],
    });

    expect(results[0]?.ok).toBe(true);
    expect(results[1]?.ok).toBe(false);
    expect(results[1]?.error).toBeTruthy();
    expect(readFileSync(path.join(root, "c.txt"), "utf8")).toBe("first\n");
  });

  it("holds destructive delete on approval path (C2-10 surface)", async () => {
    root = mkdtempSync(path.join(tmpdir(), "patch-flow-destr-"));
    writeFileSync(path.join(root, "gone.txt"), "x\n", "utf8");
    const patchText = patchLines("*** Delete File: gone.txt");
    const classification = classifyPatchProposalDestructive(patchText);
    expect(classification.requiresApproval).toBe(true);
    expect(classification.reason).toBe("apply_patch_delete_or_move");

    const blocked = await applyPatchProposalsSerial({
      cwd: root,
      proposals: [{ workerId: "w-del", patchText }],
    });
    expect(blocked[0]?.ok).toBe(false);
    expect(blocked[0]?.error).toMatch(/destructive_requires_approval/);
    expect(readFileSync(path.join(root, "gone.txt"), "utf8")).toBe("x\n");

    const applied = await applyPatchProposalsSerial({
      cwd: root,
      proposals: [{ workerId: "w-del", patchText }],
      applyDestructiveWithoutApproval: true,
    });
    expect(applied[0]?.ok).toBe(true);
  });
});