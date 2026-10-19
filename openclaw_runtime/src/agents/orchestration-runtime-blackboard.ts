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
              outputPreview: buildSubagentReport({ outputText: artifact.outputText }).body,
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
    // Build the bounded report once; it is the single source for the preview,
    // the pre-truncation size, and the truncation flag.
    const report = outcome.outputText ? buildSubagentReport({ outputText: outcome.outputText }) : null;
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
          ...(report
            ? {
                outputPreview: report.body,
                outputOriginalChars: report.originalChars,
                outputTruncated: report.truncated,
              }
            : {}),
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

/**
 * TF-0448: bounded subagent report contract.
 *
 * Deep Agents frames a general-purpose subagent as existing "purely for
 * context isolation": it burns through intermediate reasoning and returns a
 * report, and everything in between is discarded. Verse Claw already had the
 * discard half — two call sites truncated to a magic 240 chars — but had no
 * named contract and no measurement, so nobody could see what a subagent
 * actually cost versus what it returned.
 *
 * This adds the missing half: a named, bounded report shape with a measurable
 * size. It is deliberately reporting-only. It does not alter orchestration,
 * does not grant the report any authority over Task Ledger facts, and does not
 * change what a verifier may decide.
 */

/** Hard cap on a single role report body. */
export const SUBAGENT_REPORT_MAX_CHARS = 2_000;

export type SubagentReport = {
  /** Bounded body. Never contains intermediate reasoning or tool narration. */
  body: string;
  /** Character count of the *untruncated* body, so truncation is observable. */
  originalChars: number;
  /** True when `body` was cut at SUBAGENT_REPORT_MAX_CHARS. */
  truncated: boolean;
  /** Failures the role itself surfaced, kept out of the body on purpose. */
  failures: string[];
};

/**
 * Build a bounded report from a role's raw output.
 *
 * Normalises whitespace first: a subagent that streams progress lines should
 * not be able to spend the whole budget on blank lines, and the reported
 * size should describe content rather than formatting.
 */
export function buildSubagentReport(input: {
  outputText?: string | null;
  failures?: readonly string[];
  maxChars?: number;
}): SubagentReport {
  const maxChars = Math.max(1, input.maxChars ?? SUBAGENT_REPORT_MAX_CHARS);
  const normalized = (input.outputText ?? "").replace(/\s+/g, " ").trim();
  const truncated = normalized.length > maxChars;
  return {
    body: truncated ? normalized.slice(0, maxChars) : normalized,
    originalChars: normalized.length,
    truncated,
    failures: [...(input.failures ?? [])],
  };
}
