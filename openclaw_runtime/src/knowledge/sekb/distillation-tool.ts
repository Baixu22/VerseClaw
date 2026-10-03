import { createHash, randomUUID } from "node:crypto";
import type { ContextBlockSink } from "../../context-engine/block.js";
import {
  assertConfirmSession,
  buildConfirmProvenance,
  canEnterHighTrustContext,
  ConfirmProvenanceError,
  normalizeConfirmSourceSystem,
  resolveConfirmIntegrity,
  type ConfirmIntegrityLevel,
  type ConfirmProvenance,
} from "./confirm-provenance.js";
import { handleConfirmAndSave } from "./experience-block-bridge.js";
import {
  getSekbBatchSuggestionProvenance,
  normalizedEditDistance,
  originalSuggestionContent,
} from "./batch-distillation-assistant.js";
import type { KnowledgeStore } from "./knowledge-store.js";
import { normalizeRuntimeLineage, type RuntimeLineage } from "../../runtime-core/lineage.js";
import {
  buildPrincipleFullContent,
  normalizeTags,
  type DistillationSuggestion,
  type Principle,
  type PrincipleCriticality,
} from "./types.js";

export type DistillationToolOptions = {
  store: KnowledgeStore;
  now?: () => Date;
};

export type ConfirmAndSaveOptions = {
  contextBlockSink?: ContextBlockSink;
  sessionId?: string;
  /** Origin of the confirm action (unknown is capped to advisory integrity). */
  sourceSystem?: string;
  /** Client integrity claim; server resolves and may downgrade. */
  integrityClaim?: string;
  /**
   * When true, client attempted to elevate trust from summary text alone.
   * Summary-only claims cannot become high_trust (P3-002 A2).
   */
  summaryOnly?: boolean;
  /**
   * When true (host UI path), missing sessionId throws ConfirmProvenanceError.
   * Defaults false for internal SEKB unit callers that only persist principles.
   */
  requireSession?: boolean;
  /** C7-2: opt-in experience shadow journal (default off / omitted). */
  experienceShadow?: {
    workspaceRoot: string;
    enabled: boolean;
    dualWrite?: boolean;
  };
  /** KS-02: truthful sink classification for host UI status. */
  contextBlockSinkKind?: "blockstore" | "journal";
  /** KS-02: internal flag used by the lineage coordinator to avoid double projection. */
  deferContextBlockWrite?: boolean;
};

export type ConfirmAndSaveResult = {
  principleId: string;
  provenance?: ConfirmProvenance;
  dcsWrite:
    | "persisted"
    | "journaled_degraded"
    | "rejected"
    | "not_attempted"
    | "written"
    | "skipped";
  projectionBlockId?: string;
  highTrustEligible: boolean;
};

function stablePrincipleId(suggestion: DistillationSuggestion): string {
  const explicit = suggestion.suggested_principle.principle_id;
  if (explicit && explicit.trim()) return explicit.trim();
  const sourceIds = [...new Set(suggestion.source_trajectory_ids)].toSorted();
  const suggested = suggestion.suggested_principle;
  return `principle-${createHash("sha256")
    .update(JSON.stringify({
      sourceIds,
      title: suggested.title ?? "",
      condition: suggested.condition ?? "",
      action: suggested.action ?? "",
      reason: suggested.reason ?? "",
    }))
    .digest("hex")
    .slice(0, 24)}`;
}

/** Manual SEKB distillation flow: suggestions are advisory until confirmed. */
export class DistillationTool {
  readonly #store: KnowledgeStore;
  readonly #now: () => Date;

  constructor(options: DistillationToolOptions) {
    this.#store = options.store;
    this.#now = options.now ?? (() => new Date());
  }

