import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { join } from 'node:path';
import { tryElectron } from '../host/electron-optional.ts';

export type AgentBrowserCredentialMetadata = {
  id: string;
  profile: string;
  origin: string;
  username: string;
  createdAt: string;
  updatedAt: string;
};

export type AgentBrowserCredentialSavePayload = {
  id?: string;
  profile: string;
  origin: string;
  username: string;
  password: string;
};

export type AgentBrowserVaultState =
  | 'not_configured'
  | 'ready'
  | 'corrupted'
  | 'encryption_unavailable';

export type AgentBrowserVaultHealth = {
  state: AgentBrowserVaultState;
  path: string;
  credentialCount: number;
  /** Machine-readable error code when not ready. */
  errorCode?: 'VAULT_NOT_CONFIGURED' | 'VAULT_CORRUPTED' | 'VAULT_ENCRYPTION_UNAVAILABLE';
  errorMessage?: string;
};

export class AgentBrowserVaultError extends Error {
  readonly code: NonNullable<AgentBrowserVaultHealth['errorCode']>;

  constructor(code: NonNullable<AgentBrowserVaultHealth['errorCode']>, message: string) {
    super(message);
    this.name = 'AgentBrowserVaultError';
    this.code = code;
  }
}

type StoredCredential = AgentBrowserCredentialMetadata & {
  encryptedPassword: string;
};

type VaultFile = {
  version: 1;
  credentials: StoredCredential[];
};

type VaultCrypto = {
  isEncryptionAvailable: () => boolean;
  encryptString: (value: string) => Buffer;
  decryptString: (value: Buffer) => string;
};

type AgentBrowserVaultOptions = {
  userDataPath?: string;
  crypto?: VaultCrypto;
  now?: () => Date;
};

function normalizeProfile(value: string): string {
  const profile = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
  if (!profile) throw new Error('Credential profile is required');
  return profile;
}

function normalizeHttpsOrigin(value: string): string {
  const parsed = new URL(value.trim());
  if (parsed.protocol !== 'https:') {
    throw new Error('Credential storage requires an HTTPS origin');
  }
  return parsed.origin;
}

function isNodeErrno(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && (error as { code?: string }).code === code);
}

export class AgentBrowserVault {
  private readonly userDataPath?: string;
  private readonly crypto: VaultCrypto;
  private readonly now: () => Date;

  constructor(options: AgentBrowserVaultOptions = {}) {
    this.userDataPath = options.userDataPath;
    const fallbackCrypto: VaultCrypto = {
      isEncryptionAvailable: () => false,
      encryptString: () => {
        throw new Error('OS-protected encryption is unavailable (electron safeStorage not loaded)');
      },
      decryptString: () => {
        throw new Error('OS-protected encryption is unavailable (electron safeStorage not loaded)');
      },
    };
    this.crypto = options.crypto ?? tryElectron()?.safeStorage ?? fallbackCrypto;
    this.now = options.now ?? (() => new Date());
  }

