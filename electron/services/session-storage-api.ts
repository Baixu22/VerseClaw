import { app } from 'electron';
import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import type { WorkspaceProfile } from '@shared/types/workspace';
import type { SessionStorageEntry, StorageSize, StorageWorktree } from '@shared/types/session-storage';
import { getOpenClawConfigDir } from '../utils/paths';
import { resolveSessionTranscriptPath } from '../utils/session-files';
import { getDefaultAgentBrowserService } from './agent-browser-api';
import { getResourceTracker } from './resource-tracker';
import { enforcePermission, git, parseWorktrees } from './git-api';
import type { TerminalSessionManager } from './terminal-session-manager';
import { readProcessTreeSample } from '../../openclaw_runtime/src/process/process-tree-sampler';
import { inspectUiWorktreeRemoval } from './task-system-service';

function pathKey(path: string): string {
  const key = resolve(path);
  return process.platform === 'win32' ? key.toLowerCase() : key;
}

/** Bound both I/O and latency. Symlinks/junctions and shared Git objects are excluded. */
export async function measureStorage(root: string, limit = 20_000, deadline = Date.now() + 2000): Promise<StorageSize> {
  const result = { bytes: 0, partial: false };
  const pending = [root];
  let visited = 0;
  while (pending.length) {
    if (++visited > limit || Date.now() > deadline) { result.partial = true; break; }
    const path = pending.pop()!;
    try {
      const info = await lstat(path);
      if (info.isSymbolicLink()) continue;
      if (info.isFile()) result.bytes += info.size;
      else if (info.isDirectory()) {
        const entries = await readdir(path, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name !== '.git' && !entry.isSymbolicLink()) pending.push(join(path, entry.name));
        }
      }
    } catch { result.partial = true; }
  }
  return result;
}

function sessionKeys(profile: WorkspaceProfile): string[] {
  return [...new Set([profile.activeSessionKey, ...Object.keys(profile.sessionStates ?? {}),
    ...Object.values(profile.agentBindings ?? {}).map((binding) => binding.sessionKey)])].filter(Boolean);
}

async function transcriptSize(key: string): Promise<{ disk: StorageSize; label: string }> {
  const agentId = /^agent:([a-zA-Z0-9_-]+):/.exec(key)?.[1];
  if (!agentId) return { disk: { bytes: 0, partial: true }, label: key };
  const directory = join(getOpenClawConfigDir(), 'agents', agentId, 'sessions');
  try {
    const index = JSON.parse(await readFile(join(directory, 'sessions.json'), 'utf8'));
    const entry = index[key];
    const label = typeof entry?.label === 'string' ? entry.label : typeof entry?.displayName === 'string' ? entry.displayName : key;
    const resolution = resolveSessionTranscriptPath(index, directory, key);
    if (!resolution.ok) return { disk: { bytes: 0, partial: resolution.failure.kind !== 'not-found' }, label };
    const names = (await readdir(resolution.sessionsDirAbs)).filter((name) =>
      name === `${resolution.baseId}.jsonl` || name.startsWith(`${resolution.baseId}.jsonl.reset.`)
      || name === `${resolution.baseId}.trajectory.jsonl` || name === `${resolution.baseId}.deleted.jsonl`
      || name === `${resolution.baseId}.archived.jsonl` || name === `${resolution.baseId}.trajectory-path.json`);
    const sizes = await Promise.all(names.map((name) => measureStorage(join(resolution.sessionsDirAbs, name))));
    return { disk: { bytes: sizes.reduce((sum, size) => sum + size.bytes, 0), partial: sizes.some((size) => size.partial) }, label };
  } catch (error) {
    return { disk: { bytes: 0, partial: (error as NodeJS.ErrnoException).code !== 'ENOENT' }, label: key };
  }
}

