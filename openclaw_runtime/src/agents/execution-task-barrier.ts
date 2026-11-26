import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { withTaskLedgerJournalLockSync } from '../../../shared/task-ledger-journal-lock.js';
import { resolveExecutionStatePath } from '../state/execution-state-db.js';

const held = new Set<string>();

/** Registration, first Task open and cleanup use the same ordered domain locks. */
export function withExecutionTaskBarrier<T>(domainIds: string[], operation: () => T): T {
  const stateFile = resolve(resolveExecutionStatePath());
  mkdirSync(dirname(stateFile), { recursive: true });
  const actual = existsSync(stateFile) ? realpathSync.native(stateFile) : resolve(realpathSync.native(dirname(stateFile)), basename(stateFile));
  const prefix = process.platform === 'win32' ? actual.toLowerCase() : actual;
  const keys = [...new Set(domainIds)].map(id => `${prefix}.task-domain-${createHash('sha256').update(id).digest('hex')}`)
    .sort().filter(key => !held.has(key));
  const last = [...held].sort().at(-1);
  if (last && keys.some(key => key < last)) throw new Error('TASK_AUTHORITY_LOCK_ORDER');
  const enter = (index: number): T => {
    if (index === keys.length) return operation();
    const key = keys[index];
    return withTaskLedgerJournalLockSync(key, () => {
      held.add(key);
      try { return enter(index + 1); }
      finally { held.delete(key); }
    }, { timeoutMs: 3000 });
  };
  return enter(0);
}
