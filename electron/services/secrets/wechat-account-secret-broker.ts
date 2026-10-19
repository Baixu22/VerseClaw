/**
 * WeChat account-state secret broker.
 *
 * `openclaw-weixin/accounts/<id>.json` persisted the bot token in cleartext.
 * The token is also sealed through `channel-secret-broker` when the channel
 * config is saved, so this file is a second, unprotected copy of the same
 * credential. This broker keeps the account-state file crash-safe (atomic
 * write + `.bak`) while moving the token into the channel vault, leaving only
 * non-sensitive routing metadata on disk.
 *
 * The account index (`accounts.json`) holds only account ids and is written
 * atomically; it contains no credential.
 */

import { getClawXProviderStore } from '../providers/store-instance';
import type { SecretCrypto } from './secret-store';
import {
  resetSecretStoreCryptoForTests,
  setSecretStoreCryptoForTests,
} from './secret-store';

const VAULT_NAMESPACE = 'wechat-account';
const TOKEN_FIELD = 'token';

export type WechatAccountSecretEnvelope =
  | { format: 'safeStorage-v1'; ciphertext: string }
  | { format: 'plaintext-v1'; value: string };

let cryptoImpl: SecretCrypto | null = null;
let cryptoResolved = false;
let vaultOverride: Record<string, WechatAccountSecretEnvelope> | null = null;

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
    // unit tests / non-Electron contexts
  }
  return null;
}

export function setWechatAccountSecretCryptoForTests(crypto: SecretCrypto | null): void {
  setSecretStoreCryptoForTests(crypto);
  cryptoImpl = crypto;
  cryptoResolved = true;
}

export function resetWechatAccountSecretCryptoForTests(): void {
  resetSecretStoreCryptoForTests();
  cryptoImpl = null;
  cryptoResolved = false;
  vaultOverride = null;
}

export function wechatAccountSecretId(accountId: string): string {
  return `${VAULT_NAMESPACE}::${accountId}::${TOKEN_FIELD}`;
}

async function readVault(): Promise<Record<string, WechatAccountSecretEnvelope>> {
  if (vaultOverride) return { ...vaultOverride };
  const store = await getClawXProviderStore();
  const existing = (store.get('wechatAccountSecrets') ?? {}) as Record<
    string,
    WechatAccountSecretEnvelope
  >;
  return { ...existing };
}

async function writeVault(vault: Record<string, WechatAccountSecretEnvelope>): Promise<void> {
  if (vaultOverride) {
    vaultOverride = { ...vault };
    return;
  }
  const store = await getClawXProviderStore();
  store.set('wechatAccountSecrets', vault);
}

/** Seal `token` into the vault and return the redacted account-state record. */
export async function sealWechatAccountToken(params: {
  accountId: string;
  token: string;
  meta: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const { accountId, token, meta } = params;
  const crypto = await resolveCrypto();
  const vault = await readVault();
  const secretId = wechatAccountSecretId(accountId);
  vault[secretId] = crypto?.isEncryptionAvailable()
    ? { format: 'safeStorage-v1', ciphertext: crypto.encryptString(token).toString('base64') }
    : { format: 'plaintext-v1', value: token };
  await writeVault(vault);
  // The account-state file keeps routing metadata only; the token lives in the
  // vault under `secretId`.
  return { ...meta, tokenSecretId: secretId };
}

/**
 * Resolve a sealed bot token back to plaintext.
 *
 * The caller-supplied `accountId` must match the namespace of the stored
 * reference: a reference copied out of one account record must not resolve
 * while being presented as another account. Otherwise the argument would be
 * decorative and any account could read any other account's token.
 */
export async function resolveWechatAccountToken(
  accountId: string,
  stored: unknown,
): Promise<string | null> {
  const secretId =
    typeof stored === 'string' && stored
      ? stored
      : stored && typeof stored === 'object'
        ? (stored as Record<string, unknown>).tokenSecretId
        : undefined;
  if (typeof secretId !== 'string' || !secretId) return null;
  // Ownership check: the reference must belong to this account.
  if (!secretId.startsWith(`${VAULT_NAMESPACE}::${accountId}::`)) return null;
  const vault = await readVault();
  const envelope = vault[secretId];
  if (!envelope) return null;
  if (envelope.format === 'plaintext-v1') return envelope.value;
  const crypto = await resolveCrypto();
  if (!crypto) return null;
  try {
    return crypto.decryptString(Buffer.from(envelope.ciphertext, 'base64'));
  } catch {
    return null;
  }
}

/** Remove the sealed token for one account (account removed / re-login). */
export async function deleteWechatAccountSecret(accountId: string): Promise<number> {
  const vault = await readVault();
  const secretId = wechatAccountSecretId(accountId);
  if (!(secretId in vault)) return 0;
  delete vault[secretId];
  await writeVault(vault);
  return 1;
}