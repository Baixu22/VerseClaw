/**
 * Secret Broker - single source of truth for Provider (and related) secrets.
 *
 * - Renderer never receives plaintext; only hasKey / keyMasked / handles.
 * - Main process resolves secrets only through this module.
 * - No dual-write to legacy `apiKeys`.
 * - At rest: OS safeStorage encryption when available; legacy plaintext entries
 *   are migrated into encrypted envelopes on first read.
 */

import type { ProviderSecret } from '../../shared/providers/types';
import { getClawXProviderStore } from '../providers/store-instance';

export type SecretCrypto = {
  isEncryptionAvailable: () => boolean;
  encryptString: (value: string) => Buffer;
  decryptString: (value: Buffer) => string;
};

type EncryptedEnvelope = {
  format: 'safeStorage-v1';
  ciphertext: string;
};

type StoredSecretEntry = ProviderSecret | EncryptedEnvelope;

const ENVELOPE_FORMAT = 'safeStorage-v1' as const;

let cryptoImpl: SecretCrypto | null = null;
let cryptoResolved = false;

function isEncryptedEnvelope(value: unknown): value is EncryptedEnvelope {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return record.format === ENVELOPE_FORMAT && typeof record.ciphertext === 'string';
}

function isProviderSecret(value: unknown): value is ProviderSecret {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.type === 'string' && typeof record.accountId === 'string';
}

async function resolveCrypto(): Promise<SecretCrypto | null> {
  if (cryptoResolved) return cryptoImpl;
  cryptoResolved = true;
  if (cryptoImpl) return cryptoImpl;
  try {
    const electron = await import('electron');
    if (electron.safeStorage?.isEncryptionAvailable?.()) {
      cryptoImpl = electron.safeStorage;
      return cryptoImpl;
    }
  } catch {
    // Unit tests / non-Electron contexts — encryption unavailable.
  }
  return null;
}

/** Test-only / DI hook for secret encryption. */
export function setSecretStoreCryptoForTests(crypto: SecretCrypto | null): void {
  cryptoImpl = crypto;
  cryptoResolved = true;
}

export function resetSecretStoreCryptoForTests(): void {
  cryptoImpl = null;
  cryptoResolved = false;
}

function encryptSecret(secret: ProviderSecret, crypto: SecretCrypto): EncryptedEnvelope {
  const payload = JSON.stringify(secret);
  return {
    format: ENVELOPE_FORMAT,
    ciphertext: crypto.encryptString(payload).toString('base64'),
  };
}

function decryptEnvelope(envelope: EncryptedEnvelope, crypto: SecretCrypto): ProviderSecret {
  const json = crypto.decryptString(Buffer.from(envelope.ciphertext, 'base64'));
  const parsed = JSON.parse(json) as unknown;
  if (!isProviderSecret(parsed)) {
    throw new Error('Decrypted provider secret has invalid shape');
  }
  return parsed;
}

function secretContainsPlaintextFields(secret: ProviderSecret): string[] {
  const hits: string[] = [];
  if (secret.type === 'api_key' && secret.apiKey) hits.push(secret.apiKey);
  if (secret.type === 'local' && secret.apiKey) hits.push(secret.apiKey);
  if (secret.type === 'oauth') {
    if (secret.accessToken) hits.push(secret.accessToken);
    if (secret.refreshToken) hits.push(secret.refreshToken);
  }
  return hits;
}

export interface SecretStore {
  get(accountId: string): Promise<ProviderSecret | null>;
  set(secret: ProviderSecret): Promise<void>;
  delete(accountId: string): Promise<void>;
  has(accountId: string): Promise<boolean>;
  listAccountIds(): Promise<string[]>;
}

export class ElectronStoreSecretStore implements SecretStore {
  async get(accountId: string): Promise<ProviderSecret | null> {
    const store = await getClawXProviderStore();
    const secrets = (store.get('providerSecrets') ?? {}) as Record<string, StoredSecretEntry>;
    const entry = secrets[accountId];
    const crypto = await resolveCrypto();

    if (entry) {
      if (isEncryptedEnvelope(entry)) {
        if (!crypto) {
          console.error('Encrypted provider secret present but OS encryption is unavailable');
          return null;
        }
        try {
          return decryptEnvelope(entry, crypto);
        } catch (error) {
          console.error('Failed to decrypt provider secret:', error);
          return null;
        }
      }

      if (isProviderSecret(entry)) {
        // Migrate legacy plaintext providerSecrets → encrypted when possible.
        if (crypto?.isEncryptionAvailable()) {
          secrets[accountId] = encryptSecret(entry, crypto);
          store.set('providerSecrets', secrets);
          await this.clearLegacyApiKey(store, accountId);
        }
        return entry;
      }
    }

    // One-time migrate from legacy apiKeys into providerSecrets, then delete apiKeys entry.
    const apiKeys = (store.get('apiKeys') ?? {}) as Record<string, string>;
    const apiKey = apiKeys[accountId];
    if (!apiKey) {
      return null;
    }

    const migrated: ProviderSecret = {
      type: 'api_key',
      accountId,
      apiKey,
    };

    if (crypto?.isEncryptionAvailable()) {
      secrets[accountId] = encryptSecret(migrated, crypto);
    } else {
      secrets[accountId] = migrated;
    }
    store.set('providerSecrets', secrets);
    delete apiKeys[accountId];
    store.set('apiKeys', apiKeys);
    return migrated;
  }

