// @vitest-environment node

import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskLedgerSnapshot } from '@shared/types/task-ledger';
import type { WorkspaceProfile } from '@shared/types/workspace';
import { normalizeTaskLedgerWorkspaceId } from '@electron/services/task-ledger-service';

const state = vi.hoisted(() => ({
  activeWorkspaceId: 'workspace-a' as string | null,
  profiles: [] as unknown[],
}));

vi.mock('electron-store', () => {
  class MockStore {
    constructor(options?: { defaults?: { activeWorkspaceId?: string | null; profiles?: unknown[] } }) {
      if (state.profiles.length === 0 && options?.defaults?.profiles) {
        state.profiles = [...options.defaults.profiles];
        state.activeWorkspaceId = options.defaults.activeWorkspaceId ?? null;
      }
    }
    get(key: string) {
      if (key === 'profiles') return state.profiles;
      if (key === 'activeWorkspaceId') return state.activeWorkspaceId;
      return undefined;
    }
    set(key: string, value: unknown) {
      if (key === 'profiles') state.profiles = Array.isArray(value) ? [...value] : [];
      if (key === 'activeWorkspaceId') state.activeWorkspaceId = typeof value === 'string' ? value : null;
    }
  }
  return { default: MockStore };
});

vi.mock('@electron/services/workspace-runtime-sync', () => ({
  syncActiveWorkspacePermissionToRuntime: vi.fn(),
  syncActiveWorkspaceRootToRuntime: vi.fn(),
}));

vi.mock('@electron/utils/paths', () => ({
  expandPath: (value: string) => value,
  getResourcesDir: () => resolve('resources'),
}));

vi.mock('@electron/utils/clawx-harness-template', () => ({
  ensureVerseClawWorkspaceHarness: vi.fn(async () => ({})),
}));

const roots: string[] = [];

function taskLedgerSnapshot(workspaceId: string, nodes = ['TF-100', 'TF-101']): TaskLedgerSnapshot {
  const now = new Date(0).toISOString();
  return {
    schemaVersion: 1,
    workspaceId: normalizeTaskLedgerWorkspaceId(workspaceId),
    generatedAt: now,
    nodes: nodes.map((id) => ({ id, title: id, kind: 'task', status: 'todo', createdAt: now, updatedAt: now })),
    edges: [],
    sessionLinks: nodes.map((nodeId, index) => ({
      id: `link-${index}`,
      sessionKey: 'agent:main:main',
      nodeId,
      agentId: 'main',
      relation: 'related',
      createdAt: now,
    })),
    rootNodeIds: nodes,
    reviewNodeIds: [],
    activeNodeIds: nodes,
    blockedNodeIds: [],
    currentGoalId: null,
    recentDecisions: [],
    eventsCount: nodes.length,
    warnings: [],
  };
}

function repositoryStatus(workspaceRoot: string, branch = 'main') {
  return {
    isRepository: true,
    workspaceRoot,
    repoRoot: workspaceRoot,
    branch,
    detached: false,
    ahead: 0,
    behind: 0,
    clean: true,
    hasConflicts: false,
    stagedCount: 0,
    unstagedCount: 0,
    untrackedCount: 0,
    conflictedCount: 0,
    changes: [],
  };
}

async function apiWith(options: {
  workspaceRoot: string;
  generation?: string;
  sessionStatus?: string;
  hasActiveRun?: boolean;
  worktrees?: Array<{ path: string; branch?: string; detached?: boolean; bare?: boolean; prunable?: boolean }>;
  taskNodes?: string[];
  worktreesForWorkspace?: (workspace: WorkspaceProfile) => Promise<unknown>;
} = { workspaceRoot: '' }) {
  const { createWorkspacesApi } = await import('@electron/services/workspaces-api');
  const generation = options.generation ?? 'generation-1';
  return createWorkspacesApi({
    gatewayManager: {
      rpc: vi.fn(async (method: string, payload: { key?: string }) => {
        if (method !== 'sessions.describe') throw new Error(`unexpected RPC ${method}`);
        if (payload.key === 'agent:main:deleted') return { session: null };
        return { session: { key: payload.key, sessionId: generation, status: options.sessionStatus, hasActiveRun: options.hasActiveRun } };
      }),
    } as never,
    gitApi: {
      ...(options.worktreesForWorkspace ? { worktreesForWorkspace: options.worktreesForWorkspace } : {}),
      status: vi.fn(async () => ({ success: true, status: repositoryStatus(options.workspaceRoot) })),
      worktrees: vi.fn(async () => ({
        success: true,
        worktrees: options.worktrees ?? [{ path: options.workspaceRoot, branch: 'main' }],
      })),
    } as never,
    taskLedgerApi: {
      snapshot: vi.fn(async () => ({ success: true, snapshot: taskLedgerSnapshot('workspace-a', options.taskNodes) })),
    } as never,
  });
}

