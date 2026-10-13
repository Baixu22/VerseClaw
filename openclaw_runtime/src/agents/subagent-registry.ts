/**
 * Subagent registry coordinator.
 *
 * Owns registration, lifecycle, delivery retry, steering, orphan recovery, persistence, and cleanup for child runs.
 */
import type { cleanupBrowserSessionsForLifecycleEnd } from "../browser-lifecycle-cleanup.js";
import { getRuntimeConfig } from "../config/config.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import type { ResolveContextEngineOptions } from "../context-engine/registry.js";
import type { ContextEngine, SubagentEndReason } from "../context-engine/types.js";
import { callGateway } from "../gateway/call.js";
import { getAgentRunContext, onAgentEvent } from "../infra/agent-events.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { formatBlockedLivenessError, isBlockedLivenessState } from "../shared/agent-liveness.js";
import { createLazyImportLoader, createLazyPromiseLoader } from "../shared/lazy-promise.js";
import { buildSessionDeleteOperationId } from "../sessions/session-delete-operation-id.js";
import { importRuntimeModule } from "../shared/runtime-import.js";
import { normalizeDeliveryContext } from "../utils/delivery-context.shared.js";
import type { DeliveryContext } from "../utils/delivery-context.types.js";
import {
  ackLeasedAgentSteeringItemsFromSubagentRuns,
  leasePendingAgentSteeringItemsFromSubagentRuns,
  prependAgentSteeringPrompt,
  releaseLeasedAgentSteeringItemsFromSubagentRuns,
} from "./agent-steering-queue.js";
import { makeTaskLedgerEntry, taskGraphVerifierNode } from "./orchestration-protocol.js";
import { removeInternalSessionEffectsTranscript } from "./internal-session-effects.js";
import { isAbortedAgentStopReason } from "./run-termination.js";
import type { ensureRuntimePluginsLoaded as ensureRuntimePluginsLoadedFn } from "./runtime-plugins.js";
import type { SubagentRunOutcome } from "./subagent-announce-output.js";
import {
  ensureCompletionState,
  ensureDeliveryState,
  getDeliveryAttemptCount,
  getDeliveryLastAttemptAt,
  getDeliveryLastError,
  isDeliverySuspended,
} from "./subagent-delivery-state.js";
import {
  SUBAGENT_ENDED_REASON_COMPLETE,
  SUBAGENT_ENDED_REASON_ERROR,
  SUBAGENT_ENDED_REASON_KILLED,
  type SubagentLifecycleEndedReason,
} from "./subagent-lifecycle-events.js";
import {
  emitSubagentEndedHookOnce,
  resolveLifecycleOutcomeFromRunOutcome,
} from "./subagent-registry-completion.js";
import {
  ANNOUNCE_EXPIRY_MS,
  MAX_ANNOUNCE_RETRY_COUNT,
  reconcileOrphanedRestoredRuns,
  reconcileOrphanedRun,
  resolveAnnounceRetryDelayMs,
  resolveSubagentRunOrphanReason,
  safeRemoveAttachmentsDir,
} from "./subagent-registry-helpers.js";
import { createSubagentRegistryLifecycleController } from "./subagent-registry-lifecycle.js";
import { subagentRuns } from "./subagent-registry-memory.js";
import {
  countActiveDescendantRunsFromRuns,
  countActiveRunsForSessionFromRuns,
  countPendingDescendantRunsExcludingRunFromRuns,
  countPendingDescendantRunsFromRuns,
  getSubagentRunByChildSessionKeyFromRuns,
  isSubagentSessionRunActiveFromRuns,
  listRunsForControllerFromRuns,
  listDescendantRunsForRequesterFromRuns,
  listRunsForRequesterFromRuns,
  resolveRequesterForChildSessionFromRuns,
  shouldIgnorePostCompletionAnnounceForSessionFromRuns,
} from "./subagent-registry-queries.js";
import {
  createSubagentRunManager,
  markSubagentRunPausedAfterYield,
  type RegisterSubagentRunParams,
} from "./subagent-registry-run-manager.js";
import {
  clearSubagentRunsReadCacheForTest,
  getSubagentRunsSnapshotForRead,
  persistSubagentRunsToDisk,
  persistSubagentRunsToDiskOrThrow,
  restoreSubagentRunsFromDisk,
} from "./subagent-registry-state.js";
import { configureSubagentRegistrySteerRuntime } from "./subagent-registry-steer-runtime.js";
import type { SubagentRunRecord } from "./subagent-registry.types.js";
import {
  loadSubagentSessionEntry,
  resolveCompletionFromSessionEntry,
  resolveSubagentSessionCompletion,
  resolveSubagentSessionStartedAt,
  type SubagentSessionStoreCache,
} from "./subagent-session-reconciliation.js";
import { resolveAgentTimeoutMs } from "./timeout.js";

export type { SubagentRunRecord } from "./subagent-registry.types.js";
export {
  getSubagentSessionRuntimeMs,
  getSubagentSessionStartedAt,
  resolveSubagentSessionStatus,
} from "./subagent-registry-helpers.js";
const log = createSubsystemLogger("agents/subagent-registry");

type SubagentAnnounceModule = Pick<
  typeof import("./subagent-announce.js"),
  "captureSubagentCompletionReply" | "runSubagentAnnounceFlow"
>;
type BrowserCleanupModule = Pick<
  typeof import("../browser-lifecycle-cleanup.js"),
  "cleanupBrowserSessionsForLifecycleEnd"
>;

type SubagentRegistryDeps = {
  callGateway: typeof callGateway;
  captureSubagentCompletionReply: SubagentAnnounceModule["captureSubagentCompletionReply"];
  cleanupBrowserSessionsForLifecycleEnd: typeof cleanupBrowserSessionsForLifecycleEnd;
  getSubagentRunsSnapshotForRead: typeof getSubagentRunsSnapshotForRead;
  getRuntimeConfig: typeof getRuntimeConfig;
  onAgentEvent: typeof onAgentEvent;
  persistSubagentRunsToDisk: typeof persistSubagentRunsToDisk;
  persistSubagentRunsToDiskOrThrow: typeof persistSubagentRunsToDiskOrThrow;
  resolveAgentTimeoutMs: typeof resolveAgentTimeoutMs;
  restoreSubagentRunsFromDisk: typeof restoreSubagentRunsFromDisk;
  runSubagentAnnounceFlow: SubagentAnnounceModule["runSubagentAnnounceFlow"];
  ensureContextEnginesInitialized?: () => void;
  ensureRuntimePluginsLoaded?: typeof ensureRuntimePluginsLoadedFn;
  resolveContextEngine?: (
    cfg?: OpenClawConfig,
    options?: ResolveContextEngineOptions,
  ) => Promise<ContextEngine>;
};

const subagentAnnounceLoader = createLazyImportLoader<SubagentAnnounceModule>(
  () => import("./subagent-announce.js"),
);
const browserCleanupLoader = createLazyImportLoader<BrowserCleanupModule>(
  () => import("../browser-lifecycle-cleanup.js"),
);

async function loadSubagentAnnounceModule(): Promise<SubagentAnnounceModule> {
  return await subagentAnnounceLoader.load();
}

async function loadCleanupBrowserSessionsForLifecycleEnd(): Promise<
  BrowserCleanupModule["cleanupBrowserSessionsForLifecycleEnd"]
> {
  return (await browserCleanupLoader.load()).cleanupBrowserSessionsForLifecycleEnd;
}

const defaultSubagentRegistryDeps: SubagentRegistryDeps = {
  callGateway,
  captureSubagentCompletionReply: async (sessionKey, options) =>
    (await loadSubagentAnnounceModule()).captureSubagentCompletionReply(sessionKey, options),
  cleanupBrowserSessionsForLifecycleEnd: async (params) =>
    (await loadCleanupBrowserSessionsForLifecycleEnd())(params),
  getSubagentRunsSnapshotForRead,
  getRuntimeConfig,
  onAgentEvent,
  persistSubagentRunsToDisk,
  persistSubagentRunsToDiskOrThrow,
  resolveAgentTimeoutMs,
  restoreSubagentRunsFromDisk,
  runSubagentAnnounceFlow: async (params) =>
    (await loadSubagentAnnounceModule()).runSubagentAnnounceFlow(params),
};

