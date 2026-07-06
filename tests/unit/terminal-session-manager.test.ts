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
