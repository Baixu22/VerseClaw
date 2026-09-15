/**
 * In-memory registry for bash exec sessions.
 * Tracks running/backgrounded sessions, bounded pending output, finished
 * session retention, and process cleanup for reconnect/poll flows.
 */
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { SessionAdmissionIdentity } from "../sessions/session-admission-registry.js";
import type { EventSessionRoutingPolicy } from "../infra/event-session-routing.js";
import { signalProcessTree } from "../process/kill-tree.js";
import type { TerminationReason } from "../process/supervisor/types.js";
import type { DeliveryContext } from "../utils/delivery-context.js";
import { readEnvInt } from "./bash-tools.shared.js";
import { createSessionSlug as createSessionSlugId } from "./session-slug.js";

const DEFAULT_JOB_TTL_MS = 30 * 60 * 1000; // 30 minutes
const MIN_JOB_TTL_MS = 60 * 1000; // 1 minute
const MAX_JOB_TTL_MS = 3 * 60 * 60 * 1000; // 3 hours
const DEFAULT_PENDING_OUTPUT_CHARS = 30_000;

function clampTtl(value: number | undefined) {
  if (!value || Number.isNaN(value)) {
    return DEFAULT_JOB_TTL_MS;
  }
  return Math.min(Math.max(value, MIN_JOB_TTL_MS), MAX_JOB_TTL_MS);
}

let jobTtlMs = clampTtl(readEnvInt("OPENCLAW_BASH_JOB_TTL_MS", "PI_BASH_JOB_TTL_MS"));

/** Lifecycle status recorded for background process sessions. */
export type ProcessStatus = "running" | "completed" | "failed" | "killed";

/** Writable stdin surface shared by child-process and PTY-backed sessions. */
export type SessionStdin = {
  write: (data: string, cb?: (err?: Error | null) => void) => void;
  end: (cb?: (err?: Error | null) => void) => void;
  // When backed by a real Node stream (child.stdin), this exists; for PTY wrappers it may not.
  destroy?: () => void;
  destroyed?: boolean;
  writable?: boolean;
  writableEnded?: boolean;
  writableFinished?: boolean;
};

/** Mutable session state for a running bash exec process. */
export interface ProcessSession {
  id: string;
  command: string;
  scopeKey?: string;
  sessionKey?: string;
  /** `session.mainKey` from the runtime config, snapshotted at exec start.
   *  Used by background-exit notifications to remap cron-run keys to the
   *  agent's main queue without an ambient config load. If config changes
   *  while the process runs, the exit notification follows the start-time
   *  session contract. */
  mainKey?: string;
  /** `session.scope` from the runtime config; required so the cron-run remap
   *  can route global-scope agents to the literal "global" queue instead
   *  of an agent-main queue the heartbeat never drains. Snapshotted with
   *  `mainKey` for the same start-time routing reason. */
  sessionScope?: "per-sender" | "global";
  /** Start-time routing policy for detached exec system events. */
  eventRouting?: EventSessionRoutingPolicy;
  notifyDeliveryContext?: DeliveryContext;
  notifyOnExit?: boolean;
  notifyOnExitEmptySuccess?: boolean;
  exitNotified?: boolean;
  child?: ChildProcessWithoutNullStreams;
  stdin?: SessionStdin;
  pid?: number;
  /** Non-native lifecycle owner; prevents PID fallback from bypassing its control plane. */
  lifecycleOwner?: "native" | "sandbox" | "node" | "verseshell" | "legacy-verseshell" | "durable-helper";
  lifecycleCancel?: (reason: TerminationReason) => void;
  lifecycleAgentId?: string;
  lifecycleCanonicalSessionKey?: string;
  lifecycleExpectedSessionId?: string;
  /** `session.store` template from the runtime config, snapshotted at exec
   *  start so the exit-time generation guard can resolve the key's current
   *  sessionId without an ambient config load. Follows the same start-time
   *  snapshot convention as `mainKey`/`sessionScope`. */
  lifecycleSessionStoreTemplate?: string;
  /** Resolves when the owned process has actually exited (not merely closed stdio). */
  lifecycleExitPromise?: Promise<unknown>;
  lastOutputAt?: number;
  startedAt: number;
  cwd?: string;
  maxOutputChars: number;
  pendingMaxOutputChars?: number;
  totalOutputChars: number;
  pendingStdout: string[];
  pendingStderr: string[];
  pendingStdoutChars: number;
  pendingStderrChars: number;
  aggregated: string;
  tail: string;
  exitCode?: number | null;
  exitSignal?: NodeJS.Signals | number | null;
  exitReason?: TerminationReason;
  exited: boolean;
  truncated: boolean;
  backgrounded: boolean;
  /** PTY cursor key mode: unknown until a PTY reports smkx/rmkx. */
  cursorKeyMode: "unknown" | "normal" | "application";
}

