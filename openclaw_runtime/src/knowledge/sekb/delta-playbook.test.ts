import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { closeOpenClawStateDatabaseForTest } from "../../state/openclaw-state-db.js";
import { DistillationTool } from "./distillation-tool.js";
import { KnowledgeStore } from "./knowledge-store.js";
import { approxTokenCount } from "./types.js";
import { buildSekbDeltaComparison, extractSekbDeltaPlaybook } from "./delta-playbook.js";
const tempRoots: string[] = [];
import type { Principle, Trajectory } from "./types.js";

const actor = "codex/tf0605-test";

function trajectory(id: string, outcome: "success" | "failure", overrides: Partial<Trajectory> = {}): Trajectory {
  return {
    trajectory_id: id,
    created_at: "2026-10-31T00:00:00.000Z",
    task_intent: "repair failed build",
    task_type: "coding/repair",
    context_fingerprint: ["typescript", "build"],
    steps: [
      { action: "tool.call", input: { command: "pnpm test" }, output: { ok: outcome === "success" }, timestamp: "2026-10-31T00:00:01.000Z" },
      { action: "tool.result", input: {}, output: { ok: outcome === "success" }, timestamp: "2026-10-31T00:00:02.000Z" },
    ],
    outcome,
    error_signature: outcome === "failure" ? "TypeError::build_failed::typescript" : null,
    cost: { tokens: 20, duration_seconds: 2, retries: 0 },
    distilled: false,
    distilled_into: [],
    expires_at: null,
    metadata: {},
    ...overrides,
  };
}

function principle(overrides: Partial<Principle> = {}): Principle {
  return {
    principle_id: "principle-existing",
    created_at: "2026-10-31T00:00:00.000Z",
    updated_at: "2026-10-31T00:00:00.000Z",
    title: "Run focused tests",
    condition: "When repairing a TypeScript build",
    action: "Run the focused test before changing production code",
    reason: "It preserves the failing signal",
    full_content: "When repairing a TypeScript build, run the focused test before changing production code because it preserves the failing signal.",
    task_types: ["coding/repair"],
    context_tags: ["typescript"],
    embedding: null,
    source_trajectories: ["failure-1", "success-1"],
    created_by: "agent",
    status: "active",
    retrieval_count: 0,
    adoption_count: 0,
    post_adoption_success: 0,
    criticality: "medium",
    pinned: false,
    metadata: {},
    ...overrides,
  };
}

