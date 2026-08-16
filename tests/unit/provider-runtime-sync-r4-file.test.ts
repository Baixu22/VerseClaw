// @vitest-environment node
// R4 file-level end-to-end: a UI provider shape (requestAuth + modelProfile)
// must survive the real sync functions and land in a real temporary
// openclaw.json and per-agent models.json — not just inside save mocks.
import { mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const testConfigDir = mkdtempSync(path.join(os.tmpdir(), 'clawx-r4-file-'));
process.env.OPENCLAW_CONFIG_DIR = testConfigDir;

const mocks = vi.hoisted(() => ({
  getProviderAccount: vi.fn(),
  getProviderSecret: vi.fn(),
  getAllProviders: vi.fn(),
  getApiKey: vi.fn(),
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
  getDefaultProvider: vi.fn(),
  getProvider: vi.fn(),
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
