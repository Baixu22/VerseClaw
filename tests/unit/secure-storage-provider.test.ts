import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ensureProviderStoreMigrated: vi.fn(),
  getClawXProviderStore: vi.fn(),
  getProviderAccount: vi.fn(),
  listProviderAccounts: vi.fn(),
  providerAccountToConfig: vi.fn((account: Record<string, unknown>) => ({
    id: account.id,
    name: account.label,
    type: account.vendorId,
    baseUrl: account.baseUrl,
    apiProtocol: account.apiProtocol,
    headers: account.headers,
    model: account.model,
    fallbackModels: account.fallbackModels,
    fallbackProviderIds: account.fallbackAccountIds,
    enabled: account.enabled,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  })),
  providerConfigToAccount: vi.fn(),
  saveProviderAccount: vi.fn(),
  setDefaultProviderAccount: vi.fn(),
  deleteProviderAccount: vi.fn(),
  getProviderSecret: vi.fn(),
  setProviderSecret: vi.fn(),
  deleteProviderSecret: vi.fn(),
}));

vi.mock('@electron/services/providers/provider-migration', () => ({
  ensureProviderStoreMigrated: mocks.ensureProviderStoreMigrated,
}));

vi.mock('@electron/services/providers/store-instance', () => ({
  getClawXProviderStore: mocks.getClawXProviderStore,
}));

vi.mock('@electron/services/providers/provider-store', () => ({
  getProviderAccount: mocks.getProviderAccount,
  listProviderAccounts: mocks.listProviderAccounts,
  providerAccountToConfig: mocks.providerAccountToConfig,
  providerConfigToAccount: mocks.providerConfigToAccount,
  saveProviderAccount: mocks.saveProviderAccount,
  setDefaultProviderAccount: mocks.setDefaultProviderAccount,
  deleteProviderAccount: mocks.deleteProviderAccount,
}));

vi.mock('@electron/services/secrets/secret-store', () => ({
  getProviderSecret: mocks.getProviderSecret,
  setProviderSecret: mocks.setProviderSecret,
  deleteProviderSecret: mocks.deleteProviderSecret,
}));

vi.mock('@electron/utils/openclaw-auth', () => ({
  getActiveOpenClawProviders: vi.fn(),
}));

vi.mock('@electron/utils/provider-keys', () => ({
  getOpenClawProviderKeyForType: vi.fn((type: string) => type),
}));

describe('secure-storage provider compatibility layer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureProviderStoreMigrated.mockResolvedValue(undefined);
    mocks.getProviderSecret.mockResolvedValue(null);
    mocks.listProviderAccounts.mockResolvedValue([]);
  });

  it('prefers account-store metadata over stale legacy providers when resolving a provider', async () => {
    const legacyProviders = {
      deepseek: {
        id: 'deepseek',
        name: 'DeepSeek',
        type: 'deepseek',
        model: 'deepseek-v4-pro',
        enabled: true,
        createdAt: '2026-03-19T00:00:00.000Z',
        updatedAt: '2026-03-19T00:00:00.000Z',
      },
    };
    mocks.getClawXProviderStore.mockResolvedValue({
      get: vi.fn((key: string) => {
        if (key === 'providers') return legacyProviders;
        return undefined;
      }),
      set: vi.fn(),
      delete: vi.fn(),
    });
    mocks.getProviderAccount.mockResolvedValue({
      id: 'deepseek',
      vendorId: 'deepseek',
      label: 'DeepSeek',
      authMode: 'api_key',
      model: 'deepseek/deepseek-v4-flash',
      enabled: true,
      isDefault: true,
      createdAt: '2026-03-19T00:00:00.000Z',
      updatedAt: '2026-03-20T00:00:00.000Z',
    });

    const { getProvider } = await import('@electron/utils/secure-storage');
    const provider = await getProvider('deepseek');

    expect(provider).toEqual(expect.objectContaining({
      id: 'deepseek',
      model: 'deepseek/deepseek-v4-flash',
    }));
  });
});
