/**
 * Auth-profile secret broker.
 *
 * Closes the third plaintext credential surface: OpenClaw's
 * `agents/<id>/auth-profiles.json` stores OAuth access/refresh tokens and
 * provider API keys in cleartext, unlike `providerSecrets` / `channelSecrets`
 * (safeStorage envelopes) and `settings.gatewayToken`.
 *
 * Design mirrors `channel-secret-broker.ts` exactly (SOPS-style: structure
 * visible, values sealed in a vault, the store file keeps only a reference):
 *
 *   - Vault namespace: `auth-profile::<agentId>::<profileId>::<field>`
 *   - `auth-profiles.json` keeps a `secretRef` object instead of the plaintext.
 *   - Reads accept three shapes so nothing breaks for existing users:
 *       1. sealed    -> `{ type, provider, access: { kind, secretId } }`
 *       2. plaintext -> `{ type, provider, access: 'sk-...' }`   (legacy)
 *       3. mixed     -> some fields sealed, others still plaintext
 *   - First read of a legacy profile seals it and writes the file back, so the
 *     migration is self-healing and idempotent.
 *
 * The gateway (`openclaw_runtime`) also reads `auth-profiles.json` directly, so
 * this module keeps the original field names and replaces only their value:
 * on-disk shape stays a plain JSON object with the runtime-expected keys.
 */

import { getClawXProviderStore } from '../providers/store-instance';
import type { SecretCrypto } from './secret-store';
import {
  resetSecretStoreCryptoForTests,
  setSecretStoreCryptoForTests,
} from './secret-store';

export type AuthProfileSecretEnvelope =
  | { format: 'safeStorage-v1'; ciphertext: string }
  | { format: 'plaintext-v1'; value: string };

export type AuthProfileSecretVault = Record<string, AuthProfileSecretEnvelope>;

/** Reference stored in place of a plaintext credential. */
export type AuthProfileSecretRef = {
  kind: 'auth-profile-secret';
  secretId: string;
};

const VAULT_NAMESPACE = 'auth-profile';
export const AUTH_PROFILE_SECRET_FIELDS = ['access', 'refresh', 'key'] as const;
export type AuthProfileSecretField = (typeof AUTH_PROFILE_SECRET_FIELDS)[number];

let cryptoImpl: SecretCrypto | null = null;
let cryptoResolved = false;
let vaultOverride: AuthProfileSecretVault | null = null;

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

export function setAuthProfileSecretBrokerCryptoForTests(crypto: SecretCrypto | null): void {
  setSecretStoreCryptoForTests(crypto);
  cryptoImpl = crypto;
  cryptoResolved = true;
}

export function resetAuthProfileSecretBrokerCryptoForTests(): void {
  resetSecretStoreCryptoForTests();
  cryptoImpl = null;
  cryptoResolved = false;
  vaultOverride = null;
}

export function setAuthProfileSecretVaultForTests(vault: AuthProfileSecretVault | null): void {
  vaultOverride = vault;
}

export function authProfileSecretId(
  agentId: string,
  profileId: string,
  field: AuthProfileSecretField,
): string {
  return `${VAULT_NAMESPACE}::${agentId}::${profileId}::${field}`;
}

export function isAuthProfileSecretField(field: string): field is AuthProfileSecretField {
  return (AUTH_PROFILE_SECRET_FIELDS as readonly string[]).includes(field);
}

export function isAuthProfileSecretRef(value: unknown): value is AuthProfileSecretRef {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return record.kind === 'auth-profile-secret' && typeof record.secretId === 'string';
}

function encryptValue(value: string, crypto: SecretCrypto): AuthProfileSecretEnvelope {
  return {
    format: 'safeStorage-v1',
    ciphertext: crypto.encryptString(value).toString('base64'),
  };
}

function decryptEnvelope(
  envelope: AuthProfileSecretEnvelope,
  crypto: SecretCrypto | null,
): string | null {
  if (envelope.format === 'plaintext-v1') return envelope.value;
  if (!crypto) return null;
  try {
    return crypto.decryptString(Buffer.from(envelope.ciphertext, 'base64'));
  } catch {
    return null;
  }
}

