import { describe, expect, it } from "vitest";
import {
  DEFAULT_CODING_FEATURE_FLAGS,
  isCodingFactViewsEnabled,
  isCodingPatchFlowDefault,
  isCodingRoutingMemoShadowEnabled,
  isCodingSekbExperienceShadowEnabled,
  isCodingStaleWriteGuardEnabled,
  isCodingSymbolLeaseEnabled,
  resolveWorktreeBackend,
} from "./coding-runtime-flags.js";
import { DEFAULT_CONTEXT_BLOCK_FEATURE_FLAGS } from "./assembler.js";
import { isDcsContextViewToolsEnabled } from "./dcs-context-tools-flags.js";
import { normalizeIsolationMode } from "../agents/orchestration-protocol.js";

/**
 * P0 packaging red-line defaults. Must stay aligned with
 * shared/dcs/prod-flags-catalog.ts (opt-in production surface).
 */
describe("dcs prod p0 safe defaults", () => {
  it("keeps enhancement defaults off/shared/shadow (no graduation)", () => {
    expect(isDcsContextViewToolsEnabled({})).toBe(false);
    expect(isCodingStaleWriteGuardEnabled()).toBe(false);
    expect(resolveWorktreeBackend()).toBe("inprocess");
    expect(normalizeIsolationMode(undefined)).toBe("shared");
    expect(isCodingSymbolLeaseEnabled()).toBe(false);
    expect(isCodingPatchFlowDefault()).toBe(false);
    expect(isCodingRoutingMemoShadowEnabled()).toBe(false);
    expect(isCodingSekbExperienceShadowEnabled()).toBe(false);

    expect(DEFAULT_CODING_FEATURE_FLAGS["runtime.coding.staleWriteGuard.enabled"]).toBe(false);
    expect(DEFAULT_CODING_FEATURE_FLAGS["runtime.coding.worktree.backend"]).toBe("inprocess");
    expect(DEFAULT_CODING_FEATURE_FLAGS["runtime.coding.symbolLease.enabled"]).toBe(false);
    expect(DEFAULT_CODING_FEATURE_FLAGS["runtime.coding.patchFlow.default"]).toBe(false);
    expect(DEFAULT_CODING_FEATURE_FLAGS["runtime.coding.routingMemo.shadow"]).toBe(false);
    expect(DEFAULT_CODING_FEATURE_FLAGS["runtime.coding.sekb.experienceShadow"]).toBe(false);
  });

  it("TASK-P0-02: factViews is not a default-true coding flag; deprecated helper is fail-closed", () => {
    expect(
      Object.prototype.hasOwnProperty.call(
        DEFAULT_CODING_FEATURE_FLAGS,
        "runtime.coding.factViews.enabled",
      ),
    ).toBe(false);
    expect(isCodingFactViewsEnabled()).toBe(false);
    expect(
      isCodingFactViewsEnabled(
        { runtime: { coding: { factViews: { enabled: true } } } } as never,
        { factViewsEnabled: true },
      ),
    ).toBe(false);
  });

  it("TASK-P0-02: only env truthy values enable view tools", () => {
    expect(isDcsContextViewToolsEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(
      isDcsContextViewToolsEnabled({ OPENCLAW_DCS_CONTEXT_VIEW_TOOLS: "1" } as NodeJS.ProcessEnv),
    ).toBe(true);
    expect(
      isDcsContextViewToolsEnabled({ OPENCLAW_DCS_CONTEXT_TOOLS: "true" } as NodeJS.ProcessEnv),
    ).toBe(true);
    expect(
      isDcsContextViewToolsEnabled({ OPENCLAW_DCS_CONTEXT_VIEW_TOOLS: "0" } as NodeJS.ProcessEnv),
    ).toBe(false);
  });

  it("TASK-P1-02: working-memory assembler default remains off", () => {
    expect(DEFAULT_CONTEXT_BLOCK_FEATURE_FLAGS["runtime.contextBlock.working_memory.enabled"]).toBe(
      false,
    );
  });
});
