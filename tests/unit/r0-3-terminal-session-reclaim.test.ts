// @vitest-environment node
// R0-3: terminal session records must be reclaimed on close/exit and by
// shutdownAll() — the sessions map must not grow for the app lifetime.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WorkspaceProfile } from '@shared/types/workspace';

const ptyMocks = vi.hoisted(() => ({
  spawn: vi.fn(),
}));

vi.mock('@lydell/node-pty', () => ({
  spawn: ptyMocks.spawn,
}));

let tempDir: string | null = null;

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
});

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

type SessionMapProbe = { sessions: Map<string, unknown> };

describe('R0-3 terminal session reclamation', () => {
  it('does not accumulate closed sessions in the map', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawx-r0-3-terminal-'));
    const { TerminalSessionManager } = await import('@electron/services/terminal-session-manager');
    const manager = new TerminalSessionManager();
    const ws = workspace(tempDir);

    for (let index = 0; index < 3; index += 1) {
      const snapshot = manager.open({ workspace: ws, sessionKey: 'agent:main:session-' + index });
      manager.close(snapshot.sessionId as string, 'user-close');
    }

    const probe = manager as unknown as SessionMapProbe;
    expect(probe.sessions.size).toBe(0);
    expect(manager.list().length).toBe(0);
  });

  it('reclaims records on process exit and hides exited sessions from list()', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawx-r0-3-terminal-'));
    const { TerminalSessionManager } = await import('@electron/services/terminal-session-manager');
    const manager = new TerminalSessionManager();
    const ws = workspace(tempDir);

    const first = manager.open({ workspace: ws, sessionKey: 'agent:main:first' });
    const second = manager.open({ workspace: ws, sessionKey: 'agent:main:second' });
    expect(manager.list().length).toBe(2);

    // Simulate the pty process exiting on its own: invoke the callback the
    // manager registered through ptyProcess.onExit(...).
    const firstSpawn = ptyMocks.spawn.mock.results[0]?.value as {
      onExit: { mock: { calls: Array<[{ exitCode: number }]> } };
    } | undefined;
    const registeredOnExit = firstSpawn?.onExit?.mock?.calls?.[0]?.[0];
    registeredOnExit?.({ exitCode: 0 });

    expect(manager.list().length).toBe(1);
    expect(manager.list()[0]?.sessionId).toBe(second.sessionId);
    expect(manager.status({ sessionId: first.sessionId as string }).status).toBe('idle');
    const probe = manager as unknown as SessionMapProbe;
    expect(probe.sessions.size).toBe(1);
  });

  it('close on an already-reclaimed session is an idempotent no-op', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawx-r0-3-terminal-'));
    const { TerminalSessionManager } = await import('@electron/services/terminal-session-manager');
    const manager = new TerminalSessionManager();
    const ws = workspace(tempDir);

    const snapshot = manager.open({ workspace: ws, sessionKey: 'agent:main:one' });
    const spawnValue = ptyMocks.spawn.mock.results[0]?.value as {
      onExit: { mock: { calls: Array<[{ exitCode: number }]> } };
    } | undefined;
    spawnValue?.onExit?.mock?.calls?.[0]?.[0]?.({ exitCode: 0 });

    const closed = manager.close(snapshot.sessionId as string, 'user-close');
    expect(closed.status).toBe('idle');
    expect(closed.sessionId).toBeNull();
  });

  it('shutdownAll kills every live session and empties all bookkeeping', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawx-r0-3-terminal-'));
    const { TerminalSessionManager } = await import('@electron/services/terminal-session-manager');
    const manager = new TerminalSessionManager();
    const ws = workspace(tempDir);

    manager.open({ workspace: ws, sessionKey: 'agent:main:a' });
    manager.open({ workspace: ws, sessionKey: 'agent:main:b' });
    manager.open({ workspace: ws, sessionKey: 'agent:main:c' });
    manager.shutdownAll();

    expect(manager.list().length).toBe(0);
    const probe = manager as unknown as SessionMapProbe;
    expect(probe.sessions.size).toBe(0);
    // mockReturnValue reuses one shared object across all spawn calls, so
    // the pty mock exposes a single shared kill vi.fn for the three sessions.
    const killMock = ptyMocks.spawn.mock.results[0]?.value as { kill: { mock: { calls: unknown[] } } } | undefined;
    expect(killMock?.kill?.mock?.calls?.length).toBe(3);
  });
});
