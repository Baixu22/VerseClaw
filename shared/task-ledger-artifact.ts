import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { TaskLedgerCompletionCheckReceipt } from './types/task-ledger.js';

/**
 * Verify the exact owner-retained archive file; no claim can supply a path.
 * Interactive readback runs on the Main event loop, so this is async by
 * design; the final journal admission boundary re-reads synchronously.
 */
export async function taskCompletionArtifactsMatch(check: TaskLedgerCompletionCheckReceipt): Promise<boolean> {
  if (!check.artifactRefs.length) return false;
  for (const ref of check.artifactRefs) {
    if (!ref.verified) return false;
    if (ref.owner !== 'context-archive') {
      if (ref.owner !== 'verseshell-host-receipt') return false;
      continue;
    }
    try {
      if (!ref.path || !ref.path.startsWith('file:')) return false;
      const bytes = await readFile(fileURLToPath(ref.path));
      if (createHash('sha256').update(bytes).digest('hex') !== ref.sha256) return false;
    } catch { return false; }
  }
  return true;
}

/** Final journal admission boundary only: synchronous re-read under the lock. */
export function taskCompletionArtifactsMatchSync(check: TaskLedgerCompletionCheckReceipt): boolean {
  if (!check.artifactRefs.length) return false;
  return check.artifactRefs.every(ref => {
    if (!ref.verified) return false;
    if (ref.owner !== 'context-archive') return ref.owner === 'verseshell-host-receipt';
    try {
      if (!ref.path || !ref.path.startsWith('file:')) return false;
      const bytes = readFileSync(fileURLToPath(ref.path));
      return createHash('sha256').update(bytes).digest('hex') === ref.sha256;
    } catch { return false; }
  });
}