/** Retained summary for a completed background session. */
export interface FinishedSession {
  id: string;
  command: string;
  scopeKey?: string;
  startedAt: number;
  endedAt: number;
  cwd?: string;
  status: ProcessStatus;
  exitCode?: number | null;
  exitSignal?: NodeJS.Signals | number | null;
  exitReason?: TerminationReason;
  aggregated: string;
  tail: string;
  truncated: boolean;
  totalOutputChars: number;
  lifecycleAgentId?: string;
  lifecycleCanonicalSessionKey?: string;
  lifecycleExpectedSessionId?: string;
}

const runningSessions = new Map<string, ProcessSession>();
const finishedSessions = new Map<string, FinishedSession>();

let sweeper: NodeJS.Timeout | null = null;

function isSessionIdTaken(id: string) {
  return runningSessions.has(id) || finishedSessions.has(id);
}

/** Creates a unique short session id that avoids running and retained sessions. */
export function createSessionSlug(): string {
  return createSessionSlugId(isSessionIdTaken);
}

/** Adds a running session and starts retention sweeping if needed. */
export function addSession(session: ProcessSession) {
  runningSessions.set(session.id, session);
  startSweeper();
}

/** Returns a running session by id. */
export function getSession(id: string) {
  return runningSessions.get(id);
}

/** Returns a retained finished background session by id. */
export function getFinishedSession(id: string) {
  return finishedSessions.get(id);
}

/** Removes a session from both running and finished registries. */
export function deleteSession(id: string) {
  runningSessions.delete(id);
  finishedSessions.delete(id);
  stopSweeperWhenEmpty();
}

/** Appends process output while enforcing aggregate and pending-output caps. */
export function appendOutput(session: ProcessSession, stream: "stdout" | "stderr", chunk: string) {
  session.pendingStdout ??= [];
  session.pendingStderr ??= [];
  session.pendingStdoutChars ??= sumPendingChars(session.pendingStdout);
  session.pendingStderrChars ??= sumPendingChars(session.pendingStderr);
  const buffer = stream === "stdout" ? session.pendingStdout : session.pendingStderr;
  const bufferChars = stream === "stdout" ? session.pendingStdoutChars : session.pendingStderrChars;
  const pendingCap = Math.min(
    session.pendingMaxOutputChars ?? DEFAULT_PENDING_OUTPUT_CHARS,
    session.maxOutputChars,
  );
  buffer.push(chunk);
  let pendingChars = bufferChars + chunk.length;
  if (pendingChars > pendingCap) {
    session.truncated = true;
    pendingChars = capPendingBuffer(buffer, pendingChars, pendingCap);
  }
  if (stream === "stdout") {
    session.pendingStdoutChars = pendingChars;
  } else {
    session.pendingStderrChars = pendingChars;
  }
  session.totalOutputChars += chunk.length;
  session.lastOutputAt = Date.now();
  const aggregated = trimWithCap(session.aggregated + chunk, session.maxOutputChars);
  session.truncated =
    session.truncated || aggregated.length < session.aggregated.length + chunk.length;
  session.aggregated = aggregated;
  session.tail = tail(session.aggregated, 2000);
}

/** Drains pending stdout/stderr chunks returned by a process poll. */
export function drainSession(session: ProcessSession) {
  const stdout = session.pendingStdout.join("");
  const stderr = session.pendingStderr.join("");
  session.pendingStdout = [];
  session.pendingStderr = [];
  session.pendingStdoutChars = 0;
  session.pendingStderrChars = 0;
  return { stdout, stderr };
}

