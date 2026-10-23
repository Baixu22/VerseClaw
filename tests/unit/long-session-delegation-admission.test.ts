import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  GatewayRpcPayload,
  WorkspaceCoordinatorBindingResult,
} from '@shared/host-api/contract';
import {
  SESSION_DELEGATION_RECEIPT_SCHEMA,
  type SessionDelegationAdmission,
  type SessionDelegationBudget,
  type SessionDelegationPayload,
  type SessionDelegationReceipt,
} from '@shared/types/session-delegation';
import type { WorkspaceCoordinatorBinding } from '@shared/types/workspace';
import {
  executeSessionDelegation,
  hashDelegationRequest,
  type DelegationClaimResult,
  type SessionDelegationDependencies,
  type StoredSessionDelegationAdmission,
} from '../../electron/services/session-delegation-admission';
import { createSessionsApi } from '../../electron/services/sessions-api';
import { buildDelegationReceipt } from '../../openclaw_runtime/src/agents/delegation-admission';
import { spawnRoleSubagent, type RoleSpawnContext, type RoleSpawnParams } from '../../openclaw_runtime/src/agents/role-spawn';
import { createWorktreeService } from '../../openclaw_runtime/src/agents/worktree-service';
import type { RoleContract } from '../../openclaw_runtime/src/agents/role-contract';

const WORKSPACE_ID = 'workspace-main';
const SESSION_KEY = 'agent:main:long-session';
const SESSION_GENERATION = 'generation-1';
const TASK_REF = 'task-ref-1';
const ROOT = 'D:\\tmp\\clawx-long-session-checkout';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function binding(overrides: Partial<WorkspaceCoordinatorBinding> = {}): WorkspaceCoordinatorBinding {
  return {
    schemaVersion: 1,
    workspaceId: WORKSPACE_ID,
    agentId: 'main',
    sessionKey: SESSION_KEY,
    sessionGeneration: SESSION_GENERATION,
    taskLedgerReferences: [{
      direction: 'workboard-to-task-ledger',
      taskLedgerNodeId: TASK_REF,
      source: 'runtime',
    }],
    environment: {
      kind: 'local',
      canonicalRoot: ROOT,
      backend: 'local-workspace',
      branch: 'main',
      detachedHead: false,
      setupProfile: null,
    },
    archiveRestorePolicy: 'restore',
    state: 'active',
    bindingRevision: 3,
    invalidationReason: null,
    createdAt: '2026-10-24T00:00:00.000Z',
    updatedAt: '2026-10-24T00:00:00.000Z',
    ...overrides,
  };
}

function bindingResult(value = binding()): WorkspaceCoordinatorBindingResult {
  return {
    success: true,
    binding: value,
    recovery: {
      state: 'ready',
      reason: null,
      bindingRevision: value.bindingRevision,
    },
  };
}

function payload(overrides: Partial<SessionDelegationPayload> = {}): SessionDelegationPayload {
  return {
    sessionKey: SESSION_KEY,
    workspaceId: WORKSPACE_ID,
    agentId: 'main',
    taskRef: TASK_REF,
    task: 'Implement the admitted worker task',
    expectedBindingRevision: 3,
    expectedSessionGeneration: SESSION_GENERATION,
    idempotencyKey: 'delegate-0001',
    backend: 'subagent',
    worker: {
      roleName: 'implementer',
      task: 'Change src/a.ts only',
      isolation: 'shared',
      writeSet: ['src/a.ts'],
    },
    ...overrides,
  };
}

function budget(): SessionDelegationBudget {
  return {
    status: 'observed',
    reason: null,
    maxWorkers: 1,
    process: {
      maxChildrenPerAgent: 5,
      maxSpawnDepth: 1,
      source: 'agents.defaults.subagents',
    },
    backgroundTerminal: {
      lane: 'subagent',
      maxConcurrent: 1,
      activeCount: 0,
      queuedCount: 0,
      source: 'process.command-queue.subagent',
    },
  };
}

