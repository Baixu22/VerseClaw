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

  it("TF-0774 ignores legacy product soak approval after retirement", async () => {
    root = mkdtempSync(path.join(tmpdir(), "c5p-"));
    writeFileSync(path.join(root, "a.txt"), "x\n");
    const d = await assessPatchFlowDefaultGraduation({
      productSoakApproved: true,
      cwdForSmoke: root,
    });
    expect(d.meetsGate).toBe(false);
    expect(d.recommendation).toBe("keep-off");
    expect(d.completionClass).toBe("retired");
    expect(d.patchFlowDefault).toBe(false);
    expect(d.defaultsUnchanged).toBe(true);
    expect(isCodingPatchFlowDefault()).toBe(false);
  });

  it("keeps retirement independent of capability diagnostic success", async () => {
    const d = await assessPatchFlowDefaultGraduation({ productSoakApproved: true });
    expect(d.meetsGate).toBe(false);
    expect(d.capabilityReady).toBe(true);
    const withoutSoak = await assessPatchFlowDefaultGraduation({ productSoakApproved: false });
    expect(withoutSoak.meetsGate).toBe(false);
    expect(withoutSoak.recommendation).toBe("keep-off");
    expect(d.patchFlowDefault).toBe(false);
  });
});
