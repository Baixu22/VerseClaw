import { createHash } from "node:crypto";
import { approxTokenCount, normalizeTags, type Principle, type Trajectory } from "./types.js";

const MAX_INPUT_TRAJECTORIES = 200;
const UNSAFE_PATTERN = /(?:sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._-]{24,})/u;

export const SEKB_DELTA_PLAYBOOK_SCHEMA = "sekb-delta-playbook.v1" as const;
export const SEKB_DELTA_COMPARISON_SCHEMA = "sekb-delta-comparison.v1" as const;

export type SekbDeltaDiagnostic = {
  code: string;
  message: string;
  trajectoryIds: string[];
};

export type SekbDeltaPair = {
  pairId: string;
  taskType: string;
  successId: string;
  failureId: string;
  sharedContext: string[];
  errorSignature: string | null;
};

export type SekbDeltaCandidate = {
  deltaId: string;
  version: string;
  taskType: string;
  decision: "add" | "revise" | "reject-merge" | "no-op";
  action: "create" | "update" | "reject" | "keep";
  targetPrincipleId: string | null;
  sourceTrajectoryIds: string[];
  evidence: {
    successIds: string[];
    failureIds: string[];
    sharedContext: string[];
    errorSignatures: string[];
    counterexamples: string[];
  };
  proposedPrinciple: {
    title: string;
    condition: string;
    action: string;
    reason: string;
    task_types: string[];
    context_tags: string[];
  };
  conflicts: string[];
  confidence: number;
  promotionReady: false;
  advisoryOnly: true;
};

export type SekbDeltaPlaybookReport = {
  schema: typeof SEKB_DELTA_PLAYBOOK_SCHEMA;
  generatedAt: string;
  driven_by: "agent";
  actor: string;
  status: "candidate" | "insufficient-evidence";
  promotionReady: false;
  realHuman: false;
  pairs: SekbDeltaPair[];
  candidates: SekbDeltaCandidate[];
  diagnostics: SekbDeltaDiagnostic[];
  duplicateSourceCount: number;
  extraction: {
    inputTrajectoryCount: number;
    eligibleTrajectoryCount: number;
    pairedTaskTypeCount: number;
    counterexamplesPreserved: boolean;
  };
};

export type ExtractSekbDeltaPlaybookOptions = {
  trajectories: readonly Trajectory[];
  existingPrinciples?: readonly Principle[];
  actor: string;
  now?: () => Date;
};

export type SekbDeltaComparisonInput = {
  baseline: readonly Trajectory[];
  delta: readonly Trajectory[];
  actor: string;
  minimumPairs?: number;
};

export type SekbDeltaComparisonReport = {
  schema: typeof SEKB_DELTA_COMPARISON_SCHEMA;
  driven_by: "agent";
  actor: string;
  status: "measured-structure-only" | "insufficient-evidence";
  promotionReady: false;
  minimumPairs: number;
  baseline: { trajectoryCount: number; pairedTaskTypeCount: number; injectedTokenCount: number };
  delta: { trajectoryCount: number; pairedTaskTypeCount: number; injectedTokenCount: number };
  adoptionSuccess: { status: "unavailable"; reason: "no-confirmed-adoption-outcomes" };
  reasons: string[];
};

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);
}

function safeTrajectory(trajectory: Trajectory): boolean {
  return !UNSAFE_PATTERN.test(JSON.stringify({ task_intent: trajectory.task_intent, context_fingerprint: trajectory.context_fingerprint, steps: trajectory.steps, metadata: trajectory.metadata }));
}

function hasToolEvidence(trajectory: Trajectory): boolean {
  return trajectory.steps.some((step) => step.action === "tool.call" || step.action === "tool.result");
}

function eligible(trajectory: Trajectory): boolean {
  return Boolean(trajectory.task_type.trim()) && (trajectory.outcome === "success" || trajectory.outcome === "failure") && hasToolEvidence(trajectory);
}

function pairEvidence(
  taskType: string,
  outcomes: { successes: Trajectory[]; failures: Trajectory[] },
): { pairs: SekbDeltaPair[]; diagnostics: SekbDeltaDiagnostic[] } {
  const pairs: SekbDeltaPair[] = [];
  const diagnostics: SekbDeltaDiagnostic[] = [];
  const failures = outcomes.failures.toSorted((left, right) => left.trajectory_id.localeCompare(right.trajectory_id));
  for (const success of outcomes.successes.toSorted((left, right) => left.trajectory_id.localeCompare(right.trajectory_id))) {
    const match = failures.find((failure) => leftContextScore(success, failure) > 0);
    if (!match) {
      diagnostics.push({ code: "unpaired-task", message: `No same-context failure for success ${success.trajectory_id}`, trajectoryIds: [success.trajectory_id] });
      continue;
    }
    pairs.push({
      pairId: `pair-${digest([taskType, success.trajectory_id, match.trajectory_id]).slice(0, 16)}`,
      taskType,
      successId: success.trajectory_id,
      failureId: match.trajectory_id,
      sharedContext: normalizeTags(success.context_fingerprint.filter((tag) => match.context_fingerprint.includes(tag))),
      errorSignature: match.error_signature,
    });
  }
  return { pairs, diagnostics };
}

