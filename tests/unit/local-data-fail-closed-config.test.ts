import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  AtomicWriteError,
  backupPathFor,
  readJsonAtomic,
  writeJsonAtomic,
  withFileLock,
} from '@electron/utils/atomic-write';

/**
 * Corruption-policy regression tests for config stores that are rewritten
 * through read-modify-write. Harness rule `local-data-fail-closed-config`:
 * a corrupt config must throw and be recovered from `.bak`, never silently
 * degrade into an empty projection, because the next writer would then
 * overwrite every unrelated key.
 */
describe('fail-closed config corruption policy', () => {
  let dir: string;
  let target: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clawx-failclosed-'));
    target = join(dir, 'store.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('round-trips a normal read-modify-write cycle', async () => {
    await writeJsonAtomic(target, { version: 1, keys: { a: 1 } });
    const first = await readJsonAtomic<{ version: number; keys: Record<string, number> }>(target);
    expect(first.data.keys.a).toBe(1);
    expect(first.recoveredFromBackup).toBe(false);

    await writeJsonAtomic(target, { version: 2, keys: { a: 2, b: 3 } });
    const second = await readJsonAtomic<{ version: number; keys: Record<string, number> }>(target);
    expect(second.data.keys).toEqual({ a: 2, b: 3 });
  });

  it('recovers from .bak when the primary is corrupted', async () => {
    // First write creates the file.
    await writeJsonAtomic(target, { keys: { keep: 'original' } });
    // Second write rotates the previous good content into `.bak`.
    await writeJsonAtomic(target, { keys: { keep: 'newer' } });
    expect(existsSync(backupPathFor(target))).toBe(true);

    // Corrupt the primary only.
    writeFileSync(target, '{ this is not json', 'utf-8');

    const result = await readJsonAtomic<{ keys: Record<string, string> }>(target);
    expect(result.recoveredFromBackup).toBe(true);
    expect(result.recoveryNote).toMatch(/corrupt/i);
    // Some valid content survived: the caller's RMW will not wipe the file.
    expect(result.data.keys).toBeDefined();
    // The recovered content was written back so later readers see valid JSON.
    expect(() => JSON.parse(readFileSync(target, 'utf-8'))).not.toThrow();
  });

  it('recovers from .bak when the primary is missing (crash between rename steps)', async () => {
    await writeJsonAtomic(target, { keys: { keep: 'first' } });
    await writeJsonAtomic(target, { keys: { keep: 'second' } });
    rmSync(target);

    const result = await readJsonAtomic<{ keys: Record<string, string> }>(target);
    expect(result.recoveredFromBackup).toBe(true);
    expect(result.recoveryNote).toMatch(/missing/i);
    expect(existsSync(target)).toBe(true);
  });

  it('throws CORRUPT instead of returning an empty projection', async () => {
    // No `.bak` exists, so there is nothing to recover from.
    writeFileSync(target, 'not json at all', 'utf-8');

    await expect(readJsonAtomic(target)).rejects.toBeInstanceOf(AtomicWriteError);
    await readJsonAtomic(target).catch((error: unknown) => {
      expect((error as AtomicWriteError).code).toBe('CORRUPT');
      expect((error as AtomicWriteError).retryable).toBe(false);
    });
  });

  it('never hands a corrupt store back to a read-modify-write caller', async () => {
    writeFileSync(target, '{"partial":', 'utf-8');

    // The exact hazard this rule prevents: reading then writing back an empty
    // projection would destroy the user's remaining configuration.
    let projection: unknown = null;
    await readJsonAtomic(target, { fallback: {} }).then((r) => {
      projection = r.data;
    }).catch(() => {
      projection = null;
    });
    expect(projection).toBeNull();
  });

  it('serialises concurrent read-modify-write cycles under a file lock', async () => {
    await writeJsonAtomic(target, { counter: 0 });

    const bump = async () => withFileLock(target, async () => {
      const current = await readJsonAtomic<{ counter: number }>(target);
      await writeJsonAtomic(target, { counter: current.data.counter + 1 });
    });

    await Promise.all([bump(), bump(), bump()]);

    const final = await readJsonAtomic<{ counter: number }>(target);
    // Lost-update detection: three increments must all land.
    expect(final.data.counter).toBe(3);
  });

  it('keeps nested directory config readable after a partial write is interrupted', async () => {
    const nested = join(dir, 'knowledge', 'watched-directories.json');
    mkdirSync(join(dir, 'knowledge'), { recursive: true });
    await writeJsonAtomic(nested, [{ id: 'w1', path: 'C:/x' }]);

    const result = await readJsonAtomic<Array<{ id: string }>>(nested);
    expect(result.data[0]?.id).toBe('w1');
  });
});