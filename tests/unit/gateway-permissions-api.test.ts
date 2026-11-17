import { beforeEach, describe, expect, it, vi } from 'vitest';

import { setSandboxHighRiskPolicyLoader } from '@electron/utils/sandbox-high-risk-gate';

import type { WorkspaceProfile } from '@shared/types/workspace';

const storeState = vi.hoisted(() => ({
  approvals: [] as unknown[],
  decisionEvents: [] as unknown[],
}));

const activeWorkspace = vi.hoisted(() => ({
  profile: null as WorkspaceProfile | null,
}));

vi.mock('@electron/services/permissions-api', async () => {
  const { permissionsApiTestDouble } = await import('../helpers/permissions-api-test-double');
  return permissionsApiTestDouble.module();
});

vi.mock('../../electron/services/permissions-api', async () => {
  const { permissionsApiTestDouble } = await import('../helpers/permissions-api-test-double');
  return permissionsApiTestDouble.module();
});

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => process.cwd()),
  },
  nativeImage: {
    createFromPath: vi.fn(() => ({
      isEmpty: () => true,
      getSize: () => ({ width: 0, height: 0 }),
    })),
  },
}));

vi.mock('electron-store', () => {
  class MockStore {
    constructor(options?: { defaults?: { approvals?: unknown[]; decisionEvents?: unknown[] } }) {
      if (storeState.approvals.length === 0 && options?.defaults?.approvals) {
        storeState.approvals = [...options.defaults.approvals];
      }
      if (storeState.decisionEvents.length === 0 && options?.defaults?.decisionEvents) {
        storeState.decisionEvents = [...options.defaults.decisionEvents];
      }
    }

    get(key: string) {
      if (key === 'approvals') return storeState.approvals;
      if (key === 'decisionEvents') return storeState.decisionEvents;
      return undefined;
    }

    set(key: string, value: unknown) {
      if (key === 'approvals') {
        storeState.approvals = Array.isArray(value) ? [...value] : [];
      }
      if (key === 'decisionEvents') {
        storeState.decisionEvents = Array.isArray(value) ? [...value] : [];
      }
    }
  }

  return { default: MockStore };
});

vi.mock('@electron/services/workspaces-api', () => ({
  getActiveWorkspaceProfile: vi.fn(async () => activeWorkspace.profile),
}));

vi.mock('../../electron/services/workspaces-api', () => ({
  getActiveWorkspaceProfile: vi.fn(async () => activeWorkspace.profile),
}));

vi.mock('@electron/utils/store', () => ({
  getSetting: vi.fn(async () => 'token'),
}));

vi.mock('@electron/utils/control-ui-device-pairing', () => ({
  scheduleControlUiDeviceAutoApproval: vi.fn(),
}));

vi.mock('@electron/utils/active-sandbox-high-risk-policy', () => ({
  getActiveSandboxHighRiskPolicy: vi.fn(async () => ({
    degraded: false,
    requestedProviderId: 'policy-light',
    effectiveProviderId: 'policy-light',
    runtimeLevel: 'policy',
  })),
}));

function workspace(permissionMode: WorkspaceProfile['permissionMode'] = 'acceptEdits'): WorkspaceProfile {
  return {
    id: 'workspace-1',
    name: 'Project',
    rootPath: process.cwd(),
    agentId: 'main',
    activeSessionKey: 'agent:main:main',
    permissionMode,
    createdAt: 1,
    updatedAt: 1,
    lastOpenedAt: 1,
    state: {},
  };
}

