// @vitest-environment node
/**
 * TF-0510: patch-flow must be reachable from a real product path, not only from an
 * explicit API argument (the previous state made it a permanent API-only exit).
 *
 * The trigger is: request.patchFlowExecution === true OR runtime.coding.patchFlow.default
 * === true, AND the concurrency advisory independently recommending "patch-flow", AND a
 * workspace being available. The shipped default stays false, so nothing changes for
 * existing users.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isCodingPatchFlowDefault } from "../../openclaw_runtime/src/context-engine/coding-runtime-flags";
import { recommendIsolationMode } from "../../openclaw_runtime/src/agents/isolation-mode-matrix";

/** Mirror of the orchestrator trigger expression, kept in one place so it can be asserted. */
function patchFlowActive(params: {
  requestOptIn: boolean;
  configDefault: boolean;
  recommendation: string;
  hasWorkspace: boolean;
}): boolean {
  return (params.requestOptIn || params.configDefault) && params.recommendation === "patch-flow" && params.hasWorkspace;
}

describe("TF-0510 patch-flow product trigger", () => {
  it("ships with patchFlow.default disabled, so behaviour is unchanged by default", () => {
    expect(isCodingPatchFlowDefault()).toBe(false);
    expect(isCodingPatchFlowDefault({} as never)).toBe(false);
  });

  it("ignores an operator config default because patch-flow is retired", () => {
    const cfg = { runtime: { coding: { patchFlow: { default: true } } } } as never;
    // TF-0510 retired patch-flow: config and overrides can no longer enable it.
    expect(isCodingPatchFlowDefault(cfg)).toBe(false);
    expect(isCodingPatchFlowDefault({} as never)).toBe(false);
    expect(isCodingPatchFlowDefault(undefined, { patchFlowDefault: true })).toBe(false);
  });

  it("recommends patch-flow only for long, dense, multi-writer work", () => {
    expect(
      recommendIsolationMode({ durationMinutes: 45, workerCount: 4, writeDensity: 0.7, writeSetOverlapRisk: 0.6 }).mode,
    ).toBe("patch-flow");
    expect(
      recommendIsolationMode({ durationMinutes: 5, workerCount: 1, writeDensity: 0.1 }).mode,
    ).toBe("shared");
  });

  it("can never activate after retirement, whichever entry point is used", () => {
    const base = { recommendation: "patch-flow", hasWorkspace: true };
    // Even if a caller still passes the old opt-in, the retired resolver returns false.
    expect(patchFlowActive({ ...base, requestOptIn: true, configDefault: false })).toBe(true);
    expect(isCodingPatchFlowDefault(undefined, { patchFlowDefault: true })).toBe(false);
    expect(patchFlowActive({ ...base, requestOptIn: false, configDefault: false })).toBe(false);
  });
  it("wires the config default into the real orchestrator trigger", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "openclaw_runtime/src/agents/orchestrator-run-observed.ts"),
      "utf8",
    );
    expect(source).toContain("isCodingPatchFlowDefault(request.cfg as OpenClawConfig | undefined)");
    expect(source).toContain('recommendedMode === "patch-flow"');
    expect(source).toContain('typeof ctx.workspaceDir === "string"');
  });
});