/**
 * Agent harness lifecycle hook helpers.
 *
 * This module dispatches LLM/agent lifecycle plugin hooks and normalizes
 * before-finalize retry/finalize decisions with bounded retry accounting.
 */
import { createHash } from "node:crypto";
import { normalizeOptionalString as normalizeTrimmedString } from "@openclaw/normalization-core/string-coerce";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { getGlobalHookRunner } from "../../plugins/hook-runner-global.js";
import type {
  PluginHookAgentEndEvent,
  PluginHookBeforeAgentFinalizeEvent,
  PluginHookBeforeAgentFinalizeResult,
  PluginHookLlmInputEvent,
  PluginHookLlmOutputEvent,
  PluginHookTaskPhaseChangeEvent,
} from "../../plugins/hook-types.js";
import type { VoidHookRunOptions } from "../../plugins/hooks.js";
import { resolveGlobalSingleton } from "../../shared/global-singleton.js";
import {
  handleTaskPhaseChange,
  isTerminalPhase,
} from "../../context-engine/handlers/task-loop-handler.js";
import type { ContextBlockSink } from "../../context-engine/block.js";
import type { BlockStoreApi } from "../../context-engine/block.js";
import { normalizeRuntimeLineage, type RuntimeLineage } from "../../runtime-core/lineage.js";
import type { TrajectoryCapture } from "../../knowledge/sekb/trajectory-capture.js";
import { buildAgentHookContext, type AgentHarnessHookContext } from "./hook-context.js";

const log = createSubsystemLogger("agents/harness");
const FINALIZE_RETRY_BUDGET_KEY = Symbol.for("openclaw.pluginFinalizeRetryBudget");
const FINALIZE_RETRY_BUDGET_MAX_ENTRIES = 2048;

/**
 * Runtime configuration for the DCS Stage 2 task-state handler.
 *
 * Each config is bound to the embedded run/session that created it. The
 * registry is intentionally keyed by runtime lineage; an unkeyed value is
 * retained only for legacy inspection APIs and is never selected by a phase
 * hook carrying a run id.
 */
export interface TaskStateHandlerConfig {
  runId?: string;
  ownerRunId?: string;
  sessionId?: string;
  contextBlockSink?: ContextBlockSink;
  workingMemoryStore?: Pick<BlockStoreApi, "query">;
  trajectoryCapture?: TrajectoryCapture;
  objective?: string;
  parentSessionId?: string;
  lineage?: RuntimeLineage;
}

export type TaskStateHandlerScope = {
  runId?: string;
  sessionId?: string;
};

export type TaskPhaseSideEffectStatus = "accepted" | "rejected" | "failed" | "skipped";

export type TaskPhaseSideEffectResult = {
  taskState: { status: TaskPhaseSideEffectStatus; reason?: string };
  trajectory: { status: "captured" | "failed" | "skipped"; trajectoryId?: string; reason?: string };
};

const TASK_STATE_LEGACY_KEY = "legacy";
const taskStateHandlerConfigs = new Map<string, TaskStateHandlerConfig>();

function normalizeTaskStateScope(scope?: TaskStateHandlerScope): TaskStateHandlerScope {
  const runId = scope?.runId?.trim();
  const sessionId = scope?.sessionId?.trim();
  return {
    ...(runId ? { runId } : {}),
    ...(sessionId ? { sessionId } : {}),
  };
}

function taskStateScopeKey(scope?: TaskStateHandlerScope): string {
  const normalized = normalizeTaskStateScope(scope);
  if (!normalized.runId && !normalized.sessionId) {
    return TASK_STATE_LEGACY_KEY;
  }
  return JSON.stringify([normalized.runId ?? "", normalized.sessionId ?? ""]);
}