/** Moves a session to finished state and records exit metadata. */
export function markExited(
  session: ProcessSession,
  exitCode: number | null,
  exitSignal: NodeJS.Signals | number | null,
  status: ProcessStatus,
  exitReason?: TerminationReason,
) {
  if (session.exited) {
    // The first owner records terminal facts; late exit notifications must not overwrite them.
    return;
  }
  session.exited = true;
  session.exitCode = exitCode;
  session.exitSignal = exitSignal;
  session.exitReason = exitReason;
  session.tail = tail(session.aggregated, 2000);
  moveToFinished(session, status);
}

/** Marks a running session as reconnectable after the exec call returns. */
export function markBackgrounded(session: ProcessSession) {
  session.backgrounded = true;
}

function moveToFinished(session: ProcessSession, status: ProcessStatus) {
  runningSessions.delete(session.id);

  // Clean up child process stdio streams to prevent FD leaks
  if (session.child) {
    // Destroy stdio streams to release file descriptors
    session.child.stdin?.destroy?.();
    session.child.stdout?.destroy?.();
    session.child.stderr?.destroy?.();

    // Remove all event listeners to prevent memory leaks
    session.child.removeAllListeners();

    // Clear the reference
    delete session.child;
  }

  // Clean up stdin wrapper - call destroy if available, otherwise just remove reference
  if (session.stdin) {
    // Try to call destroy/end method if exists
    if (typeof session.stdin.destroy === "function") {
      session.stdin.destroy();
    } else if (typeof session.stdin.end === "function") {
      session.stdin.end();
    }
    // Only set flag if writable
    try {
      (session.stdin as { destroyed?: boolean }).destroyed = true;
    } catch {
      // Ignore if read-only
    }
    delete session.stdin;
  }

  if (!session.backgrounded) {
    return;
  }
  finishedSessions.set(session.id, {
    id: session.id,
    command: session.command,
    scopeKey: session.scopeKey,
    startedAt: session.startedAt,
    endedAt: Date.now(),
    cwd: session.cwd,
    status,
    exitCode: session.exitCode,
    exitSignal: session.exitSignal,
    exitReason: session.exitReason,
    aggregated: session.aggregated,
    tail: session.tail,
    truncated: session.truncated,
    totalOutputChars: session.totalOutputChars,
    lifecycleAgentId: session.lifecycleAgentId,
    lifecycleCanonicalSessionKey: session.lifecycleCanonicalSessionKey,
    lifecycleExpectedSessionId: session.lifecycleExpectedSessionId,
  });
}

/** Returns the last `max` characters of text without adding ellipses. */
export function tail(text: string, max = 2000) {
  if (text.length <= max) {
    return text;
  }
  return text.slice(text.length - max);
}

function sumPendingChars(buffer: string[]) {
  let total = 0;
  for (const chunk of buffer) {
    total += chunk.length;
  }
  return total;
}

function capPendingBuffer(buffer: string[], pendingCharsInput: number, cap: number) {
  let pendingChars = pendingCharsInput;
  if (pendingChars <= cap) {
    return pendingChars;
  }
  const last = buffer.at(-1);
  if (last && last.length >= cap) {
    buffer.length = 0;
    buffer.push(last.slice(last.length - cap));
    return cap;
  }
  let dropCount = 0;
  while (dropCount < buffer.length) {
    const chunk = buffer[dropCount];
    if (chunk === undefined || pendingChars - chunk.length < cap) {
      break;
    }
    pendingChars -= chunk.length;
    dropCount += 1;
  }
  if (dropCount > 0) {
    buffer.splice(0, dropCount);
  }
  if (buffer.length && pendingChars > cap) {
    const overflow = pendingChars - cap;
    buffer[0] = buffer[0].slice(overflow);
    pendingChars = cap;
  }
  return pendingChars;
}

/** Keeps only the last `max` characters for bounded aggregate output storage. */
export function trimWithCap(text: string, max: number) {
  if (text.length <= max) {
    return text;
  }
  return text.slice(text.length - max);
}

