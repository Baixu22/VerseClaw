// R4: provider-runtime-sync 认证/headers/能力元数据同步回归测试。
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
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  syncDefaultProviderToRuntime,
  syncSavedProviderToRuntime,
} from '@electron/services/providers/provider-runtime-sync';

function createCustomProvider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'custom-personal',
    name: 'Custom',
    type: 'custom',
    baseUrl: 'https://example.com/v1',
    apiProtocol: 'openai-completions',
    model: 'my-model',
    enabled: true,
    createdAt: '2026-08-14T00:00:00.000Z',
    updatedAt: '2026-08-14T00:00:00.000Z',
    ...overrides,
  };
}

function createGateway(): Pick<GatewayManager, 'debouncedReload' | 'debouncedRestart' | 'getStatus'> {
  return {
    debouncedReload: vi.fn(),
    debouncedRestart: vi.fn(),
    getStatus: vi.fn(() => ({ state: 'running' } as ReturnType<GatewayManager['getStatus']>)),
  };
}

function syncConfigCallArgs() {
  return mocks.syncProviderConfigToOpenClaw.mock.calls[0] as unknown as [string, string | undefined, Record<string, unknown>];
}

function agentModelsCallArgs() {
  return mocks.updateAgentModelProvider.mock.calls[0] as unknown as [string, Record<string, unknown>];
}

