import { describe, expect, it } from "vitest";
import {
  buildHandoffArtifactPrompt,
  resolveHandoffArtifactsPilotMode,
  DEFAULT_HANDOFF_ARTIFACTS_PILOT_MODE,
} from "../../openclaw_runtime/src/agents/handoff-artifacts";
import type { OrchestratorPlan } from "../../openclaw_runtime/src/agents/orchestrator";
import type { OrchestrationTaskNode } from "../../openclaw_runtime/src/agents/orchestration-protocol";
import type { RoleContract } from "../../openclaw_runtime/src/agents/role-contract";

function makeNode(overrides: Partial<OrchestrationTaskNode> = {}): OrchestrationTaskNode {
  return {
    taskNodeId: "node-b",
    roleName: "tester",
    task: "verify the implementation",
    phase: "verification",
    dependsOn: [],
    scope: "verification scope",
    requiredCapabilities: [],
    attemptPolicy: { maxRepairAttempts: 1, maxRedoAttempts: 1 },
    status: "planned",
    ...overrides,
  };
}

function makePlan(overrides: Partial<OrchestratorPlan> = {}): OrchestratorPlan {
  return {
    mode: "lead-workers",
    leadRole: "implementer",
    workers: [],
    reasons: [],
    routeDiagnostics: {
      difficulty: "moderate",
      confidence: 0.7,
      reasons: [],
      selectedRoles: [],
      rejectedRoles: [],
      requiredCapabilities: [],
      capabilityGaps: [],
    },
    taskGraph: {
      graphRunId: "graph-1",
      mode: "flat",
      status: "planned",
      nodes: [],
      edges: [],
    },
    graphStatus: "planned",
    executionWaves: [],
    capabilityGaps: [],
    estimatedRepairPolicy: { maxRepairAttempts: 1, maxRedoAttempts: 1, maxFollowupRuns: 1 },
    ...overrides,
  };
}

function makeRole(overrides: Partial<RoleContract> = {}): RoleContract {
  return {
    name: "implementer",
    displayName: "Implementer",
    rolePrompt: "Implement the task",
    tools: [],
    permissions: { filesystem: "read-write", network: "none" },
    tags: [],
    effort: "medium",
    outputSchema: { format: "markdown", sections: ["Changes", "Verification"] },
    ...overrides,
  } as RoleContract;
}