let subagentRegistryDeps: SubagentRegistryDeps = defaultSubagentRegistryDeps;
type ContextEngineInitModule = Pick<
  {
    ensureContextEnginesInitialized: () => void;
  },
  "ensureContextEnginesInitialized"
>;
type ContextEngineRegistryModule = Pick<
  {
    resolveContextEngine: (
      cfg?: OpenClawConfig,
      options?: ResolveContextEngineOptions,
    ) => Promise<ContextEngine>;
  },
  "resolveContextEngine"
>;
type RuntimePluginsModule = Pick<
  {
    ensureRuntimePluginsLoaded: typeof ensureRuntimePluginsLoadedFn;
  },
  "ensureRuntimePluginsLoaded"
>;

const SUBAGENT_REGISTRY_RUNTIME_SPEC = ["./subagent-registry.runtime", ".js"] as const;

const contextEngineInitLoader = createLazyPromiseLoader(() =>
  importRuntimeModule<ContextEngineInitModule>(import.meta.url, SUBAGENT_REGISTRY_RUNTIME_SPEC),
);
const contextEngineRegistryLoader = createLazyPromiseLoader(() =>
  importRuntimeModule<ContextEngineRegistryModule>(import.meta.url, SUBAGENT_REGISTRY_RUNTIME_SPEC),
);
const runtimePluginsLoader = createLazyPromiseLoader(() =>
  importRuntimeModule<RuntimePluginsModule>(import.meta.url, SUBAGENT_REGISTRY_RUNTIME_SPEC),
);

let sweeper: NodeJS.Timeout | null = null;
const resumeRetryTimers = new Set<ReturnType<typeof setTimeout>>();
let sweepInProgress = false;
let listenerStarted = false;
let listenerStop: (() => void) | null = null;
// Use var to avoid TDZ when init runs across circular imports during bootstrap.
let restoreAttempted = false;
const ORPHAN_RECOVERY_DEBOUNCE_MS = 1_000;
let lastOrphanRecoveryScheduleAt = 0;
const SUBAGENT_ANNOUNCE_TIMEOUT_MS = 120_000;
/**
 * Embedded runs can emit transient lifecycle `error` events while provider/model
 * retry is still in progress. Defer terminal error cleanup briefly so a
 * subsequent lifecycle `start` / `end` can cancel premature failure announces.
 */
const LIFECYCLE_ERROR_RETRY_GRACE_MS = 15_000;
/**
 * Embedded runs can also surface an intermediate lifecycle `end` with
 * `aborted=true` just before the runtime automatically retries the same run.
 * Give that timeout a short grace window so the parent does not get a stale
 * `timed out` completion right before the eventual success.
 */
const LIFECYCLE_TIMEOUT_RETRY_GRACE_MS = 15_000;
/** Absolute TTL for session-mode runs after cleanup completes (no archiveAtMs). */
const SESSION_RUN_TTL_MS = 5 * 60_000; // 5 minutes
/** Absolute TTL for orphaned pendingLifecycleError / pendingLifecycleTimeout entries. */
const PENDING_LIFECYCLE_TERMINAL_TTL_MS = 5 * 60_000; // 5 minutes
/** Grace period before treating a "running" subagent without a live run context as stale. */
const STALE_ACTIVE_SUBAGENT_GRACE_MS = process.env.OPENCLAW_TEST_FAST === "1" ? 1_000 : 60_000;
const SUSPENDED_DELIVERY_CRON_EXPIRY_MS = 2 * 60 * 60_000;
const SUSPENDED_DELIVERY_SUBAGENT_EXPIRY_MS = 6 * 60 * 60_000;
const SUSPENDED_DELIVERY_INTERACTIVE_EXPIRY_MS = 24 * 60 * 60_000;
const SUSPENDED_DELIVERY_SOFT_CAP = 25;
const SUSPENDED_DELIVERY_HARD_CAP = 50;
const SUSPENDED_DELIVERY_PRESSURE_TARGET = 10;
const ORCHESTRATION_VERIFIER_STARTING = "__starting__";

function loadContextEngineInitModule(): Promise<ContextEngineInitModule> {
  return contextEngineInitLoader.load();
}

function loadContextEngineRegistryModule(): Promise<ContextEngineRegistryModule> {
  return contextEngineRegistryLoader.load();
}

function loadRuntimePluginsModule(): Promise<RuntimePluginsModule> {
  return runtimePluginsLoader.load();
}

async function ensureSubagentRegistryPluginRuntimeLoaded(params: {
  config: OpenClawConfig;
  workspaceDir?: string;
  allowGatewaySubagentBinding?: boolean;
}) {
  const ensureRuntimePluginsLoaded = subagentRegistryDeps.ensureRuntimePluginsLoaded;
  if (ensureRuntimePluginsLoaded) {
    ensureRuntimePluginsLoaded(params);
    return;
  }
  (await loadRuntimePluginsModule()).ensureRuntimePluginsLoaded(params);
}

async function resolveSubagentRegistryContextEngine(
  cfg: OpenClawConfig,
  options?: ResolveContextEngineOptions,
) {
  const initModule = await loadContextEngineInitModule();
  const registryModule = await loadContextEngineRegistryModule();
  const ensureContextEnginesInitialized =
    subagentRegistryDeps.ensureContextEnginesInitialized ??
    initModule.ensureContextEnginesInitialized;
  const resolveContextEngine =
    subagentRegistryDeps.resolveContextEngine ?? registryModule.resolveContextEngine;
  ensureContextEnginesInitialized();
  return await resolveContextEngine(cfg, options);
}

function persistSubagentRuns() {
  subagentRegistryDeps.persistSubagentRunsToDisk(subagentRuns);
}

function persistSubagentRunsOrThrow() {
  subagentRegistryDeps.persistSubagentRunsToDiskOrThrow(subagentRuns);
}

export function scheduleSubagentOrphanRecovery(params?: { delayMs?: number; maxRetries?: number }) {
  const now = Date.now();
  if (now - lastOrphanRecoveryScheduleAt < ORPHAN_RECOVERY_DEBOUNCE_MS) {
    return;
  }
  lastOrphanRecoveryScheduleAt = now;
  void import("./subagent-orphan-recovery.js").then(
    ({ scheduleOrphanRecovery }) => {
      scheduleOrphanRecovery({
        getActiveRuns: () => subagentRuns,
        delayMs: params?.delayMs,
        maxRetries: params?.maxRetries,
      });
    },
    () => {
      // Ignore import failures — orphan recovery is best-effort.
    },
  );
}

const resumedRuns = new Set<string>();
const endedHookInFlightRunIds = new Set<string>();
const pendingLifecycleErrorByRunId = new Map<
  string,
  {
    timer: NodeJS.Timeout;
    endedAt: number;
    startedAt?: number;
    error?: string;
  }
>();
const pendingLifecycleTimeoutByRunId = new Map<
  string,
  {
    timer: NodeJS.Timeout;
    endedAt: number;
    startedAt?: number;
  }
>();

function clearPendingLifecycleError(runId: string) {
  const pending = pendingLifecycleErrorByRunId.get(runId);
  if (!pending) {
    return;
  }
  clearTimeout(pending.timer);
  pendingLifecycleErrorByRunId.delete(runId);
}

function clearAllPendingLifecycleErrors() {
  for (const pending of pendingLifecycleErrorByRunId.values()) {
    clearTimeout(pending.timer);
  }
  pendingLifecycleErrorByRunId.clear();
}

function clearPendingLifecycleTimeout(runId: string) {
  const pending = pendingLifecycleTimeoutByRunId.get(runId);
  if (!pending) {
    return;
  }
  clearTimeout(pending.timer);
  pendingLifecycleTimeoutByRunId.delete(runId);
}

function clearAllPendingLifecycleTimeouts() {
  for (const pending of pendingLifecycleTimeoutByRunId.values()) {
    clearTimeout(pending.timer);
  }
  pendingLifecycleTimeoutByRunId.clear();
}

type CompleteSubagentRunParams = {
  runId: string;
  endedAt?: number;
  outcome: SubagentRunOutcome;
  reason: SubagentLifecycleEndedReason;
  sendFarewell?: boolean;
  accountId?: string;
  triggerCleanup: boolean;
  startedAt?: number;
};

