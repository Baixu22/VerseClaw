import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { assessPatchFlowDefaultGraduation } from "./patch-flow-graduation.js";
import { isCodingPatchFlowDefault } from "../context-engine/coding-runtime-flags.js";

describe("patch-flow-graduation (C5-P)", () => {
  let root: string;
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it("keeps default false and recommendation keep-off without product soak", async () => {
    expect(isCodingPatchFlowDefault()).toBe(false);
    const d = await assessPatchFlowDefaultGraduation({ productSoakApproved: false });
    expect(d.patchFlowDefault).toBe(false);
    expect(d.recommendation).toBe("keep-off");
    expect(d.meetsGate).toBe(false);
    expect(d.defaultsUnchanged).toBe(true);
    expect(d.capabilityReady).toBe(true);
  });

  it("even with product soak, packaging still keep-off / meetsGate false", async () => {
    root = mkdtempSync(path.join(tmpdir(), "c5p-"));
    writeFileSync(path.join(root, "a.txt"), "x\n");
    const d = await assessPatchFlowDefaultGraduation({
      productSoakApproved: true,
      cwdForSmoke: root,
    });
    expect(d.recommendation).toBe("keep-off");
    expect(d.meetsGate).toBe(false);
    expect(d.patchFlowDefault).toBe(false);
    expect(d.notes.some((n) => n.includes("consider-default-on") || n.includes("productSoakApproved=true"))).toBe(
      true,
    );
  });
});