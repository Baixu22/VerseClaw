import { createHash, randomUUID } from "node:crypto";
import type { KnowledgeStore } from "./knowledge-store.js";
import { isSekbShadowMetadataV1 } from "./shadow-evaluator.js";
import {
  buildPrincipleFullContent,
  normalizeTags,
  type DistillationSuggestion,
  type Principle,
  type SekbBatchDistillationEvent,
  type SekbBatchDistillationFallbackReason,
  type Trajectory,
} from "./types.js";

export const SEKB_BATCH_DISTILLATION_TIMEOUT_MS = 30_000;
export const SEKB_BATCH_DISTILLATION_MAX_TRAJECTORIES = 20;
export const SEKB_BATCH_DISTILLATION_MAX_PRINCIPLES = 20;
export const SEKB_BATCH_DISTILLATION_MAX_SUGGESTIONS = 8;

type SekbBatchModelTrajectory = {
  trajectory_ref: string;
  task_type: string;
  context_tags: string[];
  outcome: "success" | "failure" | "partial";
  error_signature: string | null;
  step_counts: {
    total: number;
    tool_calls: number;
    tool_results: number;
    failed_tool_results: number;
  };
  shadow: {
    score: number;
    recommendation: "retain" | "review_low_signal";
    completion_status: "supported" | "partial" | "unsupported" | "unknown";
  } | null;
};

type SekbBatchModelPrincipleSummary = {
  principle_ref: string;
  task_types: string[];
  context_tags: string[];
  criticality: "low" | "medium" | "high" | "critical";
};

/** The complete provider payload is intentionally a bounded redacted projection. */
export type SekbBatchDistillationModelInput = {
  schema: "sekb-batch-distillation-input.v1";
  trajectories: SekbBatchModelTrajectory[];
  existing_principles: SekbBatchModelPrincipleSummary[];
};

export type SekbBatchDistillationProviderResponse = {
  content: string;
  traceId?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalCostUsd?: number;
  };
};

export type SekbBatchDistillationProvider = {
  suggest: (
    input: SekbBatchDistillationModelInput,
    options: { signal: AbortSignal; timeoutMs: number; traceId: string; attempt: 1 | 2 },
  ) => Promise<SekbBatchDistillationProviderResponse>;
};

export type SekbBatchDistillationSuggestion = DistillationSuggestion & {
  suggestion_id: string;
  title: string;
  condition: string;
  action: string;
  reason: string;
  related_principle_ids: string[];
  conflicts: Array<{ principle_id: string; reason: string }>;
  skipped_reason: string | null;
};

export type SekbBatchDistillationOperatorEvidence = {
  batchId: string | null;
  traceId: string | null;
  recorded: boolean;
  status: "disabled" | "assisted" | "fallback";
  fallbackReason: SekbBatchDistillationFallbackReason | null;
  attempts: number;
  retryAttempted: boolean;
  inputTokens: number | null;
  outputTokens: number | null;
  totalCostUsd: number | null;
  /** Count of requested trajectory IDs that were missing; never persists payloads. */
  skippedMissingTrajectoryIds: number;
};

export type SekbBatchDistillationResult = {
  suggestions: Array<DistillationSuggestion | SekbBatchDistillationSuggestion>;
  userVisibleStatus:
    | "ready"
    | "feature_disabled"
    | "provider_unavailable"
    | "timeout"
    | "invalid_response"
    | "request_limit"
    | "no_eligible_trajectories";
  operatorEvidence: SekbBatchDistillationOperatorEvidence;
};

export type SekbBatchDistillationAssistantOptions = {
  store: KnowledgeStore;
  /** Must be supplied by the explicit manual caller; there is no ambient model call. */
  provider?: SekbBatchDistillationProvider;
  /** Defaults false so creating this class never changes the deterministic path. */
  enabled?: boolean;
  fallback: (trajectoryIds: string[] | null, minClusterSize: number) => DistillationSuggestion[];
  now?: () => Date;
  onAttempt?: (event: { batchId: string; traceId: string; attempt: 1 | 2; timeoutMs: number }) => void;
};