  /**
   * Distinguish vault not configured vs corrupted vs ready.
   * Fail-closed: corruption never masquerades as empty/not configured.
   */
  async health(): Promise<AgentBrowserVaultHealth> {
    const path = this.path();
    if (!this.crypto.isEncryptionAvailable()) {
      return {
        state: 'encryption_unavailable',
        path,
        credentialCount: 0,
        errorCode: 'VAULT_ENCRYPTION_UNAVAILABLE',
        errorMessage: 'OS-protected encryption is unavailable',
      };
    }
    try {
      await access(path, fsConstants.F_OK);
    } catch (error) {
      if (isNodeErrno(error, 'ENOENT')) {
        return {
          state: 'not_configured',
          path,
          credentialCount: 0,
          errorCode: 'VAULT_NOT_CONFIGURED',
          errorMessage: 'Agent browser vault has not been configured yet',
        };
      }
      return {
        state: 'corrupted',
        path,
        credentialCount: 0,
        errorCode: 'VAULT_CORRUPTED',
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }

    try {
      const file = await this.read({ allowMissing: false });
      return {
        state: 'ready',
        path,
        credentialCount: file.credentials.length,
      };
    } catch (error) {
      if (error instanceof AgentBrowserVaultError && error.code === 'VAULT_NOT_CONFIGURED') {
        return {
          state: 'not_configured',
          path,
          credentialCount: 0,
          errorCode: 'VAULT_NOT_CONFIGURED',
          errorMessage: error.message,
        };
      }
      const message = error instanceof Error ? error.message : String(error);
      return {
        state: 'corrupted',
        path,
        credentialCount: 0,
        errorCode: 'VAULT_CORRUPTED',
        errorMessage: message,
      };
    }
  }

  async list(): Promise<AgentBrowserCredentialMetadata[]> {
    return (await this.read({ allowMissing: true })).credentials.map(
      ({ encryptedPassword: _secret, ...metadata }) => metadata,
    );
  }

  async save(payload: AgentBrowserCredentialSavePayload): Promise<AgentBrowserCredentialMetadata> {
    if (!this.crypto.isEncryptionAvailable()) {
      throw new AgentBrowserVaultError(
        'VAULT_ENCRYPTION_UNAVAILABLE',
        'OS-protected encryption is unavailable',
      );
    }
    const profile = normalizeProfile(payload.profile);
    const origin = normalizeHttpsOrigin(payload.origin);
    const username = payload.username.trim();
    if (!username) throw new Error('Credential username is required');
    if (!payload.password) throw new Error('Credential password is required');

    const file = await this.read({ allowMissing: true });
    const existing = file.credentials.find((entry) => (
      (payload.id ? entry.id === payload.id : false)
      || (entry.profile === profile && entry.origin === origin && entry.username === username)
    ));
    const timestamp = this.now().toISOString();
    const stored: StoredCredential = {
      id: existing?.id ?? randomUUID(),
      profile,
      origin,
      username,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
      encryptedPassword: this.crypto.encryptString(payload.password).toString('base64'),
    };
    file.credentials = [
      ...file.credentials.filter((entry) => entry.id !== stored.id),
      stored,
    ];
    await this.write(file);
    const { encryptedPassword: _secret, ...metadata } = stored;
    return metadata;
  }

  async delete(credentialId: string): Promise<void> {
    const file = await this.read({ allowMissing: true });
    file.credentials = file.credentials.filter((entry) => entry.id !== credentialId);
    await this.write(file);
  }

  async resolveSecret(payload: {
    credentialId: string;
    profile: string;
    origin: string;
  }): Promise<string> {
    if (!this.crypto.isEncryptionAvailable()) {
      throw new AgentBrowserVaultError(
        'VAULT_ENCRYPTION_UNAVAILABLE',
        'OS-protected encryption is unavailable',
      );
    }
    const profile = normalizeProfile(payload.profile);
    const origin = normalizeHttpsOrigin(payload.origin);
    const entry = (await this.read({ allowMissing: true })).credentials.find(
      (item) => item.id === payload.credentialId,
    );
    if (!entry || entry.profile !== profile || entry.origin !== origin) {
      throw new Error('Credential does not match the requested profile and origin');
    }
    return this.crypto.decryptString(Buffer.from(entry.encryptedPassword, 'base64'));
  }

  private path(): string {
    return join(this.userDataPath ?? tryElectron()?.app?.getPath('userData') ?? join(process.cwd(), '.agent-browser-data'), 'agent-browser', 'vault.json');
  }

  private async read(options: { allowMissing: boolean }): Promise<VaultFile> {
    try {
      const raw = await readFile(this.path(), 'utf8');
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new AgentBrowserVaultError(
          'VAULT_CORRUPTED',
          'Agent browser vault is corrupted (invalid JSON)',
        );
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new AgentBrowserVaultError(
          'VAULT_CORRUPTED',
          'Agent browser vault is corrupted (invalid shape)',
        );
      }
      const record = parsed as Partial<VaultFile>;
      if (record.version !== 1 && record.version !== undefined) {
        throw new AgentBrowserVaultError(
          'VAULT_CORRUPTED',
          `Agent browser vault is corrupted (unsupported version ${String(record.version)})`,
        );
      }
      if (record.credentials !== undefined && !Array.isArray(record.credentials)) {
        throw new AgentBrowserVaultError(
          'VAULT_CORRUPTED',
          'Agent browser vault is corrupted (credentials is not an array)',
        );
      }
      return {
        version: 1,
        credentials: Array.isArray(record.credentials) ? record.credentials as StoredCredential[] : [],
      };
    } catch (error) {
      if (error instanceof AgentBrowserVaultError) throw error;
      if (isNodeErrno(error, 'ENOENT')) {
        if (options.allowMissing) {
          return { version: 1, credentials: [] };
        }
        throw new AgentBrowserVaultError(
          'VAULT_NOT_CONFIGURED',
          'Agent browser vault has not been configured yet',
        );
      }
      throw new AgentBrowserVaultError(
        'VAULT_CORRUPTED',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private async write(file: VaultFile): Promise<void> {
    await mkdir(join(this.userDataPath ?? tryElectron()?.app?.getPath('userData') ?? join(process.cwd(), '.agent-browser-data'), 'agent-browser'), { recursive: true });
    await writeFile(this.path(), JSON.stringify(file, null, 2), 'utf8');
  }
}
