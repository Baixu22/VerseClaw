import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { JsonObject, Observation } from "../../../../shared/verseshell/types.js";
import type { TerminationReason } from "../../process/supervisor/types.js";
import {
  createGovernedVerseShellProcessConfig,
  getGovernedVerseShellManager,
  GovernedVerseShellError,
} from "./governed-exec.js";
import type { VerseShellProcessManager } from "./process-manager.js";
import {
  admitManagedProcess,
  resolveManagedProcessDefaultLimits,
  type ManagedProcessLease,
} from "./managed-process-capacity.js";
import {
  resolveVerseShellCommandPlan,
  type VerseShellCommandPlan,
} from "./command-profiles.js";

const APPROVAL_TOKEN = /^apv_[a-f0-9]{16}$/u;
const POLL_WAIT_MS = 1_000;
const POLL_REQUEST_TIMEOUT_MS = 5_000;
const MAX_RECONCILE_RETRIES = 40;

/**
 * `process.start` is the only operation that persists a lifecycle record, and the bundled
 * executor creates `<workspace>/.ae/process-lifecycle` as its first write. When that write is
 * denied by the host (observed under a restricted token as `Access denied. (os error 5)`, which
 * the executor's bare-`io::Error` mapper surfaces as `E_PROCESS_INTERNAL`), the failure is opaque
 * and looks like a broken executor. Creating the directory from the host first makes the executor
 * take its normal path: the approval gate, then the record write. This does not remove a host
 * write denial - it only makes it diagnosable instead of mysterious. See issue #160 and
 * `docs/dev/p1-160-verseshell-process-start-20261012.md`.
 *
 * Deliberately best-effort: if the directory already exists, or the host cannot create it, the
 * outcome is left to the executor so its own error still reaches the caller unchanged.
 */
function prepareVerseShellLifecycleRoot(workspace: string): void {
  try {
    mkdirSync(join(workspace, ".ae", "process-lifecycle"), { recursive: true });
  } catch {
    // Fall through: the executor reports the authoritative failure.
  }
}

type ProcessState = "running" | "exited" | "killed" | "lost";

type LifecycleIdentity = {
  process_id: string;
  runtime_id: string;
  agent_id: string;
  session_id: string;
};

type LifecycleSnapshot = LifecycleIdentity & {
  state: ProcessState;
  pid: number;
  mode: "pipe" | "pty";
  exitCode: number | null;
  timedOut: boolean;
  terminationReason?: string;
  cursor: number;
  artifacts: string[];
};

export type GovernedVerseShellProcessStdin = {
  write: (data: string, cb?: (error?: Error | null) => void) => void;
  end: (cb?: (error?: Error | null) => void) => void;
  destroy: () => void;
  destroyed: boolean;
  writable: boolean;
  writableEnded: boolean;
  writableFinished: boolean;
};

export type GovernedVerseShellProcessExit = {
  state: Exclude<ProcessState, "running">;
  exitCode: number | null;
  timedOut: boolean;
  terminationReason?: string;
  artifacts: string[];
};

export type GovernedVerseShellProcessHandle = {
  processId: string;
  runtimeId: string;
  pid: number;
  mode: "pipe" | "pty";
  approvalRequired: boolean;
  stdin: GovernedVerseShellProcessStdin;
  wait: () => Promise<GovernedVerseShellProcessExit>;
  kill: (reason?: TerminationReason) => Promise<void>;
  resourceReceipt: GovernedProcessResourceReceipt;
};

export type GovernedVerseShellProcessObservedResult = {
  stdout: string;
  stderr: string;
  success: boolean;
  exitCode: number | null;
  timedOut: boolean;
  state: Exclude<ProcessState, "running">;
  terminationReason?: string;
  observation: Observation;
  processKey: string;
  processPid: number;
  managerKey: string;
  processKeys: string[];
  approvalRequired: boolean;
  approvedByHost: boolean;
  deadlineAt: number;
  resourceReceipt: GovernedProcessResourceReceipt;
};
export type GovernedProcessResourceLimits = {
  maxMemoryBytes?: number;
  maxProcesses?: number;
  requireEnforcement?: boolean;
};