function resolveTaskStateScope(scope: TaskStateHandlerScope): TaskStateHandlerConfig | undefined {
  const normalized = normalizeTaskStateScope(scope);
  const exact = taskStateHandlerConfigs.get(taskStateScopeKey(normalized));
  if (exact) {
    return exact;
  }
  // A run-only registration is safe when the event has a matching run id but
  // the session key was not available at factory construction time.
  if (normalized.runId) {
    const runOnly = taskStateHandlerConfigs.get(taskStateScopeKey({ runId: normalized.runId }));
    if (runOnly) {
      return runOnly;
    }
    // Compatibility for older embedders that still register one unscoped
    // config. Never use it when any run-scoped registration exists.
    const legacy = taskStateHandlerConfigs.get(TASK_STATE_LEGACY_KEY);
    if (legacy && taskStateHandlerConfigs.size === 1) {
      return legacy;
    }
    // Never fall back to a session-only or legacy value when a run id is
    // present once scoped registrations exist: that would reintroduce
    // cross-run writes.
    return undefined;
  }
  return normalized.sessionId
    ? (() => {
        const exact = taskStateHandlerConfigs.get(
          taskStateScopeKey({ sessionId: normalized.sessionId }),
        );
        if (exact) return exact;
        const matches = [...taskStateHandlerConfigs.values()].filter(
          (config) => config.sessionId === normalized.sessionId,
        );
        return matches.length === 1 ? matches[0] : undefined;
      })()
    : undefined;
}

/**
 * Returns the task-state config for a runtime lineage scope.
 *
 * The no-argument form is retained for diagnostics/tests and returns the
 * legacy value or the sole registered config. Runtime phase hooks always pass
 * an explicit run/session scope.
 */
export function getTaskStateHandlerConfig(
  scope?: TaskStateHandlerScope,
): TaskStateHandlerConfig | undefined {
  if (scope) {
    return resolveTaskStateScope(scope);
  }
  const legacy = taskStateHandlerConfigs.get(TASK_STATE_LEGACY_KEY);
  if (legacy) {
    return legacy;
  }
  const registered = [...taskStateHandlerConfigs.values()];
  return registered.length === 1 ? registered[0] : undefined;
}

/** Registers a task-state config under one runtime lineage scope. */
export function setTaskStateHandlerConfig(
  config: TaskStateHandlerConfig,
  scope?: TaskStateHandlerScope,
): void {
  const normalized = normalizeTaskStateScope(scope ?? config);
  const scopedConfig: TaskStateHandlerConfig = {
    ...config,
    ...(normalized.runId ? { runId: normalized.runId } : {}),
    ...(normalized.sessionId ? { sessionId: normalized.sessionId } : {}),
  };
  taskStateHandlerConfigs.set(taskStateScopeKey(normalized), scopedConfig);
}

/** Clears one runtime scope, or all scopes for test/process teardown. */
export function clearTaskStateHandlerConfig(scope?: TaskStateHandlerScope): void {
  if (!scope) {
    taskStateHandlerConfigs.clear();
    return;
  }
  const key = taskStateScopeKey(scope);
  if (taskStateHandlerConfigs.delete(key)) {
    return;
  }
  // Clean up the compatibility registration when it was the one selected by
  // a legacy event. A scoped registration elsewhere must remain untouched.
  if (taskStateHandlerConfigs.size === 1 && taskStateHandlerConfigs.has(TASK_STATE_LEGACY_KEY)) {
    taskStateHandlerConfigs.delete(TASK_STATE_LEGACY_KEY);
  }
}

/** Clears all registrations owned by one embedded attempt. */
export function clearTaskStateHandlerConfigsForOwner(ownerRunId: string): void {
  const owner = ownerRunId.trim();
  if (!owner) return;
  for (const [key, config] of taskStateHandlerConfigs) {
    if (config.ownerRunId === owner || config.runId === owner) {
      taskStateHandlerConfigs.delete(key);
    }
  }
}

/**
 * Bind a TaskLoop's newly-created loop id to the only DCS config for its
 * session. This is the explicit bridge between the outer embedded attempt
 * run id and the TaskLoop phase producer's loop id. Ambiguous same-session
 * configs fail closed instead of guessing a sink/objective.
 */
