// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readTaskLedgerProcessIncarnation, taskLedgerOwnIncarnation } from '../../shared/task-ledger-process';

const query = vi.hoisted(() => ({ unavailable: false, calls: [] as string[] }));
vi.mock('node:child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, execFileSync: (...args: Parameters<typeof actual.execFileSync>) => {
    query.calls.push(String(args[0]));
    if (query.unavailable) throw Object.assign(new Error('OS query unavailable'), { code: 'ETIMEDOUT' });
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
beforeEach(() => { query.unavailable = false; query.calls.length = 0; });
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
    expect(query.calls).toHaveLength(2);
    expect(readTaskLedgerProcessIncarnation(-1)).toBeNull();
    expect(query.calls).toHaveLength(2);
  });
});