export type SekbBatchDistillationRequest = {
  trajectoryIds?: string[] | null;
  minClusterSize?: number;
};

type ValidatedModelSuggestion = {
  title: string;
  condition: string;
  action: string;
  reason: string;
  source_trajectory_refs: string[];
  related_principle_refs: string[];
  conflicts: Array<{ principle_ref: string; reason: string }>;
  confidence: number;
  skipped_reason: string | null;
};

type UsageTotals = {
  inputTokens: number | null;
  outputTokens: number | null;
  totalCostUsd: number | null;
};

type BatchSuggestionProvenance = {
  batchId: string;
  suggestionId: string;
};

/**
 * Explicit, bounded Phase B assistant. It has no persistence authority except
 * for aggregate safe evidence about an invocation; all durable knowledge still
 * passes through DistillationTool.confirm_and_save.
 */
export class SekbBatchDistillationAssistant {
  readonly #store: KnowledgeStore;
  readonly #provider: SekbBatchDistillationProvider | undefined;
  readonly #enabled: boolean;
  readonly #fallback: SekbBatchDistillationAssistantOptions["fallback"];
  readonly #now: () => Date;
  readonly #onAttempt: SekbBatchDistillationAssistantOptions["onAttempt"];

  constructor(options: SekbBatchDistillationAssistantOptions) {
    this.#store = options.store;
    this.#provider = options.provider;
    this.#enabled = options.enabled === true;
    this.#fallback = options.fallback;
    this.#now = options.now ?? (() => new Date());
    this.#onAttempt = options.onAttempt;
  }

