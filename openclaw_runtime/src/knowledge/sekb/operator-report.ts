import type { KnowledgeStore } from "./knowledge-store.js";
import type { PrincipleCriticality, TrajectoryOutcome } from "./types.js";

export type SekbOperatorReportOptions = {
  undistilledLimit?: number;
};

export type SekbOperatorReport = {
  counts: {
    trajectories: number;
    undistilledTrajectories: number;
    activePrinciples: number;
  };
  undistilled: Array<{
    trajectory_id: string;
    created_at: string;
    task_intent: string;
    task_type: string;
    context_fingerprint: string[];
    outcome: TrajectoryOutcome;
    error_signature: string | null;
  }>;
  activePrinciples: Array<{
    principle_id: string;
    title: string;
    task_types: string[];
    context_tags: string[];
    criticality: PrincipleCriticality;
    retrieval_count: number;
    adoption_count: number;
  }>;
  indexPreview: string;
};

export function buildSekbOperatorReport(
  store: KnowledgeStore,
  options: SekbOperatorReportOptions = {},
): SekbOperatorReport {
  const trajectories = store.query_trajectories({});
  const undistilled = trajectories.filter((trajectory) => !trajectory.distilled);
  const activePrinciples = store.query_principles({ status: "active" });
  return {
    counts: {
      trajectories: trajectories.length,
      undistilledTrajectories: undistilled.length,
      activePrinciples: activePrinciples.length,
    },
    undistilled: undistilled.slice(0, options.undistilledLimit ?? 20).map((trajectory) => ({
      trajectory_id: trajectory.trajectory_id,
      created_at: trajectory.created_at,
      task_intent: trajectory.task_intent,
      task_type: trajectory.task_type,
      context_fingerprint: trajectory.context_fingerprint,
      outcome: trajectory.outcome,
      error_signature: trajectory.error_signature,
    })),
    activePrinciples: activePrinciples.map((principle) => ({
      principle_id: principle.principle_id,
      title: principle.title,
      task_types: principle.task_types,
      context_tags: principle.context_tags,
      criticality: principle.criticality,
      retrieval_count: principle.retrieval_count,
      adoption_count: principle.adoption_count,
    })),
    indexPreview: store.get_index(),
  };
}
