import { app, safeStorage } from 'electron';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

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

export class AgentBrowserVault {
  private readonly userDataPath?: string;
  private readonly crypto: VaultCrypto;
  private readonly now: () => Date;

  constructor(options: AgentBrowserVaultOptions = {}) {
    this.userDataPath = options.userDataPath;
    this.crypto = options.crypto ?? safeStorage;
    this.now = options.now ?? (() => new Date());
  }

  async list(): Promise<AgentBrowserCredentialMetadata[]> {
    return (await this.read()).credentials.map(({ encryptedPassword: _secret, ...metadata }) => metadata);
  }

  async save(payload: AgentBrowserCredentialSavePayload): Promise<AgentBrowserCredentialMetadata> {
    if (!this.crypto.isEncryptionAvailable()) {
      throw new Error('OS-protected encryption is unavailable');
    }
    const profile = normalizeProfile(payload.profile);
    const origin = normalizeHttpsOrigin(payload.origin);
    const username = payload.username.trim();
    if (!username) throw new Error('Credential username is required');
    if (!payload.password) throw new Error('Credential password is required');

    const file = await this.read();
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
    const file = await this.read();
    file.credentials = file.credentials.filter((entry) => entry.id !== credentialId);
    await this.write(file);
  }

  async resolveSecret(payload: {
    credentialId: string;
    profile: string;
    origin: string;
  }): Promise<string> {
    if (!this.crypto.isEncryptionAvailable()) {
      throw new Error('OS-protected encryption is unavailable');
    }
    const profile = normalizeProfile(payload.profile);
    const origin = normalizeHttpsOrigin(payload.origin);
    const entry = (await this.read()).credentials.find((item) => item.id === payload.credentialId);
    if (!entry || entry.profile !== profile || entry.origin !== origin) {
      throw new Error('Credential does not match the requested profile and origin');
    }
    return this.crypto.decryptString(Buffer.from(entry.encryptedPassword, 'base64'));
  }

  private path(): string {
    return join(this.userDataPath ?? app.getPath('userData'), 'agent-browser', 'vault.json');
  }

  private async read(): Promise<VaultFile> {
    try {
      const parsed = JSON.parse(await readFile(this.path(), 'utf8')) as Partial<VaultFile>;
      return {
        version: 1,
        credentials: Array.isArray(parsed.credentials) ? parsed.credentials : [],
      };
    } catch {
      return { version: 1, credentials: [] };
    }
  }

  private async write(file: VaultFile): Promise<void> {
    await mkdir(join(this.userDataPath ?? app.getPath('userData'), 'agent-browser'), { recursive: true });
    await writeFile(this.path(), JSON.stringify(file, null, 2), 'utf8');
  }
}
