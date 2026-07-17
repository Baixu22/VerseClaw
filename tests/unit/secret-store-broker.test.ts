import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const storeData: Record<string, unknown> = {
  apiKeys: {},
  providerSecrets: {},
};

const mockStore = {
  get: vi.fn((key: string) => storeData[key]),
  set: vi.fn((key: string, value: unknown) => {
    storeData[key] = value;
  }),
};

vi.mock('@electron/services/providers/store-instance', () => ({
  getClawXProviderStore: async () => mockStore,
}));

function makeTestCrypto() {
  const key = randomBytes(32);
  const algorithm = 'aes-256-gcm' as const;
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => {
      const iv = randomBytes(12);
      const cipher = createCipheriv(algorithm, key, iv);
      const enc = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();
      return Buffer.concat([iv, tag, enc]);
    },
    decryptString: (buf: Buffer) => {
      const iv = buf.subarray(0, 12);
      const tag = buf.subarray(12, 28);
      const data = buf.subarray(28);
      const decipher = createDecipheriv(algorithm, key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
    },
  };
}

describe('Secret Broker single-source (P1-001)', () => {
  beforeEach(async () => {
    vi.resetModules();
    storeData.apiKeys = {};
    storeData.providerSecrets = {};
    mockStore.get.mockImplementation((key: string) => storeData[key]);
    mockStore.set.mockImplementation((key: string, value: unknown) => {
      storeData[key] = value;
    });
  });

  it('stores secrets only under providerSecrets and never dual-writes apiKeys', async () => {
    const crypto = makeTestCrypto();
    const mod = await import('@electron/services/secrets/secret-store');
    mod.setSecretStoreCryptoForTests(crypto);

    const canary = 'sk-canary-P1-001-MUST-NOT-LEAK-' + randomBytes(4).toString('hex');
    await mod.setProviderSecret({
      type: 'api_key',
      accountId: 'provider-canary',
      apiKey: canary,
    });

    expect(storeData.apiKeys).toEqual({});
    const secrets = storeData.providerSecrets as Record<string, { format?: string; ciphertext?: string }>;
    expect(secrets['provider-canary']?.format).toBe('safeStorage-v1');
    expect(JSON.stringify(storeData)).not.toContain(canary);

    const resolved = await mod.getProviderSecret('provider-canary');
    expect(resolved).toEqual({
      type: 'api_key',
      accountId: 'provider-canary',
      apiKey: canary,
    });

    const scan = mod.assertNoPlaintextCanaryInProviderStoreRecords(storeData, canary);
    expect(scan.ok).toBe(true);
    expect(scan.hits).toEqual([]);
  });

  it('migrates legacy apiKeys into encrypted providerSecrets and deletes the legacy entry', async () => {
    const crypto = makeTestCrypto();
    const mod = await import('@electron/services/secrets/secret-store');
    mod.setSecretStoreCryptoForTests(crypto);

    const canary = 'sk-legacy-canary-migrate';
    storeData.apiKeys = { 'legacy-acct': canary };

    const resolved = await mod.getProviderSecret('legacy-acct');
    expect(resolved?.type).toBe('api_key');
    expect((resolved as { apiKey: string }).apiKey).toBe(canary);
    expect((storeData.apiKeys as Record<string, string>)['legacy-acct']).toBeUndefined();
    expect(JSON.stringify(storeData)).not.toContain(canary);
  });
});