describe('R4 provider-runtime-sync auth / headers / capability metadata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProviderAccount.mockResolvedValue(null);
    mocks.getProviderSecret.mockResolvedValue(undefined);
    mocks.getAllProviders.mockResolvedValue([]);
    mocks.getApiKey.mockResolvedValue('sk-test');
    mocks.getDefaultProvider.mockResolvedValue('custom-personal');
    mocks.getProvider.mockResolvedValue(createCustomProvider());
    mocks.getProviderDefaultModel.mockReturnValue('my-model');
    mocks.getProviderConfig.mockReturnValue({
      api: 'openai-completions',
      baseUrl: 'https://example.com/v1',
      apiKeyEnv: 'CUSTOM_API_KEY',
      headers: { 'X-Vendor-Header': 'vendor-value' },
    });
    mocks.syncProviderConfigToOpenClaw.mockResolvedValue(undefined);
    mocks.setOpenClawDefaultModel.mockResolvedValue(undefined);
    mocks.setOpenClawDefaultModelWithOverride.mockResolvedValue(undefined);
    mocks.saveProviderKeyToOpenClaw.mockResolvedValue(undefined);
    mocks.removeProviderFromOpenClaw.mockResolvedValue(undefined);
    mocks.removeProviderKeyFromOpenClaw.mockResolvedValue(undefined);
    mocks.updateAgentModelProvider.mockResolvedValue(undefined);
    mocks.updateSingleAgentModelProvider.mockResolvedValue(undefined);
    mocks.listAgentsSnapshot.mockResolvedValue({ agents: [] });
  });

  it('merges vendor headers with user headers instead of overwriting them', async () => {
    await syncSavedProviderToRuntime(
      createCustomProvider({ headers: { 'User-Agent': 'ua/1' } }),
      'sk-test',
      createGateway() as GatewayManager,
    );

    const [, , override] = syncConfigCallArgs();
    // 修复前:headers 被覆写成只剩 User-Agent(丢 vendor 头);修复后二者合并。
    expect(override.headers).toEqual({ 'X-Vendor-Header': 'vendor-value', 'User-Agent': 'ua/1' });
  });

  it('writes request.auth (custom header + prefix) into openclaw.json and agent models.json', async () => {
    await syncSavedProviderToRuntime(
      createCustomProvider({
        requestAuth: { mode: 'custom-header', headerName: 'X-API-Key', prefix: 'ApiKey ' },
      }),
      'sk-test',
      createGateway() as GatewayManager,
    );

    const expectedRequest = {
      auth: { mode: 'header', headerName: 'X-API-Key', value: 'sk-test', prefix: 'ApiKey ' },
    };
    const [, , override] = syncConfigCallArgs();
    expect(override.request).toEqual(expectedRequest);

    const [, entry] = agentModelsCallArgs();
    expect(entry.request).toEqual(expectedRequest);
  });

  it('writes request.auth (query parameter) into openclaw.json and agent models.json', async () => {
    await syncSavedProviderToRuntime(
      createCustomProvider({ requestAuth: { mode: 'query', parameterName: 'key' } }),
      'sk-test',
      createGateway() as GatewayManager,
    );

    const expectedRequest = { auth: { mode: 'query', parameterName: 'key', value: 'sk-test' } };
    const [, , override] = syncConfigCallArgs();
    expect(override.request).toEqual(expectedRequest);

    const [, entry] = agentModelsCallArgs();
    expect(entry.request).toEqual(expectedRequest);
  });

  it('omits request.auth entirely for "none" auth mode', async () => {
    await syncSavedProviderToRuntime(
      createCustomProvider({ requestAuth: { mode: 'none' } }),
      'sk-test',
      createGateway() as GatewayManager,
    );

    const [, , override] = syncConfigCallArgs();
    expect(override.request).toBeUndefined();
    const [, entry] = agentModelsCallArgs();
    expect(entry.request).toBeUndefined();
  });

  it('writes declared capability metadata end-to-end (UI fill -> openclaw.json -> models.json)', async () => {
    await syncSavedProviderToRuntime(
      createCustomProvider({
        modelProfile: {
          contextWindow: 128000,
          maxTokens: 8192,
          supportsVision: true,
          supportsReasoning: true,
        },
      }),
      'sk-test',
      createGateway() as GatewayManager,
    );

    const [, , override] = syncConfigCallArgs();
    const openClawModel = (override.modelEntries as Array<Record<string, unknown>>)[0];
    expect(openClawModel).toMatchObject({
      id: 'my-model',
      name: 'my-model',
      contextWindow: 128000,
      maxTokens: 8192,
      input: ['text', 'image'],
      reasoning: true,
    });

    const [, entry] = agentModelsCallArgs();
    const modelsJsonModel = (entry.models as Array<Record<string, unknown>>)[0];
    expect(modelsJsonModel).toMatchObject({
      id: 'my-model',
      name: 'my-model',
      contextWindow: 128000,
      maxTokens: 8192,
      input: ['text', 'image'],
      reasoning: true,
    });
  });

  it('keeps undeclared capability fields absent (no silent fallback values)', async () => {
    await syncSavedProviderToRuntime(
      createCustomProvider(),
      'sk-test',
      createGateway() as GatewayManager,
    );

    const [, , override] = syncConfigCallArgs();
    const openClawModel = (override.modelEntries as Array<Record<string, unknown>>)[0];
    expect(openClawModel).toMatchObject({ id: 'my-model', name: 'my-model' });
    expect(openClawModel).not.toHaveProperty('contextWindow');
    expect(openClawModel).not.toHaveProperty('maxTokens');
    expect(openClawModel).not.toHaveProperty('input');
    expect(openClawModel).not.toHaveProperty('reasoning');
  });

  it('falls back to the historical MiniMax OAuth marker and still updates models.json', async () => {
    mocks.getProvider.mockResolvedValue(
      createCustomProvider({ id: 'mm', type: 'minimax-portal', model: 'MiniMax-M2' }),
    );
    mocks.getApiKey.mockResolvedValue(undefined);
    mocks.getProviderConfig.mockReturnValue({
      api: 'anthropic-messages',
      baseUrl: 'https://api.minimax.io/anthropic',
      apiKeyEnv: undefined,
    });

    const outcome = await syncDefaultProviderToRuntime('mm');

    expect(outcome.degraded).toBe(false);
    expect(mocks.setOpenClawDefaultModelWithOverride).toHaveBeenCalledWith(
      'minimax-portal',
      expect.any(String),
      expect.objectContaining({ apiKeyEnv: 'minimax-oauth' }),
      expect.any(Array),
    );
    expect(mocks.updateAgentModelProvider).toHaveBeenCalledWith(
      'minimax-portal',
      expect.objectContaining({ apiKey: 'minimax-oauth' }),
    );
  });
});
