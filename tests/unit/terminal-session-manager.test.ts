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
  ptyMocks.spawn.mockReturnValue({
    pid: 1234,
    onData: vi.fn(),
    onExit: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
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

    manager.close(opened.sessionId ?? '');
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
