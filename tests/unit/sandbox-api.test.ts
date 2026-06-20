import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
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
  store: {
    profiles: [] as unknown[],
    activeProfileId: undefined as string | undefined,
  },
  execFile: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  default: {
    execFile: state.execFile,
  },
  execFile: state.execFile,
}));

state.execFile.mockImplementation(
  (_command: string, _args: string[], _options: unknown, callback: (error: Error | null) => void) => {
      callback(new Error('not installed'));
  },
);

vi.mock('electron-store', () => {
  class MockStore {
    get(key: string) {
      return state.store[key as keyof typeof state.store];
    }

    set(key: string, value: unknown) {
      (state.store as Record<string, unknown>)[key] = value;
    }
  }

  return { default: MockStore };
});

vi.mock('@electron/services/workspaces-api', () => ({
  getActiveWorkspaceProfile: vi.fn(async () => state.activeWorkspace),
}));

describe('sandbox api', () => {
  beforeEach(async () => {
    state.activeWorkspace.permissionMode = 'readOnly';
    state.store.profiles = [];
    state.store.activeProfileId = undefined;
    state.execFile.mockClear();
    const { clearSandboxProviderDetectionCache } = await import('@electron/utils/sandbox-provider-detection');
    clearSandboxProviderDetectionCache();
  });

  it('reports lightweight default sandbox status without requiring Docker', async () => {
    const { createSandboxApi } = await import('@electron/services/sandbox-api');
    const api = createSandboxApi();

    const status = await api.status();

    expect(status.success).toBe(true);
    expect(status.permissionMode).toBe('readOnly');
    expect(status.requestedProviderId).toBe('policy-light');
    expect(status.effectiveProviderId).toBe('policy-light');
    expect(status.degraded).toBe(false);
    expect(status.docker).toEqual({ cli: false, daemon: false, image: false });
    expect(status.openClawConfig.agents.defaults.sandbox.mode).toBe('off');
    expect(status.openClawConfig.agents.defaults.sandbox.workspaceAccess).toBe('none');
    expect(status.openClawConfig.tools.exec.security).toBe('allowlist');
    expect(status.openClawConfig.tools.exec.host).toBe('gateway');
    expect(status.warnings.length).toBeGreaterThan(0);
  });

  it('falls back to policy-light when docker-strong is requested but unavailable', async () => {
    const { createSandboxApi } = await import('@electron/services/sandbox-api');
    const api = createSandboxApi();

    await api.updateProfile({
      id: 'docker',
      name: 'Docker strong',
      providerId: 'docker-strong',
      networkPolicy: 'disabled',
    });

    const status = await api.status();

    expect(status).toMatchObject({
      success: true,
      requestedProviderId: 'docker-strong',
      effectiveProviderId: 'policy-light',
      degraded: true,
      degradeReason: expect.stringContaining('Docker strong sandbox is unavailable'),
    });
    expect(status.openClawConfig.agents.defaults.sandbox.mode).toBe('off');
    expect(status.openClawConfig.agents.defaults.sandbox.backend).toBe('openshell');
  });

  it('caches provider detection for repeated status reads', async () => {
    const { createSandboxApi } = await import('@electron/services/sandbox-api');
    const api = createSandboxApi();

    await api.status();
    await api.status();

    expect(state.execFile).toHaveBeenCalledTimes(3);
    expect(state.execFile).toHaveBeenCalledWith(
      'docker',
      ['--version'],
      expect.any(Object),
      expect.any(Function),
    );
    expect(state.execFile).toHaveBeenCalledWith(
      'runsc',
      ['--version'],
      expect.any(Object),
      expect.any(Function),
    );
    expect(state.execFile).toHaveBeenCalledWith(
      'ssh',
      ['-V'],
      expect.any(Object),
      expect.any(Function),
    );
  });

  it('stores sandbox profiles and explains the effective mapping', async () => {
    const { createSandboxApi } = await import('@electron/services/sandbox-api');
    const api = createSandboxApi();

    await expect(api.updateProfile({
      id: 'local',
      name: 'Local policy',
      providerId: 'policy-only',
      networkPolicy: 'disabled',
    })).resolves.toMatchObject({
      success: true,
      profile: {
        id: 'local',
        providerId: 'policy-light',
      },
    });

    await expect(api.explain({ workspaceId: 'workspace-1', agentId: 'main' })).resolves.toMatchObject({
      success: true,
      explanation: {
        items: expect.arrayContaining([
          expect.objectContaining({ key: 'effectiveProvider', value: 'policy-light' }),
        ]),
      },
      explain: expect.arrayContaining([
        expect.stringContaining('Permission mode'),
        expect.stringContaining('Effective provider: policy-light'),
      ]),
    });
  });
});
