import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import type { WorkspaceProfile } from '@shared/types/workspace';
import type { TerminalSessionManager } from '@electron/services/terminal-session-manager';
import type { CompleteHostServiceRegistry } from '@electron/main/ipc/host-contract';

const owners = vi.hoisted(() => ({
  browserList: vi.fn(() => [] as Array<{ id: string; workspaceId: string; sessionKey: string }>),
  browserClose: vi.fn(), serverList: vi.fn(() => ({ resources: [] as Array<{ id: string; workspaceId: string; sessionKey: string; ownership: string; pid: number }> })),
  serverStop: vi.fn(async () => ({ success: true })),
  permission: vi.fn(async (_input: unknown) => null as null | { success: boolean; blocked: boolean; reason: string }),
  configRoot: '',
}));
vi.mock('electron', () => ({ app: { getAppMetrics: () => [{ memory: { workingSetSize: 1024 } }] }, shell: {} }));
vi.mock('@electron/utils/paths', () => ({ getOpenClawConfigDir: () => owners.configRoot }));
vi.mock('@electron/services/agent-browser-api', () => ({ getDefaultAgentBrowserService: () => ({ list: owners.browserList, close: owners.browserClose }) }));
vi.mock('@electron/services/resource-tracker', () => ({ getResourceTracker: () => ({ list: owners.serverList, stopResource: owners.serverStop }) }));
vi.mock('@electron/services/git-api', async () => {
  // Real Git runs against disposable repositories; permission decisions are isolated.
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const run = promisify(execFile);
  return {
    enforcePermission: owners.permission,
    git: async (args: string[], cwd: string) => {
      try { const result = await run('git', args, { cwd, windowsHide: true }); return { exitCode: 0, ...result }; }
      catch (error) { return { exitCode: 1, stdout: '', stderr: String(error) }; }
    },
    parseWorktrees: (output: string) => output.split('\0\0').filter(Boolean).map((block) => {
      const fields = Object.fromEntries(block.split('\0').filter(Boolean).map((line) => { const i = line.indexOf(' '); return i < 0 ? [line, true] : [line.slice(0, i), line.slice(i + 1)]; }));
      return { path: fields.worktree, branch: typeof fields.branch === 'string' ? fields.branch.replace('refs/heads/', '') : undefined, locked: fields.locked !== undefined, bare: fields.bare === true };
    }),
  };
});

import { createSessionStorageApi, measureStorage } from '@electron/services/session-storage-api';

