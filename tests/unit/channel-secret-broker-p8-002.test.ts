import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const storeData: Record<string, unknown> = {
  channelSecrets: {},
  providerSecrets: {},
  apiKeys: {},
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

describe('channel secret broker vault (P8-002)', () => {
  beforeEach(async () => {
    vi.resetModules();
    storeData.channelSecrets = {};
    storeData.providerSecrets = {};
    storeData.apiKeys = {};
    mockStore.get.mockImplementation((key: string) => storeData[key]);
    mockStore.set.mockImplementation((key: string, value: unknown) => {
      storeData[key] = value;
    });
  });

  it('A1: seals canary into encrypted vault without plaintext in store snapshot', async () => {
    const crypto = makeTestCrypto();
    const mod = await import('@electron/services/secrets/channel-secret-broker');
    mod.setChannelSecretBrokerCryptoForTests(crypto);

    const canary = 'tg-bot-canary-P8-002-' + randomBytes(4).toString('hex');
    const sealed = await mod.sealChannelSecrets({
      channelType: 'telegram',
      accountId: 'default',
      values: {
        botToken: canary,
        displayName: 'demo-bot',
      },
    });

    expect(sealed).toEqual(['botToken']);
    const vault = storeData.channelSecrets as Record<string, { format?: string; ciphertext?: string; value?: string }>;
    const entry = vault['telegram::default::botToken'];
    expect(entry?.format).toBe('safeStorage-v1');
    expect(JSON.stringify(storeData)).not.toContain(canary);
    const scan = mod.assertNoPlaintextCanaryInChannelVault(vault as never, canary);
    expect(scan.ok).toBe(true);
  });

  it('A2: Main resolve returns plaintext while field is recognized as secret', async () => {
    const crypto = makeTestCrypto();
    const mod = await import('@electron/services/secrets/channel-secret-broker');
    mod.setChannelSecretBrokerCryptoForTests(crypto);
    const canary = 'discord-token-P8-002-xyz';

    await mod.sealChannelSecrets({
      channelType: 'discord',
      accountId: 'main',
      values: { token: canary, enabled: true },
    });

    const resolved = await mod.resolveChannelSecret('discord', 'main', 'token');
    expect(resolved).toBe(canary);
    expect(mod.isChannelSecretField('token')).toBe(true);
    expect(mod.isChannelSecretField('displayName')).toBe(false);
  });

  it('A3: redacted Renderer echoes are not re-sealed as secrets', async () => {
    const crypto = makeTestCrypto();
    const mod = await import('@electron/services/secrets/channel-secret-broker');
    mod.setChannelSecretBrokerCryptoForTests(crypto);

    const sealed = await mod.sealChannelSecrets({
      channelType: 'telegram',
      accountId: 'default',
      values: { botToken: '????abcd' },
    });
    expect(sealed).toEqual([]);
    expect(Object.keys(storeData.channelSecrets as object)).toHaveLength(0);
  });
});
