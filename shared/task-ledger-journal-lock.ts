// A local-filesystem bakery lock shared by async Main and sync runtime writers.
// Each acquisition owns a unique record: dead-owner recovery never unlinks a
// pathname that a live replacement can reuse. Complete records publish by rename.
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { taskLedgerOwnerWasReplaced, taskLedgerOwnIncarnation } from './task-ledger-process.js';

export const taskLedgerLockPath = (filePath: string): string => `${filePath}.clawx-write.lock`;
export const taskLedgerSessionEpochPath = (storePath: string): string => `${storePath}.task-ledger-epoch`;
type LockOptions = { timeoutMs?: number; pollMs?: number };
type Participant = { pid: number; token: string; choosing: boolean; ticket: number; incarnation: string; publishedAt: number };
type Entry = { path: string; owner: Participant };

function removeOwnRecord(path: string): void {
  try { unlinkSync(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
}

function publish(path: string, owner: Participant): void {
  const staging = `${path}.${randomUUID()}.stage`;
  try {
    writeFileSync(staging, JSON.stringify(owner), { encoding: 'utf8', flag: 'wx' });
    renameSync(staging, path);
  } finally { removeOwnRecord(staging); }
}

function participants(dir: string): Entry[] {
  return readdirSync(dir).flatMap(name => {
    const match = /^(\d+)-([a-f0-9-]{36})\.json$/u.exec(name);
    if (!match) return []; // Unpublished .stage files hold no ticket.
    const path = join(dir, name);
    let owner: Participant;
    try { owner = JSON.parse(readFileSync(path, 'utf8')) as Participant; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      if (['EPERM', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) {
        // Windows can list a record while its deletion is pending. Keep an
        // unreadable participant blocking until a later scan sees its state.
        return [{ path, owner: { pid: Number(match[1]), token: match[2], choosing: true, ticket: 0, incarnation: '', publishedAt: Date.now() } }];
      }
      throw Object.assign(new Error(`Unreadable Task Ledger lock participant: ${path}`), { code: 'LOCK_CORRUPT', cause: error });
    }
    if (!owner || typeof owner !== 'object' || owner.pid !== Number(match[1]) || owner.token !== match[2] || !Number.isSafeInteger(owner.pid) || owner.pid < 1
      || typeof owner.choosing !== 'boolean' || !Number.isSafeInteger(owner.ticket) || owner.ticket < 0
      || typeof owner.incarnation !== 'string' || !owner.incarnation || !Number.isFinite(owner.publishedAt)
      || (!owner.choosing && owner.ticket === 0)) {
      throw Object.assign(new Error(`Invalid Task Ledger lock participant: ${path}`), { code: 'LOCK_CORRUPT' });
    }
    if (taskLedgerOwnerWasReplaced(owner)) { removeOwnRecord(path); return []; }
    try { process.kill(owner.pid, 0); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
        // UUID paths are never reassigned, so competing cleaners can only
        // remove this dead acquisition; they cannot remove a new live owner.
        removeOwnRecord(path);
        return [];
      }
      // EPERM is not proof of death. Keep the participant and fail closed.
    }
    return [{ path, owner }];
  });
}

function enter(path: string): { blocked: () => boolean; release: () => void } {
  const dir = taskLedgerLockPath(path);
  mkdirSync(dir, { recursive: true });
  const owner: Participant = { pid: process.pid, token: randomUUID(), choosing: true, ticket: 0,
    incarnation: taskLedgerOwnIncarnation(), publishedAt: Date.now() };
  const ownPath = join(dir, `${owner.pid}-${owner.token}.json`);
  try {
    publish(ownPath, owner);
    const maximum = Math.max(0, ...participants(dir).map(entry => entry.owner.ticket));
    if (maximum >= Number.MAX_SAFE_INTEGER) throw new Error('Task Ledger lock ticket exhausted');
    owner.ticket = maximum + 1;
    owner.choosing = false;
    publish(ownPath, owner);
  } catch (error) { removeOwnRecord(ownPath); throw error; }
  return {
    blocked: () => participants(dir).some(entry => entry.path !== ownPath && (entry.owner.choosing
      || entry.owner.ticket < owner.ticket || (entry.owner.ticket === owner.ticket && entry.owner.token < owner.token))),
    release: () => removeOwnRecord(ownPath),
  };
}

function timeout(path: string): Error {
  return Object.assign(new Error(`Timed out acquiring Task Ledger write lock for ${path}`), { code: 'LOCK_TIMEOUT', retryable: true });
}

export async function withTaskLedgerJournalLock<T>(path: string, fn: (state: { waited: boolean }) => Promise<T>, options: LockOptions = {}): Promise<T> {
  const started = Date.now();
  const lock = enter(path);
  let waited = false;
  try {
    while (lock.blocked()) {
      waited = true;
      if (Date.now() - started >= (options.timeoutMs ?? 10_000)) throw timeout(path);
      await new Promise(resolve => setTimeout(resolve, options.pollMs ?? 25));
    }
    return await fn({ waited });
  } finally { lock.release(); }
}

export function withTaskLedgerJournalLockSync<T>(path: string, fn: () => T, options: LockOptions = {}): T {
  const started = Date.now();
  const lock = enter(path);
  const wait = new Int32Array(new SharedArrayBuffer(4));
  try {
    while (lock.blocked()) {
      if (Date.now() - started >= (options.timeoutMs ?? 10_000)) throw timeout(path);
      Atomics.wait(wait, 0, 0, options.pollMs ?? 25);
    }
    return fn();
  } finally { lock.release(); }
}
