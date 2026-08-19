/**
 * C2-8: write-journal snapshots + undo_write tool.
 * Fail-open: journal failures never block the write path.
 */
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { Type } from "typebox";
import { codingObservability } from "../../context-engine/coding-observability.js";
import { getToolParamsRecord } from "../agent-tools.params.js";
import type { AnyAgentTool } from "../agent-tools.types.js";
import { toRelativeWorkspacePath } from "../path-policy.js";
import { generateUnifiedPatch } from "../sessions/tools/edit-diff.js";
import { jsonResult } from "./common.js";
import { toFactRelPath } from "../fact-rel-path.js";
import {
  isGitPatchArtifactV1,
  type GitPatchArtifactV1,
} from "../../../../shared/types/remote-forge.js";
import {
  adaptUnifiedDiffToGitPatchArtifacts,
  GIT_PATCH_ADAPTER_LIMITS,
} from "../../../../shared/remote-forge/unified-diff-adapter.js";
import { createRemoteForgeErrorV1 } from "../../../../shared/remote-forge/error-envelope.js";
import type {
  RemoteForgeErrorCode,
  RemoteForgeErrorV1,
} from "../../../../shared/types/remote-forge.js";

export const UNDO_WRITE_TOOL_NAME = "undo_write";

export type WriteJournalBatchState = "prepared" | "committed" | "rolled_back" | "recovery_required";

export type WriteJournalBatch = {
  id: string;
  state: WriteJournalBatchState;
};

export type WriteJournalMutationKind = "write" | "edit" | "apply_patch" | "delete" | "move";

export type WriteJournalFileVersion = {
  contentHash: string;
  mtimeMs: number;
  size: number;
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
  /** P1: normalized mutation kind; absent on legacy P0 sidecars. */
  kind?: WriteJournalMutationKind;
  /** P1 move destination for the source pre-image entry. */
  targetPath?: string;
  /** P1 move source for the destination pre-image entry. */
  moveSourcePath?: string;
  /** P1: sidecar byte/hash/stat evidence. Absent fields remain readable as legacy P0 entries. */
  beforeHash?: string;
  afterHash?: string;
  bytesBefore?: number;
  bytesAfter?: number;
  beforeVersion?: WriteJournalFileVersion;
  afterVersion?: WriteJournalFileVersion;
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

function isWriteJournalMutationKind(value: unknown): value is WriteJournalMutationKind {
  return (
    value === "write" ||
    value === "edit" ||
    value === "apply_patch" ||
    value === "delete" ||
    value === "move"
  );
}

function isWriteJournalFileVersion(value: unknown): value is WriteJournalFileVersion {
  if (!value || typeof value !== "object") return false;
  const version = value as Record<string, unknown>;
  return (
    typeof version.contentHash === "string" &&
    typeof version.mtimeMs === "number" &&
    typeof version.size === "number"
  );
}

export function hashFileContent(content: Buffer | string): string {
  return createHash("sha256").update(content).digest("hex");
}

function versionFromContent(
  content: Buffer | string | undefined,
  mtimeMs: number | undefined,
  _relPath: string,
): WriteJournalFileVersion | undefined {
  if (content === undefined || mtimeMs === undefined) return undefined;
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
  return { contentHash: hashFileContent(bytes), mtimeMs, size: bytes.byteLength };
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
      kind: entry.kind,
      targetPath: entry.targetPath,
      moveSourcePath: entry.moveSourcePath,
      beforeHash: entry.beforeHash,
      afterHash: entry.afterHash,
      bytesBefore: entry.bytesBefore,
      bytesAfter: entry.bytesAfter,
      beforeVersion: entry.beforeVersion,
      afterVersion: entry.afterVersion,
    }),
    "utf8",
  );
}