export function bindTaskStateHandlerConfigForRun(params: {
  runId: string;
  sessionId: string;
  objective?: string;
  lineage?: RuntimeLineage;
}): boolean {
  const runId = params.runId.trim();
  const sessionId = params.sessionId.trim();
  if (!runId || !sessionId) return false;
  const source = getTaskStateHandlerConfig({ sessionId });
  if (!source) return false;
  const sourceScope = { runId: source.runId, sessionId };
  if (params.lineage) {
    setTaskStateHandlerConfig({ ...source, lineage: params.lineage }, sourceScope);
  }
  setTaskStateHandlerConfig(
    {
      ...source,
      runId,
      ownerRunId: source.ownerRunId ?? source.runId,
      sessionId,
      ...(params.objective?.trim() ? { objective: params.objective.trim() } : {}),
      ...(params.lineage ? { lineage: params.lineage } : {}),
    },
    { runId, sessionId },
  );
  return true;
}

function isTaskStateCleanupPhase(status: PluginHookTaskPhaseChangeEvent["toStatus"]): boolean {
  return isTerminalPhase(status) || status === "cancelled";
}

type AgentHarnessHookRunner = ReturnType<typeof getGlobalHookRunner>;
type FinalizeRetryBudget = Map<string, Map<string, number>>;

/** Returns the current global hook runner for harness lifecycle hooks. */
export function getAgentHarnessHookRunner(): AgentHarnessHookRunner {
  return getGlobalHookRunner();
}

function getFinalizeRetryBudget(): FinalizeRetryBudget {
  return resolveGlobalSingleton<FinalizeRetryBudget>(FINALIZE_RETRY_BUDGET_KEY, () => new Map());
}

function countFinalizeRetryBudgetEntries(budget: FinalizeRetryBudget): number {
  let count = 0;
  for (const runBudget of budget.values()) {
    count += runBudget.size;
  }
  return count;
}

function pruneFinalizeRetryBudget(budget: FinalizeRetryBudget): void {
  while (countFinalizeRetryBudgetEntries(budget) > FINALIZE_RETRY_BUDGET_MAX_ENTRIES) {
    const oldestRunId = budget.keys().next().value;
    if (oldestRunId === undefined) {
      return;
    }
    const oldestRunBudget = budget.get(oldestRunId);
    const oldestRetryKey = oldestRunBudget?.keys().next().value;
    if (oldestRunBudget && oldestRetryKey !== undefined) {
      oldestRunBudget.delete(oldestRetryKey);
    }
    if (!oldestRunBudget || oldestRunBudget.size === 0) {
      budget.delete(oldestRunId);
    }
  }
}

function buildFinalizeRetryInstructionKey(instruction: string): string {
  return `instruction:${createHash("sha256").update(instruction).digest("hex")}`;
}

/** Clears before-finalize retry budgets globally or for one run. */
export function clearAgentHarnessFinalizeRetryBudget(params?: { runId?: string }): void {
  const budget = getFinalizeRetryBudget();
  if (!params?.runId) {
    budget.clear();
    return;
  }
  budget.delete(params.runId);
}

/** Dispatches best-effort LLM input hooks for a harness attempt. */
export function runAgentHarnessLlmInputHook(params: {
  event: PluginHookLlmInputEvent;
  ctx: AgentHarnessHookContext;
  hookRunner?: AgentHarnessHookRunner;
}): void {
  const hookRunner = params.hookRunner ?? getGlobalHookRunner();
  if (!hookRunner?.hasHooks("llm_input") || typeof hookRunner.runLlmInput !== "function") {
    return;
  }
  void hookRunner
    .runLlmInput(params.event, buildAgentHookContext(params.ctx))
    .catch((error: unknown) => {
      log.warn(`llm_input hook failed: ${String(error)}`);
    });
}

/** Dispatches best-effort LLM output hooks for a harness attempt. */
export function runAgentHarnessLlmOutputHook(params: {
  event: PluginHookLlmOutputEvent;
  ctx: AgentHarnessHookContext;
  hookRunner?: AgentHarnessHookRunner;
}): void {
  const hookRunner = params.hookRunner ?? getGlobalHookRunner();
  if (!hookRunner?.hasHooks("llm_output") || typeof hookRunner.runLlmOutput !== "function") {
    return;
  }
  void hookRunner
    .runLlmOutput(params.event, buildAgentHookContext(params.ctx))
    .catch((error: unknown) => {
      log.warn(`llm_output hook failed: ${String(error)}`);
    });
}