async function completeSubagentRunWithRecovery(params: CompleteSubagentRunParams, source: string) {
  try {
    await completeSubagentRun(params);
    await maybeStartDeferredOrchestrationVerifier(params.runId);
    return;
  } catch (error) {
    const current = subagentRuns.get(params.runId);
    log.warn("failed to complete subagent run; retrying completion", {
      source,
      runId: params.runId,
      childSessionKey: current?.childSessionKey,
      error,
    });
  }

  const current = subagentRuns.get(params.runId);
  if (
    !current ||
    typeof current.endedAt !== "number" ||
    typeof current.cleanupCompletedAt === "number" ||
    current.pauseReason === "sessions_yield"
  ) {
    return;
  }

  try {
    await completeSubagentRun(params);
    await maybeStartDeferredOrchestrationVerifier(params.runId);
    return;
  } catch (retryError) {
    log.warn("failed to complete subagent run after retry; retrying ended cleanup", {
      source,
      runId: params.runId,
      childSessionKey: current.childSessionKey,
      error: retryError,
    });
  }

  const latest = subagentRuns.get(params.runId);
  if (
    !latest ||
    typeof latest.endedAt !== "number" ||
    typeof latest.cleanupCompletedAt === "number" ||
    latest.pauseReason === "sessions_yield"
  ) {
    return;
  }
  latest.cleanupHandled = false;
  resumedRuns.delete(params.runId);
  resumeSubagentRun(params.runId);
}

function completeSubagentRunInBackground(params: CompleteSubagentRunParams, source: string) {
  void completeSubagentRunWithRecovery(params, source);
}

function listOrchestrationWorkers(orchestrationRunId: string): SubagentRunRecord[] {
  return [...subagentRuns.values()].filter(
    (entry) =>
      entry.orchestration?.orchestrationRunId === orchestrationRunId &&
      entry.orchestration.phase === "worker",
  );
}

function markOrchestrationWorkers(params: {
  workers: SubagentRunRecord[];
  patch: Partial<NonNullable<SubagentRunRecord["orchestration"]>>;
}) {
  for (const worker of params.workers) {
    if (!worker.orchestration) {
      continue;
    }
    worker.orchestration = { ...worker.orchestration, ...params.patch };
    if (worker.delivery?.payload?.orchestration) {
      worker.delivery.payload = {
        ...worker.delivery.payload,
        orchestration: worker.orchestration,
      };
    }
  }
  persistSubagentRuns();
}

function selectResultTextForOrchestration(entry: SubagentRunRecord): string {
  return (
    entry.completion?.resultText?.trim() ||
    entry.completion?.fallbackResultText?.trim() ||
    "No completion text was captured."
  );
}

function applyOrchestrationWorkerPatch(
  worker: SubagentRunRecord,
  patch: Partial<NonNullable<SubagentRunRecord["orchestration"]>>,
): void {
  if (!worker.orchestration) return;
  worker.orchestration = { ...worker.orchestration, ...patch };
  if (worker.delivery?.payload?.orchestration) {
    worker.delivery.payload = {
      ...worker.delivery.payload,
      orchestration: worker.orchestration,
    };
  }
}

async function processCompletedOrchestrationWorktrees(
  workers: readonly SubagentRunRecord[],
): Promise<void> {
  const worktreeWorkers = workers.filter(
    (worker) =>
      worker.orchestration?.isolation === "worktree" &&
      typeof worker.orchestration.worktreeId === "string" &&
      worker.orchestration.worktreeId.length > 0,
  );
  const unprocessed = worktreeWorkers.filter(
    (worker) => typeof worker.orchestration?.worktreeMergeProcessedAt !== "number",
  );
  if (unprocessed.length === 0) return;

  const processedAt = Date.now();
  const mergeable = unprocessed.filter((worker) => worker.outcome?.status === "ok");
  const failed = unprocessed.filter((worker) => worker.outcome?.status !== "ok");
  for (const worker of failed) {
    applyOrchestrationWorkerPatch(worker, {
      worktreeMergeStatus: "error",
      worktreeWriteSetMismatch: [],
      worktreeMergeReason: `worker_failed:${worker.outcome?.status ?? "unknown"}`,
      worktreeMergeProcessedAt: processedAt,
    });
  }
  if (mergeable.length === 0) {
    persistSubagentRuns();
    return;
  }

  const baseRoot = mergeable.find((worker) => worker.workspaceDir)?.workspaceDir;
  if (!baseRoot) {
    for (const worker of mergeable) {
      applyOrchestrationWorkerPatch(worker, {
        worktreeMergeStatus: "error",
        worktreeWriteSetMismatch: [],
        worktreeMergeReason: "workspaceDir-unavailable",
        worktreeMergeProcessedAt: processedAt,
      });
    }
    persistSubagentRuns();
    return;
  }

  try {
    const { mergeOrchestrationWorktrees } = await import("./orchestration-worktree-merge.js");
    const results = mergeOrchestrationWorktrees({
      baseRoot,
      workers: mergeable.map((worker) => ({
        taskNodeId: worker.orchestration?.taskNodeId ?? worker.runId,
        worktreeId: worker.orchestration!.worktreeId!,
        declaredWriteSet: worker.orchestration?.worktreeWriteSet ?? [],
      })),
      conflictPolicy: "mark_conflict",
    });
    const byWorktreeId = new Map(results.map((result) => [result.worktreeId, result]));
    for (const worker of mergeable) {
      const result = byWorktreeId.get(worker.orchestration!.worktreeId!);
      applyOrchestrationWorkerPatch(worker, {
        worktreeMergeStatus: result?.status ?? "error",
        worktreeWriteSetMismatch: result?.writeSetMismatch ?? [],
        ...(result?.reason ? { worktreeMergeReason: result.reason } : {}),
        worktreeMergeProcessedAt: processedAt,
      });
    }
  } catch (error) {
    log.warn("failed to process orchestration worktree merges", { error });
    for (const worker of mergeable) {
      applyOrchestrationWorkerPatch(worker, {
        worktreeMergeStatus: "error",
        worktreeWriteSetMismatch: [],
        worktreeMergeReason: error instanceof Error ? error.message : String(error),
        worktreeMergeProcessedAt: processedAt,
      });
    }
  }
  persistSubagentRuns();
}function buildVerifierTask(params: { originalTask: string; workers: SubagentRunRecord[] }): string {
  const sections = params.workers.map((worker, index) => {
    const meta = worker.orchestration;
    const status = worker.outcome?.status ?? "unknown";
    const error = worker.outcome?.status === "error" ? worker.outcome.error : undefined;
    return [
      `### Worker ${index + 1}: ${meta?.roleName ?? worker.label ?? worker.runId}`,
      `roleName: ${meta?.roleName ?? "unknown"}`,
      `childRunId: ${worker.runId}`,
      `childSessionKey: ${worker.childSessionKey}`,
      `status: ${status}${error ? ` (${error})` : ""}`,
      "",
      selectResultTextForOrchestration(worker),
    ].join("\n");
  });
  return [
    `Verify completion of: ${params.originalTask}`,
    "",
    "Use only the worker evidence below. Do not expand scope or start new implementation work.",
    "Return a final line exactly in this form: verificationVerdict=pass|fail|repair_required. Do not omit it.",
    "",
    "## Worker Result Bundle",
    ...sections,
  ].join("\n\n");
}