export type GovernedProcessResourceReceipt = {
  requested: GovernedProcessResourceLimits;
  /** Exactly what was sent to the executor, in the executor's own units. */
  applied: { maxMemoryMb?: number; maxProcesses?: number };
  enforced: boolean;
  enforcement: "job-object" | "unsupported";
  /**
   * How `enforced` was established. `job-object-configured` means the executor accepted the
   * limits when the process started and fails closed when SetInformationJobObject or
   * AssignProcessToJobObject fails. The bundled executor exposes no QueryInformationJobObject
   * readback, so `readback: "unavailable"` means kernel-level effective limits are not queried.
   */
  evidence: "job-object-configured" | "none";
  readback: "unavailable";
  detail?: string;
  /** Instance-wide managed-process occupancy at admission time. */
  capacity?: { live: number; limit?: number };
};

export type GovernedVerseShellProcessOptions = {
  beforeDispatch?: () => void;
  command: string;
  /** Host-owned argv produced before approval. */
  argv?: readonly string[];
  /** Immutable plan produced by OpenClaw's approval pipeline. */
  executionPlan?: VerseShellCommandPlan;
  /** Explicit terminal-shell compatibility; argv is the default. */
  shellMode?: "argv" | "explicit-shell";
  cwd: string;
  processEnv: Record<string, string>;
  timeoutMs?: number;
  /** Absolute host deadline; remaining time is bounded by this value before start. */
  deadlineAt?: number;
  maxOutputBytes: number;
  usePty: boolean;
  agentId: string;
  sessionId: string;
  /** Host-owned parent trace for the complete lifecycle, never taken from operation args. */
  traceId?: string;
  hostPolicyApproved: boolean;
  /** Optional resource limits; absent means no new limit. */
  resourceLimits?: GovernedProcessResourceLimits;
  runtimeEnv?: NodeJS.ProcessEnv;
  manager?: VerseShellProcessManager;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
};

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new GovernedVerseShellError("E_VERSESHELL_LIFECYCLE_PROTOCOL", `${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string" || !value) {
    throw new GovernedVerseShellError("E_VERSESHELL_LIFECYCLE_PROTOCOL", `${path} must be a non-empty string`);
  }
  return value;
}

function integer(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new GovernedVerseShellError("E_VERSESHELL_LIFECYCLE_PROTOCOL", `${path} must be a non-negative integer`);
  }
  return value;
}

function observationError(observation: Observation): GovernedVerseShellError {
  return new GovernedVerseShellError(
    observation.error?.code ?? "E_VERSESHELL_LIFECYCLE",
    observation.error?.message ?? "VerseShell lifecycle operation failed",
    observation.error?.hint,
  );
}

function approvalToken(observation: Observation): string | undefined {
  const token = asRecord(observation.data ?? {}, "$observation.data").approval_token;
  return typeof token === "string" && APPROVAL_TOKEN.test(token) ? token : undefined;
}

function parseSnapshot(
  observation: Observation,
  expected: LifecycleIdentity | undefined,
  priorCursor: number,
  onStdout?: (chunk: string) => void,
  onStderr?: (chunk: string) => void,
): LifecycleSnapshot {
  if (!observation.ok) throw observationError(observation);
  const data = asRecord(observation.data, "$observation.data");
  const state = string(data.state, "$observation.data.state") as ProcessState;
  if (!(["running", "exited", "killed", "lost"] as const).includes(state)) {
    throw new GovernedVerseShellError(
      "E_VERSESHELL_LIFECYCLE_PROTOCOL",
      `Unsupported VerseShell process state: ${state}`,
    );
  }
  const identity: LifecycleIdentity = {
    process_id: string(data.process_id, "$observation.data.process_id"),
    runtime_id: string(data.runtime_id, "$observation.data.runtime_id"),
    agent_id: string(data.agent_id, "$observation.data.agent_id"),
    session_id: string(data.session_id, "$observation.data.session_id"),
  };
  if (expected && Object.keys(identity).some((key) => {
    const field = key as keyof LifecycleIdentity;
    return identity[field] !== expected[field];
  })) {
    throw new GovernedVerseShellError(
      "E_VERSESHELL_LIFECYCLE_OWNER",
      "VerseShell lifecycle response ownership changed",
    );
  }

  const output = asRecord(data.output, "$observation.data.output");
  const cursor = integer(output.cursor, "$observation.data.output.cursor");
  if (cursor < priorCursor) {
    throw new GovernedVerseShellError(
      "E_VERSESHELL_LIFECYCLE_CURSOR",
      `VerseShell cursor rewound from ${priorCursor} to ${cursor}`,
    );
  }
  const chunks = output.chunks;
  if (!Array.isArray(chunks)) {
    throw new GovernedVerseShellError(
      "E_VERSESHELL_LIFECYCLE_PROTOCOL",
      "$observation.data.output.chunks must be an array",
    );
  }
  for (const [index, value] of chunks.entries()) {
    const chunk = asRecord(value, `$observation.data.output.chunks[${index}]`);
    const stream = string(chunk.stream, `$observation.data.output.chunks[${index}].stream`);
    const text = typeof chunk.text === "string" ? chunk.text : "";
    if (stream === "stderr") onStderr?.(text);
    else if (stream === "stdout" || stream === "pty") onStdout?.(text);
    else {
      throw new GovernedVerseShellError(
        "E_VERSESHELL_LIFECYCLE_PROTOCOL",
        `Unsupported VerseShell output stream: ${stream}`,
      );
    }
  }
  const lostBytes = integer(output.lost_bytes, "$observation.data.output.lost_bytes");
  if (lostBytes > 0) {
    onStderr?.(`[VerseShell retained output lost before cursor: ${lostBytes} bytes]\n`);
  }
  const artifactValues = Array.isArray(data.artifacts) ? data.artifacts : [];
  const artifacts = artifactValues.flatMap((value) => {
    const artifact = asRecord(value, "$observation.data.artifacts[]");
    return typeof artifact.handle === "string" ? [artifact.handle] : [];
  });
  return {
    ...identity,
    state,
    pid: integer(data.pid, "$observation.data.pid"),
    mode: data.mode === "pty" ? "pty" : "pipe",
    exitCode: typeof data.exit_code === "number" && Number.isInteger(data.exit_code)
      ? data.exit_code
      : null,
    timedOut: data.timed_out === true,
    terminationReason: typeof data.termination_reason === "string"
      ? data.termination_reason
      : undefined,
    cursor,
    artifacts,
  };
}

function ownerArgs(identity: LifecycleIdentity): JsonObject {
  return { ...identity };
}

function isRetryablePollError(error: unknown): boolean {
  const code = error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code)
    : "";
  return ["E_ACI_BACKOFF", "E_ACI_PROCESS_EXITED", "E_ACI_TRANSPORT", "E_ACI_WRITE"].includes(code);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

/** Start one approved lifecycle process without replaying an effectful request. */
export async function startGovernedVerseShellProcess(
  options: GovernedVerseShellProcessOptions,
): Promise<GovernedVerseShellProcessHandle> {
  const manager = getGovernedVerseShellManager(options.manager);
  const baseConfig = createGovernedVerseShellProcessConfig({
    cwd: options.cwd,
    timeoutMs: POLL_REQUEST_TIMEOUT_MS,
    agentId: options.agentId,
    env: options.runtimeEnv,
  });
  const plan = options.executionPlan ?? resolveVerseShellCommandPlan({
    command: options.command,
    argv: options.argv,
    cwd: options.cwd,
    env: options.processEnv,
    allowExplicitShell: options.shellMode !== "argv",
  });
  // The runtime derives cmd.exe itself from the resolved script path plus env;
  // this check keeps the pre-approval script identity auditable at the process
  // boundary instead of letting a drifted plan silently re-route execution.
  if (plan.interpreterProfile === "windows-cmd" && (plan.argv[0] !== plan.resolvedScript || !plan.interpreter)) {
    throw new GovernedVerseShellError(
      "E_VERSESHELL_SCRIPT_IDENTITY",
      "windows-cmd plan script identity drifted from the pre-approval argv",
    );
  }
  const profile = plan.profileDefinition;
  const remainingDeadlineMs = options.deadlineAt === undefined
    ? profile.maxTimeoutMs
    : options.deadlineAt - Date.now();
  if (remainingDeadlineMs <= 0) {
    throw new GovernedVerseShellError("E_PROCESS_DEADLINE", "candidate verification deadline has elapsed");
  }
  const boundedTimeoutMs = options.timeoutMs === undefined
    ? Math.min(profile.maxTimeoutMs, remainingDeadlineMs)
    : Math.min(Math.max(1, options.timeoutMs), profile.maxTimeoutMs, remainingDeadlineMs);
  const boundedOutputBytes = Math.min(
    Math.max(1, options.maxOutputBytes),
    profile.maxOutputBytes,
  );
  // Operator-declared defaults apply unless the caller states its own limits.
  const requestedLimits: GovernedProcessResourceLimits = {
    ...resolveManagedProcessDefaultLimits(),
    ...(options.resourceLimits ?? {}),
  };
  const hasRequestedLimits =
    requestedLimits.maxMemoryBytes !== undefined || requestedLimits.maxProcesses !== undefined;
  if (
    (requestedLimits.maxMemoryBytes !== undefined &&
      (!Number.isSafeInteger(requestedLimits.maxMemoryBytes) || requestedLimits.maxMemoryBytes <= 0)) ||
    (requestedLimits.maxProcesses !== undefined &&
      (!Number.isSafeInteger(requestedLimits.maxProcesses) || requestedLimits.maxProcesses <= 0))
  ) {
    throw new GovernedVerseShellError(
      "E_PROCESS_RESOURCE_LIMIT",
      "resource limits must be positive integers",
    );
  }
  // The executor takes MiB for the Windows per-process commit limit.
  const appliedLimits: { maxMemoryMb?: number; maxProcesses?: number } = {
    ...(requestedLimits.maxProcesses === undefined
      ? {}
      : { maxProcesses: requestedLimits.maxProcesses }),
    ...(requestedLimits.maxMemoryBytes === undefined
      ? {}
      : { maxMemoryMb: Math.max(1, Math.ceil(requestedLimits.maxMemoryBytes / (1024 * 1024))) }),
  };
  const resourceReceipt: GovernedProcessResourceReceipt = {
    requested: requestedLimits,
    applied: appliedLimits,
    enforced: false,
    enforcement: "unsupported",
    evidence: "none",
    readback: "unavailable",
    detail: hasRequestedLimits
      ? "Resource limits were requested but the managed process has not started yet."
      : "No resource limits requested.",
  };
  // Instance-wide occupancy is admitted before the process starts so several sessions cannot
  // each assume they own the whole declared capacity. No declaration means no counter.
  const capacityAdmission = admitManagedProcess();
  if (!capacityAdmission.ok) {
    throw new GovernedVerseShellError(
      "E_PROCESS_CAPACITY_LIMIT",
      `managed tool process capacity is exhausted: live=${capacityAdmission.live} limit=${capacityAdmission.limit}`,
    );
  }
  const capacityLease: ManagedProcessLease = capacityAdmission.lease;
  resourceReceipt.capacity = {
    live: capacityAdmission.live,
    ...(capacityAdmission.limit === undefined ? {} : { limit: capacityAdmission.limit }),
  };
  const startArgs: JsonObject = {
    argv: plan.argv,
    cwd: ".",
    agent_id: options.agentId,
    session_id: options.sessionId,
    env: options.processEnv,
    stdin_mode: "pipe",
    pty: options.usePty,
    max_output_bytes: boundedOutputBytes,
    wait_ms: 0,
    timeout_ms: boundedTimeoutMs,
    ...(appliedLimits.maxMemoryMb === undefined ? {} : { max_memory_mb: appliedLimits.maxMemoryMb }),
    ...(appliedLimits.maxProcesses === undefined ? {} : { max_processes: appliedLimits.maxProcesses }),
  };

  prepareVerseShellLifecycleRoot(baseConfig.workspace);
  const firstClient = await manager.getClient(baseConfig).catch(error => { capacityLease.release(); throw error; });
  const traceId = options.traceId?.trim() || `verseshell-process:${options.sessionId}`;
  const releaseCapacity = (): boolean => capacityLease.release();
  const first = await firstClient.execute("process.start", startArgs, {
    beforeDispatch: options.beforeDispatch,
    timeoutMs: POLL_REQUEST_TIMEOUT_MS,
    effectful: true,
    traceId,
  }).catch(error => { releaseCapacity(); throw error; });
  let client = firstClient;
  let startObservation = first;
  if (first.error?.code === "E_NEEDS_APPROVAL") {
    if (!options.hostPolicyApproved) {
      releaseCapacity();
      throw observationError(first);
    }
    const token = approvalToken(first);
    if (!token) {
      releaseCapacity();
      throw new GovernedVerseShellError(
        "E_VERSESHELL_APPROVAL_CONTRACT",
        "VerseShell did not return a valid action-bound approval token",
      );
    }
    client = await manager.getClient({ ...baseConfig, approvalToken: token }).catch(error => { releaseCapacity(); throw error; });
    startObservation = await client.execute("process.start", startArgs, {
      beforeDispatch: options.beforeDispatch,
      timeoutMs: POLL_REQUEST_TIMEOUT_MS,
      effectful: true,
      traceId,
    }).catch(error => { releaseCapacity(); throw error; });
  }
  if (!startObservation.ok) {
    if (client !== firstClient) await manager.shutdownProcess(client.processKey);
    releaseCapacity();
    throw observationError(startObservation);
  }
  if (hasRequestedLimits) {
    // The executor rejects unknown arguments and fails closed when the Job cannot be configured,
    // so a started process means the limits were applied to its Job Object.
    resourceReceipt.enforced = true;
    resourceReceipt.enforcement = "job-object";
    resourceReceipt.evidence = "job-object-configured";
    resourceReceipt.detail =
      "Job Object limits accepted at process start; the executor fails closed when " +
      "SetInformationJobObject or AssignProcessToJobObject fails. The bundled executor exposes no " +
      "QueryInformationJobObject readback, so effective kernel limits are not queried: " +
      "maxMemoryBytes maps to the Windows per-process commit limit (JOB_OBJECT_LIMIT_PROCESS_MEMORY), " +
      "which is neither RSS nor a job-wide total, and maxProcesses maps to " +
      "JOB_OBJECT_LIMIT_ACTIVE_PROCESS for the whole tree.";
  }
  if (hasRequestedLimits && requestedLimits.requireEnforcement && !resourceReceipt.enforced) {
    await manager.shutdownProcess(client.processKey);
    releaseCapacity();
    throw new GovernedVerseShellError(
      "E_PROCESS_RESOURCE_LIMIT_UNSUPPORTED",
      resourceReceipt.detail ?? "resource limits unsupported",
    );
  }

  let snapshot = parseSnapshot(
    startObservation,
    undefined,
    0,
    options.onStdout,
    options.onStderr,
  );
  const identity: LifecycleIdentity = {
    process_id: snapshot.process_id,
    runtime_id: snapshot.runtime_id,
    agent_id: snapshot.agent_id,
    session_id: snapshot.session_id,
  };
  let writeChain = Promise.resolve();
  let settled = false;

  const write = (data: string, eof: boolean): Promise<void> => {
    writeChain = writeChain.then(async () => {
      const observation = await client.execute(
        "process.write",
        { ...ownerArgs(identity), data, encoding: "utf8", eof },
        { timeoutMs: POLL_REQUEST_TIMEOUT_MS, effectful: true, traceId },
      );
      if (!observation.ok) throw observationError(observation);
    });
    return writeChain;
  };

  const stdin: GovernedVerseShellProcessStdin = {
    destroyed: false,
    writable: true,
    writableEnded: false,
    writableFinished: false,
    write(data, callback) {
      if (stdin.destroyed || stdin.writableEnded) {
        callback?.(new GovernedVerseShellError("E_PROCESS_STDIN_CLOSED", "VerseShell stdin is closed"));
        return;
      }
      void write(data, false).then(
        () => callback?.(null),
        (error) => {
          stdin.destroy();
          callback?.(error as Error);
        },
      );
    },
    end(callback) {
      if (stdin.destroyed || stdin.writableEnded) {
        callback?.(new GovernedVerseShellError("E_PROCESS_STDIN_CLOSED", "VerseShell stdin is closed"));
        return;
      }
      stdin.writableEnded = true;
      stdin.writable = false;
      void write("", true).then(
        () => {
          stdin.writableFinished = true;
          callback?.(null);
        },
        (error) => {
          stdin.destroyed = true;
          callback?.(error as Error);
        },
      );
    },
    destroy() {
      stdin.destroyed = true;
      stdin.writable = false;
    },
  };

  const waitPromise = (async (): Promise<GovernedVerseShellProcessExit> => {
    let retries = 0;
    try {
      while (snapshot.state === "running") {
        let observation: Observation;
        try {
          observation = await client.execute(
            "process.poll",
            {
              ...ownerArgs(identity),
              cursor: snapshot.cursor,
              max_bytes: 64 * 1024,
              wait_ms: POLL_WAIT_MS,
            },
            { timeoutMs: POLL_REQUEST_TIMEOUT_MS, traceId },
          );
          retries = 0;
        } catch (error) {
          if (!isRetryablePollError(error) || retries >= MAX_RECONCILE_RETRIES) throw error;
          retries += 1;
          await delay(Math.min(100 * retries, 1_000));
          continue;
        }
        snapshot = parseSnapshot(
          observation,
          identity,
          snapshot.cursor,
          options.onStdout,
          options.onStderr,
        );
      }
      return {
        state: snapshot.state,
        exitCode: snapshot.exitCode,
        timedOut: snapshot.timedOut,
        terminationReason: snapshot.terminationReason,
        artifacts: snapshot.artifacts,
      };
    } finally {
      settled = true;
      stdin.destroy();
      await manager.shutdownProcess(client.processKey);
      // Capacity is only returned once a terminal state was observed. If the wait ended in an
      // unknown state the slot stays occupied (and is visible as a leak) rather than being
      // released on an unverified exit.
      if (snapshot.state !== "running") {
        releaseCapacity();
      }
    }
  })();

  const approvalRequired = first.error?.code === "E_NEEDS_APPROVAL";
  return {
    processId: identity.process_id,
    runtimeId: identity.runtime_id,
    pid: snapshot.pid,
    mode: snapshot.mode,
    approvalRequired,
    stdin,
    wait: async () => await waitPromise,
    resourceReceipt,
    kill: async (reason = "manual-cancel") => {
      if (settled) return;
      const observation = await client.execute(
        "process.kill",
        { ...ownerArgs(identity), reason, wait_ms: 0 },
        { timeoutMs: POLL_REQUEST_TIMEOUT_MS, effectful: true, traceId },
      );
      if (!observation.ok) throw observationError(observation);
    },
  };
}

/**
 * Run one exact plan through the production process.start lifecycle and derive a
 * host-owned observation from the verified exit, streams and managed process identity.
 */
export async function executeGovernedVerseShellProcessObserved(
  options: GovernedVerseShellProcessOptions,
): Promise<GovernedVerseShellProcessObservedResult> {
  const manager = getGovernedVerseShellManager(options.manager);
  const startedAt = Date.now();
  const deadlineAt = options.deadlineAt ?? startedAt + (options.timeoutMs ?? 60_000);
  let stdout = "";
  let stderr = "";
  const handle = await startGovernedVerseShellProcess({
    ...options,
    manager,
    onStdout: (chunk) => {
      stdout += chunk;
      options.onStdout?.(chunk);
    },
    onStderr: (chunk) => {
      stderr += chunk;
      options.onStderr?.(chunk);
    },
  });
  const health = manager.list().find((entry) => entry.pid === handle.pid);
  const processKey = health?.key ?? `process-pid-${handle.pid}`;
  const managerKey = health?.key ?? processKey;
  const exit = await handle.wait();
  const success = exit.state === "exited" && exit.exitCode === 0 && !exit.timedOut;
  const observation: Observation = {
    schema: "verseshell.observation/v1",
    id: `host-process-${handle.processId}`,
    op: "process.start",
    ok: success,
    status: success ? "ok" : "failed",
    data: {
      exit_code: exit.exitCode,
      timed_out: exit.timedOut,
      state: exit.state,
      stdout: { text: stdout },
      stderr: { text: stderr },
      ...(exit.terminationReason ? { termination_reason: exit.terminationReason } : {}),
      artifacts: exit.artifacts,
    },
    meta: {
      elapsed_ms: Date.now() - startedAt,
      profile: "clawx-governed-process/v1",
      token_estimate: Math.ceil((stdout.length + stderr.length) / 4),
      capabilities_used: ["shell.exec"],
    },
  };
  return {
    stdout,
    stderr,
    success,
    exitCode: exit.exitCode,
    timedOut: exit.timedOut,
    state: exit.state,
    ...(exit.terminationReason ? { terminationReason: exit.terminationReason } : {}),
    observation,
    processKey,
    processPid: handle.pid,
    managerKey,
    processKeys: [processKey],
    approvalRequired: handle.approvalRequired,
    approvedByHost: options.hostPolicyApproved,
    deadlineAt,
    resourceReceipt: handle.resourceReceipt,
  };
}