function leftContextScore(left: Trajectory, right: Trajectory): number {
  const tags = new Set(left.context_fingerprint.map((tag) => tag.trim().toLowerCase()));
  return right.context_fingerprint.filter((tag) => tags.has(tag.trim().toLowerCase())).length;
}

function pickExisting(candidateTaskType: string, context: readonly string[], existing: readonly Principle[]): Principle | null {
  const tags = new Set(context);
  return existing
    .filter((principle) => principle.status === "active" && principle.task_types.includes(candidateTaskType))
    .toSorted((left, right) =>
      right.context_tags.filter((tag) => tags.has(tag)).length - left.context_tags.filter((tag) => tags.has(tag)).length ||
      left.principle_id.localeCompare(right.principle_id),
    )[0] ?? null;
}

function decisionFor(existing: Principle | null, failureCount: number, sourceIds: readonly string[]): SekbDeltaCandidate["decision"] {
  if (!existing) return "add";
  if (sourceIds.every((id) => existing.source_trajectories.includes(id))) return "no-op";
  if (failureCount > 0 && existing.source_trajectories.length === 0) return "reject-merge";
  if (failureCount > 0) return "revise";
  return "no-op";
}
function actionFor(decision: SekbDeltaCandidate["decision"]): SekbDeltaCandidate["action"] {
  return decision === "add" ? "create" : decision === "revise" ? "update" : decision === "reject-merge" ? "reject" : "keep";
}

export function extractSekbDeltaPlaybook(options: ExtractSekbDeltaPlaybookOptions): SekbDeltaPlaybookReport {
  const now = options.now ?? (() => new Date());
  const actor = options.actor?.trim();
  if (!actor) throw new Error("SEKB delta extraction requires a concrete actor");
  const diagnostics: SekbDeltaDiagnostic[] = [];
  const seen = new Set<string>();
  let duplicateSourceCount = 0;
  const trajectories = options.trajectories.slice(0, MAX_INPUT_TRAJECTORIES).filter((trajectory) => {
    if (seen.has(trajectory.trajectory_id)) {
      duplicateSourceCount += 1;
      diagnostics.push({ code: "duplicate-trajectory-id", message: `Duplicate trajectory id ${trajectory.trajectory_id}`, trajectoryIds: [trajectory.trajectory_id] });
      return false;
    }
    seen.add(trajectory.trajectory_id);
    if (trajectory.outcome === "partial") {
      diagnostics.push({ code: "ambiguous-outcome", message: `Partial outcome is not paired as success or failure: ${trajectory.trajectory_id}`, trajectoryIds: [trajectory.trajectory_id] });
      return false;
    }
    if (!safeTrajectory(trajectory)) {
      diagnostics.push({ code: "unsafe-trajectory-payload", message: `Credential-like payload rejected for ${trajectory.trajectory_id}`, trajectoryIds: [trajectory.trajectory_id] });
      return false;
    }
    return eligible(trajectory);
  });
  const byTaskType = new Map<string, { successes: Trajectory[]; failures: Trajectory[] }>();
  for (const trajectory of trajectories) {
    const group = byTaskType.get(trajectory.task_type) ?? { successes: [], failures: [] };
    if (trajectory.outcome === "success") group.successes.push(trajectory);
    else group.failures.push(trajectory);
    byTaskType.set(trajectory.task_type, group);
  }
  const pairs: SekbDeltaPair[] = [];
  for (const [taskType, group] of [...byTaskType].toSorted(([left], [right]) => left.localeCompare(right))) {
    const result = pairEvidence(taskType, group);
    pairs.push(...result.pairs);
    diagnostics.push(...result.diagnostics);
    if (group.successes.length > 0 && group.failures.length === 0) {
      diagnostics.push({ code: "cross-task-pair", message: `Task type ${taskType} has no eligible same-task failure`, trajectoryIds: group.successes.map((entry) => entry.trajectory_id) });
    }
  }
  const paired = new Set(pairs.map((pair) => pair.taskType));
  const candidates: SekbDeltaCandidate[] = [];
  for (const pair of pairs) {
    const success = trajectories.find((entry) => entry.trajectory_id === pair.successId)!;
    const failure = trajectories.find((entry) => entry.trajectory_id === pair.failureId)!;
    const existing = pickExisting(pair.taskType, pair.sharedContext, options.existingPrinciples ?? []);
    const sourceIds = [pair.failureId, pair.successId].toSorted();
    const decision = decisionFor(existing, 1, sourceIds);
    const proposed = {
      title: success.task_intent.slice(0, 120),
      condition: `When handling ${pair.taskType} tasks with ${pair.sharedContext.join(", ") || "matching context"}`,
      action: "Compare the successful tool outcome with the failed trajectory before choosing the next command",
      reason: `Failure ${failure.trajectory_id} produced ${failure.error_signature ?? "an unclassified error"} while ${success.trajectory_id} completed with the same task type`,
      task_types: [pair.taskType],
      context_tags: pair.sharedContext,
    };
    candidates.push({
      deltaId: `delta-${digest([pair, decision, existing?.principle_id ?? null]).slice(0, 20)}`,
      version: `sekb-delta/v1:${digest([pair, proposed, decision]).slice(0, 16)}`,
      taskType: pair.taskType,
      decision,
      action: actionFor(decision),
      targetPrincipleId: existing?.principle_id ?? null,
      sourceTrajectoryIds: sourceIds,
      evidence: {
        successIds: [pair.successId],
        failureIds: [pair.failureId],
        sharedContext: pair.sharedContext,
        errorSignatures: pair.errorSignature ? [pair.errorSignature] : [],
        counterexamples: [pair.failureId],
      },
      proposedPrinciple: proposed,
      conflicts: existing ? [`existing-principle:${existing.principle_id}`] : [],
      confidence: Math.min(0.85, 0.45 + pair.sharedContext.length * 0.1),
      promotionReady: false,
      advisoryOnly: true,
    });
  }
  const fatal = diagnostics.some((entry) => entry.code === "duplicate-trajectory-id" || entry.code === "unsafe-trajectory-payload");
  return {
    schema: SEKB_DELTA_PLAYBOOK_SCHEMA,
    generatedAt: now().toISOString(),
    driven_by: "agent",
    actor,
    status: !fatal && candidates.length > 0 ? "candidate" : "insufficient-evidence",
    promotionReady: false,
    realHuman: false,
    pairs,
    candidates,
    diagnostics,
    duplicateSourceCount,
    extraction: {
      inputTrajectoryCount: options.trajectories.length,
      eligibleTrajectoryCount: trajectories.length,
      pairedTaskTypeCount: paired.size,
      counterexamplesPreserved: pairs.every((pair) => trajectories.some((entry) => entry.trajectory_id === pair.failureId)),
    },
  };
}

