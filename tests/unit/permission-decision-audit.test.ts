import { beforeEach, describe, expect, it, vi } from 'vitest';

const storeState = vi.hoisted(() => ({
  approvals: [] as unknown[],
  decisionEvents: [] as unknown[],
}));

vi.mock('electron-store', () => {
  class MockStore {
    constructor(options?: { defaults?: { approvals?: unknown[]; decisionEvents?: unknown[] } }) {
      if (storeState.approvals.length === 0) {
        storeState.approvals = options?.defaults?.approvals ? [...options.defaults.approvals] : [];
      }
      if (storeState.decisionEvents.length === 0) {
        storeState.decisionEvents = options?.defaults?.decisionEvents ? [...options.defaults.decisionEvents] : [];
      }
    }

    get(key: string) {
      if (key === 'approvals') return storeState.approvals;
      if (key === 'decisionEvents') return storeState.decisionEvents;
      return undefined;
    }

    set(key: string, value: unknown) {
      if (key === 'approvals') storeState.approvals = Array.isArray(value) ? [...value] : [];
      if (key === 'decisionEvents') storeState.decisionEvents = Array.isArray(value) ? [...value] : [];
    }
  }

  return { default: MockStore };
});

describe('permission decision audit', () => {
  beforeEach(() => {
    storeState.approvals = [];
    storeState.decisionEvents = [];
  });

  it('stores normalized Workspace decisions through permissions-api', async () => {
    const { createWorkspacePermissionDecisionEvent } = await import('@electron/services/permission-decision-audit');
    const { recordPermissionDecisionEvent, listPermissionDecisionEvents } = await import('@electron/services/permissions-api');

    const event = createWorkspacePermissionDecisionEvent({
      workspaceMode: 'plan',
      tool: 'tools.exec',
      boundary: 'gateway-rpc',
      requestId: 'req-1',
      decision: { allowed: false, risk: 'destructive', reason: 'Plan mode blocks Gateway mutation' },
    });
    await recordPermissionDecisionEvent(event);

    await expect(listPermissionDecisionEvents(10)).resolves.toEqual([
      expect.objectContaining({
        kind: 'permission-decision',
        workspaceMode: 'plan',
        tool: 'tools.exec',
        boundary: 'gateway-rpc',
        decision: 'deny',
        requestId: 'req-1',
      }),
    ]);
  });

  it('normalizes approval-required Workspace decisions to the shared event contract', async () => {
    const { createWorkspacePermissionDecisionEvent } = await import('@electron/services/permission-decision-audit');

    expect(createWorkspacePermissionDecisionEvent({
      workspaceMode: 'acceptEdits',
      tool: 'terminal.run',
      boundary: 'workspace-command',
      requestId: 'terminal-approval',
      decision: {
        allowed: false,
        requiresApproval: true,
        risk: 'destructive',
        reason: 'approval gate',
      },
    })).toMatchObject({
      decision: 'approval-required',
      reason: 'approval gate',
      requestId: 'terminal-approval',
    });
  });

  it('builds Role permission decision payloads without importing Electron services', async () => {
    const { buildRolePermissionDecisionEvents } = await import('../../openclaw_runtime/src/agents/role-permission-audit');

    const events = buildRolePermissionDecisionEvents({
      roleName: 'architect',
      deniedTools: ['write', 'exec'],
      requestId: 'role-spawn-1',
      reason: 'filesystem=read denies write and shell tools',
    });

    expect(events).toEqual([
      expect.objectContaining({ role: 'architect', tool: 'write', boundary: 'role-tool', decision: 'deny' }),
      expect.objectContaining({ role: 'architect', tool: 'exec', boundary: 'role-tool', decision: 'deny' }),
    ]);
  });

  it('exposes decision events through the permissions host API', async () => {
    const { createPermissionsApi, recordPermissionDecisionEvent } = await import('@electron/services/permissions-api');
    await recordPermissionDecisionEvent({
      kind: 'permission-decision',
      workspaceMode: 'plan',
      role: null,
      tool: 'terminal.run',
      boundary: 'workspace-command',
      decision: 'deny',
      reason: 'Plan mode blocks command execution',
      requestId: 'terminal-1',
    });

    const api = createPermissionsApi();
    await expect(api.decisionEvents({ limit: 1 })).resolves.toMatchObject({
      success: true,
      events: [expect.objectContaining({ tool: 'terminal.run', decision: 'deny' })],
    });
  });

  it('does not drop decision events recorded concurrently', async () => {
    const { recordPermissionDecisionEvent, listPermissionDecisionEvents } = await import('@electron/services/permissions-api');

    await Promise.all([
      recordPermissionDecisionEvent({
        kind: 'permission-decision',
        workspaceMode: 'plan',
        role: null,
        tool: 'terminal.run',
        boundary: 'workspace-command',
        decision: 'deny',
        reason: 'Plan mode blocks command execution',
        requestId: 'terminal-concurrent',
      }),
      recordPermissionDecisionEvent({
        kind: 'permission-decision',
        workspaceMode: 'plan',
        role: null,
        tool: 'files.writeText',
        boundary: 'user-file',
        decision: 'deny',
        reason: 'Plan mode blocks file writes',
        requestId: 'file-concurrent',
      }),
    ]);

    await expect(listPermissionDecisionEvents(10)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ requestId: 'terminal-concurrent' }),
      expect.objectContaining({ requestId: 'file-concurrent' }),
    ]));
  });
});
