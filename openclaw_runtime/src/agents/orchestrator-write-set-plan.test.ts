import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { codingObservability } from "../context-engine/coding-observability.js";
import { createOrchestratorPlan } from "./orchestrator.js";
import { BUILT_IN_ROLE_CONTRACTS } from "./role-contract.js";

describe("createOrchestratorPlan writeSet fill (C3 live)", () => {
  beforeEach(() => codingObservability.reset());
  afterEach(() => codingObservability.reset());

  it("fills implementer writeSet from fileHints and leaves reviewers empty", () => {
    const plan = createOrchestratorPlan({
      task: "implement feature across modules",
      fileHints: ["src/a.ts", "src/b.ts"],
      roles: BUILT_IN_ROLE_CONTRACTS,
      workers: [
        { roleName: "implementer", task: "edit a/b" },
        { roleName: "reviewer", task: "review changes" },
      ],
    });
    const byRole = new Map(plan.taskGraph.nodes.map((n) => [n.roleName, n]));
    expect(byRole.get("implementer")?.writeSet).toEqual(["src/a.ts", "src/b.ts"]);
    expect(byRole.get("reviewer")?.writeSet).toBeUndefined();
    expect(plan.workers.find((w) => w.roleName === "implementer")?.writeSet).toEqual([
      "src/a.ts",
      "src/b.ts",
    ]);
    const snap = codingObservability.snapshot();
    expect(snap.writeSetNodesPopulated).toBeGreaterThanOrEqual(1);
    expect(codingObservability.rates().writeSetCoverageRate).toBeGreaterThan(0);
  });

  it("keeps explicit worker writeSet over fileHints", () => {
    const plan = createOrchestratorPlan({
      task: "targeted edit",
      fileHints: ["src/hint.ts"],
      roles: BUILT_IN_ROLE_CONTRACTS,
      workers: [
        { roleName: "implementer", task: "edit explicit", writeSet: ["src/explicit.ts"] },
      ],
    });
    expect(plan.taskGraph.nodes[0]?.writeSet).toEqual(["src/explicit.ts"]);
  });

  it("leaves writeSet empty when no hints (coverage 0 for empty graph workers)", () => {
    const plan = createOrchestratorPlan({
      task: "implement without scope",
      roles: BUILT_IN_ROLE_CONTRACTS,
      workers: [
        { roleName: "implementer", task: "edit unknown files" },
        { roleName: "implementer", task: "edit more unknown" },
      ],
    });
    expect(plan.taskGraph.nodes.every((n) => n.writeSet === undefined)).toBe(true);
    const snap = codingObservability.snapshot();
    expect(snap.writeSetNodesPopulated).toBe(0);
    expect(snap.writeSetNodesTotal).toBeGreaterThan(0);
    expect(codingObservability.rates().writeSetCoverageRate).toBe(0);
  });
});