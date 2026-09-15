// @vitest-environment node

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  applyProxySettingsMock,
  assignChannelAccountToAgentMock,
  assignChannelToAgentMock,
  clearChannelBindingMock,
  createAgentMock,
  deleteAgentConfigMock,
  deleteChannelAccountConfigMock,
  deleteChannelConfigMock,
  ensureFeishuPluginInstalledMock,
  getAllSettingsMock,
  getChannelFormValuesMock,
  getSettingMock,
  buildSandboxStatusMock,
  listLogFilesMock,
  logDir,
  listAgentsSnapshotFromConfigMock,
  listAgentsSnapshotMock,
  listConfiguredChannelAccountsFromConfigMock,
  listConfiguredChannelsFromConfigMock,
  listConfiguredChannelsMock,
  providerAccountToConfigMock,
  providerServiceMock,
  readOpenClawConfigMock,
  writeOpenClawConfigMock,
  readLogFileMock,
  readAgentBootstrapFileMock,
  removeAgentWorkspaceDirectoryMock,
  resetSettingsMock,
  readAgentBootstrapToolsMock,
  readAgentRoleProfileMock,
  readAgentSoulMock,
  saveChannelConfigMock,
  setSettingMock,
  syncDefaultProviderToRuntimeMock,
  syncSavedProviderToRuntimeMock,
  syncLaunchAtStartupSettingFromStoreMock,
  syncProxyConfigToOpenClawMock,
  testOpenClawConfigDir,
  updateAgentNameMock,
  updateAgentAvatarMock,
  resetAgentAvatarMock,
  validateApiKeyWithProviderMock,
  writeAgentBootstrapFileMock,
  writeAgentBootstrapToolsMock,
  writeAgentRoleProfileMock,
  writeAgentSoulMock,
} = vi.hoisted(() => ({
  applyProxySettingsMock: vi.fn(),
  assignChannelAccountToAgentMock: vi.fn(),
  assignChannelToAgentMock: vi.fn(),
  clearChannelBindingMock: vi.fn(),
  createAgentMock: vi.fn(),
  deleteAgentConfigMock: vi.fn(),
  deleteChannelAccountConfigMock: vi.fn(),
  deleteChannelConfigMock: vi.fn(),
  ensureFeishuPluginInstalledMock: vi.fn(),
  getAllSettingsMock: vi.fn(),
  getChannelFormValuesMock: vi.fn(),
  getSettingMock: vi.fn(),
  buildSandboxStatusMock: vi.fn(),
  listLogFilesMock: vi.fn(),
  logDir: '/tmp/verse-claw-host-services-test-logs',
  listAgentsSnapshotFromConfigMock: vi.fn(),
  listAgentsSnapshotMock: vi.fn(),
  listConfiguredChannelAccountsFromConfigMock: vi.fn(),
  listConfiguredChannelsFromConfigMock: vi.fn(),
  listConfiguredChannelsMock: vi.fn(),
  providerAccountToConfigMock: vi.fn((account: Record<string, unknown>) => ({
    id: account.id,
    name: account.label,
    type: account.vendorId,
    baseUrl: account.baseUrl,
    apiProtocol: account.apiProtocol,
    model: account.model,
    enabled: account.enabled,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  })),
  providerServiceMock: {
    _deleteProviderApiKeyInternal: vi.fn(),
    _deleteProviderInternal: vi.fn(),
    _getDefaultProviderInternal: vi.fn(),
    _getProviderApiKeyInternal: vi.fn(),
    _getProviderInternal: vi.fn(),
    _hasProviderApiKeyInternal: vi.fn(),
    _listProvidersWithKeyInfoInternal: vi.fn(),
    _saveProviderInternal: vi.fn(),
    _setDefaultProviderInternal: vi.fn(),
    _setProviderApiKeyInternal: vi.fn(),
    createAccount: vi.fn(),
    deleteAccount: vi.fn(),
    getAccount: vi.fn(),
    getAccountApiKey: vi.fn(),
    getDefaultAccountId: vi.fn(),
    hasAccountApiKey: vi.fn(),
    listAccounts: vi.fn(),
    listAccountsKeyInfo: vi.fn(),
    listVendors: vi.fn(),
    setDefaultAccount: vi.fn(),
    updateAccount: vi.fn(),
  },
  readOpenClawConfigMock: vi.fn(),
  writeOpenClawConfigMock: vi.fn(),
  readLogFileMock: vi.fn(),
  readAgentBootstrapFileMock: vi.fn(),
  readAgentSoulMock: vi.fn(),
  readAgentRoleProfileMock: vi.fn(),
  removeAgentWorkspaceDirectoryMock: vi.fn(),
  resetSettingsMock: vi.fn(),
  readAgentBootstrapToolsMock: vi.fn(),
  saveChannelConfigMock: vi.fn(),
  setSettingMock: vi.fn(),
  syncDefaultProviderToRuntimeMock: vi.fn(),
  syncSavedProviderToRuntimeMock: vi.fn(),
  syncLaunchAtStartupSettingFromStoreMock: vi.fn(),
  syncProxyConfigToOpenClawMock: vi.fn(),
  testOpenClawConfigDir: '/tmp/verse-claw-host-services-openclaw',
  updateAgentNameMock: vi.fn(),
  updateAgentAvatarMock: vi.fn(),
  resetAgentAvatarMock: vi.fn(),
  validateApiKeyWithProviderMock: vi.fn(),
  writeAgentBootstrapFileMock: vi.fn(),
  writeAgentBootstrapToolsMock: vi.fn(),
  writeAgentRoleProfileMock: vi.fn(),
  writeAgentSoulMock: vi.fn(),
}));

vi.mock('@electron/utils/store', () => ({
  getAllSettings: getAllSettingsMock,
  getSetting: getSettingMock,
  resetSettings: resetSettingsMock,
  setSetting: setSettingMock,
}));

vi.mock('@electron/utils/openclaw-proxy', () => ({
  syncProxyConfigToOpenClaw: syncProxyConfigToOpenClawMock,
}));

vi.mock('@electron/main/proxy', () => ({
  applyProxySettings: applyProxySettingsMock,
}));

vi.mock('@electron/main/launch-at-startup', () => ({
  syncLaunchAtStartupSettingFromStore: syncLaunchAtStartupSettingFromStoreMock,
}));

vi.mock('@electron/utils/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@electron/utils/logger')>();
  return {
    logger: {
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      getLogDir: () => logDir,
      getLogFilePath: () => join(logDir, 'verse-claw-current.log'),
      getRecentLogs: vi.fn(),
      listLogFiles: listLogFilesMock,
      readLogFile: readLogFileMock,
    },
    readLogFileTail: (actual as { readLogFileTail?: unknown }).readLogFileTail,
  };
});

vi.mock('@electron/utils/channel-config', () => ({
  cleanupDanglingWeChatPluginState: vi.fn(),
  deleteChannelAccountConfig: deleteChannelAccountConfigMock,
  deleteChannelConfig: deleteChannelConfigMock,
  getChannelFormValues: getChannelFormValuesMock,
  listConfiguredChannelAccountsFromConfig: listConfiguredChannelAccountsFromConfigMock,
  listConfiguredChannels: listConfiguredChannelsMock,
  listConfiguredChannelsFromConfig: listConfiguredChannelsFromConfigMock,
  readOpenClawConfig: readOpenClawConfigMock,
  writeOpenClawConfig: writeOpenClawConfigMock,
  saveChannelConfig: saveChannelConfigMock,
  setChannelDefaultAccount: vi.fn(),
  setChannelEnabled: vi.fn(),
  validateChannelConfig: vi.fn(),
  validateChannelCredentials: vi.fn(),
}));