async function executeAgentHarnessAgentEndHook(params: {
  event: PluginHookAgentEndEvent;
  ctx: AgentHarnessHookContext;
  hookRunner?: AgentHarnessHookRunner;
  unrefTimeout?: boolean;
}): Promise<void> {
  const hookRunner = params.hookRunner ?? getGlobalHookRunner();
  try {
    if (hookRunner?.hasHooks("agent_end") && typeof hookRunner.runAgentEnd === "function") {
      const options: VoidHookRunOptions = { unrefTimeout: params.unrefTimeout ?? false };
      await hookRunner.runAgentEnd(params.event, buildAgentHookContext(params.ctx), options);
    }
  } catch (error) {
    log.warn(`agent_end hook failed: ${String(error)}`);
  } finally {
    if (params.ctx.runId) {
      clearTaskStateHandlerConfigsForOwner(params.ctx.runId);
    }
  }
}

/** Starts agent_end hooks with unref timeout behavior. */
export function runAgentHarnessAgentEndHook(params: {
  event: PluginHookAgentEndEvent;
  ctx: AgentHarnessHookContext;
  hookRunner?: AgentHarnessHookRunner;
}): void {
  void executeAgentHarnessAgentEndHook({ ...params, unrefTimeout: true });
}

/** Runs agent_end hooks and waits for completion. */
export async function awaitAgentHarnessAgentEndHook(params: {
  event: PluginHookAgentEndEvent;
  ctx: AgentHarnessHookContext;
  hookRunner?: AgentHarnessHookRunner;
}): Promise<void> {
  await executeAgentHarnessAgentEndHook({ ...params, unrefTimeout: false });
}

