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

vi.mock('@electron/utils/store', () => ({
  getSetting: vi.fn(async () => 'token'),
}));

vi.mock('@electron/utils/control-ui-device-pairing', () => ({
  scheduleControlUiDeviceAutoApproval: vi.fn(),
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
  beforeEach(() => {
    setSandboxHighRiskPolicyLoader(async () => ({
      degraded: false,
      requestedProviderId: 'policy-light',
      effectiveProviderId: 'policy-light',
      runtimeLevel: 'policy',
    }));
    storeState.approvals = [];
    storeState.decisionEvents = [];
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
    const { createGatewayApi } = await import('../../electron/services/gateway-api');
    const { createPermissionsApi, listPermissionDecisionEvents } = await import('../../electron/services/permissions-api');
    const api = createGatewayApi(gatewayManager as never, backpressure as never);
    const permissions = createPermissionsApi();

    const first = await api.rpc({
      method: 'tools.exec',
      params: { command: 'git clean -fd' },
    }) as { approval?: { id: string }; approvalRequired?: boolean };
    expect(first).toMatchObject({
      success: false,
      blocked: true,
      approvalRequired: true,
    });
    expect(gatewayManager.rpc).not.toHaveBeenCalled();

    const approvalId = first.approval?.id;
    expect(approvalId).toBeTruthy();
    await permissions.decideApproval({ id: approvalId, decision: 'approved' });

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
    const { createGatewayApi } = await import('../../electron/services/gateway-api');
    const { createPermissionsApi } = await import('../../electron/services/permissions-api');
    const api = createGatewayApi(gatewayManager as never, backpressure as never);
    const permissions = createPermissionsApi();

    const first = await api.rpc({
      method: 'tools.exec',
      params: { command: 'git clean -fd' },
    }) as { approval?: { id: string } };
    const approvalId = first.approval?.id;
    await permissions.decideApproval({ id: approvalId, decision: 'approved' });

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

});
