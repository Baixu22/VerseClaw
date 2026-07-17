/**
 * MCP env secret broker ? Main-only resolution of server env values.
 *
 * - Renderer never receives plaintext (redacted via redactMcpEnvMap).
 * - Values may be sealed into encrypted envelopes when safeStorage is available.
 * - Runtime projection resolves SecretRef / legacy plaintext only in Main.
 */

import {
  isMaskedEnvValue,
  isMcpSecretRef,
  mcpEnvSecretId,
  type McpEnvMap,
  type McpSecretRef,
} from '../../../shared/mcp/secret-ref';
import type { SecretCrypto } from './secret-store';
import {
  resetSecretStoreCryptoForTests,
  setSecretStoreCryptoForTests,
} from './secret-store';

export type McpEnvSecretEnvelope =
  | { format: 'safeStorage-v1'; ciphertext: string }
  | { format: 'plaintext-v1'; value: string };

export type McpEnvSecretVault = Record<string, McpEnvSecretEnvelope>;

let cryptoImpl: SecretCrypto | null = null;
let cryptoResolved = false;
let vaultOverride: McpEnvSecretVault | null = null;

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
    // Unit tests / non-Electron.
  }
  return null;
}

/** Test hook ? reuse provider secret crypto DI. */
export function setMcpEnvBrokerCryptoForTests(crypto: SecretCrypto | null): void {
  setSecretStoreCryptoForTests(crypto);
  cryptoImpl = crypto;
  cryptoResolved = true;
}

export function resetMcpEnvBrokerCryptoForTests(): void {
  resetSecretStoreCryptoForTests();
  cryptoImpl = null;
  cryptoResolved = false;
  vaultOverride = null;
}

/** In-memory vault for unit tests (avoids electron-store). */
export function setMcpEnvVaultForTests(vault: McpEnvSecretVault | null): void {
  vaultOverride = vault;
}

export function getMcpEnvVaultForTests(): McpEnvSecretVault | null {
  return vaultOverride;
}

function sealValue(value: string, crypto: SecretCrypto | null): McpEnvSecretEnvelope {
  if (crypto?.isEncryptionAvailable()) {
    return {
      format: 'safeStorage-v1',
      ciphertext: crypto.encryptString(value).toString('base64'),
    };
  }
  return { format: 'plaintext-v1', value };
}

function openEnvelope(envelope: McpEnvSecretEnvelope, crypto: SecretCrypto | null): string | null {
  if (envelope.format === 'plaintext-v1') {
    return envelope.value;
  }
  if (!crypto?.isEncryptionAvailable()) {
    return null;
  }
  try {
    return crypto.decryptString(Buffer.from(envelope.ciphertext, 'base64'));
  } catch {
    return null;
  }
}

export async function putMcpEnvSecret(
  vault: McpEnvSecretVault,
  secretId: string,
  value: string,
): Promise<McpEnvSecretVault> {
  const crypto = await resolveCrypto();
  const next = { ...vault, [secretId]: sealValue(value, crypto) };
  if (vaultOverride) vaultOverride = next;
  return next;
}

export async function readMcpEnvSecret(
  vault: McpEnvSecretVault,
  secretId: string,
): Promise<string | null> {
  const entry = vault[secretId];
  if (!entry) return null;
  const crypto = await resolveCrypto();
  return openEnvelope(entry, crypto);
}

export function deleteMcpEnvSecretsForServer(
  vault: McpEnvSecretVault,
  serverId: string,
): McpEnvSecretVault {
  const prefix = `mcp-env:${serverId}:`;
  const next: McpEnvSecretVault = {};
  for (const [key, value] of Object.entries(vault)) {
    if (!key.startsWith(prefix)) {
      next[key] = value;
    }
  }
  if (vaultOverride) vaultOverride = next;
  return next;
}

/**
 * Ingest write-path env: plaintext strings become secret-refs in vault.
 * Masked values keep existing refs when present.
 */
