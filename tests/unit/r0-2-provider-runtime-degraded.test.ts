// @vitest-environment node
// R0-2: syncDefaultProviderToRuntime must return a degraded outcome when
// the per-agent models.json sync fails instead of silently succeeding.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GatewayManager } from '@electron/gateway/manager';
import type { ProviderConfig } from '@electron/utils/secure-storage';

const mocks = vi.hoisted(() => ({
  getProviderAccount: vi.fn(),
  listProviderAccounts: vi.fn(),
  getProviderSecret: vi.fn(),
  getAllProviders: vi.fn(),
  getApiKey: vi.fn(),
  getDefaultProvider: vi.fn(),
  getProvider: vi.fn(),
  getProviderConfig: vi.fn(),
  getProviderDefaultModel: vi.fn(),
  ensureAnthropicMessagesModelMaxTokens: vi.fn(),
  ensureOpenClawProviderAgentRuntimePins: vi.fn(),
  pruneInvalidApiProviderEntries: vi.fn(),
  removeProviderFromOpenClaw: vi.fn(),
  removeProviderKeyFromOpenClaw: vi.fn(),
  saveOAuthTokenToOpenClaw: vi.fn(),
  saveProviderKeyToOpenClaw: vi.fn(),
  setOpenClawDefaultModel: vi.fn(),
  setOpenClawDefaultModelWithOverride: vi.fn(),
  syncProviderConfigToOpenClaw: vi.fn(),
  updateAgentModelProvider: vi.fn(),
  updateSingleAgentModelProvider: vi.fn(),
  listAgentsSnapshot: vi.fn(),
}));

vi.mock('@electron/services/providers/provider-store', () => ({
  getProviderAccount: mocks.getProviderAccount,
  listProviderAccounts: mocks.listProviderAccounts,
}));

vi.mock('@electron/services/secrets/secret-store', () => ({
  getProviderSecret: mocks.getProviderSecret,
}));

vi.mock('@electron/utils/secure-storage', () => ({
  getAllProviders: mocks.getAllProviders,
  getApiKey: mocks.getApiKey,
  getDefaultProvider: mocks.getDefaultProvider,
  getProvider: mocks.getProvider,
}));

vi.mock('@electron/utils/provider-registry', () => ({
  getProviderConfig: mocks.getProviderConfig,
  getProviderDefaultModel: mocks.getProviderDefaultModel,
}));

vi.mock('@electron/utils/openclaw-auth', () => ({
  ensureAnthropicMessagesModelMaxTokens: mocks.ensureAnthropicMessagesModelMaxTokens,
  ensureOpenClawProviderAgentRuntimePins: mocks.ensureOpenClawProviderAgentRuntimePins,
  pruneInvalidApiProviderEntries: mocks.pruneInvalidApiProviderEntries,
  removeProviderFromOpenClaw: mocks.removeProviderFromOpenClaw,
  removeProviderKeyFromOpenClaw: mocks.removeProviderKeyFromOpenClaw,
  saveOAuthTokenToOpenClaw: mocks.saveOAuthTokenToOpenClaw,
  saveProviderKeyToOpenClaw: mocks.saveProviderKeyToOpenClaw,
  setOpenClawDefaultModel: mocks.setOpenClawDefaultModel,
  setOpenClawDefaultModelWithOverride: mocks.setOpenClawDefaultModelWithOverride,
  syncProviderConfigToOpenClaw: mocks.syncProviderConfigToOpenClaw,
  updateAgentModelProvider: mocks.updateAgentModelProvider,
  updateSingleAgentModelProvider: mocks.updateSingleAgentModelProvider,
}));

vi.mock('@electron/utils/agent-config', () => ({
  listAgentsSnapshot: mocks.listAgentsSnapshot,
}));

vi.mock('@electron/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { syncDefaultProviderToRuntime } from '@electron/services/providers/provider-runtime-sync';

function createProvider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'moonshot',
    name: 'Moonshot',
    type: 'moonshot',
    model: 'kimi-k2.6',
    enabled: true,
    createdAt: '2026-03-14T00:00:00.000Z',
    updatedAt: '2026-03-14T00:00:00.000Z',
    ...overrides,
  };
}

