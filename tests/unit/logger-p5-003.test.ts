/**
 * P5-003: logger rotation, retention, write-failure visibility, secret/canary redaction.
 */
import { existsSync } from 'fs';
import { mkdir, readFile, readdir, rm, utimes, writeFile } from 'fs/promises';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { testUserData } = vi.hoisted(() => {
  const suffix = Math.random().toString(36).slice(2);
  const root = process.env.CLAWX_TEST_TMPDIR ?? `${process.cwd()}/.tmp/vitest`;
  return {
    testUserData: `${root}/p5-003-logger-${suffix}`,
  };
});

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: (name: string) => {
      if (name === 'userData') return testUserData;
      return testUserData;
    },
    getVersion: () => '0.0.0-p5-003',
  },
}));

const dayStamp = (d = new Date()) => d.toISOString().split('T')[0];

async function loadLogger() {
  vi.resetModules();
  return import('@electron/utils/logger');
}

beforeEach(async () => {
  await rm(testUserData, { recursive: true, force: true });
  await mkdir(join(testUserData, 'logs'), { recursive: true });
});

afterEach(async () => {
  try {
    const mod = await import('@electron/utils/logger');
    await mod.flushLogsForTests();
    mod.resetLoggerForTests();
  } catch {
    // ignore
  }
  await rm(testUserData, { recursive: true, force: true });
});

describe('P5-003 logger redaction (A3)', () => {
  it('redactLogText strips canaries, bearer tokens, and api keys', async () => {
    const { redactLogText } = await loadLogger();
    const raw =
      'hello CLAWX_CANARY_SECRET_ABC123XYZ and Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig ' +
      'sk-abcdefghijklmnopqrstuvwxyz012345 and API_KEY=supersecretvalue12345678 ' +
      'and "apiKey":"plain-secret-value"';
    const out = redactLogText(raw);
    expect(out).not.toContain('CLAWX_CANARY_SECRET_ABC123XYZ');
    expect(out).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
    expect(out).not.toContain('sk-abcdefghijklmnopqrstuvwxyz012345');
    expect(out).not.toContain('supersecretvalue12345678');
    expect(out).not.toContain('plain-secret-value');
    expect(out).toMatch(/REDACTED/);
  });

  it('canary scan: ring buffer and disk free of secrets after info()', async () => {
    const mod = await loadLogger();
    mod.resetLoggerForTests();
    mod.initLogger();
    const canary = 'CLAWX_CANARY_LOGSCAN_DEADBEEF99';
    const key = 'sk-proj-abcdefghijklmnopqrstuvwxyz';
    mod.info(`user connected token=${canary} key=${key}`);
    await mod.flushLogsForTests();

    const recent = mod.getRecentLogs().join('\n');
    expect(recent).not.toContain(canary);
    expect(recent).not.toContain(key);

    const filePath = mod.getLogFilePath();
    expect(filePath).toBeTruthy();
    const disk = await readFile(filePath!, 'utf8');
    expect(disk).not.toContain(canary);
    expect(disk).not.toContain(key);
    expect(disk).toMatch(/REDACTED/);
  });
});