vi.mock('@electron/services/mcp-api', () => ({
  syncAgentMcpExposureToOpenClawConfig: vi.fn().mockResolvedValue(undefined),
  createMcpApi: vi.fn(),
}));
vi.mock('@electron/utils/agent-config', () => ({
  assignChannelAccountToAgent: assignChannelAccountToAgentMock,
  assignChannelToAgent: assignChannelToAgentMock,
  clearAllBindingsForChannel: vi.fn(),
  clearChannelBinding: clearChannelBindingMock,
  createAgent: createAgentMock,
  deleteAgentConfig: deleteAgentConfigMock,
  listAgentsSnapshot: listAgentsSnapshotMock,
  listAgentsSnapshotFromConfig: listAgentsSnapshotFromConfigMock,
  readAgentBootstrapFile: readAgentBootstrapFileMock,
  readAgentBootstrapTools: readAgentBootstrapToolsMock,
  readAgentRoleProfile: readAgentRoleProfileMock,
  readAgentSoul: readAgentSoulMock,
  removeAgentWorkspaceDirectory: removeAgentWorkspaceDirectoryMock,
  resolveAccountIdForAgent: vi.fn((agentId: string) => agentId === 'main' ? 'default' : agentId),
  updateAgentModel: vi.fn(),
  updateAgentAvatar: updateAgentAvatarMock,
  resetAgentAvatar: resetAgentAvatarMock,
  updateAgentName: updateAgentNameMock,
  writeAgentBootstrapFile: writeAgentBootstrapFileMock,
  writeAgentBootstrapTools: writeAgentBootstrapToolsMock,
  writeAgentRoleProfile: writeAgentRoleProfileMock,
  writeAgentSoul: writeAgentSoulMock,
}));

vi.mock('@electron/services/workspaces-api', () => ({
  getActiveWorkspaceProfile: vi.fn().mockResolvedValue(null),
}));

vi.mock('@electron/services/sandbox-api', () => ({
  buildSandboxStatus: buildSandboxStatusMock,
}));

vi.mock('@electron/utils/plugin-install', () => ({
  ensureDiscordPluginInstalled: vi.fn(),
  ensureDingTalkPluginInstalled: vi.fn(),
  ensureFeishuPluginInstalled: ensureFeishuPluginInstalledMock,
  ensureQQBotPluginInstalled: vi.fn(),
  ensureWeChatPluginInstalled: vi.fn(),
  ensureWeComPluginInstalled: vi.fn(),
  ensureWhatsAppPluginInstalled: vi.fn(),
}));

vi.mock('@electron/utils/openclaw-workspace', () => ({
  ensureVerseClawContext: vi.fn(),
}));

vi.mock('@electron/services/providers/provider-runtime-sync', () => ({
  syncAllProviderAuthToRuntime: vi.fn(),
  syncAgentModelOverrideToRuntime: vi.fn(),
  syncDefaultProviderToRuntime: syncDefaultProviderToRuntimeMock,
  syncDeletedProviderApiKeyToRuntime: vi.fn(),
  syncDeletedProviderToRuntime: vi.fn(),
  syncProviderApiKeyToRuntime: vi.fn(),
  syncSavedProviderToRuntime: syncSavedProviderToRuntimeMock,
  syncUpdatedProviderToRuntime: vi.fn(),
  getOpenClawProviderKey: vi.fn((type: string) => type),
}));

vi.mock('@electron/services/providers/provider-service', () => ({
  getProviderService: () => providerServiceMock,
}));

vi.mock('@electron/services/providers/provider-store', () => ({
  providerAccountToConfig: providerAccountToConfigMock as never,
}));

vi.mock('@electron/services/providers/provider-validation', () => ({
  validateApiKeyWithProvider: validateApiKeyWithProviderMock,
}));

vi.mock('@electron/utils/browser-oauth', () => ({
  browserOAuthManager: {
    setWindow: vi.fn(),
    startFlow: vi.fn(),
    stopFlow: vi.fn(),
    submitManualCode: vi.fn(),
  },
}));

vi.mock('@electron/utils/device-oauth', () => ({
  deviceOAuthManager: {
    setWindow: vi.fn(),
    startFlow: vi.fn(),
    stopFlow: vi.fn(),
  },
}));

vi.mock('@electron/utils/wechat-login', () => ({
  cancelWeChatLoginSession: vi.fn(),
  saveWeChatAccountState: vi.fn(),
  startWeChatLoginSession: vi.fn(),
  waitForWeChatLoginSession: vi.fn(),
}));

vi.mock('@electron/utils/whatsapp-login', () => ({
  whatsAppLoginManager: {
    start: vi.fn(),
    stop: vi.fn(),
  },
}));

vi.mock('@electron/utils/paths', () => ({
  getOpenClawConfigDir: () => testOpenClawConfigDir,
  getOpenClawConfigPath: () => join(testOpenClawConfigDir, 'openclaw.json'),
  getOpenClawDir: () => testOpenClawConfigDir,
  getOpenClawResolvedDir: () => testOpenClawConfigDir,
  getDataDir: () => testOpenClawConfigDir,
  getLogsDir: () => testOpenClawConfigDir,
  isOpenClawRuntimeEnabled: () => process.env.VERSE_CLAW_OPENCLAW_RUNTIME === 'source',
}));

vi.mock('@electron/utils/proxy-fetch', () => ({
  proxyAwareFetch: vi.fn(),
}));

vi.mock('@electron/utils/openclaw-sdk', () => ({
  listDiscordDirectoryGroupsFromConfig: vi.fn().mockResolvedValue([]),
  listDiscordDirectoryPeersFromConfig: vi.fn().mockResolvedValue([]),
  normalizeDiscordMessagingTarget: vi.fn().mockReturnValue(undefined),
  listTelegramDirectoryGroupsFromConfig: vi.fn().mockResolvedValue([]),
  listTelegramDirectoryPeersFromConfig: vi.fn().mockResolvedValue([]),
  normalizeTelegramMessagingTarget: vi.fn().mockReturnValue(undefined),
  listSlackDirectoryGroupsFromConfig: vi.fn().mockResolvedValue([]),
  listSlackDirectoryPeersFromConfig: vi.fn().mockResolvedValue([]),
  normalizeSlackMessagingTarget: vi.fn().mockReturnValue(undefined),
  normalizeWhatsAppMessagingTarget: vi.fn().mockReturnValue(undefined),
}));

const baseSettings = {
  proxyEnabled: false,
  proxyServer: '',
  proxyHttpServer: '',
  proxyHttpsServer: '',
  proxyAllServer: '',
  proxyBypassRules: '',
  launchAtStartup: false,
  theme: 'system',
  roleMemoryEnabled: true,
};