function runtimeReceipt(
  admission: SessionDelegationAdmission,
  options: { childRunId?: string | null; childSessionKey?: string | null; isolationBackend?: 'shared-inprocess' | 'git-worktree' } = {},
): SessionDelegationReceipt {
  const childRunId = options.childRunId === undefined ? 'run-child-1' : options.childRunId;
  const childSessionKey = options.childSessionKey === undefined ? 'agent:main:subagent:child-1' : options.childSessionKey;
  const accepted = Boolean(childRunId && childSessionKey);
  return {
    schemaVersion: SESSION_DELEGATION_RECEIPT_SCHEMA,
    admissionId: admission.admissionId,
    idempotencyKey: admission.idempotencyKey,
    status: accepted ? 'accepted' : 'rejected',
    orchestrationRunId: 'orch-long-session-1',
    acceptedAt: '2026-10-24T00:00:01.000Z',
    coordinator: admission.coordinator,
    taskRef: admission.taskRef,
    parentEnvironment: admission.parentEnvironment,
    parentEnvironmentRevision: admission.coordinator.bindingRevision,
    authorization: { approvalId: null, grantState: 'authorized', owner: 'gateway-permission' },
    budget: budget(),
    scheduler: {
      executionWaves: [{ wave: 1, taskNodeIds: ['node-1'], roles: ['implementer'], reason: 'scheduled 1 ready node' }],
      metrics: { queued: 1, running: 0, scheduled: 1, skipped: 0, concurrencyCap: 1, budgetEstimate: 2 },
    },
    children: [{
      roleName: 'implementer',
      taskNodeId: 'node-1',
      roleInstanceId: 'role-instance-1',
      admissionStatus: accepted ? 'accepted' : 'rejected',
      runState: accepted ? 'accepted-not-completed' : 'not-accepted',
      completionObserved: false,
      backend: 'subagent',
      childSessionKey,
      childRunId,
      toolAuthorization: {
        status: 'effective',
        source: 'role-contract+parent-clamp',
        roleName: 'implementer',
        effectiveRoleName: 'implementer',
        parentRoleName: 'reviewer',
        allowlist: ['read'],
        denylist: [],
      },
      isolation: {
        mode: options.isolationBackend === 'git-worktree' ? 'worktree' : 'shared',
        backend: options.isolationBackend ?? 'shared-inprocess',
        canonicalRoot: options.isolationBackend === 'git-worktree' ? `${ROOT}\\.openclaw\\worktrees\\wt-1` : ROOT,
        branch: options.isolationBackend === 'git-worktree' ? null : 'main',
        detachedHead: options.isolationBackend === 'git-worktree' ? true : false,
        verifiedCheckout: options.isolationBackend === 'git-worktree',
      },
      schedulerWave: 1,
      error: accepted ? null : 'spawn accepted without child identity',
    }],
    errors: accepted ? [] : ['child identity missing'],
    completionObserved: false,
    recoveryRequired: false,
  };
}

function memoryStore(initial: StoredSessionDelegationAdmission[] = []) {
  const records = new Map(initial.map((record) => [record.idempotencyKey, record]));
  return {
    records,
    readAdmission: async (key: string) => records.get(key) ?? null,
    claimAdmission: async (candidate: StoredSessionDelegationAdmission): Promise<DelegationClaimResult> => {
      const existing = records.get(candidate.idempotencyKey);
      if (!existing) {
        records.set(candidate.idempotencyKey, candidate);
        return { kind: 'claimed' };
      }
      if (existing.requestHash !== candidate.requestHash) {
        return { kind: 'conflict', existingRequestHash: existing.requestHash };
      }
      if (existing.phase === 'approval-pending') {
        records.set(candidate.idempotencyKey, { ...candidate, createdAt: existing.createdAt });
        return { kind: 'claimed' };
      }
      return { kind: 'existing', record: existing };
    },
    commitAdmission: async (record: StoredSessionDelegationAdmission) => {
      const existing = records.get(record.idempotencyKey);
      records.set(record.idempotencyKey, { ...record, createdAt: existing?.createdAt ?? record.createdAt });
    },
  };
}

function dependencies(store = memoryStore(), overrides: Partial<SessionDelegationDependencies> = {}): SessionDelegationDependencies {
  const generation = SESSION_GENERATION;
  return {
    readAdmission: store.readAdmission,
    claimAdmission: store.claimAdmission,
    commitAdmission: store.commitAdmission,
    resolveCoordinator: async () => bindingResult(),
    getActiveWorkspaceId: async () => WORKSPACE_ID,
    gatewayRpc: async () => {
      throw new Error('unexpected gateway call');
    },
    describeSessionGeneration: async () => generation,
    stopEpoch: () => 0,
    now: () => new Date('2026-10-24T00:00:00.000Z'),
    ...overrides,
    // Let tests override the generation reader without sharing mutable implementation details.
    ...(overrides.describeSessionGeneration ? {} : {
      describeSessionGeneration: async () => generation,
    }),
  };
}

function acceptedGatewayRpc(counter = vi.fn()) {
  const rpc = vi.fn(async (request: GatewayRpcPayload) => {
    counter();
    const params = request.params as { delegationAdmission: SessionDelegationAdmission };
    return { delegationReceipt: runtimeReceipt(params.delegationAdmission) };
  });
  return rpc;
}