  suggest_principles_from_trajectories(
    trajectory_ids: string[] | null = null,
    min_cluster_size = 2,
  ): DistillationSuggestion[] {
    const trajectories = (
      trajectory_ids
        ? [...new Set(trajectory_ids)]
            .map((id) => this.#store.find_trajectory(id))
            .filter(
              (trajectory): trajectory is NonNullable<typeof trajectory> => trajectory !== null,
            )
        : this.#store.query_trajectories({ distilled: false })
    ).filter(isEligibleDistillationTrajectory);
    const byTaskType = new Map<string, typeof trajectories>();
    for (const trajectory of trajectories) {
      byTaskType.set(trajectory.task_type, [
        ...(byTaskType.get(trajectory.task_type) ?? []),
        trajectory,
      ]);
    }
    const suggestions: DistillationSuggestion[] = [];
    for (const [taskType, group] of [...byTaskType].toSorted(([left], [right]) =>
      left.localeCompare(right),
    )) {
      if (group.length < min_cluster_size) {
        continue;
      }
      const contextTags = normalizeTags(
        group.flatMap((trajectory) => trajectory.context_fingerprint),
      );
      suggestions.push({
        cluster_summary: `Similar ${taskType} trajectories (${group.length})`,
        source_trajectory_ids: group.map((trajectory) => trajectory.trajectory_id).toSorted(),
        suggested_principle: {
          title: "Review repeated path",
          condition: `When handling ${taskType} tasks`,
          action: "Compare the current task against prior captured trajectories before acting",
          reason: "Repeated task shapes often expose reusable setup and failure patterns",
          task_types: [taskType],
          context_tags: contextTags,
          criticality: "medium",
        },
        confidence: 0.5,
      });
    }
    return suggestions;
  }

  confirm_and_save(
    suggestion: DistillationSuggestion,
    edits: Partial<Principle> | null = null,
    options: ConfirmAndSaveOptions = {},
  ): string {
    const now = this.#now();
    const sourceIds = [...new Set(suggestion.source_trajectory_ids)].toSorted();
    const sourceLineages = sourceIds.map((id) =>
      normalizeRuntimeLineage(this.#store.get_trajectory(id).metadata.runtimeLineage),
    );
    const sourceLineage = commonSourceLineage(sourceLineages);
    const sessionId = assertConfirmSession(options.sessionId, {
      requireSession: options.requireSession === true,
    });
    if (sessionId && sourceLineages.some((lineage) => lineage && lineage.sessionId !== sessionId)) {
      throw new ConfirmProvenanceError(
        "source_lineage_mismatch",
        "SEKB confirm sessionId does not match the selected source trajectory lineage.",
      );
    }
    const sourceSystem = normalizeConfirmSourceSystem(options.sourceSystem ?? "sekb");
    const integrityResolution = resolveConfirmIntegrity({
      claimed: options.integrityClaim ?? "confirmed",
      sourceSystem,
      sessionId,
      sourceTrajectoryIds: sourceIds,
      summaryOnly: options.summaryOnly === true,
    });
    const suggested = { ...suggestion.suggested_principle, ...edits };
    const condition =
      nonEmpty(suggested.condition) ?? "When a matching historical trajectory exists";
    const action = nonEmpty(suggested.action) ?? "Review the captured trajectory before continuing";
    const reason = nonEmpty(suggested.reason) ?? "Prior outcomes can reveal reusable constraints";
    const principle: Principle = {
      principle_id: stablePrincipleId(suggestion),
      created_at: nonEmpty(suggested.created_at) ?? now.toISOString(),
      updated_at: now.toISOString(),
      title: nonEmpty(suggested.title) ?? "Review history",
      condition,
      action,
      reason,
      full_content:
        nonEmpty(suggested.full_content) ??
        buildPrincipleFullContent({ condition, action, reason }),
      task_types: normalizeTags(suggested.task_types),
      context_tags: normalizeTags(suggested.context_tags),
      embedding: Array.isArray(suggested.embedding) ? suggested.embedding : null,
      source_trajectories: sourceIds,
      created_by: "human",
      status: "active",
      retrieval_count: suggested.retrieval_count ?? 0,
      adoption_count: suggested.adoption_count ?? 0,
      post_adoption_success: suggested.post_adoption_success ?? 0,
      criticality: normalizeCriticality(suggested.criticality),
      pinned: suggested.pinned ?? false,
      metadata: {
        ...suggested.metadata,
        distillation_confidence: suggestion.confidence,
        cluster_summary: suggestion.cluster_summary,
        ...(sourceLineage ? { runtimeLineage: sourceLineage } : {}),
      },
    };
    // Attach provenance before first save when session lineage is present.
    if (sessionId) {
      const provisionalId = principle.principle_id;
      principle.metadata = {
        ...principle.metadata,
        confirmProvenance: buildConfirmProvenance({
          sessionId,
          sourceSystem,
          sourceTrajectoryIds: sourceIds,
          integrity: integrityResolution.integrity,
          confirmedAt: now.toISOString(),
          principleId: provisionalId,
          summaryOnlyClaimDowngraded: integrityResolution.summaryOnlyClaimDowngraded,
          highTrustEligible: integrityResolution.highTrustEligible,
        }),
        confirmIntegrity: integrityResolution.integrity,
        confirmIntegrityReasons: integrityResolution.reasons,
      };
    }
    const principleId = this.#store.save_principle(principle);
    const expiresAt = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1_000).toISOString();
    for (const trajectoryId of sourceIds) {
      const trajectory = this.#store.get_trajectory(trajectoryId);
      this.#store.update_trajectory(trajectoryId, {
        distilled: true,
        distilled_into: [...new Set([...trajectory.distilled_into, principleId])],
        expires_at: expiresAt,
      });
    }

