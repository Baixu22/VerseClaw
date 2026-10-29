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
            workspaceAccess: 'ro',
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

  it('repairs a legacy deny/always exec policy for an accept-edits workspace', async () => {
    const { syncActiveWorkspacePermissionToRuntime } = await import('@electron/services/workspace-runtime-sync');
    state.activeWorkspace.permissionMode = 'acceptEdits';
    state.config = {
      tools: {
        exec: {
          host: 'gateway',
          security: 'deny',
          ask: 'always',
        },
      },
    };

    await syncActiveWorkspacePermissionToRuntime();

    expect(state.writes).toHaveLength(1);
    expect(state.writes[0]).toMatchObject({
      tools: {
        exec: {
          host: 'gateway',
          security: 'allowlist',
          ask: 'on-miss',
        },
      },
    });
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

// ---------------------------------------------------------------------------
// FP-P1-02: single workspace authority — agents.defaults.workspace follows the
// active profile rootPath so the gateway agent and the UI judge one boundary.
// ---------------------------------------------------------------------------
import { syncActiveWorkspaceRootToRuntime } from '@electron/services/workspace-runtime-sync';

describe('FP-P1-02 syncActiveWorkspaceRootToRuntime', () => {
  beforeEach(() => {
    state.config = {};
    state.writes = [];
  });

  it('writes the active rootPath into agents.defaults.workspace', async () => {
    state.config = { agents: { defaults: { workspace: '~/.openclaw/workspace' } } };
    const modified = await syncActiveWorkspaceRootToRuntime();
    expect(modified).toBe(true);
    const written = state.writes.at(-1) as { agents?: { defaults?: { workspace?: string } } };
    expect(written?.agents?.defaults?.workspace).toBe('C:/project');
  });

  it('is idempotent when the config already points at the active workspace', async () => {
    state.config = { agents: { defaults: { workspace: 'C:/project' } } };
    const modified = await syncActiveWorkspaceRootToRuntime();
    expect(modified).toBe(false);
    expect(state.writes).toHaveLength(0);
  });

  it('creates the agents.defaults chain when missing', async () => {
    state.config = {};
    const modified = await syncActiveWorkspaceRootToRuntime();
    expect(modified).toBe(true);
    const written = state.writes.at(-1) as { agents?: { defaults?: { workspace?: string } } };
    expect(written?.agents?.defaults?.workspace).toBe('C:/project');
  });
});
