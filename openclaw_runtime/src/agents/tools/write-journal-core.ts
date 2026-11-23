/** Coding journal storage/recovery owner. Tool schemas and media helpers live in write-journal.ts. */
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { FsSafeError, root as fsRoot } from "../../infra/fs-safe.js";
import { assertSandboxPath } from "../sandbox-paths.js";
import { toRelativeWorkspacePath } from "../path-policy.js";
import { codingObservability } from "../../context-engine/coding-observability.js";
import { toFactRelPath } from "../fact-rel-path.js";

export type WriteJournalBatchState = "prepared" | "committed" | "rolled_back" | "recovery_required";

export type WriteJournalBatch = {
  id: string;
  state: WriteJournalBatchState;
};

export type WriteJournalEntry = {
  seq: number;
  relPath: string;
  absPath: string;
  snapshotPath: string;
  /** true when a pre-image existed and was snapshotted */
  hadPrior: boolean;
  toolName: string;
  createdAtMs: number;
  /** FP-P1-04: lineage — which request/session/workspace/flags produced this write. */
  lineage?: {
    sessionId: string;
    workspaceRoot: string;
    gatewayGeneration?: string;
    /** Tool call id of the write that created this entry. */
    requestId?: string;
    /** Coding flags in force at write time (AC: lineage carries flags). */
    flags?: Record<string, boolean | string>;
  };
  /** UAS-04: application-level apply_patch batch state persisted in the same sidecar. */
  batch?: WriteJournalBatch;
};

export type WriteJournal = {
  sessionId: string;
  rootDir: string;
  entries: WriteJournalEntry[];
  nextSeq: number;
};

const journals = new Map<string, WriteJournal>();

export function journalEntryId(sessionId: string, seq: number): string {
  return `write-journal:${sessionId}:${seq}`;
}

function isWriteJournalBatchState(value: unknown): value is WriteJournalBatchState {
  return (
    value === "prepared" ||
    value === "committed" ||
    value === "rolled_back" ||
    value === "recovery_required"
  );
}

function persistWriteJournalEntry(entry: WriteJournalEntry, descriptor?: number): void {
  writeFileSync(
    descriptor ?? `${entry.snapshotPath}.meta.json`,
    JSON.stringify({
      seq: entry.seq,
      relPath: entry.relPath,
      absPath: entry.absPath,
      hadPrior: entry.hadPrior,
      toolName: entry.toolName,
      createdAtMs: entry.createdAtMs,
      lineage: entry.lineage,
      batch: entry.batch,
    }),
    "utf8",
  );
}

