import { describe, expect, it } from "vitest";
import {
  DEFAULT_CODING_FEATURE_FLAGS,
  isCodingAuditLogEnabled,
  isCodingAutoCheckpointEnabled,
  isCodingBaseVersionGuardEnabled,
  isCodingCommandApprovalEnabled,
  isCodingConcurrencyV2Enabled,
  isCodingExecSideEffectsEnabled,
  isCodingExecUndoEnabled,
  isCodingFactViewsEnabled,
  isCodingGitCheckpointEnabled,
  isCodingPatchFlowDefault,
  isCodingRoutingMemoShadowEnabled,
  isCodingSekbExperienceShadowEnabled,
  isCodingStaleWriteGuardEnabled,
  isCodingSymbolLeaseEnabled,
  isCodingUftkEnabled,
  isCodingGitCheckpointPathScopedEnabled,
  isCodingGitCheckpointSafetySnapshotEnabled,
  isCodingGitCheckpointLifecycleEnabled,
  resolveCodingAutoVerifyConfig,
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
    expect(isCodingUftkEnabled()).toBe(false);
    expect(isCodingBaseVersionGuardEnabled()).toBe(false);
    expect(isCodingAuditLogEnabled()).toBe(false);
    expect(isCodingGitCheckpointEnabled()).toBe(false);
    expect(isCodingConcurrencyV2Enabled()).toBe(false);
    expect(isCodingGitCheckpointPathScopedEnabled()).toBe(false);
    expect(isCodingGitCheckpointSafetySnapshotEnabled()).toBe(false);
    expect(isCodingGitCheckpointLifecycleEnabled()).toBe(false);
    expect(isCodingExecSideEffectsEnabled()).toBe(false);
    expect(isCodingCommandApprovalEnabled()).toBe(false);
    expect(isCodingPatchFlowDefault()).toBe(false);
    expect(isCodingRoutingMemoShadowEnabled()).toBe(false);
    expect(isCodingSekbExperienceShadowEnabled()).toBe(false);
    expect(resolveCodingAutoVerifyConfig()).toEqual({ enabled: "auto", timeoutSeconds: 90 });

    expect(DEFAULT_CODING_FEATURE_FLAGS["runtime.coding.staleWriteGuard.enabled"]).toBe(false);
    expect(DEFAULT_CODING_FEATURE_FLAGS["runtime.coding.worktree.backend"]).toBe("inprocess");
    expect(DEFAULT_CODING_FEATURE_FLAGS["runtime.coding.symbolLease.enabled"]).toBe(false);
    expect(DEFAULT_CODING_FEATURE_FLAGS["runtime.coding.uftk.enabled"]).toBe(false);
    expect(
      DEFAULT_CODING_FEATURE_FLAGS["runtime.coding.uftk.baseVersionGuard.enabled"],
    ).toBe(false);
    expect(
      DEFAULT_CODING_FEATURE_FLAGS["runtime.coding.uftk.execSideEffects.enabled"],
    ).toBe(false);
    expect(
      DEFAULT_CODING_FEATURE_FLAGS["runtime.coding.uftk.commandApproval.enabled"],
    ).toBe(false);
    expect(
      DEFAULT_CODING_FEATURE_FLAGS["runtime.coding.uftk.auditLog.enabled"],
    ).toBe(false);
    expect(
      DEFAULT_CODING_FEATURE_FLAGS["runtime.coding.uftk.gitCheckpoint.enabled"],
    ).toBe(false);
    expect(
      DEFAULT_CODING_FEATURE_FLAGS["runtime.coding.uftk.concurrencyV2.enabled"],
    ).toBe(false);
    expect(
      DEFAULT_CODING_FEATURE_FLAGS["runtime.coding.uftk.gitCheckpoint.pathScoped.enabled"],
    ).toBe(false);
    expect(
      DEFAULT_CODING_FEATURE_FLAGS["runtime.coding.uftk.gitCheckpoint.safetySnapshot.enabled"],
    ).toBe(false);
    expect(
      DEFAULT_CODING_FEATURE_FLAGS["runtime.coding.uftk.gitCheckpoint.lifecycle.enabled"],
    ).toBe(false);
    expect(DEFAULT_CODING_FEATURE_FLAGS["runtime.coding.uftk.execUndo.enabled"]).toBe(false);
    expect(DEFAULT_CODING_FEATURE_FLAGS["runtime.coding.uftk.autoCheckpoint.enabled"]).toBe(false);
    expect(
      isCodingGitCheckpointEnabled({
        runtime: { coding: { uftk: { gitCheckpoint: { enabled: true } } } },
      } as never),
    ).toBe(true);
    expect(isCodingGitCheckpointEnabled(undefined, { gitCheckpointEnabled: true })).toBe(true);
    // P6B sub-leaves resolve independently of the parent gitCheckpoint leaf.
    expect(
      isCodingGitCheckpointPathScopedEnabled({
        runtime: { coding: { uftk: { gitCheckpoint: { pathScoped: { enabled: true } } } } },
      } as never),
    ).toBe(true);
    expect(
      isCodingGitCheckpointSafetySnapshotEnabled({
        runtime: { coding: { uftk: { gitCheckpoint: { safetySnapshot: { enabled: true } } } } },
      } as never),
    ).toBe(true);
    expect(
      isCodingGitCheckpointLifecycleEnabled({
        runtime: { coding: { uftk: { gitCheckpoint: { lifecycle: { enabled: true } } } } },
      } as never),
    ).toBe(true);
    expect(
      isCodingGitCheckpointPathScopedEnabled({
        runtime: { coding: { uftk: { gitCheckpoint: { enabled: true } } } },
      } as never),
    ).toBe(false);
    // P7 leaves resolve independently and stay off by default.
    expect(isCodingExecUndoEnabled()).toBe(false);
    expect(isCodingAutoCheckpointEnabled()).toBe(false);
    expect(
      isCodingExecUndoEnabled({
        runtime: { coding: { uftk: { execUndo: { enabled: true } } } },
      } as never),
    ).toBe(true);
    expect(
      isCodingAutoCheckpointEnabled({
        runtime: { coding: { uftk: { autoCheckpoint: { enabled: true } } } },
      } as never),
    ).toBe(true);
    // Enabling the parent UFTK leaf must not switch a P7 capability on.
    expect(
      isCodingExecUndoEnabled({ runtime: { coding: { uftk: { enabled: true } } } } as never),
    ).toBe(false);
    expect(
      isCodingAutoCheckpointEnabled({ runtime: { coding: { uftk: { enabled: true } } } } as never),
    ).toBe(false);
    expect(DEFAULT_CODING_FEATURE_FLAGS["runtime.coding.patchFlow.default"]).toBe(false);
    expect(DEFAULT_CODING_FEATURE_FLAGS["runtime.coding.routingMemo.shadow"]).toBe(false);
    expect(DEFAULT_CODING_FEATURE_FLAGS["runtime.coding.sekb.experienceShadow"]).toBe(false);
    expect(DEFAULT_CODING_FEATURE_FLAGS["runtime.coding.autoVerify.enabled"]).toBe("auto");
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