function profile(workspaceRoot: string): WorkspaceProfile {
  return {
    id: 'workspace-a',
    name: 'Coordinator Workspace',
    rootPath: workspaceRoot,
    agentId: 'main',
    selectedAgentId: 'main',
    activeSessionKey: 'agent:main:main',
    agentBindings: {
      main: { workspaceId: 'workspace-a', agentId: 'main', sessionKey: 'agent:main:main' },
    },
    permissionMode: 'acceptEdits',
    createdAt: 1,
    updatedAt: 1,
    lastOpenedAt: 1,
    state: {},
    sessionStates: { 'agent:main:main': {} },
  };
}

beforeEach(async () => {
  const root = await mkdtemp(join(tmpdir(), 'clawx-coordinator-binding-'));
  roots.push(root);
  state.activeWorkspaceId = 'workspace-a';
  state.profiles = [profile(root)];
});

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function bindLocal(api: Awaited<ReturnType<typeof apiWith>>, overrides: Record<string, unknown> = {}) {
  const workspace = state.profiles[0] as WorkspaceProfile;
  return api.bindCoordinator({
    workspaceId: 'workspace-a',
    agentId: 'main',
    sessionKey: 'agent:main:main',
    expectedRevision: 0,
    taskLedgerNodeIds: ['TF-100', 'TF-101'],
    environment: { kind: 'local', rootPath: workspace.rootPath, setupProfile: 'desktop' },
    archiveRestorePolicy: 'restore',
    ...overrides,
  } as never);
}

