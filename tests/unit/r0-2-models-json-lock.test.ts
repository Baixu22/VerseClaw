// @vitest-environment node
// R0-2: per-agent models.json read-modify-write must run under the config
// lock and fail closed on corrupt JSON.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const { testHome, getSettingMock, withConfigLockSpy } = vi.hoisted(() => {
  const suffix = Math.random().toString(36).slice(2);
  return {
    testHome: process.cwd() + '/.tmp/vitest/clawx-r0-2-models-' + suffix,
    getSettingMock: vi.fn(),
    withConfigLockSpy: vi.fn(),
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
    getPath: () => join(testHome, 'userData'),
    getVersion: () => '0.0.0-test',
  },
}));

vi.mock('@electron/utils/store', () => ({
  getSetting: getSettingMock,
}));

vi.mock('@electron/utils/config-mutex', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@electron/utils/config-mutex')>();
  withConfigLockSpy.mockImplementation(
    (fn: () => Promise<unknown>, options?: unknown) => actual.withConfigLock(fn, options as Parameters<typeof actual.withConfigLock>[1]),
  );
  return { ...actual, withConfigLock: withConfigLockSpy };
});

function modelsPath(): string {
  return join(testHome, '.openclaw', 'agents', 'main', 'agent', 'models.json');
}

beforeEach(async () => {
  vi.clearAllMocks();
  await rm(testHome, { recursive: true, force: true });
  await mkdir(join(testHome, '.openclaw', 'agents', 'main', 'agent'), { recursive: true });
});

afterEach(async () => {
  await rm(testHome, { recursive: true, force: true });
});

describe('R0-2 models.json RMW lock and corruption handling', () => {
  it('fails closed on corrupt models.json instead of clobbering it', async () => {
    await writeFile(modelsPath(), '{ not json', 'utf8');
    const { updateAgentModelProvider } = await import('@electron/utils/openclaw-auth');

    await expect(updateAgentModelProvider('openai', { baseUrl: 'https://example.com/v1' }))
      .rejects.toThrow(/Corrupt models\.json/);

    expect(await readFile(modelsPath(), 'utf8')).toBe('{ not json'); // untouched
  });

  it('runs the RMW under withConfigLock with the models.json lock target', async () => {
    const { updateAgentModelProvider } = await import('@electron/utils/openclaw-auth');

    await updateAgentModelProvider('openai', {
      baseUrl: 'https://example.com/v1',
      api: 'openai-completions',
      models: [{ id: 'gpt-x', name: 'GPT X' }],
    });

    const written = JSON.parse(await readFile(modelsPath(), 'utf8')) as {
      providers: Record<string, { baseUrl?: string; models?: Array<{ id: string }> }>;
    };
    expect(written.providers.openai.baseUrl).toBe('https://example.com/v1');
    expect(written.providers.openai.models?.some((model) => model.id === 'gpt-x')).toBe(true);

    const lockCalls = withConfigLockSpy.mock.calls as Array<[unknown, { lockTargetPath?: string }?]>;
    expect(lockCalls.some(([, options]) => options?.lockTargetPath === modelsPath())).toBe(true);
  });

  it('serializes concurrent writers so both provider entries survive', async () => {
    const { updateAgentModelProvider } = await import('@electron/utils/openclaw-auth');

    await Promise.all([
      updateAgentModelProvider('pa', { baseUrl: 'https://a.example', models: [{ id: 'ma', name: 'MA' }] }),
      updateAgentModelProvider('pb', { baseUrl: 'https://b.example', models: [{ id: 'mb', name: 'MB' }] }),
    ]);

    const written = JSON.parse(await readFile(modelsPath(), 'utf8')) as {
      providers: Record<string, { baseUrl?: string }>;
    };
    expect(written.providers.pa?.baseUrl).toBe('https://a.example');
    expect(written.providers.pb?.baseUrl).toBe('https://b.example');
  });

  it('removes a provider entry under the same models.json lock', async () => {
    await writeFile(modelsPath(), JSON.stringify({
      providers: { p1: { baseUrl: 'https://p1.example' }, p2: { baseUrl: 'https://p2.example' } },
    }), 'utf8');
    const { removeProviderFromOpenClaw } = await import('@electron/utils/openclaw-auth');

    await removeProviderFromOpenClaw('p1');

    const written = JSON.parse(await readFile(modelsPath(), 'utf8')) as {
      providers: Record<string, { baseUrl?: string }>;
    };
    expect(written.providers.p1).toBeUndefined();
    expect(written.providers.p2?.baseUrl).toBe('https://p2.example');

    const lockCalls = withConfigLockSpy.mock.calls as Array<[unknown, { lockTargetPath?: string }?]>;
    expect(lockCalls.some(([, options]) => options?.lockTargetPath === modelsPath())).toBe(true);
  });
});
