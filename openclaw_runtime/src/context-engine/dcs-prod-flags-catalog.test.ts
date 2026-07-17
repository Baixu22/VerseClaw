import { describe, expect, it } from "vitest";
import {
  DEFAULT_CODING_FEATURE_FLAGS,
  isCodingPatchFlowDefault,
  isCodingRoutingMemoShadowEnabled,
  isCodingSekbExperienceShadowEnabled,
  isCodingStaleWriteGuardEnabled,
  isCodingSymbolLeaseEnabled,
  resolveWorktreeBackend,
} from "./coding-runtime-flags.js";
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
});