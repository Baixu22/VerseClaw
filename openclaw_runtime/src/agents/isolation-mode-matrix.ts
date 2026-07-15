/**
 * C5-3: isolation mode recommendation matrix (recommend API only).
 * task duration x worker count x write density (+ optional writeSet overlap risk)
 * -> shared+L0 / worktree / patch-flow
 *
 * Does NOT auto-switch production isolation. C4 request surface remains shared|worktree
 * with default shared; patch-flow is a recommend-only third mode for long dense jobs.
 */
export type IsolationMode = "shared" | "worktree" | "patch-flow";

export type IsolationRecommendation = {
  mode: IsolationMode;
  reason: string;
  score: {
    duration: number;
    workers: number;
    writeDensity: number;
    writeSetOverlapRisk: number;
  };
};

/**
 * @param durationMinutes estimated goal duration
 * @param workerCount number of concurrent writers
 * @param writeDensity 0..1 fraction of tasks that write
 * @param writeSetOverlapRisk optional 0..1 predicted writeSet intersection risk (C3-aware; empty writeSet => 0)
 */
export function recommendIsolationMode(params: {
  durationMinutes: number;
  workerCount: number;
  writeDensity: number;
  writeSetOverlapRisk?: number;
}): IsolationRecommendation {
  const duration = Math.max(0, params.durationMinutes);
  const workers = Math.max(1, Math.floor(params.workerCount));
  const density = Math.min(1, Math.max(0, params.writeDensity));
  const overlap =
    typeof params.writeSetOverlapRisk === "number"
      ? Math.min(1, Math.max(0, params.writeSetOverlapRisk))
      : 0;
  const score = { duration, workers, writeDensity: density, writeSetOverlapRisk: overlap };

  if (duration >= 30 && workers >= 3 && (density >= 0.5 || overlap >= 0.5)) {
    return {
      mode: "patch-flow",
      reason: "long_goal_dense_multi_worker",
      score,
    };
  }
  if (workers >= 2 && (density >= 0.3 || overlap >= 0.3)) {
    return {
      mode: "worktree",
      reason: "multi_worker_write_density",
      score,
    };
  }
  return {
    mode: "shared",
    reason: "shared_l0_default",
    score,
  };
}