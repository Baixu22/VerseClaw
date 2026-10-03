// Runtime Lifecycle Governance -- level-triggered durable helper recovery.
// This reconciler has no spawn capability by design: recovery reads protocol
// files and OS liveness only, then delegates the durable task/flow transition
// to its caller.
import {
  readDurableHelperFiles,
  type DurableHelperExit,
  type DurableHelperProtocolOptions,
} from "./goal-wake-helper-protocol.js";

export type DurableProcessRecoveryState = "running" | "terminal" | "lost" | "missing";

export type DurableProcessReconcileResult = {
  runId: string;
  state: DurableProcessRecoveryState;
  reason:
    | "exit-observed"
    | "helper-live"
    | "intent-without-started"
    | "started-helper-dead"
    | "intent-missing"
    | "owner-epoch-mismatch";
  exit?: DurableHelperExit;
};

export type ProcessRunReconcilerOptions = DurableHelperProtocolOptions & {
  isHelperAlive?: (pid: number) => boolean | Promise<boolean>;
  onRunning?: (input: {
    runId: string;
    helperPid: number;
    childPid: number;
    runNonce: string;
    startedAtMs: number;
  }) => Promise<void> | void;
  onLost?: (input: { runId: string; reason: DurableProcessReconcileResult["reason"] }) => Promise<void> | void;
  onTerminal?: (input: { runId: string; exit: DurableHelperExit }) => Promise<void> | void;
};

function defaultIsHelperAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Reconciles exactly one durable helper run. The ordering of callbacks is
 * intentional: terminal task persistence is delegated before any caller can
 * level-check a flow or attempt a mission tick.
 */
export class ProcessRunReconciler {
  readonly #options: ProcessRunReconcilerOptions;

  constructor(options: ProcessRunReconcilerOptions) {
    this.#options = options;
  }

  async reconcile(params: { runId: string; ownerEpoch?: string }): Promise<DurableProcessReconcileResult> {
    const files = await readDurableHelperFiles(params.runId, this.#options);
    if (!files.intent) {
      return { runId: params.runId, state: "missing", reason: "intent-missing" };
    }
    if (params.ownerEpoch && files.intent.ownerEpoch !== params.ownerEpoch) {
      return { runId: params.runId, state: "lost", reason: "owner-epoch-mismatch" };
    }
    if (files.exit) {
      await this.#options.onTerminal?.({ runId: params.runId, exit: files.exit });
      return { runId: params.runId, state: "terminal", reason: "exit-observed", exit: files.exit };
    }
    if (!files.started) {
      const result: DurableProcessReconcileResult = {
        runId: params.runId,
        state: "lost",
        reason: "intent-without-started",
      };
      await this.#options.onLost?.({ runId: params.runId, reason: result.reason });
      return result;
    }
    const alive = await (this.#options.isHelperAlive ?? defaultIsHelperAlive)(files.started.helperPid);
    if (alive) {
      await this.#options.onRunning?.({
        runId: params.runId,
        helperPid: files.started.helperPid,
        childPid: files.started.childPid,
        runNonce: files.started.runNonce,
        startedAtMs: files.started.startedAtMs,
      });
      return { runId: params.runId, state: "running", reason: "helper-live" };
    }
    const result: DurableProcessReconcileResult = {
      runId: params.runId,
      state: "lost",
      reason: "started-helper-dead",
    };
    await this.#options.onLost?.({ runId: params.runId, reason: result.reason });
    return result;
  }
}
