import { describe, expect, it, vi } from 'vitest';

const {
  mockExecFile,
  mockGetDefaultProvider,
  mockGetProvider,
  mockGetApiKey,
  mockSpawnSync,
  mockSyncDefaultProviderToRuntime,
} = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
  mockGetDefaultProvider: vi.fn(),
  mockGetProvider: vi.fn(),
  mockGetApiKey: vi.fn(),
  mockSpawnSync: vi.fn(),
  mockSyncDefaultProviderToRuntime: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFile: mockExecFile,
  spawnSync: mockSpawnSync,
  default: {
    execFile: mockExecFile,
    spawnSync: mockSpawnSync,
  },
}));

vi.mock('@electron/utils/secure-storage', () => ({
  getApiKey: mockGetApiKey,
  getDefaultProvider: mockGetDefaultProvider,
  getProvider: mockGetProvider,
}));

vi.mock('@electron/services/providers/provider-runtime-sync', () => ({
  syncDefaultProviderToRuntime: mockSyncDefaultProviderToRuntime,
}));

describe('syncDefaultProviderRuntimeBeforeLaunch', () => {
  it('syncs the configured default provider before Gateway launch config is copied', async () => {
    mockGetDefaultProvider.mockResolvedValue('deepseek');
    mockSyncDefaultProviderToRuntime.mockResolvedValue(undefined);

    const { syncDefaultProviderRuntimeBeforeLaunch } = await import('@electron/gateway/config-sync');
    await syncDefaultProviderRuntimeBeforeLaunch();

    expect(mockSyncDefaultProviderToRuntime).toHaveBeenCalledWith('deepseek');
  });
});

describe('applySourceRuntimeSandboxAutoFallback', () => {
  it('strips legacy agent reasoningEffort from source runtime config copies', async () => {
    const { stripSourceRuntimeIncompatibleConfigKeys } = await import('@electron/gateway/config-sync');

    const result = stripSourceRuntimeIncompatibleConfigKeys({
      agents: {
        list: [
          { id: 'main', reasoningEffort: 'high', thinkingDefault: 'high' },
          { id: 'helper', reasoningEffort: 'medium' },
        ],
      },
    });

    const list = ((result.agents as { list: Array<Record<string, unknown>> }).list);
    expect(list.find((agent) => agent.id === 'main')?.reasoningEffort).toBeUndefined();
    expect(list.find((agent) => agent.id === 'main')?.thinkingDefault).toBe('high');
    expect(list.find((agent) => agent.id === 'helper')?.reasoningEffort).toBeUndefined();
  });

  it('forces sandbox off for defaults and per-agent overrides when Docker image is unavailable', async () => {
    mockSpawnSync.mockReturnValue({ status: 1 });

    const { applySourceRuntimeSandboxAutoFallback } = await import('@electron/gateway/config-sync');
    const result = applySourceRuntimeSandboxAutoFallback({
      agents: {
        defaults: {
          sandbox: {
            mode: 'all',
            backend: 'docker',
          },
        },
        list: [
          {
            id: 'main',
            sandbox: {
              mode: 'non-main',
              backend: 'docker',
            },
          },
          {
            id: 'helper',
          },
        ],
      },
    });

    expect(result).toMatchObject({
      agents: {
        defaults: {
          sandbox: {
            mode: 'off',
            backend: 'docker',
          },
        },
        list: [
          {
            id: 'main',
            sandbox: {
              mode: 'off',
              backend: 'docker',
            },
          },
          {
            id: 'helper',
            sandbox: {
              mode: 'off',
            },
          },
        ],
      },
    });
  });

  it('leaves config untouched when Docker image is available', async () => {
    mockSpawnSync.mockReturnValue({ status: 0 });

    const { applySourceRuntimeSandboxAutoFallback } = await import('@electron/gateway/config-sync');
    const input = {
      agents: {
        defaults: {
          sandbox: {
            mode: 'all',
            backend: 'docker',
          },
        },
      },
    };

    expect(applySourceRuntimeSandboxAutoFallback(input)).toBe(input);
  });

  it('removes stale Verse Claw-only sandbox diagnostics from source runtime config', async () => {
    mockSpawnSync.mockReturnValue({ status: 1 });

    const { applySourceRuntimeSandboxAutoFallback } = await import('@electron/gateway/config-sync');
    const result = applySourceRuntimeSandboxAutoFallback({
      agents: {
        defaults: {
          sandbox: {
            mode: 'all',
            backend: 'docker',
            autoDisabledReason: 'previous diagnostic',
          },
        },
        list: [
          {
            id: 'main',
            sandbox: {
              mode: 'non-main',
              autoDisabledReason: 'previous diagnostic',
            },
          },
        ],
      },
    });

    expect(result).toMatchObject({
      agents: {
        defaults: {
          sandbox: {
            mode: 'off',
            backend: 'docker',
          },
        },
        list: [
          {
            id: 'main',
            sandbox: {
              mode: 'off',
            },
          },
        ],
      },
    });
    expect(JSON.stringify(result)).not.toContain('autoDisabledReason');
  });
});
