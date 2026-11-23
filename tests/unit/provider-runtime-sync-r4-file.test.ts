// @vitest-environment node
// R4 file-level end-to-end: a UI provider shape (requestAuth + modelProfile)
// must survive the real sync functions and land in a real temporary
// openclaw.json and per-agent models.json — not just inside save mocks.
import { mkdtempSync, rmSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { providerRequestAuthHeaders, providerRequestAuthQuery, resolveProviderRequestAuth } from '@openclaw/provider-request-auth';

const testConfigDir = mkdtempSync(path.join(os.tmpdir(), 'clawx-r4-file-'));
process.env.OPENCLAW_CONFIG_DIR = testConfigDir;

const mocks = vi.hoisted(() => ({
  getProviderAccount: vi.fn(),
  getProviderSecret: vi.fn(),
  getAllProviders: vi.fn(),
  getApiKey: vi.fn(),
  getProvider: vi.fn(),
  getDefaultProvider: vi.fn(),
  getProviderConfig: vi.fn(),
  listAgentsSnapshot: vi.fn(),
}));

vi.mock('@electron/services/providers/provider-store', () => ({
  getProviderAccount: mocks.getProviderAccount,
  listProviderAccounts: vi.fn(),
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
  getProviderDefaultModel: vi.fn(),
}));

vi.mock('@electron/utils/agent-config', () => ({
  listAgentsSnapshot: mocks.listAgentsSnapshot,
}));

vi.mock('@electron/utils/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

type ProviderRuntimeSyncModule = typeof import('@electron/services/providers/provider-runtime-sync');

let syncModule: ProviderRuntimeSyncModule;

beforeAll(async () => {
  mocks.getProviderAccount.mockResolvedValue(null);
  mocks.getProviderSecret.mockResolvedValue(undefined);
  mocks.getAllProviders.mockResolvedValue([]);
  mocks.getApiKey.mockResolvedValue('sk-file-test');
  mocks.getProviderConfig.mockReturnValue({
    api: 'openai-completions',
    baseUrl: 'https://example.com/v1',
    apiKeyEnv: 'CUSTOM_API_KEY',
    headers: { 'X-Vendor-Header': 'vendor-value' },
  });
  mocks.listAgentsSnapshot.mockResolvedValue({ agents: [] });

  // Import only after OPENCLAW_CONFIG_DIR is set so openclaw-auth captures the
  // temporary config path in its module-level OPENCLAW_CONFIG_PATH constant.
  syncModule = await import('@electron/services/providers/provider-runtime-sync');
});

afterAll(() => {
  rmSync(testConfigDir, { recursive: true, force: true });
  delete process.env.OPENCLAW_CONFIG_DIR;
});

describe('R4 provider sync file-level E2E', () => {
  it.each([
    { mode: 'query' as const, parameterName: 'token' },
    { mode: 'custom-header' as const, headerName: 'X-API-Key' },
    { mode: 'bearer' as const },
  ])('clears persisted $mode overrides when updated to none, including without a supplied key', async (requestAuth) => {
    const provider = {
      id: `none-${requestAuth.mode}`, name: 'Auth transition', type: 'custom' as const,
      baseUrl: 'https://example.invalid/v1', apiProtocol: 'openai-completions' as const,
      model: 'auth-model', enabled: true,
      createdAt: '2026-11-23T00:00:00Z', updatedAt: '2026-11-23T00:00:00Z', requestAuth,
    };
    mocks.getDefaultProvider.mockResolvedValue(null);
    mocks.getAllProviders.mockResolvedValue([]);
    const runtimeKey = syncModule.getOpenClawProviderKey(provider.type, provider.id);
    for (const key of ['fixture-only-old-key', '']) {
      await syncModule.syncSavedProviderToRuntime(provider, 'fixture-only-old-key');
      for (const configFile of ['openclaw.json', 'agents/main/agent/models.json']) {
        const before = JSON.parse(await readFile(path.join(testConfigDir, configFile), 'utf8'));
        expect((before.models?.providers ?? before.providers)[runtimeKey].request.auth).toBeDefined();
      }
      await syncModule.syncUpdatedProviderToRuntime({ ...provider, requestAuth: { mode: 'none' } }, key);
      for (const configFile of ['openclaw.json', 'agents/main/agent/models.json']) {
        const after = JSON.parse(await readFile(path.join(testConfigDir, configFile), 'utf8'));
        const entry = (after.models?.providers ?? after.providers)[runtimeKey];
        expect(entry.request?.auth, configFile).toBeUndefined();
        const resolved = resolveProviderRequestAuth({ authHeader: entry.authHeader, auth: entry.request?.auth });
        expect(providerRequestAuthHeaders(resolved)).toBeUndefined();
        expect(providerRequestAuthQuery(resolved)).toBeUndefined();
        expect(resolved.injectAuthorizationHeader).toBe(false);
      }
    }
  });

  it.each([true, false])('preserves declared reasoning=%s when selecting and updating the default provider', async (reasoning) => {
    const provider = {
      id: `${reasoning ? 'reasoning' : 'plain'}-profile`,
      name: 'Default profile',
      type: 'custom' as const,
      baseUrl: 'https://example.com/v1',
      apiProtocol: 'openai-completions' as const,
      model: 'profile-model',
      enabled: true,
      createdAt: '2026-11-08T00:00:00.000Z',
      updatedAt: '2026-11-08T00:00:00.000Z',
      requestAuth: { mode: 'custom-header' as const, headerName: 'X-API-Key' },
      modelProfile: { contextWindow: 128000, maxTokens: 4096, supportsVision: reasoning, supportsReasoning: reasoning },
    };
    mocks.getProvider.mockResolvedValue(provider);
    mocks.getDefaultProvider.mockResolvedValue(provider.id);
    mocks.getAllProviders.mockResolvedValue([provider]);
    await syncModule.syncSavedProviderToRuntime(provider, 'sk-file-test');
    const runtimeKey = syncModule.getOpenClawProviderKey(provider.type, provider.id);
    const cost = { input: 2, output: 8, cacheRead: 1, cacheWrite: 3 };
    for (const configFile of ['openclaw.json', 'agents/main/agent/models.json']) {
      const filename = path.join(testConfigDir, configFile);
      const config = JSON.parse(await readFile(filename, 'utf8'));
      (config.models?.providers ?? config.providers)[runtimeKey].models[0].cost = cost;
      await writeFile(filename, JSON.stringify(config));
    }
    const updated = { ...provider, modelProfile: { ...provider.modelProfile, supportsVision: !reasoning, supportsReasoning: !reasoning } };
    for (const [expectedReasoning, action] of [
      [reasoning, () => syncModule.syncDefaultProviderToRuntime(provider.id)],
      [!reasoning, () => syncModule.syncDefaultProviderToRuntime(provider.id)],
      [!reasoning, () => syncModule.syncUpdatedProviderToRuntime(updated, 'sk-file-test')],
    ] as const) {
      mocks.getProvider.mockResolvedValue(expectedReasoning === reasoning ? provider : updated);
      mocks.getAllProviders.mockResolvedValue([expectedReasoning === reasoning ? provider : updated]);
      await action();
      for (const configFile of ['openclaw.json', 'agents/main/agent/models.json']) {
        const config = JSON.parse(await readFile(path.join(testConfigDir, configFile), 'utf8'));
        const entry = (config.models?.providers ?? config.providers)[runtimeKey];
        expect(entry.models.find((model: { id: string }) => model.id === provider.model), configFile).toMatchObject({
          reasoning: expectedReasoning, contextWindow: 128000, maxTokens: 4096, input: expectedReasoning ? ['text', 'image'] : ['text'], cost,
        });
        expect(entry.request?.auth).toMatchObject({ mode: 'header', headerName: 'X-API-Key' });
      }
    }
    mocks.getAllProviders.mockResolvedValue([]);
  });

  it('writes UI request.auth and modelProfile through real openclaw.json and models.json files', async () => {
    const provider = {
      id: 'custom-file-e2e',
      name: 'Custom File E2E',
      type: 'custom' as const,
      baseUrl: 'https://example.com/v1',
      apiProtocol: 'openai-completions' as const,
      model: 'file-model',
      enabled: true,
      createdAt: '2026-08-15T00:00:00.000Z',
      updatedAt: '2026-08-15T00:00:00.000Z',
      requestAuth: {
        mode: 'custom-header' as const,
        headerName: 'X-API-Key',
        prefix: 'ApiKey ',
      },
      modelProfile: {
        contextWindow: 128000,
        maxTokens: 8192,
        supportsVision: true,
        supportsReasoning: true,
      },
    };

    await syncModule.syncSavedProviderToRuntime(provider, 'sk-file-test');

    const runtimeKey = syncModule.getOpenClawProviderKey(provider.type, provider.id);
    const openclaw = JSON.parse(
      await readFile(path.join(testConfigDir, 'openclaw.json'), 'utf8'),
    ) as {
      models?: { providers?: Record<string, Record<string, unknown>> };
    };
    const openclawEntry = openclaw.models?.providers?.[runtimeKey];
    expect(openclawEntry).toMatchObject({
      api: 'openai-completions',
      baseUrl: 'https://example.com/v1',
    });
    expect(openclawEntry?.request).toEqual({
      auth: {
        mode: 'header',
        headerName: 'X-API-Key',
        value: 'sk-file-test',
        prefix: 'ApiKey ',
      },
    });
    const openclawModel = (openclawEntry?.models as Array<Record<string, unknown>>)[0];
    expect(openclawModel).toMatchObject({
      id: 'file-model',
      name: 'file-model',
      contextWindow: 128000,
      maxTokens: 8192,
      input: ['text', 'image'],
      reasoning: true,
    });

    const modelsJson = JSON.parse(
      await readFile(
        path.join(testConfigDir, 'agents', 'main', 'agent', 'models.json'),
        'utf8',
      ),
    ) as { providers?: Record<string, Record<string, unknown>> };
    const modelsEntry = modelsJson.providers?.[runtimeKey];
    expect(modelsEntry).toBeDefined();
    expect(modelsEntry?.request).toEqual({
      auth: {
        mode: 'header',
        headerName: 'X-API-Key',
        value: 'sk-file-test',
        prefix: 'ApiKey ',
      },
    });
    const modelsJsonModel = (modelsEntry?.models as Array<Record<string, unknown>>)[0];
    expect(modelsJsonModel).toMatchObject({
      id: 'file-model',
      name: 'file-model',
      contextWindow: 128000,
      maxTokens: 8192,
      input: ['text', 'image'],
      reasoning: true,
    });
  });
});
