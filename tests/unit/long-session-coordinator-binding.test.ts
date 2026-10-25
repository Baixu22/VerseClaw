import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskLedgerSnapshot } from '@shared/types/task-ledger';

const SESSION_KEY = 'agent:main:coordinator';
const WORKSPACE_ID = 'workspace-a';

const storeState = vi.hoisted(() => ({
  activeWorkspaceId: 'workspace-a' as string | null,
  profiles: [] as Array<Record<string, unknown>>,
}));

const ledgerState = vi.hoisted(() => ({
  physicalId: 'physical-1',
  snapshot: null as unknown,
  load: vi.fn(),
  append: vi.fn(),
}));

vi.mock('electron-store', () => {
  class MockStore {
    constructor(options?: { defaults?: { activeWorkspaceId?: string | null; profiles?: unknown[] } }) {
      if (storeState.profiles.length === 0 && options?.defaults?.profiles) {
        storeState.profiles = [...(options.defaults.profiles as Array<Record<string, unknown>>)];
        storeState.activeWorkspaceId = options.defaults.activeWorkspaceId ?? null;
      }
    }
    get(key: string) {
      if (key === 'profiles') return storeState.profiles;
      if (key === 'activeWorkspaceId') return storeState.activeWorkspaceId;
      return undefined;
    }
    set(key: string, value: unknown) {
      if (key === 'profiles') storeState.profiles = Array.isArray(value) ? [...(value as Array<Record<string, unknown>>)] : [];
      if (key === 'activeWorkspaceId') storeState.activeWorkspaceId = typeof value === 'string' ? value : null;
    }
  }
  return { default: MockStore };
});

vi.mock('@electron/services/task-ledger-service', () => ({
  loadTaskLedgerSnapshot: (...args: unknown[]) => ledgerState.load(...args),
  appendTaskLedgerEvents: (...args: unknown[]) => ledgerState.append(...args),
}));

vi.mock('@electron/services/workspace-runtime-sync', () => ({
  syncActiveWorkspacePermissionToRuntime: vi.fn(async () => undefined),
  syncActiveWorkspaceRootToRuntime: vi.fn(async () => undefined),
}));

vi.mock('@electron/utils/paths', () => ({
  expandPath: (value: string) => value,
  getOpenClawConfigDir: () => 'D:/tmp/long-session-c1',
  getResourcesDir: () => 'resources',
}));

vi.mock('@electron/utils/clawx-harness-template', () => ({
  ensureVerseClawWorkspaceHarness: vi.fn(async () => ({
    workspaceDir: '', templateDir: '', targetDir: '', filesWritten: 0,
  })),
}));

vi.mock('@electron/services/permissions-api', () => ({
  recordPermissionDecisionEvent: vi.fn(async () => undefined),
}));

vi.mock('@electron/utils/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@electron/services/knowledge-api', () => ({
  resolveHostOpenClawStateDir: () => 'D:/tmp/long-session-c1',
}));

vi.mock('@electron/services/resource-tracker', () => ({
  getResourceTracker: () => ({ unregisterBySession: vi.fn(async () => 0) }),
}));

function ledgerSnapshot(): TaskLedgerSnapshot {
  const now = '2026-10-23T00:00:00.000Z';
  return {
    schemaVersion: 1,
    workspaceId: WORKSPACE_ID,
    generatedAt: now,
    nodes: [{
      id: 'ledger-a', title: 'C1 Task', kind: 'task', status: 'doing', progress: 20, owner: 'agent',
      createdAt: now, updatedAt: now,
    }, {
      id: 'ledger-b', title: 'C1 verification', kind: 'check', status: 'todo', owner: 'agent',
      createdAt: now, updatedAt: now,
    }],
    edges: [],
    sessionLinks: [],
    rootNodeIds: ['ledger-a'],
    reviewNodeIds: [],
    activeNodeIds: ['ledger-a'],
    blockedNodeIds: [],
    currentGoalId: null,
    recentDecisions: [],
    eventsCount: 2,
    warnings: [],
  };
}

function gateway(physicalId = 'physical-1') {
  return {
    rpc: vi.fn(async (method: string) => {
      if (method !== 'sessions.list') throw new Error(`Unexpected RPC ${method}`);
      return { sessions: [{ key: SESSION_KEY, sessionId: physicalId }] };
    }),
  };
}

function bindPayload(overrides: Record<string, unknown> = {}) {
  return {
    workspaceId: WORKSPACE_ID,
    agentId: 'main',
    sessionKey: SESSION_KEY,
    expectedRevision: 0,
    taskRefs: [
      { kind: 'task-ledger' as const, nodeId: 'ledger-a' },
      { kind: 'task-ledger' as const, nodeId: 'ledger-b' },
    ],
    ...overrides,
  };
}

