import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

import type { PromptPlan } from "../../shared/types/context-control-plane/artifacts.js";
import {
  explainStage6WhyIncluded,
  projectStage6DiffFromPromptPlan,
  projectStage6DiffFromReports,
  projectStage6ReplayInputFromReports,
  simulateStage6Policy,
  STAGE6_PROJECTION_SCHEMA,
} from "../../shared/types/context-control-plane/stage6-control-plane-explain.js";

const sha = `sha256:${"a".repeat(64)}`;

const plan = {
  schema: "PromptPlan/v1",
  planId: "plan_1",
  snapshotId: "snap_1",
  identity: {
    sessionKey: "sess:stage6",
    runId: "run:stage6",
    attemptIndex: 0,
    modelCallIndex: 0,
  },
  selected: [
    { refId: "ctxref:a", order: 0, projection: "verbatim", basis: "user_intent", budgetUnits: 10 },
    { refId: "ctxref:c", order: 1, projection: "index_only", basis: "task_ledger", budgetUnits: 2 },
  ],
  omitted: [{ refId: "ctxref:b", reason: "budget-drop", policyDigest: sha }],
  order: ["ctxref:a", "ctxref:c"],
  budget: { unit: "tokens", requested: 100, applied: 12, outputReserve: 8 },
  why: { policyDigest: sha, policyEpoch: "epoch:1", ruleId: "stage6-policy:v1" },
  planDigest: sha,
  sealed: true,
  createdAt: "2026-08-18T00:00:00.000Z",
} as unknown as PromptPlan;

