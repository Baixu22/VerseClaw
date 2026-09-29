import { describe, expect, it, vi } from 'vitest';

const {
  mockExecFile,
  mockGetAllProviders,
  mockGetDefaultProvider,
  mockGetProvider,
  mockGetApiKey,
  mockSpawnSync,
  mockSyncDefaultProviderToRuntime,
} = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
  mockGetAllProviders: vi.fn(),
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
  getAllProviders: mockGetAllProviders,
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
    mockSyncDefaultProviderToRuntime.mockResolvedValue({ degraded: false });

    const { syncDefaultProviderRuntimeBeforeLaunch } = await import('@electron/gateway/config-sync');
    await syncDefaultProviderRuntimeBeforeLaunch();

    expect(mockSyncDefaultProviderToRuntime).toHaveBeenCalledWith('deepseek');
  });
});

describe('loadProviderEnv', () => {
  it('injects the env SecretRef variable for keyed custom providers alongside registry keys', async () => {
    mockGetDefaultProvider.mockResolvedValue('senseaudio');
    mockGetProvider.mockResolvedValue({ id: 'senseaudio', type: 'custom', name: 'SenseAudio', enabled: true });
    mockGetAllProviders.mockResolvedValue([
      { id: 'senseaudio', type: 'custom', name: 'SenseAudio', enabled: true },
      { id: 'deepseek', type: 'deepseek', name: 'DeepSeek', enabled: true },
      { id: 'localgw', type: 'custom', name: 'Local', enabled: true },
    ]);
    mockGetApiKey.mockImplementation(async (id: string) => (
      id === 'senseaudio' ? 'sk-custom' : id === 'deepseek' ? 'sk-deepseek' : null
    ));

    const { loadProviderEnv } = await import('@electron/gateway/config-sync');
    const { providerEnv } = await loadProviderEnv();

    expect(providerEnv.CUSTOM_SENSEAUD_API_KEY).toBe('sk-custom');
    expect(providerEnv.DEEPSEEK_API_KEY).toBe('sk-deepseek');
    expect(Object.keys(providerEnv).some((name) => name.startsWith('CUSTOM_LOCALGW'))).toBe(false);
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

describe('source runtime isolation user config merge', () => {
  it('copies runtime.contextBlock flags from user config into isolated config', async () => {
    const {
      applySourceRuntimeIsolationUserConfig,
      SOURCE_RUNTIME_ISOLATION_SYNC_KEYS,
    } = await import('@electron/gateway/config-sync');

    expect(SOURCE_RUNTIME_ISOLATION_SYNC_KEYS).toContain('runtime');

    const isolated = {
      agents: { list: [] },
      models: { providers: {} },
      plugins: { enabled: false },
      runtime: { contextBlock: { sekb: { enabled: false } } },
    };
    const user = {
      agents: { list: [{ id: 'main' }] },
      models: { providers: { openai: {} } },
      plugins: { enabled: true },
      runtime: {
        contextBlock: {
          'working-memory': { enabled: true },
          'tool-registry': { enabled: true },
          sekb: { enabled: false },
        },
      },
    };

    const { config, changed } = applySourceRuntimeIsolationUserConfig(isolated, user);
    expect(changed).toBe(true);
    expect(config.runtime).toEqual(user.runtime);
    expect(config.agents).toEqual(user.agents);
  });

  it('does not overwrite isolated runtime when user config omits runtime', async () => {
    const { applySourceRuntimeIsolationUserConfig } = await import('@electron/gateway/config-sync');

    const existingRuntime = {
      contextBlock: {
        'working-memory': { enabled: true },
        sekb: { enabled: false },
      },
    };
    const isolated = {
      agents: { list: [] },
      runtime: existingRuntime,
    };
    const user = {
      agents: { list: [{ id: 'main' }] },
      // runtime intentionally absent
    };

    const { config, changed } = applySourceRuntimeIsolationUserConfig(isolated, user);
    expect(config.runtime).toEqual(existingRuntime);
    expect(config.agents).toEqual(user.agents);
    // agents changed, runtime preserved
    expect(changed).toBe(true);
    expect(
      applySourceRuntimeIsolationUserConfig(
        { runtime: existingRuntime },
        {},
      ).config.runtime,
    ).toEqual(existingRuntime);
  });

  it('carries tools.exec (workspace permission mode) into the isolated source runtime config', async () => {
    const {
      applySourceRuntimeIsolationUserConfig,
      buildInitialSourceRuntimeIsolationConfig,
      SOURCE_RUNTIME_ISOLATION_SYNC_KEYS,
    } = await import('@electron/gateway/config-sync');
    expect(SOURCE_RUNTIME_ISOLATION_SYNC_KEYS).toContain('tools');

    const tools = { exec: { host: 'gateway', security: 'full', ask: 'off' }, sessions: { visibility: 'all' } };
    const initial = buildInitialSourceRuntimeIsolationConfig({ agents: {}, tools });
    expect(initial.tools).toEqual(tools);
    expect(buildInitialSourceRuntimeIsolationConfig({ agents: {} }).tools).toBeUndefined();

    const merged = applySourceRuntimeIsolationUserConfig({ agents: {} }, { agents: {}, tools });
    expect(merged.changed).toBe(true);
    expect(merged.config.tools).toEqual(tools);
    expect(applySourceRuntimeIsolationUserConfig({ agents: {}, tools }, { agents: {} }).config.tools).toEqual(tools);
  });

  it('includes runtime on initial isolated config when user set it', async () => {
    const { buildInitialSourceRuntimeIsolationConfig } = await import('@electron/gateway/config-sync');
    const user = {
      agents: { list: [{ id: 'main' }] },
      runtime: { contextBlock: { 'working-memory': { enabled: true } } },
    };
    const initial = buildInitialSourceRuntimeIsolationConfig(user);
    expect(initial.runtime).toEqual(user.runtime);
    expect(buildInitialSourceRuntimeIsolationConfig({ agents: {} }).runtime).toBeUndefined();
  });
});

describe('RC-10 source runtime channel startup', () => {
  it('carries the channels block into the isolated source runtime config', async () => {
    const {
      SOURCE_RUNTIME_ISOLATION_SYNC_KEYS,
      applySourceRuntimeIsolationUserConfig,
      buildInitialSourceRuntimeIsolationConfig,
    } = await import('@electron/gateway/config-sync');

    expect(SOURCE_RUNTIME_ISOLATION_SYNC_KEYS).toContain('channels');

    const channels = {
      irc: {
        enabled: true,
        host: '127.0.0.1',
        port: 6667,
        tls: false,
        nick: 'rc10bot',
        channels: ['#rc10'],
      },
    };

    const initial = buildInitialSourceRuntimeIsolationConfig({ agents: {}, channels });
    expect(initial.channels).toEqual(channels);
    expect(buildInitialSourceRuntimeIsolationConfig({ agents: {} }).channels).toEqual({});

    const merged = applySourceRuntimeIsolationUserConfig({ agents: {}, channels: {} }, { agents: {}, channels });
    expect(merged.changed).toBe(true);
    expect(merged.config.channels).toEqual(channels);
  });

  it('does not wipe isolated channels when the user config omits them', async () => {
    const { applySourceRuntimeIsolationUserConfig } = await import('@electron/gateway/config-sync');

    const isolatedChannels = { irc: { enabled: true } };
    const { config } = applySourceRuntimeIsolationUserConfig(
      { agents: {}, channels: isolatedChannels },
      { agents: {} },
    );
    expect(config.channels).toEqual(isolatedChannels);
  });

  it('skips channel startup only when no channel is configured', async () => {
    const { buildChannelStartupPolicy } = await import('@electron/gateway/config-sync');

    expect(buildChannelStartupPolicy([])).toEqual({
      skipChannels: true,
      channelStartupSummary: 'skipped(no configured channels)',
    });
    expect(buildChannelStartupPolicy(['irc'])).toEqual({
      skipChannels: false,
      channelStartupSummary: 'enabled(irc)',
    });
    expect(buildChannelStartupPolicy(['discord', 'irc'])).toEqual({
      skipChannels: false,
      channelStartupSummary: 'enabled(discord,irc)',
    });
  });
});

describe('RC-10 source runtime channel plugin enablement', () => {
  it('leaves the config untouched when no channel is configured', async () => {
    const { applySourceRuntimeChannelPluginEnablement } = await import('@electron/gateway/config-sync');

    const config = { channels: {}, plugins: { enabled: false } };
    const result = applySourceRuntimeChannelPluginEnablement(config);
    expect(result.changed).toBe(false);
    expect(result.config).toBe(config);
  });

  it('ignores channels that are explicitly disabled', async () => {
    const { applySourceRuntimeChannelPluginEnablement } = await import('@electron/gateway/config-sync');

    const result = applySourceRuntimeChannelPluginEnablement({
      channels: { irc: { enabled: false } },
      plugins: { enabled: false },
    });
    expect(result.changed).toBe(false);
  });

  it('turns the global plugin switch back on when a channel is configured', async () => {
    const { applySourceRuntimeChannelPluginEnablement } = await import('@electron/gateway/config-sync');

    const result = applySourceRuntimeChannelPluginEnablement({
      channels: { irc: { enabled: true, host: '127.0.0.1', nick: 'rc10bot' } },
      plugins: { enabled: false, entries: { browser: { enabled: true } } },
    });

    expect(result.changed).toBe(true);
    expect(result.config.plugins).toEqual({
      enabled: true,
      entries: { browser: { enabled: true } },
    });
  });

  it('is a no-op when the plugin switch is already on', async () => {
    const { applySourceRuntimeChannelPluginEnablement } = await import('@electron/gateway/config-sync');

    const config = { channels: { irc: { enabled: true } }, plugins: { enabled: true } };
    const result = applySourceRuntimeChannelPluginEnablement(config);
    expect(result.changed).toBe(false);
    expect(result.config).toBe(config);
  });
});