describe('long-session coordinator binding', () => {
  beforeEach(() => {
    storeState.activeWorkspaceId = WORKSPACE_ID;
    storeState.profiles = [{
      id: WORKSPACE_ID,
      name: 'Coordinator Workspace',
      rootPath: 'D:/workspace-a',
      agentId: 'main',
      selectedAgentId: 'main',
      activeSessionKey: SESSION_KEY,
      agentBindings: { main: { workspaceId: WORKSPACE_ID, agentId: 'main', sessionKey: SESSION_KEY } },
      permissionMode: 'acceptEdits',
      createdAt: 1,
      updatedAt: 1,
      lastOpenedAt: 1,
      state: {},
      sessionStates: { [SESSION_KEY]: {} },
    }];
    ledgerState.load.mockReset();
    ledgerState.append.mockReset();
    ledgerState.snapshot = ledgerSnapshot();
    ledgerState.load.mockImplementation(async () => ledgerState.snapshot);
    ledgerState.append.mockImplementation(async () => ledgerState.snapshot);
  });

  it('binds only after an explicit request and persists existing Task Ledger references', async () => {
    const { createWorkspacesApi } = await import('@electron/services/workspaces-api');
    const { createSessionsApi } = await import('@electron/services/sessions-api');
    const workspaces = createWorkspacesApi();
    const before = await workspaces.list();
    expect(before.activeWorkspace?.coordinatorBinding).toBeUndefined();

    const sessions = createSessionsApi({ gatewayManager: gateway() as never });
    const bound = await sessions.bindCoordinator(bindPayload());

    expect(bound).toMatchObject({
      success: true,
      validation: 'current',
      binding: {
        schemaVersion: 'WorkspaceCoordinatorBinding/v1',
        workspaceId: WORKSPACE_ID,
        agentId: 'main',
        sessionKey: SESSION_KEY,
        sessionId: 'physical-1',
        taskRefs: [
          { kind: 'task-ledger', nodeId: 'ledger-a' },
          { kind: 'task-ledger', nodeId: 'ledger-b' },
        ],
        state: 'active',
        revision: 1,
      },
    });
    const after = await workspaces.list();
    expect(after.activeWorkspace?.coordinatorBinding).toMatchObject({ revision: 1, state: 'active' });
    expect(ledgerState.append).not.toHaveBeenCalled();
    expect(ledgerState.snapshot).toEqual(ledgerSnapshot());
  });

  it('rejects cross-workspace, missing owner, wrong assistant, unknown task and revision conflicts', async () => {
    const { createSessionsApi } = await import('@electron/services/sessions-api');
    const sessions = createSessionsApi({ gatewayManager: gateway() as never });

    await expect(sessions.bindCoordinator(bindPayload({ workspaceId: 'workspace-b' })))
      .resolves.toMatchObject({ success: false, error: expect.stringMatching(/cross the active workspace/) });
    await expect(createSessionsApi().bindCoordinator(bindPayload()))
      .resolves.toMatchObject({ success: false, error: expect.stringMatching(/Gateway manager unavailable/) });
    await expect(sessions.bindCoordinator(bindPayload({ sessionKey: 'agent:other:coordinator' })))
      .resolves.toMatchObject({ success: false, error: expect.stringMatching(/different assistant/) });
    const missingSession = createSessionsApi({
      gatewayManager: { rpc: vi.fn(async () => ({ sessions: [] })) } as never,
    });
    await expect(missingSession.bindCoordinator(bindPayload()))
      .resolves.toMatchObject({ success: false, error: expect.stringMatching(/does not exist/) });
    await expect(sessions.bindCoordinator(bindPayload({
      taskRefs: [{ kind: 'task-ledger', nodeId: 'missing' }],
    }))).resolves.toMatchObject({ success: false, error: expect.stringMatching(/do not exist/) });

    await expect(sessions.bindCoordinator(bindPayload())).resolves.toMatchObject({ success: true });
    await expect(sessions.bindCoordinator(bindPayload())).resolves.toMatchObject({
      success: false,
      error: expect.stringMatching(/revision conflict/),
    });
  });

  it('recovers from disk after service restart and keeps the same generation current', async () => {
    const { createSessionsApi } = await import('@electron/services/sessions-api');
    await createSessionsApi({ gatewayManager: gateway() as never }).bindCoordinator(bindPayload());

    const restarted = createSessionsApi({ gatewayManager: gateway('physical-1') as never });
    await expect(restarted.coordinatorBinding({ workspaceId: WORKSPACE_ID })).resolves.toMatchObject({
      success: true,
      validation: 'current',
      binding: { sessionId: 'physical-1', revision: 1, state: 'active' },
    });
  });

  it('invalidates a reset generation and the archive/delete invalidation helper durably', async () => {
    const { createSessionsApi } = await import('@electron/services/sessions-api');
    const { createWorkspacesApi, invalidateWorkspaceCoordinatorBindingsForSession } = await import('@electron/services/workspaces-api');
    await createSessionsApi({ gatewayManager: gateway('physical-1') as never }).bindCoordinator(bindPayload());

    const reset = await createSessionsApi({ gatewayManager: gateway('physical-2') as never })
      .coordinatorBinding({ workspaceId: WORKSPACE_ID });
    expect(reset).toMatchObject({
      success: true,
      validation: 'invalidated',
      reason: 'reset',
      binding: { state: 'invalidated', invalidationReason: 'reset', revision: 2 },
    });

    storeState.profiles = [{
      ...storeState.profiles[0],
      coordinatorBinding: undefined,
    }];
    await createSessionsApi({ gatewayManager: gateway('physical-1') as never }).bindCoordinator(bindPayload());
    await expect(invalidateWorkspaceCoordinatorBindingsForSession(SESSION_KEY, 'archived', {
      workspaceId: WORKSPACE_ID,
    })).resolves.toBe(1);
    await expect(invalidateWorkspaceCoordinatorBindingsForSession(SESSION_KEY, 'deleted', {
      workspaceId: WORKSPACE_ID,
    })).resolves.toBe(0);
    const stored = await createWorkspacesApi().list();
    expect(stored.activeWorkspace?.coordinatorBinding).toMatchObject({
      state: 'invalidated',
      invalidationReason: 'archived',
      revision: 2,
    });
  });
});