export function journalDirFor(workspaceRoot: string, sessionId: string): string {
  // Filesystem-safe session key: canonical keys like "agent:main:main"
  // contain ':' which is illegal in Windows paths. Normalize once here so
  // every read/write/rehydrate path resolves the same directory.
  const safe = sessionId.replace(/[\\/:*?"<>|]/g, "_");
  return path.join(workspaceRoot, ".openclaw", "journal", safe);
}

/**
 * FP-P1-04/FP-P1-05: rebuild the in-memory journal from the on-disk sidecar
 * metas so undo survives a gateway/app restart. Disk is the source of truth;
 * entries are ordered by seq.
 */
function rehydrateJournalFromDisk(journal: WriteJournal): void {
  try {
    if (!existsSync(journal.rootDir)) return;
    const filenames = readdirSync(journal.rootDir);
    const metas = filenames.filter((name) => name.endsWith(".meta.json"));
    let lastOccupiedSeq = 0;
    for (const filename of filenames) {
      const match = /^(\d+)-.+\.pre(?:\.meta\.json)?$/.exec(filename);
      const seq = match ? Number(match[1]) : 0;
      if (Number.isSafeInteger(seq) && seq > lastOccupiedSeq) lastOccupiedSeq = seq;
    }
    const entries: WriteJournalEntry[] = [];
    for (const metaName of metas) {
      try {
        const raw = readFileSync(path.join(journal.rootDir, metaName), "utf8");
        const parsed = JSON.parse(raw) as Partial<WriteJournalEntry>;
        const snapshotPath = path.join(journal.rootDir, metaName.replace(/\.meta\.json$/, ""));
        if (
          typeof parsed.seq === "number" &&
          Number.isSafeInteger(parsed.seq) &&
          parsed.seq > 0 &&
          typeof parsed.relPath === "string" &&
          typeof parsed.absPath === "string"
        ) {
          const batch =
            parsed.batch &&
            typeof parsed.batch.id === "string" &&
            isWriteJournalBatchState(parsed.batch.state)
              ? { id: parsed.batch.id, state: parsed.batch.state }
              : undefined;
          entries.push({
            seq: parsed.seq,
            relPath: parsed.relPath,
            absPath: parsed.absPath,
            snapshotPath,
            hadPrior: parsed.hadPrior === true,
            toolName: typeof parsed.toolName === "string" ? parsed.toolName : "unknown",
            createdAtMs: typeof parsed.createdAtMs === "number" ? parsed.createdAtMs : 0,
            ...(parsed.lineage ? { lineage: parsed.lineage } : {}),
            ...(batch ? { batch } : {}),
          });
        }
      } catch {
        // Unreadable sidecar: skip it; the snapshot stays on disk for manual recovery.
      }
    }
    entries.sort((a, b) => a.seq - b.seq);
    journal.entries = entries;
    // Unreadable metadata must not make its still-present preimage reusable.
    journal.nextSeq = Math.max(lastOccupiedSeq, entries.at(-1)?.seq ?? 0) + 1;
  } catch {
    // Fail-open: an unreadable journal dir must not block tool creation.
  }
}

export function getOrCreateWriteJournal(workspaceRoot: string, sessionId: string): WriteJournal {
  const sid = sessionId.trim() || "default";
  const key = `${path.resolve(workspaceRoot)}::${sid}`;
  let journal = journals.get(key);
  if (!journal) {
    const rootDir = journalDirFor(workspaceRoot, sid);
    journal = { sessionId: sid, rootDir, entries: [], nextSeq: 1 };
    rehydrateJournalFromDisk(journal);
    journals.set(key, journal);
  }
  return journal;
}

export function __resetWriteJournals(): void {
  journals.clear();
}

/**
 * Snapshot target file before mutation. Returns entry or null if fail-open.
 */
export function snapshotBeforeWrite(params: {
  workspaceRoot: string;
  sessionId?: string;
  filePath: string;
  toolName: string;
  /** FP-P1-04: tool call id, recorded as the write's requestId. */
  requestId?: string;
  /** FP-P1-04: coding flags in force at write time. */
  flags?: Record<string, boolean | string>;
  /** UAS-04: apply_patch batch identity and lifecycle state. */
  batch?: WriteJournalBatch;
}): WriteJournalEntry | null {
  const absPath = path.isAbsolute(params.filePath)
    ? path.resolve(params.filePath)
    : path.resolve(params.workspaceRoot, params.filePath);
  let hadPrior = false;
  let priorContent: Buffer | undefined;
  try {
    if (existsSync(absPath) && statSync(absPath).isFile()) {
      hadPrior = true;
      priorContent = readFileSync(absPath);
    }
  } catch {
    return null;
  }
  return snapshotPreparedWrite({
    ...params,
    filePath: absPath,
    hadPrior,
    ...(priorContent ? { priorContent } : {}),
  });
}

/** Persist an already captured pre-image without rereading the mutation target. */
export function snapshotPreparedWrite(params: {
  workspaceRoot: string;
  sessionId?: string;
  filePath: string;
  toolName: string;
  requestId?: string;
  flags?: Record<string, boolean | string>;
  batch?: WriteJournalBatch;
  hadPrior: boolean;
  priorContent?: Buffer | string;
}): WriteJournalEntry | null {
  const sessionId = params.sessionId?.trim() || "default";
  const started = performance.now();
  try {
    const journal = getOrCreateWriteJournal(params.workspaceRoot, sessionId);
    const absPath = path.isAbsolute(params.filePath)
      ? path.resolve(params.filePath)
      : path.resolve(params.workspaceRoot, params.filePath);
    const rel =
      toFactRelPath(params.filePath, params.workspaceRoot) ??
      path.relative(params.workspaceRoot, absPath).replace(/\\/g, "/");
    mkdirSync(journal.rootDir, { recursive: true });
    const base = path.basename(rel || "file");
    if (params.hadPrior && params.priorContent === undefined)
      throw new Error(`Missing prepared journal content for ${absPath}`);
    let seq: number;
    let snapshotPath: string;
    let descriptor: number;
    for (;;) {
      if (!Number.isSafeInteger(journal.nextSeq) || journal.nextSeq < 1)
        throw new Error("Journal sequence exhausted");
      seq = journal.nextSeq++;
      snapshotPath = path.join(journal.rootDir, `${String(seq).padStart(4, "0")}-${base}.pre`);
      if (existsSync(snapshotPath)) continue;
      try {
        descriptor = openSync(`${snapshotPath}.meta.json`, "wx");
        break;
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "EEXIST")
          continue;
        throw error;
      }
    }
    try {
      // Reserving metadata first and creating the preimage exclusively keeps
      // either an orphan snapshot or an existing sidecar from being overwritten.
      writeFileSync(snapshotPath, params.hadPrior ? params.priorContent! : "", { flag: "wx" });
      const entry: WriteJournalEntry = {
        seq,
        relPath: rel,
        absPath,
        snapshotPath,
        hadPrior: params.hadPrior,
        toolName: params.toolName,
        createdAtMs: Date.now(),
        lineage: {
          sessionId,
          workspaceRoot: path.resolve(params.workspaceRoot),
          ...(process.env.VERSE_CLAW_GATEWAY_GENERATION
            ? { gatewayGeneration: process.env.VERSE_CLAW_GATEWAY_GENERATION }
            : {}),
          ...(params.requestId ? { requestId: params.requestId } : {}),
          ...(params.flags ? { flags: params.flags } : {}),
        },
        ...(params.batch ? { batch: params.batch } : {}),
      };
      persistWriteJournalEntry(entry, descriptor);
      journal.entries.push(entry);
      codingObservability.recordJournalLatency(performance.now() - started, true);
      return entry;
    } finally {
      closeSync(descriptor);
    }
  } catch {
    codingObservability.recordJournalLatency(performance.now() - started, false);
    return null;
  }
}

/** Update every entry in one apply_patch batch while preserving the journal as authority. */
export function setWriteJournalBatchState(
  entries: WriteJournalEntry[],
  state: WriteJournalBatchState,
): boolean {
  let persisted = true;
  for (const entry of entries) {
    if (!entry.batch) {
      persisted = false;
      continue;
    }
    const batch = { ...entry.batch, state };
    try {
      persistWriteJournalEntry({ ...entry, batch });
      // Memory must not advance beyond the durable owner when a sidecar write fails.
      entry.batch = batch;
    } catch {
      // A stale prepared sidecar is safer than claiming a terminal state that was not persisted.
      persisted = false;
    }
  }
  return persisted;
}

/** Remove journal evidence only after the matching mutation was fully rolled back. */
export function discardWriteJournalEntries(entries: WriteJournalEntry[]): void {
  for (const entry of entries) {
    const workspaceRoot = entry.lineage?.workspaceRoot;
    const sessionId = entry.lineage?.sessionId;
    if (workspaceRoot && sessionId) {
      const journal = getOrCreateWriteJournal(workspaceRoot, sessionId);
      journal.entries = journal.entries.filter((candidate) => candidate.seq !== entry.seq);
    }
    try {
      rmSync(`${entry.snapshotPath}.meta.json`, { force: true });
      rmSync(entry.snapshotPath, { force: true });
    } catch {
      // A rolled_back sidecar is harmless and remains explicit if cleanup is interrupted.
    }
  }
}

export function listPreparedWriteJournalEntries(
  workspaceRoot: string,
  sessionId: string,
): WriteJournalEntry[] {
  return getOrCreateWriteJournal(workspaceRoot, sessionId).entries.filter(
    (entry) => entry.batch?.state === "prepared",
  );
}

export function writeJournalRecoveryRef(entries: WriteJournalEntry[]): string | undefined {
  const first = entries[0];
  if (!first?.batch || !first.lineage) {
    return undefined;
  }
  const ids = entries.map((entry) => journalEntryId(first.lineage!.sessionId, entry.seq));
  return `${journalDirFor(first.lineage.workspaceRoot, first.lineage.sessionId)}#batch=${encodeURIComponent(first.batch.id)}&entries=${encodeURIComponent(ids.join(","))}`;
}

/**
 * Undo the last N journal steps.
 *
 * FP-P1-04 hard lock: undo is NOT best-effort. On the first restore failure the
 * loop STOPS, the failed entry (and everything older) STAYS in the journal, and
 * the outcome reports failure with the journal directory preserved for manual
 * recovery. A partially restored batch is a failure, never a success.
 */
export async function undoLastWrites(
  params: {
    workspaceRoot: string;
    sessionId?: string;
    steps?: number;
    workspaceOnly?: boolean;
    /**
     * #175: newest-first identity of the entries the caller selected. Each pop is
     * verified against it, so a concurrent write that landed *after* the selection
     * aborts the undo instead of being deleted as "the Nth entry from the tail"
     * while the intended target is left untouched.
     */
    expectedEntries?: readonly { seq: number; relPath: string }[];
  },
  validateWorkspacePath?: (root: string, candidate: string) => unknown,
): Promise<{ restored: string[]; errors: string[]; journalDir: string; remainingEntries: number }> {
  const sessionId = params.sessionId?.trim() || "default";
  const journal = getOrCreateWriteJournal(params.workspaceRoot, sessionId);
  const steps = Math.max(1, Math.floor(params.steps ?? 1));
  const expectedEntries =
    params.expectedEntries ??
    journal.entries
      .slice(-steps)
      .toReversed()
      .map(({ seq, relPath }) => ({ seq, relPath }));
  const restored: string[] = [];
  const errors: string[] = [];
  for (let i = 0; i < steps; i += 1) {
    const entry = journal.entries[journal.entries.length - 1];
    if (!entry) {
      break;
    }
    const expected = expectedEntries[i];
    if (!expected) break;
    if (expected && (entry.seq !== expected.seq || entry.relPath !== expected.relPath)) {
      // Abort BEFORE mutating anything: whatever sits at the tail now is not
      // what the caller selected, so it must survive. Reporting an error keeps
      // the upper layer from claiming a successful rollback (#175).
      errors.push(
        `concurrent_write_detected: expected tail seq ${expected.seq} (${expected.relPath}), found seq ${entry.seq} (${entry.relPath})`,
      );
      break;
    }
    try {
      if (params.workspaceOnly) {
        (validateWorkspacePath ?? toRelativeWorkspacePath)(params.workspaceRoot, entry.absPath);
      }
      // Snapshot bytes always belong to this workspace, even when an operator
      // explicitly permits restoring an external target. Never follow a swapped
      // .pre link to bring external bytes into the restored file.
      const journalRoot = await fsRoot(params.workspaceRoot);
      const snapshotRelative = toRelativeWorkspacePath(params.workspaceRoot, entry.snapshotPath);
      let preimage: Buffer | undefined;
      if (entry.hadPrior) {
        try {
          preimage = (await journalRoot.read(snapshotRelative)).buffer;
        } catch (error) {
          if (error instanceof FsSafeError && error.code === "not-found") {
            throw new Error(`journal snapshot missing: ${entry.snapshotPath}`, { cause: error });
          }
          throw error;
        }
      }
      const targetRoot = params.workspaceOnly ? params.workspaceRoot : path.dirname(entry.absPath);
      await assertSandboxPath({ filePath: entry.absPath, cwd: targetRoot, root: targetRoot });
      const destination = await fsRoot(targetRoot);
      const relative = toRelativeWorkspacePath(targetRoot, entry.absPath);
      // Keep the validated target literal; fs-safe also accepts bounded
      // absolute paths, avoiding a second ~ expansion during recovery.
      const restorePath = path.resolve(destination.rootReal, relative);
      if (journal.entries.at(-1) !== entry) {
        throw new Error("concurrent_write_detected: journal tail changed before restore");
      }
      if (preimage !== undefined) {
        await destination.write(restorePath, preimage, { mkdir: true });
      } else {
        try {
          await destination.remove(restorePath);
        } catch (error) {
          if (!(error instanceof FsSafeError && error.code === "not-found")) throw error;
        }
      }
      // An unrelated path may journal while the async restore is in flight.
      // Consume exactly the restored entry, never the new tail from another call.
      const entryIndex = journal.entries.indexOf(entry);
      if (entryIndex >= 0) journal.entries.splice(entryIndex, 1);
      try {
        await journalRoot.remove(`${snapshotRelative}.meta.json`);
        await journalRoot.remove(snapshotRelative);
      } catch {
        // Snapshot cleanup is best-effort; the restore already succeeded.
      }
      restored.push(entry.relPath);
      codingObservability.recordUndo();
    } catch (error) {
      errors.push(`${entry.relPath}: ${error instanceof Error ? error.message : String(error)}`);
      // Stop immediately: continuing would leave an inconsistent mix while
      // discarding the evidence needed to recover.
      break;
    }
  }
  return {
    restored,
    errors,
    journalDir: journal.rootDir,
    remainingEntries: journal.entries.length,
  };
}

export function clearWriteJournal(params: { workspaceRoot: string; sessionId?: string }): void {
  const sessionId = params.sessionId?.trim() || "default";
  const key = `${path.resolve(params.workspaceRoot)}::${sessionId}`;
  const journal = journals.get(key);
  if (journal) {
    try {
      rmSync(journal.rootDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
    journals.delete(key);
  }
}
