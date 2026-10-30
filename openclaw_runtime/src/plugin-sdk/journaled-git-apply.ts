/** Host Git adapter: reuse Coding's journal and leases, never a second journal. */
import { randomUUID } from 'node:crypto';
import { acquirePatchBatchLocks } from '../agents/apply-patch-batch-lock.js';
import {
  journalEntryId, snapshotBeforeWrite, setWriteJournalBatchState, undoLastWrites,
  type WriteJournalEntry,
} from '../agents/tools/write-journal.js';

export async function journaledGitApply<T extends { success: boolean }>(input: {
  workspaceRoot: string;
  sessionKey: string;
  paths: string[];
  validate: () => Promise<void>;
  preflight: () => Promise<T>;
  apply: () => Promise<T>;
}): Promise<{ result?: T; journalRef?: string; error?: string; recoveryRequired?: boolean }> {
  const release = await acquirePatchBatchLocks([...input.paths].sort());
  const entries: WriteJournalEntry[] = [];
  // A dedicated operation namespace prevents undo from including another turn's
  // writes. Storage, recovery and snapshots still belong to Coding's journal.
  const operationId = randomUUID();
  const sessionId = `review-apply-${operationId}`;
  try {
    await input.validate();
    const checked = await input.preflight();
    if (!checked.success) return { result: checked };
    for (const filePath of input.paths) {
      const entry = snapshotBeforeWrite({ workspaceRoot: input.workspaceRoot, sessionId, filePath,
        toolName: 'git.applyPatch', requestId: operationId,
        flags: { sourceSessionKey: input.sessionKey }, batch: { id: operationId, state: 'prepared' } });
      if (!entry) throw new Error('The existing write journal could not prepare this patch.');
      entries.push(entry);
    }
    await input.validate();
    const result = await input.apply();
    if (!result.success) {
      const restored = undoLastWrites({ workspaceRoot: input.workspaceRoot, sessionId, steps: entries.length });
      return { result, recoveryRequired: restored.errors.length > 0,
        journalRef: entries[0] ? journalEntryId(sessionId, entries[0].seq) : undefined };
    }
    const persisted = setWriteJournalBatchState(entries, 'committed');
    return { result, journalRef: journalEntryId(sessionId, entries[0].seq), recoveryRequired: !persisted };
  } catch (error) {
    const restored = entries.length ? undoLastWrites({ workspaceRoot: input.workspaceRoot, sessionId, steps: entries.length }) : null;
    return { error: error instanceof Error ? error.message : String(error), recoveryRequired: Boolean(restored?.errors.length),
      journalRef: entries[0] ? journalEntryId(sessionId, entries[0].seq) : undefined };
  } finally { release(); }
}
