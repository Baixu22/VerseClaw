// Process supervisor manages long-running child and PTY process lifecycles.
import crypto from "node:crypto";
import { performance } from "node:perf_hooks";
import { normalizeOptionalString } from "@openclaw/normalization-core/string-coerce";
import { getShellConfig } from "../../agents/shell-utils.js";
import { signalProcessTree } from "../kill-tree.js";
import { captureProcessTrees, verifyProcessTreesTerminated } from "../os-containment.js";
import { readProcessTreeSample } from "../process-tree-sampler.js";
import {
  LongSessionCoordinationError,
  decideLongSessionCoordination,
  resolveLongSessionCoordinationPolicy,
} from "../../../../shared/long-session-resource-reclamation.js";
import { createChildAdapter } from "./adapters/child.js";
import { createPtyAdapter } from "./adapters/pty.js";
import { createRunRegistry } from "./registry.js";
import { reconcileManifestOrphans } from "./reconcile.js";
import type {
  ReconcileDependencies,
  SupervisorReconcileResult,
} from "./reconcile.js";
import type { SupervisorRunManifestStore } from "./run-manifest.js";
import type {
  DrainLifecycleResult,
  LifecycleRunSnapshot,
  ManagedRun,
  ProcessLifecycleIdentity,
  ProcessSupervisor,
  RunExit,
  RunRecord,
  SpawnInput,
  SupervisorSessionRunSnapshot,
  TerminationReason,
} from "./types.js";

type SupervisorLogRuntime = typeof import("./supervisor-log.runtime.js");

type ActiveRun = {
  run: ManagedRun;
  scopeKey?: string;
  lifecycle?: ProcessLifecycleIdentity;
};

const GRACEFUL_CANCEL_TIMEOUT_MS = 5000;
const DEFAULT_MAX_CAPTURED_OUTPUT_CHARS = 1024 * 1024;

let supervisorLogRuntimePromise: Promise<SupervisorLogRuntime> | undefined;

function loadSupervisorLogRuntime(): Promise<SupervisorLogRuntime> {
  supervisorLogRuntimePromise ??= import("./supervisor-log.runtime.js");
  return supervisorLogRuntimePromise;
}

function clampTimeout(value?: number): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.max(1, Math.floor(value));
}

function normalizeLifecycleIdentity(
  identity: ProcessLifecycleIdentity,
): ProcessLifecycleIdentity | undefined {
  const agentId = normalizeOptionalString(identity.agentId);
  const canonicalSessionKey = normalizeOptionalString(identity.canonicalSessionKey);
  const expectedSessionId = normalizeOptionalString(identity.expectedSessionId);
  if (!agentId || !canonicalSessionKey || !expectedSessionId) {
    return undefined;
  }
  return { agentId, canonicalSessionKey, expectedSessionId };
}

function identityMatches(
  left: ProcessLifecycleIdentity | undefined,
  right: ProcessLifecycleIdentity,
): boolean {
  return (
    left?.agentId === right.agentId &&
    left?.canonicalSessionKey === right.canonicalSessionKey &&
    left?.expectedSessionId === right.expectedSessionId
  );
}

function clampCapturedOutputChars(value?: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_MAX_CAPTURED_OUTPUT_CHARS;
  }
  return Math.max(256, Math.floor(value));
}

function appendCapturedOutput(
  current: string,
  chunk: string,
  stream: "stdout" | "stderr",
  maxChars: number,
) {
  const next = current + chunk;
  if (next.length <= maxChars) {
    return next;
  }
  const marker = `[openclaw: captured ${stream} truncated to last ${maxChars} chars]\n`;
  const tailChars = Math.max(0, maxChars - marker.length);
  return `${marker}${next.slice(-tailChars)}`;
}

function isTimeoutReason(reason: TerminationReason) {
  return reason === "overall-timeout" || reason === "no-output-timeout";
}

function resolveElapsedTimeoutReason(params: {
  nowMs: number;
  overallTimeoutDeadlineMs: number | null;
  noOutputTimeoutDeadlineMs: number | null;
}): TerminationReason | null {
  const elapsedDeadlines: Array<{ reason: TerminationReason; deadlineMs: number }> = [];
  if (params.overallTimeoutDeadlineMs !== null && params.nowMs >= params.overallTimeoutDeadlineMs) {
    elapsedDeadlines.push({
      reason: "overall-timeout",
      deadlineMs: params.overallTimeoutDeadlineMs,
    });
  }
  if (
    params.noOutputTimeoutDeadlineMs !== null &&
    params.nowMs >= params.noOutputTimeoutDeadlineMs
  ) {
    elapsedDeadlines.push({
      reason: "no-output-timeout",
      deadlineMs: params.noOutputTimeoutDeadlineMs,
    });
  }
  if (elapsedDeadlines.length === 0) {
    return null;
  }
  elapsedDeadlines.sort((a, b) => a.deadlineMs - b.deadlineMs);
  return elapsedDeadlines[0].reason;
}

