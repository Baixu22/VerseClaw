import type { BrowserWindow } from 'electron';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Socket } from 'node:net';
import * as pty from '@lydell/node-pty';
import { HOST_EVENT_CHANNELS } from '@shared/host-events/contract';
import type { WorkspaceProfile } from '@shared/types/workspace';
import {
  LongSessionCoordinationError,
  decideLongSessionCoordination,
  resolveLongSessionCoordinationPolicy,
  type LongSessionCoordinationPolicy,
} from '@shared/long-session-resource-reclamation';
import { prependOfficeCliPathToEnv } from '../utils/officecli-path';
import { isPathInsideWorkspace } from './workspace-permissions';
import { admitManagedProcess, type ManagedProcessLease } from '../../openclaw_runtime/src/agents/verseshell/managed-process-capacity';
import { logger } from '../utils/logger';
import { assertManagedPortsBindable, normalizeManagedPorts } from '../../openclaw_runtime/src/agents/verseshell/managed-process-reservation';

export type TerminalSessionKind = 'interactive' | 'webPreviewDevServer';
type TerminalOwnerScope = { workspaceId?: string; sessionKey?: string; expectedSessionId?: string };
export type TerminalSessionStatus = 'idle' | 'starting' | 'running' | 'exited' | 'blocked';
export type TerminalCloseReason = 'user-close' | 'session-end' | 'session-reset' | 'session-delete' | 'workspace-switch' | 'workspace-delete' | 'permission-change' | 'process-exit' | 'replaced' | 'app-shutdown';

/**
 * TF-0081 idle classification. Reclamation is never automatic: `running-process`
 * (recent child output) and `interactive` (recent user input) are keep states,
 * `idle` is only a policy candidate, and exited records are `completed`.
 */
export type TerminalIdleClassification = 'running-process' | 'interactive' | 'idle' | 'completed';

export type TerminalIdlePolicy = {
  /** Fresh PTY output within this window marks a real running child process. */
  outputIdleMs: number;
  /** User input within this window marks an actively used interactive terminal. */
  interactionIdleMs: number;
};

export type TerminalIdleReport = {
  classification: TerminalIdleClassification;
  sinceOutputMs: number | null;
  sinceInteractionMs: number | null;
};

const DEFAULT_OUTPUT_IDLE_MS = 60_000;
const DEFAULT_INTERACTION_IDLE_MS = 30 * 60_000;
const MIN_IDLE_THRESHOLD_MS = 1_000;
const MAX_IDLE_THRESHOLD_MS = 24 * 60 * 60_000;

function resolveIdleThresholdMs(value: number | undefined, envKey: string, fallbackMs: number): number {
  const raw = value ?? (process.env[envKey] ? Number(process.env[envKey]) : undefined);
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return fallbackMs;
  return Math.max(MIN_IDLE_THRESHOLD_MS, Math.min(Math.floor(raw), MAX_IDLE_THRESHOLD_MS));
}

/** Classifies one terminal's idle state; output freshness always wins over wall clock. */
export function classifyTerminalIdle(input: {
  status: TerminalSessionStatus;
  lastOutputAtMs: number | null;
  lastInteractionAtMs: number | null;
  nowMs: number;
  policy: TerminalIdlePolicy;
}): TerminalIdleClassification {
  if (input.status !== 'running') return 'completed';
  // A child still producing output is never idle, regardless of user input.
  if (input.lastOutputAtMs !== null && input.nowMs - input.lastOutputAtMs < input.policy.outputIdleMs) {
    return 'running-process';
  }
  if (
    input.lastInteractionAtMs !== null &&
    input.nowMs - input.lastInteractionAtMs < input.policy.interactionIdleMs
  ) {
    return 'interactive';
  }
  return 'idle';
}

type PtyProcess = ReturnType<typeof pty.spawn>;