function bindPatchArtifactLineage(params: {
  details: Record<string, unknown>;
  snapshots: WriteJournalEntry[];
  requestId: string;
}): { patchArtifacts?: GitPatchArtifactV1[]; patchArtifactError?: RemoteForgeErrorV1 } {
  if (!Array.isArray(params.details.patchArtifacts)) return {};
  if (!params.details.patchArtifacts.every(isGitPatchArtifactV1)) {
    return {
      patchArtifacts: [],
      patchArtifactError: createRemoteForgeErrorV1({
        code: "incomplete_response",
        requestId: params.requestId,
      }),
    };
  }

  const patchArtifacts = params.details.patchArtifacts.map((artifact) => {
    if (artifact.lineage?.requestId && artifact.lineage.requestId !== params.requestId) {
      return null;
    }
    const snapshot = params.snapshots.find((entry) => entry.relPath === artifact.file);
    if (!snapshot) return null;
    const next: GitPatchArtifactV1 = {
      ...artifact,
      lineage: {
        ...artifact.lineage,
        requestId: params.requestId,
        journalEntryId: journalEntryId(snapshot.lineage?.sessionId ?? "default", snapshot.seq),
      },
    };
    return isGitPatchArtifactV1(next) ? next : null;
  });
  if (patchArtifacts.some((artifact) => artifact === null)) {
    return {
      patchArtifacts: [],
      patchArtifactError: createRemoteForgeErrorV1({
        code: "incomplete_response",
        requestId: params.requestId,
      }),
    };
  }
  return { patchArtifacts: patchArtifacts as GitPatchArtifactV1[] };
}

type FullFileWriteProjection = {
  patch?: string;
  patchArtifacts: GitPatchArtifactV1[];
  patchArtifactError?: RemoteForgeErrorV1;
};

function unavailableFullFileWrite(
  code: RemoteForgeErrorCode,
  requestId: string | undefined,
): FullFileWriteProjection {
  return {
    patchArtifacts: [],
    patchArtifactError: createRemoteForgeErrorV1({ code, requestId }),
  };
}

function decodeUtf8Strict(value: Buffer): string | undefined {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(value);
  } catch {
    return undefined;
  }
}

