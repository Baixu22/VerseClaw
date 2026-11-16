import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceProfile, WorkspacePermissionMode } from '@shared/types/workspace';

const state = vi.hoisted(() => ({
  config: {} as Record<string, unknown>,
  writes: [] as Record<string, unknown>[],
  activeWorkspace: {
    id: 'workspace-1',
    name: 'Project',
    rootPath: 'C:/project',
    agentId: 'main',
    activeSessionKey: 'agent:main:main',
    permissionMode: 'readOnly' as WorkspacePermissionMode,
    createdAt: 1,
    updatedAt: 1,
    lastOpenedAt: 1,
    state: {},
  },
  effectiveProviderId: 'policy-light' as 'policy-light' | 'docker-strong',
}));

vi.mock('@electron/utils/channel-config', () => ({
  readOpenClawConfig: vi.fn(async () => structuredClone(state.config)),
  writeOpenClawConfig: vi.fn(async (config: Record<string, unknown>) => {
    state.config = structuredClone(config);
    state.writes.push(JSON.parse(JSON.stringify(config)) as Record<string, unknown>);
  }),
}));

vi.mock('@electron/utils/atomic-write', async (importOriginal) => ({
  ...await importOriginal<typeof import('@electron/utils/atomic-write')>(),
  withFileLock: async (_target: string, fn: () => Promise<unknown>) => fn(),
}));

vi.mock('@electron/services/sandbox-state', () => ({
  resolveActiveSandboxPolicyForMode: vi.fn(async () => ({
    providers: [],
    policy: {
      effectiveProviderId: state.effectiveProviderId,
    },
  })),
}));

const readActiveWorkspace = vi.fn(async (): Promise<WorkspaceProfile | null> => state.activeWorkspace);

describe('workspace runtime permission sync', () => {
  beforeEach(() => {
    state.config = {};
    state.writes = [];
    state.activeWorkspace.permissionMode = 'readOnly';
    state.effectiveProviderId = 'policy-light';
    readActiveWorkspace.mockClear();
  });

  it('persists OpenClaw exec policy using the workspace owner reader', async () => {
    const { syncActiveWorkspacePermissionToRuntime } = await import('@electron/services/workspace-runtime-sync');
    await syncActiveWorkspacePermissionToRuntime(readActiveWorkspace);

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
    expect(readActiveWorkspace).toHaveBeenCalledTimes(1);
  });

  it('skips writes when the persisted policy is already current', async () => {
    const { syncActiveWorkspacePermissionToRuntime } = await import('@electron/services/workspace-runtime-sync');
    const { applyWorkspaceSandboxConfig } = await import('@electron/utils/workspace-runtime-permissions');
    state.config = {};
    applyWorkspaceSandboxConfig(state.config, 'readOnly');

    await syncActiveWorkspacePermissionToRuntime(readActiveWorkspace);

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

    await syncActiveWorkspacePermissionToRuntime(readActiveWorkspace);

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

    await syncActiveWorkspacePermissionToRuntime(readActiveWorkspace);

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
    state.activeWorkspace.rootPath = 'C:/project';
    readActiveWorkspace.mockClear();
  });

  it('preserves a concurrent model update and reads the active workspace after the writer completes', async () => {
    const { readOpenClawConfig, writeOpenClawConfig } = await import('@electron/utils/channel-config');
    const { withConfigLock } = await import('@electron/utils/config-mutex');
    const { syncActiveWorkspacePermissionToRuntime } = await import('@electron/services/workspace-runtime-sync');
    state.activeWorkspace.permissionMode = 'readOnly';
    state.effectiveProviderId = 'policy-light';
    let releaseWriter!: () => void;
    let signalRead!: () => void;
    const writerGate = new Promise<void>((resolve) => { releaseWriter = resolve; });
    const writerRead = new Promise<void>((resolve) => { signalRead = resolve; });
    const modelUpdate = withConfigLock(async () => {
      const config = await readOpenClawConfig();
      signalRead();
      await writerGate;
      config.agents = { defaults: { model: { primary: 'fixture/model' } } };
      await writeOpenClawConfig(config);
    }, { lockTargetPath: null });
    await writerRead;
    let rootSettled = false;
    const permission = syncActiveWorkspacePermissionToRuntime(readActiveWorkspace);
    const root = syncActiveWorkspaceRootToRuntime(readActiveWorkspace).then(() => { rootSettled = true; });
    await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
    const settledBeforeModelWrite = rootSettled;
    const ownerReadsBeforeModelWrite = readActiveWorkspace.mock.calls.length;
    state.activeWorkspace.rootPath = 'D:/current-project';
    state.activeWorkspace.permissionMode = 'fullAccess';
    releaseWriter();
    await Promise.all([modelUpdate, permission, root]);
    expect(settledBeforeModelWrite).toBe(false);
    expect(ownerReadsBeforeModelWrite).toBe(0);
    expect(state.config).toMatchObject({
      agents: { defaults: {
        model: { primary: 'fixture/model' },
        workspace: 'D:/current-project',
        sandbox: { workspaceAccess: 'none' },
      } },
      tools: { exec: { security: 'full', ask: 'off' } },
    });
  });

  it('writes the active rootPath into agents.defaults.workspace', async () => {
    state.config = { agents: { defaults: { workspace: '~/.openclaw/workspace' } } };
    const modified = await syncActiveWorkspaceRootToRuntime(readActiveWorkspace);
    expect(modified).toBe(true);
    const written = state.writes.at(-1) as { agents?: { defaults?: { workspace?: string } } };
    expect(written?.agents?.defaults?.workspace).toBe('C:/project');
  });

  it('is idempotent when the config already points at the active workspace', async () => {
    state.config = { agents: { defaults: { workspace: 'C:/project' } } };
    const modified = await syncActiveWorkspaceRootToRuntime(readActiveWorkspace);
    expect(modified).toBe(false);
    expect(state.writes).toHaveLength(0);
  });

  it('creates the agents.defaults chain when missing', async () => {
    state.config = {};
    const modified = await syncActiveWorkspaceRootToRuntime(readActiveWorkspace);
    expect(modified).toBe(true);
    const written = state.writes.at(-1) as { agents?: { defaults?: { workspace?: string } } };
    expect(written?.agents?.defaults?.workspace).toBe('C:/project');
  });
  it('preserves the runtime root when no workspace is active', async () => {
    const readMissingWorkspace = vi.fn(async () => null);
    state.config = { agents: { defaults: { workspace: 'C:/previous' } } };
    expect(await syncActiveWorkspaceRootToRuntime(readMissingWorkspace)).toBe(false);
    expect(state.writes).toHaveLength(0);
    expect(readMissingWorkspace).toHaveBeenCalledTimes(1);
  });
});