type TerminalSessionRecord = {
  capacityLease: ManagedProcessLease;
  reservedPorts: readonly number[];
  exitError: Error | null;
  id: string;
  workspaceId: string;
  sessionKey: string;
  expectedSessionId: string | null;
  kind: TerminalSessionKind;
  cwd: string;
  ptyProcess: PtyProcess | null;
  pid: number | null;
  cols: number;
  rows: number;
  status: TerminalSessionStatus;
  exitCode: number | null;
  seq: number;
  scrollback: string;
  closeReason: TerminalCloseReason | null;
  lastOutputAtMs: number | null;
  lastInteractionAtMs: number | null;
  /** Whether renderer teardown keeps this terminal alive; defaults to true. */
  keepOnLeave?: boolean;
  exited: Promise<void>;
  resolveExit: () => void;
};

type TerminalSessionSnapshot = {
  sessionId: string | null;
  workspaceId: string | null;
  sessionKey: string | null;
  expectedSessionId?: string | null;
  kind?: TerminalSessionKind;
  cwd: string | null;
  pid: number | null;
  cols?: number;
  rows?: number;
  status: TerminalSessionStatus;
  exitCode: number | null;
  scrollback?: string;
  idle?: TerminalIdleReport;
  /** True when renderer teardown or a workspace switch preserves this terminal. */
  keepOnLeave?: boolean;
};

type TerminalManagerContext = {
  mainWindow?: BrowserWindow | null;
  onData?: (event: { workspaceId: string; sessionKey: string; sessionId: string; kind: TerminalSessionKind; data: string; seq: number }) => void;
  idlePolicy?: Partial<TerminalIdlePolicy>;
  coordinationPolicy?: LongSessionCoordinationPolicy;
  now?: () => number;
};

type OpenTerminalInput = {
  reservedPorts?: readonly number[];
  workspace: WorkspaceProfile;
  sessionKey?: string;
  expectedSessionId?: string;
  cwd?: string;
  cols?: number;
  rows?: number;
  kind?: TerminalSessionKind;
  command?: string;
  /** Whether renderer teardown keeps this terminal alive; defaults to true. */
  keepOnLeave?: boolean;
};

const MAX_SCROLLBACK_CHARS = 120_000;
const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

function sessionKeyFor(workspaceId: string, sessionKey: string, kind: TerminalSessionKind): string {
  return `${workspaceId}:${sessionKey}:${kind}`;
}

function clampDimension(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(2, Math.min(Math.floor(value), 500));
}

function resolveShell(): string {
  if (process.platform === 'win32') return process.env.COMSPEC || 'cmd.exe';
  return process.env.SHELL || '/bin/bash';
}

function buildEnvironment(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') env[key] = value;
  }
  env.TERM = env.TERM || 'xterm-256color';
  env.COLORTERM = env.COLORTERM || 'truecolor';
  const patched = prependOfficeCliPathToEnv(env, { existsSync }).env;
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(patched)) {
    if (typeof value === 'string') result[key] = value;
  }
  return result;
}

function appendScrollback(current: string, chunk: string): string {
  const next = `${current}${chunk}`;
  if (next.length <= MAX_SCROLLBACK_CHARS) return next;
  return next.slice(next.length - MAX_SCROLLBACK_CHARS);
}

export class TerminalSessionManager {
  private readonly mainWindow: BrowserWindow | null;
  private readonly onData?: TerminalManagerContext['onData'];
  private readonly sessions = new Map<string, TerminalSessionRecord>();
  private readonly activeByWorkspaceSession = new Map<string, string>();
  private readonly registeredWorkspaces = new Set<string>();
  private readonly idlePolicy: TerminalIdlePolicy;
  private readonly now: () => number;
  private readonly coordinationPolicy: LongSessionCoordinationPolicy;

  constructor(ctx: TerminalManagerContext = {}) {
    this.mainWindow = ctx.mainWindow ?? null;
    this.onData = ctx.onData;
    this.idlePolicy = {
      outputIdleMs: resolveIdleThresholdMs(ctx.idlePolicy?.outputIdleMs, 'CLAWX_TERMINAL_OUTPUT_IDLE_MS', DEFAULT_OUTPUT_IDLE_MS),
      interactionIdleMs: resolveIdleThresholdMs(ctx.idlePolicy?.interactionIdleMs, 'CLAWX_TERMINAL_INTERACTION_IDLE_MS', DEFAULT_INTERACTION_IDLE_MS),
    };
    this.now = ctx.now ?? (() => Date.now());
    this.coordinationPolicy = ctx.coordinationPolicy ?? resolveLongSessionCoordinationPolicy();
  }