function taskPairCount(trajectories: readonly Trajectory[]): number {
  const grouped = new Map<string, Set<string>>();
  for (const trajectory of trajectories) {
    if (trajectory.outcome !== "success" && trajectory.outcome !== "failure") continue;
    const values = grouped.get(trajectory.task_type) ?? new Set<string>();
    values.add(trajectory.outcome);
    grouped.set(trajectory.task_type, values);
  }
  return [...grouped.values()].filter((values) => values.has("success") && values.has("failure")).length;
}

function structureMetrics(trajectories: readonly Trajectory[]): SekbDeltaComparisonReport["baseline"] {
  return {
    trajectoryCount: trajectories.length,
    pairedTaskTypeCount: taskPairCount(trajectories),
    injectedTokenCount: approxTokenCount(JSON.stringify(trajectories.map((trajectory) => ({ id: trajectory.trajectory_id, taskType: trajectory.task_type, outcome: trajectory.outcome })))),
  };
}

export function buildSekbDeltaComparison(input: SekbDeltaComparisonInput): SekbDeltaComparisonReport {
  const actor = input.actor?.trim();
  if (!actor) throw new Error("SEKB delta comparison requires a concrete actor");
  const minimumPairs = Math.max(1, input.minimumPairs ?? 1);
  const baseline = structureMetrics(input.baseline);
  const delta = structureMetrics(input.delta);
  const reasons: string[] = [];
  if (baseline.pairedTaskTypeCount < minimumPairs) reasons.push("baseline-paired-task-floor");
  if (delta.pairedTaskTypeCount < minimumPairs) reasons.push("delta-paired-task-floor");
  return {
    schema: SEKB_DELTA_COMPARISON_SCHEMA,
    driven_by: "agent",
    actor,
    status: reasons.length === 0 ? "measured-structure-only" : "insufficient-evidence",
    promotionReady: false,
    minimumPairs,
    baseline,
    delta,
    adoptionSuccess: { status: "unavailable", reason: "no-confirmed-adoption-outcomes" },
    reasons,
  };
}