export function createSessionStorageApi(context: {
  workspaces: CompleteHostServiceRegistry['workspaces'];
  terminalManager: TerminalSessionManager;
}): CompleteHostServiceRegistry['sessionStorage'] {
  const browsers = () => getDefaultAgentBrowserService();
  const tracker = () => getResourceTracker();
  const owned = (workspaceId: string, sessionKey?: string) => ({
    terminals: context.terminalManager.list({ workspaceId, sessionKey }),
    browsers: browsers().list().filter((row) => row.workspaceId === workspaceId && (!sessionKey || row.sessionKey === sessionKey)),
    servers: tracker().list().resources.filter((row) => row.ownership === 'managed' && row.workspaceId === workspaceId && (!sessionKey || row.sessionKey === sessionKey)),
  });
  const inventory = async (measure = true) => {
    const diskDeadline = Date.now() + 6000;
    const snapshot = await context.workspaces.list();
    const profiles = snapshot.profiles ?? [];
    const canonical = new Map<string, string>();
    for (const profile of profiles) canonical.set(profile.id, pathKey(await realpath(profile.rootPath).catch(() => profile.rootPath)));
    const worktrees: StorageWorktree[] = [];
    const seen = new Set<string>();
    for (const profile of profiles) {
      const result = await git(['worktree', 'list', '--porcelain', '-z'], profile.rootPath);
      if (result.exitCode !== 0) continue;
      const list = parseWorktrees(result.stdout);
      for (const [index, tree] of list.entries()) {
        const key = pathKey(await realpath(tree.path).catch(() => tree.path));
        if (seen.has(key)) continue;
        seen.add(key);
        const owners = profiles.filter((owner) => canonical.get(owner.id) === key);
        const resources = owners.some((owner) => {
          const current = owned(owner.id);
          return current.terminals.length + current.browsers.length + current.servers.length > 0;
        });
        // Include ignored files: Git refuses to discard build output without --force.
        const status = await git(['status', '--porcelain', '--untracked-files=all', '--ignored=matching'], tree.path);
        const ownership = index === 0 || tree.bare ? null : inspectUiWorktreeRemoval(profile.rootPath, tree.path, profiles);
        const protection = index === 0 || tree.bare ? 'primary'
          : owners.some((owner) => owner.id === snapshot.activeWorkspaceId) ? 'active'
            : tree.locked ? 'locked' : resources ? 'resources'
              : owners.length ? 'sessions' : ownership?.blocked || status.exitCode !== 0 ? 'unavailable'
                : status.stdout.trim() ? 'dirty' : null;
        worktrees.push({ ...tree, ...(ownership?.blocked ? { reason: ownership.reason } : {}), repositoryWorkspaceId: profile.id, repositoryName: profile.name,
          workspaceIds: owners.map((owner) => owner.id), protection,
          disk: measure ? await measureStorage(tree.path, 20_000, Math.min(diskDeadline, Date.now() + 2000)) : { bytes: 0, partial: false } });
      }
    }
    return { profiles, worktrees };
  };
  let snapshotPending: ReturnType<CompleteHostServiceRegistry['sessionStorage']['snapshot']> | null = null;
  const removalUnavailable = (error: unknown) => ({ success: false, blocked: true,
    reason: `UI_CLEANUP_OWNER_UNAVAILABLE: ${String(error)}; owner=Workspace/session lifecycle; entry=/settings/storage` });
  const collect = async () => {
    const { profiles, worktrees } = await inventory();
    const sessions: SessionStorageEntry[] = [];
    for (const profile of profiles) {
      for (const sessionKey of sessionKeys(profile)) {
        const resources = owned(profile.id, sessionKey);
        const pids = [...new Set([...resources.terminals.map((row) => row.pid), ...resources.servers.map((row) => row.pid)])]
          .filter((pid): pid is number => typeof pid === 'number' && pid > 0);
        const [transcript, sample] = await Promise.all([transcriptSize(sessionKey),
          pids.length ? readProcessTreeSample({ rootPids: pids }) : null]);
        sessions.push({ workspaceId: profile.id, workspaceName: profile.name, sessionKey, ...transcript,
          memoryBytes: sample?.status === 'ok' ? sample.treeRssBytes
            : resources.terminals.length + resources.browsers.length + resources.servers.length > 0 ? null : 0,
          terminals: resources.terminals.length,
          browsers: resources.browsers.length, servers: resources.servers.length });
      }
    }
    let applicationMemoryBytes: number | null = null;
    try { applicationMemoryBytes = app.getAppMetrics().reduce((sum, entry) => sum + entry.memory.workingSetSize * 1024, 0); } catch { /* Not available before app readiness. */ }
    return { success: true, measuredAt: new Date().toISOString(), applicationMemoryBytes, sessions, worktrees };
  };
  return {
    snapshot: async () => {
      if (!snapshotPending) snapshotPending = collect().finally(() => { snapshotPending = null; });
      return snapshotPending;
    },
    release: async (payload) => {
      const snapshot = await context.workspaces.list();
      const profile = snapshot.profiles?.find((row) => row.id === payload?.workspaceId);
      if (!profile || !sessionKeys(profile).includes(payload.sessionKey)) throw new Error('Unknown workspace session');
      const current = owned(profile.id, payload.sessionKey);
      let released = 0;
      let failed = 0;
      for (const terminal of current.terminals) {
        try { if (terminal.sessionId) { await context.terminalManager.close(terminal.sessionId, 'user-close'); released++; } } catch { failed++; }
      }
      for (const browser of current.browsers) {
        try { await browsers().close(browser.id); released++; } catch { failed++; }
      }
      for (const server of current.servers) {
        try { const result = await tracker().stopResource(server.id); if (result.success) released++; else failed++; } catch { failed++; }
      }
      return { success: failed === 0, released, failed };
    },
    removeWorktree: async (payload) => {
      if (!payload || typeof payload.path !== 'string' || typeof payload.workspaceId !== 'string') throw new Error('Worktree and workspace are required');
      const initial = await inventory(false).catch(error => ({ error }));
      if ('error' in initial) return removalUnavailable(initial.error);
      const { profiles, worktrees } = initial;
      const profile = profiles.find((row) => row.id === payload.workspaceId);
      const tree = worktrees.find((row) => row.repositoryWorkspaceId === payload.workspaceId && pathKey(row.path) === pathKey(payload.path));
      if (!profile || !tree) throw new Error('Worktree is not registered with this repository');
      const before = inspectUiWorktreeRemoval(profile.rootPath, tree.path, profiles);
      if (before.blocked) return { success: false, blocked: true, reason: before.reason };
      if (tree.protection) return { success: false, blocked: true, reason: tree.reason || tree.protection };
      const blocked = await enforcePermission({ workspace: profile, action: 'storageWorktreeRemove', risk: 'dangerous', approvalId: payload.approvalId,
        command: `git worktree remove ${tree.path}`, paths: [tree.path], targetIdentity: before.identity });
      if (blocked) return blocked;
      const latest = await inventory(false).catch(error => ({ error }));
      if ('error' in latest) return removalUnavailable(latest.error);
      const currentTree = latest.worktrees.find(row => row.repositoryWorkspaceId === payload.workspaceId && pathKey(row.path) === pathKey(tree.path));
      const current = inspectUiWorktreeRemoval(profile.rootPath, tree.path, latest.profiles);
      if (current.blocked) return { success: false, blocked: true, reason: current.reason };
      if (!currentTree || currentTree.protection || current.identity !== before.identity)
        return { success: false, blocked: true, reason: currentTree?.reason || 'UI_CLEANUP_STATE_CHANGED; entry=/settings/storage' };
      const result = await git(['worktree', 'remove', '--', tree.path], profile.rootPath);
      return { success: result.exitCode === 0, ...result };
    },
  };
}
