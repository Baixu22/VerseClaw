// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, isAbsolute, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readTaskLedgerProcessIncarnation, taskLedgerOwnIncarnation } from '../../shared/task-ledger-process';

const query = vi.hoisted(() => ({ unavailable: false, timeoutFirst: false, calls: [] as string[] }));
vi.mock('node:child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, execFileSync: (...args: Parameters<typeof actual.execFileSync>) => {
    query.calls.push(String(args[0]));
    if (query.unavailable || (query.timeoutFirst && query.calls.length === 1)) throw Object.assign(new Error('OS query unavailable'), { code: 'ETIMEDOUT' });
    return actual.execFileSync(...args);
  } };
});
vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, readFileSync: (...args: Parameters<typeof actual.readFileSync>) => {
    if (process.platform === 'linux') {
      query.calls.push(String(args[0]));
      if (query.unavailable) throw Object.assign(new Error('OS query unavailable'), { code: 'EACCES' });
    }
    return actual.readFileSync(...args);
  } };
});
beforeEach(() => { query.unavailable = false; query.timeoutFirst = false; query.calls.length = 0; });
afterEach(() => { query.unavailable = false; });

describe('Task Ledger physical process identity', () => {
  it('keeps a real OS birth identity when the project cwd contains shadow shell executables', () => {
    const temporary = mkdtempSync(join(tmpdir(), 'clawx-process-probe-'));
    const previous = process.cwd();
    try {
      writeFileSync(join(temporary, 'powershell.exe'), 'project-local executable must never be queried');
      writeFileSync(join(temporary, 'pwsh.exe'), 'project-local executable must never be queried');
      process.chdir(temporary);
      let failure: unknown;
      const first = readTaskLedgerProcessIncarnation(process.pid, error => { failure = error; });
      expect(typeof first, JSON.stringify({ calls: query.calls, error: String(failure) })).toBe('string');
      expect(first).toMatch(/^\S+$/u);
      expect(readTaskLedgerProcessIncarnation(process.pid)).toBe(first);
      if (process.platform === 'win32') {
        expect(query.calls.every(file => isAbsolute(file) && !file.startsWith(temporary))).toBe(true);
        expect(first).toMatch(/^\d+$/u);
      }
    } finally { process.chdir(previous); rmSync(temporary, { recursive: true, force: true }); }
  });

  it('keeps query failure unknown and refuses to publish a guessed own incarnation', () => {
    query.unavailable = true;
    expect(() => taskLedgerOwnIncarnation()).toThrow('cannot identify this process incarnation');
    const attempts = query.calls.length;
    expect(attempts).toBeGreaterThanOrEqual(2);
    expect(attempts).toBeLessThanOrEqual(process.platform === 'win32' ? 4 : 2);
    expect(readTaskLedgerProcessIncarnation(-1)).toBeNull();
    expect(query.calls).toHaveLength(attempts);
  });

  it.runIf(process.platform === 'win32')('reads the same native birth identity after the preferred shell times out', () => {
    const expected = readTaskLedgerProcessIncarnation(process.pid);
    expect(expected).toMatch(/^\d+$/u);
    const temporary = mkdtempSync(join(tmpdir(), 'clawx-probe-host-'));
    const previousPath = process.env.PATH;
    try {
      writeFileSync(join(temporary, 'pwsh.exe'), 'controlled host timeout fixture');
      process.env.PATH = temporary + delimiter + (previousPath ?? '');
      query.calls.length = 0;
      query.timeoutFirst = true;
      expect(readTaskLedgerProcessIncarnation(process.pid)).toBe(expected);
      expect(query.calls).toHaveLength(2);
      expect(query.calls[0]).not.toBe(query.calls[1]);
      expect(query.calls.every(isAbsolute)).toBe(true);
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      rmSync(temporary, { recursive: true, force: true });
    }
  });
});
