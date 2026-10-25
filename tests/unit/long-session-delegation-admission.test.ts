import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskLedgerSnapshot } from '@shared/types/task-ledger';
import { buildDelegationAdmissionReceipt } from '../../openclaw_runtime/src/agents/delegation-admission';

const SESSION_KEY = 'agent:main:coordinator';
const WORKSPACE_ID = 'workspace-a';
const TASK_NODE_ID = 'ledger-task-a';

const storeState = vi.hoisted(() => ({
  activeWorkspaceId: 'workspace-a' as string | null,
  profiles: [] as Array<Record<string, unknown>>,
}));

const ledgerState = vi.hoisted(() => ({
  snapshot: null as unknown,
  load: vi.fn(),
  append: vi.fn(),
}));

const gatewayState = vi.hoisted(() => ({
  orchestratorMode: 'accepted' as 'accepted' | 'unknown-role' | 'pending',
  orchestratorCalls: 0,
  stopCalls: [] as Array<Record<string, unknown>>,
  pendingResolve: null as null | ((value: unknown) => void),
  invalidateDuringSpawn: false,
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
  getOpenClawConfigDir: () => 'D:/tmp/long-session-c2',
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
  resolveHostOpenClawStateDir: () => 'D:/tmp/long-session-c2',
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
    nodes: [{ id: TASK_NODE_ID, title: 'Delegate task', kind: 'task', status: 'doing', owner: 'agent', createdAt: now, updatedAt: now }],
    edges: [],
    sessionLinks: [],
    rootNodeIds: [TASK_NODE_ID],
    reviewNodeIds: [],
    activeNodeIds: [TASK_NODE_ID],
    blockedNodeIds: [],
    currentGoalId: null,
    recentDecisions: [],
    eventsCount: 1,
    warnings: [],
  };
}

function acceptedReceipt(params: Record<string, unknown>): Record<string, unknown> {
  const admission = params.delegationAdmission as {
    receiptId: string;
    idempotencyKey: string;
    requestDigest: string;
    coordinator: {
      workspaceId: string;
      agentId: string;
      sessionKey: string;
      sessionId: string;
      bindingRevision: number;
    };
    taskRef: { kind: 'task-ledger'; nodeId: string };
    createdAt: string;
  };
  const workers = params.workers as Array<{ roleName: string; task: string; writeSet?: string[]; isolation?: 'shared' | 'worktree' }>;
  const worker = workers[0]!;
  return buildDelegationAdmissionReceipt({
    admission,
    roleName: worker.roleName,
    task: worker.task,
    orchestrationRunId: 'orch-c2-test',
    taskNodeId: 'graph-task-a',
    taskId: 'task-a',
    roleInstanceId: 'role-a:1',
    executionWave: 1,
    concurrentSiblings: 0,
    isWriter: true,
    writeSet: worker.writeSet ?? [],
    worktree: worker.isolation === 'worktree' ? { id: 'worktree-a', backend: 'git' } : null,
    spawn: {
      status: 'accepted',
      result: {
        status: 'accepted',
        runId: 'run-child-a',
        childSessionKey: 'agent:main:child-a',
        resolvedProvider: 'openai',
        resolvedModel: 'gpt-test',
      },
      backend: {
        kind: 'openclaw-embedded',
        provider: 'openai',
        model: 'gpt-test',
        evidence: 'fake-role-spawn',
      },
      authorization: {
        allowlist: ['read', 'write'],
        denylist: ['exec'],
        permissionDecisionCount: 1,
        source: 'role-clamped-inherited',
      },
    },
  }) as unknown as Record<string, unknown>;
}

function gateway() {
  return {
    rpc: vi.fn(async (method: string, params: Record<string, unknown>) => {
      if (method === 'sessions.list') {
        return { sessions: [{ key: SESSION_KEY, sessionId: 'physical-coordinator' }] };
      }
      if (method === 'orchestrator.run') {
        gatewayState.orchestratorCalls += 1;
        if (gatewayState.orchestratorMode === 'unknown-role') throw new Error('unknown role "ghost"');
        if (gatewayState.invalidateDuringSpawn) {
          const binding = (storeState.profiles[0].coordinatorBinding as Record<string, unknown>);
          binding.state = 'invalidated';
          binding.invalidationReason = 'reset';
        }
        const receipt = acceptedReceipt(params);
        if (gatewayState.orchestratorMode === 'pending') {
          return await new Promise((resolve) => { gatewayState.pendingResolve = resolve; });
        }
        return { admissionReceipts: [receipt] };
      }
      if (method === 'sessions.stop') {
        gatewayState.stopCalls.push(params);
        return { ok: true };
      }
      throw new Error(`Unexpected RPC ${method}`);
    }),
  };
}

async function bindCoordinator() {
  const { createSessionsApi } = await import('@electron/services/sessions-api');
  const result = await createSessionsApi({ gatewayManager: gateway() as never }).bindCoordinator({
    workspaceId: WORKSPACE_ID,
    agentId: 'main',
    sessionKey: SESSION_KEY,
    expectedRevision: 0,
    taskRefs: [{ kind: 'task-ledger', nodeId: TASK_NODE_ID }],
  });
  expect(result.success).toBe(true);
}

function payload(overrides: Record<string, unknown> = {}) {
  return {
    workspaceId: WORKSPACE_ID,
    idempotencyKey: 'delegation-key-a',
    roleName: 'implementer',
    task: 'Implement isolated slice',
    taskRef: { kind: 'task-ledger' as const, nodeId: TASK_NODE_ID },
    writeSet: ['src/a.ts'],
    isolation: 'shared' as const,
    backend: 'openclaw-embedded' as const,
    ...overrides,
  };
}

async function waitFor(condition: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for condition');
}

describe('long-session delegation admission', () => {
  beforeEach(() => {
    storeState.activeWorkspaceId = WORKSPACE_ID;
    storeState.profiles = [{
      id: WORKSPACE_ID,
      name: 'Delegation Workspace',
      rootPath: 'D:/workspace-a',
      agentId: 'main',
      selectedAgentId: 'main',
      activeSessionKey: SESSION_KEY,
      agentBindings: { main: { workspaceId: WORKSPACE_ID, agentId: 'main', sessionKey: SESSION_KEY } },
      permissionMode: 'fullAccess',
      createdAt: 1,
      updatedAt: 1,
      lastOpenedAt: 1,
      state: {},
      sessionStates: { [SESSION_KEY]: {} },
      delegationReceipts: {},
    }];
    ledgerState.load.mockReset();
    ledgerState.append.mockReset();
    ledgerState.snapshot = ledgerSnapshot();
    ledgerState.load.mockImplementation(async () => ledgerState.snapshot);
    ledgerState.append.mockImplementation(async () => ledgerState.snapshot);
    gatewayState.orchestratorMode = 'accepted';
    gatewayState.orchestratorCalls = 0;
    gatewayState.stopCalls = [];
    gatewayState.pendingResolve = null;
    gatewayState.invalidateDuringSpawn = false;
  });

  it('records an accepted admission bound to coordinator revision, task, child identity, backend and tool grant', async () => {
    await bindCoordinator();
    const { createSessionsApi } = await import('@electron/services/sessions-api');
    const sessions = createSessionsApi({ gatewayManager: gateway() as never });

    const first = await sessions.delegateCoordinator(payload());
    expect(first).toMatchObject({
      success: true,
      duplicate: false,
      receipt: {
        state: 'accepted',
        acceptedIsNotCompletion: true,
        coordinator: { workspaceId: WORKSPACE_ID, sessionKey: SESSION_KEY, sessionId: 'physical-coordinator', bindingRevision: 1 },
        taskRef: { kind: 'task-ledger', nodeId: TASK_NODE_ID },
        childSessionKey: 'agent:main:child-a',
        childRunId: 'run-child-a',
        backend: { kind: 'openclaw-embedded', provider: 'openai', model: 'gpt-test' },
        toolAuthorization: { allowlist: ['read', 'write'], denylist: ['exec'], permissionDecisionCount: 1, source: 'role-clamped-inherited' },
        isolation: { mode: 'inprocess-shared', backend: 'inprocess', writeSet: ['src/a.ts'], parallelWritesAllowed: false, writeSetBasis: 'serialized' },
      },
    });
    expect(gatewayState.orchestratorCalls).toBe(1);

    const duplicate = await sessions.delegateCoordinator(payload());
    expect(duplicate).toMatchObject({ success: true, duplicate: true, receipt: { state: 'accepted' } });
    expect(gatewayState.orchestratorCalls).toBe(1);

    const conflict = await sessions.delegateCoordinator(payload({ task: 'A different delegated task' }));
    expect(conflict).toMatchObject({ success: false, duplicate: true });
    expect(conflict.error).toMatch(/different request/);

    const listed = await sessions.delegationAdmissions({ workspaceId: WORKSPACE_ID });
    expect(listed.success).toBe(true);
    expect(listed.receipts).toHaveLength(1);
  });

  it('marks worktree isolation with the actual git backend and reuses no stale grant', async () => {
    await bindCoordinator();
    const { createSessionsApi } = await import('@electron/services/sessions-api');
    const sessions = createSessionsApi({ gatewayManager: gateway() as never });
    const result = await sessions.delegateCoordinator(payload({ isolation: 'worktree' }));
    expect(result.receipt.isolation).toMatchObject({
      mode: 'worktree',
      backend: 'git',
      worktreeId: 'worktree-a',
      parallelWritesAllowed: true,
      writeSetBasis: 'git-checkout',
    });

    const profile = storeState.profiles[0];
    (profile.coordinatorBinding as Record<string, unknown>).state = 'invalidated';
    (profile.coordinatorBinding as Record<string, unknown>).invalidationReason = 'archived';
    const rejected = await createSessionsApi({ gatewayManager: gateway() as never }).delegateCoordinator(payload({
      idempotencyKey: 'stale-grant-key',
    }));
    expect(rejected).toMatchObject({ success: false, receipt: { state: 'rejected' } });
    expect(rejected.error).toMatch(/Coordinator binding is invalidated/);
    expect(gatewayState.orchestratorCalls).toBe(1);
  });

  it('records rejected unknown-role and unsupported-backend attempts without child completion facts', async () => {
    await bindCoordinator();
    const { createSessionsApi } = await import('@electron/services/sessions-api');
    gatewayState.orchestratorMode = 'unknown-role';
    const unknownRole = await createSessionsApi({ gatewayManager: gateway() as never }).delegateCoordinator(payload({
      idempotencyKey: 'unknown-role-key',
      roleName: 'ghost',
    }));
    expect(unknownRole).toMatchObject({
      success: false,
      receipt: { state: 'rejected', childSessionKey: null, childRunId: null },
    });
    expect(unknownRole.error).toMatch(/unknown role/);

    gatewayState.orchestratorMode = 'accepted';
    const unsupported = await createSessionsApi({ gatewayManager: gateway() as never }).delegateCoordinator(payload({
      idempotencyKey: 'unsupported-backend-key',
      backend: 'acp',
    }));
    expect(unsupported).toMatchObject({
      success: false,
      receipt: { state: 'rejected', backend: { kind: 'unknown', evidence: 'unsupported-backend' } },
    });
  });

  it('keeps an in-flight admission recoverable and idempotent after service restart', async () => {
    await bindCoordinator();
    gatewayState.orchestratorMode = 'pending';
    const { createSessionsApi } = await import('@electron/services/sessions-api');
    const first = createSessionsApi({ gatewayManager: gateway() as never }).delegateCoordinator(payload({
      idempotencyKey: 'crash-retry-key',
    }));
    await waitFor(() => gatewayState.orchestratorCalls === 1);

    const restarted = createSessionsApi({ gatewayManager: gateway() as never });
    const retry = await restarted.delegateCoordinator(payload({ idempotencyKey: 'crash-retry-key' }));
    expect(retry).toMatchObject({
      success: true,
      duplicate: true,
      recoveryRequired: true,
      receipt: { state: 'submitting' },
    });
    expect(gatewayState.orchestratorCalls).toBe(1);

    const pendingResolve = gatewayState.pendingResolve;
    if (!pendingResolve) throw new Error('Pending orchestrator resolver missing');
    const profile = storeState.profiles[0];
    const stored = (profile.delegationReceipts as Record<string, Record<string, unknown>>)['crash-retry-key'];
    expect(stored?.state).toBe('submitting');
    gatewayState.orchestratorMode = 'accepted';
    pendingResolve({ admissionReceipts: [acceptedReceipt({ delegationAdmission: {
      receiptId: stored.receiptId,
      idempotencyKey: stored.idempotencyKey,
      requestDigest: stored.requestDigest,
      coordinator: stored.coordinator,
      taskRef: stored.taskRef,
      createdAt: stored.createdAt,
    }, workers: [{ roleName: 'implementer', task: 'Implement isolated slice', writeSet: ['src/a.ts'] }] })] });
    await expect(first).resolves.toMatchObject({ success: true, receipt: { state: 'accepted' } });
  });

  it('stops an admitted child if coordinator generation changes during spawn', async () => {
    await bindCoordinator();
    gatewayState.invalidateDuringSpawn = true;
    const { createSessionsApi } = await import('@electron/services/sessions-api');
    const result = await createSessionsApi({ gatewayManager: gateway() as never }).delegateCoordinator(payload({
      idempotencyKey: 'reset-race-key',
    }));
    expect(result).toMatchObject({ success: false, receipt: { state: 'rejected' } });
    expect(result.error).toMatch(/child stop was requested/);
    expect(gatewayState.stopCalls).toContainEqual({ key: 'agent:main:child-a' });
  });
});