  async suggest(request: SekbBatchDistillationRequest = {}): Promise<SekbBatchDistillationResult> {
    const trajectoryIds = request.trajectoryIds ?? null;
    const minClusterSize = normalizeMinClusterSize(request.minClusterSize);

    // Flag-off parity: no provider inspection, no event row, and identical
    // deterministic suggestions to the existing public method.
    if (!this.#enabled) {
      return {
        suggestions: this.#fallback(trajectoryIds, minClusterSize),
        userVisibleStatus: "feature_disabled",
        operatorEvidence: emptyEvidence("disabled"),
      };
    }

    const batchId = randomUUID();
    const traceId = `sekb-batch-${randomUUID()}`;
    const selected = this.#selectTrajectories(trajectoryIds);
    // Fall back only on IDs that still exist so missing ids cannot kill the request.
    const fallbackIds = trajectoryIds === null
      ? null
      : selected.trajectories.map((trajectory) => trajectory.trajectory_id);
    const deterministic = () => this.#fallback(fallbackIds, minClusterSize);
    if (selected.limitExceeded) {
      return this.#fallbackResult({
        batchId,
        traceId,
        deterministic,
        reason: "limit_exceeded",
        attempts: 0,
        usage: emptyUsage(),
        skippedMissingTrajectoryIds: selected.skippedMissingTrajectoryIds,
      });
    }
    if (selected.trajectories.length === 0) {
      return this.#fallbackResult({
        batchId,
        traceId,
        deterministic,
        reason: "no_eligible_trajectories",
        attempts: 0,
        usage: emptyUsage(),
        skippedMissingTrajectoryIds: selected.skippedMissingTrajectoryIds,
      });
    }
    if (!this.#provider) {
      return this.#fallbackResult({
        batchId,
        traceId,
        deterministic,
        reason: "provider_unavailable",
        attempts: 0,
        usage: emptyUsage(),
        skippedMissingTrajectoryIds: selected.skippedMissingTrajectoryIds,
      });
    }

    const projection = buildModelInput(selected.trajectories, this.#store.query_principles({ status: "active" }));
    const usage = emptyUsage();
    let failureReason: SekbBatchDistillationFallbackReason = "provider_unavailable";
    let attempts = 0;

    for (const attempt of [1, 2] as const) {
      attempts = attempt;
      this.#onAttempt?.({ batchId, traceId, attempt, timeoutMs: SEKB_BATCH_DISTILLATION_TIMEOUT_MS });
      try {
        const response = await callWithTimeout(this.#provider, projection.input, { traceId, attempt });
        addUsage(usage, response.usage);
        const validated = decodeModelOutput(response.content, projection.trajectoryIdsByRef, projection.principleIdsByRef);
        const providerTraceId = safeTraceId(response.traceId) ?? traceId;
        const suggestions = validated.map((suggestion) => toSuggestion({
          suggestion,
          batchId,
          trajectoryIdsByRef: projection.trajectoryIdsByRef,
          principleIdsByRef: projection.principleIdsByRef,
          trajectoriesByRef: projection.trajectoriesByRef,
        }));
        const event = toEvidenceEvent({
          batchId,
          traceId: providerTraceId,
          status: "assisted",
          fallbackReason: null,
          attempts,
          suggestions,
          usage,
          createdAt: this.#now().toISOString(),
        });
        this.#store.save_batch_distillation_event(event);
        return {
          suggestions,
          userVisibleStatus: "ready",
          operatorEvidence: {
            ...evidenceFromEvent(event),
            skippedMissingTrajectoryIds: selected.skippedMissingTrajectoryIds,
          },
        };
      } catch (error) {
        failureReason = error instanceof BatchDistillationFailure
          ? error.reason
          : "provider_unavailable";
      }
    }

    return this.#fallbackResult({
      batchId,
      traceId,
      deterministic,
      reason: failureReason,
      attempts,
      usage,
      skippedMissingTrajectoryIds: selected.skippedMissingTrajectoryIds,
    });
  }

  #selectTrajectories(trajectoryIds: string[] | null): {
    trajectories: Trajectory[];
    limitExceeded: boolean;
    skippedMissingTrajectoryIds: number;
  } {
    if (trajectoryIds) {
      const ids = [...new Set(trajectoryIds)];
      if (ids.length > SEKB_BATCH_DISTILLATION_MAX_TRAJECTORIES) {
        return { trajectories: [], limitExceeded: true, skippedMissingTrajectoryIds: 0 };
      }
      const trajectories: Trajectory[] = [];
      let skippedMissingTrajectoryIds = 0;
      for (const id of ids) {
        const trajectory = this.#store.find_trajectory(id);
        if (!trajectory) {
          skippedMissingTrajectoryIds += 1;
          continue;
        }
        trajectories.push(trajectory);
      }
      return { trajectories, limitExceeded: false, skippedMissingTrajectoryIds };
    }
    return {
      trajectories: this.#store.query_trajectories({ distilled: false }).slice(0, SEKB_BATCH_DISTILLATION_MAX_TRAJECTORIES),
      limitExceeded: false,
      skippedMissingTrajectoryIds: 0,
    };
  }

  #fallbackResult(input: {
    batchId: string;
    traceId: string;
    deterministic: () => DistillationSuggestion[];
    reason: SekbBatchDistillationFallbackReason;
    attempts: number;
    usage: UsageTotals;
    skippedMissingTrajectoryIds: number;
  }): SekbBatchDistillationResult {
    const suggestions = input.deterministic();
    const event = toEvidenceEvent({
      batchId: input.batchId,
      traceId: input.traceId,
      status: "fallback",
      fallbackReason: input.reason,
      attempts: input.attempts,
      suggestions,
      usage: input.usage,
      createdAt: this.#now().toISOString(),
    });
    this.#store.save_batch_distillation_event(event);
    return {
      suggestions,
      userVisibleStatus: fallbackUserVisibleStatus(input.reason),
      operatorEvidence: {
        ...evidenceFromEvent(event),
        skippedMissingTrajectoryIds: input.skippedMissingTrajectoryIds,
      },
    };
  }
}

