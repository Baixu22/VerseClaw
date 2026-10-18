import { describe, expect, it } from "vitest";
import { createExternalProvenance } from "../../shared/security/content-provenance";
import {
  buildWorkerOutputHandoffArtifact,
  captureRuntimeWorkerOutputUsing,
  resolveHandoffArtifactPrompt,
  resolveHandoffArtifactRuntimeState,
  resolveHandoffArtifactsPilotMode,
  DEFAULT_HANDOFF_ARTIFACTS_PILOT_MODE,
  type CaptureRuntimeWorkerOutputInput,
  type HandoffArtifactIdentity,
  type WorkerOutputHandoffArtifact,
} from "../../openclaw_runtime/src/agents/handoff-artifacts";
import type { OrchestratorPlan } from "../../openclaw_runtime/src/agents/orchestrator";
import type { OrchestrationTaskNode } from "../../openclaw_runtime/src/agents/orchestration-protocol";
import type { SubagentRunRecord } from "../../openclaw_runtime/src/agents/subagent-registry.types";

function node(taskNodeId: string, roleName: string, dependsOn: string[] = []): OrchestrationTaskNode {
  return {
    taskNodeId,
    roleName,
    task: `${roleName} task`,
    phase: roleName === "planner" ? "plan" : "implementation",
    dependsOn,
    scope: `${roleName} scope`,
    requiredCapabilities: [],
    attemptPolicy: { maxRepairAttempts: 1, maxRedoAttempts: 1 },
    status: dependsOn.length > 0 ? "planned" : "ready",
  };
}

function plan(): OrchestratorPlan {
  const planner = node("planner-1", "planner");
  const implementer = node("implementer-1", "implementer", [planner.taskNodeId]);
  return {
    mode: "lead-workers",
    leadRole: "planner",
    workers: [],
    reasons: [],
    routeDiagnostics: {
      difficulty: "moderate",
      confidence: 0.7,
      reasons: [],
      selectedRoles: ["planner", "implementer"],
      rejectedRoles: [],
      requiredCapabilities: [],
      capabilityGaps: [],
    },
    taskGraph: {
      graphRunId: "graph-1",
      mode: "staged",
      status: "planned",
      nodes: [planner, implementer],
      edges: [
        { from: planner.taskNodeId, to: implementer.taskNodeId, type: "dependency" },
        { from: planner.taskNodeId, to: implementer.taskNodeId, type: "handoff" },
      ],
    },
    graphStatus: "planned",
    executionWaves: [],
    capabilityGaps: [],
    estimatedRepairPolicy: { maxRepairAttempts: 1, maxRedoAttempts: 1, maxFollowupRuns: 1 },
    isolation: "shared",
    verifierNoSelfRepair: true,
    complexityDecision: {} as OrchestratorPlan["complexityDecision"],
    runbookSelection: {} as OrchestratorPlan["runbookSelection"],
    qualityRouting: {} as OrchestratorPlan["qualityRouting"],
  };
}

function identity(overrides: Partial<HandoffArtifactIdentity> = {}): HandoffArtifactIdentity {
  return {
    orchestrationRunId: "orch-1",
    taskGraphId: "graph-1",
    ownerSessionKey: "agent:main:session-1",
    fromTaskId: "planner-1",
    fromRole: "planner",
    fromRoleInstanceId: "role-instance-1",
    toTaskId: "implementer-1",
    toRole: "implementer",
    attempt: 1,
    childRunId: "child-run-1",
    childSessionKey: "agent:planner:child-1",
    ...overrides,
  };
}

function readyArtifact(overrides: Partial<HandoffArtifactIdentity> = {}): WorkerOutputHandoffArtifact {
  return buildWorkerOutputHandoffArtifact({
    identity: identity(overrides),
    capture: {
      status: "captured",
      output: "## Plan\nUse the verified implementation path.",
      capturedAt: 20,
      source: "injected_test_capture",
    },
  });
}

function captureInput(overrides: Partial<CaptureRuntimeWorkerOutputInput> = {}): CaptureRuntimeWorkerOutputInput {
  return {
    orchestrationRunId: "orch-1",
    ownerSessionKey: "agent:main:session-1",
    fromTaskId: "planner-1",
    fromRole: "planner",
    attempt: 1,
    childRunId: "child-run-1",
    childSessionKey: "agent:planner:child-1",
    timeoutMs: 5_000,
    ...overrides,
  };
}