/** Lists backgrounded running sessions visible to reconnect/poll callers. */
export function listRunningSessions() {
  return Array.from(runningSessions.values()).filter((s) => s.backgrounded);
}

/** Lists retained finished background sessions. */
export function listFinishedSessions() {
  return Array.from(finishedSessions.values());
}

/** Detached drain handle for one bash process session. */
export type BashProcessSessionDrainHandle = {
  id: string;
  pid?: number;
  lifecycleOwner?: ProcessSession["lifecycleOwner"];
  cancel: () => "cancelled" | "unknown";
  wait: (timeoutMs: number) => Promise<"exited" | "timeout" | "unknown">;
};

/** Snapshot of the bash process registries used by lifecycle drain and audit. */
export type BashProcessRegistryState = {
  runningCount: number;
  finishedCount: number;
  sweeperActive: boolean;
};

function matchesLifecycleIdentity(
  session: Pick<
    ProcessSession,
    "lifecycleAgentId" | "lifecycleCanonicalSessionKey" | "lifecycleExpectedSessionId"
  >,
  identity: SessionAdmissionIdentity,
): boolean {
  return (
    session.lifecycleAgentId === identity.agentId &&
    session.lifecycleCanonicalSessionKey === identity.canonicalSessionKey &&
    session.lifecycleExpectedSessionId === identity.expectedSessionId
  );
}

function waitForChildProcessExit(
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number,
): Promise<"exited" | "timeout"> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve("exited");
      return;
    }
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.off("exit", onExit);
      resolve("timeout");
    }, Math.max(1, Math.floor(timeoutMs)));
    const onExit = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve("exited");
    };
    child.once("exit", onExit);
  });
}

function waitForSessionExit(
  session: ProcessSession,
  timeoutMs: number,
): Promise<"exited" | "timeout" | "unknown"> {
  if (session.exited || finishedSessions.has(session.id)) {
    return Promise.resolve("exited");
  }
  const timeoutValue = Math.max(1, Math.floor(timeoutMs));
  if (session.lifecycleExitPromise) {
    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve("timeout");
      }, timeoutValue);
      void session.lifecycleExitPromise?.then(
        () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve("exited");
        },
        () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve("unknown");
        },
      );
    });
  }
  if (session.child) {
    return waitForChildProcessExit(session.child, timeoutValue);
  }
  // No owned process handle or lifecycle promise: the owner state is unknown.
  return Promise.resolve("unknown");
}

function cancelProcessSession(session: ProcessSession): "cancelled" | "unknown" {
  if (session.exited || finishedSessions.has(session.id)) {
    return "cancelled";
  }
  if (session.lifecycleCancel) {
    session.lifecycleCancel("manual-cancel");
    return "cancelled";
  }
  const owner = session.lifecycleOwner;
  // Governed VerseShell sessions are owned by another control plane. Falling
  // back to a raw PID kill would bypass that control plane, so fail closed.
  if (owner === undefined || owner === "verseshell" || owner === "legacy-verseshell") {
    return "unknown";
  }
  if (session.pid && session.pid > 0) {
    signalProcessTree(session.pid, "SIGTERM");
    return "cancelled";
  }
  if (session.child) {
    try {
      session.child.kill("SIGTERM");
      return "cancelled";
    } catch {
      return "unknown";
    }
  }
  return "unknown";
}

/**
 * Snapshots running and finished bash process sessions that carry this exact
 * lifecycle identity. `scopeKey` is never used as identity; unmatched or
 * unknown owner records are intentionally not included so drain cannot degrade
 * into a broader kill.
 */
export function snapshotProcessSessionsForLifecycle(
  identity: SessionAdmissionIdentity,
): BashProcessSessionDrainHandle[] {
  const handles: BashProcessSessionDrainHandle[] = [];
  for (const session of runningSessions.values()) {
    if (!matchesLifecycleIdentity(session, identity)) continue;
    handles.push({
      id: session.id,
      pid: session.pid,
      lifecycleOwner: session.lifecycleOwner,
      cancel: () => cancelProcessSession(session),
      wait: (timeoutMs) => waitForSessionExit(session, timeoutMs),
    });
  }
  for (const session of finishedSessions.values()) {
    if (!matchesLifecycleIdentity(session, identity)) continue;
    handles.push({
      id: session.id,
      lifecycleOwner: undefined,
      cancel: () => "cancelled",
      wait: () => Promise.resolve("exited"),
    });
  }
  return handles;
}