async function maybeStartDeferredOrchestrationVerifier(completedRunId: string): Promise<void> {
  const completed = subagentRuns.get(completedRunId);
  const completedMeta = completed?.orchestration;
  if (!completed || !completedMeta || completedMeta.phase !== "worker") {
    return;
  }
  const orchestrationRunId = completedMeta.orchestrationRunId;
  const workers = listOrchestrationWorkers(orchestrationRunId);
  const expectedWorkerRunIds =
    completedMeta.expectedWorkerRunIds?.length
      ? completedMeta.expectedWorkerRunIds
      : workers.map((worker) => worker.runId);
  const expectedWorkers = expectedWorkerRunIds
    .map((runId) => subagentRuns.get(runId))
    .filter((entry): entry is SubagentRunRecord => Boolean(entry?.orchestration));
  if (expectedWorkers.length !== expectedWorkerRunIds.length) {
    return;
  }
  if (expectedWorkers.some((worker) => typeof worker.endedAt !== "number")) {
    return;
  }
  await processCompletedOrchestrationWorktrees(expectedWorkers);
  const latestMeta = expectedWorkers.find((worker) => worker.orchestration)?.orchestration;
  if (!latestMeta) {
    return;
  }
  if (latestMeta.verifierStartedRunId || latestMeta.verifierSkippedReason) {
    return;
  }
  if (!latestMeta.verifierRole) {
    markOrchestrationWorkers({
      workers: expectedWorkers,
      patch: { verifierSkippedReason: "no-verifier-role", verifierSkippedAt: Date.now() },
    });
    return;
  }
  const successfulWorkers = expectedWorkers.filter((worker) => worker.outcome?.status === "ok");
  if (successfulWorkers.length === 0) {
    markOrchestrationWorkers({
      workers: expectedWorkers,
      patch: { verifierSkippedReason: "all-workers-failed", verifierSkippedAt: Date.now() },
    });
    return;
  }
  markOrchestrationWorkers({
    workers: expectedWorkers,
    patch: { verifierStartedRunId: ORCHESTRATION_VERIFIER_STARTING, verifierStartedAt: Date.now() },
  });
  try {
    const [{ spawnRoleSubagent }, { spawnSubagentDirect }] = await Promise.all([
      import("./role-spawn.js"),
      import("./subagent-spawn.js"),
    ]);
    const cfg = subagentRegistryDeps.getRuntimeConfig();
    const verifierTask = buildVerifierTask({ originalTask: latestMeta.originalTask, workers: expectedWorkers });
    const verifierNode = latestMeta.taskGraph ? taskGraphVerifierNode(latestMeta.taskGraph) : undefined;
    const verifierLedger = makeTaskLedgerEntry({
      orchestrationRunId,
      roleName: latestMeta.verifierRole,
      task: verifierTask,
      index: expectedWorkers.length,
      phase: "verifier",
      requiredCapabilities: verifierNode?.requiredCapabilities ?? latestMeta.requiredCapabilities ?? latestMeta.routeDiagnostics?.requiredCapabilities ?? [],
      taskNodeId: verifierNode?.taskNodeId,
      graphRunId: latestMeta.graphRunId,
      dependsOn: verifierNode?.dependsOn,
      executionWave: latestMeta.executionWaves?.at(-1)?.wave,
      status: "planned",
      startedAt: Date.now(),
    });
    const verifier = await spawnRoleSubagent(
      {
        role: latestMeta.verifierRole,
        task: verifierTask,
        cfg: cfg as Parameters<typeof spawnRoleSubagent>[0]["cfg"],
        modelOverride: latestMeta.verifierModelRef ?? undefined,
        orchestration: {
          ...latestMeta,
          roleName: latestMeta.verifierRole,
          isVerifier: true,
          phase: "verifier",
          expectedWorkerRunIds,
          taskId: verifierLedger.taskId,
          roleInstanceId: verifierLedger.roleInstanceId,
          attempt: verifierLedger.attempt,
          scope: verifierLedger.scope,
          requiredCapabilities: verifierLedger.requiredCapabilities,
          ledger: verifierLedger,
          taskNodeId: verifierLedger.taskNodeId,
          graphRunId: verifierLedger.graphRunId,
          dependsOn: verifierLedger.dependsOn,
          executionWave: verifierLedger.executionWave,
        },
      },
      {
        agentSessionKey: completed.controllerSessionKey ?? completed.requesterSessionKey,
        completionOwnerKey: completed.requesterSessionKey,
        workspaceDir: completed.workspaceDir,
      },
      { spawn: spawnSubagentDirect },
    );
    const verifierRunId = verifier.result?.runId;
    if (verifier.status === "accepted" && verifierRunId) {
      markOrchestrationWorkers({
        workers: expectedWorkers,
        patch: { verifierStartedRunId: verifierRunId },
      });
      updateSubagentRunOrchestrationMetadata(verifierRunId, { expectedWorkerRunIds });
      return;
    }
    markOrchestrationWorkers({
      workers: expectedWorkers,
      patch: { verifierSkippedReason: "spawn-failed", verifierSkippedAt: Date.now() },
    });
  } catch (error) {
    log.warn("failed to start deferred orchestration verifier", { orchestrationRunId, error });
    markOrchestrationWorkers({
      workers: expectedWorkers,
      patch: { verifierSkippedReason: "spawn-failed", verifierSkippedAt: Date.now() },
    });
  }
}

function schedulePendingLifecycleError(params: {
  runId: string;
  endedAt: number;
  startedAt?: number;
  error?: string;
}) {
  clearPendingLifecycleTimeout(params.runId);
  clearPendingLifecycleError(params.runId);
  const timer = setTimeout(() => {
    const pending = pendingLifecycleErrorByRunId.get(params.runId);
    if (!pending || pending.timer !== timer) {
      return;
    }
    pendingLifecycleErrorByRunId.delete(params.runId);
    const entry = subagentRuns.get(params.runId);
    if (!entry) {
      return;
    }
    if (entry.endedReason === SUBAGENT_ENDED_REASON_COMPLETE || entry.outcome?.status === "ok") {
      return;
    }
    const completionParams = {
      runId: params.runId,
      endedAt: pending.endedAt,
      outcome: {
        status: "error" as const,
        error: pending.error,
      },
      reason: SUBAGENT_ENDED_REASON_ERROR,
      sendFarewell: true,
      accountId: entry.requesterOrigin?.accountId,
      triggerCleanup: true,
      startedAt: pending.startedAt,
    };
    completeSubagentRunInBackground(completionParams, "lifecycle-error-grace");
  }, LIFECYCLE_ERROR_RETRY_GRACE_MS);
  timer.unref?.();
  pendingLifecycleErrorByRunId.set(params.runId, {
    timer,
    endedAt: params.endedAt,
    startedAt: params.startedAt,
    error: params.error,
  });
}

function schedulePendingLifecycleTimeout(params: {
  runId: string;
  endedAt: number;
  startedAt?: number;
}) {
  clearPendingLifecycleError(params.runId);
  clearPendingLifecycleTimeout(params.runId);
  const timer = setTimeout(() => {
    const pending = pendingLifecycleTimeoutByRunId.get(params.runId);
    if (!pending || pending.timer !== timer) {
      return;
    }
    pendingLifecycleTimeoutByRunId.delete(params.runId);
    const entry = subagentRuns.get(params.runId);
    if (!entry) {
      return;
    }
    if (entry.outcome?.status === "ok") {
      return;
    }
    const completionParams = {
      runId: params.runId,
      endedAt: pending.endedAt,
      outcome: {
        status: "timeout" as const,
      },
      reason: SUBAGENT_ENDED_REASON_COMPLETE,
      sendFarewell: true,
      accountId: entry.requesterOrigin?.accountId,
      triggerCleanup: true,
      startedAt: pending.startedAt,
    };
    completeSubagentRunInBackground(completionParams, "lifecycle-timeout-grace");
  }, LIFECYCLE_TIMEOUT_RETRY_GRACE_MS);
  timer.unref?.();
  pendingLifecycleTimeoutByRunId.set(params.runId, {
    timer,
    endedAt: params.endedAt,
    startedAt: params.startedAt,
  });
}

async function notifyContextEngineSubagentEnded(params: {
  childSessionKey: string;
  reason: SubagentEndReason;
  agentDir?: string;
  workspaceDir?: string;
}) {
  try {
    const cfg = subagentRegistryDeps.getRuntimeConfig();
    await ensureSubagentRegistryPluginRuntimeLoaded({
      config: cfg,
      workspaceDir: params.workspaceDir,
      allowGatewaySubagentBinding: true,
    });
    const engine = await resolveSubagentRegistryContextEngine(cfg, {
      agentDir: params.agentDir,
      workspaceDir: params.workspaceDir,
    });
    if (!engine.onSubagentEnded) {
      return;
    }
    await engine.onSubagentEnded(params);
  } catch (err) {
    log.warn("context-engine onSubagentEnded failed (best-effort)", { err });
  }
}

function suppressAnnounceForSteerRestart(entry?: SubagentRunRecord) {
  return entry?.suppressAnnounceReason === "steer-restart";
}

function shouldKeepThreadBindingAfterRun(params: {
  entry: SubagentRunRecord;
  reason: SubagentLifecycleEndedReason;
}) {
  if (params.reason === SUBAGENT_ENDED_REASON_KILLED) {
    return false;
  }
  return params.entry.spawnMode === "session";
}