  async set(secret: ProviderSecret): Promise<void> {
    const store = await getClawXProviderStore();
    const secrets = (store.get('providerSecrets') ?? {}) as Record<string, StoredSecretEntry>;
    const crypto = await resolveCrypto();

    if (crypto?.isEncryptionAvailable()) {
      secrets[secret.accountId] = encryptSecret(secret, crypto);
    } else if (process.env.CLAWX_SECRET_PLAINTEXT_FALLBACK === '1') {
      // Explicit opt-in for offline tooling / headless tests without OS crypto.
      secrets[secret.accountId] = secret;
    } else {
      // Prefer refusing plaintext dual-path; still allow single-source plaintext
      // only when encryption truly unavailable (documented degradation).
      secrets[secret.accountId] = secret;
    }
    store.set('providerSecrets', secrets);

    // Never dual-write plaintext into legacy apiKeys.
    await this.clearLegacyApiKey(store, secret.accountId);
  }

  async delete(accountId: string): Promise<void> {
    const store = await getClawXProviderStore();
    const secrets = (store.get('providerSecrets') ?? {}) as Record<string, StoredSecretEntry>;
    delete secrets[accountId];
    store.set('providerSecrets', secrets);
    await this.clearLegacyApiKey(store, accountId);
  }

  async has(accountId: string): Promise<boolean> {
    const store = await getClawXProviderStore();
    const secrets = (store.get('providerSecrets') ?? {}) as Record<string, StoredSecretEntry>;
    if (secrets[accountId]) return true;
    const apiKeys = (store.get('apiKeys') ?? {}) as Record<string, string>;
    return Boolean(apiKeys[accountId]);
  }

  async listAccountIds(): Promise<string[]> {
    const store = await getClawXProviderStore();
    const secrets = (store.get('providerSecrets') ?? {}) as Record<string, StoredSecretEntry>;
    const apiKeys = (store.get('apiKeys') ?? {}) as Record<string, string>;
    return Array.from(new Set([...Object.keys(secrets), ...Object.keys(apiKeys)]));
  }

  private async clearLegacyApiKey(
    store: { get: (key: string) => unknown; set: (key: string, value: unknown) => void },
    accountId: string,
  ): Promise<void> {
    const apiKeys = (store.get('apiKeys') ?? {}) as Record<string, string>;
    if (!(accountId in apiKeys)) return;
    delete apiKeys[accountId];
    store.set('apiKeys', apiKeys);
  }
}

const secretStore = new ElectronStoreSecretStore();

export function getSecretStore(): SecretStore {
  return secretStore;
}

export async function getProviderSecret(accountId: string): Promise<ProviderSecret | null> {
  return getSecretStore().get(accountId);
}

export async function setProviderSecret(secret: ProviderSecret): Promise<void> {
  await getSecretStore().set(secret);
}

export async function deleteProviderSecret(accountId: string): Promise<void> {
  await getSecretStore().delete(accountId);
}

export async function hasProviderSecret(accountId: string): Promise<boolean> {
  return getSecretStore().has(accountId);
}

export async function listProviderSecretAccountIds(): Promise<string[]> {
  return getSecretStore().listAccountIds();
}

/**
 * Assert a canary string does not appear as plaintext in provider store records.
 * Used by maturity canary scans (A3).
 */
export function assertNoPlaintextCanaryInProviderStoreRecords(
  storeSnapshot: Record<string, unknown>,
  canary: string,
): { ok: boolean; hits: string[] } {
  const hits: string[] = [];
  const apiKeys = (storeSnapshot.apiKeys ?? {}) as Record<string, string>;
  for (const [id, value] of Object.entries(apiKeys)) {
    if (typeof value === 'string' && value.includes(canary)) {
      hits.push(`apiKeys.${id}`);
    }
  }
  const secrets = (storeSnapshot.providerSecrets ?? {}) as Record<string, unknown>;
  for (const [id, entry] of Object.entries(secrets)) {
    if (isEncryptedEnvelope(entry)) {
      // Ciphertext must not contain the canary as a readable substring in normal cases;
      // base64 of encrypted data is not a guarantee, so only fail on exact canary match.
      if (entry.ciphertext.includes(canary)) {
        hits.push(`providerSecrets.${id}.ciphertext`);
      }
      continue;
    }
    if (isProviderSecret(entry)) {
      for (const field of secretContainsPlaintextFields(entry)) {
        if (field.includes(canary)) {
          hits.push(`providerSecrets.${id}.plaintext`);
        }
      }
    }
  }
  return { ok: hits.length === 0, hits };
}
