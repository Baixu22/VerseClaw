/**
 * P5-001: atomic config commit + cross-process lock + version protection.
 */
import { existsSync } from 'fs';
import {
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'fs/promises';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AtomicWriteError,
  ConfigVersionConflictError,
  backupPathFor,
  lockPathFor,
  metaPathFor,
  readJsonAtomic,
  withFileLock,
  writeJsonAtomic,
} from '@electron/utils/atomic-write';
import { withConfigLock } from '@electron/utils/config-mutex';

const root = process.env.CLAWX_TEST_TMPDIR ?? `${process.cwd()}/.tmp/vitest`;
const suiteDir = join(root, `p5-001-atomic-${Math.random().toString(36).slice(2)}`);

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf-8'));
}

beforeEach(async () => {
  await rm(suiteDir, { recursive: true, force: true });
  await mkdir(suiteDir, { recursive: true });
});

afterEach(async () => {
  await rm(suiteDir, { recursive: true, force: true });
});

describe('P5-001 atomic write (temp+fsync+rename)', () => {
  it('writes complete JSON and never leaves truncated target', async () => {
    const target = join(suiteDir, 'openclaw.json');
    const payload = { channels: { telegram: { token: 'abc' } }, v: 1 };
    const result = await writeJsonAtomic(target, payload);

    expect(existsSync(target)).toBe(true);
    expect(await readJson(target)).toEqual(payload);
    expect(result.meta.version).toBe(1);
    expect(result.meta.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(existsSync(metaPathFor(target))).toBe(true);

    const leftovers = (await readdir(suiteDir)).filter((n) => n.endsWith('.tmp'));
    expect(leftovers).toEqual([]);
  });

  it('retains .bak of previous good content across overwrite', async () => {
    const target = join(suiteDir, 'openclaw.json');
    await writeJsonAtomic(target, { step: 1 });
    await writeJsonAtomic(target, { step: 2 });

    expect(await readJson(target)).toEqual({ step: 2 });
    expect(existsSync(backupPathFor(target))).toBe(true);
    expect(await readJson(backupPathFor(target))).toEqual({ step: 1 });
    const meta = JSON.parse(await readFile(metaPathFor(target), 'utf-8')) as { version: number };
    expect(meta.version).toBe(2);
  });

  it('A1: crash before rename leaves original intact (tmp orphan only)', async () => {
    const target = join(suiteDir, 'openclaw.json');
    await writeJsonAtomic(target, { good: true });

    const orphan = join(suiteDir, `.openclaw.json.${process.pid}.crash.tmp`);
    await writeFile(orphan, '{"partial":', 'utf-8');

    const raw = await readFile(target, 'utf-8');
    expect(JSON.parse(raw)).toEqual({ good: true });
    expect(raw.includes('{')).toBe(true);
  });

  it('A1: rename failure after moving aside restores or keeps backup for recovery', async () => {
    const target = join(suiteDir, 'openclaw.json');
    await writeJsonAtomic(target, { good: true, n: 1 });

    const bak = backupPathFor(target);
    await writeFile(bak, `${JSON.stringify({ good: true, n: 1 }, null, 2)}\n`, 'utf-8');
    await rm(target, { force: true });
    await writeFile(join(suiteDir, `.openclaw.json.broken.tmp`), '{"partial":', 'utf-8');

    const recovered = await readJsonAtomic<Record<string, unknown>>(target);
    expect(recovered.recoveredFromBackup).toBe(true);
    expect(recovered.data).toEqual({ good: true, n: 1 });
    expect(recovered.recoveryNote).toMatch(/recovered from/i);
    expect(await readJson(target)).toEqual({ good: true, n: 1 });
  });

  it('A3: version CAS rejects stale expectedVersion and remains retryable', async () => {
    const target = join(suiteDir, 'openclaw.json');
    await writeJsonAtomic(target, { a: 1 });
    await writeJsonAtomic(target, { a: 2 });

    await expect(writeJsonAtomic(target, { a: 3 }, { expectedVersion: 1 })).rejects.toBeInstanceOf(
      ConfigVersionConflictError,
    );

    try {
      await writeJsonAtomic(target, { a: 3 }, { expectedVersion: 1 });
      expect.fail('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(AtomicWriteError);
      expect((error as AtomicWriteError).retryable).toBe(true);
      expect((error as AtomicWriteError).code).toBe('VERSION_CONFLICT');
    }

    const ok = await writeJsonAtomic(target, { a: 3 }, { expectedVersion: 2 });
    expect(ok.meta.version).toBe(3);
    expect(await readJson(target)).toEqual({ a: 3 });
  });

  it('A2: concurrent writers under withFileLock do not lose updates', async () => {
    const target = join(suiteDir, 'openclaw.json');
    await writeJsonAtomic(target, { counter: 0 });

    const workers = 12;
    await Promise.all(
      Array.from({ length: workers }, async () => {
        await withFileLock(target, async () => {
          const current = (await readJsonAtomic<{ counter: number }>(target)).data;
          const next = { counter: current.counter + 1 };
          await writeJsonAtomic(target, next);
        });
      }),
    );

    const final = (await readJsonAtomic<{ counter: number }>(target)).data;
    expect(final.counter).toBe(workers);
  });

  it('A2: concurrent withConfigLock RMW preserves all updates', async () => {
    const target = join(suiteDir, 'openclaw.json');
    await writeJsonAtomic(target, { keys: [] as string[] });

    const workers = 8;
    await Promise.all(
      Array.from({ length: workers }, async (_, i) => {
        await withConfigLock(
          async () => {
            const cur = (await readJsonAtomic<{ keys: string[] }>(target)).data;
            cur.keys.push(`k${i}`);
            await writeJsonAtomic(target, cur);
          },
          { lockTargetPath: target },
        );
      }),
    );

    const final = (await readJsonAtomic<{ keys: string[] }>(target)).data;
    expect(final.keys).toHaveLength(workers);
    expect(new Set(final.keys).size).toBe(workers);
  });

  it('A3: disk-full (ENOSPC) injection leaves original intact and is retryable', async () => {
    const target = join(suiteDir, 'openclaw.json');
    await writeJsonAtomic(target, { keep: true });

    await expect(
      writeJsonAtomic(
        target,
        { keep: false, huge: true },
        {
          hooks: {
            beforeTempWrite: async () => {
              const err = new Error('ENOSPC: no space left on device') as NodeJS.ErrnoException;
              err.code = 'ENOSPC';
              throw err;
            },
          },
        },
      ),
    ).rejects.toMatchObject({
      code: 'ENOSPC',
      retryable: true,
    });
    expect(await readJson(target)).toEqual({ keep: true });
  });

  it('A3: read-only (EACCES) injection is visible and does not clobber target', async () => {
    const target = join(suiteDir, 'openclaw.json');
    await writeJsonAtomic(target, { keep: true });

    await expect(
      writeJsonAtomic(
        target,
        { keep: false },
        {
          hooks: {
            beforeTempWrite: async () => {
              const err = new Error('EACCES: permission denied') as NodeJS.ErrnoException;
              err.code = 'EACCES';
              throw err;
            },
          },
        },
      ),
    ).rejects.toMatchObject({
      code: 'EACCES',
    });
    expect(await readJson(target)).toEqual({ keep: true });
  });

  it('lock timeout is retryable when lock is held', async () => {
    const target = join(suiteDir, 'locked.json');
    await writeJsonAtomic(target, { ok: 1 });

    let releaseInner!: () => void;
    const held = new Promise<void>((resolve) => {
      releaseInner = resolve;
    });

    const holder = withFileLock(target, async () => {
      await held;
      return 'held';
    });

    const lock = lockPathFor(target);
    for (let i = 0; i < 50 && !existsSync(lock); i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(existsSync(lock)).toBe(true);

    await expect(
      withFileLock(target, async () => 'never', { timeoutMs: 80, pollMs: 10 }),
    ).rejects.toMatchObject({ code: 'LOCK_TIMEOUT', retryable: true });

    releaseInner();
    await expect(holder).resolves.toBe('held');
  });
});

const channelHome = join(root, `p5-001-channel-${Math.random().toString(36).slice(2)}`);
const channelUserData = join(root, `p5-001-channel-ud-${Math.random().toString(36).slice(2)}`);

describe('P5-001 channel-config integration (writeOpenClawConfig atomic)', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.doUnmock('os');
    vi.doUnmock('electron');
    vi.doUnmock('@electron/utils/logger');
    await rm(channelHome, { recursive: true, force: true });
    await rm(channelUserData, { recursive: true, force: true });
  });

  afterEach(async () => {
    vi.resetModules();
    vi.doUnmock('os');
    vi.doUnmock('electron');
    vi.doUnmock('@electron/utils/logger');
    await rm(channelHome, { recursive: true, force: true });
    await rm(channelUserData, { recursive: true, force: true });
  });

  it('writeOpenClawConfig produces meta sidecar and valid JSON under concurrent saves', async () => {
    vi.doMock('os', async () => {
      const actual = await vi.importActual<typeof import('os')>('os');
      const mocked = { ...actual, homedir: () => channelHome };
      return { ...mocked, default: mocked };
    });
    vi.doMock('electron', () => ({
      app: {
        isPackaged: false,
        getPath: () => channelUserData,
        getVersion: () => '0.0.0-test',
        getAppPath: () => process.env.CLAWX_TEST_TMPDIR ?? `${process.cwd()}/.tmp/vitest`,
      },
    }));
    vi.doMock('@electron/utils/logger', () => ({
      warn: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
    }));

    const { writeOpenClawConfig, readOpenClawConfig } = await import('@electron/utils/channel-config');
    const { withConfigLock: lock } = await import('@electron/utils/config-mutex');

    await lock(async () => {
      await writeOpenClawConfig({ commands: { restart: true }, seed: true } as never);
    });

    const configPath = join(channelHome, '.openclaw', 'openclaw.json');
    expect(existsSync(configPath)).toBe(true);
    expect(existsSync(metaPathFor(configPath))).toBe(true);

    await Promise.all(
      Array.from({ length: 6 }, async (_, i) => {
        await lock(async () => {
          const cfg = await readOpenClawConfig();
          (cfg as Record<string, unknown>)[`k${i}`] = true;
          await writeOpenClawConfig(cfg);
        });
      }),
    );

    const final = await readOpenClawConfig();
    for (let i = 0; i < 6; i++) {
      expect((final as Record<string, unknown>)[`k${i}`]).toBe(true);
    }
    JSON.parse(await readFile(configPath, 'utf-8'));
  });
});
