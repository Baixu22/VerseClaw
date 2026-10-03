// Runtime Lifecycle Governance — goal-wake flags and budgets.
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { isTruthyEnvValue } from "../infra/env.js";
import { missionFencingController } from "./goal-wake-fencing.js";
import type { GoalWakeBudgets } from "./goal-wake-types.js";

export const RUNTIME_LIFECYCLE_GOAL_WAKE_ENABLED_ENV =
  "RUNTIME_LIFECYCLE_GOAL_WAKE_ENABLED";
export const RUNTIME_LIFECYCLE_GOAL_WAKE_MAX_WAITS_ENV =
  "RUNTIME_LIFECYCLE_GOAL_WAKE_MAX_WAITS";
export const RUNTIME_LIFECYCLE_GOAL_WAKE_MAX_FLOWS_ENV =
  "RUNTIME_LIFECYCLE_GOAL_WAKE_MAX_FLOWS";
export const RUNTIME_LIFECYCLE_GOAL_WAKE_TICK_BACKOFF_MS_ENV =
  "RUNTIME_LIFECYCLE_GOAL_WAKE_TICK_BACKOFF_MS";

export const RUNTIME_LIFECYCLE_DURABLE_HELPER_ENABLED_ENV =
  "RUNTIME_LIFECYCLE_DURABLE_HELPER_ENABLED";
export const RUNTIME_LIFECYCLE_DURABLE_HELPER_MAX_RUNS_ENV =
  "RUNTIME_LIFECYCLE_DURABLE_HELPER_MAX_RUNS";
export const RUNTIME_LIFECYCLE_DURABLE_HELPER_MAX_OUTPUT_BYTES_ENV =
  "RUNTIME_LIFECYCLE_DURABLE_HELPER_MAX_OUTPUT_BYTES";
export const RUNTIME_LIFECYCLE_DURABLE_HELPER_TTL_MS_ENV =
  "RUNTIME_LIFECYCLE_DURABLE_HELPER_TTL_MS";
export const RUNTIME_LIFECYCLE_DURABLE_HELPER_SWEEP_MS_ENV =
  "RUNTIME_LIFECYCLE_DURABLE_HELPER_SWEEP_MS";

const DEFAULT_MAX_ACTIVE_GOAL_WAITS = 4;
const DEFAULT_MAX_GOAL_WAKE_FLOWS = 16;
const DEFAULT_TICK_FAILURE_BACKOFF_MS = 5_000;

const DEFAULT_DURABLE_HELPER_MAX_RUNS = 4;
const DEFAULT_DURABLE_HELPER_MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
const DEFAULT_DURABLE_HELPER_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DURABLE_HELPER_SWEEP_MS = 60_000;

function readPositiveInt(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return fallback;
  }
  return Math.max(0, Math.floor(value));
}

function envPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
}

/** True only when both the goal-wake flag and mission fencing are enabled. */
export function goalWakeEnabled(cfg?: OpenClawConfig): boolean {
  const flag =
    isTruthyEnvValue(process.env[RUNTIME_LIFECYCLE_GOAL_WAKE_ENABLED_ENV]) ||
    cfg?.runtime?.mission?.goalWake?.enabled === true;
  return flag && missionFencingController.isMissionFencingEnabled();
}

export function resolveGoalWakeBudgets(cfg?: OpenClawConfig): GoalWakeBudgets {
  const settings = cfg?.runtime?.mission?.goalWake;
  return {
    enabled: goalWakeEnabled(cfg),
    maxActiveGoalWaits: readPositiveInt(
      settings?.maxActiveGoalWaits ??
        envPositiveInt(RUNTIME_LIFECYCLE_GOAL_WAKE_MAX_WAITS_ENV, DEFAULT_MAX_ACTIVE_GOAL_WAITS),
      DEFAULT_MAX_ACTIVE_GOAL_WAITS,
    ),
    maxFlows: readPositiveInt(
      settings?.maxFlows ??
        envPositiveInt(RUNTIME_LIFECYCLE_GOAL_WAKE_MAX_FLOWS_ENV, DEFAULT_MAX_GOAL_WAKE_FLOWS),
      DEFAULT_MAX_GOAL_WAKE_FLOWS,
    ),
    tickFailureBackoffMs: readPositiveInt(
      settings?.tickFailureBackoffMs ??
        envPositiveInt(RUNTIME_LIFECYCLE_GOAL_WAKE_TICK_BACKOFF_MS_ENV, DEFAULT_TICK_FAILURE_BACKOFF_MS),
      DEFAULT_TICK_FAILURE_BACKOFF_MS,
    ),
  };
}

export type DurableHelperPolicy = {
  enabled: boolean;
  maxRunsPerSession: number;
  maxOutputBytesPerRun: number;
  runTtlMs: number;
  sweepIntervalMs: number;
};

/** Phase 4 durable-helper gate. It requires the Phase 3 goal-wake gate and is
 *  otherwise default-off. The same-gateway path only changes when this is on. */
export function durableHelperEnabled(cfg?: OpenClawConfig): boolean {
  if (!goalWakeEnabled(cfg)) return false;
  return (
    isTruthyEnvValue(process.env[RUNTIME_LIFECYCLE_DURABLE_HELPER_ENABLED_ENV]) ||
    cfg?.runtime?.mission?.goalWake?.durableHelper?.enabled === true
  );
}

export function resolveDurableHelperPolicy(cfg?: OpenClawConfig): DurableHelperPolicy {
  const settings = cfg?.runtime?.mission?.goalWake?.durableHelper;
  return {
    enabled: durableHelperEnabled(cfg),
    maxRunsPerSession: readPositiveInt(
      settings?.maxRunsPerSession ??
        envPositiveInt(
          RUNTIME_LIFECYCLE_DURABLE_HELPER_MAX_RUNS_ENV,
          DEFAULT_DURABLE_HELPER_MAX_RUNS,
        ),
      DEFAULT_DURABLE_HELPER_MAX_RUNS,
    ),
    maxOutputBytesPerRun: readPositiveInt(
      settings?.maxOutputBytesPerRun ??
        envPositiveInt(
          RUNTIME_LIFECYCLE_DURABLE_HELPER_MAX_OUTPUT_BYTES_ENV,
          DEFAULT_DURABLE_HELPER_MAX_OUTPUT_BYTES,
        ),
      DEFAULT_DURABLE_HELPER_MAX_OUTPUT_BYTES,
    ),
    runTtlMs: readPositiveInt(
      settings?.runTtlMs ??
        envPositiveInt(
          RUNTIME_LIFECYCLE_DURABLE_HELPER_TTL_MS_ENV,
          DEFAULT_DURABLE_HELPER_TTL_MS,
        ),
      DEFAULT_DURABLE_HELPER_TTL_MS,
    ),
    sweepIntervalMs: readPositiveInt(
      settings?.sweepIntervalMs ??
        envPositiveInt(
          RUNTIME_LIFECYCLE_DURABLE_HELPER_SWEEP_MS_ENV,
          DEFAULT_DURABLE_HELPER_SWEEP_MS,
        ),
      DEFAULT_DURABLE_HELPER_SWEEP_MS,
    ),
  };
}