export async function sealMcpEnvMap(input: {
  serverId: string;
  env: Record<string, string> | undefined;
  previousEnv?: McpEnvMap;
  vault: McpEnvSecretVault;
}): Promise<{ env: McpEnvMap | undefined; vault: McpEnvSecretVault }> {
  const { serverId, env, previousEnv } = input;
  let vault = { ...input.vault };

  if (!env || Object.keys(env).length === 0) {
    vault = deleteMcpEnvSecretsForServer(vault, serverId);
    return { env: undefined, vault };
  }

  const nextEnv: McpEnvMap = {};
  const keepIds = new Set<string>();

  for (const [rawKey, rawValue] of Object.entries(env)) {
    const key = rawKey.trim();
    if (!key) continue;
    const value = String(rawValue ?? '');
    const secretId = mcpEnvSecretId(serverId, key);
    const previous = previousEnv?.[key];

    if (isMaskedEnvValue(value)) {
      if (isMcpSecretRef(previous)) {
        nextEnv[key] = previous;
        keepIds.add(previous.secretId);
        continue;
      }
      if (typeof previous === 'string' && previous && !isMaskedEnvValue(previous)) {
        vault = await putMcpEnvSecret(vault, secretId, previous);
        nextEnv[key] = { kind: 'secret-ref', secretId } satisfies McpSecretRef;
        keepIds.add(secretId);
        continue;
      }
      continue;
    }

    if (!value) continue;

    vault = await putMcpEnvSecret(vault, secretId, value);
    nextEnv[key] = { kind: 'secret-ref', secretId } satisfies McpSecretRef;
    keepIds.add(secretId);
  }

  const prefix = `mcp-env:${serverId}:`;
  for (const id of Object.keys(vault)) {
    if (id.startsWith(prefix) && !keepIds.has(id)) {
      delete vault[id];
    }
  }

  if (vaultOverride) vaultOverride = vault;
  return {
    env: Object.keys(nextEnv).length > 0 ? nextEnv : undefined,
    vault,
  };
}

/** Resolve stored env (secret-ref or legacy plaintext) to runtime plaintext map. */
export async function resolveMcpEnvMap(
  env: McpEnvMap | Record<string, string> | undefined,
  vault: McpEnvSecretVault,
): Promise<Record<string, string> | undefined> {
  if (!env) return undefined;
  const resolved: Record<string, string> = {};
  for (const [key, entry] of Object.entries(env)) {
    if (isMcpSecretRef(entry)) {
      const value = await readMcpEnvSecret(vault, entry.secretId);
      if (value != null && value !== '') {
        resolved[key] = value;
      }
      continue;
    }
    if (typeof entry === 'string' && entry && !isMaskedEnvValue(entry)) {
      resolved[key] = entry;
    }
  }
  return Object.keys(resolved).length > 0 ? resolved : undefined;
}

/** Migrate legacy plaintext env maps into secret-refs. */
export async function migrateLegacyMcpEnv(
  serverId: string,
  env: McpEnvMap | Record<string, string> | undefined,
  vault: McpEnvSecretVault,
): Promise<{ env: McpEnvMap | undefined; vault: McpEnvSecretVault; migrated: boolean }> {
  if (!env) return { env: undefined, vault, migrated: false };
  const hasPlain = Object.values(env).some(
    (value) => typeof value === 'string' && value.length > 0 && !isMaskedEnvValue(value),
  );
  if (!hasPlain) {
    return { env: env as McpEnvMap, vault, migrated: false };
  }
  const plaintext: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') plaintext[key] = value;
    else if (isMcpSecretRef(value)) {
      const existing = await readMcpEnvSecret(vault, value.secretId);
      if (existing) plaintext[key] = existing;
    }
  }
  const sealed = await sealMcpEnvMap({
    serverId,
    env: plaintext,
    previousEnv: env as McpEnvMap,
    vault,
  });
  return { ...sealed, migrated: true };
}