/** Reads only opaque provenance ids; original model content is intentionally absent. */
export function getSekbBatchSuggestionProvenance(
  suggestion: DistillationSuggestion,
): BatchSuggestionProvenance | null {
  const metadata = suggestion.suggested_principle.metadata;
  if (!isRecord(metadata)) {
    return null;
  }
  const provenance = metadata.sekbBatchDistillationAssistant;
  if (!isRecord(provenance)) {
    return null;
  }
  const batchId = typeof provenance.batch_id === "string" ? provenance.batch_id : "";
  const suggestionId = typeof provenance.suggestion_id === "string" ? provenance.suggestion_id : "";
  return isOpaqueId(batchId) && isOpaqueId(suggestionId) ? { batchId, suggestionId } : null;
}

export function normalizedEditDistance(left: string, right: string): number {
  const a = left.trim();
  const b = right.trim();
  if (a === b) {
    return 0;
  }
  if (!a.length || !b.length) {
    return 1;
  }
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let row = 1; row <= a.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= b.length; column += 1) {
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + (a[row - 1] === b[column - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return Number((previous[b.length] / Math.max(a.length, b.length)).toFixed(4));
}

function buildModelInput(trajectories: Trajectory[], principles: Principle[]): {
  input: SekbBatchDistillationModelInput;
  trajectoryIdsByRef: Map<string, string>;
  principleIdsByRef: Map<string, string>;
  trajectoriesByRef: Map<string, SekbBatchModelTrajectory>;
} {
  const trajectoryIdsByRef = new Map<string, string>();
  const trajectoriesByRef = new Map<string, SekbBatchModelTrajectory>();
  const trajectoryProjection = trajectories.map((trajectory, index) => {
    const trajectoryRef = `t${index + 1}`;
    trajectoryIdsByRef.set(trajectoryRef, trajectory.trajectory_id);
    const projected = projectTrajectory(trajectory, trajectoryRef);
    trajectoriesByRef.set(trajectoryRef, projected);
    return projected;
  });
  const principleIdsByRef = new Map<string, string>();
  const existingPrinciples = principles.slice(0, SEKB_BATCH_DISTILLATION_MAX_PRINCIPLES).map((principle, index) => {
    const principleRef = `p${index + 1}`;
    principleIdsByRef.set(principleRef, principle.principle_id);
    return {
      principle_ref: principleRef,
      task_types: sanitizeTags(principle.task_types),
      context_tags: sanitizeTags(principle.context_tags),
      criticality: principle.criticality,
    };
  });
  return {
    input: {
      schema: "sekb-batch-distillation-input.v1",
      trajectories: trajectoryProjection,
      existing_principles: existingPrinciples,
    },
    trajectoryIdsByRef,
    principleIdsByRef,
    trajectoriesByRef,
  };
}

function projectTrajectory(trajectory: Trajectory, trajectoryRef: string): SekbBatchModelTrajectory {
  const shadow = isSekbShadowMetadataV1(trajectory.metadata.sekbShadow)
    ? {
        score: trajectory.metadata.sekbShadow.captureQuality.score,
        recommendation: trajectory.metadata.sekbShadow.captureQuality.recommendation,
        completion_status: trajectory.metadata.sekbShadow.completionEvidence.status,
      }
    : null;
  return {
    trajectory_ref: trajectoryRef,
    task_type: sanitizeIdentifier(trajectory.task_type, "redacted-task-type"),
    context_tags: sanitizeTags(trajectory.context_fingerprint),
    outcome: trajectory.outcome,
    error_signature: trajectory.error_signature
      ? `sig-${createHash("sha256").update(trajectory.error_signature).digest("hex").slice(0, 16)}`
      : null,
    step_counts: {
      total: trajectory.steps.length,
      tool_calls: trajectory.steps.filter((step) => step.action === "tool.call").length,
      tool_results: trajectory.steps.filter((step) => step.action === "tool.result").length,
      failed_tool_results: trajectory.steps.filter((step) =>
        isRecord(step.output) && step.output.isError === true
      ).length,
    },
    shadow,
  };
}

function decodeModelOutput(
  content: string,
  trajectoryIdsByRef: Map<string, string>,
  principleIdsByRef: Map<string, string>,
): ValidatedModelSuggestion[] {
  if (content.length > 64_000) {
    throw new BatchDistillationFailure("limit_exceeded");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    throw new BatchDistillationFailure("invalid_json");
  }
  if (!isExactRecord(parsed, ["schema", "suggestions"]) || parsed.schema !== "sekb-batch-distillation-output.v1" || !Array.isArray(parsed.suggestions)) {
    throw new BatchDistillationFailure("schema_invalid");
  }
  if (parsed.suggestions.length > SEKB_BATCH_DISTILLATION_MAX_SUGGESTIONS) {
    throw new BatchDistillationFailure("limit_exceeded");
  }
  return parsed.suggestions.map((item) => validateModelSuggestion(item, trajectoryIdsByRef, principleIdsByRef));
}

function validateModelSuggestion(
  value: unknown,
  trajectoryIdsByRef: Map<string, string>,
  principleIdsByRef: Map<string, string>,
): ValidatedModelSuggestion {
  const keys = [
    "title",
    "condition",
    "action",
    "reason",
    "source_trajectory_refs",
    "related_principle_refs",
    "conflicts",
    "confidence",
    "skipped_reason",
  ];
  if (!isExactRecord(value, keys)
    || !boundedText(value.title, 160)
    || !boundedText(value.condition, 1_000)
    || !boundedText(value.action, 1_000)
    || !boundedText(value.reason, 1_000)
    || !Array.isArray(value.source_trajectory_refs)
    || !Array.isArray(value.related_principle_refs)
    || !Array.isArray(value.conflicts)
    || typeof value.confidence !== "number"
    || !Number.isFinite(value.confidence)
    || value.confidence < 0
    || value.confidence > 1
    || (value.skipped_reason !== null && !boundedText(value.skipped_reason, 240))) {
    throw new BatchDistillationFailure("schema_invalid");
  }
  const sourceRefs = uniqueStringReferences(
    value.source_trajectory_refs,
    trajectoryIdsByRef,
    SEKB_BATCH_DISTILLATION_MAX_TRAJECTORIES,
    true,
  );
  const principleRefs = uniqueStringReferences(
    value.related_principle_refs,
    principleIdsByRef,
    SEKB_BATCH_DISTILLATION_MAX_PRINCIPLES,
    false,
  );
  if (!sourceRefs || !principleRefs) {
    throw new BatchDistillationFailure("schema_invalid");
  }
  const conflicts = value.conflicts.map((conflict) => {
    if (!isExactRecord(conflict, ["principle_ref", "reason"])
      || typeof conflict.principle_ref !== "string"
      || !principleIdsByRef.has(conflict.principle_ref)
      || !boundedText(conflict.reason, 320)) {
      throw new BatchDistillationFailure("schema_invalid");
    }
    return { principle_ref: conflict.principle_ref, reason: conflict.reason.trim() };
  });
  if (new Set(conflicts.map((conflict) => conflict.principle_ref)).size !== conflicts.length) {
    throw new BatchDistillationFailure("schema_invalid");
  }
  return {
    title: value.title.trim(),
    condition: value.condition.trim(),
    action: value.action.trim(),
    reason: value.reason.trim(),
    source_trajectory_refs: sourceRefs,
    related_principle_refs: principleRefs,
    conflicts,
    confidence: value.confidence,
    skipped_reason: value.skipped_reason === null ? null : value.skipped_reason.trim(),
  };
}

function toSuggestion(input: {
  suggestion: ValidatedModelSuggestion;
  batchId: string;
  trajectoryIdsByRef: Map<string, string>;
  principleIdsByRef: Map<string, string>;
  trajectoriesByRef: Map<string, SekbBatchModelTrajectory>;
}): SekbBatchDistillationSuggestion {
  const suggestionId = randomUUID();
  const sourceTrajectoryIds = input.suggestion.source_trajectory_refs.map((ref) => input.trajectoryIdsByRef.get(ref)!);
  const sourceProjection = input.suggestion.source_trajectory_refs.map((ref) => input.trajectoriesByRef.get(ref)!);
  const taskTypes = normalizeTags(sourceProjection.map((trajectory) => trajectory.task_type).filter((value) => value !== "redacted-task-type"));
  const contextTags = normalizeTags(sourceProjection.flatMap((trajectory) => trajectory.context_tags));
  return {
    suggestion_id: suggestionId,
    title: input.suggestion.title,
    condition: input.suggestion.condition,
    action: input.suggestion.action,
    reason: input.suggestion.reason,
    cluster_summary: `Bounded manual batch (${sourceTrajectoryIds.length} trajectories)`,
    source_trajectory_ids: sourceTrajectoryIds,
    related_principle_ids: input.suggestion.related_principle_refs.map((ref) => input.principleIdsByRef.get(ref)!),
    conflicts: input.suggestion.conflicts.map((conflict) => ({
      principle_id: input.principleIdsByRef.get(conflict.principle_ref)!,
      reason: conflict.reason,
    })),
    skipped_reason: input.suggestion.skipped_reason,
    suggested_principle: {
      title: input.suggestion.title,
      condition: input.suggestion.condition,
      action: input.suggestion.action,
      reason: input.suggestion.reason,
      task_types: taskTypes,
      context_tags: contextTags,
      criticality: "medium",
      metadata: {
        sekbBatchDistillationAssistant: {
          batch_id: input.batchId,
          suggestion_id: suggestionId,
        },
      },
    },
    confidence: input.suggestion.confidence,
  };
}

async function callWithTimeout(
  provider: SekbBatchDistillationProvider,
  input: SekbBatchDistillationModelInput,
  options: { traceId: string; attempt: 1 | 2 },
): Promise<SekbBatchDistillationProviderResponse> {
  const controller = new AbortController();
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const timer = setTimeout(() => {
      controller.abort();
      settle(() => reject(new BatchDistillationFailure("timeout")));
    }, SEKB_BATCH_DISTILLATION_TIMEOUT_MS);
    Promise.resolve(provider.suggest(input, {
      signal: controller.signal,
      timeoutMs: SEKB_BATCH_DISTILLATION_TIMEOUT_MS,
      traceId: options.traceId,
      attempt: options.attempt,
    })).then(
      (response) => settle(() => resolve(response)),
      () => settle(() => reject(new BatchDistillationFailure("provider_unavailable"))),
    );
  });
}

