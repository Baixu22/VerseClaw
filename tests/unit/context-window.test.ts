import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { testHome, testUserData } = vi.hoisted(() => {
  const suffix = Math.random().toString(36).slice(2);
  const root = process.env.CLAWX_TEST_TMPDIR ?? `${process.cwd()}/.tmp/vitest`;
  return {
    testHome: `${root}/verse-claw-context-window-${suffix}`,
    testUserData: `${root}/verse-claw-context-window-user-data-${suffix}`,
  };
});

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  const mocked = {
    ...actual,
    homedir: () => testHome,
  };
  return {
    ...mocked,
    default: mocked,
  };
});

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => testUserData,
    getVersion: () => '0.0.0-test',
  },
}));

describe('resolveContextWindow', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.restoreAllMocks();
    await rm(testHome, { recursive: true, force: true });
    await rm(testUserData, { recursive: true, force: true });
  });

  it('uses OpenClaw model contextWindow before provider defaults', async () => {
    const openclawDir = join(testHome, '.openclaw');
    await mkdir(openclawDir, { recursive: true });
    await writeFile(join(openclawDir, 'openclaw.json'), JSON.stringify({
      models: {
        providers: {
          custom: {
            contextWindow: 111,
            models: [
              { id: 'large-model', contextWindow: 999000 },
            ],
          },
        },
      },
    }), 'utf8');

    const { resolveContextWindow } = await import('@electron/utils/context-window');
    await expect(resolveContextWindow('custom/large-model')).resolves.toEqual({
      modelRef: 'custom/large-model',
      maxTokens: 999000,
      source: 'openclaw-model',
    });
  });

  it('falls back to the built-in provider registry', async () => {
    const openclawDir = join(testHome, '.openclaw');
    await mkdir(openclawDir, { recursive: true });
    await writeFile(join(openclawDir, 'openclaw.json'), JSON.stringify({}), 'utf8');

    const { resolveContextWindow } = await import('@electron/utils/context-window');
    await expect(resolveContextWindow('moonshot/kimi-k2.6')).resolves.toMatchObject({
      modelRef: 'moonshot/kimi-k2.6',
      maxTokens: 256000,
      source: 'provider-registry',
    });
  });

  it('uses configured provider account model when no modelRef is provided', async () => {
    const openclawDir = join(testHome, '.openclaw');
    await mkdir(openclawDir, { recursive: true });
    await writeFile(join(openclawDir, 'openclaw.json'), JSON.stringify({}), 'utf8');

    vi.doMock('@electron/services/providers/provider-store', () => ({
      getDefaultProviderAccountId: async () => 'moonshot-account',
      listProviderAccounts: async () => [
        {
          id: 'moonshot-account',
          vendorId: 'moonshot',
          label: 'Moonshot',
          authMode: 'api_key',
          model: 'kimi-k2.6',
          enabled: true,
          isDefault: true,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
        },
      ],
    }));

    const { resolveContextWindow } = await import('@electron/utils/context-window');
    await expect(resolveContextWindow(null)).resolves.toMatchObject({
      modelRef: 'moonshot/kimi-k2.6',
      maxTokens: 256000,
      source: 'provider-registry',
    });
  });
});