describe("stage6 control-plane explanations", () => {
  it("projects selected/omitted/why facts deterministically from PromptPlan", () => {
    const first = projectStage6DiffFromPromptPlan(plan);
    const second = projectStage6DiffFromPromptPlan(plan);
    expect(first).toEqual(second);
    if (!first.ok) throw new Error("plan projection failed");
    expect(first.projection.schema).toBe(STAGE6_PROJECTION_SCHEMA);
    expect(first.projection.selectedCount).toBe(2);
    expect(first.projection.omittedCount).toBe(1);
    expect(first.projection.entries.map((entry) => entry.id)).toEqual([
      "selected:ctxref:a",
      "selected:ctxref:c",
      "omitted:ctxref:b",
    ]);
    expect(explainStage6WhyIncluded(first.projection, "ctxref:a")).toMatchObject({
      refId: "ctxref:a",
      status: "selected",
      reason: "selected-by-plan",
      policyDigest: sha,
      ruleId: "stage6-policy:v1",
    });
  });

  it("fails closed on overlap and order mismatch", () => {
    expect(projectStage6DiffFromPromptPlan({
      ...plan,
      omitted: [{ refId: "ctxref:a", reason: "duplicate", policyDigest: sha }],
    })).toMatchObject({ ok: false, reason: "selected-omitted-overlap" });
    expect(projectStage6DiffFromPromptPlan({ ...plan, order: ["ctxref:a"] }))
      .toMatchObject({ ok: false, reason: "order-mismatch" });
    expect(projectStage6DiffFromPromptPlan({ ...plan, selected: [] }))
      .toMatchObject({ ok: false, reason: "invalid-plan" });
  });

  it("policy simulation is a pure dry-run with protected budget semantics", () => {
    const input = {
      policy: {
        ruleId: "stage6-policy:v1",
        policyDigest: sha,
        protectPriorities: ["critical", "constraint"] as const,
        budgetUnits: 15,
      },
      candidates: [
        { refId: "a", priority: "critical" as const, units: 6, protectedFlag: false },
        { refId: "b", priority: "normal" as const, units: 8, protectedFlag: false },
        { refId: "c", priority: "optional" as const, units: 2, protectedFlag: false },
        { refId: "d", priority: "normal" as const, units: 9, protectedFlag: false },
      ],
    };
    const first = simulateStage6Policy(input);
    const second = simulateStage6Policy(input);
    expect(first).toEqual(second);
    if (!first.ok) throw new Error("simulation failed");
    expect(first.simulation.sideEffects).toBe(0);
    expect(first.simulation.dryRun).toBe(true);
    expect(first.simulation.decisions).toEqual([
      { refId: "a", decision: "allow", reason: "protected-rule", units: 6 },
      { refId: "b", decision: "allow", reason: "budget-allow", units: 8 },
      { refId: "d", decision: "drop", reason: "budget-drop", units: 9 },
      { refId: "c", decision: "drop", reason: "budget-drop", units: 2 },
    ]);
    const overflow = simulateStage6Policy({
      policy: input.policy,
      candidates: [
        { refId: "x", priority: "critical", units: 99, protectedFlag: true },
      ],
    });
    if (!overflow.ok) throw new Error("overflow simulation failed");
    expect(overflow.simulation.decisions[0]).toMatchObject({
      decision: "drop",
      reason: "protected-over-budget",
    });
  });

  it("projects sanitized reports and input-only replay data", () => {
    const reports = [
      {
        id: "lcp_context_1",
        kind: "context",
        timestamp: "2026-08-18T10:00:00.000Z",
        summary: "LoopContextPack 20/100 tokens",
        evidenceRefs: [{ type: "task", ref: "task:1" }],
        payload: {
          sections: [
            { id: "stable", itemCount: 2, omittedItemCount: 0, protectedItemCount: 2 },
            { id: "dynamic", itemCount: 4, omittedItemCount: 1, protectedItemCount: 0 },
          ],
        },
      },
    ];
    const diff = projectStage6DiffFromReports(reports);
    expect(diff.reportCount).toBe(1);
    expect(diff.selectedCount).toBe(2);
    expect(diff.omittedCount).toBe(1);
    expect(diff.entries.filter((entry) => entry.status === "omitted")[0]?.reason)
      .toBe("context.truncated_or_omitted");

    const replay = projectStage6ReplayInputFromReports({
      reports,
      plan,
      envelopeDigest: sha,
      receiptIds: ["efx_1", "efx_1"],
    });
    expect(replay.effectsReplayed).toBe(false);
    expect(replay.rawPayloadIncluded).toBe(false);
    expect(replay.planId).toBe("plan_1");
    expect(replay.snapshotId).toBe("snap_1");
    expect(replay.planDigest).toBe(sha);
    expect(replay).not.toHaveProperty("snapshotDigest");
    expect(replay.envelopeDigest).toBe(sha);
    expect(replay.receiptIds).toEqual(["efx_1"]);
    expect(replay.evidenceRefs).toEqual([{ type: "task", ref: "task:1" }]);
  });

  it("localizes stage6 reason and decision codes across all four locales", () => {
    const root = path.resolve(__dirname, "../..");
    const reasonKeys = [
      "budgetAllow",
      "budgetDrop",
      "budgetTruncate",
      "contextTruncatedOrOmitted",
      "duplicate",
      "flagOff",
      "killSwitch",
      "policyDenied",
      "protectedOverBudget",
      "protectedRule",
      "protectedSection",
      "reportSummary",
      "selectedByPlan",
      "selectedByReport",
      "sensitivity",
      "stale",
      "unknown",
    ].sort();
    const decisionKeys = ["allow", "drop", "unknown"].sort();
    for (const locale of ["en", "zh", "ja", "ru"]) {
      const settings = JSON.parse(fs.readFileSync(
        path.join(root, "shared", "i18n", "locales", locale, "settings.json"),
        "utf8",
      ));
      const block = settings.developer.contextControlPlane;
      expect(Object.keys(block.reasons).sort(), locale).toEqual(reasonKeys);
      expect(Object.keys(block.decisions).sort(), locale).toEqual(decisionKeys);
      for (const key of reasonKeys) {
        expect(block.reasons[key], `${locale}/${key}`).toBeTruthy();
      }
    }
    const panel = fs.readFileSync(
      path.join(root, "src", "components", "settings", "ContextControlPlanePanel.tsx"),
      "utf8",
    );
    expect(panel).toContain("developer.contextControlPlane.reasons.");
    expect(panel).toContain("developer.contextControlPlane.decisions.");
    expect(panel).not.toContain("{decision.decision} · {decision.reason}");
  });

  it("pure source has no wall-clock/randomness or renderer transport escape", () => {
    const root = path.resolve(__dirname, "../..");
    const source = fs.readFileSync(
      path.join(root, "shared", "types", "context-control-plane", "stage6-control-plane-explain.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/Date\.now|new Date|Math\.random|ipcRenderer|18789|WebSocket/);
  });
});
