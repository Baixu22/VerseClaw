/**
 * C5-3: isolation mode recommendation matrix.
 * task duration × worker count × write density → shared+L0 / worktree / patch-flow
 */
export type IsolationMode = "shared" | "worktree" | "patch-flow";

export type IsolationRecommendation = {
  mode: IsolationMode;
  reason: string;
  score: { duration: number; workers: number; writeDensity: number };
};

/**
 * @param durationMinutes estimated goal duration
 * @param workerCount number of concurrent writers
 * @param writeDensity 0..1 fraction of tasks that write
 */
export function recommendIsolationMode(params: {
  durationMinutes: number;
  workerCount: number;
  writeDensity: number;
}): IsolationRecommendation {
  const duration = Math.max(0, params.durationMinutes);
  const workers = Math.max(1, Math.floor(params.workerCount));
  const density = Math.min(1, Math.max(0, params.writeDensity));
  const score = { duration, workers, writeDensity: density };

  // Long + multi-worker + dense writes → patch-flow (lead serial apply)
  if (duration >= 30 && workers >= 3 && density >= 0.5) {
    return {
      mode: "patch-flow",
      reason: "long_goal_dense_multi_worker",
      score,
    };
  }
  // Multi-worker with overlapping risk → worktree
  if (workers >= 2 && density >= 0.3) {
    return {
      mode: "worktree",
      reason: "multi_worker_write_density",
      score,
    };
  }
  // Default L0 shared with writeSet coordination
  return {
    mode: "shared",
    reason: "shared_l0_default",
    score,
  };
}
