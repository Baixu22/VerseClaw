// @vitest-environment node
// R0-5.1: a corrupt openclaw.json must fail closed (throw) instead of
// reading as {} — otherwise any read-modify-write caller wipes the config.

import { mkdir, rm, writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { testHome, testUserData } = vi.hoisted(() => {
  const suffix = Math.random().toString(36).slice(2);
  const root = process.env.CLAWX_TEST_TMPDIR ?? process.cwd() + '/.tmp/vitest';
  return {
    testHome: root + '/clawx-r0-5-channel-' + suffix,
    testUserData: root + '/clawx-r0-5-channel-user-' + suffix,
  };
});

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  const mocked = {
    ...actual,
    homedir: () => testHome,
  };
  return { ...mocked, default: mocked };
});

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => testUserData,
    getVersion: () => '0.0.0-test',
    getAppPath: () => testUserData,
  },
}));

vi.mock('@electron/utils/logger', () => ({
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}));

const configPath = () => join(testHome, '.openclaw', 'openclaw.json');

describe('R0-5 channel config corrupt fail-closed', () => {
  beforeEach(async () => {
    vi.resetModules();
    await rm(testHome, { recursive: true, force: true });
    await rm(testUserData, { recursive: true, force: true });
    await mkdir(join(testHome, '.openclaw'), { recursive: true });
  });

  afterEach(async () => {
    await rm(testHome, { recursive: true, force: true });
    await rm(testUserData, { recursive: true, force: true });
  });

  it('throws on a corrupt config without a usable backup', async () => {
    await writeFile(configPath(), '{ not json', 'utf8');
    const { readOpenClawConfig } = await import('@electron/utils/channel-config');

    await expect(readOpenClawConfig()).rejects.toThrow(/Corrupt JSON/);
  });

  it('recovers from the .bak window when the primary is corrupt', async () => {
    await writeFile(configPath() + '.bak', JSON.stringify({ channels: { discord: { enabled: true } } }), 'utf8');
    await writeFile(configPath(), '{ not json', 'utf8');
    const { readOpenClawConfig } = await import('@electron/utils/channel-config');

    const config = await readOpenClawConfig();
    expect(config.channels).toBeDefined();
    // Recovery restores the backup into place for subsequent readers.
    const restored = JSON.parse(await readFile(configPath(), 'utf8')) as Record<string, unknown>;
    expect(restored.channels).toBeDefined();
  });

  it('returns an empty config when the file is missing (first run)', async () => {
    const { readOpenClawConfig } = await import('@electron/utils/channel-config');
    await expect(readOpenClawConfig()).resolves.toEqual({});
  });
});
