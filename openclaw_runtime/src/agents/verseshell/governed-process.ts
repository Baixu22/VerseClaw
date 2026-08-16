import type { JsonObject, Observation } from "../../../../shared/verseshell/types.js";
import type { TerminationReason } from "../../process/supervisor/types.js";
import {
  createGovernedVerseShellProcessConfig,
  getGovernedVerseShellManager,
  GovernedVerseShellError,
} from "./governed-exec.js";
import type { VerseShellProcessManager } from "./process-manager.js";
import {
  resolveVerseShellCommandPlan,
  type VerseShellCommandPlan,
} from "./command-profiles.js";

const APPROVAL_TOKEN = /^apv_[a-f0-9]{16}$/u;
const POLL_WAIT_MS = 1_000;
const POLL_REQUEST_TIMEOUT_MS = 5_000;
const MAX_RECONCILE_RETRIES = 40;

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
  stdin: GovernedVerseShellProcessStdin;
  wait: () => Promise<GovernedVerseShellProcessExit>;
  kill: (reason?: TerminationReason) => Promise<void>;
};

export type GovernedVerseShellProcessOptions = {
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
  maxOutputBytes: number;
  usePty: boolean;
  agentId: string;
  sessionId: string;
  /** Host-owned parent trace for the complete lifecycle, never taken from operation args. */
  traceId?: string;
  hostPolicyApproved: boolean;
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
  const boundedTimeoutMs = options.timeoutMs === undefined
    ? profile.maxTimeoutMs
    : Math.min(Math.max(1, options.timeoutMs), profile.maxTimeoutMs);
  const boundedOutputBytes = Math.min(
    Math.max(1, options.maxOutputBytes),
    profile.maxOutputBytes,
  );
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
  };

  const firstClient = await manager.getClient(baseConfig);
  const traceId = options.traceId?.trim() || `verseshell-process:${options.sessionId}`;
  const first = await firstClient.execute("process.start", startArgs, {
    timeoutMs: POLL_REQUEST_TIMEOUT_MS,
    effectful: true,
    traceId,
  });
  let client = firstClient;
  let startObservation = first;
  if (first.error?.code === "E_NEEDS_APPROVAL") {
    if (!options.hostPolicyApproved) throw observationError(first);
    const token = approvalToken(first);
    if (!token) {
      throw new GovernedVerseShellError(
        "E_VERSESHELL_APPROVAL_CONTRACT",
        "VerseShell did not return a valid action-bound approval token",
      );
    }
    client = await manager.getClient({ ...baseConfig, approvalToken: token });
    startObservation = await client.execute("process.start", startArgs, {
      timeoutMs: POLL_REQUEST_TIMEOUT_MS,
      effectful: true,
      traceId,
    });
  }
  if (!startObservation.ok) {
    if (client !== firstClient) await manager.shutdownProcess(client.processKey);
    throw observationError(startObservation);
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
    }
  })();

  return {
    processId: identity.process_id,
    runtimeId: identity.runtime_id,
    pid: snapshot.pid,
    mode: snapshot.mode,
    stdin,
    wait: async () => await waitPromise,
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