  registerWorkspace(workspace: WorkspaceProfile): void {
    this.registeredWorkspaces.add(workspace.id);
  }

  unregisterWorkspace(workspaceId: string, reason: TerminalCloseReason): void {
    this.registeredWorkspaces.delete(workspaceId);
    for (const session of Array.from(this.sessions.values())) {
      if (session.workspaceId === workspaceId) {
        this.closeSession(session, reason);
      }
    }
  }

  open(input: OpenTerminalInput): TerminalSessionSnapshot {
    const sessionKey = input.sessionKey || input.workspace.activeSessionKey;
    const kind = input.kind ?? 'interactive';
    const activeKey = sessionKeyFor(input.workspace.id, sessionKey, kind);
    const existingId = this.activeByWorkspaceSession.get(activeKey);
    const existing = existingId ? this.sessions.get(existingId) : null;
    if (existing?.status === 'running') {
      if (existing.expectedSessionId && !input.expectedSessionId) throw new Error('Terminal session generation is required for reuse');
      if (input.expectedSessionId && existing.expectedSessionId !== input.expectedSessionId) throw new Error('Terminal session generation changed');
      if (existing.closeReason) throw new Error('Terminal cleanup is still in progress');
      if (input.reservedPorts !== undefined && JSON.stringify(normalizeManagedPorts(input.reservedPorts)) !== JSON.stringify(existing.reservedPorts)) throw new Error('Terminal port reservation changed');
      return this.toSnapshot(existing, true);
    }

    if (existing) this.closeSession(existing, 'replaced');

    const budget = decideLongSessionCoordination({
      policy: this.coordinationPolicy,
      usage: {
        processCount: null,
        rssKb: null,
        backgroundTerminals: this.countForSession({ sessionKey, workspaceId: input.workspace.id }),
        worktreeCount: null,
      },
      request: { backgroundTerminals: 1 },
    });
    if (!budget.allowed) throw new LongSessionCoordinationError(budget);

    const cwd = resolve(input.cwd || input.workspace.rootPath);
    if (!isPathInsideWorkspace(cwd, input.workspace.rootPath)) {
      throw new Error('Terminal cwd must be inside the active workspace');
    }
    if (!existsSync(cwd)) {
      throw new Error('Terminal cwd does not exist');
    }

    const cols = clampDimension(input.cols, DEFAULT_COLS);
    const rows = clampDimension(input.rows, DEFAULT_ROWS);
    const shell = resolveShell();
    const id = randomUUID();
    const admitted = admitManagedProcess({ ports: input.reservedPorts, owner: `terminal:${input.workspace.id}:${sessionKey}` });
    if (!admitted.ok) throw new Error(`E_PROCESS_CAPACITY_LIMIT: live=${admitted.live} limit=${admitted.limit}`);
    const capacityLease = admitted.lease;
    try { capacityLease.markDispatched(); }
    catch (error) { capacityLease.release(); throw error; }
    let ptyProcess: PtyProcess;
    try { ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: buildEnvironment(),
    }); } catch (error) {
      // The synchronous native spawn contract did not return a handle. Keep
      // unknown delivery durable and expose the reservation in the failure.
      capacityLease.markUnknown('native-pty-start-did-not-return-owner-handle');
      throw new Error(`Terminal native start requires recovery (reservation=${capacityLease.reservationId ?? 'none'})`, { cause: error });
    }
    let resolveExit!: () => void;
    const exited = new Promise<void>(resolve => { resolveExit = resolve; });
    const session: TerminalSessionRecord = {
      capacityLease,
      reservedPorts: normalizeManagedPorts(input.reservedPorts),
      exitError: null,
      id,
      workspaceId: input.workspace.id,
      sessionKey,
      expectedSessionId: input.expectedSessionId?.trim() || null,
      kind,
      cwd,
      ptyProcess,
      pid: Number.isSafeInteger(ptyProcess.pid) && ptyProcess.pid > 0 ? ptyProcess.pid : null,
      cols,
      rows,
      status: 'running',
      exitCode: null,
      seq: 0,
      scrollback: '',
      closeReason: null,
      lastOutputAtMs: null,
      lastInteractionAtMs: this.now(),
      keepOnLeave: input.keepOnLeave !== false,
      exited,
      resolveExit,
    };

    this.sessions.set(id, session);
    this.activeByWorkspaceSession.set(activeKey, id);
    ptyProcess.onData((data) => this.handleData(session.id, data));
    ptyProcess.onExit((event) => this.handleExit(session.id, event.exitCode ?? null));
    if (ptyProcess.pid > 0) void capacityLease.observeProcess(ptyProcess.pid).catch(error => logger.warn(`Terminal process identity observation unavailable: ${String(error)}`));
    this.emit(HOST_EVENT_CHANNELS.terminal.registered, this.toEvent(session));
    this.emit(HOST_EVENT_CHANNELS.terminal.statusChanged, this.toEvent(session));

    if (input.command?.trim()) {
      queueMicrotask(() => this.write({ sessionId: id, data: `${input.command}\r` }));
    }

    return this.toSnapshot(session, true);
  }

  write(input: { sessionId: string; data: string; workspaceId?: string; sessionKey?: string; expectedSessionId?: string }): void {
    const session = this.requireRunningSession(input.sessionId);
    this.assertScope(session, input);
    session.lastInteractionAtMs = this.now();
    session.ptyProcess?.write(input.data);
  }

  resize(input: { sessionId: string; cols: number; rows: number } & TerminalOwnerScope): TerminalSessionSnapshot {
    const session = this.requireSession(input.sessionId);
    this.assertScope(session, input);
    session.cols = clampDimension(input.cols, session.cols);
    session.rows = clampDimension(input.rows, session.rows);
    if (session.status === 'running') {
      session.ptyProcess?.resize(session.cols, session.rows);
    }
    this.emit(HOST_EVENT_CHANNELS.terminal.statusChanged, this.toEvent(session));
    return this.toSnapshot(session, false);
  }

  interrupt(sessionId: string, scope: TerminalOwnerScope = {}): void {
    const session = this.requireRunningSession(sessionId);
    this.assertScope(session, scope);
    session.lastInteractionAtMs = this.now();
    session.ptyProcess?.write('\x03');
  }

  async close(sessionId: string, reason: TerminalCloseReason = 'user-close', scope: TerminalOwnerScope = {}): Promise<TerminalSessionSnapshot> {
    const session = this.sessions.get(sessionId);
    // R0-3: records are reclaimed on exit — closing an already-reclaimed (or
    // unknown) session is an idempotent no-op, mirroring status()'s idle
    // semantics, so a renderer "End" click after exit cannot throw.
    if (!session) return this.idleSnapshot();
    this.assertScope(session, scope);
    if (session.exitError && !session.ptyProcess) {
      await assertManagedPortsBindable(session.reservedPorts);
      session.exitError = null;
      this.finalizeExit(session, session.exitCode);
    }
    this.closeSession(session, reason);
    await session.exited;
    if (session.exitError) throw session.exitError;
    return this.toSnapshot(session, true);
  }

  status(input: { workspaceId?: string; sessionKey?: string; sessionId?: string; kind?: TerminalSessionKind }): TerminalSessionSnapshot {
    if (input.sessionId) {
      const session = this.sessions.get(input.sessionId);
      return session ? this.toSnapshot(session, true) : this.idleSnapshot();
    }
    if (input.workspaceId && input.sessionKey) {
      const id = this.activeByWorkspaceSession.get(sessionKeyFor(input.workspaceId, input.sessionKey, input.kind ?? 'interactive'));
      const session = id ? this.sessions.get(id) : null;
      return session ? this.toSnapshot(session, true) : this.idleSnapshot(input.workspaceId, input.sessionKey);
    }
    return this.idleSnapshot(input.workspaceId ?? null, input.sessionKey ?? null);
  }

  list(input: { workspaceId?: string; sessionKey?: string } = {}): TerminalSessionSnapshot[] {
    return Array.from(this.sessions.values())
      .filter((session) => session.status !== 'exited')
      .filter((session) => !input.workspaceId || session.workspaceId === input.workspaceId)
      .filter((session) => !input.sessionKey || session.sessionKey === input.sessionKey)
      .map((session) => this.toSnapshot(session, false));
  }

  /** Kill every live session and drop all bookkeeping (app quit path). */
  shutdownAll(): void {
    for (const session of Array.from(this.sessions.values())) {
      try { this.closeSession(session, 'app-shutdown'); } catch { /* Retain a failed native owner until its exit callback. */ }
    }
    this.registeredWorkspaces.clear();
  }

  stopForWorkspace(workspaceId: string, reason: TerminalCloseReason): void {
    this.unregisterWorkspace(workspaceId, reason);
  }

  /** Close every live terminal for a conversation/session key. */
  closeForSessionKey(sessionKey: string, reason: TerminalCloseReason = 'session-delete'): void {
    for (const session of Array.from(this.sessions.values())) {
      if (session.sessionKey === sessionKey) {
        this.closeSession(session, reason);
      }
    }
  }

  /**
   * E2: reclaim terminals for one session scope while honoring keep_on_leave.
   * Returns owner counts so the caller can build a receipt instead of assuming
   * that calling close means the owner released it.
   */
  async reclaimForSession(params: {
    sessionKey: string;
    reason: TerminalCloseReason;
    honorKeepOnLeave?: boolean;
    workspaceId?: string;
    expectedSessionId?: string | null;
  }): Promise<{ attempted: number; reclaimed: number; kept: number; failed?: number }> {
    let attempted = 0;
    let reclaimed = 0;
    let kept = 0;
    let failed = 0;
    for (const session of Array.from(this.sessions.values())) {
      if (session.sessionKey !== params.sessionKey) continue;
      if (params.workspaceId && session.workspaceId !== params.workspaceId) continue;
      if (params.expectedSessionId && session.expectedSessionId !== params.expectedSessionId) continue;
      attempted += 1;
      if (params.honorKeepOnLeave === true && session.keepOnLeave !== false) {
        kept += 1;
        continue;
      }
      try { await this.close(session.id, params.reason); reclaimed += 1; }
      catch { failed += 1; }
    }
    return { attempted, reclaimed, kept, ...(failed ? { failed } : {}) };
  }

  /** Count live terminals for a scope without mutating anything. */
  countForSession(params: { sessionKey: string; workspaceId?: string }): number {
    let count = 0;
    for (const session of this.sessions.values()) {
      if (session.sessionKey !== params.sessionKey) continue;
      if (params.workspaceId && session.workspaceId !== params.workspaceId) continue;
      count += 1;
    }
    return count;
  }

  /** keep_on_leave terminals for a scope, accounted separately and never killed. */
  countKeepOnLeave(params: { sessionKey: string; workspaceId?: string }): number {
    let count = 0;
    for (const session of this.sessions.values()) {
      if (session.sessionKey !== params.sessionKey) continue;
      if (params.workspaceId && session.workspaceId !== params.workspaceId) continue;
      if (session.keepOnLeave !== false) count += 1;
    }
    return count;
  }
  /** Read-model inventory for live terminals, derived from this owner only. */
  listAll(): Array<{ sessionId: string; workspaceId: string; sessionKey: string; expectedSessionId: string | null;
    pid: number | null; keepOnLeave: boolean; reservedPorts?: number[] }> {
    return Array.from(this.sessions.values())
      .filter((session) => session.status !== 'exited')
      .map((session) => ({
        sessionId: session.id,
        workspaceId: session.workspaceId,
        sessionKey: session.sessionKey,
        expectedSessionId: session.expectedSessionId,
        pid: this.readProcessId(session),
        keepOnLeave: session.keepOnLeave !== false,
        reservedPorts: [...session.reservedPorts],
      }));
  }

  /**
   * TF-0081 idle classification for one terminal. Returns null when the record
   * has already been reclaimed (exited terminals are removed, i.e. completed).
   */
  classifyTerminal(sessionId: string): TerminalIdleReport | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    return this.toIdleReport(session);
  }

  private closeSession(session: TerminalSessionRecord, reason: TerminalCloseReason): void {
    if (session.closeReason) return;
    const previousReason = session.closeReason;
    session.closeReason = reason;
    this.readProcessId(session);
    if (session.ptyProcess) {
      try { session.ptyProcess.kill(); }
      catch (error) {
        if (!this.sessions.has(session.id)) return;
        session.closeReason = previousReason;
        throw new Error('Terminal owner could not stop its process', { cause: error });
      }
      if (!this.sessions.has(session.id)) return;
    }
    // The native exit callback owns capacity release and terminal receipts.
  }

  private handleData(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== 'running') return;
    session.seq += 1;
    session.lastOutputAtMs = this.now();
    session.scrollback = appendScrollback(session.scrollback, data);
    this.emit(HOST_EVENT_CHANNELS.terminal.data, {
      ...this.toEvent(session),
      data,
      seq: session.seq,
    });
    this.onData?.({
      workspaceId: session.workspaceId,
      sessionKey: session.sessionKey,
      sessionId: session.id,
      kind: session.kind,
      data,
      seq: session.seq,
    });
  }

  private handleExit(sessionId: string, exitCode: number | null): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    // @lydell/node-pty 1.2.0-beta.12 closes ConPTY output on exit but retains
    // its input Socket on Windows. Release that owned pipe only after native
    // exit; killing alone must not discard a live terminal's input.
    if (process.platform === 'win32') {
      const input = (session.ptyProcess as (PtyProcess & { _agent?: { inSocket?: unknown } }) | null)?._agent?.inSocket;
      if (input instanceof Socket) input.destroy();
    }
    session.exitCode = exitCode;
    if (session.reservedPorts.length) {
      void assertManagedPortsBindable(session.reservedPorts).then(
        () => this.finalizeExit(session, exitCode),
        error => {
          session.status = 'blocked';
          session.ptyProcess = null;
          session.exitError = new Error('Terminal port release requires recovery', { cause: error });
          this.emit(HOST_EVENT_CHANNELS.terminal.statusChanged, this.toEvent(session));
          session.resolveExit();
        },
      );
      return;
    }
    this.finalizeExit(session, exitCode);
  }

  private finalizeExit(session: TerminalSessionRecord, exitCode: number | null): void {
    this.readProcessId(session);
    session.exitCode = exitCode;
    session.status = 'exited';
    try { session.capacityLease.markTerminal(); session.capacityLease.release(); }
    catch (error) {
      session.exitError = new Error('Terminal capacity release requires recovery', { cause: error });
      logger.warn(String(session.exitError));
      session.status = 'blocked';
      session.ptyProcess = null;
      this.emit(HOST_EVENT_CHANNELS.terminal.statusChanged, this.toEvent(session));
      session.resolveExit();
      return;
    }
    session.ptyProcess = null;
    this.deleteActiveKey(session);
    const reason = session.closeReason ?? 'process-exit';
    this.emit(HOST_EVENT_CHANNELS.terminal.exit, this.toExitEvent(session, exitCode, reason));
    this.emit(HOST_EVENT_CHANNELS.terminal.statusChanged, this.toEvent(session));
    if (session.closeReason) this.emit(HOST_EVENT_CHANNELS.terminal.unregistered, this.toExitEvent(session, exitCode, reason));
    // R0-3: reclaim the record once the exit has been surfaced.
    this.sessions.delete(session.id);
    session.resolveExit();
  }

  private deleteActiveKey(session: TerminalSessionRecord): void {
    const activeKey = sessionKeyFor(session.workspaceId, session.sessionKey, session.kind);
    if (this.activeByWorkspaceSession.get(activeKey) === session.id) {
      this.activeByWorkspaceSession.delete(activeKey);
    }
  }

  private requireSession(sessionId: string): TerminalSessionRecord {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Terminal session not found');
    return session;
  }

  private assertScope(session: TerminalSessionRecord, scope: { workspaceId?: string; sessionKey?: string; expectedSessionId?: string }): void {
    if ((scope.workspaceId !== undefined && scope.workspaceId !== session.workspaceId)
      || (scope.sessionKey !== undefined && scope.sessionKey !== session.sessionKey)
      || (scope.expectedSessionId !== undefined && scope.expectedSessionId !== session.expectedSessionId)) {
      throw new Error('Terminal owner scope mismatch');
    }
  }

  private requireRunningSession(sessionId: string): TerminalSessionRecord {
    const session = this.requireSession(sessionId);
    if (session.status !== 'running' || !session.ptyProcess || session.closeReason) {
      throw new Error('Terminal session is not running');
    }
    return session;
  }

  private toEvent(session: TerminalSessionRecord) {
    return {
      workspaceId: session.workspaceId,
      sessionKey: session.sessionKey,
      expectedSessionId: session.expectedSessionId,
      kind: session.kind,
      sessionId: session.id,
      cwd: session.cwd,
      pid: this.readProcessId(session),
      cols: session.cols,
      rows: session.rows,
      seq: session.seq,
      ts: Date.now(),
      status: session.status,
    };
  }

  private toExitEvent(session: TerminalSessionRecord, exitCode: number | null, reason: TerminalCloseReason) {
    return {
      ...this.toEvent(session),
      exitCode,
      reason,
    };
  }

  private toIdleReport(session: TerminalSessionRecord): TerminalIdleReport {
    const nowMs = this.now();
    return {
      classification: classifyTerminalIdle({
        status: session.status,
        lastOutputAtMs: session.lastOutputAtMs,
        lastInteractionAtMs: session.lastInteractionAtMs,
        nowMs,
        policy: this.idlePolicy,
      }),
      sinceOutputMs: session.lastOutputAtMs === null ? null : nowMs - session.lastOutputAtMs,
      sinceInteractionMs: session.lastInteractionAtMs === null ? null : nowMs - session.lastInteractionAtMs,
    };
  }

  private toSnapshot(session: TerminalSessionRecord, includeScrollback: boolean): TerminalSessionSnapshot {
    return {
      sessionId: session.id,
      workspaceId: session.workspaceId,
      sessionKey: session.sessionKey,
      expectedSessionId: session.expectedSessionId,
      kind: session.kind,
      cwd: session.cwd,
      pid: this.readProcessId(session),
      cols: session.cols,
      rows: session.rows,
      status: session.status,
      exitCode: session.exitCode,
      scrollback: includeScrollback ? session.scrollback : undefined,
      idle: this.toIdleReport(session),
      keepOnLeave: session.keepOnLeave !== false,
    };
  }

  private readProcessId(session: TerminalSessionRecord): number | null {
    const pid = session.ptyProcess?.pid;
    if (typeof pid === 'number' && Number.isSafeInteger(pid) && pid > 0 && session.pid !== pid) {
      session.pid = pid;
      void session.capacityLease.observeProcess(pid).catch(error => logger.warn(`Terminal process identity observation unavailable: ${String(error)}`));
    }
    return session.pid;
  }

  private idleSnapshot(workspaceId: string | null = null, sessionKey: string | null = null): TerminalSessionSnapshot {
    return {
      sessionId: null,
      workspaceId,
      sessionKey,
      kind: undefined,
      cwd: null,
      pid: null,
      status: 'idle',
      exitCode: null,
      scrollback: '',
    };
  }

  private emit(channel: string, payload: unknown): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
    this.mainWindow.webContents.send(channel, payload);
  }
}

export function createTerminalSessionManager(ctx: TerminalManagerContext = {}): TerminalSessionManager {
  return new TerminalSessionManager(ctx);
}