function createGateway(state: 'running' | 'stopped' = 'running'): Pick<GatewayManager, 'debouncedReload' | 'debouncedRestart' | 'getStatus'> {
  return {
    debouncedReload: vi.fn(),
    debouncedRestart: vi.fn(),
    getStatus: vi.fn(() => ({ state } as ReturnType<GatewayManager['getStatus']>)),
  };
}

describe('R0-2 syncDefaultProviderToRuntime degraded outcome', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProviderAccount.mockResolvedValue(null);
    mocks.getProviderSecret.mockResolvedValue(undefined);
    mocks.getAllProviders.mockResolvedValue([]);
    mocks.getApiKey.mockResolvedValue('sk-test');
    mocks.getDefaultProvider.mockResolvedValue('moonshot');
    mocks.getProvider.mockResolvedValue(createProvider());
    mocks.getProviderDefaultModel.mockReturnValue('kimi-k2.6');
    mocks.getProviderConfig.mockReturnValue({
      api: 'openai-completions',
      baseUrl: 'https://api.moonshot.cn/v1',
      apiKeyEnv: 'MOONSHOT_API_KEY',
    });
    mocks.ensureAnthropicMessagesModelMaxTokens.mockResolvedValue([]);
    mocks.ensureOpenClawProviderAgentRuntimePins.mockResolvedValue([]);
    mocks.pruneInvalidApiProviderEntries.mockResolvedValue([]);
    mocks.syncProviderConfigToOpenClaw.mockResolvedValue(undefined);
    mocks.setOpenClawDefaultModel.mockResolvedValue(undefined);
    mocks.setOpenClawDefaultModelWithOverride.mockResolvedValue(undefined);
    mocks.saveProviderKeyToOpenClaw.mockResolvedValue(undefined);
    mocks.saveOAuthTokenToOpenClaw.mockResolvedValue(undefined);
    mocks.removeProviderFromOpenClaw.mockResolvedValue(undefined);
    mocks.removeProviderKeyFromOpenClaw.mockResolvedValue(undefined);
    mocks.updateAgentModelProvider.mockResolvedValue(undefined);
    mocks.updateSingleAgentModelProvider.mockResolvedValue(undefined);
    mocks.listAgentsSnapshot.mockResolvedValue({ agents: [] });
  });

  it('reports degraded when the MiniMax OAuth models.json update fails', async () => {
    mocks.getProvider.mockResolvedValue(createProvider({ id: 'mm', type: 'minimax-portal', model: 'MiniMax-M2' }));
    mocks.getApiKey.mockResolvedValue(undefined);
    mocks.updateAgentModelProvider.mockRejectedValue(new Error('disk full'));

    const outcome = await syncDefaultProviderToRuntime('mm');

    expect(outcome.degraded).toBe(true);
    expect(outcome.reason).toContain('models.json');
    expect(outcome.reason).toContain('disk full');
  });

  it('reports degraded when the browser OAuth per-agent sync fails', async () => {
    mocks.getProvider.mockResolvedValue(createProvider({ id: 'openai-personal', type: 'openai', model: undefined }));
    mocks.getProviderAccount.mockResolvedValue({ authMode: 'oauth_browser' });
    mocks.getProviderSecret.mockResolvedValue({
      type: 'oauth',
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresAt: 123,
      email: 'user@example.com',
      subject: 'project-1',
    });
    mocks.listAgentsSnapshot.mockRejectedValue(new Error('agents dir busy'));

    const outcome = await syncDefaultProviderToRuntime('openai-personal');

    expect(outcome.degraded).toBe(true);
    expect(outcome.reason).toContain('browser OAuth');
    expect(outcome.reason).toContain('agents dir busy');
  });

  it('returns a clean outcome on the healthy non-OAuth path', async () => {
    const gateway = createGateway('running');

    const outcome = await syncDefaultProviderToRuntime('moonshot', gateway as GatewayManager);

    expect(outcome.degraded).toBe(false);
    expect(outcome.reason).toBeUndefined();
    expect(gateway.debouncedReload).toHaveBeenCalledTimes(1);
  });
});
