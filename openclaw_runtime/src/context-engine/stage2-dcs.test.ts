import { describe, expect, it } from "vitest";

import {
  buildStage2TaskLedgerContextRef,
  buildStage2ToolResultContextRef,
  buildStage2UserIntentContextRef,
} from "./stage2-context-refs.js";
import {
  buildStage2CatalogEpoch,
  buildStage2PolicyEpoch,
} from "./stage2-catalog-epoch.js";
import {
  compileStage2Dcs,
  resetStage2DcsRegistryForTests,
  STAGE2_DCS_POLICY_DIGEST,
} from "./stage2-dcs.js";
import { buildStage2TransformGraph } from "./stage2-transform-graph.js";

const OBSERVED_AT = "2026-08-16T00:00:00.000Z";

describe("stage2 DCS runtime compile", () => {
  it("compiles three ref kinds into stable sealed artifacts", () => {
    resetStage2DcsRegistryForTests();
    const user = buildStage2UserIntentContextRef({
      sessionKey: "sess:stage2",
      runId: "run:stage2",
      entryId: "entry_1",
      payload: "write sentinel",
      observedAt: OBSERVED_AT,
    });
    const ledger = buildStage2TaskLedgerContextRef({
      sessionKey: "sess:stage2",
      runId: "run:stage2",
      taskLedgerRootId: "tlroot_runtime",
      revision: "rev_1_deadbeef",
      contentDigest: `sha256:${"a".repeat(64)}`,
      observedAt: OBSERVED_AT,
    });
    const tool = buildStage2ToolResultContextRef({
      sessionKey: "sess:stage2",
      runId: "run:stage2",
      handle: {
        uri: "context-archive://sess-stage2/tool-result.json",
        checksum: `sha256:${"b".repeat(64)}`,
        byteLength: 8,
      },
      observedAt: OBSERVED_AT,
    });
    if (!user.ok || !ledger.ok || !tool.ok) throw new Error("fixture refs failed");
    const input = {
      refs: [user.ref, ledger.ref, tool.ref],
      identity: {
        sessionKey: "sess:stage2",
        runId: "run:stage2",
        attemptIndex: 0,
        modelCallIndex: 0,
      },
      taskLedgerRevision: "rev_1_deadbeef",
      catalogEpoch: buildStage2CatalogEpoch(`sha256:${"c".repeat(64)}`),
      policyEpoch: buildStage2PolicyEpoch(STAGE2_DCS_POLICY_DIGEST),
      policyDigest: STAGE2_DCS_POLICY_DIGEST,
      modelProfile: {
        providerId: "deepseek",
        modelId: "deepseek-v4-flash",
        adapterId: "openai-completions",
      },
      transformGraph: buildStage2TransformGraph(),
      budget: { unit: "chars", limit: 10_000, outputReserve: 0 },
      observedAt: OBSERVED_AT,
    } as const;
    const first = compileStage2Dcs(input);
    const second = compileStage2Dcs(input);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.snapshot.snapshotId).toBe(second.snapshot.snapshotId);
    expect(first.snapshot.snapshotDigest).toBe(second.snapshot.snapshotDigest);
    expect(first.plan.planId).toBe(second.plan.planId);
    expect(first.plan.planDigest).toBe(second.plan.planDigest);
    expect(first.plan.sealed).toBe(true);
    expect(first.plan.selected.map((entry) => entry.basis).toSorted())
      .toEqual(["task_ledger", "tool_result", "user_intent"]);
  });
});