describe('session storage with real Git and files', () => {
  let root: string;
  let primary: string;
  let clean: string;
  let dirty: string;
  let locked: string;
  let profiles: WorkspaceProfile[];
  const terminals = vi.fn(() => [] as Array<{ sessionId: string; workspaceId: string; sessionKey: string; pid: null }>);
  const close = vi.fn();
  const command = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, windowsHide: true, encoding: 'utf8' }).trim();
  const profile = (id: string, path: string): WorkspaceProfile => ({ id, name: id, rootPath: path, permissionMode: 'acceptEdits', agentId: 'main', activeSessionKey: `agent:main:${id}`, state: {}, createdAt: 1, updatedAt: 1, lastOpenedAt: 1 });
  const api = () => createSessionStorageApi({
    workspaces: { list: async () => ({ success: true, activeWorkspaceId: 'project', activeWorkspace: profiles[0], profiles }) } as CompleteHostServiceRegistry['workspaces'],
    terminalManager: { list: (scope: { workspaceId: string; sessionKey?: string }) => terminals().filter((row) => row.workspaceId === scope.workspaceId && (!scope.sessionKey || row.sessionKey === scope.sessionKey)), close } as unknown as TerminalSessionManager,
  });
  beforeEach(async () => {
    vi.clearAllMocks(); terminals.mockReturnValue([]); owners.browserList.mockReturnValue([]); owners.serverList.mockReturnValue({ resources: [] }); owners.permission.mockResolvedValue(null);
    root = await mkdtemp(join(tmpdir(), 'session-storage-'));
    owners.configRoot = join(root, 'config'); primary = join(root, 'project'); clean = join(root, 'clean'); dirty = join(root, 'dirty'); locked = join(root, 'locked');
    await mkdir(primary);
    command(primary, 'init', '-b', 'main'); command(primary, 'config', 'user.name', 'Storage Test'); command(primary, 'config', 'user.email', 'test@example.invalid');
    await writeFile(join(primary, 'file.txt'), 'committed content'); command(primary, 'add', '.'); command(primary, 'commit', '-m', 'fixture');
    command(primary, 'worktree', 'add', '-b', 'clean', clean); command(primary, 'worktree', 'add', '-b', 'dirty', dirty); command(primary, 'worktree', 'add', '-b', 'locked', locked);
    await writeFile(join(dirty, 'unsaved.txt'), 'keep me'); command(primary, 'worktree', 'lock', locked);
    profiles = [profile('project', primary)];
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('measures files, marks bounded scans and never follows junctions', async () => {
    const directory = join(root, 'measure'); await mkdir(directory); await writeFile(join(directory, 'one'), '12345');
    const outside = join(root, 'outside'); await mkdir(outside); await writeFile(join(outside, 'secret'), 'do not count');
    await symlink(outside, join(directory, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
    expect(await measureStorage(directory)).toEqual({ bytes: 5, partial: false });
    expect((await measureStorage(directory, 1)).partial).toBe(true);
  });
  it('reports real worktrees and protects primary, dirty, locked and registered checkouts', async () => {
    profiles.push(profile('linked', clean));
    const result = await api().snapshot();
    expect(result.applicationMemoryBytes).toBe(1024 * 1024);
    const protections = Object.fromEntries(result.worktrees.map((tree) => [tree.branch, tree.protection]));
    expect(protections).toEqual({ main: 'primary', clean: 'sessions', dirty: 'dirty', locked: 'locked' });
    expect(result.worktrees.every((tree) => tree.disk.bytes > 0)).toBe(true);
    const blocked = await api().removeWorktree({ workspaceId: 'project', path: clean });
    expect(blocked.success).toBe(false); expect(owners.permission).not.toHaveBeenCalled();
  });
  it('retains the branch after approved idle removal and rejects stale cleanup of new changes', async () => {
    const service = api();
    await service.snapshot();
    await writeFile(join(clean, 'late.txt'), 'save');
    expect((await service.removeWorktree({ workspaceId: 'project', path: clean })).success).toBe(false);
    await rm(join(clean, 'late.txt'));
    owners.permission.mockResolvedValueOnce({ success: false, blocked: true, reason: 'approval required' });
    expect((await service.removeWorktree({ workspaceId: 'project', path: clean })).success).toBe(false);
    expect((await service.removeWorktree({ workspaceId: 'project', path: clean, approvalId: 'approved' })).success).toBe(true);
    expect(command(primary, 'branch', '--list', 'clean')).toContain('clean');
    expect(await readFile(join(dirty, 'unsaved.txt'), 'utf8')).toBe('keep me');
    await expect(service.removeWorktree({ workspaceId: 'project', path: root })).rejects.toThrow('not registered');
  });
  it('sizes session transcripts and releases only the exact workspace/session owners', async () => {
    const sessionKey = 'agent:main:project';
    const dir = join(owners.configRoot, 'agents', 'main', 'sessions'); await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'sessions.json'), JSON.stringify({ [sessionKey]: { sessionId: 'test', label: 'My conversation' } }));
    await writeFile(join(dir, 'test.jsonl'), '123456789');
    owners.browserList.mockReturnValue([{ id: 'owned', workspaceId: 'project', sessionKey }, { id: 'other', workspaceId: 'foreign', sessionKey }]);
    owners.serverList.mockReturnValue({ resources: [{ id: 'observed', workspaceId: 'project', sessionKey, ownership: 'observed', pid: 1 }] });
    terminals.mockReturnValue([{ sessionId: 'terminal', workspaceId: 'project', sessionKey, pid: null }, { sessionId: 'foreign', workspaceId: 'foreign', sessionKey, pid: null }]);
    const snapshot = await api().snapshot(); expect(snapshot.sessions[0].disk.bytes).toBe(9); expect(snapshot.sessions[0].label).toBe('My conversation');
    expect(snapshot.sessions[0].memoryBytes).toBeNull();
    const result = await api().release({ workspaceId: 'project', sessionKey }); expect(result).toEqual({ success: true, released: 2, failed: 0 });
    expect(close).toHaveBeenCalledExactlyOnceWith('terminal', 'user-close'); expect(owners.browserClose).toHaveBeenCalledExactlyOnceWith('owned'); expect(owners.serverStop).not.toHaveBeenCalled();
    await expect(api().release({ workspaceId: 'project', sessionKey: 'agent:main:other' })).rejects.toThrow('Unknown');
  });
});