describe('gateway permission approval flow', () => {
  it.each(['memory.readSource', 'sekb.readSource', 'sekb.retrieve', 'sekb.recordExposure'])('rejects %s owner bridge before renderer RPC dispatch', async method => {
    activeWorkspace.profile = workspace('fullAccess');
    const gatewayManager = { getStatus: vi.fn(() => ({ state: 'running' })), rpc: vi.fn(async () => ({})) };
    const backpressure = { run: vi.fn((method, params, timeoutMs, run) => run(method, params, timeoutMs)) };
    const { createGatewayApi } = await import('../../electron/services/gateway-api');
    const api = createGatewayApi(gatewayManager as never, backpressure as never);
    const result = await api.rpc({ method, params: { readIdentity: { workspaceId: 'forged' }, sourceRef: {} } });
    expect(result).toMatchObject({ success: false, rejectedBeforeDispatch: true });
    expect(gatewayManager.rpc).not.toHaveBeenCalled();
    expect(backpressure.run).not.toHaveBeenCalled();
  });
  it('binds chat workspace identity to the Main owner and refuses forged scopes', async () => {
    activeWorkspace.profile = workspace('fullAccess');
    const gatewayManager = { getStatus: vi.fn(() => ({ state: 'running' })), rpc: vi.fn(async () => ({ runId: 'bounded-run' })) };
    const backpressure = { run: vi.fn((method, params, timeoutMs, run) => run(method, params, timeoutMs)) };
    const { createGatewayApi } = await import('../../electron/services/gateway-api');
    const api = createGatewayApi(gatewayManager as never, backpressure as never);
    await api.rpc({ method: 'chat.send', params: { sessionKey: 'agent:main:main', message: 'trusted budget scope', idempotencyKey: 'one' } });
    expect(gatewayManager.rpc).toHaveBeenCalledWith('chat.send', expect.objectContaining({ workspaceId: 'workspace-1' }), undefined);
    gatewayManager.rpc.mockClear();
    await expect(api.rpc({ method: 'chat.send', params: { workspaceId: 'forged-project', sessionKey: 'agent:main:main', message: 'scope bypass', idempotencyKey: 'two' } }))
      .rejects.toThrow(/workspace.*scope|scope.*workspace/i);
    expect(gatewayManager.rpc).not.toHaveBeenCalled();
  });

  it('rejects verification for a workspace whose permissions were not evaluated', async () => {
    activeWorkspace.profile = workspace('fullAccess');
    const gatewayManager = { getStatus: vi.fn(() => ({ state: 'running' })), rpc: vi.fn(async () => ({})) };
    const backpressure = { run: vi.fn((method, params, timeoutMs, run) => run(method, params, timeoutMs)) };
    const { createGatewayApi } = await import('../../electron/services/gateway-api');
    const api = createGatewayApi(gatewayManager as never, backpressure as never);
    await expect(api.rpc({ method: 'task_loop.verifyCompletion', params: {
      workspaceId: 'another-readonly-workspace', sessionKey: 'agent:main:other', checkpointId: 'checkpoint', checkId: 'check', verificationRunId: 'persistent-check',
    } })).rejects.toThrow('scope differs');
    expect(gatewayManager.rpc).not.toHaveBeenCalled();
  });
  it('refuses verification when its persisted physical root differs from Main', async () => {
    activeWorkspace.profile = workspace('fullAccess');
    const gatewayManager = { getStatus: vi.fn(() => ({ state: 'running' })),
      rpc: vi.fn(async () => ({ workspaceRoot: process.env.SystemRoot ?? '/', checkpoint: { owner: 'task-loop' } })) };
    const backpressure = { run: vi.fn((method, params, timeoutMs, run) => run(method, params, timeoutMs)) };
    const { createGatewayApi } = await import('../../electron/services/gateway-api');
    const api = createGatewayApi(gatewayManager as never, backpressure as never);
    await expect(api.rpc({ method: 'task_loop.verifyCompletion', params: {
      workspaceId: 'workspace-1', sessionKey: 'agent:main:main', checkpointId: 'checkpoint', checkId: 'check', verificationRunId: 'check',
    } })).rejects.toThrow('physical workspace');
    expect(gatewayManager.rpc).toHaveBeenCalledTimes(1);
    expect(gatewayManager.rpc).toHaveBeenCalledWith('task_loop.completionEvidence', expect.anything(), 20_000);
  });
  beforeEach(async () => {
    setSandboxHighRiskPolicyLoader(async () => ({
      degraded: false,
      requestedProviderId: 'policy-light',
      effectiveProviderId: 'policy-light',
      runtimeLevel: 'policy',
    }));
    storeState.approvals = [];
    storeState.decisionEvents = [];
    const { permissionsApiTestDouble } = await import('../helpers/permissions-api-test-double');
    permissionsApiTestDouble.reset();
    activeWorkspace.profile = workspace();
  });

  it('requires approval for dangerous gateway RPC and consumes approval before replay', async () => {
    const gatewayManager = {
      getStatus: vi.fn(() => ({ state: 'running', port: 18789 })),
      rpc: vi.fn(async () => ({ ok: true })),
    };
    const backpressure = {
      run: vi.fn((method, params, timeoutMs, run) => run(method, params, timeoutMs)),
    };
    const { createPermissionsApi, listPermissionDecisionEvents } = await import('../../electron/services/permissions-api');
    const { createGatewayApi } = await import('../../electron/services/gateway-api');
    const api = createGatewayApi(gatewayManager as never, backpressure as never);
    const permissions = createPermissionsApi();

    const first = await api.rpc({
      method: 'tools.exec',
      params: { command: 'git clean -fd' },
    }) as { approval?: { id: string }; approvalRequired?: boolean; sandboxDenial?: unknown };
    expect(first).toMatchObject({
      success: false,
      blocked: true,
      approvalRequired: true,
    });
    expect(first.sandboxDenial).toBeUndefined();
    expect(gatewayManager.rpc).not.toHaveBeenCalled();

    const approvalId = first.approval?.id;
    expect(approvalId).toBeTruthy();
    await permissions.decideApproval({ id: approvalId, decision: 'approved' } as never);

    await expect(api.rpc({
      method: 'tools.exec',
      params: { command: 'git clean -fd' },
      approvalId,
    })).resolves.toEqual({ ok: true });
    expect(gatewayManager.rpc).toHaveBeenCalledWith('tools.exec', { command: 'git clean -fd' }, undefined);
    await expect(listPermissionDecisionEvents(10)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'permission-decision',
        workspaceMode: 'acceptEdits',
        tool: 'tools.exec',
        boundary: 'gateway-rpc',
        decision: 'approval-required',
      }),
    ]));

    await expect(api.rpc({
      method: 'tools.exec',
      params: { command: 'git clean -fd' },
      approvalId,
    })).resolves.toMatchObject({
      success: false,
      approvalRequired: true,
    });
  });

  it('does not allow an approved gateway request to be reused for different params', async () => {
    const gatewayManager = {
      getStatus: vi.fn(() => ({ state: 'running', port: 18789 })),
      rpc: vi.fn(async () => ({ ok: true })),
    };
    const backpressure = {
      run: vi.fn((method, params, timeoutMs, run) => run(method, params, timeoutMs)),
    };
    const { createPermissionsApi } = await import('../../electron/services/permissions-api');
    const { createGatewayApi } = await import('../../electron/services/gateway-api');
    const api = createGatewayApi(gatewayManager as never, backpressure as never);
    const permissions = createPermissionsApi();

    const first = await api.rpc({
      method: 'tools.exec',
      params: { command: 'git clean -fd' },
    }) as { approval?: { id: string } };
    const approvalId = first.approval?.id;
    await permissions.decideApproval({ id: approvalId, decision: 'approved' } as never);

    await expect(api.rpc({
      method: 'tools.exec',
      params: { command: 'git reset --hard' },
      approvalId,
    })).resolves.toMatchObject({
      success: false,
      approvalRequired: true,
    });
    expect(gatewayManager.rpc).not.toHaveBeenCalled();
  });

  it('captures mission knowledge draft candidates into Knowledge Inbox without changing the RPC result', async () => {
    activeWorkspace.profile = null;
    const missionResult = {
      missionId: 'mission-knowledge-1',
      sessionKey: 'agent:main:main',
      agentId: 'main',
      workspaceId: 'workspace-1',
      objective: 'Ship reusable Mission knowledge',
      acceptance: ['tests pass'],
      status: 'complete',
      phase: 'complete',
      tick: 1,
      repairTicks: 0,
      maxTicks: 3,
      maxRepairTicks: 1,
      progress: 100,
      lastDecision: 'complete',
      evidenceRefs: [{ type: 'trace', ref: 'trace-loop', label: 'Mission trace' }],
      risks: [],
      remaining: [],
      createdAt: 1,
      updatedAt: 2,
      ticks: [{
        tick: 1,
        phase: 'complete',
        status: 'complete',
        decision: 'complete',
        traceId: 'trace-loop',
        evidenceRefs: [
          { type: 'trace', ref: 'trace-loop', label: 'Mission trace' },
          { type: 'task_ledger', ref: 'ledger-root', label: 'Task Ledger root' },
        ],
        reviewer: {
          decision: 'complete',
          confidence: 0.91,
          reason: 'complete reason',
          missingEvidence: [],
          verificationGaps: [],
          risks: [],
          validationState: { status: 'passed', checks: ['unit tests'], evidenceRefs: ['trace-loop'] },
          memoryCandidates: [{
            kind: 'knowledge_draft',
            summary: 'Workflow lesson: save Mission evidence through Knowledge Inbox first.',
            evidenceRefs: ['trace-loop', 'ledger-root'],
          }, {
            kind: 'role_memory',
            summary: 'Role memory remains separate.',
            evidenceRefs: ['trace-loop'],
          }],
          checkpointSummary: 'complete summary',
        },
        createdAt: 1,
        updatedAt: 2,
      }],
    };
    const gatewayManager = {
      getStatus: vi.fn(() => ({ state: 'running', port: 18789 })),
      rpc: vi.fn(async () => ({ mission: missionResult })),
    };
    const backpressure = {
      run: vi.fn((method, params, timeoutMs, run) => run(method, params, timeoutMs)),
    };
    const createKnowledgeInboxItem = vi.fn(async () => ({ success: true }));
    const { createGatewayApi } = await import('../../electron/services/gateway-api');
    const api = createGatewayApi(gatewayManager as never, backpressure as never, { createKnowledgeInboxItem: createKnowledgeInboxItem as never });

    await expect(api.rpc({
      method: 'mission.tick',
      params: { missionId: 'mission-knowledge-1' },
    })).resolves.toEqual({ mission: missionResult });

    expect(createKnowledgeInboxItem).toHaveBeenCalledTimes(1);
    expect(createKnowledgeInboxItem).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Workflow lesson: save Mission evidence through Knowledge Inbox first.',
      body: 'Workflow lesson: save Mission evidence through Knowledge Inbox first.',
      kind: 'task-ledger',
      type: 'procedure',
      createdBy: 'agent',
      sourceRefs: expect.arrayContaining([
        expect.objectContaining({ id: 'trace:trace-loop', kind: 'trace', label: 'Mission trace' }),
        expect.objectContaining({ id: 'ledger-root', kind: 'task_ledger', label: 'Task Ledger root' }),
      ]),
      metadata: expect.objectContaining({
        mvpVersion: 'knowledge-interaction-mvp-1',
        recommendation: 'save',
        missionId: 'mission-knowledge-1',
        tick: 1,
        outcome: 'complete',
        evidenceRefs: expect.arrayContaining(['trace:trace-loop', 'ledger-root']),
        captureKey: expect.stringMatching(/^mission:mission-knowledge-1:tick:1:knowledge:[a-f0-9]{16}$/),
      }),
    }));
    expect(gatewayManager.rpc).toHaveBeenCalledWith('mission.tick', { missionId: 'mission-knowledge-1' }, undefined);
    expect(gatewayManager.rpc).not.toHaveBeenCalledWith('wiki.apply', expect.anything(), expect.anything());
  });


  it('returns structured sandbox denial details for a fail-closed gateway action', async () => {
    activeWorkspace.profile = workspace('fullAccess');
    const gatewayManager = {
      getStatus: vi.fn(() => ({ state: 'running', port: 18789 })),
      rpc: vi.fn(async () => ({ ok: true })),
    };
    const backpressure = {
      run: vi.fn((method, params, timeoutMs, run) => run(method, params, timeoutMs)),
    };
    setSandboxHighRiskPolicyLoader(async () => ({
      degraded: true,
      strengthRequired: true,
      requestedProviderId: 'docker-strong',
      effectiveProviderId: 'policy-light',
      runtimeLevel: 'policy',
      degradeReason: 'Docker strong sandbox is unavailable.',
    }));
    const { createGatewayApi } = await import('@electron/services/gateway-api');
    const api = createGatewayApi(gatewayManager as never, backpressure as never);

    await expect(api.rpc({
      method: 'tools.exec',
      params: { command: 'git clean -fd' },
    })).resolves.toMatchObject({
      success: false,
      blocked: true,
      sandboxDenial: {
        code: 'SANDBOX_DENIED',
        category: 'sandbox-denial',
        mechanism: 'sandbox-gate',
        operation: 'exec',
        requestedProviderId: 'docker-strong',
        effectiveProviderId: 'policy-light',
        runtimeLevel: 'policy',
      },
    });
    expect(gatewayManager.rpc).not.toHaveBeenCalled();
  });

});