function shouldEmitEndedHookForRun(params: {
  entry: SubagentRunRecord;
  reason: SubagentLifecycleEndedReason;
}) {
  return !shouldKeepThreadBindingAfterRun(params);
}

async function emitSubagentEndedHookForRun(params: {
  entry: SubagentRunRecord;
  reason?: SubagentLifecycleEndedReason;
  sendFarewell?: boolean;
  accountId?: string;
}) {
  if (params.entry.endedHookEmittedAt) {
    return;
  }
  const cfg = subagentRegistryDeps.getRuntimeConfig();
  await ensureSubagentRegistryPluginRuntimeLoaded({
    config: cfg,
    workspaceDir: params.entry.workspaceDir,
    allowGatewaySubagentBinding: true,
  });
  const reason = params.reason ?? params.entry.endedReason ?? SUBAGENT_ENDED_REASON_COMPLETE;
  const outcome = resolveLifecycleOutcomeFromRunOutcome(params.entry.outcome);
  const error = params.entry.outcome?.status === "error" ? params.entry.outcome.error : undefined;
  await emitSubagentEndedHookOnce({
    entry: params.entry,
    reason,
    sendFarewell: params.sendFarewell,
    accountId: params.accountId ?? params.entry.requesterOrigin?.accountId,
    outcome,
    error,
    inFlightRunIds: endedHookInFlightRunIds,
    persist: persistSubagentRuns,
  });
}

const subagentLifecycleController = createSubagentRegistryLifecycleController({
  runs: subagentRuns,
  resumedRuns,
  subagentAnnounceTimeoutMs: SUBAGENT_ANNOUNCE_TIMEOUT_MS,
  persist: persistSubagentRuns,
  clearPendingLifecycleError,
  countPendingDescendantRuns,
  suppressAnnounceForSteerRestart,
  shouldEmitEndedHookForRun,
  emitSubagentEndedHookForRun,
  notifyContextEngineSubagentEnded,
  resumeSubagentRun,
  callGateway: (request) => subagentRegistryDeps.callGateway(request),
  captureSubagentCompletionReply: (sessionKey, options) =>
    subagentRegistryDeps.captureSubagentCompletionReply(sessionKey, options),
  cleanupBrowserSessionsForLifecycleEnd: (args) =>
    subagentRegistryDeps.cleanupBrowserSessionsForLifecycleEnd(args),
  runSubagentAnnounceFlow: (params) => subagentRegistryDeps.runSubagentAnnounceFlow(params),
  warn: (message, meta) => log.warn(message, meta),
});

const {
  clearScheduledResumeTimers,
  completeCleanupBookkeeping,
  completeSubagentRun,
  finalizeResumedAnnounceGiveUp,
  refreshFrozenResultFromSession,
  startSubagentAnnounceCleanupFlow,
} = subagentLifecycleController;

function resumeSubagentRun(runId: string) {
  if (!runId || resumedRuns.has(runId)) {
    return;
  }
  const entry = subagentRuns.get(runId);
  if (!entry) {
    return;
  }
  if (entry.cleanupCompletedAt) {
    return;
  }
  if (typeof entry.endedAt === "number" && isDeliverySuspended(entry)) {
    return;
  }
  if (entry.pauseReason === "sessions_yield") {
    return;
  }
  // Skip entries that have exhausted their retry budget or expired (#18264).
  if (getDeliveryAttemptCount(entry) >= MAX_ANNOUNCE_RETRY_COUNT) {
    void finalizeResumedAnnounceGiveUp({
      runId,
      entry,
      reason: "retry-limit",
    });
    return;
  }
  if (
    entry.expectsCompletionMessage !== true &&
    typeof entry.endedAt === "number" &&
    Date.now() - entry.endedAt > ANNOUNCE_EXPIRY_MS
  ) {
    void finalizeResumedAnnounceGiveUp({
      runId,
      entry,
      reason: "expiry",
    });
    return;
  }

  const now = Date.now();
  const lastAttemptAt = getDeliveryLastAttemptAt(entry);
  const delayMs = resolveAnnounceRetryDelayMs(getDeliveryAttemptCount(entry));
  const earliestRetryAt = (lastAttemptAt ?? 0) + delayMs;
  if (entry.expectsCompletionMessage === true && lastAttemptAt && now < earliestRetryAt) {
    const waitMs = Math.max(1, earliestRetryAt - now);
    const scheduledEntry = entry;
    const timer = setTimeout(() => {
      resumeRetryTimers.delete(timer);
      if (subagentRuns.get(runId) !== scheduledEntry) {
        return;
      }
      resumedRuns.delete(runId);
      resumeSubagentRun(runId);
    }, waitMs);
    timer.unref?.();
    resumeRetryTimers.add(timer);
    resumedRuns.add(runId);
    return;
  }

  if (typeof entry.endedAt === "number" && entry.endedAt > 0) {
    const orphanReason = resolveSubagentRunOrphanReason({ entry });
    if (orphanReason) {
      if (
        reconcileOrphanedRun({
          runId,
          entry,
          reason: orphanReason,
          source: "resume",
          runs: subagentRuns,
          resumedRuns,
        })
      ) {
        persistSubagentRuns();
      }
      return;
    }
    if (suppressAnnounceForSteerRestart(entry)) {
      resumedRuns.add(runId);
      return;
    }
    if (!startSubagentAnnounceCleanupFlow(runId, entry)) {
      return;
    }
    resumedRuns.add(runId);
    return;
  }

  // Wait for completion again after restart.
  const cfg = subagentRegistryDeps.getRuntimeConfig();
  const waitTimeoutMs = resolveSubagentWaitTimeoutMs(cfg, entry.runTimeoutSeconds);
  void subagentRunManager.waitForSubagentCompletion(runId, waitTimeoutMs, entry, true);
  resumedRuns.add(runId);
}