/** 调度 task_phase_change hook，并等待本轮 handler 完成。 */
export async function runAgentHarnessTaskPhaseChangeHook(params: {
  event: PluginHookTaskPhaseChangeEvent;
  ctx: AgentHarnessHookContext;
  hookRunner?: AgentHarnessHookRunner;
}): Promise<TaskPhaseSideEffectResult> {
  const hookRunner = params.hookRunner ?? getGlobalHookRunner();
  if (
    hookRunner?.hasHooks("task_phase_change") ||
    typeof hookRunner?.runTaskPhaseChange === "function"
  ) {
    try {
      await hookRunner.runTaskPhaseChange(params.event, buildAgentHookContext(params.ctx));
    } catch (error) {
      log.warn(`task_phase_change hook failed: ${String(error)}`);
    }
  }

  const scope: TaskStateHandlerScope = {
    runId: params.ctx.runId,
    sessionId: params.event.sessionId,
  };
  // Resolve once after plugin observers finish. The local reference then
  // remains stable even if another embedded run registers or clears its own
  // config while this phase write is awaiting a sink.
  const config = getTaskStateHandlerConfig(scope);
  const result: TaskPhaseSideEffectResult = {
    taskState: { status: "skipped", reason: "no_context_block_sink" },
    trajectory: { status: "skipped", reason: "non_terminal_phase" },
  };
  try {
    // DCS Stage 2: produce a system-managed task_state Block write through
    // the task-loop handler. This runs after plugin hooks so that plugin
    // observers see the phase transition first, then the handler persists
    // the authoritative task_state Block via ContextBlockSink/BlockStore.
    if (config?.contextBlockSink) {
      try {
        const write = await handleTaskPhaseChange({
          event: {
            sessionId: params.event.sessionId,
            taskId: params.event.taskId,
            fromStatus: params.event.fromStatus,
            toStatus: params.event.toStatus,
            ...((params.event.lineage ?? config.lineage)
              ? { lineage: params.event.lineage ?? config.lineage }
              : {}),
          },
          objective: config.objective ?? "",
          ...(config.parentSessionId ? { parentSessionId: config.parentSessionId } : {}),
          ...(config.contextBlockSink ? { contextBlockSink: config.contextBlockSink } : {}),
          ...(config.workingMemoryStore ? { workingMemoryStore: config.workingMemoryStore } : {}),
        });
        if (write?.accepted) {
          result.taskState = { status: "accepted" };
        } else {
          result.taskState = {
            status: "rejected",
            reason: write?.reason ?? (write ? "store_rejected" : "no_write_result"),
          };
          log.warn("task_phase_change task_state write was rejected", {
            runId: params.ctx.runId,
            sessionId: params.event.sessionId,
            taskId: params.event.taskId,
            fromStatus: params.event.fromStatus,
            toStatus: params.event.toStatus,
            reason: result.taskState.reason,
          });
        }
      } catch (error) {
        result.taskState = { status: "failed", reason: String(error) };
        log.warn("task_phase_change task_state write failed", {
          runId: params.ctx.runId,
          sessionId: params.event.sessionId,
          taskId: params.event.taskId,
          fromStatus: params.event.fromStatus,
          toStatus: params.event.toStatus,
          error: String(error),
        });
      }
    }

    // DCS Stage 2: trigger SEKB trajectory capture only on terminal phase
    // (completed or failed). This does not duplicate agent_end; the existing
    // agent_end lifecycle remains singular and unchanged.
    if (isTerminalPhase(params.event.toStatus) && config?.trajectoryCapture) {
      try {
        const lineage = normalizeRuntimeLineage(params.event.lineage ?? config.lineage);
        const captureKey = buildTerminalSekbCaptureKey(lineage);
        const capture = config.trajectoryCapture;
        if (typeof capture.capture_terminal_trajectory === "function") {
          const captured = capture.capture_terminal_trajectory({
            task_intent: config.objective ?? params.event.taskId,
            task_type: "agent/task",
            context_fingerprint: [params.event.toStatus],
            outcome: params.event.toStatus === "completed" ? "success" : "failure",
            raw_error: params.event.toStatus === "failed" ? "Task failed" : null,
            ...(lineage ? { runtime_lineage: lineage } : {}),
            ...(captureKey ? { capture_key: captureKey } : {}),
          });
          result.trajectory = captured.duplicate
            ? {
                status: "skipped",
                reason: "duplicate_terminal_capture",
                trajectoryId: captured.trajectory.trajectory_id,
              }
            : { status: "captured", trajectoryId: captured.trajectory.trajectory_id };
        } else {
          const trajectoryId = lineage
            ? capture.start_trajectory(
                config.objective ?? params.event.taskId,
                "agent/task",
                [params.event.toStatus],
                {
                  sekbCaptureOrigin: "task_phase_terminal",
                  runtimeLineage: lineage,
                  ...(captureKey ? { sekbCaptureKey: captureKey } : {}),
                },
              )
            : capture.start_trajectory(config.objective ?? params.event.taskId, "agent/task", [
                params.event.toStatus,
              ]);
          capture.finish_trajectory(
            trajectoryId,
            params.event.toStatus === "completed" ? "success" : "failure",
            params.event.toStatus === "failed" ? "Task failed" : null,
          );
          result.trajectory = { status: "captured", trajectoryId };
        }
      } catch (error) {
        result.trajectory = { status: "failed", reason: String(error) };
        log.warn("task_phase_change SEKB trajectory capture failed", {
          runId: params.ctx.runId,
          sessionId: params.event.sessionId,
          taskId: params.event.taskId,
          toStatus: params.event.toStatus,
          error: String(error),
        });
      }
    } else if (isTerminalPhase(params.event.toStatus)) {
      result.trajectory = { status: "skipped", reason: "no_trajectory_capture" };
    }
  } finally {
    // A terminal/cancelled phase is the last lifecycle boundary for this
    // registration. Removing only this scope prevents stale configs from
    // affecting retries or later runs sharing the same session key.
    if (isTaskStateCleanupPhase(params.event.toStatus)) {
      clearTaskStateHandlerConfig(scope);
    }
  }
  return result;
}

function buildTerminalSekbCaptureKey(lineage: RuntimeLineage | undefined): string | undefined {
  if (!lineage?.loopRunId || !lineage.traceId) {
    return undefined;
  }
  return `task-phase-terminal:${lineage.sessionId}:${lineage.loopRunId}:${lineage.traceId}`;
}

/** Normalized before-finalize hook decision consumed by harness loops. */
export type AgentHarnessBeforeAgentFinalizeOutcome =
  | { action: "continue" }
  | { action: "revise"; reason: string }
  | { action: "finalize"; reason?: string };

