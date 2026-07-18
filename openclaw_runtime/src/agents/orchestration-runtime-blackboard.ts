import {
  appendBlackboardEntry,
  createBlackboardState,
  detectBlackboardConflicts,
  type BlackboardState,
} from "./orchestration-blackboard.js";
import type { BlackboardTraceEvent } from "./orchestration-blackboard-trace.js";
import type { OrchestrationResultBundle } from "./orchestration-result-bundle.js";
import type { BlackboardSynthesisSummary } from "./orchestration-synthesizer.js";

export type RuntimeBlackboardFailure = { roleName: string; status: string; error?: string };

export type RuntimeBlackboardInput = {
  resultBundle: OrchestrationResultBundle;
  failures: readonly RuntimeBlackboardFailure[];
  knownRoleNames: readonly string[];
  now: string;
};

export type RuntimeBlackboardProjection = {
  state: BlackboardState;
  summary: BlackboardSynthesisSummary;
  traceEvents: BlackboardTraceEvent[];
};

function blackboardId(...parts: string[]): string {
  return parts
    .join("_")
    .toLowerCase()
    .replace(/[^a-z0-9_:-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "") || "bb_entry";
}

function summaryFromState(state: BlackboardState): BlackboardSynthesisSummary {
  const visibleEntries = state.entries.filter((entry) => entry.status !== "rejected" && entry.status !== "superseded");
  return {
    entryCount: visibleEntries.length,
    unresolvedConflicts: visibleEntries.filter((entry) => entry.type === "conflict" && entry.status === "open").length,
    openQuestions: visibleEntries.filter((entry) => entry.type === "question" && entry.status === "open").length,
    openRisks: visibleEntries.filter((entry) => entry.type === "risk" && entry.status === "open").length,
    memoryProposals: visibleEntries.filter((entry) => entry.type === "memory_proposal").length,
    evidenceRefs: [...new Set(visibleEntries.flatMap((entry) => entry.evidenceRefs))],
    trustBoundaries: [...new Set(visibleEntries.map((entry) => entry.trustBoundary))].sort(),
  };
}

export function buildRuntimeBlackboard(input: RuntimeBlackboardInput): RuntimeBlackboardProjection {
  let state = createBlackboardState();
  const traceEvents: BlackboardTraceEvent[] = [];
  const knownRoles = [...new Set([...input.knownRoleNames, ...input.resultBundle.selectedRoles, input.resultBundle.leadRole])];

  for (const artifact of input.resultBundle.handoffArtifacts) {
    const appended = appendBlackboardEntry(
      state,
      artifact.state === "ready"
        ? {
            id: blackboardId("bb", artifact.artifactId),
            type: "handoff",
            authorRole: artifact.fromRole,
            taskId: artifact.toTaskId,
            content: {
              fromRole: artifact.fromRole,
              toRole: artifact.toRole,
              summary: `Bounded predecessor output captured for ${artifact.toTaskId}.`,
              artifactId: artifact.artifactId,
              fromTaskId: artifact.fromTaskId,
              toTaskId: artifact.toTaskId,
              childRunId: artifact.childRunId,
              childSessionKey: artifact.childSessionKey,
              attempt: artifact.attempt,
              outputSha256: artifact.outputSha256,
              redacted: artifact.redacted,
              truncated: artifact.truncated,
              outputPreview: artifact.outputText.slice(0, 240),
            },
            confidence: 0.9,
            evidenceRefs: [artifact.artifactId, artifact.childRunId],
            visibility: "role",
            status: "resolved",
            trustBoundary: "role-output",
          }
        : {
            id: blackboardId("bb", artifact.artifactId, "rejected"),
            type: "risk",
            authorRole: artifact.fromRole,
            taskId: artifact.toTaskId,
            content: {
              subject: "handoff output rejected",
              artifactId: artifact.artifactId,
              fromRole: artifact.fromRole,
              toRole: artifact.toRole,
              fromTaskId: artifact.fromTaskId,
              toTaskId: artifact.toTaskId,
              childRunId: artifact.childRunId,
              childSessionKey: artifact.childSessionKey,
              attempt: artifact.attempt,
              reason: artifact.reason,
            },
            confidence: 0.95,
            evidenceRefs: [artifact.artifactId, artifact.childRunId],
            visibility: "verifier",
            status: "open",
            trustBoundary: "role-output",
          },
      knownRoles,
      input.now,
    );
    state = appended.state;
    if (appended.entry) {
      traceEvents.push({
        sequence: traceEvents.length + 1,
        kind: "append",
        occurredAt: input.now,
        entry: appended.entry,
      });
    }
  }

  for (const outcome of input.resultBundle.roleOutcomes) {
    const evidenceRefs = outcome.evidenceRefs.map((ref) => ref.ref);
    const appended = appendBlackboardEntry(
      state,
      {
        id: blackboardId("bb", input.resultBundle.orchestrationRunId, outcome.roleName, outcome.taskId ?? outcome.childRunId ?? outcome.task),
        type: "claim",
        authorRole: outcome.roleName,
        taskId: outcome.taskId ?? outcome.childRunId ?? outcome.task,
        content: {
          subject: outcome.task,
          conclusion: outcome.status,
          phase: outcome.phase,
          ...(outcome.outputText ? { outputPreview: outcome.outputText.trim().slice(0, 240) } : {}),
        },
        confidence: outcome.status === "completed" ? 0.8 : 0.45,
        evidenceRefs: evidenceRefs.length > 0 ? evidenceRefs : input.resultBundle.traceIds,
        visibility: "verifier",
        status: outcome.status === "completed" ? "resolved" : "needs_review",
        trustBoundary: "role-output",
      },
      knownRoles,
      input.now,
    );
    state = appended.state;
    if (appended.entry) {
      traceEvents.push({
        sequence: traceEvents.length + 1,
        kind: "append",
        occurredAt: input.now,
        entry: appended.entry,
      });
    }
  }

  for (const failure of input.failures) {
    const appended = appendBlackboardEntry(
      state,
      {
        id: blackboardId("bb", input.resultBundle.orchestrationRunId, failure.roleName, failure.status, failure.error ?? "failure"),
        type: "risk",
        authorRole: failure.roleName,
        taskId: failure.roleName,
        content: {
          subject: "orchestration spawn failure",
          status: failure.status,
          error: failure.error ?? failure.status,
        },
        confidence: 0.9,
        evidenceRefs: input.resultBundle.traceIds,
        visibility: "verifier",
        status: "open",
        trustBoundary: "role-output",
      },
      knownRoles,
      input.now,
    );
    state = appended.state;
    if (appended.entry) {
      traceEvents.push({
        sequence: traceEvents.length + 1,
        kind: "append",
        occurredAt: input.now,
        entry: appended.entry,
      });
    }
  }

  const conflictResult = detectBlackboardConflicts(state, knownRoles, input.now);
  state = conflictResult.state;
  for (const entry of conflictResult.conflicts) {
    traceEvents.push({
      sequence: traceEvents.length + 1,
      kind: "append",
      occurredAt: input.now,
      entry,
    });
  }

  return { state, summary: summaryFromState(state), traceEvents };
}