describe("handoff-artifacts (Area 3 §3.4)", () => {
  describe("resolveHandoffArtifactsPilotMode", () => {
    it("returns 'off' for undefined input", () => {
      expect(resolveHandoffArtifactsPilotMode(undefined)).toBe(DEFAULT_HANDOFF_ARTIFACTS_PILOT_MODE);
      expect(resolveHandoffArtifactsPilotMode("off")).toBe("off");
    });

    it("returns 'off' for non-record input", () => {
      expect(resolveHandoffArtifactsPilotMode("on")).toBe("off");
      expect(resolveHandoffArtifactsPilotMode(42)).toBe("off");
      expect(resolveHandoffArtifactsPilotMode(null)).toBe("off");
      expect(resolveHandoffArtifactsPilotMode([])).toBe("off");
    });

    it("reads runtime.orchestration.handoffArtifacts = 'on'", () => {
      const cfg = { runtime: { orchestration: { handoffArtifacts: "on" } } };
      expect(resolveHandoffArtifactsPilotMode(cfg)).toBe("on");
    });

    it("falls back to 'off' for unknown pilot values", () => {
      const cfg = { runtime: { orchestration: { handoffArtifacts: "experimental" } } };
      expect(resolveHandoffArtifactsPilotMode(cfg)).toBe("off");
    });

    it("falls back to 'off' when orchestration block is missing", () => {
      const cfg = { runtime: { features: { foo: true } } };
      expect(resolveHandoffArtifactsPilotMode(cfg)).toBe("off");
    });

    it("falls back to 'off' when runtime block is missing", () => {
      const cfg = { agents: { defaults: {} } };
      expect(resolveHandoffArtifactsPilotMode(cfg)).toBe("off");
    });

    it("DEFAULT_HANDOFF_ARTIFACTS_PILOT_MODE is 'off' (default-off)", () => {
      expect(DEFAULT_HANDOFF_ARTIFACTS_PILOT_MODE).toBe("off");
    });
  });

  describe("buildHandoffArtifactPrompt", () => {
    it("returns undefined when node is undefined", () => {
      const plan = makePlan();
      const result = buildHandoffArtifactPrompt({
        node: undefined,
        plan,
        resolveRole: () => undefined,
      });
      expect(result).toBeUndefined();
    });

    it("returns undefined when node has no taskNodeId", () => {
      const plan = makePlan();
      const node = makeNode({ taskNodeId: undefined as unknown as string });
      const result = buildHandoffArtifactPrompt({
        node,
        plan,
        resolveRole: () => undefined,
      });
      expect(result).toBeUndefined();
    });

    it("returns undefined when no edges point to this node", () => {
      const node = makeNode({ taskNodeId: "node-b" });
      const plan = makePlan({
        taskGraph: {
          graphRunId: "g1",
          mode: "flat",
          status: "planned",
          nodes: [node],
          edges: [],
        },
      });
      const result = buildHandoffArtifactPrompt({
        node,
        plan,
        resolveRole: () => makeRole(),
      });
      expect(result).toBeUndefined();
    });

    it("returns undefined when only non-handoff edges point to this node", () => {
      // dependency edges should NOT trigger handoff injection — only `handoff` type.
      const nodeB = makeNode({ taskNodeId: "node-b" });
      const nodeA = makeNode({ taskNodeId: "node-a", roleName: "implementer" });
      const plan = makePlan({
        taskGraph: {
          graphRunId: "g1",
          mode: "flat",
          status: "planned",
          nodes: [nodeA, nodeB],
          edges: [{ from: "node-a", to: "node-b", type: "dependency" }],
        },
      });
      const result = buildHandoffArtifactPrompt({
        node: nodeB,
        plan,
        resolveRole: () => makeRole(),
      });
      expect(result).toBeUndefined();
    });

    it("returns prompt with predecessor sections when a handoff edge exists", () => {
      const nodeB = makeNode({ taskNodeId: "node-b", roleName: "tester" });
      const nodeA = makeNode({ taskNodeId: "node-a", roleName: "implementer" });
      const plan = makePlan({
        taskGraph: {
          graphRunId: "g1",
          mode: "flat",
          status: "planned",
          nodes: [nodeA, nodeB],
          edges: [{ from: "node-a", to: "node-b", type: "handoff" }],
        },
      });
      const result = buildHandoffArtifactPrompt({
        node: nodeB,
        plan,
        resolveRole: (name) => name === "implementer"
          ? makeRole({ name: "implementer", outputSchema: { format: "markdown", sections: ["Changes", "Verification"] } })
          : undefined,
      });
      expect(result).toBeDefined();
      expect(result).toContain("## Handoff Context");
      expect(result).toContain("From implementer: Changes, Verification");
    });

    it("includes multiple predecessors when multiple handoff edges exist", () => {
      const nodeC = makeNode({ taskNodeId: "node-c", roleName: "reviewer" });
      const nodeA = makeNode({ taskNodeId: "node-a", roleName: "implementer" });
      const nodeB = makeNode({ taskNodeId: "node-b", roleName: "architect" });
      const plan = makePlan({
        taskGraph: {
          graphRunId: "g1",
          mode: "flat",
          status: "planned",
          nodes: [nodeA, nodeB, nodeC],
          edges: [
            { from: "node-a", to: "node-c", type: "handoff" },
            { from: "node-b", to: "node-c", type: "handoff" },
          ],
        },
      });
      const result = buildHandoffArtifactPrompt({
        node: nodeC,
        plan,
        resolveRole: (name) => {
          if (name === "implementer") return makeRole({ name, outputSchema: { format: "markdown", sections: ["Changes"] } });
          if (name === "architect") return makeRole({ name, outputSchema: { format: "markdown", sections: ["Design", "Tradeoffs"] } });
          return undefined;
        },
      });
      expect(result).toBeDefined();
      expect(result).toContain("From implementer: Changes");
      expect(result).toContain("From architect: Design, Tradeoffs");
    });

    it("skips predecessors whose role contract cannot be resolved", () => {
      const nodeB = makeNode({ taskNodeId: "node-b", roleName: "tester" });
      const nodeA = makeNode({ taskNodeId: "node-a", roleName: "unknown-role" });
      const plan = makePlan({
        taskGraph: {
          graphRunId: "g1",
          mode: "flat",
          status: "planned",
          nodes: [nodeA, nodeB],
          edges: [{ from: "node-a", to: "node-b", type: "handoff" }],
        },
      });
      const result = buildHandoffArtifactPrompt({
        node: nodeB,
        plan,
        resolveRole: () => undefined,
      });
      expect(result).toBeUndefined();
    });

    it("skips predecessors whose role has no outputSchema.sections", () => {
      const nodeB = makeNode({ taskNodeId: "node-b", roleName: "tester" });
      const nodeA = makeNode({ taskNodeId: "node-a", roleName: "implementer" });
      const plan = makePlan({
        taskGraph: {
          graphRunId: "g1",
          mode: "flat",
          status: "planned",
          nodes: [nodeA, nodeB],
          edges: [{ from: "node-a", to: "node-b", type: "handoff" }],
        },
      });
      const result = buildHandoffArtifactPrompt({
        node: nodeB,
        plan,
        resolveRole: (name) => name === "implementer"
          ? makeRole({ name, outputSchema: { format: "markdown", sections: [] } })
          : undefined,
      });
      expect(result).toBeUndefined();
    });

    it("skips edges whose predecessor node is missing from the graph", () => {
      // Edge references a `from` node that doesn't exist in taskGraph.nodes
      // (corrupt graph or post-compaction drift). Should not throw.
      const nodeB = makeNode({ taskNodeId: "node-b", roleName: "tester" });
      const plan = makePlan({
        taskGraph: {
          graphRunId: "g1",
          mode: "flat",
          status: "planned",
          nodes: [nodeB],
          edges: [{ from: "node-ghost", to: "node-b", type: "handoff" }],
        },
      });
      const result = buildHandoffArtifactPrompt({
        node: nodeB,
        plan,
        resolveRole: () => makeRole(),
      });
      expect(result).toBeUndefined();
    });

    it("only matches edges where `to` equals this node's taskNodeId", () => {
      // An edge node-a → node-c (handoff) should not affect node-b's prompt.
      const nodeB = makeNode({ taskNodeId: "node-b", roleName: "tester" });
      const nodeA = makeNode({ taskNodeId: "node-a", roleName: "implementer" });
      const nodeC = makeNode({ taskNodeId: "node-c", roleName: "reviewer" });
      const plan = makePlan({
        taskGraph: {
          graphRunId: "g1",
          mode: "flat",
          status: "planned",
          nodes: [nodeA, nodeB, nodeC],
          edges: [{ from: "node-a", to: "node-c", type: "handoff" }],
        },
      });
      const result = buildHandoffArtifactPrompt({
        node: nodeB,
        plan,
        resolveRole: () => makeRole(),
      });
      expect(result).toBeUndefined();
    });

    it("prompt contains the §3.4 header and guidance text", () => {
      const nodeB = makeNode({ taskNodeId: "node-b", roleName: "tester" });
      const nodeA = makeNode({ taskNodeId: "node-a", roleName: "implementer" });
      const plan = makePlan({
        taskGraph: {
          graphRunId: "g1",
          mode: "flat",
          status: "planned",
          nodes: [nodeA, nodeB],
          edges: [{ from: "node-a", to: "node-b", type: "handoff" }],
        },
      });
      const result = buildHandoffArtifactPrompt({
        node: nodeB,
        plan,
        resolveRole: () => makeRole({ outputSchema: { format: "markdown", sections: ["Changes"] } }),
      });
      expect(result).toContain("## Handoff Context (Area 3 §3.4)");
      expect(result).toContain("Treat their output as evidence");
      expect(result).toContain("Do not block waiting for their output");
    });
  });
});
