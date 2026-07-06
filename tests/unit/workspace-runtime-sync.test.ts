import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  config: {} as Record<string, unknown>,
  writes: [] as Record<string, unknown>[],
  activeWorkspace: {
    id: 'workspace-1',
    name: 'Project',
    rootPath: 'C:/project',
    agentId: 'main',
    activeSessionKey: 'agent:main:main',
    permissionMode: 'readOnly',
    createdAt: 1,
    updatedAt: 1,
    lastOpenedAt: 1,
    state: {},
  },
  effectiveProviderId: 'policy-light' as 'policy-light' | 'docker-strong',
}));

vi.mock('@electron/utils/channel-config', () => ({
  readOpenClawConfig: vi.fn(async () => state.config),
  writeOpenClawConfig: vi.fn(async (config: Record<string, unknown>) => {
    state.writes.push(JSON.parse(JSON.stringify(config)) as Record<string, unknown>);
  }),
}));

vi.mock('@electron/services/workspaces-api', () => ({
  getActiveWorkspaceProfile: vi.fn(async () => state.activeWorkspace),
}));

vi.mock('@electron/services/sandbox-api', () => ({
  resolveActiveSandboxPolicyForMode: vi.fn(async () => ({
    providers: [],
    policy: {
      effectiveProviderId: state.effectiveProviderId,
    },
  })),
}));

describe('workspace runtime permission sync', () => {
  beforeEach(() => {
    state.config = {};
    state.writes = [];
    state.activeWorkspace.permissionMode = 'readOnly';
    state.effectiveProviderId = 'policy-light';
  });

  it('persists OpenClaw exec policy without reloading the running gateway', async () => {
    const { syncActiveWorkspacePermissionToRuntime } = await import('@electron/services/workspace-runtime-sync');
    const gatewayManager = {
      getStatus: vi.fn(() => ({ state: 'running' })),
      debouncedReload: vi.fn(),
      debouncedRestart: vi.fn(),
      restart: vi.fn(),
    };

    await syncActiveWorkspacePermissionToRuntime(gatewayManager);

    expect(state.writes).toHaveLength(1);
    expect(state.writes[0]).toMatchObject({
      tools: {
        exec: {
          host: 'gateway',
          security: 'allowlist',
          ask: 'always',
        },
        sandbox: {
          tools: {
            alsoAllow: ['bundle-mcp'],
          },
        },
      },
      agents: {
        defaults: {
          sandbox: {
            mode: 'off',
            backend: 'openshell',
            workspaceAccess: 'none',
          },
        },
      },
    });
    expect(gatewayManager.debouncedReload).not.toHaveBeenCalled();
    expect(gatewayManager.debouncedRestart).not.toHaveBeenCalled();
    expect(gatewayManager.restart).not.toHaveBeenCalled();
  });

  it('skips writes when the persisted policy is already current', async () => {
    const { syncActiveWorkspacePermissionToRuntime } = await import('@electron/services/workspace-runtime-sync');
    const { applyWorkspaceSandboxConfig } = await import('@electron/utils/workspace-runtime-permissions');
    state.config = {};
    applyWorkspaceSandboxConfig(state.config, 'readOnly');

    await syncActiveWorkspacePermissionToRuntime();

    expect(state.writes).toHaveLength(0);
  });

  it('uses the active strong sandbox profile when present', async () => {
    const { syncActiveWorkspacePermissionToRuntime } = await import('@electron/services/workspace-runtime-sync');
    state.activeWorkspace.permissionMode = 'acceptEdits';
    state.effectiveProviderId = 'docker-strong';

    await syncActiveWorkspacePermissionToRuntime();

    expect(state.writes).toHaveLength(1);
    expect(state.writes[0]).toMatchObject({
      agents: {
        defaults: {
          sandbox: {
            mode: 'all',
            backend: 'docker',
            workspaceAccess: 'rw',
            docker: { network: 'none' },
          },
        },
      },
      tools: {
        exec: {
          host: 'auto',
          security: 'allowlist',
          ask: 'on-miss',
        },
      },
    });
  });
});
