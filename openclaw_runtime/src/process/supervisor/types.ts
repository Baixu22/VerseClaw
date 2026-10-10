// Process supervisor types describe supervised runs, states, and termination reasons.
export type RunState = "starting" | "running" | "exiting" | "exited";

export type TerminationReason =
  | "manual-cancel"
  | "overall-timeout"
  | "no-output-timeout"
  | "spawn-error"
  | "signal"
  | "exit"
  | "agent_abort";

/** Lifecycle identity carried by a supervised run; `scopeKey` is never identity. */
export type ProcessLifecycleIdentity = {
  agentId: string;
  canonicalSessionKey: string;
  expectedSessionId: string;
};

export type RunRecord = {
  runId: string;
  sessionId: string;
  backendId: string;
  scopeKey?: string;
  lifecycleAgentId?: string;
  lifecycleCanonicalSessionKey?: string;
  lifecycleExpectedSessionId?: string;
  pid?: number;
  processGroupId?: number;
  startedAtMs: number;
  lastOutputAtMs: number;
  createdAtMs: number;
  updatedAtMs: number;
  state: RunState;
  terminationReason?: TerminationReason;
  exitCode?: number | null;
  exitSignal?: NodeJS.Signals | number | null;
};

export type RunExit = {
  reason: TerminationReason;
  exitCode: number | null;
  exitSignal: NodeJS.Signals | number | null;
  durationMs: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  noOutputTimedOut: boolean;
  /** Whether the captured process tree was proven fully exited after the root. */
  termination: "verified" | "residual" | "unknown";
};

export type ManagedRun = {
  runId: string;
  pid?: number;
  startedAtMs: number;
  stdin?: ManagedRunStdin;
  wait: () => Promise<RunExit>;
  cancel: (reason?: TerminationReason) => void;
};

export type SpawnMode = "child" | "pty";

export type ManagedRunStdin = {
  write: (data: string, cb?: (err?: Error | null) => void) => void;
  end: () => void;
  destroy?: () => void;
  destroyed?: boolean;
  writable?: boolean;
  writableEnded?: boolean;
  writableFinished?: boolean;
};

export type SpawnProcessAdapter<WaitSignal = NodeJS.Signals | number | null> = {
  pid?: number;
  stdin?: ManagedRunStdin;
  onStdout: (listener: (chunk: string) => void) => void;
  onStderr: (listener: (chunk: string) => void) => void;
  wait: () => Promise<{ code: number | null; signal: WaitSignal }>;
  kill: (signal?: NodeJS.Signals) => void;
  dispose: () => void;
};

type SpawnBaseInput = {
  runId?: string;
  sessionId: string;
  backendId: string;
  scopeKey?: string;
  lifecycleAgentId?: string;
  lifecycleCanonicalSessionKey?: string;
  lifecycleExpectedSessionId?: string;
  replaceExistingScope?: boolean;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  noOutputTimeoutMs?: number;
  /**
   * When false, stdout/stderr are streamed via callbacks only and not retained in RunExit payload.
   */
  captureOutput?: boolean;
  /**
   * Maximum retained stdout/stderr characters per stream when captureOutput is enabled.
   * Streaming callbacks still receive full chunks.
   */
  maxCapturedOutputChars?: number;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
};

type SpawnChildInput = SpawnBaseInput & {
  mode: "child";
  argv: string[];
  windowsVerbatimArguments?: boolean;
  input?: string;
  stdinMode?: "inherit" | "pipe-open" | "pipe-closed";
};

type SpawnPtyInput = SpawnBaseInput & {
  mode: "pty";
  ptyCommand: string;
};

export type SpawnInput = SpawnChildInput | SpawnPtyInput;

export type LifecycleRunSnapshot = {
  runId: string;
  pid?: number;
  lifecycle: ProcessLifecycleIdentity;
  cancel: () => void;
  wait: () => Promise<RunExit>;
};

/** Read-only metadata snapshot for supervised runs of one session. */
export type SupervisorSessionRunSnapshot = {
  runId: string;
  pid?: number;
  state: RunState;
  lifecycleCanonicalSessionKey: string;
  /** Session generation the run is bound to (TF-0082 lineage join). */
  lifecycleExpectedSessionId?: string;
  startedAtMs: number;
  updatedAtMs: number;
};

export type DrainLifecycleResult = {
  drained: boolean;
  timedOut: boolean;
  runIds: string[];
  pids: number[];
};

export interface ProcessSupervisor {
  spawn(input: SpawnInput): Promise<ManagedRun>;
  cancel(runId: string, reason?: TerminationReason): void;
  cancelScope(scopeKey: string, reason?: TerminationReason): void;
  /** Attaches (or replaces) the persisted run manifest used for restart reconciliation. */
  attachRunManifest(store: import("./run-manifest.js").SupervisorRunManifestStore): void;
  /** Reconciles manifest entries orphaned by previous owner processes, fail-closed. */
  reconcileOrphans(
    dependencies?: import("./reconcile.js").ReconcileDependencies,
  ): Promise<import("./reconcile.js").SupervisorReconcileResult>;
  getRecord(runId: string): RunRecord | undefined;
  snapshotRunsForLifecycle(identity: ProcessLifecycleIdentity): LifecycleRunSnapshot[];
  snapshotRunsForSession(canonicalSessionKey: string): SupervisorSessionRunSnapshot[];
  countActiveRunsForLifecycle(identity: ProcessLifecycleIdentity): number;
  drainRunsForLifecycle(
    identity: ProcessLifecycleIdentity,
    timeoutMs: number,
  ): Promise<DrainLifecycleResult>;
}
