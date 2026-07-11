import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AgentBrowserVault } from '@electron/services/agent-browser-vault';

function createCrypto(available = true) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (value: string) => Buffer.from(`sealed:${value}`, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8').replace(/^sealed:/, ''),
  };
}

describe('agent browser credential vault', () => {
  it('fails closed when operating-system encryption is unavailable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-browser-vault-'));
    try {
      const vault = new AgentBrowserVault({ userDataPath: root, crypto: createCrypto(false) });
      await expect(vault.save({
        profile: 'work',
        origin: 'https://example.com',
        username: 'ada@example.com',
        password: 'correct horse battery staple',
      })).rejects.toThrow('OS-protected encryption is unavailable');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('persists encrypted bytes and returns metadata without plaintext secrets', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-browser-vault-'));
    try {
      const vault = new AgentBrowserVault({
        userDataPath: root,
        crypto: createCrypto(),
        now: () => new Date('2026-07-11T10:00:00.000Z'),
      });
      const entry = await vault.save({
        profile: 'Work',
        origin: 'https://Example.com/login',
        username: 'ada@example.com',
        password: 'correct horse battery staple',
      });

      expect(entry).toMatchObject({
        profile: 'work',
        origin: 'https://example.com',
        username: 'ada@example.com',
      });
      expect(entry).not.toHaveProperty('password');
      expect(await vault.list()).toEqual([entry]);
      expect(JSON.stringify(await vault.list())).not.toContain('correct horse battery staple');
      await expect(vault.resolveSecret({
        credentialId: entry.id,
        profile: 'work',
        origin: 'https://example.com/account',
      })).resolves.toBe('correct horse battery staple');

      const disk = await readFile(join(root, 'agent-browser', 'vault.json'), 'utf8');
      expect(disk).not.toContain('correct horse battery staple');
      expect(disk).not.toContain('sealed:correct horse battery staple');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects insecure origins and cross-profile or cross-origin resolution', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-browser-vault-'));
    try {
      const vault = new AgentBrowserVault({ userDataPath: root, crypto: createCrypto() });
      await expect(vault.save({
        profile: 'work',
        origin: 'http://example.com',
        username: 'ada',
        password: 'secret',
      })).rejects.toThrow('HTTPS origin');

      const entry = await vault.save({
        profile: 'work',
        origin: 'https://example.com',
        username: 'ada',
        password: 'secret',
      });
      await expect(vault.resolveSecret({
        credentialId: entry.id,
        profile: 'personal',
        origin: 'https://example.com',
      })).rejects.toThrow('does not match');
      await expect(vault.resolveSecret({
        credentialId: entry.id,
        profile: 'work',
        origin: 'https://other.example',
      })).rejects.toThrow('does not match');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
