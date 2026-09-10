// Runtime Lifecycle Governance — goal-wake controller facade.
//
// Phase 0 mission fencing writers and the Phase 3 goal-wake runtime are
// re-exported here so existing mission-control callers keep one stable
// `goalWakeController` surface while each implementation module stays under
// the quantitative per-module line budget.
import { missionFencingController } from "./goal-wake-fencing.js";
import {
  durableHelperEnabled,
  resolveDurableHelperPolicy,
} from "./goal-wake-config.js";
import { goalWakeRuntime } from "./goal-wake-runtime.js";

export {
  RUNTIME_LIFECYCLE_MISSION_FENCING_ENABLED_ENV,
} from "./goal-wake-fencing.js";
export {
  RUNTIME_LIFECYCLE_GOAL_WAKE_ENABLED_ENV,
  RUNTIME_LIFECYCLE_GOAL_WAKE_MAX_WAITS_ENV,
  RUNTIME_LIFECYCLE_GOAL_WAKE_MAX_FLOWS_ENV,
  RUNTIME_LIFECYCLE_GOAL_WAKE_TICK_BACKOFF_MS_ENV,
  RUNTIME_LIFECYCLE_DURABLE_HELPER_ENABLED_ENV,
  RUNTIME_LIFECYCLE_DURABLE_HELPER_MAX_OUTPUT_BYTES_ENV,
  RUNTIME_LIFECYCLE_DURABLE_HELPER_MAX_RUNS_ENV,
  RUNTIME_LIFECYCLE_DURABLE_HELPER_SWEEP_MS_ENV,
  RUNTIME_LIFECYCLE_DURABLE_HELPER_TTL_MS_ENV,
} from "./goal-wake-config.js";
export type { DurableHelperPolicy } from "./goal-wake-config.js";
export type {
  MissionFencingWriteResult,
  MissionTickClaim,
  MissionTickFinish,
} from "./goal-wake-fencing.js";
export type {
  GoalWakeAckResult,
  GoalWakeArmInput,
  GoalWakeArmResult,
  GoalWakeBarrier,
  GoalWakeBudgets,
  GoalWakeDispatch,
  GoalWakeDispatchInput,
  GoalWakeDispatchResult,
  GoalWakeLevelCheckResult,
  GoalWakeTaskExitInput,
  GoalWakeWaitJson,
} from "./goal-wake-types.js";

export const goalWakeController = {
  isMissionFencingEnabled: missionFencingController.isMissionFencingEnabled,
  durableHelperEnabled,
  resolveDurableHelperPolicy,
  saveMissionRunFenced: missionFencingController.saveMissionRunFenced,
  claimMissionTick: missionFencingController.claimMissionTick,
  finishMissionTick: missionFencingController.finishMissionTick,
  ...goalWakeRuntime,
};
