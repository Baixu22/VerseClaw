import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceProfile } from '@shared/types/workspace';

const storeState = vi.hoisted(() => ({
  approvals: [] as unknown[],
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

function workspace(): WorkspaceProfile {
  return {
    id: 'workspace-1',
    name: 'Project',
    rootPath: 'C:/project',
    agentId: 'main',
    activeSessionKey: 'agent:main:main',
    permissionMode: 'acceptEdits',
    createdAt: 1,
    updatedAt: 1,
    lastOpenedAt: 1,
    state: {},
  };
}

describe('permissions api approvals', () => {
  beforeEach(() => {
    storeState.approvals = [];
    vi.useRealTimers();
  });

  it('consumes an approved approval only once', async () => {
    const {
      consumeApprovedPermissionApproval,
      createPermissionApproval,
      createPermissionsApi,
    } = await import('@electron/services/permissions-api');
    const approval = await createPermissionApproval({
      workspace: workspace(),
      source: 'terminal',
      risk: 'dangerous',
      command: 'git clean -fd',
      cwd: 'C:/project',
      reason: '接受修改模式需要先批准高风险命令',
    });
    const api = createPermissionsApi();

    await expect(api.decideApproval({
      id: approval.id,
      decision: 'approved',
    })).resolves.toMatchObject({
      success: true,
      approval: { id: approval.id, status: 'approved' },
    });

    await expect(consumeApprovedPermissionApproval({
      id: approval.id,
      workspaceId: 'workspace-1',
      source: 'terminal',
      command: 'git clean -fd',
    })).resolves.toMatchObject({
      id: approval.id,
      status: 'approved',
    });

    await expect(consumeApprovedPermissionApproval({
      id: approval.id,
      workspaceId: 'workspace-1',
      source: 'terminal',
      command: 'git clean -fd',
    })).resolves.toBeNull();
  });

  it('filters approvals by workspace, status, source, and limit', async () => {
    const {
      createPermissionApproval,
      createPermissionsApi,
      recordPermissionAudit,
    } = await import('@electron/services/permissions-api');
    await createPermissionApproval({
      workspace: workspace(),
      source: 'terminal',
      risk: 'dangerous',
      command: 'git clean -fd',
      cwd: 'C:/project',
      reason: 'dangerous command',
    });
    await recordPermissionAudit({
      workspace: { ...workspace(), id: 'workspace-2' },
      source: 'gateway',
      risk: 'dangerous',
      command: 'tools.exec',
      reason: 'full access audit',
    });
    const api = createPermissionsApi();

    await expect(api.approvals({
      workspaceId: 'workspace-1',
      status: 'pending',
      source: 'terminal',
      limit: 1,
    })).resolves.toMatchObject({
      success: true,
      approvals: [{
        workspaceId: 'workspace-1',
        status: 'pending',
        source: 'terminal',
      }],
    });
  });

  it('reuses an existing pending approval for the same request', async () => {
    const { createPermissionApproval } = await import('@electron/services/permissions-api');
    const input = {
      workspace: workspace(),
      source: 'terminal' as const,
      risk: 'dangerous' as const,
      command: 'git clean -fd',
      cwd: 'C:/project',
      requestHash: 'C:/project:git clean -fd',
      reason: 'dangerous command',
    };

    const first = await createPermissionApproval(input);
    const second = await createPermissionApproval(input);

    expect(second.id).toBe(first.id);
    expect(storeState.approvals).toHaveLength(1);
  });

  it('expires stale pending approvals before listing or deciding', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-08T00:00:00.000Z'));
    const {
      createPermissionApproval,
      createPermissionsApi,
    } = await import('@electron/services/permissions-api');
    const approval = await createPermissionApproval({
      workspace: workspace(),
      source: 'terminal',
      risk: 'dangerous',
      command: 'git clean -fd',
      cwd: 'C:/project',
      reason: 'dangerous command',
    });
    const api = createPermissionsApi();

    vi.setSystemTime(new Date('2026-06-08T00:11:00.000Z'));

    await expect(api.approvals({
      workspaceId: 'workspace-1',
      includeExpired: true,
    })).resolves.toMatchObject({
      approvals: [{
        id: approval.id,
        status: 'expired',
      }],
    });
    await expect(api.decideApproval({
      id: approval.id,
      decision: 'approved',
    })).resolves.toMatchObject({
      success: false,
      approval: {
        id: approval.id,
        status: 'expired',
      },
    });
  });
});