function restoreSubagentRunsOnce() {
  if (restoreAttempted) {
    return;
  }
  restoreAttempted = true;
  try {
    const restoredCount = subagentRegistryDeps.restoreSubagentRunsFromDisk({
      runs: subagentRuns,
      mergeOnly: true,
    });
    if (restoredCount === 0) {
      return;
    }
    if (
      reconcileOrphanedRestoredRuns({
        runs: subagentRuns,
        resumedRuns,
      })
    ) {
      persistSubagentRuns();
    }
    if (subagentRuns.size === 0) {
      return;
    }
    // Resume pending work.
    ensureListener();
    // Always start sweeper — session-mode runs (no archiveAtMs) also need TTL cleanup.
    startSweeper();
    for (const runId of subagentRuns.keys()) {
      resumeSubagentRun(runId);
    }

    // Cold-start restore path: queue the same recovery pass that restart
    // startup also uses so resumed children are handled through one seam.
    scheduleSubagentOrphanRecovery();
  } catch (err) {
    log.warn(
      `failed to restore subagent runs from disk: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function resolveSubagentWaitTimeoutMs(cfg: OpenClawConfig, runTimeoutSeconds?: number) {
  return subagentRegistryDeps.resolveAgentTimeoutMs({
    cfg,
    overrideSeconds: runTimeoutSeconds ?? 0,
  });
}

function startSweeper() {
  if (sweeper) {
    return;
  }
  sweeper = setInterval(() => {
    if (sweepInProgress) {
      return;
    }
    void sweepSubagentRuns();
  }, 60_000);
  sweeper.unref?.();
}

function stopSweeper() {
  if (!sweeper) {
    return;
  }
  clearInterval(sweeper);
  sweeper = null;
}

function isSuspendedPendingFinalDelivery(entry: SubagentRunRecord): boolean {
  return typeof entry.endedAt === "number" && isDeliverySuspended(entry);
}

function resolveSuspendedDeliveryExpiryMs(entry: SubagentRunRecord): number {
  const requester = entry.requesterSessionKey;
  if (requester.includes(":cron:")) {
    return SUSPENDED_DELIVERY_CRON_EXPIRY_MS;
  }
  if (requester.includes(":subagent:")) {
    return SUSPENDED_DELIVERY_SUBAGENT_EXPIRY_MS;
  }
  return SUSPENDED_DELIVERY_INTERACTIVE_EXPIRY_MS;
}

async function discardSuspendedPendingFinalDelivery(
  runId: string,
  entry: SubagentRunRecord,
  now: number,
  reason: "expired" | "pressure-pruned",
): Promise<void> {
  const delivery = ensureDeliveryState(entry);
  const payload = delivery.payload;
  delivery.status = "discarded";
  delivery.discardedAt = now;
  delivery.discardReason = reason;
  delivery.discardedPayloadSummary = {
    requesterSessionKey: payload?.requesterSessionKey ?? entry.requesterSessionKey,
    childSessionKey: payload?.childSessionKey ?? entry.childSessionKey,
    childRunId: payload?.childRunId ?? entry.runId,
    endedAt: payload?.endedAt ?? entry.endedAt,
    status: payload?.outcome?.status ?? entry.outcome?.status,
    lastError: getDeliveryLastError(entry) ?? null,
  };
  delivery.payload = undefined;
  delivery.createdAt = undefined;
  delivery.lastAttemptAt = undefined;
  delivery.attemptCount = undefined;
  delivery.lastError = undefined;
  delivery.suspendedAt = undefined;
  delivery.suspendedReason = undefined;
  entry.wakeOnDescendantSettle = undefined;
  const completion = ensureCompletionState(entry);
  completion.fallbackResultText = undefined;
  completion.fallbackCapturedAt = undefined;
  entry.cleanupHandled = true;
  delivery.announcedAt = undefined;
  resumedRuns.delete(runId);
  clearPendingLifecycleError(runId);
  clearPendingLifecycleTimeout(runId);
  log.warn("subagent suspended delivery discarded", {
    reason,
    runId: entry.runId,
    childSessionKey: entry.childSessionKey,
    requesterSessionKey: entry.requesterSessionKey,
  });
  const shouldDeleteAttachments = entry.cleanup === "delete" || !entry.retainAttachmentsOnKeep;
  if (shouldDeleteAttachments) {
    await safeRemoveAttachmentsDir(entry);
  }
  await removeInternalSessionEffectsTranscript(entry.execution?.transcriptFile);
  const completionReason = entry.endedReason ?? SUBAGENT_ENDED_REASON_COMPLETE;
  completeCleanupBookkeeping({
    runId,
    entry,
    cleanup: entry.cleanup,
    completedAt: now,
  });
  if (
    entry.expectsCompletionMessage === true &&
    shouldEmitEndedHookForRun({
      entry,
      reason: completionReason,
    })
  ) {
    await emitSubagentEndedHookForRun({
      entry,
      reason: completionReason,
      sendFarewell: true,
    });
  }
}

async function sweepSubagentRuns() {
  if (sweepInProgress) {
    return;
  }
  sweepInProgress = true;
  try {
    const now = Date.now();
    const storeCache: SubagentSessionStoreCache = new Map();
    let mutated = false;
    const suspendedEntries = [...subagentRuns.entries()].filter(([, entry]) =>
      isSuspendedPendingFinalDelivery(entry),
    );
    const pressureDiscardRunIds = new Set<string>();
    if (suspendedEntries.length > SUSPENDED_DELIVERY_HARD_CAP) {
      const pressureCount = Math.max(
        0,
        suspendedEntries.length - SUSPENDED_DELIVERY_PRESSURE_TARGET,
      );
      for (const [runId] of suspendedEntries
        .toSorted((a, b) => (a[1].delivery?.suspendedAt ?? 0) - (b[1].delivery?.suspendedAt ?? 0))
        .slice(0, pressureCount)) {
        pressureDiscardRunIds.add(runId);
      }
      log.warn("subagent suspended delivery backlog exceeded pressure cap", {
        suspendedCount: suspendedEntries.length,
        softCap: SUSPENDED_DELIVERY_SOFT_CAP,
        hardCap: SUSPENDED_DELIVERY_HARD_CAP,
        pressureTarget: SUSPENDED_DELIVERY_PRESSURE_TARGET,
        pressureDiscardCount: pressureDiscardRunIds.size,
      });
    }
    for (const [runId, entry] of subagentRuns.entries()) {
      if (isSuspendedPendingFinalDelivery(entry)) {
        const suspendedAgeMs = now - (entry.delivery?.suspendedAt ?? now);
        const expired = suspendedAgeMs >= resolveSuspendedDeliveryExpiryMs(entry);
        if (expired || pressureDiscardRunIds.has(runId)) {
          await discardSuspendedPendingFinalDelivery(
            runId,
            entry,
            now,
            expired ? "expired" : "pressure-pruned",
          );
          mutated = true;
        }
        continue;
      }
      if (typeof entry.endedAt !== "number") {
        const hasLiveRunContext = Boolean(getAgentRunContext(runId));
        const activeAgeMs = now - (entry.startedAt ?? entry.createdAt);
        if (!hasLiveRunContext && activeAgeMs >= STALE_ACTIVE_SUBAGENT_GRACE_MS) {
          const orphanReason = resolveSubagentRunOrphanReason({
            entry,
            storeCache,
          });
          if (orphanReason) {
            if (
              reconcileOrphanedRun({
                runId,
                entry,
                reason: orphanReason,
                source: "resume",
                runs: subagentRuns,
                resumedRuns,
              })
            ) {
              mutated = true;
            }
            continue;
          }

          const sessionEntry = loadSubagentSessionEntry({
            childSessionKey: entry.childSessionKey,
            storeCache,
          });
          const completion = resolveCompletionFromSessionEntry(sessionEntry, now, {
            notBeforeMs: entry.startedAt ?? entry.createdAt,
          });
          if (completion) {
            await completeSubagentRunWithRecovery(
              {
                runId,
                startedAt: completion.startedAt,
                endedAt: completion.endedAt,
                outcome: completion.outcome,
                reason: completion.reason,
                sendFarewell: true,
                accountId: entry.requesterOrigin?.accountId,
                triggerCleanup: true,
              },
              "sweeper-session-completion",
            );
            continue;
          }

          if (sessionEntry?.abortedLastRun === true) {
            scheduleSubagentOrphanRecovery({ delayMs: 1_000 });
            continue;
          }

          await completeSubagentRunWithRecovery(
            {
              runId,
              endedAt: now,
              outcome: {
                status: "error",
                error: "subagent run lost active execution context",
              },
              reason: SUBAGENT_ENDED_REASON_ERROR,
              sendFarewell: true,
              accountId: entry.requesterOrigin?.accountId,
              triggerCleanup: true,
            },
            "sweeper-lost-context",
          );
          continue;
        }
      }

      if (!entry.archiveAtMs && entry.cleanup === "keep" && entry.spawnMode !== "session") {
        continue;
      }
      if (!entry.archiveAtMs) {
        if (
          typeof entry.cleanupCompletedAt === "number" &&
          now - entry.cleanupCompletedAt > SESSION_RUN_TTL_MS
        ) {
          clearPendingLifecycleError(runId);
          void notifyContextEngineSubagentEnded({
            childSessionKey: entry.childSessionKey,
            reason: "swept",
            agentDir: entry.agentDir,
            workspaceDir: entry.workspaceDir,
          });
          subagentRuns.delete(runId);
          mutated = true;
          if (!entry.retainAttachmentsOnKeep) {
            await safeRemoveAttachmentsDir(entry);
          }
        }
        continue;
      }
      if (entry.archiveAtMs > now) {
        continue;
      }
      clearPendingLifecycleError(runId);
      try {
        await subagentRegistryDeps.callGateway({
          method: "sessions.delete",
          params: {
            key: entry.childSessionKey,
            operationId: buildSessionDeleteOperationId("subagent-cleanup", runId),
            deleteTranscript: true,
            emitLifecycleHooks: false,
          },
          timeoutMs: 10_000,
        });
      } catch (err) {
        log.warn("sessions.delete failed during subagent sweep; keeping run for retry", {
          runId,
          childSessionKey: entry.childSessionKey,
          err,
        });
        continue;
      }
      subagentRuns.delete(runId);
      mutated = true;
      // Archive/purge is terminal for the run record; remove any retained attachments too.
      await safeRemoveAttachmentsDir(entry);
      void notifyContextEngineSubagentEnded({
        childSessionKey: entry.childSessionKey,
        reason: "swept",
        agentDir: entry.agentDir,
        workspaceDir: entry.workspaceDir,
      });
    }
    // Sweep orphaned pendingLifecycleError entries (absolute TTL).
    for (const [runId, pending] of pendingLifecycleErrorByRunId.entries()) {
      if (now - pending.endedAt > PENDING_LIFECYCLE_TERMINAL_TTL_MS) {
        clearPendingLifecycleError(runId);
      }
    }
    for (const [runId, pending] of pendingLifecycleTimeoutByRunId.entries()) {
      if (now - pending.endedAt > PENDING_LIFECYCLE_TERMINAL_TTL_MS) {
        clearPendingLifecycleTimeout(runId);
      }
    }

    if (mutated) {
      persistSubagentRuns();
    }
    if (subagentRuns.size === 0) {
      stopSweeper();
    }
  } finally {
    sweepInProgress = false;
  }
}

function ensureListener() {
  if (listenerStarted) {
    return;
  }
  listenerStarted = true;
  listenerStop = subagentRegistryDeps.onAgentEvent((evt) => {
    void (async () => {
      if (!evt || evt.stream !== "lifecycle") {
        return;
      }
      const phase = evt.data?.phase;
      const entry = subagentRuns.get(evt.runId);
      if (!entry) {
        if (phase === "end" && typeof evt.sessionKey === "string") {
          await refreshFrozenResultFromSession(evt.sessionKey);
        }
        return;
      }
      if (phase === "start") {
        clearPendingLifecycleError(evt.runId);
        clearPendingLifecycleTimeout(evt.runId);
        const startedAt = typeof evt.data?.startedAt === "number" ? evt.data.startedAt : undefined;
        if (startedAt) {
          entry.startedAt = startedAt;
          if (typeof entry.sessionStartedAt !== "number") {
            entry.sessionStartedAt = startedAt;
          }
          persistSubagentRuns();
        }
        return;
      }
      if (phase !== "end" && phase !== "error") {
        return;
      }
      const endedAt = typeof evt.data?.endedAt === "number" ? evt.data.endedAt : Date.now();
      const startedAt = typeof evt.data?.startedAt === "number" ? evt.data.startedAt : undefined;
      const error = typeof evt.data?.error === "string" ? evt.data.error : undefined;
      const livenessState =
        typeof evt.data?.livenessState === "string" ? evt.data.livenessState : undefined;
      const stopReason = typeof evt.data?.stopReason === "string" ? evt.data.stopReason : undefined;
      if (phase === "error") {
        schedulePendingLifecycleError({
          runId: evt.runId,
          endedAt,
          startedAt,
          error,
        });
        return;
      }
      if (isAbortedAgentStopReason(stopReason)) {
        clearPendingLifecycleError(evt.runId);
        clearPendingLifecycleTimeout(evt.runId);
        await completeSubagentRunWithRecovery(
          {
            runId: evt.runId,
            endedAt,
            outcome: {
              status: "error",
              error: "subagent run terminated",
            },
            reason: SUBAGENT_ENDED_REASON_KILLED,
            sendFarewell: true,
            accountId: entry.requesterOrigin?.accountId,
            triggerCleanup: true,
            startedAt,
          },
          "lifecycle-killed-event",
        );
        return;
      }
      if (isBlockedLivenessState(livenessState)) {
        clearPendingLifecycleError(evt.runId);
        clearPendingLifecycleTimeout(evt.runId);
        const blockedParams = {
          runId: evt.runId,
          endedAt,
          outcome: {
            status: "error" as const,
            error: formatBlockedLivenessError(error),
          },
          reason: SUBAGENT_ENDED_REASON_ERROR,
          sendFarewell: true,
          accountId: entry.requesterOrigin?.accountId,
          triggerCleanup: true,
          startedAt,
        };
        await completeSubagentRunWithRecovery(blockedParams, "lifecycle-blocked-event");
        return;
      }
      if (evt.data?.aborted) {
        schedulePendingLifecycleTimeout({
          runId: evt.runId,
          endedAt,
          startedAt,
        });
        return;
      }
      if (evt.data?.yielded === true) {
        if (
          markSubagentRunPausedAfterYield({
            entry,
            endedAt,
            startedAt: startedAt ?? entry.startedAt,
          })
        ) {
          persistSubagentRuns();
        }
        return;
      }
      clearPendingLifecycleError(evt.runId);
      clearPendingLifecycleTimeout(evt.runId);
      const completionParams = {
        runId: evt.runId,
        endedAt,
        outcome: { status: "ok" as const },
        reason: SUBAGENT_ENDED_REASON_COMPLETE,
        sendFarewell: true,
        accountId: entry.requesterOrigin?.accountId,
        triggerCleanup: true,
        startedAt,
      };
      await completeSubagentRunWithRecovery(completionParams, "lifecycle-ok-event");
    })().catch((err: unknown) => {
      log.warn("lifecycle event handler failed", { err, runId: evt.runId });
    });
  });
}

const subagentRunManager = createSubagentRunManager({
  runs: subagentRuns,
  resumedRuns,
  endedHookInFlightRunIds,
  persist: persistSubagentRuns,
  persistOrThrow: persistSubagentRunsOrThrow,
  callGateway: (request) => subagentRegistryDeps.callGateway(request),
  getRuntimeConfig: () => subagentRegistryDeps.getRuntimeConfig(),
  ensureRuntimePluginsLoaded: (args: {
    config: OpenClawConfig;
    workspaceDir?: string;
    allowGatewaySubagentBinding?: boolean;
  }) => ensureSubagentRegistryPluginRuntimeLoaded(args),
  ensureListener,
  startSweeper,
  stopSweeper,
  resumeSubagentRun,
  clearPendingLifecycleError,
  resolveSubagentWaitTimeoutMs,
  scheduleOrphanRecovery: (args) => scheduleSubagentOrphanRecovery(args),
  resolveSubagentSessionCompletion,
  resolveSubagentSessionStartedAt,
  notifyContextEngineSubagentEnded,
  completeCleanupBookkeeping,
  completeSubagentRun,
});

configureSubagentRegistrySteerRuntime({
  replaceSubagentRunAfterSteer: (params) => subagentRunManager.replaceSubagentRunAfterSteer(params),
  finalizeInterruptedSubagentRun: async (params) => await finalizeInterruptedSubagentRun(params),
});

export function markSubagentRunForSteerRestart(runId: string) {
  return subagentRunManager.markSubagentRunForSteerRestart(runId);
}

export function clearSubagentRunSteerRestart(runId: string) {
  return subagentRunManager.clearSubagentRunSteerRestart(runId);
}

export function replaceSubagentRunAfterSteer(params: {
  previousRunId: string;
  nextRunId: string;
  fallback?: SubagentRunRecord;
  runTimeoutSeconds?: number;
  preserveFrozenResultFallback?: boolean;
  transcriptFile?: string;
}) {
  return subagentRunManager.replaceSubagentRunAfterSteer(params);
}

export function registerSubagentRun(params: RegisterSubagentRunParams) {
  subagentRunManager.registerSubagentRun(params);
}

export function updateSubagentRunOrchestrationMetadata(
  runId: string,
  patch: Partial<NonNullable<SubagentRunRecord["orchestration"]>>,
): boolean {
  const key = runId.trim();
  if (!key) {
    return false;
  }
  const entry = subagentRuns.get(key);
  if (!entry?.orchestration) {
    return false;
  }
  entry.orchestration = { ...entry.orchestration, ...patch };
  if (entry.delivery?.payload?.orchestration) {
    entry.delivery.payload = {
      ...entry.delivery.payload,
      orchestration: entry.orchestration,
    };
  }
  persistSubagentRuns();
  return true;
}

export function resetSubagentRegistryForTests(opts?: { persist?: boolean }) {
  clearScheduledResumeTimers();
  for (const timer of resumeRetryTimers) {
    clearTimeout(timer);
  }
  resumeRetryTimers.clear();
  subagentRuns.clear();
  resumedRuns.clear();
  endedHookInFlightRunIds.clear();
  clearAllPendingLifecycleErrors();
  clearAllPendingLifecycleTimeouts();
  contextEngineInitLoader.clear();
  contextEngineRegistryLoader.clear();
  runtimePluginsLoader.clear();
  subagentAnnounceLoader.clear();
  browserCleanupLoader.clear();
  clearSubagentRunsReadCacheForTest();
  stopSweeper();
  sweepInProgress = false;
  restoreAttempted = false;
  if (listenerStop) {
    listenerStop();
    listenerStop = null;
  }
  listenerStarted = false;
  if (opts?.persist !== false) {
    persistSubagentRuns();
  }
}

export const testing = {
  async sweepOnceForTests() {
    await sweepSubagentRuns();
  },
  setDepsForTest(overrides?: Partial<SubagentRegistryDeps>) {
    subagentRegistryDeps = overrides
      ? {
          ...defaultSubagentRegistryDeps,
          ...overrides,
        }
      : defaultSubagentRegistryDeps;
  },
} as const;

export function addSubagentRunForTests(entry: SubagentRunRecord) {
  subagentRuns.set(entry.runId, entry);
}

export function releaseSubagentRun(runId: string) {
  subagentRunManager.releaseSubagentRun(runId);
}

export async function finalizeInterruptedSubagentRun(params: {
  runId?: string;
  childSessionKey?: string;
  error: string;
  endedAt?: number;
}): Promise<number> {
  const runIds = new Set<string>();
  if (typeof params.runId === "string" && params.runId.trim()) {
    runIds.add(params.runId.trim());
  }
  if (typeof params.childSessionKey === "string" && params.childSessionKey.trim()) {
    const childSessionKey = params.childSessionKey.trim();
    for (const [runId, entry] of subagentRuns.entries()) {
      if (entry.childSessionKey === childSessionKey) {
        runIds.add(runId);
      }
    }
  }
  if (runIds.size === 0) {
    return 0;
  }

  const endedAt =
    typeof params.endedAt === "number" && Number.isFinite(params.endedAt)
      ? params.endedAt
      : Date.now();
  let updated = 0;
  for (const runId of runIds) {
    clearPendingLifecycleError(runId);
    clearPendingLifecycleTimeout(runId);
    const entry = subagentRuns.get(runId);
    if (!entry || typeof entry.cleanupCompletedAt === "number") {
      continue;
    }
    await completeSubagentRunWithRecovery(
      {
        runId,
        endedAt,
        outcome: {
          status: "error",
          error: params.error,
        },
        reason: SUBAGENT_ENDED_REASON_ERROR,
        sendFarewell: true,
        accountId: entry.requesterOrigin?.accountId,
        triggerCleanup: true,
      },
      "explicit-failed-mark",
    );
    updated += 1;
  }
  return updated;
}

export function resolveRequesterForChildSession(childSessionKey: string): {
  requesterSessionKey: string;
  requesterOrigin?: DeliveryContext;
} | null {
  const runsSnapshot = subagentRegistryDeps.getSubagentRunsSnapshotForRead(subagentRuns);
  const resolved = resolveRequesterForChildSessionFromRuns(runsSnapshot, childSessionKey);
  if (resolved === null) {
    return null;
  }
  const requesterOrigin = normalizeDeliveryContext(resolved.requesterOrigin);
  return {
    requesterSessionKey: resolved.requesterSessionKey,
    requesterOrigin,
  };
}

export function isSubagentSessionRunActive(childSessionKey: string): boolean {
  return isSubagentSessionRunActiveFromRuns(subagentRuns, childSessionKey);
}

export function shouldIgnorePostCompletionAnnounceForSession(childSessionKey: string): boolean {
  return shouldIgnorePostCompletionAnnounceForSessionFromRuns(
    subagentRegistryDeps.getSubagentRunsSnapshotForRead(subagentRuns),
    childSessionKey,
  );
}

export function markSubagentRunTerminated(params: {
  runId?: string;
  childSessionKey?: string;
  reason?: string;
}): number {
  return subagentRunManager.markSubagentRunTerminated(params);
}

export function listSubagentRunsForRequester(
  requesterSessionKey: string,
  options?: { requesterRunId?: string },
): SubagentRunRecord[] {
  return listRunsForRequesterFromRuns(subagentRuns, requesterSessionKey, options);
}

export function leasePendingAgentSteeringItems(params: {
  requesterSessionKey: string;
  leaseId: string;
  now?: number;
}) {
  restoreSubagentRunsOnce();
  const leased = leasePendingAgentSteeringItemsFromSubagentRuns({
    runs: subagentRuns,
    requesterSessionKey: params.requesterSessionKey,
    leaseId: params.leaseId,
    now: params.now,
  });
  if (leased) {
    persistSubagentRuns();
  }
  return leased;
}

export function ackPendingAgentSteeringItems(params: {
  runIds: readonly string[];
  leaseId: string;
  now?: number;
}): number {
  const updated = ackLeasedAgentSteeringItemsFromSubagentRuns({
    runs: subagentRuns,
    runIds: params.runIds,
    leaseId: params.leaseId,
    now: params.now,
  });
  if (updated > 0) {
    persistSubagentRuns();
    for (const runId of params.runIds) {
      const entry = subagentRuns.get(runId);
      if (!entry || typeof entry.cleanupCompletedAt === "number") {
        continue;
      }
      entry.cleanupHandled = false;
      startSubagentAnnounceCleanupFlow(runId, entry);
    }
  }
  return updated;
}

export function releasePendingAgentSteeringItems(params: {
  runIds: readonly string[];
  leaseId: string;
  error?: string;
}): number {
  const updated = releaseLeasedAgentSteeringItemsFromSubagentRuns({
    runs: subagentRuns,
    runIds: params.runIds,
    leaseId: params.leaseId,
    error: params.error,
  });
  if (updated > 0) {
    persistSubagentRuns();
  }
  return updated;
}

export { prependAgentSteeringPrompt };

export function listSubagentRunsForController(controllerSessionKey: string): SubagentRunRecord[] {
  return listRunsForControllerFromRuns(
    subagentRegistryDeps.getSubagentRunsSnapshotForRead(subagentRuns),
    controllerSessionKey,
  );
}

export function countActiveRunsForSession(requesterSessionKey: string): number {
  return countActiveRunsForSessionFromRuns(
    subagentRegistryDeps.getSubagentRunsSnapshotForRead(subagentRuns),
    requesterSessionKey,
  );
}

export function countActiveDescendantRuns(rootSessionKey: string): number {
  return countActiveDescendantRunsFromRuns(
    subagentRegistryDeps.getSubagentRunsSnapshotForRead(subagentRuns),
    rootSessionKey,
  );
}

export function countPendingDescendantRuns(rootSessionKey: string): number {
  return countPendingDescendantRunsFromRuns(
    subagentRegistryDeps.getSubagentRunsSnapshotForRead(subagentRuns),
    rootSessionKey,
  );
}

export function countPendingDescendantRunsExcludingRun(
  rootSessionKey: string,
  excludeRunId: string,
): number {
  return countPendingDescendantRunsExcludingRunFromRuns(
    subagentRegistryDeps.getSubagentRunsSnapshotForRead(subagentRuns),
    rootSessionKey,
    excludeRunId,
  );
}

export function listDescendantRunsForRequester(rootSessionKey: string): SubagentRunRecord[] {
  return listDescendantRunsForRequesterFromRuns(
    subagentRegistryDeps.getSubagentRunsSnapshotForRead(subagentRuns),
    rootSessionKey,
  );
}

export function getSubagentRunByRunId(runId: string): SubagentRunRecord | null {
  const key = runId.trim();
  if (!key) {
    return null;
  }
  return subagentRegistryDeps.getSubagentRunsSnapshotForRead(subagentRuns).get(key) ?? null;
}

export function getSubagentRunByChildSessionKey(childSessionKey: string): SubagentRunRecord | null {
  return getSubagentRunByChildSessionKeyFromRuns(
    subagentRegistryDeps.getSubagentRunsSnapshotForRead(subagentRuns),
    childSessionKey,
  );
}

export function getLatestSubagentRunByChildSessionKey(
  childSessionKey: string,
): SubagentRunRecord | null {
  const key = childSessionKey.trim();
  if (!key) {
    return null;
  }

  let latest: SubagentRunRecord | null = null;
  for (const entry of subagentRegistryDeps.getSubagentRunsSnapshotForRead(subagentRuns).values()) {
    if (entry.childSessionKey !== key) {
      continue;
    }
    if (!latest || entry.createdAt > latest.createdAt) {
      latest = entry;
    }
  }

  return latest;
}

export function initSubagentRegistry() {
  restoreSubagentRunsOnce();
}

// Importing this module also registers the subagent maintenance preserve-key
// provider as a side effect (see subagent-registry-maintenance.ts).
export { listSessionMaintenanceProtectedSubagentSessionKeys } from "./subagent-registry-maintenance.js";
export { testing as __testing };
