import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WorkspaceProfile } from '@shared/types/workspace';

const ptyMocks = vi.hoisted(() => ({
  spawn: vi.fn(),
}));

vi.mock('@lydell/node-pty', () => ({
  spawn: ptyMocks.spawn,
}));

const originalPlatform = process.platform;
const originalEnv = { ...process.env };
let tempDir: string | null = null;

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

function workspace(rootPath: string): WorkspaceProfile {
  return {
    id: 'workspace-1',
    name: 'Workspace',
    rootPath,
    agentId: 'main',
    activeSessionKey: 'agent:main:main',
    permissionMode: 'fullAccess',
    createdAt: 1,
    updatedAt: 1,
    lastOpenedAt: 1,
    state: {},
  };
}

beforeEach(() => {
  vi.resetModules();
  ptyMocks.spawn.mockReset();
  ptyMocks.spawn.mockImplementation(() => {
    let exit!: (event: { exitCode: number }) => void;
    return {
    pid: 1234,
    onData: vi.fn(),
    onExit: vi.fn(listener => { exit = listener; }),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(() => exit({ exitCode: 0 })),
    };
  });
  process.env = { ...originalEnv };
});

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  process.env = { ...originalEnv };
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

describe('TerminalSessionManager', () => {
  it('holds a terminal close receipt until the native owner reports exit', async () => {
    let exit!: (event: { exitCode: number }) => void;
    const native = { pid: 1234, onData: vi.fn(), onExit: vi.fn(listener => { exit = listener; }), write: vi.fn(), resize: vi.fn(), kill: vi.fn() };
    ptyMocks.spawn.mockReturnValue(native);
    const { TerminalSessionManager } = await import('@electron/services/terminal-session-manager');
    const manager = new TerminalSessionManager();
    const opened = manager.open({ workspace: workspace(process.cwd()) });
    let settled = false;
    const closing = Promise.resolve(manager.close(opened.sessionId!)).then(receipt => { settled = true; return receipt; });
    try {
      await Promise.resolve();
      expect(settled).toBe(false);
      expect(manager.listAll()).toHaveLength(1);
      expect(manager.status({ sessionId: opened.sessionId! }).status).toBe('running');
    } finally { exit({ exitCode: 0 }); await closing; }
    expect(manager.listAll()).toHaveLength(0);
  });

  it('retains terminal occupancy when the native owner rejects termination', async () => {
    const native = { pid: 1234, onData: vi.fn(), onExit: vi.fn(), write: vi.fn(), resize: vi.fn(), kill: vi.fn(() => { throw new Error('native termination failed'); }) };
    ptyMocks.spawn.mockReturnValue(native);
    const { TerminalSessionManager } = await import('@electron/services/terminal-session-manager');
    const manager = new TerminalSessionManager();
    const opened = manager.open({ workspace: workspace(process.cwd()) });
    await expect(manager.close(opened.sessionId!)).rejects.toThrow(/stop|termination/);
    expect(manager.status({ sessionId: opened.sessionId! })).toMatchObject({ status: 'running', pid: 1234 });
    expect(manager.listAll()).toHaveLength(1);
    expect(await manager.reclaimForSession({ sessionKey: 'agent:main:main', reason: 'session-delete' }))
      .toMatchObject({ attempted: 1, reclaimed: 0, failed: 1 });
  });

  it('reads a PID that becomes available after the native PTY connection starts', async () => {
    const native = { pid: 0, onData: vi.fn(), onExit: vi.fn(), write: vi.fn(), resize: vi.fn(), kill: vi.fn() };
    ptyMocks.spawn.mockReturnValue(native);
    const { TerminalSessionManager } = await import('@electron/services/terminal-session-manager');
    const manager = new TerminalSessionManager();
    const opened = manager.open({ workspace: workspace(process.cwd()) });
    expect(opened.pid).toBeNull();
    native.pid = 1234;
    expect(manager.status({ sessionId: opened.sessionId! }).pid).toBe(1234);
    expect(manager.listAll()[0].pid).toBe(1234);
  });

  it('adds a managed OfficeCLI install dir to interactive terminal PATH', async () => {
    setPlatform('win32');
    tempDir = mkdtempSync(join(tmpdir(), 'clawx-officecli-'));
    const officeDir = join(tempDir, 'OfficeCLI');
    mkdirSync(officeDir, { recursive: true });
    writeFileSync(join(officeDir, 'officecli.exe'), '');
    process.env = {
      ...process.env,
      COMSPEC: 'cmd.exe',
      Path: 'C:\\Windows\\System32',
      LOCALAPPDATA: tempDir,
    };

    const { TerminalSessionManager } = await import('@electron/services/terminal-session-manager');
    const manager = new TerminalSessionManager();

    manager.open({ workspace: workspace(process.cwd()) });

    expect(ptyMocks.spawn).toHaveBeenCalledTimes(1);
    const options = ptyMocks.spawn.mock.calls[0]?.[2] as { env?: Record<string, string> } | undefined;
    expect(options?.env?.Path).toBe(`${officeDir};C:\\Windows\\System32`);
    expect(options?.env?.PATH).toBeUndefined();
  });
});