function toEvidenceEvent(input: {
  batchId: string;
  traceId: string;
  status: "assisted" | "fallback";
  fallbackReason: SekbBatchDistillationFallbackReason | null;
  attempts: number;
  suggestions: Array<DistillationSuggestion | SekbBatchDistillationSuggestion>;
  usage: UsageTotals;
  createdAt: string;
}): SekbBatchDistillationEvent {
  const suggestionSignatures = input.suggestions.map((suggestion) => [
    suggestion.suggested_principle.title,
    suggestion.suggested_principle.condition,
    suggestion.suggested_principle.action,
  ].map((value) => value?.trim().toLowerCase() ?? "").join("\u0001"));
  const duplicateSuggestionCount = suggestionSignatures.length - new Set(suggestionSignatures.filter(Boolean)).size;
  const attributedSuggestionCount = input.suggestions.filter((suggestion) =>
    suggestion.source_trajectory_ids.length > 0
  ).length;
  return {
    batch_id: input.batchId,
    created_at: input.createdAt,
    status: input.status,
    fallback_reason: input.fallbackReason,
    attempts: input.attempts,
    suggestion_count: input.suggestions.length,
    duplicate_suggestion_count: Math.max(0, duplicateSuggestionCount),
    attributed_suggestion_count: attributedSuggestionCount,
    attribution_total: input.suggestions.length,
    input_tokens: input.usage.inputTokens,
    output_tokens: input.usage.outputTokens,
    total_cost_usd: input.usage.totalCostUsd,
    trace_id: input.traceId,
    confirmation_count: 0,
    rejection_count: 0,
    edit_distance_sum: 0,
    edit_distance_count: 0,
  };
}