    const batchProvenance = getSekbBatchSuggestionProvenance(suggestion);
    if (batchProvenance) {
      const originalContent = originalSuggestionContent(suggestion);
      // The original response stays in this call frame only. Persisting its
      // derived edit distance is enough for the read-only evidence report.
      this.#store.record_batch_distillation_confirmation(
        batchProvenance.batchId,
        originalContent ? normalizedEditDistance(originalContent, principle.full_content) : null,
      );
    }

    // DCS Stage 5: best-effort experience Block write via ContextBlockSink.
    // ANTI-8: suggest_principles_from_trajectories does NOT write Blocks;
    // only confirm_and_save (here) writes experience Blocks.
    // Production BlockStore write when sink+session present (unchanged).
    // C7-2 experience shadow is opt-in only via options.experienceShadow.enabled.
    if (options.deferContextBlockWrite !== true &&
        ((options.contextBlockSink && sessionId) || (options.experienceShadow?.enabled && sessionId))) {
      const provenance = principle.metadata.confirmProvenance as ConfirmProvenance | undefined;
      void handleConfirmAndSave({
        principle,
        suggestion,
        sessionId: sessionId!,
        contextBlockSink: options.contextBlockSink,
        now,
        integrity: integrityResolution.integrity,
        provenance,
        highTrustEligible: integrityResolution.highTrustEligible,
        ...(options.experienceShadow ? { experienceShadow: options.experienceShadow } : {}),
      }).catch(() => {
        // Best-effort: sink/shadow failure does not block the SEKB save.
      });
    }

    return principleId;
  }

  /**
   * Strict confirm path for host UI: requires session, returns provenance + DCS write status.
   */
  async confirm_and_save_with_lineage(
    suggestion: DistillationSuggestion,
    edits: Partial<Principle> | null = null,
    options: ConfirmAndSaveOptions = {},
  ): Promise<ConfirmAndSaveResult> {
    const sessionId = assertConfirmSession(options.sessionId, { requireSession: true });
    const principleId = this.confirm_and_save(suggestion, edits, {
      ...options,
      sessionId,
      requireSession: true,
      sourceSystem: options.sourceSystem ?? "ui-confirm",
      deferContextBlockWrite: options.contextBlockSink !== undefined,
    });
    const principle = this.#store.get_principle(principleId);
    const provenance = principle.metadata.confirmProvenance as ConfirmProvenance | undefined;
    let dcsWrite: ConfirmAndSaveResult["dcsWrite"];
    let projectionBlockId: string | undefined;
    if (options.contextBlockSink && sessionId) {
      try {
        const result = await handleConfirmAndSave({
          principle,
          suggestion,
          sessionId,
          contextBlockSink: options.contextBlockSink,
          integrity:
            (principle.metadata.confirmIntegrity as ConfirmIntegrityLevel | undefined) ??
            "confirmed",
          provenance,
          highTrustEligible: canEnterHighTrustContext(
            provenance ?? {
              integrity: "advisory",
              sourceSystem: "unknown",
              sessionId,
              sourceTrajectoryIds: [],
            },
          ),
          ...(options.experienceShadow ? { experienceShadow: options.experienceShadow } : {}),
        });
        if (!result) {
          dcsWrite = "skipped";
        } else {
          projectionBlockId = result.blockId;
          if (!result.accepted) {
            dcsWrite = "rejected";
          } else {
            dcsWrite = options.contextBlockSinkKind === "journal" ? "journaled_degraded" : "persisted";
          }
        }
      } catch {
        dcsWrite = "skipped";
      }
    } else {
      dcsWrite = "skipped";
    }
    return {
      principleId,
      provenance,
      dcsWrite,
      ...(projectionBlockId ? { projectionBlockId } : {}),
      highTrustEligible: Boolean(provenance?.highTrustEligible),
    };
  }

  reject_suggestion(suggestion: DistillationSuggestion, reason: string): void {
    const batchProvenance = getSekbBatchSuggestionProvenance(suggestion);
    if (batchProvenance) {
      // Do not put an LLM response or an operator's free-form rejection reason
      // into the historical rejection payload. Aggregate evidence is sufficient.
      this.#store.record_batch_distillation_rejection(batchProvenance.batchId);
      return;
    }
    this.#store.save_distillation_rejection({
      rejection_id: randomUUID(),
      created_at: this.#now().toISOString(),
      suggestion,
      reason,
    });
  }
}

function isEligibleDistillationTrajectory(trajectory: {
  steps: Array<{ action: string }>;
  outcome: string;
  metadata: Record<string, unknown>;
}): boolean {
  const hasRealToolEvidence = trajectory.steps.some(
    (step) => step.action === "tool.call" || step.action === "tool.result",
  );
  if (!hasRealToolEvidence) {
    return false;
  }
  if (
    trajectory.outcome !== "success" &&
    trajectory.outcome !== "failure" &&
    trajectory.outcome !== "partial"
  ) {
    return false;
  }
  const lineage = normalizeRuntimeLineage(trajectory.metadata.runtimeLineage);
  return Boolean(lineage?.sessionId && lineage.loopRunId && lineage.traceId);
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeCriticality(value: unknown): PrincipleCriticality {
  return value === "low" || value === "high" || value === "critical" ? value : "medium";
}

function commonSourceLineage(
  values: Array<RuntimeLineage | undefined>,
): RuntimeLineage | undefined {
  const lineages = values.filter((value): value is RuntimeLineage => Boolean(value));
  if (lineages.length === 0 || lineages.length !== values.length) return undefined;
  const first = JSON.stringify(lineages[0]);
  return lineages.every((lineage) => JSON.stringify(lineage) === first) ? lineages[0] : undefined;
}