export type CreateProcessSupervisorOptions = {
  /** Persisted active-run manifest enabling restart reconciliation. */
  manifest?: SupervisorRunManifestStore;
};

export function createProcessSupervisor(
  options: CreateProcessSupervisorOptions = {},
): ProcessSupervisor {
  const registry = createRunRegistry();
  const active = new Map<string, ActiveRun>();
  const startingByLifecycle = new Map<string, number>();
  let manifest = options.manifest ?? null;

  const cancel = (runId: string, reason: TerminationReason = "manual-cancel") => {
    const current = active.get(runId);
    if (!current) {
      return;
    }
    registry.updateState(runId, "exiting", {
      terminationReason: reason,
    });
    current.run.cancel(reason);
  };

  const cancelScope = (scopeKey: string, reason: TerminationReason = "manual-cancel") => {
    if (!scopeKey.trim()) {
      return;
    }
    for (const [runId, run] of active.entries()) {
      if (run.scopeKey !== scopeKey) {
        continue;
      }
      cancel(runId, reason);
    }
  };

  const verifyOwnedTreeAfterRootExit = async (
    pid: number | undefined,
  ): Promise<"verified" | "residual" | "unknown"> => {
    if (typeof pid !== "number" || pid <= 0) return "verified";
    const captured = await captureProcessTrees([pid]).catch(() => null);
    if (!captured || captured.status !== "ok") return "unknown";
    if (!captured.capturedPids.has(pid)) return "verified";
    const remaining = await verifyProcessTreesTerminated(captured);
    if (remaining.status === "empty") return "verified";
    if (remaining.status === "residual") return "residual";
    return "unknown";
  };

  const spawn = async (input: SpawnInput): Promise<ManagedRun> => {
    const runId = normalizeOptionalString(input.runId) ?? crypto.randomUUID();
    const scopeKey = normalizeOptionalString(input.scopeKey);
    if (input.replaceExistingScope && scopeKey) {
      cancelScope(scopeKey, "manual-cancel");
    }
    const lifecycle = normalizeLifecycleIdentity({
      agentId: input.lifecycleAgentId ?? "",
      canonicalSessionKey: input.lifecycleCanonicalSessionKey ?? "",
      expectedSessionId: input.lifecycleExpectedSessionId ?? "",
    });
    const policy = resolveLongSessionCoordinationPolicy();
    const lifecycleReservationKey = lifecycle ? JSON.stringify(lifecycle) : null;
    let reservationHeld = false;
    if (
      lifecycle &&
      (policy.maxProcesses !== null || policy.maxRssMb !== null)
    ) {
      const activeRuns = [...active.values()]
        .filter((entry) => identityMatches(entry.lifecycle, lifecycle));
      const activePids = activeRuns
        .map((entry) => entry.run.pid)
        .filter((pid): pid is number => typeof pid === "number" && pid > 0);
      const starting = lifecycleReservationKey ? (startingByLifecycle.get(lifecycleReservationKey) ?? 0) : 0;
      const sample = activePids.length > 0
        ? await readProcessTreeSample({ rootPids: activePids })
        : {
            status: "empty" as const,
            processCount: 0,
            treeRssBytes: 0,
          };
      const budget = decideLongSessionCoordination({
        policy,
        usage: {
          processCount: activeRuns.length + starting,
          rssKb: sample.treeRssBytes === null ? null : Math.ceil(sample.treeRssBytes / 1024),
          backgroundTerminals: null,
          worktreeCount: null,
        },
        request: { processes: 1, rssKb: 1 },
      });
      if (!budget.allowed) throw new LongSessionCoordinationError(budget);
      if (lifecycleReservationKey) {
        startingByLifecycle.set(lifecycleReservationKey, starting + 1);
        reservationHeld = true;
      }
    }
    const startedAtMs = Date.now();
    const record: RunRecord = {
      runId,
      sessionId: input.sessionId,
      backendId: input.backendId,
      scopeKey,
      ...(lifecycle
        ? {
            lifecycleAgentId: lifecycle.agentId,
            lifecycleCanonicalSessionKey: lifecycle.canonicalSessionKey,
            lifecycleExpectedSessionId: lifecycle.expectedSessionId,
          }
        : {}),
      state: "starting",
      startedAtMs,
      lastOutputAtMs: startedAtMs,
      createdAtMs: startedAtMs,
      updatedAtMs: startedAtMs,
    };
    registry.add(record);

    let forcedReason: TerminationReason | null = null;
    let settled = false;
    let stdout = "";
    let stderr = "";
    let timeoutTimer: NodeJS.Timeout | null = null;
    let noOutputTimer: NodeJS.Timeout | null = null;
    let forceKillTimer: NodeJS.Timeout | null = null;
    const captureOutput = input.captureOutput !== false;
    const maxCapturedOutputChars = clampCapturedOutputChars(input.maxCapturedOutputChars);

    const overallTimeoutMs = clampTimeout(input.timeoutMs);
    const noOutputTimeoutMs = clampTimeout(input.noOutputTimeoutMs);
    let overallTimeoutDeadlineMs: number | null = null;
    let noOutputTimeoutDeadlineMs: number | null = null;

    const setForcedReason = (reason: TerminationReason) => {
      if (forcedReason) {
        return;
      }
      forcedReason = reason;
      registry.updateState(runId, "exiting", { terminationReason: reason });
    };

    let cancelAdapter: ((reason: TerminationReason) => void) | null = null;

    const requestCancel = (reason: TerminationReason) => {
      setForcedReason(reason);
      cancelAdapter?.(reason);
    };

    const touchOutput = () => {
      registry.touchOutput(runId);
      if (!noOutputTimeoutMs || settled) {
        return;
      }
      noOutputTimeoutDeadlineMs = performance.now() + noOutputTimeoutMs;
      if (noOutputTimer) {
        clearTimeout(noOutputTimer);
      }
      noOutputTimer = setTimeout(() => {
        requestCancel("no-output-timeout");
      }, noOutputTimeoutMs);
    };

    try {
      if (input.mode === "child" && input.argv.length === 0) {
        throw new Error("spawn argv cannot be empty");
      }
      const adapter =
        input.mode === "pty"
          ? await (async () => {
              const { shell, args: shellArgs } = getShellConfig();
              const ptyCommand = input.ptyCommand.trim();
              if (!ptyCommand) {
                throw new Error("PTY command cannot be empty");
              }
              return await createPtyAdapter({
                beforeSpawn: input.beforeSpawn,
                shell,
                args: [...shellArgs, ptyCommand],
                cwd: input.cwd,
                env: input.env,
              });
            })()
          : await createChildAdapter({
              beforeSpawn: input.beforeSpawn,
              argv: input.argv,
              cwd: input.cwd,
              env: input.env,
              windowsVerbatimArguments: input.windowsVerbatimArguments,
              input: input.input,
              stdinMode: input.stdinMode,
            });

      registry.updateState(runId, "running", { pid: adapter.pid });
      if (reservationHeld && lifecycleReservationKey) {
        const remaining = Math.max(0, (startingByLifecycle.get(lifecycleReservationKey) ?? 1) - 1);
        if (remaining === 0) startingByLifecycle.delete(lifecycleReservationKey);
        else startingByLifecycle.set(lifecycleReservationKey, remaining);
        reservationHeld = false;
      }

      const clearTimers = () => {
        if (timeoutTimer) {
          clearTimeout(timeoutTimer);
          timeoutTimer = null;
        }
        if (noOutputTimer) {
          clearTimeout(noOutputTimer);
          noOutputTimer = null;
        }
        if (forceKillTimer) {
          clearTimeout(forceKillTimer);
          forceKillTimer = null;
        }
      };

      cancelAdapter = (_reason: TerminationReason) => {
        if (settled || forceKillTimer) {
          return;
        }
        adapter.kill("SIGTERM");
        forceKillTimer = setTimeout(() => {
          if (!settled) {
            adapter.kill("SIGKILL");
          }
        }, GRACEFUL_CANCEL_TIMEOUT_MS);
        forceKillTimer.unref?.();
      };

      if (overallTimeoutMs) {
        overallTimeoutDeadlineMs = performance.now() + overallTimeoutMs;
        timeoutTimer = setTimeout(() => {
          requestCancel("overall-timeout");
        }, overallTimeoutMs);
      }
      if (noOutputTimeoutMs) {
        noOutputTimeoutDeadlineMs = performance.now() + noOutputTimeoutMs;
        noOutputTimer = setTimeout(() => {
          requestCancel("no-output-timeout");
        }, noOutputTimeoutMs);
      }

      adapter.onStdout((chunk) => {
        if (captureOutput) {
          stdout = appendCapturedOutput(stdout, chunk, "stdout", maxCapturedOutputChars);
        }
        input.onStdout?.(chunk);
        touchOutput();
      });
      adapter.onStderr((chunk) => {
        if (captureOutput) {
          stderr = appendCapturedOutput(stderr, chunk, "stderr", maxCapturedOutputChars);
        }
        input.onStderr?.(chunk);
        touchOutput();
      });

      const waitPromise = (async (): Promise<RunExit> => {
        const result = await adapter.wait();
        const deadlineReason = resolveElapsedTimeoutReason({
          nowMs: performance.now(),
          overallTimeoutDeadlineMs,
          noOutputTimeoutDeadlineMs,
        });
        const terminalReason = forcedReason ?? deadlineReason;
        if (settled) {
          return {
            reason: terminalReason ?? "exit",
            exitCode: result.code,
            exitSignal: result.signal,
            durationMs: Date.now() - startedAtMs,
            stdout,
            stderr,
            timedOut: isTimeoutReason(terminalReason ?? "exit"),
            noOutputTimedOut: terminalReason === "no-output-timeout",
            termination: "unknown",
          };
        }
        const termination = await verifyOwnedTreeAfterRootExit(adapter.pid).catch(() => "unknown" as const);
        settled = true;
        clearTimers();
        adapter.dispose();
        active.delete(runId);

        const reason: TerminationReason =
          terminalReason ?? (result.signal != null ? ("signal" as const) : ("exit" as const));
        const exit: RunExit = {
          reason,
          exitCode: result.code,
          exitSignal: result.signal,
          durationMs: Date.now() - startedAtMs,
          stdout,
          stderr,
          timedOut: isTimeoutReason(terminalReason ?? reason),
          noOutputTimedOut: terminalReason === "no-output-timeout",
          termination,
        };
        registry.finalize(runId, {
          reason: exit.reason,
          exitCode: exit.exitCode,
          exitSignal: exit.exitSignal,
        });
        if (termination === "verified") {
          manifest?.remove(runId);
        }
        return exit;
      })().catch((err: unknown) => {
        if (!settled) {
          settled = true;
          clearTimers();
          active.delete(runId);
          adapter.dispose();
          registry.finalize(runId, {
            reason: "spawn-error",
            exitCode: null,
            exitSignal: null,
          });
          manifest?.remove(runId);
        }
        throw err;
      });

      const managedRun: ManagedRun = {
        runId,
        pid: adapter.pid,
        startedAtMs,
        stdin: adapter.stdin,
        wait: async () => await waitPromise,
        cancel: (reason = "manual-cancel") => {
          requestCancel(reason);
        },
      };

      active.set(runId, {
        run: managedRun,
        scopeKey,
        lifecycle,
      });
      // Only runs with a usable PID can be reconciled after a restart; runs
      // without one stay in-memory-only (nothing to identify at the OS level).
      if (manifest && typeof adapter.pid === "number" && adapter.pid > 0) {
        manifest.add({
          runId,
          pid: adapter.pid,
          ownerPid: manifest.ownerPid,
          sessionId: input.sessionId,
          scopeKey,
          lifecycle: lifecycle ?? undefined,
          startedAtMs,
        });
      }
      return managedRun;
    } catch (err) {
      if (reservationHeld && lifecycleReservationKey) {
        const remaining = Math.max(0, (startingByLifecycle.get(lifecycleReservationKey) ?? 1) - 1);
        if (remaining === 0) startingByLifecycle.delete(lifecycleReservationKey);
        else startingByLifecycle.set(lifecycleReservationKey, remaining);
      }
      registry.finalize(runId, {
        reason: "spawn-error",
        exitCode: null,
        exitSignal: null,
      });
      manifest?.remove(runId);
      const { warnProcessSupervisorSpawnFailure } = await loadSupervisorLogRuntime();
      warnProcessSupervisorSpawnFailure(`spawn failed: runId=${runId} reason=${String(err)}`);
      throw err;
    }
  };

  const snapshotRunsForLifecycle = (
    identity: ProcessLifecycleIdentity,
  ): LifecycleRunSnapshot[] => {
    const normalized = normalizeLifecycleIdentity(identity);
    if (!normalized) {
      return [];
    }
    const snapshots: LifecycleRunSnapshot[] = [];
    for (const [runId, entry] of active.entries()) {
      if (!identityMatches(entry.lifecycle, normalized)) {
        continue;
      }
      snapshots.push({
        runId,
        pid: entry.run.pid,
        lifecycle: entry.lifecycle ?? normalized,
        cancel: () => {
          cancel(runId, "manual-cancel");
        },
        wait: async () => await entry.run.wait(),
      });
    }
    return snapshots;
  };

  const snapshotRunsForSession = (
    canonicalSessionKey: string,
  ): SupervisorSessionRunSnapshot[] => {
    const key = normalizeOptionalString(canonicalSessionKey);
    if (!key) {
      return [];
    }
    const snapshots: SupervisorSessionRunSnapshot[] = [];
    for (const [runId, entry] of active.entries()) {
      if (entry.lifecycle?.canonicalSessionKey !== key) {
        continue;
      }
      const record = registry.get(runId);
      snapshots.push({
        runId,
        pid: entry.run.pid,
        state: record?.state ?? "running",
        lifecycleCanonicalSessionKey: key,
        ...(entry.lifecycle?.expectedSessionId
          ? { lifecycleExpectedSessionId: entry.lifecycle.expectedSessionId }
          : {}),
        startedAtMs: record?.startedAtMs ?? entry.run.startedAtMs,
        updatedAtMs: record?.updatedAtMs ?? entry.run.startedAtMs,
      });
    }
    return snapshots;
  };

  const countActiveRunsForLifecycle = (identity: ProcessLifecycleIdentity): number => {
    const normalized = normalizeLifecycleIdentity(identity);
    if (!normalized) {
      return 0;
    }
    let count = 0;
    for (const entry of active.values()) {
      if (identityMatches(entry.lifecycle, normalized)) {
        count += 1;
      }
    }
    return count;
  };

  const drainRunsForLifecycle = async (
    identity: ProcessLifecycleIdentity,
    timeoutMs: number,
  ): Promise<DrainLifecycleResult> => {
    const snapshot = snapshotRunsForLifecycle(identity);
    if (snapshot.length === 0) {
      return { drained: true, timedOut: false, runIds: [], pids: [] };
    }
    for (const run of snapshot) {
      run.cancel();
      // Windows console children often ignore the graceful `taskkill /T`
      // SIGTERM-equivalent request and would otherwise wait for the adapter's
      // 5s SIGKILL timer. Lifecycle drain is a terminal operation: escalate to
      // force tree termination immediately so reset/delete/stop stay bounded.
      if (process.platform === "win32" && typeof run.pid === "number" && run.pid > 0) {
        signalProcessTree(run.pid, "SIGKILL");
      }
    }
    const deadline = Date.now() + Math.max(1, Math.floor(timeoutMs));
    let timedOut = false;
    await Promise.all(
      snapshot.map(async (run) => {
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) {
          timedOut = true;
          return;
        }
        const outcome = await Promise.race([
          run.wait().then(
            () => true,
            () => false,
          ),
          new Promise<"timeout">((resolve) => {
            setTimeout(() => resolve("timeout"), remainingMs).unref?.();
          }),
        ]);
        if (outcome === "timeout") {
          timedOut = true;
        }
      }),
    );
    return {
      drained: !timedOut && countActiveRunsForLifecycle(identity) === 0,
      timedOut,
      runIds: snapshot.map((run) => run.runId),
      pids: snapshot
        .map((run) => run.pid)
        .filter((pid): pid is number => typeof pid === "number" && pid > 0),
    };
  };

  return {
    spawn,
    cancel,
    cancelScope,
    snapshotRunsForLifecycle,
    snapshotRunsForSession,
    countActiveRunsForLifecycle,
    drainRunsForLifecycle,
    attachRunManifest: (store: SupervisorRunManifestStore) => {
      manifest = store;
    },
    reconcileOrphans: async (dependencies?: ReconcileDependencies) => {
      if (!manifest) {
        return {
          status: "disabled",
          ours: 0,
          foreignOwner: 0,
          lost: 0,
          reconciled: 0,
          containmentUnknown: 0,
          residual: 0,
        } satisfies SupervisorReconcileResult;
      }
      return await reconcileManifestOrphans(manifest, dependencies);
    },
    getRecord: (runId: string) => registry.get(runId),
  };
}