describe('long-session coordinator binding', () => {
  it('persists one explicit Workspace/Assistant/Session binding with Task Ledger refs and restores it', async () => {
    const workspace = state.profiles[0] as WorkspaceProfile;
    const api = await apiWith({ workspaceRoot: workspace.rootPath });
    const bound = await bindLocal(api);

    expect(bound.recovery).toMatchObject({ state: 'ready', bindingRevision: 1 });
    expect(bound.binding).toMatchObject({
      workspaceId: 'workspace-a',
      agentId: 'main',
      sessionKey: 'agent:main:main',
      sessionGeneration: 'generation-1',
      archiveRestorePolicy: 'restore',
      state: 'active',
      bindingRevision: 1,
      environment: {
        kind: 'local',
        canonicalRoot: resolve(workspace.rootPath),
        backend: 'git',
        branch: 'main',
        detachedHead: false,
        setupProfile: 'desktop',
      },
    });
    expect(bound.binding?.taskLedgerReferences.map((reference) => reference.taskLedgerNodeId)).toEqual(['TF-100', 'TF-101']);

    const restarted = await apiWith({ workspaceRoot: workspace.rootPath });
    const restored = await restarted.resolveCoordinator({
      workspaceId: 'workspace-a',
      agentId: 'main',
      sessionKey: 'agent:main:main',
    });
    expect(restored.recovery.state).toBe('ready');
    expect(restored.binding?.bindingRevision).toBe(1);
  });

  it('rejects cross-workspace, missing owner, deleted session, stale revision and missing Task Ledger refs', async () => {
    const workspace = state.profiles[0] as WorkspaceProfile;
    const api = await apiWith({ workspaceRoot: workspace.rootPath });

    await expect(bindLocal(api, { workspaceId: 'workspace-b' })).rejects.toThrow('COORDINATOR_WORKSPACE_SCOPE_MISMATCH');
    await expect(api.bindCoordinator({
      workspaceId: 'workspace-a', agentId: 'other', sessionKey: 'agent:other:main', expectedRevision: 0,
      taskLedgerNodeIds: ['TF-100'], environment: { kind: 'local', rootPath: workspace.rootPath }, archiveRestorePolicy: 'restore',
    })).rejects.toThrow('COORDINATOR_OWNER_MISSING');
    const deletedProfile = state.profiles[0] as WorkspaceProfile;
    deletedProfile.agentBindings = {
      main: { workspaceId: 'workspace-a', agentId: 'main', sessionKey: 'agent:main:deleted' },
    };
    deletedProfile.activeSessionKey = 'agent:main:deleted';
    await expect(bindLocal(api, { sessionKey: 'agent:main:deleted' })).rejects.toThrow('COORDINATOR_SESSION_MISSING');
    deletedProfile.agentBindings = {
      main: { workspaceId: 'workspace-a', agentId: 'main', sessionKey: 'agent:main:main' },
    };
    deletedProfile.activeSessionKey = 'agent:main:main';
    await expect(bindLocal(api, { taskLedgerNodeIds: ['TF-missing'] })).rejects.toThrow('COORDINATOR_TASK_REF_MISSING');

    await bindLocal(api);
    await expect(bindLocal(api, { expectedRevision: 9 })).rejects.toThrow('COORDINATOR_REVISION_CONFLICT');
  });

  it('serializes concurrent revision-zero binds so exactly one wins', async () => {
    const workspace = state.profiles[0] as WorkspaceProfile;
    const api = await apiWith({ workspaceRoot: workspace.rootPath });
    const results = await Promise.allSettled([bindLocal(api), bindLocal(api)]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect((state.profiles[0] as WorkspaceProfile).coordinatorBindings?.['agent:main:main']?.bindingRevision).toBe(1);
  });

  it('validates a managed worktree through the Git owner and rejects duplicate branch ownership', async () => {
    const workspace = state.profiles[0] as WorkspaceProfile;
    const worktree = join(workspace.rootPath, '..', `${workspace.name}-feature`);
    await mkdir(worktree, { recursive: true });
    const api = await apiWith({
      workspaceRoot: workspace.rootPath,
      worktrees: [
        { path: workspace.rootPath, branch: 'main' },
        { path: worktree, branch: 'feature/session' },
      ],
    });
    const bound = await bindLocal(api, { environment: { kind: 'managed-worktree', rootPath: worktree, setupProfile: 'feature' } });
    expect(bound.binding?.environment).toMatchObject({ kind: 'managed-worktree', canonicalRoot: resolve(worktree), branch: 'feature/session', backend: 'git' });

    const conflicting = await apiWith({
      workspaceRoot: workspace.rootPath,
      worktrees: [
        { path: workspace.rootPath, branch: 'feature/session' },
        { path: worktree, branch: 'feature/session' },
      ],
    });
    await expect(bindLocal(conflicting, { expectedRevision: 1, environment: { kind: 'managed-worktree', rootPath: worktree } }))
      .rejects.toThrow('COORDINATOR_BRANCH_NOT_UNIQUE');
  });

  it('blocks changing the environment while the session has an active run', async () => {
    const workspace = state.profiles[0] as WorkspaceProfile;
    const initial = await apiWith({ workspaceRoot: workspace.rootPath });
    await bindLocal(initial);
    const worktree = join(workspace.rootPath, '..', `${workspace.name}-active-switch`);
    await mkdir(worktree, { recursive: true });
    const running = await apiWith({
      workspaceRoot: workspace.rootPath,
      sessionStatus: 'running',
      hasActiveRun: true,
      worktrees: [
        { path: workspace.rootPath, branch: 'main' },
        { path: worktree, branch: 'feature/active' },
      ],
    });
    await expect(bindLocal(running, {
      expectedRevision: 1,
      environment: { kind: 'managed-worktree', rootPath: worktree },
    })).rejects.toThrow('COORDINATOR_BINDING_SWITCH_BLOCKED');
  });

  it('invalidates reset generations and applies archive policy without deleting the environment', async () => {
    const workspace = state.profiles[0] as WorkspaceProfile;
    const api = await apiWith({ workspaceRoot: workspace.rootPath });
    await bindLocal(api);

    const reset = await apiWith({ workspaceRoot: workspace.rootPath, generation: 'generation-2' });
    const mismatch = await reset.resolveCoordinator({ workspaceId: 'workspace-a', agentId: 'main', sessionKey: 'agent:main:main' });
    expect(mismatch.recovery).toMatchObject({ state: 'generation-mismatch', reason: 'session-generation-mismatch' });
    expect(mismatch.binding?.state).toBe('invalid');

    const fresh = await bindLocal(reset, { expectedRevision: 2 });
    expect(fresh.binding?.sessionGeneration).toBe('generation-2');
    await reset.coordinatorLifecycle({ type: 'archive', workspaceId: 'workspace-a', sessionKey: 'agent:main:main' });
    const archived = (state.profiles[0] as WorkspaceProfile).coordinatorBindings?.['agent:main:main'];
    expect(archived?.state).toBe('paused');
    expect(archived?.environment.canonicalRoot).toBe(resolve(workspace.rootPath));

    await reset.coordinatorLifecycle({ type: 'restore', workspaceId: 'workspace-a', sessionKey: 'agent:main:main' });
    const restored = (state.profiles[0] as WorkspaceProfile).coordinatorBindings?.['agent:main:main'];
    expect(restored?.state).toBe('active');
    expect(restored?.sessionGeneration).toBe('generation-2');

    await reset.coordinatorLifecycle({ type: 'delete', workspaceId: 'workspace-a', sessionKey: 'agent:main:main' });
    expect((state.profiles[0] as WorkspaceProfile).coordinatorBindings?.['agent:main:main']?.state).toBe('invalid');
  });

  it('marks archive retention=none invalid without deleting the environment', async () => {
    const workspace = state.profiles[0] as WorkspaceProfile;
    const api = await apiWith({ workspaceRoot: workspace.rootPath });
    await bindLocal(api, { archiveRestorePolicy: 'none' });
    await api.coordinatorLifecycle({ type: 'archive', workspaceId: 'workspace-a', sessionKey: 'agent:main:main' });
    const binding = (state.profiles[0] as WorkspaceProfile).coordinatorBindings?.['agent:main:main'];
    expect(binding?.state).toBe('invalid');
    expect(binding?.invalidationReason).toBe('archived-retention-none');
    expect(binding?.environment.canonicalRoot).toBe(resolve(workspace.rootPath));
  });

  it.each([undefined, 'confirmed-child-generation'])('hands the binding to a child session with generation %s while pausing the source', async (sessionGeneration) => {
    const workspace = state.profiles[0] as WorkspaceProfile;
    const api = await apiWith({ workspaceRoot: workspace.rootPath });
    await bindLocal(api);
    await api.coordinatorLifecycle({
      type: 'handoff',
      workspaceId: 'workspace-a',
      sourceSessionKey: 'agent:main:main',
      sessionKey: 'agent:main:session-child',
      agentId: 'main',
      ...(sessionGeneration ? { sessionGeneration } : {}),
    });
    const bindings = (state.profiles[0] as WorkspaceProfile).coordinatorBindings;
    expect((state.profiles[0] as WorkspaceProfile).projectCoordinatorSessionKey).toBe('agent:main:session-child');
    expect(bindings?.['agent:main:main'].state).toBe('paused');
    expect(bindings?.['agent:main:session-child']).toMatchObject({
      state: 'active',
      sessionGeneration: sessionGeneration ?? null,
      workspaceId: 'workspace-a',
      agentId: 'main',
    });
    expect(bindings?.['agent:main:session-child'].taskLedgerReferences).toEqual(bindings?.['agent:main:main'].taskLedgerReferences);
  });

  it('pauses only with the exact binding revision', async () => {
    const workspace = state.profiles[0] as WorkspaceProfile;
    const api = await apiWith({ workspaceRoot: workspace.rootPath });
    await bindLocal(api);
    await expect(api.pauseCoordinator({
      workspaceId: 'workspace-a', agentId: 'main', sessionKey: 'agent:main:main', expectedRevision: 4,
    })).rejects.toThrow('COORDINATOR_REVISION_CONFLICT');
    const paused = await api.pauseCoordinator({
      workspaceId: 'workspace-a', agentId: 'main', sessionKey: 'agent:main:main', expectedRevision: 1,
    });
    expect(paused.recovery.state).toBe('paused');
    expect(paused.binding?.bindingRevision).toBe(2);
  });
  it('updates the target agent only when a session in another agent is selected', async () => {
    const workspace = state.profiles[0] as WorkspaceProfile;
    workspace.selectedAgentId = 'reviewer';
    workspace.activeSessionKey = 'agent:reviewer:review';
    workspace.agentBindings!.reviewer = { workspaceId: workspace.id, agentId: 'reviewer', sessionKey: 'agent:reviewer:review' };
    const api = await apiWith({ workspaceRoot: workspace.rootPath });
    await api.saveState({ id: workspace.id, activeSessionKey: 'agent:main:main' });
    const saved = state.profiles[0] as WorkspaceProfile;
    expect(saved.selectedAgentId).toBe('main');
    expect(saved.agentBindings?.reviewer.sessionKey).toBe('agent:reviewer:review');
    expect(saved.agentBindings?.main.sessionKey).toBe('agent:main:main');
  });
  it('revalidates a managed worktree against its owning project after another project becomes active', async () => {
    const workspace = state.profiles[0] as WorkspaceProfile;
    const worktree = join(workspace.rootPath, 'managed-worktree');
    await mkdir(worktree, { recursive: true });
    const scopedWorktrees = vi.fn(async (owner: WorkspaceProfile) => {
      expect(owner.id).toBe('workspace-a');
      return { success: true, worktrees: [{ path: worktree, branch: 'worker' }] };
    });
    const api = await apiWith({ workspaceRoot: workspace.rootPath, worktrees: [], worktreesForWorkspace: scopedWorktrees });
    await bindLocal(api, { environment: { kind: 'managed-worktree', rootPath: worktree } });
    state.profiles.push({ ...profile(workspace.rootPath), id: 'workspace-b', coordinatorBindings: {} });
    state.activeWorkspaceId = 'workspace-b';
    const resolved = await api.resolveCoordinator({ workspaceId: 'workspace-a', sessionKey: 'agent:main:main', agentId: 'main' });
    expect(resolved.recovery.state).toBe('ready');
    expect(scopedWorktrees).toHaveBeenCalledTimes(2);
  });
});
