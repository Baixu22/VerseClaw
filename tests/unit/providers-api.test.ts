import { beforeEach, describe, expect, it, vi } from 'vitest';

const providerServiceMock = {
  _listProvidersWithKeyInfoInternal: vi.fn(),
  _getProviderInternal: vi.fn(),
  _getDefaultProviderInternal: vi.fn(),
  _hasProviderApiKeyInternal: vi.fn(),
  _getProviderApiKeyInternal: vi.fn(),
  _setProviderApiKeyInternal: vi.fn(),
  _deleteProviderApiKeyInternal: vi.fn(),
  listAccounts: vi.fn(),
  listVendors: vi.fn(),
  listAccountsKeyInfo: vi.fn(),
  getDefaultAccountId: vi.fn(),
  getAccount: vi.fn(),
  getAccountApiKey: vi.fn(),
  hasAccountApiKey: vi.fn(),
  createAccount: vi.fn(),
  updateAccount: vi.fn(),
  deleteAccount: vi.fn(),
  setDefaultAccount: vi.fn(),
};

vi.mock('@electron/services/providers/provider-service', () => ({
  getProviderService: () => providerServiceMock,
}));

vi.mock('@electron/utils/device-oauth', () => ({
  deviceOAuthManager: { setWindow: vi.fn(), start: vi.fn(), cancel: vi.fn(), submit: vi.fn() },
}));

vi.mock('@electron/utils/browser-oauth', () => ({
  browserOAuthManager: { setWindow: vi.fn(), start: vi.fn(), cancel: vi.fn(), submit: vi.fn() },
}));

vi.mock('@electron/services/providers/provider-validation', () => ({
  validateApiKeyWithProvider: vi.fn(),
  listModelsWithProvider: vi.fn(),
}));

vi.mock('@electron/services/providers/provider-runtime-sync', () => ({
  syncSavedProviderToRuntime: vi.fn(),
  syncDefaultProviderToRuntime: vi.fn(),
  deleteProviderFromRuntime: vi.fn(),
}));

vi.mock('@electron/services/providers/provider-store', () => ({
  providerAccountToConfig: vi.fn((account: Record<string, unknown>) => account),
}));

describe('providers-api secret broker boundary (P1-001)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    providerServiceMock.listAccountsKeyInfo.mockResolvedValue([
      { accountId: 'acct-1', hasKey: true, keyMasked: 'sk-***' },
    ]);
    providerServiceMock.hasAccountApiKey.mockResolvedValue(true);
  });

  it('exposes hasKey status surfaces but not plaintext getApiKey handlers', async () => {
    const { createProvidersApi } = await import('@electron/services/providers-api');
    const api = createProvidersApi({
      gatewayManager: { debouncedReload: vi.fn() } as never,
      mainWindow: {} as never,
    }) as Record<string, unknown>;

    expect(api.getApiKey).toBeUndefined();
    expect(api.getAccountApiKey).toBeUndefined();
    expect(typeof api.hasApiKey).toBe('function');
    expect(typeof api.hasAccountApiKey).toBe('function');
    expect(typeof api.accountKeyInfo).toBe('function');

    await expect(api.accountKeyInfo()).resolves.toEqual([
      { accountId: 'acct-1', hasKey: true, keyMasked: 'sk-***' },
    ]);
    expect(providerServiceMock._getProviderApiKeyInternal).not.toHaveBeenCalled();
    expect(providerServiceMock.getAccountApiKey).not.toHaveBeenCalled();
  });
});