/** Registry stats for drain no-new-record checks and lifecycle leak tests. */
export function getBashProcessRegistryState(): BashProcessRegistryState {
  return {
    runningCount: runningSessions.size,
    finishedCount: finishedSessions.size,
    sweeperActive: sweeper !== null,
  };
}

/**
 * TF-0081 idle classification for running bash sessions. Classification is
 * observability only — nothing is killed automatically; a session with recent
 * output is a live running process and is never a reclamation candidate.
 */
export type BashProcessIdleClassification = "running-process" | "idle" | "completed";

const DEFAULT_RUNNING_IDLE_MS = 10 * 60 * 1000; // 10 minutes
const MIN_RUNNING_IDLE_MS = 60 * 1000; // 1 minute
const MAX_RUNNING_IDLE_MS = 24 * 60 * 60 * 1000; // 24 hours

const runningIdleMs = Math.min(
  Math.max(
    readEnvInt("OPENCLAW_BASH_RUNNING_IDLE_MS") ?? DEFAULT_RUNNING_IDLE_MS,
    MIN_RUNNING_IDLE_MS,
  ),
  MAX_RUNNING_IDLE_MS,
);

/** Classifies one running session's idle state from its last activity time. */
export function classifyBashProcessIdle(input: {
  exited: boolean;
  /** Last output time when present; falls back to the session start time. */
  lastActivityAtMs: number;
  nowMs: number;
  idleMs?: number;
}): BashProcessIdleClassification {
  if (input.exited) {
    return "completed";
  }
  const idleMs = input.idleMs ?? runningIdleMs;
  return input.nowMs - input.lastActivityAtMs < idleMs ? "running-process" : "idle";
}

/** Classifies a registered session by id; null when the id is unknown. */
export function classifyBashProcessSession(id: string): {
  classification: BashProcessIdleClassification;
  sinceActivityMs: number;
} | null {
  const nowMs = Date.now();
  const running = runningSessions.get(id);
  if (running) {
    const lastActivityAtMs = running.lastOutputAt ?? running.startedAt;
    return {
      classification: classifyBashProcessIdle({
        exited: false,
        lastActivityAtMs,
        nowMs,
      }),
      sinceActivityMs: nowMs - lastActivityAtMs,
    };
  }
  const finished = finishedSessions.get(id);
  if (finished) {
    return { classification: "completed", sinceActivityMs: nowMs - finished.endedAt };
  }
  return null;
}

/** Clears retained finished sessions without touching running processes. */
export function clearFinished() {
  finishedSessions.clear();
}

/** Test-only reset for in-memory registry state and retention timers. */
export function resetProcessRegistryForTests() {
  runningSessions.clear();
  finishedSessions.clear();
  stopSweeper();
}

/** Overrides finished-session retention TTL, clamped to supported bounds. */
export function setJobTtlMs(value?: number) {
  if (value === undefined || Number.isNaN(value)) {
    return;
  }
  jobTtlMs = clampTtl(value);
  stopSweeper();
  startSweeper();
}

function pruneFinishedSessions() {
  const cutoff = Date.now() - jobTtlMs;
  for (const [id, session] of finishedSessions.entries()) {
    if (session.endedAt < cutoff) {
      finishedSessions.delete(id);
    }
  }
}

function stopSweeperWhenEmpty() {
  if (runningSessions.size === 0 && finishedSessions.size === 0) {
    stopSweeper();
  }
}

function startSweeper() {
  if (sweeper) {
    return;
  }
  sweeper = setInterval(pruneFinishedSessions, Math.max(30_000, jobTtlMs / 6));
  sweeper.unref?.();
}

function stopSweeper() {
  if (!sweeper) {
    return;
  }
  clearInterval(sweeper);
  sweeper = null;
}
