/** Host Git adapter: reuse Coding's journal and leases, never a second journal. */
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { acquirePatchBatchLocks } from '../agents/apply-patch-batch-lock.js';
import {
  journalEntryId, snapshotBeforeWrite, setWriteJournalBatchState, undoLastWrites, clearWriteJournal, discardWriteJournalEntries,
  type WriteJournalEntry,
} from '../agents/tools/write-journal.js';

export async function journaledGitApply<T extends { success: boolean; approvalRequired?: boolean; blocked?: boolean; stale?: boolean }>(input: {
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
  let applyStarted = false;
  function discardPrepared() {
    discardWriteJournalEntries(entries);
    clearWriteJournal({ workspaceRoot: input.workspaceRoot, sessionId });
  }
  function rollback() {
    // Approval denial/pre-write validation must not rewrite identical preimages:
    // even a same-byte restore changes destination metadata without approval.
    const unchanged = entries.every((entry) => entry.hadPrior
      ? existsSync(entry.absPath) && readFileSync(entry.absPath).equals(readFileSync(entry.snapshotPath))
      : !existsSync(entry.absPath));
    if (unchanged) {
      discardPrepared();
      return {};
    }
    const restored = undoLastWrites({ workspaceRoot: input.workspaceRoot, sessionId, steps: entries.length });
    if (restored.errors.length === 0) clearWriteJournal({ workspaceRoot: input.workspaceRoot, sessionId });
    return { recoveryRequired: restored.errors.length > 0,
      journalRef: restored.errors.length && entries[0] ? journalEntryId(sessionId, entries[0].seq) : undefined };
  }
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
    applyStarted = true;
    const result = await input.apply();
    if (!result.success) {
      if (result.approvalRequired || result.blocked || result.stale) { discardPrepared(); return { result }; }
      return { result, ...rollback() };
    }
    const persisted = setWriteJournalBatchState(entries, 'committed');
    return { result, journalRef: journalEntryId(sessionId, entries[0].seq), recoveryRequired: !persisted };
  } catch (error) {
    if (!applyStarted) { discardPrepared(); return { error: error instanceof Error ? error.message : String(error) }; }
    try { return { error: error instanceof Error ? error.message : String(error), ...rollback() }; }
    catch { return { error: 'Journal recovery could not prove destination state.', recoveryRequired: true,
      journalRef: entries[0] ? journalEntryId(sessionId, entries[0].seq) : undefined }; }
  } finally { release(); }
}