describe('P5-003 logger rotation + retention (A1)', () => {
  it('rotates active log when size limit exceeded', async () => {
    const mod = await loadLogger();
    mod.resetLoggerForTests();
    mod.configureLoggerLimits({ maxFileBytes: 800, maxRetentionDays: 14, maxTotalBytes: 50 * 1024 * 1024 });
    mod.initLogger();

    const payload = 'x'.repeat(200);
    for (let i = 0; i < 20; i++) {
      mod.info(`rotation-line-${i} ${payload}`);
    }
    await mod.flushLogsForTests();
    // second flush wave in case rotate wrote header only
    for (let i = 0; i < 5; i++) {
      mod.info(`post-rotate-${i} ${payload}`);
    }
    await mod.flushLogsForTests();

    const health = mod.getWriteHealth();
    expect(health.rotatedCount).toBeGreaterThanOrEqual(1);

    const logDir = mod.getLogDir()!;
    const files = (await readdir(logDir)).filter((f) => f.endsWith('.log'));
    expect(files.length).toBeGreaterThanOrEqual(2);
    expect(files.some((f) => f === `verse-claw-${dayStamp()}.log`)).toBe(true);
    // rotated siblings include a timestamp segment
    expect(files.some((f) => f.startsWith(`verse-claw-${dayStamp()}.`) && f !== `verse-claw-${dayStamp()}.log`)).toBe(
      true,
    );

    // Active file should stay under a soft bound after rotate (header + few lines)
    const active = await readFile(join(logDir, `verse-claw-${dayStamp()}.log`), 'utf8');
    expect(active.length).toBeLessThan(20_000);
  });

  it('purges logs older than maxRetentionDays', async () => {
    const mod = await loadLogger();
    mod.resetLoggerForTests();
    mod.configureLoggerLimits({ maxFileBytes: 10 * 1024 * 1024, maxRetentionDays: 2, maxTotalBytes: 50 * 1024 * 1024 });
    mod.initLogger();

    const logDir = mod.getLogDir()!;
    const oldName = 'verse-claw-2020-01-01.log';
    const oldPath = join(logDir, oldName);
    await writeFile(oldPath, 'ancient log\n', 'utf8');
    // Force old mtime as well
    const ancient = new Date('2020-01-02T00:00:00Z');
    await utimes(oldPath, ancient, ancient);

    const deleted = await mod.enforceLogRetention();
    expect(deleted).toBeGreaterThanOrEqual(1);
    expect(existsSync(oldPath)).toBe(false);
    // active still present
    expect(existsSync(mod.getLogFilePath()!)).toBe(true);
  });

  it('purges oldest logs when total bytes exceed maxTotalBytes', async () => {
    const mod = await loadLogger();
    mod.resetLoggerForTests();
    mod.configureLoggerLimits({
      maxFileBytes: 10 * 1024 * 1024,
      maxRetentionDays: 30,
      maxTotalBytes: 2500,
    });
    mod.initLogger();
    const logDir = mod.getLogDir()!;

    const bulky = 'y'.repeat(1200);
    const older = join(logDir, 'verse-claw-2026-01-01.log');
    const mid = join(logDir, 'verse-claw-2026-01-02.log');
    await writeFile(older, bulky, 'utf8');
    await writeFile(mid, bulky, 'utf8');
    await utimes(older, new Date('2026-01-01T00:00:00Z'), new Date('2026-01-01T00:00:00Z'));
    await utimes(mid, new Date('2026-01-02T00:00:00Z'), new Date('2026-01-02T00:00:00Z'));

    const deleted = await mod.enforceLogRetention();
    expect(deleted).toBeGreaterThanOrEqual(1);
    // At least one of the bulky non-active files should be gone
    const remaining = (await readdir(logDir)).filter((f) => f.endsWith('.log'));
    expect(remaining.includes('verse-claw-2026-01-01.log') && remaining.includes('verse-claw-2026-01-02.log')).toBe(
      false,
    );
    expect(existsSync(mod.getLogFilePath()!)).toBe(true);
  });
});

describe('P5-003 write failure visibility (A2)', () => {
  it('records ENOSPC as observable write health (not silent)', async () => {
    const mod = await loadLogger();
    mod.resetLoggerForTests();
    mod.initLogger();

    const enospc = Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' });
    mod.setLogAppendImplForTests(async () => {
      throw enospc;
    });

    mod.info('this write should fail');
    await mod.flushLogsForTests();

    const health = mod.getWriteHealth();
    expect(health.healthy).toBe(false);
    expect(health.consecutiveFailures).toBeGreaterThanOrEqual(1);
    expect(health.lastWriteErrorCode).toBe('ENOSPC');
    expect(health.lastWriteError).toMatch(/ENOSPC|no space/i);
    expect(health.lastWriteErrorAt).toBeTruthy();
  });

  it('records EACCES / read-only injection as observable status', async () => {
    const mod = await loadLogger();
    mod.resetLoggerForTests();
    mod.initLogger();

    const eacces = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    mod.setLogAppendImplForTests(async () => {
      throw eacces;
    });

    mod.warn('readonly path write');
    await mod.flushLogsForTests();

    const health = mod.getWriteHealth();
    expect(health.healthy).toBe(false);
    expect(health.lastWriteErrorCode).toBe('EACCES');
    expect(health.consecutiveFailures).toBeGreaterThanOrEqual(1);
  });

  it('recovers healthy after subsequent successful write', async () => {
    const mod = await loadLogger();
    mod.resetLoggerForTests();
    mod.initLogger();

    let failOnce = true;
    mod.setLogAppendImplForTests(async (filePath, data) => {
      if (failOnce) {
        failOnce = false;
        const err = Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' });
        throw err;
      }
      const { appendFile } = await import('fs/promises');
      await appendFile(filePath, data);
    });

    mod.info('fail-first');
    await mod.flushLogsForTests();
    expect(mod.getWriteHealth().healthy).toBe(false);

    mod.info('ok-second');
    await mod.flushLogsForTests();
    const health = mod.getWriteHealth();
    expect(health.healthy).toBe(true);
    expect(health.consecutiveFailures).toBe(0);
    expect(health.lastWriteOkAt).toBeTruthy();
  });
});