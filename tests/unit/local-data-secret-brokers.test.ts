import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { AuthProfileSecretVault } from '@electron/services/secrets/auth-profile-secret-broker';

const storeData: Record<string, unknown> = {
  authProfileSecrets: {},
  wechatAccountSecrets: {},
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

describe('auth-profile secret broker', () => {
  beforeEach(() => {
    vi.resetModules();
    storeData.authProfileSecrets = {};
    mockStore.get.mockImplementation((key: string) => storeData[key]);
    mockStore.set.mockImplementation((key: string, value: unknown) => {
      storeData[key] = value;
    });
  });

  it('replaces plaintext credential fields with a sealed reference', async () => {
    const crypto = makeTestCrypto();
    const mod = await import('@electron/services/secrets/auth-profile-secret-broker');
    mod.setAuthProfileSecretBrokerCryptoForTests(crypto);

    const profile: Record<string, unknown> = {
      type: 'oauth',
      provider: 'minimax',
      access: 'access-canary',
      refresh: 'refresh-canary',
      expires: 123,
      email: 'user@example.com',
    };
    const sealed = await mod.sealAuthProfileSecrets({
      agentId: 'main',
      profileId: 'minimax:default',
      profile,
    });

    expect(sealed.sort()).toEqual(['access', 'refresh']);
    // Original field names survive; only the value becomes a reference.
    expect(Object.keys(profile).sort()).toEqual(
      ['access', 'email', 'expires', 'provider', 'refresh', 'type'].sort(),
    );
    expect(mod.isAuthProfileSecretRef(profile.access)).toBe(true);
    expect(mod.isAuthProfileSecretRef(profile.refresh)).toBe(true);
    // Non-credential metadata is untouched.
    expect(profile.email).toBe('user@example.com');
    expect(profile.expires).toBe(123);
  });

  it('never leaves a credential canary in plaintext inside the vault', async () => {
    const crypto = makeTestCrypto();
    const mod = await import('@electron/services/secrets/auth-profile-secret-broker');
    mod.setAuthProfileSecretBrokerCryptoForTests(crypto);

    const canary = 'sk-canary-AUTH-PROFILE-' + randomBytes(4).toString('hex');
    const profile: Record<string, unknown> = {
      type: 'api_key',
      provider: 'deepseek',
      key: canary,
    };
    await mod.sealAuthProfileSecrets({ agentId: 'main', profileId: 'deepseek:default', profile });

    const vault = storeData.authProfileSecrets as AuthProfileSecretVault;
    const result = mod.assertNoPlaintextCanaryInAuthProfileVault(vault, canary);
    expect(result).toEqual({ ok: true, hits: [] });
  });

  it('round-trips a sealed api_key field back to plaintext', async () => {
    const crypto = makeTestCrypto();
    const mod = await import('@electron/services/secrets/auth-profile-secret-broker');
    mod.setAuthProfileSecretBrokerCryptoForTests(crypto);

    const secret = 'sk-roundtrip-value';
    const profile: Record<string, unknown> = { type: 'api_key', provider: 'moonshot', key: secret };
    await mod.sealAuthProfileSecrets({ agentId: 'main', profileId: 'moonshot:default', profile });

    expect(await mod.resolveAuthProfileSecret(profile.key)).toBe(secret);
  });

  it('resolves legacy plaintext without a vault entry (read compatibility)', async () => {
    const crypto = makeTestCrypto();
    const mod = await import('@electron/services/secrets/auth-profile-secret-broker');
    mod.setAuthProfileSecretBrokerCryptoForTests(crypto);

    // An un-migrated profile still holds a plain string.
    expect(await mod.resolveAuthProfileSecret('sk-legacy-plaintext')).toBe('sk-legacy-plaintext');
    expect(await mod.resolveAuthProfileSecret(undefined)).toBeNull();
    expect(await mod.resolveAuthProfileSecret('')).toBeNull();
  });

  it('is idempotent: re-sealing an already sealed profile is a no-op', async () => {
    const crypto = makeTestCrypto();
    const mod = await import('@electron/services/secrets/auth-profile-secret-broker');
    mod.setAuthProfileSecretBrokerCryptoForTests(crypto);

    const profile: Record<string, unknown> = { type: 'api_key', provider: 'qwen', key: 'sk-idem' };
    await mod.sealAuthProfileSecrets({ agentId: 'main', profileId: 'qwen:default', profile });
    const afterFirst = JSON.stringify(profile);

    const second = await mod.sealAuthProfileSecrets({
      agentId: 'main',
      profileId: 'qwen:default',
      profile,
    });
    expect(second).toEqual([]);
    expect(JSON.stringify(profile)).toBe(afterFirst);
  });

  it('scopes vault deletion to the named profiles only', async () => {
    const crypto = makeTestCrypto();
    const mod = await import('@electron/services/secrets/auth-profile-secret-broker');
    mod.setAuthProfileSecretBrokerCryptoForTests(crypto);

    const keep: Record<string, unknown> = { type: 'api_key', provider: 'keep-me', key: 'sk-keep' };
    const drop: Record<string, unknown> = { type: 'api_key', provider: 'drop-me', key: 'sk-drop' };
    await mod.sealAuthProfileSecrets({ agentId: 'main', profileId: 'keep:default', profile: keep });
    await mod.sealAuthProfileSecrets({ agentId: 'main', profileId: 'drop:default', profile: drop });

    const removed = await mod.deleteAuthProfileSecrets('main', ['drop:default']);
    expect(removed).toBe(1);

    // The unrelated provider must survive: an agent-wide delete would lose it.
    expect(await mod.resolveAuthProfileSecret(keep.key)).toBe('sk-keep');
    expect(await mod.resolveAuthProfileSecret(drop.key)).toBeNull();
  });

  it('returns null for a sealed field when OS encryption is unavailable', async () => {
    const crypto = makeTestCrypto();
    const mod = await import('@electron/services/secrets/auth-profile-secret-broker');
    mod.setAuthProfileSecretBrokerCryptoForTests(crypto);

    const profile: Record<string, unknown> = { type: 'api_key', provider: 'ark', key: 'sk-ark' };
    await mod.sealAuthProfileSecrets({ agentId: 'main', profileId: 'ark:default', profile });

    // Simulate a host that lost keyring access: safeStorage reports the
    // capability as unavailable, so the envelope must not be decrypted.
    mod.setAuthProfileSecretBrokerCryptoForTests({
      isEncryptionAvailable: () => false,
      encryptString: crypto.encryptString,
      decryptString: crypto.decryptString,
    });
    expect(
      await mod.resolveAuthProfileSecret(profile.key, { agentId: 'main', profileId: 'ark:default' }),
    ).toBeNull();
  });

  it('refuses to resolve a reference outside its owning agent/profile', async () => {
    const crypto = makeTestCrypto();
    const mod = await import('@electron/services/secrets/auth-profile-secret-broker');
    mod.setAuthProfileSecretBrokerCryptoForTests(crypto);

    const profile: Record<string, unknown> = { type: 'api_key', provider: 'openai', key: 'sk-owned' };
    await mod.sealAuthProfileSecrets({ agentId: 'main', profileId: 'openai:default', profile });

    // Right reference, wrong owner: must not resolve.
    expect(
      await mod.resolveAuthProfileSecret(profile.key, { agentId: 'main', profileId: 'other:default' }),
    ).toBeNull();
    expect(
      await mod.resolveAuthProfileSecret(profile.key, { agentId: 'other-agent', profileId: 'openai:default' }),
    ).toBeNull();
    // Correct owner resolves.
    expect(
      await mod.resolveAuthProfileSecret(profile.key, { agentId: 'main', profileId: 'openai:default' }),
    ).toBe('sk-owned');
  });
});

describe('wechat account secret broker', () => {
  beforeEach(() => {
    vi.resetModules();
    storeData.wechatAccountSecrets = {};
    mockStore.get.mockImplementation((key: string) => storeData[key]);
    mockStore.set.mockImplementation((key: string, value: unknown) => {
      storeData[key] = value;
    });
  });

  it('keeps the bot token out of the returned account-state record', async () => {
    const crypto = makeTestCrypto();
    const mod = await import('@electron/services/secrets/wechat-account-secret-broker');
    mod.setWechatAccountSecretCryptoForTests(crypto);

    const canary = 'bot-token-canary-' + randomBytes(4).toString('hex');
    const record = await mod.sealWechatAccountToken({
      accountId: 'wx-acct-1',
      token: canary,
      meta: { savedAt: '2026-10-19T00:00:00.000Z', baseUrl: 'https://example.test' },
    });

    // The persisted record must not contain the token itself.
    expect(JSON.stringify(record)).not.toContain(canary);
    expect(record.baseUrl).toBe('https://example.test');
    expect(record.savedAt).toBe('2026-10-19T00:00:00.000Z');
    expect(typeof record.tokenSecretId).toBe('string');
  });

  it('resolves the sealed token back from the account-state reference', async () => {
    const crypto = makeTestCrypto();
    const mod = await import('@electron/services/secrets/wechat-account-secret-broker');
    mod.setWechatAccountSecretCryptoForTests(crypto);

    const token = 'bot-token-roundtrip';
    const record = await mod.sealWechatAccountToken({
      accountId: 'wx-acct-2',
      token,
      meta: { savedAt: '2026-10-19T00:00:00.000Z' },
    });

    expect(await mod.resolveWechatAccountToken('wx-acct-2', record)).toBe(token);
    expect(await mod.resolveWechatAccountToken('wx-acct-missing', record)).toBeNull();
    expect(await mod.resolveWechatAccountToken('wx-acct-2', {})).toBeNull();
  });

  it('re-sealing on login replaces the previous token', async () => {
    const crypto = makeTestCrypto();
    const mod = await import('@electron/services/secrets/wechat-account-secret-broker');
    mod.setWechatAccountSecretCryptoForTests(crypto);

    const first = await mod.sealWechatAccountToken({
      accountId: 'wx-acct-3',
      token: 'token-v1',
      meta: { savedAt: '2026-10-19T00:00:00.000Z' },
    });
    expect(await mod.resolveWechatAccountToken('wx-acct-3', first)).toBe('token-v1');

    const second = await mod.sealWechatAccountToken({
      accountId: 'wx-acct-3',
      token: 'token-v2',
      meta: { savedAt: '2026-10-19T01:00:00.000Z' },
    });
    expect(await mod.resolveWechatAccountToken('wx-acct-3', second)).toBe('token-v2');

    expect(await mod.deleteWechatAccountSecret('wx-acct-3')).toBe(1);
    expect(await mod.resolveWechatAccountToken('wx-acct-3', second)).toBeNull();
  });
});