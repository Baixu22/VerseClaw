import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceProfile } from '@shared/types/workspace';

const storeState = vi.hoisted(() => ({
  approvals: [] as unknown[],
}));

const activeWorkspace = vi.hoisted(() => ({
  profile: null as WorkspaceProfile | null,
}));

vi.mock('electron-store', () => {
  class MockStore {
    constructor(options?: { defaults?: { approvals?: unknown[] } }) {
      if (storeState.approvals.length === 0 && options?.defaults?.approvals) {
        storeState.approvals = [...options.defaults.approvals];
      }
    }

    get(key: string) {
      return key === 'approvals' ? storeState.approvals : undefined;
    }

    set(key: string, value: unknown) {
      if (key === 'approvals') {
        storeState.approvals = Array.isArray(value) ? [...value] : [];
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
    storeState.approvals = [];
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
    const { createGatewayApi } = await import('@electron/services/gateway-api');
    const { createPermissionsApi } = await import('@electron/services/permissions-api');
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
    const { createGatewayApi } = await import('@electron/services/gateway-api');
    const { createPermissionsApi } = await import('@electron/services/permissions-api');
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

});