async function readVault(): Promise<AuthProfileSecretVault> {
  if (vaultOverride) return { ...vaultOverride };
  const store = await getClawXProviderStore();
  const existing = (store.get('authProfileSecrets') ?? {}) as AuthProfileSecretVault;
  return { ...existing };
}

async function writeVault(vault: AuthProfileSecretVault): Promise<void> {
  if (vaultOverride) {
    vaultOverride = { ...vault };
    return;
  }
  const store = await getClawXProviderStore();
  store.set('authProfileSecrets', vault);
}

/**
 * Seal the credential fields of one auth profile.
 *
 * Mutates `profile` in place: each plaintext credential field is replaced by a
 * `secretRef` and the plaintext moves into the vault. Returns the sealed field
 * names so the caller knows whether a write-back is required.
 */
export async function sealAuthProfileSecrets(params: {
  agentId: string;
  profileId: string;
  profile: Record<string, unknown>;
}): Promise<AuthProfileSecretField[]> {
  const { agentId, profileId, profile } = params;
  const crypto = await resolveCrypto();
  const vault = await readVault();
  const sealed: AuthProfileSecretField[] = [];

  for (const field of AUTH_PROFILE_SECRET_FIELDS) {
    const raw = profile[field];
    if (typeof raw !== 'string') continue;
    const value = raw.trim();
    if (!value) continue;

    const secretId = authProfileSecretId(agentId, profileId, field);
    vault[secretId] = crypto?.isEncryptionAvailable()
      ? encryptValue(value, crypto)
      : { format: 'plaintext-v1', value };

    // Keep the runtime contract intact: the gateway still sees a field named
    // `access` / `refresh` / `key`; only its value becomes a sealed reference.
    profile[field] = { kind: 'auth-profile-secret', secretId } satisfies AuthProfileSecretRef;
    sealed.push(field);
  }

  if (sealed.length) await writeVault(vault);
  return sealed;
}

/**
 * Resolve a credential field to plaintext, accepting sealed refs and legacy
 * plaintext. Returns null when the value is unavailable (for example an
 * encrypted envelope read on a host without OS keyring access).
 *
 * When `agentId` and `profileId` are supplied the sealed reference must belong
 * to that agent/profile namespace, so a reference copied out of one profile
 * cannot be resolved while presented as another.
 */
export async function resolveAuthProfileSecret(
  value: unknown,
  owner?: { agentId: string; profileId: string },
): Promise<string | null> {
  if (isAuthProfileSecretRef(value)) {
    if (owner) {
      const expectedPrefix = `${VAULT_NAMESPACE}::${owner.agentId}::${owner.profileId}::`;
      if (!value.secretId.startsWith(expectedPrefix)) return null;
    }
    const vault = await readVault();
    const envelope = vault[value.secretId];
    if (!envelope) return null;
    const crypto = await resolveCrypto();
    if (envelope.format === 'safeStorage-v1' && !crypto?.isEncryptionAvailable()) {
      // Fail closed: refuse to guess rather than surfacing a partial value.
      return null;
    }
    return decryptEnvelope(envelope, crypto);
  }
  if (typeof value === 'string' && value.trim()) return value;
  return null;
}

/**
 * Remove vault entries for specific profiles of one agent.
 *
 * Deletion must be profile-scoped, never agent-wide: a provider removal only
 * owns its own profile ids, and dropping the whole agent namespace would
 * silently destroy credentials for every other provider still configured.
 */
export async function deleteAuthProfileSecrets(
  agentId: string,
  profileIds: readonly string[],
): Promise<number> {
  if (!profileIds.length) return 0;
  const vault = await readVault();
  const doomed = Object.keys(vault).filter((key) =>
    profileIds.some((profileId) => key.startsWith(`${VAULT_NAMESPACE}::${agentId}::${profileId}::`)),
  );
  if (!doomed.length) return 0;
  for (const key of doomed) delete vault[key];
  await writeVault(vault);
  return doomed.length;
}

/** Fail closed if a canary appears as plaintext anywhere in the vault. */
export function assertNoPlaintextCanaryInAuthProfileVault(
  vault: AuthProfileSecretVault,
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