/** Coding journal storage/recovery owner. Tool schemas and media helpers live in write-journal.ts. */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
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

function persistWriteJournalEntry(entry: WriteJournalEntry): void {
  writeFileSync(
    `${entry.snapshotPath}.meta.json`,
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
    const metas = readdirSync(journal.rootDir).filter((name) => name.endsWith(".meta.json"));
    const entries: WriteJournalEntry[] = [];
    for (const metaName of metas) {
      try {
        const raw = readFileSync(path.join(journal.rootDir, metaName), "utf8");
        const parsed = JSON.parse(raw) as Partial<WriteJournalEntry>;
        const snapshotPath = path.join(journal.rootDir, metaName.replace(/\.meta\.json$/, ""));
        if (
          typeof parsed.seq === "number" &&
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
    journal.nextSeq = entries.length > 0 ? entries[entries.length - 1]!.seq + 1 : 1;
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
    const seq = journal.nextSeq++;
    const base = path.basename(rel || "file");
    const hashHint = String(seq).padStart(4, "0");
    const snapshotPath = path.join(journal.rootDir, `${hashHint}-${base}.pre`);
    if (params.hadPrior) {
      if (params.priorContent === undefined) {
        throw new Error(`Missing prepared journal content for ${absPath}`);
      }
      writeFileSync(snapshotPath, params.priorContent);
    } else {
      // Marker for create: empty snapshot file with sidecar meta.
      writeFileSync(snapshotPath, "", "utf8");
    }
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
    persistWriteJournalEntry(entry);
    journal.entries.push(entry);
    codingObservability.recordJournalLatency(performance.now() - started, true);
    return entry;
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
    entry.batch = { ...entry.batch, state };
    try {
      persistWriteJournalEntry(entry);
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
export function undoLastWrites(params: {
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
}, validateWorkspacePath?: (root: string, candidate: string) => unknown): { restored: string[]; errors: string[]; journalDir: string; remainingEntries: number } {
  const sessionId = params.sessionId?.trim() || "default";
  const journal = getOrCreateWriteJournal(params.workspaceRoot, sessionId);
  const steps = Math.max(1, Math.floor(params.steps ?? 1));
  const restored: string[] = [];
  const errors: string[] = [];
  for (let i = 0; i < steps; i += 1) {
    const entry = journal.entries[journal.entries.length - 1];
    if (!entry) {
      break;
    }
    const expected = params.expectedEntries?.[i];
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
        if (!validateWorkspacePath) throw new Error("workspace validator is unavailable");
        validateWorkspacePath(params.workspaceRoot, entry.absPath);
      }
      if (entry.hadPrior && existsSync(entry.snapshotPath)) {
        mkdirSync(path.dirname(entry.absPath), { recursive: true });
        copyFileSync(entry.snapshotPath, entry.absPath);
      } else if (entry.hadPrior) {
        // The snapshot vanished: restoring is impossible. This must surface as
        // a failure, not silently skip the entry.
        throw new Error(`journal snapshot missing: ${entry.snapshotPath}`);
      } else {
        // Was a create: remove the file if present.
        if (existsSync(entry.absPath)) {
          unlinkSync(entry.absPath);
        }
      }
      // Only a fully successful restore removes the entry from the journal.
      journal.entries.pop();
      try {
        rmSync(`${entry.snapshotPath}.meta.json`, { force: true });
        rmSync(entry.snapshotPath, { force: true });
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

