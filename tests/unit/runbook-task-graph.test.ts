import { describe, expect, it } from "vitest";

import { BUILT_IN_ROLE_CONTRACTS } from "../../openclaw_runtime/src/agents/role-contract.js";
import { scheduleResourceAwareWaves } from "../../openclaw_runtime/src/agents/orchestration-resource-scheduler.js";
import { taskGraphVerifierNode } from "../../openclaw_runtime/src/agents/orchestration-protocol.js";
import { listRunbookTemplates, selectRunbookCandidates } from "../../openclaw_runtime/src/agents/runbook-registry.js";
import { buildTaskGraphFromRunbook } from "../../openclaw_runtime/src/agents/runbook-task-graph.js";

const knownRoleNames = new Set(BUILT_IN_ROLE_CONTRACTS.map((role) => role.name));

describe("runbook to task graph conversion", () => {
  it("creates a stable graph using existing RoleContract names only", () => {
    const runbook = listRunbookTemplates().find((template) => template.id === "feature-implementation");
    expect(runbook).toBeDefined();

    const result = buildTaskGraphFromRunbook({
      template: runbook!,
      task: "add account export feature",
      graphRunId: "runbook-feature-1",
      knownRoleNames: [...knownRoleNames],
    });

    expect(result.trace.selected).toMatchObject({
      runbookId: "feature-implementation",
      reasons: ["explicit-runbook-selected"],
    });
    expect(result.graph.graphRunId).toBe("runbook-feature-1");
    expect(result.graph.nodes.map((node) => node.taskNodeId)).toEqual([
      "feature-implementation-plan",
      "feature-implementation-implement",
      "feature-implementation-test",
      "feature-implementation-review",
    ]);
    expect(result.graph.nodes.every((node) => knownRoleNames.has(node.roleName))).toBe(true);
  });

  it("preserves skeleton dependencies and verifier boundary", () => {
    const selection = selectRunbookCandidates({
      task: "fix failing test suite after repeated failures",
      priorFailureCount: 2,
    });
    expect(selection.selected?.template.id).toBe("test-repair");

    const result = buildTaskGraphFromRunbook({
      template: selection.selected!.template,
      task: "fix failing test suite after repeated failures",
      graphRunId: "runbook-test-repair-1",
      knownRoleNames: [...knownRoleNames],
      selectionTrace: selection,
      includeHandoffEdges: true,
    });

    const verifier = taskGraphVerifierNode(result.graph);
    expect(verifier).toMatchObject({
      roleName: "reviewer",
      isVerifier: true,
      dependsOn: ["test-repair-verify"],
    });
    expect(result.graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: "test-repair-diagnose", to: "test-repair-repair", type: "dependency" }),
        expect.objectContaining({ from: "test-repair-diagnose", to: "test-repair-repair", type: "handoff" }),
        expect.objectContaining({ from: "test-repair-repair", to: "test-repair-verify", type: "handoff" }),
        expect.objectContaining({ from: "test-repair-verify", to: "test-repair-review", type: "verification" }),
      ]),
    );
    expect(result.graph.edges).not.toContainEqual(
      expect.objectContaining({ to: "test-repair-review", type: "handoff" }),
    );
    expect(result.trace.unselected.length).toBeGreaterThan(0);
  });

  it("can be scheduled by the P1 ResourceAwareWaveScheduler", () => {
    const runbook = listRunbookTemplates().find((template) => template.id === "security-check");
    expect(runbook).toBeDefined();

    const result = buildTaskGraphFromRunbook({
      template: runbook!,
      task: "review auth token permission changes",
      graphRunId: "runbook-security-1",
      knownRoleNames: [...knownRoleNames],
    });
    const schedule = scheduleResourceAwareWaves({
      graph: result.graph,
      roles: BUILT_IN_ROLE_CONTRACTS,
      options: { maxActiveRoles: 2 },
    });

    expect(schedule.skipped).toEqual([]);
    expect(schedule.metrics.scheduled).toBe(result.graph.nodes.length);
    expect(schedule.metrics.completed).toBe(0);
    expect(schedule.metrics.concurrencyCap).toBe(2);
    expect(schedule.waves.at(-1)?.roles).toContain("skeptic");
  });
});