describe('host services', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAllSettingsMock.mockResolvedValue(baseSettings);
    getSettingMock.mockResolvedValue(undefined);
    readOpenClawConfigMock.mockResolvedValue({ channels: {} });
    listConfiguredChannelsMock.mockResolvedValue([]);
    listConfiguredChannelsFromConfigMock.mockResolvedValue([]);
    listConfiguredChannelAccountsFromConfigMock.mockReturnValue({});
    listAgentsSnapshotMock.mockResolvedValue({
      agents: [],
      defaultAgentId: 'main',
      defaultModelRef: null,
      configuredChannelTypes: [],
      channelOwners: {},
      channelAccountOwners: {},
    });
    listAgentsSnapshotFromConfigMock.mockResolvedValue({
      agents: [],
      defaultAgentId: 'main',
      defaultModelRef: null,
      configuredChannelTypes: [],
      channelOwners: {},
      channelAccountOwners: {},
    });
    readAgentBootstrapFileMock.mockResolvedValue({ content: '', path: '' });
    readAgentRoleProfileMock.mockResolvedValue(null);
    writeAgentBootstrapFileMock.mockResolvedValue({ content: '', path: '' });
    writeAgentRoleProfileMock.mockResolvedValue(null);
    getChannelFormValuesMock.mockResolvedValue(undefined);
    providerServiceMock._listProvidersWithKeyInfoInternal.mockResolvedValue([]);
    providerServiceMock.getAccount.mockResolvedValue(null);
    providerServiceMock.getDefaultAccountId.mockResolvedValue(undefined);
    providerServiceMock.listAccounts.mockResolvedValue([]);
    providerServiceMock.listAccountsKeyInfo.mockResolvedValue([]);
    providerServiceMock.listVendors.mockResolvedValue([]);
    providerServiceMock.createAccount.mockImplementation(async (account: unknown) => account);
    providerServiceMock.setDefaultAccount.mockResolvedValue(undefined);
    validateApiKeyWithProviderMock.mockResolvedValue({ valid: true });
    ensureFeishuPluginInstalledMock.mockResolvedValue({ installed: true });
    buildSandboxStatusMock.mockResolvedValue({
      requestedProviderId: 'policy-light',
      effectiveProviderId: 'policy-light',
      runtimeLevel: 'policy',
      degraded: false,
      permissionMode: 'acceptEdits',
      summary: 'Policy-light / acceptEdits / policy / network=disabled',
      updatedAt: 1,
      docker: { cli: false, daemon: false, image: false },
      execPolicy: { host: 'gateway', security: 'allowlist', ask: 'dangerous' },
      networkPolicy: 'disabled',
      workspaceAccess: 'none',
      providers: [],
      warnings: [],
      provider: {
        id: 'policy-light',
        label: 'Policy-light',
        available: true,
        runtimeLevel: 'policy',
        capabilities: [],
      },
      openClawConfig: {
        agents: {
          defaults: {
            sandbox: {
              mode: 'off',
              backend: 'openshell',
              scope: 'session',
              workspaceAccess: 'none',
            },
          },
        },
        tools: {
          exec: { host: 'gateway', security: 'allowlist', ask: 'dangerous' },
          sandbox: { tools: { alsoAllow: [] } },
        },
      },
    });
    rmSync(logDir, { recursive: true, force: true });
    rmSync(testOpenClawConfigDir, { recursive: true, force: true });
    mkdirSync(logDir, { recursive: true });
    mkdirSync(join(testOpenClawConfigDir, 'logs'), { recursive: true });
  });

  it('runs proxy side effects and restarts a running gateway after settings.set', async () => {
    const gatewayManager = {
      getStatus: vi.fn(() => ({ state: 'running', port: 18789 })),
      restart: vi.fn(),
    };
    const { createSettingsApi } = await import('@electron/services/settings-api');

    await expect(createSettingsApi(gatewayManager as never).set({
      key: 'proxyServer',
      value: 'http://127.0.0.1:7890',
    })).resolves.toEqual({ success: true });

    expect(setSettingMock).toHaveBeenCalledWith('proxyServer', 'http://127.0.0.1:7890');
    expect(syncProxyConfigToOpenClawMock).toHaveBeenCalledWith(baseSettings, {
      preserveExistingWhenDisabled: false,
    });
    expect(applyProxySettingsMock).toHaveBeenCalledWith(baseSettings);
    expect(gatewayManager.restart).toHaveBeenCalledTimes(1);
  });

  it('restarts a running gateway when the Role Memory setting changes', async () => {
    const gatewayManager = {
      getStatus: vi.fn(() => ({ state: 'running', port: 18789 })),
      restart: vi.fn(),
    };
    const { createSettingsApi } = await import('@electron/services/settings-api');

    await expect(createSettingsApi(gatewayManager as never).set({
      key: 'roleMemoryEnabled',
      value: false,
    })).resolves.toEqual({ success: true });

    expect(setSettingMock).toHaveBeenCalledWith('roleMemoryEnabled', false);
    expect(gatewayManager.restart).toHaveBeenCalledTimes(1);
  });

  it('runs launch-at-startup side effects after settings.setMany and reset', async () => {
    const gatewayManager = {
      getStatus: vi.fn(() => ({ state: 'stopped', port: 18789 })),
      restart: vi.fn(),
    };
    const { createSettingsApi } = await import('@electron/services/settings-api');
    const settingsApi = createSettingsApi(gatewayManager as never);

    await expect(settingsApi.setMany({ patch: { launchAtStartup: true } })).resolves.toEqual({ success: true });
    await expect(settingsApi.reset()).resolves.toEqual({ success: true, settings: baseSettings });

    expect(setSettingMock).toHaveBeenCalledWith('launchAtStartup', true);
    expect(resetSettingsMock).toHaveBeenCalledTimes(1);
    expect(syncLaunchAtStartupSettingFromStoreMock).toHaveBeenCalledTimes(2);
    expect(syncProxyConfigToOpenClawMock).toHaveBeenCalledTimes(1);
    expect(gatewayManager.restart).not.toHaveBeenCalled();
  });

  it('routes gateway rpc through backpressure', async () => {
    const gatewayManager = {
      rpc: vi.fn(async () => ({ ok: true })),
    };
    const backpressure = {
      run: vi.fn(async (_method, _params, _timeoutMs, runner) => runner('chat.history', { limit: 1 }, 42)),
    };
    const { createGatewayApi } = await import('@electron/services/gateway-api');

    await expect(createGatewayApi(gatewayManager as never, backpressure as never).rpc({
      method: 'chat.history',
      params: { limit: 1 },
      timeoutMs: 42,
    })).resolves.toEqual({ ok: true });

    expect(backpressure.run).toHaveBeenCalledWith(
      'chat.history',
      { limit: 1 },
      42,
      expect.any(Function),
    );
    expect(gatewayManager.rpc).toHaveBeenCalledWith('chat.history', { limit: 1 }, 42);
  });

  it('exposes provider account snapshot actions through the typed providers service', async () => {
    const account = {
      id: 'custom-local',
      vendorId: 'custom',
      label: 'Local',
      authMode: 'api_key',
      baseUrl: 'http://127.0.0.1:1234/v1',
      model: 'local-model',
      enabled: true,
      createdAt: '2026-05-31T00:00:00.000Z',
      updatedAt: '2026-05-31T00:00:00.000Z',
    };
    const keyInfo = [{ accountId: 'custom-local', hasKey: true, keyMasked: 'sk-***' }];
    providerServiceMock.listAccounts.mockResolvedValue([account]);
    providerServiceMock.listAccountsKeyInfo.mockResolvedValue(keyInfo);
    providerServiceMock.listVendors.mockResolvedValue([{ id: 'custom', name: 'Custom' }]);
    providerServiceMock.getDefaultAccountId.mockResolvedValue('custom-local');
    const { createProvidersApi } = await import('@electron/services/providers-api');
    const providersApi = createProvidersApi({
      gatewayManager: { debouncedReload: vi.fn() } as never,
      mainWindow: {} as never,
    });

    await expect(providersApi.accounts()).resolves.toEqual([account]);
    await expect(providersApi.accountKeyInfo()).resolves.toEqual(keyInfo);
    await expect(providersApi.vendors()).resolves.toEqual([{ id: 'custom', name: 'Custom' }]);
    await expect(providersApi.getDefaultAccount()).resolves.toEqual({ accountId: 'custom-local' });
  });

  it('validates provider keys using account metadata and caller options', async () => {
    providerServiceMock.getAccount.mockResolvedValue({
      id: 'custom-local',
      vendorId: 'custom',
      baseUrl: 'http://persisted.example/v1',
      apiProtocol: 'openai-completions',
    });
    validateApiKeyWithProviderMock.mockResolvedValue({ valid: true });
    const { createProvidersApi } = await import('@electron/services/providers-api');
    const providersApi = createProvidersApi({
      gatewayManager: {} as never,
      mainWindow: {} as never,
    });

    await expect(providersApi.validateKey({
      accountId: 'custom-local',
      apiKey: 'sk-test',
      options: { baseUrl: 'http://live.example/v1', apiProtocol: 'openai-responses' },
    })).resolves.toMatchObject({ valid: true });

    expect(validateApiKeyWithProviderMock).toHaveBeenCalledWith('custom', 'sk-test', {
      baseUrl: 'http://live.example/v1',
      apiProtocol: 'openai-responses',
    });
  });

  it('creates provider accounts and syncs runtime config through the typed providers service', async () => {
    const account = {
      id: 'custom-local',
      vendorId: 'custom',
      label: 'Local',
      authMode: 'api_key',
      baseUrl: 'http://127.0.0.1:1234/v1',
      model: 'local-model',
      enabled: true,
      createdAt: '2026-05-31T00:00:00.000Z',
      updatedAt: '2026-05-31T00:00:00.000Z',
    };
    providerServiceMock.createAccount.mockResolvedValue(account);
    const gatewayManager = { debouncedReload: vi.fn() };
    const { createProvidersApi } = await import('@electron/services/providers-api');

    await expect(createProvidersApi({
      gatewayManager: gatewayManager as never,
      mainWindow: {} as never,
    }).createAccount({ account: account as never, apiKey: 'sk-test' })).resolves.toEqual({
      success: true,
      account,
    });

    expect(providerServiceMock.createAccount).toHaveBeenCalledWith(account, 'sk-test');
    expect(providerAccountToConfigMock).toHaveBeenCalledWith(account);
    expect(syncSavedProviderToRuntimeMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'custom-local', type: 'custom' }),
      'sk-test',
      gatewayManager,
    );
  });

  it('sets the default provider account and syncs runtime defaults', async () => {
    providerServiceMock.getDefaultAccountId.mockResolvedValue('old-default');
    syncDefaultProviderToRuntimeMock.mockResolvedValue({ degraded: false });
    const gatewayManager = { debouncedReload: vi.fn() };
    const { createProvidersApi } = await import('@electron/services/providers-api');

    await expect(createProvidersApi({
      gatewayManager: gatewayManager as never,
      mainWindow: {} as never,
    }).setDefaultAccount({ accountId: 'custom-local' })).resolves.toEqual({ success: true });

    expect(providerServiceMock.setDefaultAccount).toHaveBeenCalledWith('custom-local');
    expect(syncDefaultProviderToRuntimeMock).toHaveBeenCalledWith('custom-local', gatewayManager);
  });

  it('reports degraded when the default account sync fails partially (R0-2)', async () => {
    providerServiceMock.getDefaultAccountId.mockResolvedValue('old-default');
    syncDefaultProviderToRuntimeMock.mockResolvedValue({ degraded: true, reason: 'models.json busy' });
    const { createProvidersApi } = await import('@electron/services/providers-api');

    await expect(createProvidersApi({
      gatewayManager: { debouncedReload: vi.fn() } as never,
      mainWindow: {} as never,
    }).setDefaultAccount({ accountId: 'custom-local' })).resolves.toEqual({
      success: true,
      degraded: true,
      reason: 'models.json busy',
    });
  });

  it('builds channel accounts from config without gateway rpc in config mode', async () => {
    const openClawConfig = {
      channels: {
        feishu: {
          defaultAccount: 'default',
          accounts: {
            'team-bot': { appId: 'cli_team', appSecret: 'secret' },
          },
        },
      },
    };
    readOpenClawConfigMock.mockResolvedValue(openClawConfig);
    listConfiguredChannelsFromConfigMock.mockResolvedValue(['feishu']);
    listConfiguredChannelAccountsFromConfigMock.mockReturnValue({
      feishu: {
        defaultAccountId: 'team-bot',
        accountIds: ['team-bot'],
      },
    });
    listAgentsSnapshotFromConfigMock.mockResolvedValue({
      agents: [{ id: 'main', name: 'Main' }],
      defaultAgentId: 'main',
      defaultModelRef: null,
      configuredChannelTypes: ['feishu'],
      channelOwners: {},
      channelAccountOwners: {
        'feishu:team-bot': 'main',
      },
    });
    const gatewayManager = {
      rpc: vi.fn(),
      getStatus: vi.fn(() => ({ state: 'running', port: 18789 })),
      getDiagnostics: vi.fn(() => ({ consecutiveHeartbeatMisses: 0, consecutiveRpcFailures: 0 })),
    };
    const { createChannelsApi } = await import('@electron/services/channels-api');

    await expect(createChannelsApi({ gatewayManager: gatewayManager as never }).accounts({ mode: 'config' }))
      .resolves.toMatchObject({
        success: true,
        channels: [
          {
            channelType: 'feishu',
            defaultAccountId: 'team-bot',
            accounts: [
              {
                accountId: 'team-bot',
                configured: true,
                isDefault: true,
                agentId: 'main',
              },
            ],
          },
        ],
      });

    expect(gatewayManager.rpc).not.toHaveBeenCalled();
  });

  it('lists channel targets from session history and validates channel type', async () => {
    const sessionsDir = join(testOpenClawConfigDir, 'agents', 'main', 'sessions');
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(join(sessionsDir, 'sessions.json'), JSON.stringify({
      sessions: [
        {
          deliveryContext: {
            channel: 'dingtalk',
            accountId: 'ding-main',
            to: 'cid-group-1',
          },
          displayName: 'Release Room',
          chatType: 'group',
          updatedAt: 100,
        },
      ],
    }));
    const { createChannelsApi } = await import('@electron/services/channels-api');
    const channelsApi = createChannelsApi({
      gatewayManager: {
        getStatus: vi.fn(() => ({ state: 'running' })),
        getDiagnostics: vi.fn(),
      } as never,
    });

    await expect(channelsApi.targets({ channelType: 'dingtalk', accountId: 'ding-main' }))
      .resolves.toEqual({
        success: true,
        channelType: 'dingtalk',
        accountId: 'ding-main',
        targets: [
          {
            value: 'cid-group-1',
            label: 'Release Room (cid-group-1)',
            kind: 'group',
          },
        ],
      });
    await expect(channelsApi.targets({ accountId: 'ding-main' } as never)).rejects.toThrow('channelType is required');
  });

  it('saves channel binding for existing agents and schedules channel refresh', async () => {
    listAgentsSnapshotMock.mockResolvedValue({
      agents: [{ id: 'main', name: 'Main' }],
      defaultAgentId: 'main',
      defaultModelRef: null,
      configuredChannelTypes: ['feishu'],
      channelOwners: {},
      channelAccountOwners: {},
    });
    const gatewayManager = {
      getStatus: vi.fn(() => ({ state: 'running', port: 18789 })),
      debouncedRestart: vi.fn(),
      debouncedReload: vi.fn(),
    };
    const { createChannelsApi } = await import('@electron/services/channels-api');

    await expect(createChannelsApi({ gatewayManager: gatewayManager as never }).bindingSave({
      channelType: 'feishu',
      accountId: 'default',
      agentId: 'main',
    })).resolves.toEqual({ success: true });

    expect(assignChannelAccountToAgentMock).toHaveBeenCalledWith('main', 'feishu', 'default');
    expect(gatewayManager.debouncedRestart).toHaveBeenCalledWith(150);
    expect(gatewayManager.debouncedReload).not.toHaveBeenCalled();
  });

  it('installs plugin, saves config, ensures scoped binding, and schedules refresh on saveConfig', async () => {
    listAgentsSnapshotMock.mockResolvedValue({
      agents: [{ id: 'main', name: 'Main' }],
      defaultAgentId: 'main',
      defaultModelRef: null,
      configuredChannelTypes: ['feishu'],
      channelOwners: {},
      channelAccountOwners: {},
    });
    getChannelFormValuesMock.mockResolvedValue({ appId: 'old', appSecret: 'old-secret' });
    const gatewayManager = {
      getStatus: vi.fn(() => ({ state: 'running', port: 18789 })),
      debouncedRestart: vi.fn(),
      debouncedReload: vi.fn(),
    };
    const { createChannelsApi } = await import('@electron/services/channels-api');

    await expect(createChannelsApi({ gatewayManager: gatewayManager as never }).saveConfig({
      channelType: 'feishu',
      accountId: 'default',
      config: { appId: 'cli_new', appSecret: 'new-secret' },
    })).resolves.toEqual({ success: true });

    expect(ensureFeishuPluginInstalledMock).toHaveBeenCalledTimes(1);
    expect(saveChannelConfigMock).toHaveBeenCalledWith(
      'feishu',
      { appId: 'cli_new', appSecret: 'new-secret' },
      'default',
    );
    expect(assignChannelAccountToAgentMock).toHaveBeenCalledWith('main', 'feishu', 'default');
    expect(gatewayManager.debouncedRestart).toHaveBeenCalledWith(150);
  });

  it('deletes agents by restarting gateway, removing workspace, and returning snapshot', async () => {
    const snapshot = {
      agents: [],
      defaultAgentId: 'main',
      defaultModelRef: null,
      configuredChannelTypes: [],
      channelOwners: {},
      channelAccountOwners: {},
    };
    const removedEntry = { id: 'code', workspace: '/tmp/code-workspace' };
    deleteAgentConfigMock.mockResolvedValue({ snapshot, removedEntry });
    removeAgentWorkspaceDirectoryMock.mockResolvedValue(undefined);
    const gatewayManager = {
      getStatus: vi.fn(() => ({ state: 'running' })),
      restart: vi.fn().mockResolvedValue(undefined),
    };
    const { createAgentsApi } = await import('@electron/services/agents-api');

    await expect(createAgentsApi({ gatewayManager: gatewayManager as never }).delete({ id: 'code' }))
      .resolves.toEqual({ success: true, ...snapshot });

    expect(deleteAgentConfigMock).toHaveBeenCalledWith('code');
    expect(gatewayManager.restart).toHaveBeenCalledTimes(1);
    expect(removeAgentWorkspaceDirectoryMock).toHaveBeenCalledWith(removedEntry);
  });

  it('updates and resets avatars through the typed agents Host API', async () => {
    const snapshot = {
      agents: [],
      defaultAgentId: 'main',
      defaultModelRef: null,
      configuredChannelTypes: [],
      channelOwners: {},
      channelAccountOwners: {},
    };
    updateAgentAvatarMock.mockResolvedValue(snapshot);
    resetAgentAvatarMock.mockResolvedValue(snapshot);
    const gatewayManager = {
      getStatus: vi.fn(() => ({ state: 'running' })),
      debouncedReload: vi.fn(),
    };
    const { createAgentsApi } = await import('@electron/services/agents-api');
    const api = createAgentsApi({ gatewayManager: gatewayManager as never });
    const preset = { style: 'identicon' as const, seed: 'host-api', backgroundColor: '#dbeafe' };

    await expect(api.updateAvatar({ id: 'research', preset })).resolves.toEqual({ success: true, ...snapshot });
    await expect(api.resetAvatar({ id: 'research' })).resolves.toEqual({ success: true, ...snapshot });

    expect(updateAgentAvatarMock).toHaveBeenCalledWith('research', preset);
    expect(resetAgentAvatarMock).toHaveBeenCalledWith('research');
    expect(gatewayManager.debouncedReload).toHaveBeenCalledTimes(2);
  });

  it('reads and updates agent bootstrap tooling config', async () => {
    readAgentSoulMock.mockResolvedValue({
      soulMd: '# Soul',
      path: '/tmp/main/SOUL.md',
    });
    readAgentBootstrapToolsMock.mockResolvedValue({
      defaultSkillIds: ['browser'],
      defaultMcpServerIds: ['filesystem'],
    });
    writeAgentSoulMock.mockResolvedValue({
      soulMd: '# Updated',
      path: '/tmp/main/SOUL.md',
    });
    writeAgentBootstrapToolsMock.mockResolvedValue({
      defaultSkillIds: ['browser', 'docs'],
      defaultMcpServerIds: ['filesystem', 'db'],
    });
    const gatewayManager = {
      getStatus: vi.fn(() => ({ state: 'running' })),
      debouncedReload: vi.fn(),
    };
    const { createAgentsApi } = await import('@electron/services/agents-api');
    const api = createAgentsApi({ gatewayManager: gatewayManager as never });

    await expect(api.getBootstrap({ id: 'main' })).resolves.toMatchObject({
      success: true,
      agentId: 'main',
      soulMd: '# Soul',
      defaultSkillIds: ['browser'],
      defaultMcpServerIds: ['filesystem'],
    });

    await expect(api.updateBootstrap({
      id: 'main',
      soulMd: '# Updated',
      defaultSkillIds: ['browser', 'docs'],
      defaultMcpServerIds: ['filesystem', 'db'],
    })).resolves.toMatchObject({
      success: true,
      agentId: 'main',
      soulMd: '# Updated',
      defaultSkillIds: ['browser', 'docs'],
      defaultMcpServerIds: ['filesystem', 'db'],
    });

    expect(writeAgentSoulMock).toHaveBeenCalledWith('main', '# Updated');
    expect(writeAgentBootstrapToolsMock).toHaveBeenCalledWith('main', {
      defaultSkillIds: ['browser', 'docs'],
      defaultMcpServerIds: ['filesystem', 'db'],
    });
    expect(gatewayManager.debouncedReload).toHaveBeenCalledTimes(1);
  });

  it('assigns agent channels and schedules gateway reload', async () => {
    const snapshot = {
      agents: [{ id: 'main', channelTypes: ['feishu'] }],
      defaultAgentId: 'main',
      defaultModelRef: null,
      configuredChannelTypes: ['feishu'],
      channelOwners: { feishu: 'main' },
      channelAccountOwners: {},
    };
    assignChannelToAgentMock.mockResolvedValue(snapshot);
    const gatewayManager = {
      getStatus: vi.fn(() => ({ state: 'running' })),
      debouncedReload: vi.fn(),
    };
    const { createAgentsApi } = await import('@electron/services/agents-api');

    await expect(createAgentsApi({ gatewayManager: gatewayManager as never }).assignChannel({
      id: 'main',
      channelType: 'feishu',
    })).resolves.toEqual({ success: true, ...snapshot });

    expect(assignChannelToAgentMock).toHaveBeenCalledWith('main', 'feishu');
    expect(gatewayManager.debouncedReload).toHaveBeenCalledTimes(1);
  });

  it('returns diagnostics snapshot with channel view and log tails', async () => {
    writeFileSync(join(testOpenClawConfigDir, 'logs', 'gateway.log'), 'gateway-one\ngateway-two\n');
    readLogFileMock.mockResolvedValue('verse-claw-log-tail');
    readOpenClawConfigMock.mockResolvedValue({
      channels: {
        feishu: {
          defaultAccount: 'default',
        },
      },
    });
    listConfiguredChannelsFromConfigMock.mockResolvedValue(['feishu']);
    listConfiguredChannelAccountsFromConfigMock.mockReturnValue({
      feishu: {
        defaultAccountId: 'default',
        accountIds: ['default'],
      },
    });
    listAgentsSnapshotFromConfigMock.mockResolvedValue({
      agents: [{ id: 'main', name: 'Main' }],
      defaultAgentId: 'main',
      defaultModelRef: null,
      configuredChannelTypes: ['feishu'],
      channelOwners: {},
      channelAccountOwners: {
        'feishu:default': 'main',
      },
    });
    const gatewayManager = {
      rpc: vi.fn().mockResolvedValue({
        channels: { feishu: { configured: true } },
        channelAccounts: {
          feishu: [{ accountId: 'default', configured: true, connected: true, running: true, linked: true }],
        },
        channelDefaultAccountId: { feishu: 'default' },
      }),
      getStatus: vi.fn(() => ({ state: 'running', port: 18789 })),
      getDiagnostics: vi.fn(() => ({
        consecutiveHeartbeatMisses: 0,
        consecutiveRpcFailures: 0,
      })),
      getCapabilitySnapshot: vi.fn(() => ({ rpc: true })),
    };
    const { createDiagnosticsApi } = await import('@electron/services/diagnostics-api');

    const snapshot = await createDiagnosticsApi({ gatewayManager: gatewayManager as never }).gatewaySnapshot();

    expect(snapshot).toMatchObject({
      platform: process.platform,
      channels: [
        expect.objectContaining({
          channelType: 'feishu',
          accounts: [expect.objectContaining({ accountId: 'default', agentId: 'main' })],
        }),
      ],
      verseClawLogTail: 'verse-claw-log-tail',
      gateway: expect.objectContaining({
        state: 'healthy',
        capabilities: { rpc: true },
      }),
      sandbox: expect.objectContaining({
        effectiveProviderId: 'policy-light',
        runtimeLevel: 'policy',
        docker: { cli: false, daemon: false, image: false },
      }),
    });
    expect(snapshot.gatewayLogTail).toContain('gateway-one');
    expect(snapshot.gatewayErrLogTail).toBe('');
  });

  it('reads only selected log files from the log directory', async () => {
    const selectedLog = join(logDir, 'verse-claw-selected.log');
    writeFileSync(selectedLog, 'one\ntwo\nthree\n');
    listLogFilesMock.mockResolvedValue([{ name: 'verse-claw-selected.log', path: selectedLog, size: 14, modified: 'now' }]);
    const { createLogsApi } = await import('@electron/services/logs-api');

    await expect(createLogsApi().readFile({ path: selectedLog, tailLines: 2 })).resolves.toEqual({
      content: 'two\nthree\n',
    });
    await expect(createLogsApi().readFile({ path: join(tmpdir(), 'outside.log') })).rejects.toThrow(
      'Invalid log file path',
    );
  });

  it('sends staged media through the typed chat service with gateway attachments', async () => {
    const mediaPath = join(tmpdir(), `verse-claw-host-services-media-${Date.now()}.png`);
    writeFileSync(mediaPath, 'fake-image-bytes');
    const gatewayManager = {
      getStatus: vi.fn(() => ({ state: 'running' })),
      rpc: vi.fn().mockResolvedValue({ runId: 'run-123' }),
    };
    const { createChatApi } = await import('@electron/services/chat-api');

    await expect(createChatApi({ gatewayManager: gatewayManager as never }).sendWithMedia({
      sessionKey: 'agent:main:main',
      message: 'inspect this',
      idempotencyKey: 'idem-123',
      media: [{ filePath: mediaPath, mimeType: 'image/png', fileName: 'image.png' }],
    })).resolves.toEqual({ success: true, result: { runId: 'run-123' } });

    expect(gatewayManager.rpc).toHaveBeenCalledWith(
      'chat.send',
      {
        sessionKey: 'agent:main:main',
        message: `inspect this\n\n[media attached: ${mediaPath} (image/png) | ${mediaPath}]`,
        deliver: false,
        idempotencyKey: 'idem-123',
        attachments: [{
          content: Buffer.from('fake-image-bytes').toString('base64'),
          mimeType: 'image/png',
          fileName: 'image.png',
        }],
      },
      120000,
    );
  });

  it('loads session summaries and transcript history through the typed sessions service', async () => {
    const sessionsDir = join(testOpenClawConfigDir, 'agents', 'main', 'sessions');
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(join(sessionsDir, 'sessions.json'), JSON.stringify({
      sessions: [
        {
          key: 'agent:main:abc123',
          file: 'abc123.jsonl',
        },
      ],
    }));
    writeFileSync(join(sessionsDir, 'abc123.jsonl'), [
      JSON.stringify({
        type: 'message',
        message: {
          role: 'user',
          content: 'Hello from transcript',
          timestamp: 1000,
        },
      }),
      JSON.stringify({
        type: 'message',
        message: {
          role: 'assistant',
          content: 'Hi',
          timestamp: 1001,
        },
      }),
    ].join('\n'));
    const { createSessionsApi } = await import('@electron/services/sessions-api');
    const sessionsApi = createSessionsApi();

    await expect(sessionsApi.summaries({ sessionKeys: ['agent:main:abc123'] }))
      .resolves.toEqual({
        success: true,
        summaries: [{
           sessionKey: 'agent:main:abc123',
           firstUserText: 'Hello from transcript',
           lastTimestamp: 1001000,
           messageCount: 1,
        }],
      });
    await expect(sessionsApi.history({ sessionKey: 'agent:main:abc123', limit: 5 }))
      .resolves.toMatchObject({
        success: true,
        messages: [
          { role: 'user', content: 'Hello from transcript', timestamp: 1000 },
          { role: 'assistant', content: 'Hi', timestamp: 1001 },
        ],
      });
  });

  it('reports compaction status unavailable when Gateway is missing', async () => {
    const { createSessionsApi } = await import('@electron/services/sessions-api');
    const sessionsApi = createSessionsApi();

    await expect(sessionsApi.compactionStatus({ sessionKey: 'agent:main:main' }))
      .resolves.toMatchObject({
        success: true,
        available: false,
        canCompact: false,
        reason: 'gateway_unavailable',
      });
  });

  it('reports long-task control status unavailable when Gateway is missing', async () => {
    const { createSessionsApi } = await import('@electron/services/sessions-api');
    const sessionsApi = createSessionsApi();

    await expect(sessionsApi.longTaskControlStatus({ sessionKey: 'agent:main:main' }))
      .resolves.toMatchObject({
        success: true,
        available: false,
        key: 'agent:main:main',
        queueCount: 0,
        warnings: ['gateway_unavailable'],
      });
  });

  it('proxies long-task control RPCs through Gateway', async () => {
    const checkpoint = {
      id: 'ltcp-1',
      sessionKey: 'agent:main:main',
      trigger: 'queue_drain',
      status: 'active',
      checkpoint: {
        schemaVersion: 1,
        trigger: 'queue_drain',
        openBlockers: [],
        decisions: [],
        deviations: [],
        filesTouched: [],
        testsRun: [],
        reviewNeededItems: [],
        evidenceRefs: [{ type: 'session', ref: 'agent:main:main' }],
        createdAt: new Date(1).toISOString(),
      },
      createdAt: 1,
      updatedAt: 1,
    };
    const event = {
      id: 'ltie-1',
      sessionKey: 'agent:main:main',
      mode: 'queue',
      trigger: 'queue_drain',
      status: 'queued',
      payload: { message: 'later' },
      createdAt: 2,
      updatedAt: 2,
    };
    const rpc = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        key: 'agent:main:main',
        available: true,
        queueCount: 1,
        latestCheckpoint: checkpoint,
        latestIntervention: event,
        warnings: [],
      })
      .mockResolvedValueOnce({ ok: true, key: 'agent:main:main', events: [event] })
      .mockResolvedValueOnce({ ok: true, key: 'agent:main:main', checkpoints: [checkpoint] })
      .mockResolvedValueOnce({ ok: true, key: 'agent:main:main', drained: true, queueCount: 0, messageCount: 1 });
    const { createSessionsApi } = await import('@electron/services/sessions-api');
    const sessionsApi = createSessionsApi({ gatewayManager: { rpc } as never });

    await expect(sessionsApi.longTaskControlStatus({ sessionKey: 'agent:main:main' }))
      .resolves.toMatchObject({
        success: true,
        available: true,
        queueCount: 1,
        latestCheckpoint: { id: 'ltcp-1' },
        latestIntervention: { id: 'ltie-1' },
      });
    await expect(sessionsApi.longTaskControlHistory({ sessionKey: 'agent:main:main', limit: 3 }))
      .resolves.toMatchObject({ success: true, events: [{ id: 'ltie-1' }] });
    await expect(sessionsApi.resumeCheckpoints({ sessionKey: 'agent:main:main', limit: 2 }))
      .resolves.toMatchObject({ success: true, checkpoints: [{ id: 'ltcp-1' }] });
    await expect(sessionsApi.queueDrain({ sessionKey: 'agent:main:main' }))
      .resolves.toMatchObject({ success: true, drained: true, queueCount: 0, messageCount: 1 });

    expect(rpc).toHaveBeenNthCalledWith(1, 'sessions.longTaskControlStatus', expect.objectContaining({
      key: 'agent:main:main',
    }), 10_000);
    expect(rpc).toHaveBeenNthCalledWith(4, 'sessions.queueDrain', expect.objectContaining({
      key: 'agent:main:main',
    }), 30_000);
  });

  it('proxies manual compaction to Gateway with force and appended instructions', async () => {
    const rpc = vi.fn().mockResolvedValue({
      ok: true,
      key: 'agent:main:main',
      compacted: true,
      result: {
        summary: 'Compacted summary',
        firstKeptEntryId: 'entry-2',
        tokensBefore: 1000,
        tokensAfter: 250,
        sessionId: 'session-1',
      },
    });
    const { createSessionsApi } = await import('@electron/services/sessions-api');
    const sessionsApi = createSessionsApi({ gatewayManager: { rpc } as never });

    await expect(sessionsApi.compact({
      sessionKey: 'agent:main:main',
      customInstructions: 'Preserve decision D1.',
    })).resolves.toMatchObject({
      success: true,
      compacted: true,
      tokensBefore: 1000,
      tokensAfter: 250,
    });
    expect(rpc).toHaveBeenCalledWith('sessions.compact', expect.objectContaining({
      key: 'agent:main:main',
      force: true,
      customInstructions: expect.stringContaining('Preserve decision D1.'),
    }), 120_000);
  });

  it('proxies read-only context recall through Gateway without local archive reads', async () => {
    const archiveHandle = {
      uri: 'context-archive://session-1/tool.context-archive.json',
      checksum: `sha256:${'a'.repeat(64)}`,
      byteLength: 15,
    };
    const rpc = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        payload: 'archived output',
        archiveHandle: archiveHandle as never,
        diagnostics: [],
      })
      .mockResolvedValueOnce({
        ok: false,
        diagnostics: [{ code: 'missing_selector', message: 'No selector was available.' }],
      });
    const { createSessionsApi } = await import('@electron/services/sessions-api');
    const sessionsApi = createSessionsApi({ gatewayManager: { rpc } as never });

    await expect(sessionsApi.recallOriginal({
      sessionKey: 'agent:main:main',
      archiveHandle: archiveHandle as never,
    })).resolves.toMatchObject({
      success: true,
      ok: true,
      payload: 'archived output',
      diagnostics: [],
    });
    await expect(sessionsApi.expandSelector({
      sessionKey: 'agent:main:main',
      resourceId: 'resource:demo',
      selector: 'selector:missing',
      checksum: `sha256:${'b'.repeat(64)}`,
    })).resolves.toMatchObject({
      success: true,
      ok: false,
      diagnostics: [{ code: 'missing_selector' }],
    });

    expect(rpc).toHaveBeenNthCalledWith(1, 'sessions.recallOriginal', expect.objectContaining({
      key: 'agent:main:main',
      archiveHandle,
    }), 10_000);
    expect(rpc).toHaveBeenNthCalledWith(2, 'sessions.expandSelector', expect.objectContaining({
      key: 'agent:main:main',
      resourceId: 'resource:demo',
      selector: 'selector:missing',
    }), 10_000);
  });

  it('forks sessions through Gateway without local transcript fallback', async () => {
    const rpc = vi.fn().mockResolvedValue({
      key: 'agent:main:dashboard:fork',
      sourceKey: 'agent:main:main',
      forkedFromParent: true,
    });
    const { createSessionsApi } = await import('@electron/services/sessions-api');
    const sessionsApi = createSessionsApi({ gatewayManager: { rpc } as never });

    await expect(sessionsApi.fork({
      sessionKey: 'agent:main:main',
      workspaceId: 'workspace-a',
    })).resolves.toMatchObject({
      success: true,
      sourceSessionKey: 'agent:main:main',
      sessionKey: 'agent:main:dashboard:fork',
      forkedFromParent: true,
    });
    expect(rpc).toHaveBeenCalledWith('sessions.fork', expect.objectContaining({
      key: 'agent:main:main',
      agentId: 'main',
    }), 30_000);
  });

  it('does not fork locally when Gateway is unavailable', async () => {
    const { createSessionsApi } = await import('@electron/services/sessions-api');
    const sessionsApi = createSessionsApi();

    await expect(sessionsApi.fork({
      sessionKey: 'agent:main:main',
      workspaceId: 'workspace-a',
    })).resolves.toMatchObject({
      success: false,
      error: 'Gateway manager unavailable',
      forkedFromParent: false,
    });
  });

  it('prepares deterministic session handoff without requiring Gateway', async () => {
    const sessionsDir = join(testOpenClawConfigDir, 'agents', 'main', 'sessions');
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(join(sessionsDir, 'sessions.json'), JSON.stringify({
      sessions: [
        {
          key: 'agent:main:handoff',
          file: 'handoff.jsonl',
        },
      ],
    }));
    writeFileSync(join(sessionsDir, 'handoff.jsonl'), [
      JSON.stringify({
        type: 'message',
        message: {
          role: 'user',
          content: 'Please implement handoff MVP in src/pages/Chat/index.tsx',
          timestamp: 1000,
        },
      }),
      JSON.stringify({
        type: 'message',
        message: {
          role: 'assistant',
          content: 'Decision: use deterministic template.\npnpm run typecheck failed once.',
          timestamp: 1001,
        },
      }),
    ].join('\n'));
    const { createSessionsApi } = await import('@electron/services/sessions-api');
    const sessionsApi = createSessionsApi();

    const result = await sessionsApi.prepareHandoff({
      sessionKey: 'agent:main:handoff',
      workspaceId: 'workspace-a',
    });
    expect(result).toMatchObject({
      success: true,
      checkpoint: {
        trigger: 'session_rotation',
        sessionKey: 'agent:main:handoff',
        objective: expect.stringContaining('handoff MVP'),
        decisions: expect.arrayContaining([expect.stringContaining('deterministic template')]),
        testsRun: expect.arrayContaining([expect.stringContaining('pnpm run typecheck')]),
      },
      draft: expect.stringContaining('Handoff: continue this Verse Claw conversation'),
      sources: expect.arrayContaining([
        expect.objectContaining({ id: 'compression_artifact', available: false }),
        expect.objectContaining({ id: 'transcript', available: true }),
        expect.objectContaining({ id: 'task_ledger' }),
        expect.objectContaining({ id: 'git' }),
        expect.objectContaining({ id: 'observability' }),
      ]),
    });
    expect(result.draft).toContain('## Current objective');
    expect(result.draft).toContain('## Recently confirmed');
    expect(result.draft).toContain('## In progress');
    expect(result.draft).toContain('## Blockers and risks');
    expect(result.draft).toContain('## Evidence sources');
  });

  it('merges runtime checkpoint handoff with ledger, git, observability, and transcript sources', async () => {
    const archiveHandle = {
      uri: 'context-archive://session-checkpoint/checkpoint.context-archive.json',
      checksum: `sha256:${'c'.repeat(64)}`,
      byteLength: 42,
    };
    const sessionsDir = join(testOpenClawConfigDir, 'agents', 'main', 'sessions');
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(join(sessionsDir, 'sessions.json'), JSON.stringify({
      sessions: [
        {
          key: 'agent:main:checkpoint',
          file: 'checkpoint.jsonl',
        },
      ],
    }));
    writeFileSync(join(sessionsDir, 'checkpoint.jsonl'), JSON.stringify({
      type: 'message',
      message: {
        role: 'user',
        content: 'Continue the checkpoint migration.',
        timestamp: 1000,
      },
    }));
    const rpc = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        key: 'agent:main:checkpoint',
        checkpointId: 'ltcp-1',
        context: 'Token-dense recovery projection from runtime.',
        projectionTokens: 256,
        quality: {
          score: 0.92,
          level: 'high',
          fieldCoverage: 0.9,
          evidenceCoverage: 0.8,
          artifactTokens: 900,
          projectionTokens: 256,
          warnings: [],
        },
        warnings: ['projection clipped'],
      })
      .mockResolvedValueOnce({
        ok: true,
        key: 'agent:main:checkpoint',
        checkpoints: [{
          id: 'ltcp-1',
          sessionKey: 'agent:main:checkpoint',
          agentId: 'main',
          workspaceId: 'workspace-a',
          trigger: 'compaction',
          status: 'ready',
          archiveHandle: archiveHandle as never,
          checkpoint: {
            schemaVersion: 1,
            id: 'ltcp-1',
            sessionKey: 'agent:main:checkpoint',
            agentId: 'main',
            workspaceId: 'workspace-a',
            trigger: 'compaction',
            objective: 'Checkpoint-first handoff',
            activeTask: 'Use the runtime checkpoint first.',
            openBlockers: ['runtime blocker'],
            decisions: ['runtime decision'],
            deviations: [],
            filesTouched: ['src/pages/Chat/index.tsx'],
            testsRun: [],
            nextAction: 'Merge ecosystem sources into the handoff draft.',
            reviewNeededItems: [],
            evidenceRefs: [{ type: 'session', ref: 'agent:main:checkpoint' }],
            createdAt: new Date(0).toISOString(),
          },
          createdAt: 1,
          updatedAt: 1,
        }],
      })
      .mockResolvedValueOnce({
        ok: true,
        payload: 'Verified archived pre-compaction transcript excerpt.',
        archiveHandle: archiveHandle as never,
        diagnostics: [],
    });
    const { createSessionsApi } = await import('@electron/services/sessions-api');
    const sessionsApi = createSessionsApi({ gatewayManager: { rpc } as never });

    const handoff = await sessionsApi.prepareHandoff({
      sessionKey: 'agent:main:checkpoint',
      workspaceId: 'workspace-a',
    });

    expect(handoff).toMatchObject({
      success: true,
      checkpoint: {
        trigger: 'compaction',
        objective: 'Checkpoint-first handoff',
        metadata: {
          source: 'clawx-session-handoff-ecosystem',
          runtimeCheckpoint: true,
          recoveryContext: true,
          recoveryCheckpointId: 'ltcp-1',
        },
      },
      draft: expect.stringContaining('Token-dense recovery projection from runtime.'),
      sources: expect.arrayContaining([
        expect.objectContaining({ id: 'compression_artifact', available: true }),
        expect.objectContaining({ id: 'context_recall', available: true }),
        expect.objectContaining({ id: 'runtime_checkpoint', available: true }),
        expect.objectContaining({ id: 'transcript', available: true }),
        expect.objectContaining({ id: 'task_ledger' }),
        expect.objectContaining({ id: 'git' }),
        expect.objectContaining({ id: 'observability' }),
      ]),
      warnings: expect.arrayContaining(['Recovery context warning: projection clipped']),
    });
    expect(handoff.draft).toContain('Verified archived pre-compaction transcript excerpt.');
    expect(rpc).toHaveBeenNthCalledWith(3, 'sessions.recallOriginal', expect.objectContaining({
      key: 'agent:main:checkpoint',
      archiveHandle,
    }), 10_000);
    expect(rpc).toHaveBeenNthCalledWith(1, 'sessions.recoveryContext', expect.objectContaining({
      key: 'agent:main:checkpoint',
      budgetTokens: 1800,
      purpose: 'session_handoff',
    }), 10_000);
    expect(rpc).toHaveBeenNthCalledWith(2, 'sessions.resumeCheckpoints', expect.objectContaining({
      key: 'agent:main:checkpoint',
      limit: 1,
    }), 10_000);
  });
});