describe('TerminalSessionManager idle classification', () => {
  const policy = { outputIdleMs: 5_000, interactionIdleMs: 10_000 };

  function latestPty() {
    const instance = ptyMocks.spawn.mock.results.at(-1)?.value as
      | { onData: ReturnType<typeof vi.fn>; onExit: ReturnType<typeof vi.fn>; write: ReturnType<typeof vi.fn> }
      | undefined;
    if (!instance) throw new Error('pty not spawned');
    return instance;
  }

  it('classifies pure states including output freshness winning over interaction staleness', async () => {
    const { classifyTerminalIdle } = await import('@electron/services/terminal-session-manager');
    expect(classifyTerminalIdle({ status: 'exited', lastOutputAtMs: null, lastInteractionAtMs: null, nowMs: 0, policy })).toBe('completed');
    // Stale interaction but fresh child output: still a running process.
    expect(classifyTerminalIdle({ status: 'running', lastOutputAtMs: 96_000, lastInteractionAtMs: 0, nowMs: 100_000, policy })).toBe('running-process');
    expect(classifyTerminalIdle({ status: 'running', lastOutputAtMs: 90_000, lastInteractionAtMs: 95_000, nowMs: 100_000, policy })).toBe('interactive');
    expect(classifyTerminalIdle({ status: 'running', lastOutputAtMs: 0, lastInteractionAtMs: 0, nowMs: 100_000, policy })).toBe('idle');
  });

  it('transitions interactive -> running-process -> interactive -> idle with real event flow', async () => {
    let nowMs = 0;
    const { TerminalSessionManager } = await import('@electron/services/terminal-session-manager');
    const manager = new TerminalSessionManager({ idlePolicy: policy, now: () => nowMs });
    const opened = manager.open({ workspace: workspace(process.cwd()) });
    expect(opened.idle?.classification).toBe('interactive');

    nowMs = 1_000;
    const emitData = latestPty().onData.mock.calls[0]?.[0] as (data: string) => void;
    emitData('build output');
    expect(manager.status({ sessionId: opened.sessionId ?? '' }).idle?.classification).toBe('running-process');

    nowMs = 7_000; // output 6s stale, interaction 7s fresh
    expect(manager.classifyTerminal(opened.sessionId ?? '')?.classification).toBe('interactive');

    nowMs = 12_000; // output 11s stale, interaction 12s stale
    expect(manager.classifyTerminal(opened.sessionId ?? '')?.classification).toBe('idle');

    nowMs = 12_500;
    manager.write({ sessionId: opened.sessionId ?? '', data: 'ls\r' });
    nowMs = 13_000;
    expect(manager.classifyTerminal(opened.sessionId ?? '')?.classification).toBe('interactive');

    await manager.close(opened.sessionId ?? '');
    expect(manager.classifyTerminal(opened.sessionId ?? '')).toBeNull();
  });

  it('honors the CLAWX_TERMINAL_OUTPUT_IDLE_MS environment override', async () => {
    process.env = { ...process.env, CLAWX_TERMINAL_OUTPUT_IDLE_MS: '2000' };
    let nowMs = 0;
    const { TerminalSessionManager } = await import('@electron/services/terminal-session-manager');
    const manager = new TerminalSessionManager({ now: () => nowMs });
    const opened = manager.open({ workspace: workspace(process.cwd()) });
    const sessionId = opened.sessionId ?? '';

    nowMs = 1_000;
    (latestPty().onData.mock.calls[0]?.[0] as (data: string) => void)('tick');
    nowMs = 3_500; // output 2.5s stale > 2s override, interaction fresh
    expect(manager.classifyTerminal(sessionId)?.classification).toBe('interactive');
  });
});
describe('TerminalSessionManager long-session lifecycle', () => {
  const openPolicy = {
    maxProcesses: null,
    maxRssMb: null,
    maxBackgroundTerminals: null,
    maxWorktrees: null,
    idleTtlMs: 0,
    keepOnLeave: true,
  } as const;

  it('defaults keep_on_leave to true and preserves the physical generation', async () => {
    const { TerminalSessionManager } = await import('@electron/services/terminal-session-manager');
    const manager = new TerminalSessionManager();
    const opened = manager.open({
      workspace: workspace(process.cwd()),
      sessionKey: 'agent:main:long',
      expectedSessionId: 'session-generation-1',
    });
    expect(opened.keepOnLeave).toBe(true);
    expect(opened.expectedSessionId).toBe('session-generation-1');
    expect(manager.countKeepOnLeave({ sessionKey: 'agent:main:long', workspaceId: 'workspace-1' })).toBe(1);
  });

  it('rejects a terminal before spawn when the explicit background terminal budget is full', async () => {
    const { TerminalSessionManager } = await import('@electron/services/terminal-session-manager');
    const manager = new TerminalSessionManager({
      coordinationPolicy: { ...openPolicy, maxBackgroundTerminals: 1 },
    });
    manager.open({ workspace: workspace(process.cwd()), sessionKey: 'agent:main:first', kind: 'interactive' });
    expect(() => manager.open({
      workspace: workspace(process.cwd()),
      sessionKey: 'agent:main:first',
      kind: 'webPreviewDevServer',
    })).toThrow(/maxBackgroundTerminals:limit-exceeded/);
    expect(ptyMocks.spawn).toHaveBeenCalledTimes(1);
  });

it('runs 50 archive/delete cycles without terminal residue', { timeout: 20_000 }, async () => {
    const { TerminalSessionManager } = await import('@electron/services/terminal-session-manager');
    const manager = new TerminalSessionManager();
    let archivedKeepOnLeave = 0;
    for (let cycle = 1; cycle <= 50; cycle += 1) {
      manager.open({
        workspace: workspace(process.cwd()),
        sessionKey: `agent:main:cycle-${cycle}`,
        expectedSessionId: `generation-${cycle}`,
        keepOnLeave: true,
        kind: 'interactive',
      });
      manager.open({
        workspace: workspace(process.cwd()),
        sessionKey: `agent:main:cycle-${cycle}`,
        expectedSessionId: `generation-${cycle}`,
        keepOnLeave: false,
        kind: 'webPreviewDevServer',
      });
      const archived = await manager.reclaimForSession({
        sessionKey: `agent:main:cycle-${cycle}`,
        expectedSessionId: `generation-${cycle}`,
        honorKeepOnLeave: true,
        reason: 'session-reset',
      });
      archivedKeepOnLeave += archived.kept;
      expect(manager.listAll().filter((terminal) => terminal.sessionKey === `agent:main:cycle-${cycle}`)).toHaveLength(1);
      const deleted = await manager.reclaimForSession({
        sessionKey: `agent:main:cycle-${cycle}`,
        expectedSessionId: `generation-${cycle}`,
        honorKeepOnLeave: false,
        reason: 'session-delete',
      });
      expect(deleted).toEqual({ attempted: 1, reclaimed: 1, kept: 0 });
    }
    console.log(`[terminal-reclamation-audit] cycles=50 archivedKeepOnLeave=${archivedKeepOnLeave} activeResidual=${manager.listAll().length}`);
    expect(archivedKeepOnLeave).toBe(50);
    expect(manager.listAll()).toHaveLength(0);
  });

  it('reclaims only terminals bound to the requested generation', async () => {
    const { TerminalSessionManager } = await import('@electron/services/terminal-session-manager');
    const manager = new TerminalSessionManager();
    manager.open({
      workspace: workspace(process.cwd()),
      sessionKey: 'agent:main:long',
      expectedSessionId: 'generation-old',
      kind: 'interactive',
    });
    manager.open({
      workspace: workspace(process.cwd()),
      sessionKey: 'agent:main:long',
      expectedSessionId: 'generation-new',
      kind: 'webPreviewDevServer',
    });
    const result = await manager.reclaimForSession({
      sessionKey: 'agent:main:long',
      workspaceId: 'workspace-1',
      expectedSessionId: 'generation-old',
      honorKeepOnLeave: false,
      reason: 'session-delete',
    });
    expect(result).toEqual({ attempted: 1, reclaimed: 1, kept: 0 });
    expect(manager.listAll().map((terminal) => terminal.expectedSessionId)).toEqual(['generation-new']);
  });
});