describe('long-session delegation admission', () => {
  it('binds accepted children to coordinator, task, backend, permissions, and actual shared isolation without claiming completion', async () => {
    const rpc = acceptedGatewayRpc();
    const store = memoryStore();
    const result = await executeSessionDelegation(payload(), dependencies(store, { gatewayRpc: rpc }));
    expect(result.success).toBe(true);
    expect(result.status).toBe('accepted');
    expect(result.receipt).toMatchObject({
      coordinator: { bindingRevision: 3, sessionGeneration: SESSION_GENERATION },
      taskRef: TASK_REF,
      parentEnvironmentRevision: 3,
      completionObserved: false,
      children: [{
        backend: 'subagent',
        runState: 'accepted-not-completed',
        completionObserved: false,
        childRunId: 'run-child-1',
        childSessionKey: 'agent:main:subagent:child-1',
        isolation: { backend: 'shared-inprocess', canonicalRoot: ROOT },
        toolAuthorization: { allowlist: ['read'] },
      }],
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(store.records.get('delegate-0001')?.phase).toBe('terminal');
  });

  it('replays a terminal receipt after owner restart without issuing another spawn', async () => {
    const store = memoryStore();
    const firstRpc = acceptedGatewayRpc();
    const first = await executeSessionDelegation(payload(), dependencies(store, { gatewayRpc: firstRpc }));
    const restartedRpc = acceptedGatewayRpc();
    const restarted = await executeSessionDelegation(payload(), dependencies(store, { gatewayRpc: restartedRpc }));
    expect(first.replayed).not.toBe(true);
    expect(restarted).toMatchObject({ success: true, replayed: true, status: 'accepted' });
    expect(restarted.receipt?.orchestrationRunId).toBe(first.receipt?.orchestrationRunId);
    expect(restartedRpc).not.toHaveBeenCalled();
  });

  it('coalesces a concurrent duplicate submission into one Gateway admission', async () => {
    const store = memoryStore();
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const gateway = vi.fn(async (request: GatewayRpcPayload) => {
      await waiting;
      const params = request.params as { delegationAdmission: SessionDelegationAdmission };
      return { delegationReceipt: runtimeReceipt(params.delegationAdmission) };
    });
    const api = createSessionsApi({
      gatewayManager: { rpc: vi.fn(async () => ({ session: { sessionId: SESSION_GENERATION } })) } as never,
      resolveCoordinator: async () => bindingResult(),
      getActiveWorkspaceId: async () => WORKSPACE_ID,
      gatewayRpcForDelegation: gateway,
      delegationStore: store,
    });
    const first = api.delegate(payload());
    const second = api.delegate(payload());
    release();
    const results = await Promise.all([first, second]);
    expect(results.map((entry) => entry.status)).toEqual(['accepted', 'accepted']);
    expect(gateway).toHaveBeenCalledTimes(1);
  });

  it('turns an in-flight record left by a terminated owner into outcome-unknown without retrying', async () => {
    const store = memoryStore();
    const request = payload();
    const admission: SessionDelegationAdmission = {
      schemaVersion: 'clawx.session-delegation-admission/v1',
      admissionId: 'admission-crashed',
      idempotencyKey: request.idempotencyKey,
      coordinator: {
        workspaceId: WORKSPACE_ID,
        agentId: 'main',
        sessionKey: SESSION_KEY,
        bindingRevision: 3,
        sessionGeneration: SESSION_GENERATION,
      },
      taskRef: TASK_REF,
      parentEnvironment: binding().environment,
    };
    const pending = {
      ...runtimeReceipt(admission),
      status: 'in-flight' as const,
      orchestrationRunId: null,
      acceptedAt: null,
      scheduler: null,
      children: [],
      errors: [],
    };
    store.records.set(request.idempotencyKey, {
      schemaVersion: 'clawx.session-delegation-store/v1',
      idempotencyKey: request.idempotencyKey,
      requestHash: hashDelegationRequest(request),
      phase: 'in-flight',
      receipt: pending,
      createdAt: '2026-10-24T00:00:00.000Z',
      updatedAt: '2026-10-24T00:00:00.000Z',
    });
    const rpc = acceptedGatewayRpc();
    const result = await executeSessionDelegation(request, dependencies(store, { gatewayRpc: rpc }));
    expect(result.status).toBe('outcome-unknown');
    expect(result.receipt?.recoveryRequired).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects a parent reset that crosses admission without reporting an accepted worker', async () => {
    const generation = vi.fn()
      .mockResolvedValueOnce(SESSION_GENERATION)
      .mockResolvedValueOnce('generation-2');
    const rpc = acceptedGatewayRpc();
    const result = await executeSessionDelegation(payload(), dependencies(memoryStore(), {
      gatewayRpc: rpc,
      describeSessionGeneration: generation,
    }));
    expect(result.status).toBe('outcome-unknown');
    expect(result.receipt?.recoveryRequired).toBe(true);
    expect(result.receipt?.errors).toContain('Parent session generation changed during admission');
  });

  it('rejects a concurrent stop and never upgrades the stale accepted evidence', async () => {
    const store = memoryStore();
    const gateway = vi.fn(async (request: GatewayRpcPayload) => {
      const params = request.params as { delegationAdmission: SessionDelegationAdmission };
      await api.stop({ sessionKey: SESSION_KEY });
      return { delegationReceipt: runtimeReceipt(params.delegationAdmission) };
    });
    const gatewayManagerRpc = vi.fn(async (method: string) => {
      if (method === 'sessions.describe') return { session: { sessionId: SESSION_GENERATION } };
      if (method === 'sessions.stop') return { ok: true, key: SESSION_KEY };
      throw new Error(`unexpected rpc ${method}`);
    });
    const api = createSessionsApi({
      gatewayManager: { rpc: gatewayManagerRpc } as never,
      resolveCoordinator: async () => bindingResult(),
      getActiveWorkspaceId: async () => WORKSPACE_ID,
      gatewayRpcForDelegation: gateway,
      delegationStore: store,
    });
    const result = await api.delegate(payload({ idempotencyKey: 'delegate-stop-race' }));
    expect(result.status).toBe('outcome-unknown');
    expect(result.receipt?.recoveryRequired).toBe(true);
    expect(result.receipt?.errors).toContain('Parent session stop raced with admission');
  });

  it('does not reuse an expired or revoked grant and allows retry only through a fresh owner-approved id', async () => {
    const store = memoryStore();
    const gateway = vi.fn(async (request: GatewayRpcPayload) => {
      if (request.approvalId !== 'approval-active') {
        return {
          success: false,
          approvalRequired: true,
          approval: { id: 'approval-fresh' },
          error: 'approval expired or revoked',
        };
      }
      const params = request.params as { delegationAdmission: SessionDelegationAdmission };
      return { delegationReceipt: runtimeReceipt(params.delegationAdmission) };
    });
    const first = await executeSessionDelegation(payload({ approvalId: 'approval-expired' }), dependencies(store, { gatewayRpc: gateway }));
    expect(first.status).toBe('approval-pending');
    expect(first.receipt?.children).toHaveLength(0);
    const retried = await executeSessionDelegation(payload({ approvalId: 'approval-active' }), dependencies(store, { gatewayRpc: gateway }));
    expect(retried.status).toBe('accepted');
    expect(gateway).toHaveBeenCalledTimes(2);
    expect(gateway.mock.calls[0]?.[0].approvalId).toBe('approval-expired');
    expect(gateway.mock.calls[1]?.[0].approvalId).toBe('approval-active');
    const firstAdmission = (gateway.mock.calls[0]?.[0].params as { delegationAdmission: { admissionId: string } }).delegationAdmission.admissionId;
    const secondAdmission = (gateway.mock.calls[1]?.[0].params as { delegationAdmission: { admissionId: string } }).delegationAdmission.admissionId;
    expect(secondAdmission).toBe(firstAdmission);
  });

  it('clamps child tool authorization to the parent allowlist', async () => {
    const parent = role('reviewer', ['read']);
    const child = role('implementer', ['read', 'write']);
    const spawn = vi.fn(async (_params: RoleSpawnParams, _ctx: RoleSpawnContext) => ({
      status: 'accepted' as const,
      runId: 'run-child-1',
      childSessionKey: 'agent:main:subagent:child-1',
    }));
    const result = await spawnRoleSubagent(
      { role: child, task: 'write a file' },
      { agentSessionKey: SESSION_KEY, workspaceDir: ROOT, inheritedToolAllowlist: ['read'], parentRole: parent },
      { spawn },
    );
    expect(spawn.mock.calls[0]?.[1].inheritedToolAllowlist).toEqual(['read']);
    expect(result.authorization).toMatchObject({
      roleName: 'implementer',
      effectiveRoleName: 'implementer',
      parentRoleName: 'reviewer',
      allowlist: ['read'],
      source: 'role-contract+parent-clamp',
    });
  });

  it('marks an accepted spawn without both child session and run identifiers as rejected', async () => {
    const admission: SessionDelegationAdmission = {
      schemaVersion: 'clawx.session-delegation-admission/v1',
      admissionId: 'admission-missing-child',
      idempotencyKey: 'delegate-missing-child',
      coordinator: {
        workspaceId: WORKSPACE_ID,
        agentId: 'main',
        sessionKey: SESSION_KEY,
        bindingRevision: 3,
        sessionGeneration: SESSION_GENERATION,
      },
      taskRef: TASK_REF,
      parentEnvironment: binding().environment,
    };
    const result = {
      outcomes: [{
        roleName: 'implementer',
        task: 'do work',
        isVerifier: false,
        ledger: {
          taskId: 'task-1',
          taskNodeId: 'node-1',
          roleInstanceId: 'role-instance-1',
          executionWave: 1,
        },
        spawn: {
          status: 'accepted',
          result: { status: 'accepted', runId: 'run-without-session' },
          role: role('implementer', ['read']),
        },
      }],
      failures: [],
      executionWaves: [],
      schedulerMetrics: { queued: 1, running: 0, completed: 1, skipped: 0, concurrencyCap: 1, budgetEstimate: 1 },
      taskGraph: { nodes: [{ taskNodeId: 'node-1' }] },
    } as never;
    const receipt = buildDelegationReceipt({
      admission,
      orchestrationRunId: 'orch-missing-child',
      result,
      maxWorkers: 1,
    });
    expect(receipt.status).toBe('rejected');
    expect(receipt.children[0]).toMatchObject({
      admissionStatus: 'rejected',
      runState: 'not-accepted',
      completionObserved: false,
    });
  });

  it('records a refused spawn as rejected with no completion evidence', () => {
    const admission: SessionDelegationAdmission = {
      schemaVersion: 'clawx.session-delegation-admission/v1',
      admissionId: 'admission-forbidden',
      idempotencyKey: 'delegate-forbidden',
      coordinator: {
        workspaceId: WORKSPACE_ID,
        agentId: 'main',
        sessionKey: SESSION_KEY,
        bindingRevision: 3,
        sessionGeneration: SESSION_GENERATION,
      },
      taskRef: TASK_REF,
      parentEnvironment: binding().environment,
    };
    const result = {
      outcomes: [{
        roleName: 'implementer',
        task: 'do work',
        isVerifier: false,
        ledger: { taskId: 'task-1', taskNodeId: 'node-1', roleInstanceId: 'role-instance-1', executionWave: 1 },
        spawn: { status: 'forbidden', error: 'tool policy refused launch', role: role('implementer', ['read']) },
      }],
      failures: [{ roleName: 'implementer', status: 'forbidden', error: 'tool policy refused launch' }],
      executionWaves: [],
      schedulerMetrics: { queued: 1, running: 0, completed: 1, skipped: 0, concurrencyCap: 1, budgetEstimate: 1 },
      taskGraph: { nodes: [{ taskNodeId: 'node-1' }] },
    } as never;
    const receipt = buildDelegationReceipt({
      admission,
      orchestrationRunId: 'orch-forbidden',
      result,
      maxWorkers: 1,
    });
    expect(receipt).toMatchObject({
      status: 'rejected',
      completionObserved: false,
      children: [{
        admissionStatus: 'rejected',
        runState: 'not-accepted',
        childSessionKey: null,
        childRunId: null,
        completionObserved: false,
      }],
    });
  });it('records a real Git worktree as verified checkout isolation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'clawx-delegation-git-'));
    temporaryRoots.push(root);
    execFileSync('git', ['init', '-q'], { cwd: root });
    execFileSync('git', ['config', 'user.email', 'agent@example.invalid'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'Agent'], { cwd: root });
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'src', 'a.ts'), 'export const value = 1;\n');
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['commit', '-qm', 'seed'], { cwd: root });
    const service = createWorktreeService(root, { backend: 'git' });
    const record = service.create('receipt-git-checkout', { writeSet: ['src/a.ts'] });
    expect(record.backend).toBe('git');
    expect(record.root).toBeTruthy();
    expect(record.gitBranch).toBeTruthy();
    service.cleanup(record.id);
  });
});

function role(name: string, tools: string[]): RoleContract {
  return {
    name,
    displayName: name,
    rolePrompt: `${name} role`,
    tools,
    capabilities: ['task-analysis'],
    toolRequirements: tools,
    riskProfile: 'medium',
    canModifyScope: false,
    permissions: { filesystem: tools.includes('write') ? 'write' : 'read', network: 'none', commands: [] },
    model: { default: null, fallback: [] },
    effort: 'medium',
    outputSchema: { format: 'markdown' },
    handoff: { to: [], from: [] },
    tags: [],
  };
}