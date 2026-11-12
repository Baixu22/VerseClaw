/** Host Git adapter: reuse Coding's journal and leases, never a second journal. */
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { toRelativeWorkspacePath } from '../agents/path-policy.js';
import { FsSafeError, root as fsRoot } from '../infra/fs-safe.js';
import { acquirePatchBatchLocks } from '../agents/apply-patch-batch-lock.js';
import {
  journalEntryId, snapshotPreparedWrite, setWriteJournalBatchState, undoLastWrites, clearWriteJournal, discardWriteJournalEntries,
  type WriteJournalEntry,
} from '../agents/tools/write-journal-core.js';

export async function journaledGitApply<T extends { success: boolean; approvalRequired?: boolean; blocked?: boolean; stale?: boolean }>(input: {
  workspaceRoot: string;
  sessionKey: string;
  paths: string[];
  validate: () => Promise<void>;
  preflight: () => Promise<T>;
  apply: () => Promise<T>;
  /** Frozen binary postimages let rollback preserve a concurrent writer's different bytes. */
  expectedPostimages?: ReadonlyMap<string, Buffer | null>;
  /** The effect owner records successful writes; equal external bytes do not prove ownership. */
  appliedPaths?: ReadonlySet<string>;
  onPrepared?: (journalRef: string) => void;
  canRollback?: () => boolean;
}): Promise<{ result?: T; journalRef?: string; error?: string; recoveryRequired?: boolean }> {
  const paths = [...new Set(input.paths.map((file) => path.resolve(input.workspaceRoot, file)))];
  const root = await fsRoot(input.workspaceRoot);
  const release = await acquirePatchBatchLocks(paths);
  const entries: WriteJournalEntry[] = [];
  // A dedicated operation namespace prevents undo from including another turn's
  // writes. Storage, recovery and snapshots still belong to Coding's journal.
  const operationId = randomUUID();
  const sessionId = `review-apply-${operationId}`;
  let applyStarted = false;
  const read = async (file: string): Promise<Buffer | null> => {
    try { return (await root.read(path.relative(input.workspaceRoot, file))).buffer; }
    catch (error) {
      if (error instanceof FsSafeError && error.code === 'not-found') return null;
      throw error;
    }
  };
  const equals = (a: Buffer | null, b: Buffer | null) => a === null ? b === null : b !== null && a.equals(b);
  function discardPrepared() {
    discardWriteJournalEntries(entries);
    clearWriteJournal({ workspaceRoot: input.workspaceRoot, sessionId });
  }
  async function rollback() {
    // Approval denial/pre-write validation must not rewrite identical preimages:
    // even a same-byte restore changes destination metadata without approval.
    let unchanged = true;
    for (const entry of entries) {
      const current = await read(entry.absPath);
      const original = entry.hadPrior ? await read(entry.snapshotPath) : null;
      if (equals(current, original)) continue;
      unchanged = false;
      if (input.appliedPaths && !input.appliedPaths.has(entry.absPath)) {
        return { recoveryRequired: true, journalRef: journalEntryId(sessionId, entries[0].seq) };
      }
      if (input.expectedPostimages && (!input.expectedPostimages.has(entry.absPath)
        || !equals(current, input.expectedPostimages.get(entry.absPath)!))) {
        return { recoveryRequired: true, journalRef: journalEntryId(sessionId, entries[0].seq) };
      }
    }
    if (unchanged) {
      if (input.canRollback?.() === false) return { recoveryRequired: true, journalRef: journalEntryId(sessionId, entries[0].seq) };
      discardPrepared();
      return {};
    }
    if (input.canRollback?.() === false) return { recoveryRequired: true, journalRef: journalEntryId(sessionId, entries[0].seq) };
    const restored = await undoLastWrites({ workspaceRoot: input.workspaceRoot, sessionId, steps: entries.length, workspaceOnly: true }, toRelativeWorkspacePath);
    if (restored.errors.length === 0) clearWriteJournal({ workspaceRoot: input.workspaceRoot, sessionId });
    return { recoveryRequired: restored.errors.length > 0,
      journalRef: restored.errors.length && entries[0] ? journalEntryId(sessionId, entries[0].seq) : undefined };
  }
  try {
    await input.validate();
    const checked = await input.preflight();
    if (!checked.success) return { result: checked };
    for (const filePath of paths) {
      const priorContent = await read(filePath);
      const entry = snapshotPreparedWrite({ workspaceRoot: input.workspaceRoot, sessionId, filePath,
        hadPrior: priorContent !== null, ...(priorContent === null ? {} : { priorContent }),
        toolName: 'git.applyPatch', requestId: operationId,
        flags: { sourceSessionKey: input.sessionKey }, batch: { id: operationId, state: 'prepared' } });
      if (!entry) throw new Error('The existing write journal could not prepare this patch.');
      entries.push(entry);
    }
    await input.validate();
    if (entries.length === 0) return { result: await input.apply() };
    input.onPrepared?.(journalEntryId(sessionId, entries[0].seq));
    applyStarted = true;
    const result = await input.apply();
    if (!result.success) {
      if (result.approvalRequired || result.blocked || result.stale) { discardPrepared(); return { result }; }
      return { result, ...(await rollback()) };
    }
    const persisted = setWriteJournalBatchState(entries, 'committed');
    return { result, journalRef: journalEntryId(sessionId, entries[0].seq), recoveryRequired: !persisted };
  } catch (error) {
    if (!applyStarted) { discardPrepared(); return { error: error instanceof Error ? error.message : String(error) }; }
    try { return { error: error instanceof Error ? error.message : String(error), ...(await rollback()) }; }
    catch { return { error: 'Journal recovery could not prove destination state.', recoveryRequired: true,
      journalRef: entries[0] ? journalEntryId(sessionId, entries[0].seq) : undefined }; }
  } finally { release(); }
}