describe("SEKB delta playbook", () => {
  it("pairs same-task success and failure into a deterministic advisory update", () => {
    const report = extractSekbDeltaPlaybook({
      trajectories: [trajectory("failure-1", "failure"), trajectory("success-1", "success")],
      existingPrinciples: [principle()],
      actor,
      now: () => new Date("2026-10-31T01:00:00.000Z"),
    });
    expect(report.driven_by).toBe("agent");
    expect(report.actor).toBe(actor);
    expect(report.promotionReady).toBe(false);
    expect(report.status).toBe("candidate");
    expect(report.pairs).toHaveLength(1);
    expect(report.candidates).toHaveLength(1);
    expect(report.candidates[0]).toMatchObject({
      decision: "no-op",
      action: "keep",
      taskType: "coding/repair",
      sourceTrajectoryIds: ["failure-1", "success-1"],
      evidence: { successIds: ["success-1"], failureIds: ["failure-1"] },
    });
    expect(report.candidates[0]?.version).toMatch(/^sekb-delta\/v1:/);
  });

  it("adds only an in-memory advisory candidate and never mutates existing principles", () => {
    const existing = [principle({ task_types: ["other/task"] })];
    const report = extractSekbDeltaPlaybook({
      trajectories: [trajectory("failure-1", "failure"), trajectory("success-1", "success")],
      existingPrinciples: existing,
      actor,
      now: () => new Date("2026-10-31T01:00:00.000Z"),
    });
    expect(report.candidates[0]?.decision).toBe("add");
    expect(report.candidates[0]?.action).toBe("create");
    expect(report.candidates).toHaveLength(1);
    expect(report.duplicateSourceCount).toBe(0);
  });

  it("fails closed for unpaired, cross-task and ambiguous evidence", () => {
    const report = extractSekbDeltaPlaybook({
      trajectories: [
        trajectory("failure-only", "failure"),
        trajectory("success-other", "success", { task_type: "other/task" }),
      ],
      existingPrinciples: [],
      actor,
    });
    expect(report.status).toBe("insufficient-evidence");
    expect(report.candidates).toHaveLength(0);
    expect(report.diagnostics.some((entry) => entry.code === "unpaired-task")).toBe(true);
  });

  it("rejects duplicate and unsafe payload evidence while preserving counters", () => {
    const duplicate = extractSekbDeltaPlaybook({
      trajectories: [trajectory("same", "failure"), trajectory("same", "success")],
      existingPrinciples: [],
      actor,
    });
    expect(duplicate.status).toBe("insufficient-evidence");
    expect(duplicate.diagnostics.some((entry) => entry.code === "duplicate-trajectory-id")).toBe(true);
    const unsafe = extractSekbDeltaPlaybook({
      trajectories: [
        trajectory("success-secret", "success", { task_intent: "use sk-secretvalue" }),
        trajectory("failure-secret", "failure"),
      ],
      existingPrinciples: [],
      actor,
    });
    expect(unsafe.candidates).toHaveLength(0);
    expect(unsafe.diagnostics.some((entry) => entry.code === "unsafe-trajectory-payload")).toBe(true);
  });

  it("reports structural comparison while keeping adoption benefit unavailable", () => {
    const complete = [trajectory("failure-1", "failure"), trajectory("success-1", "success")];
    const metrics = buildSekbDeltaComparison({ baseline: complete, delta: complete, actor });
    expect(metrics.status).toBe("measured-structure-only");
    expect(metrics.baseline.trajectoryCount).toBe(2);
    expect(metrics.delta.trajectoryCount).toBe(2);
    expect(metrics.delta.injectedTokenCount).toBeGreaterThanOrEqual(0);
    expect(metrics.adoptionSuccess).toEqual({ status: "unavailable", reason: "no-confirmed-adoption-outcomes" });
    expect(metrics.promotionReady).toBe(false);
    expect(buildSekbDeltaComparison({ baseline: [complete[0]], delta: [], actor }).status).toBe("insufficient-evidence");
  });
});

describe("SEKB delta playbook persistence boundary", () => {
  it("does not write candidate output before the existing explicit confirm path", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "openclaw-sekb-delta-test-"));
    tempRoots.push(root);
    const store = new KnowledgeStore({ database: { path: path.join(root, "openclaw.sqlite") } });
    const success = trajectory("success-db", "success");
    const failure = trajectory("failure-db", "failure");
    store.save_trajectory(success);
    store.save_trajectory(failure);
    const report = extractSekbDeltaPlaybook({ trajectories: [failure, success], existingPrinciples: [], actor });
    expect(report.candidates).toHaveLength(1);
    expect(store.query_principles({})).toHaveLength(0);
    const candidate = report.candidates[0]!;
    const distiller = new DistillationTool({ store, now: () => new Date("2026-10-31T01:00:00.000Z") });
    const principleId = distiller.confirm_and_save({
      cluster_summary: "delta-playbook-review",
      source_trajectory_ids: candidate.sourceTrajectoryIds,
      suggested_principle: {
        ...candidate.proposedPrinciple,
        criticality: "medium",
        metadata: { deltaVersion: candidate.version, counterexamples: candidate.evidence.counterexamples },
      },
      confidence: candidate.confidence,
    }, null, { drivenBy: "agent", actor });
    const stored = store.get_principle(principleId);
    expect(stored.created_by).toBe("agent");
    expect(stored.metadata).toMatchObject({ drivenBy: "agent", actor });
    expect(store.query_principles({})).toHaveLength(1);
    expect(approxTokenCount(store.get_index())).toBeLessThanOrEqual(2_000);
    store.record_adoption(principleId, { trigger: "outcome", taskSucceeded: true, taskType: "coding/repair" });
    expect(store.get_principle(principleId).post_adoption_success).toBe(1);
    closeOpenClawStateDatabaseForTest();
    for (const temp of tempRoots.splice(0)) rmSync(temp, { recursive: true, force: true });
  });
});
