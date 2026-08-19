import type { BrowserWindow } from 'electron';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import * as pty from '@lydell/node-pty';
import { HOST_EVENT_CHANNELS } from '@shared/host-events/contract';
import type { WorkspaceProfile } from '@shared/types/workspace';
import { prependOfficeCliPathToEnv } from '../utils/officecli-path';
import { isPathInsideWorkspace } from './workspace-permissions';

export type TerminalSessionKind = 'interactive' | 'webPreviewDevServer';
export type TerminalSessionStatus = 'idle' | 'starting' | 'running' | 'exited' | 'blocked';
export type TerminalCloseReason = 'user-close' | 'session-end' | 'session-reset' | 'session-delete' | 'workspace-switch' | 'workspace-delete' | 'permission-change' | 'process-exit' | 'replaced' | 'app-shutdown';

type PtyProcess = ReturnType<typeof pty.spawn>;

type TerminalSessionRecord = {
  id: string;
  workspaceId: string;
  sessionKey: string;
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
};

type TerminalSessionSnapshot = {
  sessionId: string | null;
  workspaceId: string | null;
  sessionKey: string | null;
  kind?: TerminalSessionKind;
  cwd: string | null;
  pid: number | null;
  cols?: number;
  rows?: number;
  status: TerminalSessionStatus;
  exitCode: number | null;
  scrollback?: string;
};

type TerminalManagerContext = {
  mainWindow?: BrowserWindow | null;
  onData?: (event: { workspaceId: string; sessionKey: string; sessionId: string; kind: TerminalSessionKind; data: string; seq: number }) => void;
};

type OpenTerminalInput = {
  workspace: WorkspaceProfile;
  sessionKey?: string;
  cwd?: string;
  cols?: number;
  rows?: number;
  kind?: TerminalSessionKind;
  command?: string;
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

  constructor(ctx: TerminalManagerContext = {}) {
    this.mainWindow = ctx.mainWindow ?? null;
    this.onData = ctx.onData;
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
    if (existing?.status === 'running') return this.toSnapshot(existing, true);

    if (existing) this.closeSession(existing, 'replaced');

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
    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: buildEnvironment(),
    });
    const session: TerminalSessionRecord = {
      id,
      workspaceId: input.workspace.id,
      sessionKey,
      kind,
      cwd,
      ptyProcess,
      pid: ptyProcess.pid,
      cols,
      rows,
      status: 'running',
      exitCode: null,
      seq: 0,
      scrollback: '',
      closeReason: null,
    };

    this.sessions.set(id, session);
    this.activeByWorkspaceSession.set(activeKey, id);
    ptyProcess.onData((data) => this.handleData(session.id, data));
    ptyProcess.onExit((event) => this.handleExit(session.id, event.exitCode ?? null));
    this.emit(HOST_EVENT_CHANNELS.terminal.registered, this.toEvent(session));
    this.emit(HOST_EVENT_CHANNELS.terminal.statusChanged, this.toEvent(session));

    if (input.command?.trim()) {
      queueMicrotask(() => this.write({ sessionId: id, data: `${input.command}\r` }));
    }

    return this.toSnapshot(session, true);
  }

  write(input: { sessionId: string; data: string }): void {
    const session = this.requireRunningSession(input.sessionId);
    session.ptyProcess?.write(input.data);
  }

  resize(input: { sessionId: string; cols: number; rows: number }): TerminalSessionSnapshot {
    const session = this.requireSession(input.sessionId);
    session.cols = clampDimension(input.cols, session.cols);
    session.rows = clampDimension(input.rows, session.rows);
    if (session.status === 'running') {
      session.ptyProcess?.resize(session.cols, session.rows);
    }
    this.emit(HOST_EVENT_CHANNELS.terminal.statusChanged, this.toEvent(session));
    return this.toSnapshot(session, false);
  }

  interrupt(sessionId: string): void {
    const session = this.requireRunningSession(sessionId);
    session.ptyProcess?.write('\x03');
  }

  close(sessionId: string, reason: TerminalCloseReason = 'user-close'): TerminalSessionSnapshot {
    const session = this.sessions.get(sessionId);
    // R0-3: records are reclaimed on exit — closing an already-reclaimed (or
    // unknown) session is an idempotent no-op, mirroring status()'s idle
    // semantics, so a renderer "End" click after exit cannot throw.
    if (!session) return this.idleSnapshot();
    this.closeSession(session, reason);
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
      this.closeSession(session, 'app-shutdown');
    }
    this.sessions.clear();
    this.activeByWorkspaceSession.clear();
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

  private closeSession(session: TerminalSessionRecord, reason: TerminalCloseReason): void {
    session.closeReason = reason;
    if (session.status !== 'exited') {
      session.status = 'exited';
      this.emit(HOST_EVENT_CHANNELS.terminal.statusChanged, this.toEvent(session));
      this.emit(HOST_EVENT_CHANNELS.terminal.unregistered, this.toExitEvent(session, session.exitCode, reason));
    }
    if (session.ptyProcess) {
      const processRef = session.ptyProcess;
      session.ptyProcess = null;
      try {
        processRef.kill();
      } catch {
        // noop
      }
    }
    this.deleteActiveKey(session);
    // R0-3: reclaim the record — exited sessions must not accumulate in the
    // map for the lifetime of the app.
    this.sessions.delete(session.id);
  }

  private handleData(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== 'running') return;
    session.seq += 1;
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
    session.exitCode = exitCode;
    session.status = 'exited';
    session.ptyProcess = null;
    this.deleteActiveKey(session);
    const reason = session.closeReason ?? 'process-exit';
    this.emit(HOST_EVENT_CHANNELS.terminal.exit, this.toExitEvent(session, exitCode, reason));
    this.emit(HOST_EVENT_CHANNELS.terminal.statusChanged, this.toEvent(session));
    // R0-3: reclaim the record once the exit has been surfaced.
    this.sessions.delete(session.id);
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

  private requireRunningSession(sessionId: string): TerminalSessionRecord {
    const session = this.requireSession(sessionId);
    if (session.status !== 'running' || !session.ptyProcess) {
      throw new Error('Terminal session is not running');
    }
    return session;
  }

  private toEvent(session: TerminalSessionRecord) {
    return {
      workspaceId: session.workspaceId,
      sessionKey: session.sessionKey,
      kind: session.kind,
      sessionId: session.id,
      cwd: session.cwd,
      pid: session.pid,
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

  private toSnapshot(session: TerminalSessionRecord, includeScrollback: boolean): TerminalSessionSnapshot {
    return {
      sessionId: session.id,
      workspaceId: session.workspaceId,
      sessionKey: session.sessionKey,
      kind: session.kind,
      cwd: session.cwd,
      pid: session.pid,
      cols: session.cols,
      rows: session.rows,
      status: session.status,
      exitCode: session.exitCode,
      scrollback: includeScrollback ? session.scrollback : undefined,
    };
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