function projectFullFileWrite(params: {
  args: unknown;
  requestId?: string;
  snapshots: WriteJournalEntry[];
}): FullFileWriteProjection {
  if (!params.requestId) {
    return unavailableFullFileWrite("incomplete_response", params.requestId);
  }
  if (params.snapshots.length !== 1) {
    return unavailableFullFileWrite("incomplete_response", params.requestId);
  }
  const snapshot = params.snapshots[0]!;
  const record = getToolParamsRecord(params.args);
  const expectedContent = typeof record?.content === "string" ? record.content : undefined;
  if (expectedContent === undefined) {
    return unavailableFullFileWrite("invalid_request", params.requestId);
  }

  try {
    if (!existsSync(snapshot.absPath) || !statSync(snapshot.absPath).isFile()) {
      return unavailableFullFileWrite("incomplete_response", params.requestId);
    }
    const beforeBytes = readFileSync(snapshot.snapshotPath);
    const afterBytes = readFileSync(snapshot.absPath);
    const expectedBytes = Buffer.from(expectedContent, "utf8");
    if (!afterBytes.equals(expectedBytes)) {
      return unavailableFullFileWrite("incomplete_response", params.requestId);
    }
    if (beforeBytes.byteLength + afterBytes.byteLength > GIT_PATCH_ADAPTER_LIMITS.maxInputBytes) {
      return unavailableFullFileWrite("truncated_response", params.requestId);
    }
    const beforeContent = decodeUtf8Strict(beforeBytes);
    if (beforeContent === undefined) {
      return unavailableFullFileWrite("incomplete_response", params.requestId);
    }
    if (snapshot.hadPrior && beforeBytes.equals(afterBytes)) {
      return unavailableFullFileWrite("conflict", params.requestId);
    }

    const patch = generateUnifiedPatch(
      snapshot.relPath,
      snapshot.hadPrior ? beforeContent : "",
      expectedContent,
      4,
      snapshot.hadPrior ? "modified" : "added",
    );
    const projection = adaptUnifiedDiffToGitPatchArtifacts({
      patch,
      sourceCompleteness: "complete",
      lineage: { requestId: params.requestId },
    });
    if (projection.kind === "unavailable") {
      return unavailableFullFileWrite("incomplete_response", params.requestId);
    }
    if (projection.artifacts.some((artifact) => artifact.completeness !== "complete")) {
      return unavailableFullFileWrite("incomplete_response", params.requestId);
    }
    return { patch, patchArtifacts: projection.artifacts };
  } catch {
    return unavailableFullFileWrite("incomplete_response", params.requestId);
  }
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
            ...(isWriteJournalMutationKind(parsed.kind) ? { kind: parsed.kind } : {}),
            ...(typeof parsed.targetPath === "string" ? { targetPath: parsed.targetPath } : {}),
            ...(typeof parsed.moveSourcePath === "string"
              ? { moveSourcePath: parsed.moveSourcePath }
              : {}),
            ...(typeof parsed.beforeHash === "string" ? { beforeHash: parsed.beforeHash } : {}),
            ...(typeof parsed.afterHash === "string" ? { afterHash: parsed.afterHash } : {}),
            ...(typeof parsed.bytesBefore === "number" ? { bytesBefore: parsed.bytesBefore } : {}),
            ...(typeof parsed.bytesAfter === "number" ? { bytesAfter: parsed.bytesAfter } : {}),
            ...(isWriteJournalFileVersion(parsed.beforeVersion)
              ? { beforeVersion: parsed.beforeVersion }
              : {}),
            ...(isWriteJournalFileVersion(parsed.afterVersion)
              ? { afterVersion: parsed.afterVersion }
              : {}),
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
  /** P1: normalized mutation kind recorded in the sidecar. */
  kind?: WriteJournalMutationKind;
  /** P1 move destination (source entry only). */
  targetPath?: string;
  /** P1 move source (destination entry only). */
  moveSourcePath?: string;
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
  let beforeStat: { mtimeMs: number; size: number } | undefined;
  try {
    const stat = statSync(absPath);
    if (stat.isFile()) {
      hadPrior = true;
      priorContent = readFileSync(absPath);
      beforeStat = { mtimeMs: stat.mtimeMs, size: stat.size };
    } else {
      return null;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") return null;
  }
  return snapshotPreparedWrite({
    ...params,
    filePath: absPath,
    hadPrior,
    ...(priorContent ? { priorContent } : {}),
    ...(beforeStat ? { beforeStat } : {}),
  });
}

/** Persist an already captured pre-image without rereading the mutation target. */
export function snapshotPreparedWrite(params: {
  workspaceRoot: string;
  sessionId?: string;
  filePath: string;
  toolName: string;
  kind?: WriteJournalMutationKind;
  targetPath?: string;
  moveSourcePath?: string;
  requestId?: string;
  flags?: Record<string, boolean | string>;
  batch?: WriteJournalBatch;
  hadPrior: boolean;
  priorContent?: Buffer | string;
  beforeStat?: { mtimeMs: number; size: number };
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
    const beforeContent =
      params.hadPrior && params.priorContent !== undefined
        ? Buffer.isBuffer(params.priorContent)
          ? params.priorContent
          : Buffer.from(params.priorContent, "utf8")
        : undefined;
    const beforeStat =
      params.beforeStat ??
      (params.hadPrior
        ? (() => {
            try {
              const stat = statSync(absPath);
              return stat.isFile() ? { mtimeMs: stat.mtimeMs, size: stat.size } : undefined;
            } catch {
              return undefined;
            }
          })()
        : undefined);
    const beforeVersion = versionFromContent(
      beforeContent,
      beforeStat?.mtimeMs,
      rel,
    );
    const entry: WriteJournalEntry = {
      seq,
      relPath: rel,
      absPath,
      snapshotPath,
      hadPrior: params.hadPrior,
      toolName: params.toolName,
      createdAtMs: Date.now(),
      ...(params.kind ? { kind: params.kind } : {}),
      ...(params.targetPath ? { targetPath: params.targetPath } : {}),
      ...(params.moveSourcePath ? { moveSourcePath: params.moveSourcePath } : {}),
      ...(beforeVersion
        ? {
            beforeHash: beforeVersion.contentHash,
            bytesBefore: beforeVersion.size,
            beforeVersion,
          }
        : { bytesBefore: 0 }),
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

/** P1: snapshot a file that is about to be deleted. */
export function snapshotBeforeDelete(params: {
  workspaceRoot: string;
  sessionId?: string;
  filePath: string;
  toolName: string;
  requestId?: string;
  flags?: Record<string, boolean | string>;
  batch?: WriteJournalBatch;
}): WriteJournalEntry | null {
  const absPath = path.isAbsolute(params.filePath)
    ? path.resolve(params.filePath)
    : path.resolve(params.workspaceRoot, params.filePath);
  try {
    if (!existsSync(absPath) || !statSync(absPath).isFile()) return null;
  } catch {
    return null;
  }
  return snapshotBeforeWrite({ ...params, kind: "delete" });
}

/** P1: snapshot both sides of a move before the filesystem rename. */
export function snapshotBeforeMove(params: {
  workspaceRoot: string;
  sessionId?: string;
  sourcePath: string;
  destinationPath: string;
  toolName: string;
  requestId?: string;
  flags?: Record<string, boolean | string>;
  batch?: WriteJournalBatch;
}): WriteJournalEntry[] | null {
  const sourceAbs = path.isAbsolute(params.sourcePath)
    ? path.resolve(params.sourcePath)
    : path.resolve(params.workspaceRoot, params.sourcePath);
  const destinationAbs = path.isAbsolute(params.destinationPath)
    ? path.resolve(params.destinationPath)
    : path.resolve(params.workspaceRoot, params.destinationPath);
  if (sourceAbs === destinationAbs) return null;

  let sourceContent: Buffer | undefined;
  let sourceStat: { mtimeMs: number; size: number } | undefined;
  let destinationHadPrior = false;
  let destinationContent: Buffer | undefined;
  let destinationStat: { mtimeMs: number; size: number } | undefined;
  try {
    const stat = statSync(sourceAbs);
    if (!stat.isFile()) return null;
    sourceContent = readFileSync(sourceAbs);
    sourceStat = { mtimeMs: stat.mtimeMs, size: stat.size };
    if (existsSync(destinationAbs)) {
      const destStat = statSync(destinationAbs);
      if (!destStat.isFile()) return null;
      destinationHadPrior = true;
      destinationContent = readFileSync(destinationAbs);
      destinationStat = { mtimeMs: destStat.mtimeMs, size: destStat.size };
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") return null;
  }

  const sourceRel =
    toFactRelPath(sourceAbs, params.workspaceRoot) ??
    path.relative(params.workspaceRoot, sourceAbs).replace(/\\/g, "/");
  const destinationRel =
    toFactRelPath(destinationAbs, params.workspaceRoot) ??
    path.relative(params.workspaceRoot, destinationAbs).replace(/\\/g, "/");

  const sourceEntry = snapshotPreparedWrite({
    ...params,
    filePath: sourceAbs,
    kind: "move",
    targetPath: destinationRel,
    hadPrior: true,
    ...(sourceContent ? { priorContent: sourceContent } : {}),
    ...(sourceStat ? { beforeStat: sourceStat } : {}),
  });
  if (!sourceEntry) return null;

  const destinationEntry = snapshotPreparedWrite({
    ...params,
    filePath: destinationAbs,
    kind: "move",
    moveSourcePath: sourceRel,
    hadPrior: destinationHadPrior,
    ...(destinationContent ? { priorContent: destinationContent } : {}),
    ...(destinationStat ? { beforeStat: destinationStat } : {}),
  });
  if (!destinationEntry) {
    discardWriteJournalEntries([sourceEntry]);
    return null;
  }
  codingObservability.recordJournalDeleteMoveSnapshot();
  return [sourceEntry, destinationEntry];
}

/** P1: persist after-image hash/bytes/version evidence into the sidecar. */
export function updateWriteJournalAfterState(params: {
  entry: WriteJournalEntry;
  afterContent?: Buffer | string;
  afterPath?: string;
  afterExists?: boolean;
}): boolean {
  try {
    if (params.afterExists === false) {
      params.entry.afterHash = undefined;
      params.entry.bytesAfter = 0;
      params.entry.afterVersion = undefined;
      persistWriteJournalEntry(params.entry);
      return true;
    }
    const absPath = path.resolve(params.afterPath ?? params.entry.absPath);
    const stat = statSync(absPath);
    if (!stat.isFile()) return false;
    const afterContent =
      params.afterContent !== undefined ? params.afterContent : readFileSync(absPath);
    const afterVersion = versionFromContent(afterContent, stat.mtimeMs, params.entry.relPath);
    if (!afterVersion) return false;
    params.entry.afterHash = afterVersion.contentHash;
    params.entry.bytesAfter = afterVersion.size;
    params.entry.afterVersion = afterVersion;
    persistWriteJournalEntry(params.entry);
    return true;
  } catch {
    return false;
  }
}

/** P1: find retained journal evidence for one transaction batch. */
export function getWriteJournalEntriesForBatch(
  workspaceRoot: string,
  sessionId: string,
  batchId: string,
): WriteJournalEntry[] {
  return getOrCreateWriteJournal(workspaceRoot, sessionId).entries.filter(
    (entry) => entry.batch?.id === batchId,
  );
}

export type UndoWriteJournalEntriesResult = {
  restored: string[];
  errors: string[];
  journalDir: string;
  remainingEntries: number;
};

/**
 * P1: restore one exact journal entry set newest-first. Stops at the first
 * failure and keeps the failed entry plus all older evidence for recovery.
 */
export function undoWriteJournalEntries(params: {
  workspaceRoot: string;
  sessionId?: string;
  entries: WriteJournalEntry[];
  workspaceOnly?: boolean;
}): UndoWriteJournalEntriesResult {
  const sessionId = params.sessionId?.trim() || "default";
  const journal = getOrCreateWriteJournal(params.workspaceRoot, sessionId);
  const entries = [...params.entries].sort((a, b) => b.seq - a.seq);
  const restored: string[] = [];
  const errors: string[] = [];
  for (const entry of entries) {
    try {
      if (params.workspaceOnly) {
        toRelativeWorkspacePath(params.workspaceRoot, entry.absPath);
      }
      if (entry.hadPrior && existsSync(entry.snapshotPath)) {
        mkdirSync(path.dirname(entry.absPath), { recursive: true });
        copyFileSync(entry.snapshotPath, entry.absPath);
      } else if (entry.hadPrior) {
        throw new Error(`journal snapshot missing: ${entry.snapshotPath}`);
      } else if (existsSync(entry.absPath)) {
        unlinkSync(entry.absPath);
      }
      journal.entries = journal.entries.filter((candidate) => candidate.seq !== entry.seq);
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
}): { restored: string[]; errors: string[]; journalDir: string; remainingEntries: number } {
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
    try {
      if (params.workspaceOnly) {
        toRelativeWorkspacePath(params.workspaceRoot, entry.absPath);
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

/** Best-effort path list from apply_patch input (for pre-write snapshots). */
export function extractPatchTargetPaths(input: string): string[] {
  const paths: string[] = [];
  const re = /^\*\*\*\s+(?:Add|Update|Delete|Move)\s+File:\s+(.+?)\s*$/gim;
  let match: RegExpExecArray | null;
  while ((match = re.exec(input)) !== null) {
    const p = match[1]?.trim();
    if (p) {
      paths.push(p);
    }
  }
  // Move File may have "Move to:" lines
  const moveTo = /^\*\*\*\s+Move\s+to:\s+(.+?)\s*$/gim;
  while ((match = moveTo.exec(input)) !== null) {
    const p = match[1]?.trim();
    if (p) {
      paths.push(p);
    }
  }
  return [...new Set(paths)];
}

export function wrapToolWithWriteJournal(
  tool: AnyAgentTool,
  options: {
    workspaceRoot: string;
    sessionId?: string;
    enabled?: boolean;
    /** FP-P1-04: coding flags in force, recorded into each entry's lineage. */
    flags?: Record<string, boolean | string>;
  },
): AnyAgentTool {
  if (options.enabled === false) {
    return tool;
  }
  return {
    ...tool,
    execute: async (toolCallId, args, signal, onUpdate) => {
      const record = getToolParamsRecord(args);
      const paths: string[] = [];
      if (tool.name === "apply_patch") {
        const input = typeof record?.input === "string" ? record.input : "";
        paths.push(...extractPatchTargetPaths(input));
      } else if (typeof record?.path === "string" && record.path.trim()) {
        paths.push(record.path);
      }
      const snapshots: WriteJournalEntry[] = [];
      for (const filePath of paths) {
        const entry = snapshotBeforeWrite({
          workspaceRoot: options.workspaceRoot,
          sessionId: options.sessionId,
          filePath,
          toolName: tool.name,
          ...(toolCallId ? { requestId: toolCallId } : {}),
          ...(options.flags ? { flags: options.flags } : {}),
        });
        if (entry) {
          snapshots.push(entry);
        }
      }
      const result = await tool.execute(toolCallId, args, signal, onUpdate);
      if (snapshots.length === 0) {
        return result;
      }
      const prevDetails =
        result.details && typeof result.details === "object" && !Array.isArray(result.details)
          ? (result.details as Record<string, unknown>)
          : {};
      const detailsForLineage =
        tool.name === "write"
          ? (() => {
              const {
                patch: _untrustedPatch,
                patchArtifacts: _untrustedArtifacts,
                patchArtifactError: _untrustedError,
                ...otherDetails
              } = prevDetails;
              return {
                ...otherDetails,
                ...projectFullFileWrite({ args, requestId: toolCallId, snapshots }),
              };
            })()
          : prevDetails;
      const patchLineage = toolCallId
        ? bindPatchArtifactLineage({ details: detailsForLineage, snapshots, requestId: toolCallId })
        : {};
      return {
        ...result,
        details: {
          ...detailsForLineage,
          ...patchLineage,
          write_journal: {
            undoable: true,
            snapshots: snapshots.map((s) => ({
              seq: s.seq,
              journalEntryId: journalEntryId(s.lineage?.sessionId ?? "default", s.seq),
              path: s.relPath,
              hadPrior: s.hadPrior,
            })),
          },
        },
      };
    },
  };
}

export function createUndoWriteTool(options: {
  workspaceRoot: string;
  sessionId?: string;
  enabled?: boolean;
  workspaceOnly?: boolean;
}): AnyAgentTool | null {
  if (options.enabled === false || !options.workspaceRoot) {
    return null;
  }
  return {
    name: UNDO_WRITE_TOOL_NAME,
    label: "Undo Write",
    description:
      "Roll back the last N write/edit/apply_patch mutations using the write journal for this session.",
    // Reversible restore of prior file content.
    risk: "write",
    parameters: Type.Object({
      steps: Type.Optional(
        Type.Number({ description: "Number of journal steps to undo (default 1)." }),
      ),
    }),
    execute: async (_id, args) => {
      const record = getToolParamsRecord(args) ?? {};
      const steps = typeof record.steps === "number" ? record.steps : 1;
      const outcome = undoLastWrites({
        workspaceRoot: options.workspaceRoot,
        sessionId: options.sessionId,
        steps,
        workspaceOnly: options.workspaceOnly,
      });
      // FP-P1-04: partial restore is a FAILURE; the journal dir is reported so
      // a human can recover from the preserved snapshots.
      return jsonResult({
        ok: outcome.errors.length === 0,
        restored: outcome.restored,
        errors: outcome.errors,
        journalDir: outcome.journalDir,
        remainingEntries: outcome.remainingEntries,
        ...(outcome.errors.length > 0
          ? {
              recovery:
                "Undo stopped at the first failure. Nothing was discarded: snapshots and metadata remain in journalDir for manual restore.",
            }
          : {}),
      });
    },
  } as AnyAgentTool;
}

/** Test helper: list journal snapshot files on disk. */
export function listJournalSnapshotFiles(workspaceRoot: string, sessionId: string): string[] {
  const dir = journalDirFor(workspaceRoot, sessionId);
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir).filter((name) => name.endsWith(".pre"));
}
