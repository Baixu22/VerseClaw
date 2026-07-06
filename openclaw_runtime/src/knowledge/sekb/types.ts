export type JsonObject = Record<string, unknown>;

export type TrajectoryOutcome = "success" | "failure" | "partial";

export type TrajectoryStep = {
  action: string;
  input: unknown;
  output: unknown;
  timestamp: string;
};

export type TrajectoryCost = {
  tokens: number;
  duration_seconds: number;
  retries: number;
};

export type Trajectory = {
  trajectory_id: string;
  created_at: string;
  task_intent: string;
  task_type: string;
  context_fingerprint: string[];
  steps: TrajectoryStep[];
  outcome: TrajectoryOutcome;
  error_signature: string | null;
  cost: TrajectoryCost;
  distilled: boolean;
  distilled_into: string[];
  expires_at: string | null;
  metadata: JsonObject;
};

export type PrincipleStatus = "staging" | "active" | "demoted" | "archived";
export type PrincipleCreatedBy = "human" | "agent" | "distiller";
export type PrincipleCriticality = "low" | "medium" | "high" | "critical";

export type Principle = {
  principle_id: string;
  created_at: string;
  updated_at: string;
  title: string;
  condition: string;
  action: string;
  reason: string;
  full_content: string;
  task_types: string[];
  context_tags: string[];
  embedding: number[] | null;
  source_trajectories: string[];
  created_by: PrincipleCreatedBy;
  status: PrincipleStatus;
  retrieval_count: number;
  adoption_count: number;
  post_adoption_success: number;
  criticality: PrincipleCriticality;
  pinned: boolean;
  metadata: JsonObject;
};

export type IndexEntry = {
  principle_id: string;
  title: string;
  trigger_tags: string[];
  one_liner: string;
  status: PrincipleStatus;
};

export type TrajectoryQuery = {
  task_type?: string;
  context_tags?: string[];
  outcome?: TrajectoryOutcome | null;
  distilled?: boolean | null;
};

export type PrincipleQuery = {
  status?: PrincipleStatus | null;
  task_types?: string[] | null;
};

export type DistillationSuggestion = {
  cluster_summary: string;
  source_trajectory_ids: string[];
  suggested_principle: Partial<Principle> & {
    title?: string;
    condition?: string;
    action?: string;
    reason?: string;
    task_types?: string[];
    context_tags?: string[];
    criticality?: PrincipleCriticality;
  };
  confidence: number;
};

export type DistillationRejection = {
  rejection_id: string;
  created_at: string;
  suggestion: DistillationSuggestion | JsonObject;
  reason: string;
};

export const SEKB_L1_TOKEN_BUDGET = 2_000;

export function approxTokenCount(value: string): number {
  return Math.ceil(value.length / 4);
}

export function normalizeTags(values: readonly string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim().toLowerCase()).filter(Boolean))]
    .toSorted((left, right) => left.localeCompare(right));
}

export function buildPrincipleFullContent(input: {
  condition: string;
  action: string;
  reason: string;
}): string {
  return `${input.condition}, ${input.action} because ${input.reason}.`;
}