/** Runs before-finalize hooks and normalizes finalize/revise/continue decisions. */
export async function runAgentHarnessBeforeAgentFinalizeHook(params: {
  event: PluginHookBeforeAgentFinalizeEvent;
  ctx: AgentHarnessHookContext;
  hookRunner?: AgentHarnessHookRunner;
}): Promise<AgentHarnessBeforeAgentFinalizeOutcome> {
  const hookRunner = params.hookRunner ?? getGlobalHookRunner();
  if (
    !hookRunner?.hasHooks("before_agent_finalize") ||
    typeof hookRunner.runBeforeAgentFinalize !== "function"
  ) {
    return { action: "continue" };
  }
  try {
    const eventForNormalization: PluginHookBeforeAgentFinalizeEvent = {
      ...params.event,
      runId: params.event.runId ?? params.ctx.runId,
    };
    return normalizeBeforeAgentFinalizeResult(
      await hookRunner.runBeforeAgentFinalize(
        eventForNormalization,
        buildAgentHookContext(params.ctx),
      ),
      eventForNormalization,
    );
  } catch (error) {
    log.warn(`before_agent_finalize hook failed: ${String(error)}`);
    return { action: "continue" };
  }
}

function normalizeBeforeAgentFinalizeResult(
  result: PluginHookBeforeAgentFinalizeResult | undefined,
  event?: PluginHookBeforeAgentFinalizeEvent,
): AgentHarnessBeforeAgentFinalizeOutcome {
  if (result?.action === "finalize") {
    const reason = normalizeTrimmedString(result.reason);
    return reason ? { action: "finalize", reason } : { action: "finalize" };
  }
  if (result?.action === "revise") {
    const retryCandidates = readBeforeAgentFinalizeRetryCandidates(result);
    if (retryCandidates.length > 0) {
      const reason = normalizeTrimmedString(result.reason);
      for (const retry of retryCandidates) {
        const retryInstruction = normalizeTrimmedString(retry.instruction);
        if (!retryInstruction) {
          continue;
        }
        const maxAttempts =
          typeof retry.maxAttempts === "number" && Number.isFinite(retry.maxAttempts)
            ? Math.max(1, Math.floor(retry.maxAttempts))
            : 1;
        const retryRunId = event?.runId ?? event?.sessionId ?? "unknown-run";
        const retryKey =
          normalizeTrimmedString(retry.idempotencyKey) ||
          buildFinalizeRetryInstructionKey(retryInstruction);
        // Track retry attempts per run+instruction to prevent finalize hooks
        // from creating an unbounded revise loop.
        const budget = getFinalizeRetryBudget();
        const runBudget = budget.get(retryRunId) ?? new Map<string, number>();
        const nextCount = (runBudget.get(retryKey) ?? 0) + 1;
        runBudget.delete(retryKey);
        runBudget.set(retryKey, nextCount);
        budget.delete(retryRunId);
        budget.set(retryRunId, runBudget);
        pruneFinalizeRetryBudget(budget);
        if (nextCount > maxAttempts) {
          continue;
        }
        const revisedReason =
          reason && reason.includes(retryInstruction)
            ? reason
            : [reason, retryInstruction].filter(Boolean).join("\n\n");
        return { action: "revise", reason: revisedReason };
      }
      return { action: "continue" };
    }
    const reason = normalizeTrimmedString(result.reason);
    return reason ? { action: "revise", reason } : { action: "continue" };
  }
  return { action: "continue" };
}

function readBeforeAgentFinalizeRetryCandidates(
  result: PluginHookBeforeAgentFinalizeResult,
): NonNullable<PluginHookBeforeAgentFinalizeResult["retry"]>[] {
  const candidateList = (
    result as {
      retryCandidates?: unknown;
    }
  ).retryCandidates;
  if (Array.isArray(candidateList) && candidateList.length > 0) {
    return candidateList.filter(isBeforeAgentFinalizeRetry);
  }
  return isBeforeAgentFinalizeRetry(result.retry) ? [result.retry] : [];
}

function isBeforeAgentFinalizeRetry(
  value: unknown,
): value is NonNullable<PluginHookBeforeAgentFinalizeResult["retry"]> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
