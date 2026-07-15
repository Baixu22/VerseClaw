import { randomUUID } from "node:crypto";
import type { ContextBlockSink } from "../../context-engine/block.js";
import { handleConfirmAndSave } from "./experience-block-bridge.js";
import {
  getSekbBatchSuggestionProvenance,
  normalizedEditDistance,
  originalSuggestionContent,
} from "./batch-distillation-assistant.js";
import type { KnowledgeStore } from "./knowledge-store.js";
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
  /** C7-2: opt-in experience shadow journal (default off / omitted). */
  experienceShadow?: {
    workspaceRoot: string;
    enabled: boolean;
    dualWrite?: boolean;
  };
};

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
    const trajectories = trajectory_ids
      ? trajectory_ids
          .map((id) => this.#store.find_trajectory(id))
          .filter((trajectory): trajectory is NonNullable<typeof trajectory> => trajectory !== null)
      : this.#store.query_trajectories({ distilled: false });
    const byTaskType = new Map<string, typeof trajectories>();
    for (const trajectory of trajectories) {
      byTaskType.set(trajectory.task_type, [...(byTaskType.get(trajectory.task_type) ?? []), trajectory]);
    }
    const suggestions: DistillationSuggestion[] = [];
    for (const [taskType, group] of byTaskType) {
      if (group.length < min_cluster_size) {
        continue;
      }
      const contextTags = normalizeTags(group.flatMap((trajectory) => trajectory.context_fingerprint));
      suggestions.push({
        cluster_summary: `Similar ${taskType} trajectories (${group.length})`,
        source_trajectory_ids: group.map((trajectory) => trajectory.trajectory_id),
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
    const suggested = { ...suggestion.suggested_principle, ...edits };
    const condition = nonEmpty(suggested.condition) ?? "When a matching historical trajectory exists";
    const action = nonEmpty(suggested.action) ?? "Review the captured trajectory before continuing";
    const reason = nonEmpty(suggested.reason) ?? "Prior outcomes can reveal reusable constraints";
    const principle: Principle = {
      principle_id: nonEmpty(suggested.principle_id) ?? randomUUID(),
      created_at: nonEmpty(suggested.created_at) ?? now.toISOString(),
      updated_at: now.toISOString(),
      title: nonEmpty(suggested.title) ?? "Review history",
      condition,
      action,
      reason,
      full_content: nonEmpty(suggested.full_content) ?? buildPrincipleFullContent({ condition, action, reason }),
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
      },
    };
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
    if ((options.contextBlockSink && options.sessionId) || (options.experienceShadow?.enabled && options.sessionId)) {
      void handleConfirmAndSave({
        principle,
        suggestion,
        sessionId: options.sessionId!,
        contextBlockSink: options.contextBlockSink,
        now,
        ...(options.experienceShadow ? { experienceShadow: options.experienceShadow } : {}),
      }).catch(() => {
        // Best-effort: sink/shadow failure does not block the SEKB save.
      });
    }

    return principleId;
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

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeCriticality(value: unknown): PrincipleCriticality {
  return value === "low" || value === "high" || value === "critical" ? value : "medium";
}