function registryRun(overrides: Partial<SubagentRunRecord> = {}): SubagentRunRecord {
  return {
    runId: "child-run-1",
    childSessionKey: "agent:planner:child-1",
    requesterSessionKey: "agent:main:session-1",
    requesterDisplayKey: "main",
    task: "plan",
    cleanup: "delete",
    createdAt: 1,
    endedAt: 20,
    outcome: { status: "ok" },
    completion: { required: true, resultText: "real registry output", capturedAt: 20 },
    orchestration: {
      orchestrationRunId: "orch-1",
      roleName: "planner",
      phase: "worker",
      taskId: "planner-1",
      taskNodeId: "planner-1",
      attempt: 1,
    } as never,
    ...overrides,
  };
}

describe("handoff artifacts", () => {
  it("stays default-off and only enables the explicit config value", () => {
    expect(DEFAULT_HANDOFF_ARTIFACTS_PILOT_MODE).toBe("off");
    expect(resolveHandoffArtifactsPilotMode(undefined)).toBe("off");
    expect(resolveHandoffArtifactsPilotMode({ runtime: { orchestration: { handoffArtifacts: "on" } } })).toBe("on");
    expect(resolveHandoffArtifactsPilotMode({ runtime: { orchestration: { handoffArtifacts: "shadow" } } })).toBe("off");
  });

  it("builds a provenance-bound artifact from real worker output", () => {
    const artifact = readyArtifact();
    expect(artifact).toMatchObject({
      state: "ready",
      orchestrationRunId: "orch-1",
      taskGraphId: "graph-1",
      ownerSessionKey: "agent:main:session-1",
      fromTaskId: "planner-1",
      toTaskId: "implementer-1",
      childRunId: "child-run-1",
      childSessionKey: "agent:planner:child-1",
      attempt: 1,
      source: "injected_test_capture",
    });
    if (artifact.state !== "ready") throw new Error("expected ready artifact");
    expect(artifact.outputText).toContain("verified implementation path");
    expect(artifact.outputSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(artifact.provenance).toMatchObject({
      sourceKind: "agent-handoff",
      trustLevel: "derived-untrusted",
      containsExternalUntrustedContent: true,
    });
  });

  it("keeps parent source IDs across the agent handoff boundary", () => {
    const artifact = buildWorkerOutputHandoffArtifact({
      identity: identity(),
      capture: {
        status: "captured",
        output: "derived worker result",
        capturedAt: 20,
        source: "injected_test_capture",
        provenance: {
          ...createExternalProvenance({
            sourceKind: "web",
            sourceId: "web:source-1",
            receivedAt: "2026-08-20T00:00:00.000Z",
          }),
          parentSourceIds: ["channel:source-0"],
        },
      },
    });
    expect(artifact.state).toBe("ready");
    if (artifact.state !== "ready") throw new Error("expected ready artifact");
    expect(artifact.provenance.parentSourceIds).toEqual([
      "web:source-1",
      "channel:source-0",
    ]);
    expect(artifact.provenance.trustLevel).toBe("derived-untrusted");
  });

  it("redacts secrets before hashing or delivery", () => {
    const secret = "sk-1234567890abcdefghijklmnop";
    const artifact = buildWorkerOutputHandoffArtifact({
      identity: identity(),
      capture: {
        status: "captured",
        output: `API_KEY=${secret}\nSafe finding`,
        capturedAt: 20,
        source: "injected_test_capture",
      },
    });
    expect(artifact.state).toBe("ready");
    if (artifact.state !== "ready") throw new Error("expected ready artifact");
    expect(artifact.redacted).toBe(true);
    expect(artifact.outputText).not.toContain(secret);
    expect(artifact.outputText).toContain("Safe finding");
  });

  it("truncates oversized output to the explicit bound", () => {
    const artifact = buildWorkerOutputHandoffArtifact({
      identity: identity(),
      capture: {
        status: "captured",
        output: "x".repeat(200),
        capturedAt: 20,
        source: "injected_test_capture",
      },
      maxChars: 32,
    });
    expect(artifact).toMatchObject({ state: "ready", originalChars: 200, deliveredChars: 32, truncated: true });
  });

  it.each([
    [42, "invalid-output-type"],
    [" \u0000 ", "empty-output-after-sanitization"],
  ])("rejects malformed output %#", (output, reason) => {
    expect(buildWorkerOutputHandoffArtifact({
      identity: identity(),
      capture: { status: "captured", output, capturedAt: 20, source: "injected_test_capture" },
    })).toMatchObject({ state: "rejected", reason });
  });

  it("captures only the matching terminal registry record", async () => {
    const result = await captureRuntimeWorkerOutputUsing(captureInput(), {
      waitForRun: async () => ({ status: "ok" }),
      getRunById: () => registryRun(),
    });
    expect(result).toEqual({
      status: "captured",
      output: "real registry output",
      capturedAt: 20,
      source: "subagent_registry_completion",
    });
  });

  it.each([
    ["run", captureInput({ orchestrationRunId: "orch-2" })],
    ["session", captureInput({ ownerSessionKey: "agent:main:session-2" })],
    ["task", captureInput({ fromTaskId: "planner-2" })],
    ["role", captureInput({ fromRole: "architect" })],
    ["attempt", captureInput({ attempt: 2 })],
    ["child session", captureInput({ childSessionKey: "agent:planner:child-2" })],
  ])("rejects cross-identity %s leakage", async (_field, input) => {
    const result = await captureRuntimeWorkerOutputUsing(input, {
      waitForRun: async () => ({ status: "ok" }),
      getRunById: () => registryRun(),
    });
    expect(result).toEqual({ status: "unavailable", reason: "identity-mismatch" });
  });

  it("does not accept a same-string taskId as the ledger taskNodeId", async () => {
    const result = await captureRuntimeWorkerOutputUsing(captureInput(), {
      waitForRun: async () => ({ status: "ok" }),
      getRunById: () => registryRun({
        orchestration: {
          orchestrationRunId: "orch-1",
          roleName: "planner",
          phase: "worker",
          taskId: "planner-1",
          attempt: 1,
        } as never,
      }),
    });
    expect(result).toEqual({ status: "unavailable", reason: "identity-mismatch" });
  });

  it("fails closed for wait, terminal-state, and missing-output failures", async () => {
    await expect(captureRuntimeWorkerOutputUsing(captureInput(), {
      waitForRun: async () => ({ status: "timeout" }),
      getRunById: () => registryRun(),
    })).resolves.toEqual({ status: "unavailable", reason: "wait-failed" });
    await expect(captureRuntimeWorkerOutputUsing(captureInput(), {
      waitForRun: async () => ({ status: "ok" }),
      getRunById: () => registryRun({ endedAt: undefined }),
    })).resolves.toEqual({ status: "unavailable", reason: "run-not-terminal" });
    await expect(captureRuntimeWorkerOutputUsing(captureInput(), {
      waitForRun: async () => ({ status: "ok" }),
      getRunById: () => registryRun({ completion: { required: true } }),
    })).resolves.toEqual({ status: "unavailable", reason: "missing-output" });
  });

  it("injects only the matching run and session artifact as untrusted evidence", () => {
    const currentPlan = plan();
    const target = currentPlan.taskGraph.nodes.find((entry) => entry.taskNodeId === "implementer-1");
    const result = resolveHandoffArtifactPrompt({
      node: target,
      plan: currentPlan,
      orchestrationRunId: "orch-1",
      ownerSessionKey: "agent:main:session-1",
      artifacts: [
        readyArtifact({ orchestrationRunId: "orch-old" }),
        readyArtifact({ ownerSessionKey: "agent:main:other-session" }),
        readyArtifact(),
      ],
    });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") throw new Error("expected ready prompt");
    expect(result.prompt).toContain("## Verified Handoff Context");
    expect(result.prompt).toContain("untrusted evidence");
    expect(result.prompt).toContain("verified implementation path");
    expect(result.prompt).toContain("run=child-run-1");
  });

  it("blocks the dependent worker when the artifact is missing or rejected", () => {
    const currentPlan = plan();
    const target = currentPlan.taskGraph.nodes.find((entry) => entry.taskNodeId === "implementer-1");
    const rejected = buildWorkerOutputHandoffArtifact({
      identity: identity(),
      capture: { status: "unavailable", reason: "identity-mismatch" },
    });
    expect(resolveHandoffArtifactPrompt({
      node: target,
      plan: currentPlan,
      orchestrationRunId: "orch-1",
      ownerSessionKey: "agent:main:session-1",
      artifacts: [],
    })).toMatchObject({ status: "blocked", missingFromTaskIds: ["planner-1"] });
    expect(resolveHandoffArtifactPrompt({
      node: target,
      plan: currentPlan,
      orchestrationRunId: "orch-1",
      ownerSessionKey: "agent:main:session-1",
      artifacts: [rejected],
    })).toMatchObject({ status: "blocked", missingFromTaskIds: ["planner-1"] });
  });

  it("reports disabled, idle, ready, and blocked runtime states", () => {
    expect(resolveHandoffArtifactRuntimeState({ mode: "off", artifacts: [] })).toBe("disabled");
    expect(resolveHandoffArtifactRuntimeState({ mode: "on", artifacts: [] })).toBe("idle");
    expect(resolveHandoffArtifactRuntimeState({ mode: "on", artifacts: [readyArtifact()] })).toBe("ready");
    expect(resolveHandoffArtifactRuntimeState({
      mode: "on",
      artifacts: [buildWorkerOutputHandoffArtifact({
        identity: identity(),
        capture: { status: "unavailable", reason: "missing-output" },
      })],
    })).toBe("blocked");
  });
});
