/**
 * Channel secret broker (P8-002 / F-SEC-001 residual).
 *
 * - Seals Verse Claw-managed channel credential fields into encrypted envelopes.
 * - Renderer never reads this vault; getChannelFormValues stays redacted.
 * - OpenClaw may still co-read plaintext from openclaw.json (documented residual).
 * - Main can resolve sealed values without dual-writing plaintext into provider apiKeys.
 */

import { getClawXProviderStore } from '../providers/store-instance';
import type { SecretCrypto } from './secret-store';
import {
  resetSecretStoreCryptoForTests,
  setSecretStoreCryptoForTests,
} from './secret-store';

const CHANNEL_SECRET_FIELD_RE = /(secret|token|password|passwd|api[_-]?key|encryptkey|appsecret|bottoken|webhook)/i;

export type ChannelSecretEnvelope =
  | { format: 'safeStorage-v1'; ciphertext: string }
  | { format: 'plaintext-v1'; value: string };

export type ChannelSecretVault = Record<string, ChannelSecretEnvelope>;

let cryptoImpl: SecretCrypto | null = null;
let cryptoResolved = false;
let vaultOverride: ChannelSecretVault | null = null;

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
    // unit tests / non-Electron
  }
  return null;
}

export function setChannelSecretBrokerCryptoForTests(crypto: SecretCrypto | null): void {
  setSecretStoreCryptoForTests(crypto);
  cryptoImpl = crypto;
  cryptoResolved = true;
}

export function resetChannelSecretBrokerCryptoForTests(): void {
  resetSecretStoreCryptoForTests();
  cryptoImpl = null;
  cryptoResolved = false;
  vaultOverride = null;
}

export function setChannelSecretVaultForTests(vault: ChannelSecretVault | null): void {
  vaultOverride = vault;
}

export function channelSecretVaultKey(channelType: string, accountId: string, field: string): string {
  return `${channelType}::${accountId}::${field}`;
}

export function isChannelSecretField(field: string): boolean {
  return CHANNEL_SECRET_FIELD_RE.test(field);
}

function encryptValue(value: string, crypto: SecretCrypto): ChannelSecretEnvelope {
  return {
    format: 'safeStorage-v1',
    ciphertext: crypto.encryptString(value).toString('base64'),
  };
}

function decryptEnvelope(envelope: ChannelSecretEnvelope, crypto: SecretCrypto | null): string | null {
  if (envelope.format === 'plaintext-v1') return envelope.value;
  if (!crypto) return null;
  try {
    return crypto.decryptString(Buffer.from(envelope.ciphertext, 'base64'));
  } catch {
    return null;
  }
}

async function readVault(): Promise<ChannelSecretVault> {
  if (vaultOverride) return vaultOverride;
  const store = await getClawXProviderStore();
  return { ...((store.get('channelSecrets') ?? {}) as ChannelSecretVault) };
}

async function writeVault(vault: ChannelSecretVault): Promise<void> {
  if (vaultOverride) {
    vaultOverride = { ...vault };
    return;
  }
  const store = await getClawXProviderStore();
  store.set('channelSecrets', vault);
}

/**
 * Seal secret-shaped fields from a channel config map into the vault.
 * Returns list of sealed field names.
 */
export async function sealChannelSecrets(params: {
  channelType: string;
  accountId: string;
  values: Record<string, unknown>;
}): Promise<string[]> {
  const { channelType, accountId, values } = params;
  const crypto = await resolveCrypto();
  const vault = await readVault();
  const sealed: string[] = [];

  for (const [field, raw] of Object.entries(values)) {
    if (typeof raw !== 'string') continue;
    if (!isChannelSecretField(field)) continue;
    const value = raw.trim();
    if (!value) continue;
    // Skip already-redacted Renderer echoes (????xxxx)
    if (/^\?{4}/.test(value) && value.length <= 12) continue;

    const key = channelSecretVaultKey(channelType, accountId, field);
    if (crypto?.isEncryptionAvailable()) {
      vault[key] = encryptValue(value, crypto);
    } else {
      vault[key] = { format: 'plaintext-v1', value };
    }
    sealed.push(field);
  }

  if (sealed.length) await writeVault(vault);
  return sealed;
}

export async function resolveChannelSecret(
  channelType: string,
  accountId: string,
  field: string,
): Promise<string | null> {
  const vault = await readVault();
  const key = channelSecretVaultKey(channelType, accountId, field);
  const envelope = vault[key];
  if (!envelope) return null;
  const crypto = await resolveCrypto();
  return decryptEnvelope(envelope, crypto);
}

export async function listSealedChannelSecretKeys(): Promise<string[]> {
  const vault = await readVault();
  return Object.keys(vault);
}

/** Fail closed if a canary appears as plaintext in vault records. */
export function assertNoPlaintextCanaryInChannelVault(
  vault: ChannelSecretVault,
  canary: string,
): { ok: boolean; hits: string[] } {
  const hits: string[] = [];
  for (const [key, envelope] of Object.entries(vault)) {
    if (envelope.format === 'safeStorage-v1') {
      if (envelope.ciphertext.includes(canary)) hits.push(`${key}.ciphertext`);
      continue;
    }
    if (envelope.format === 'plaintext-v1' && envelope.value.includes(canary)) {
      hits.push(`${key}.plaintext`);
    }
  }
  return { ok: hits.length === 0, hits };
}