function evidenceFromEvent(event: SekbBatchDistillationEvent): Omit<SekbBatchDistillationOperatorEvidence, "skippedMissingTrajectoryIds"> {
  return {
    batchId: event.batch_id,
    traceId: event.trace_id,
    recorded: true,
    status: event.status,
    fallbackReason: event.fallback_reason,
    attempts: event.attempts,
    retryAttempted: event.attempts > 1,
    inputTokens: event.input_tokens,
    outputTokens: event.output_tokens,
    totalCostUsd: event.total_cost_usd,
  };
}

function emptyEvidence(status: "disabled"): SekbBatchDistillationOperatorEvidence {
  return {
    batchId: null,
    traceId: null,
    recorded: false,
    status,
    fallbackReason: null,
    attempts: 0,
    retryAttempted: false,
    skippedMissingTrajectoryIds: 0,
    ...emptyUsage(),
  };
}

function emptyUsage(): UsageTotals {
  return { inputTokens: null, outputTokens: null, totalCostUsd: null };
}

function addUsage(target: UsageTotals, usage: SekbBatchDistillationProviderResponse["usage"]): void {
  if (!usage) return;
  target.inputTokens = sumMetric(target.inputTokens, usage.inputTokens);
  target.outputTokens = sumMetric(target.outputTokens, usage.outputTokens);
  target.totalCostUsd = sumMetric(target.totalCostUsd, usage.totalCostUsd);
}

function sumMetric(previous: number | null, candidate: unknown): number | null {
  return typeof candidate === "number" && Number.isFinite(candidate) && candidate >= 0
    ? (previous ?? 0) + candidate
    : previous;
}

function fallbackUserVisibleStatus(reason: SekbBatchDistillationFallbackReason): SekbBatchDistillationResult["userVisibleStatus"] {
  if (reason === "timeout") return "timeout";
  if (reason === "provider_unavailable") return "provider_unavailable";
  if (reason === "limit_exceeded") return "request_limit";
  if (reason === "no_eligible_trajectories") return "no_eligible_trajectories";
  return "invalid_response";
}

function normalizeMinClusterSize(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(1, Math.trunc(value!)) : 2;
}

function sanitizeTags(values: readonly string[]): string[] {
  return normalizeTags(values)
    .filter((value) => isSafeIdentifier(value))
    .slice(0, 12);
}

function sanitizeIdentifier(value: string, replacement: string): string {
  const normalized = value.trim().toLowerCase();
  return isSafeIdentifier(normalized) ? normalized : replacement;
}

function isSafeIdentifier(value: string): boolean {
  return value.length > 0
    && value.length <= 80
    && /^[a-z0-9][a-z0-9._/-]*$/i.test(value)
    && !/(?:secret|password|api[_-]?key|token|bearer|authorization|private[_-]?key|sk-[a-z0-9])/.test(value);
}

function uniqueStringReferences(
  value: unknown[],
  available: Map<string, string>,
  max: number,
  required: boolean,
): string[] | null {
  if ((required && value.length === 0)
    || value.length > max
    || value.some((item) => typeof item !== "string" || !available.has(item))) {
    return null;
  }
  const refs = value as string[];
  return new Set(refs).size === refs.length ? refs : null;
}

function isExactRecord(value: unknown, keys: string[]): value is Record<string, unknown> {
  return isRecord(value)
    && Object.keys(value).length === keys.length
    && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

function safeTraceId(value: unknown): string | null {
  return typeof value === "string" && /^[a-z0-9_-]{1,128}$/i.test(value) ? value : null;
}

function isOpaqueId(value: string): boolean {
  return /^[a-z0-9-]{16,128}$/i.test(value);
}

class BatchDistillationFailure extends Error {
  constructor(readonly reason: SekbBatchDistillationFallbackReason) {
    super(reason);
  }
}

export function originalSuggestionContent(suggestion: DistillationSuggestion): string | null {
  const { condition, action, reason } = suggestion.suggested_principle;
  return typeof condition === "string" && typeof action === "string" && typeof reason === "string"
    ? buildPrincipleFullContent({ condition, action, reason })
    : null;
}
