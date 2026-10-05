/** Public structured-artifact commit seam.
 *
 * This is deliberately a thin adapter around the existing Coding write journal
 * and per-file batch lease. The VerseConf consumer never receives a filesystem
 * handle and cannot bypass this owner.
 */
import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertNoSymlinkParentsSync } from "../infra/fs-safe-advanced.js";
import {
  acquirePatchBatchLocks,
} from "../agents/apply-patch-batch-lock.js";
import { EffectReceiptStore } from "../agents/effect-receipt.js";
import {
  journalEntryId,
  setWriteJournalBatchState,
  snapshotPreparedWrite,
  writeJournalRecoveryRef,
  type WriteJournalEntry,
} from "../agents/tools/write-journal.js";

const MAX_SOURCE_BYTES = 1_048_576;

export type StructuredArtifactWriteContext = {
  workspaceRoot: string;
  sessionId: string;
  requestId: string;
  signal?: AbortSignal;
  flags?: Record<string, boolean | string>;
};

export type StructuredArtifactWriteResult = {
  ok: true;
  operationId: string;
  path: string;
  beforeSha256: string | null;
  afterSha256: string;
  journalRef: string | null;
  batchState: "committed";
  changed: boolean;
} | {
  ok: false;
  code: "invalid_path" | "source_missing" | "source_drift" | "cancelled" | "write_failed" | "recovery_required";
  message: string;
  operationId: string;
  path?: string;
  beforeSha256?: string | null;
  afterSha256?: string | null;
  journalRef?: string | null;
  batchState?: "rolled_back" | "recovery_required";
};

export function sha256Bytes(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const error = new Error("structured artifact write cancelled");
    error.name = "AbortError";
    throw error;
  }
}

function resolveWorkspacePath(workspaceRoot: string, relativePath: string): string {
  if (!relativePath || path.isAbsolute(relativePath)) {
    throw new Error("artifact sourcePath must be a non-empty workspace-relative path");
  }
  const root = path.resolve(workspaceRoot);
  const resolved = path.resolve(root, relativePath);
  const rel = path.relative(root, resolved);
  if (!rel || rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new Error("artifact sourcePath escapes the active workspace");
  }
  // The trusted workspace may be a junction; descendants must not redirect
  // artifact reads or journaled writes outside that workspace.
  assertNoSymlinkParentsSync({ rootDir: root, targetPath: resolved, messagePrefix: "artifact sourcePath" });
  return resolved;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function journalRefFor(entry: WriteJournalEntry | null): string | null {
  if (!entry?.lineage) return null;
  return journalEntryId(entry.lineage.sessionId, entry.seq);
}

export async function readStructuredArtifactSource(
  workspaceRoot: string,
  relativePath: string,
): Promise<{ path: string; bytes: Buffer; sha256: string }> {
  const absolute = resolveWorkspacePath(workspaceRoot, relativePath);
  const bytes = await readFile(absolute);
  if (bytes.byteLength > MAX_SOURCE_BYTES) {
    throw new Error(`structured artifact source exceeds ${MAX_SOURCE_BYTES} bytes`);
  }
  return { path: absolute, bytes, sha256: sha256Bytes(bytes) };
}

function recordStructuredEffectReceipt(params: {
  operationId: string;
  journalRef: string | null;
  path: string;
  outcome: "applied" | "not_applied" | "unknown";
  recoverability: string;
  beforeSha256?: string | null;
  afterSha256?: string | null;
}): void {
  if (!params.journalRef) return;
  try {
    new EffectReceiptStore().record({
      idempotencyKey: `structured_artifact:${params.operationId}`,
      proposal: {
        operationId: params.operationId,
        path: params.path,
        beforeSha256: params.beforeSha256 ?? null,
        afterSha256: params.afterSha256 ?? null,
      },
      domainExecutor: "structured-artifact-write-journal",
      outcome: params.outcome,
      journalRef: params.journalRef,
      recoverability: params.recoverability,
    });
  } catch {
    // The existing receipt contract is fail-open; the journal remains authoritative.
  }
}

/** Commit a candidate through the existing journal and per-file lease owner. */
export async function commitStructuredArtifactBytes(params: {
  context: StructuredArtifactWriteContext;
  sourcePath: string;
  candidate: Uint8Array;
  expectedBeforeSha256?: string | null;
  operationId?: string;
}): Promise<StructuredArtifactWriteResult> {
  const operationId = params.operationId?.trim() || randomUUID();
  let absolute: string;
  try {
    absolute = resolveWorkspacePath(params.context.workspaceRoot, params.sourcePath);
  } catch (error) {
    return { ok: false, code: "invalid_path", message: String(error), operationId };
  }
  const displayPath = path.relative(params.context.workspaceRoot, absolute).replace(/\\/g, "/");
  const candidateBytes = Buffer.from(params.candidate);
  if (candidateBytes.byteLength > MAX_SOURCE_BYTES) {
    return {
      ok: false,
      code: "write_failed",
      message: `candidate exceeds ${MAX_SOURCE_BYTES} bytes`,
      operationId,
      path: displayPath,
    };
  }

  let release: (() => void) | undefined;
  let journal: WriteJournalEntry | null = null;
  let beforeBytes: Buffer | null = null;
  const batchId = `structured-artifact:${operationId}`;
  try {
    release = await acquirePatchBatchLocks([absolute]);
    throwIfAborted(params.context.signal);
    resolveWorkspacePath(params.context.workspaceRoot, params.sourcePath);
    if (await pathExists(absolute)) {
      const file = await stat(absolute);
      if (!file.isFile()) {
        return { ok: false, code: "source_missing", message: "artifact source is not a regular file", operationId, path: displayPath };
      }
      beforeBytes = await readFile(absolute);
      if (beforeBytes.byteLength > MAX_SOURCE_BYTES) {
        return { ok: false, code: "source_drift", message: `source exceeds ${MAX_SOURCE_BYTES} bytes`, operationId, path: displayPath };
      }
    } else if (params.expectedBeforeSha256) {
      return { ok: false, code: "source_drift", message: "expected an existing source but it is missing", operationId, path: displayPath };
    }
    const beforeSha256 = beforeBytes ? sha256Bytes(beforeBytes) : null;
    if (params.expectedBeforeSha256 !== undefined && params.expectedBeforeSha256 !== beforeSha256) {
      return {
        ok: false,
        code: "source_drift",
        message: "source changed since the candidate was prepared",
        operationId,
        path: displayPath,
        beforeSha256,
      };
    }
    const afterSha256 = sha256Bytes(candidateBytes);
    if (beforeSha256 === afterSha256 && beforeBytes?.equals(candidateBytes)) {
      return {
        ok: true,
        operationId,
        path: displayPath,
        beforeSha256,
        afterSha256,
        journalRef: null,
        batchState: "committed",
        changed: false,
      };
    }

    throwIfAborted(params.context.signal);
    journal = snapshotPreparedWrite({
      workspaceRoot: params.context.workspaceRoot,
      sessionId: params.context.sessionId,
      filePath: absolute,
      toolName: "structured_artifact_commit",
      requestId: params.context.requestId,
      flags: params.context.flags,
      batch: { id: batchId, state: "prepared" },
      hadPrior: beforeBytes !== null,
      ...(beforeBytes ? { priorContent: beforeBytes } : {}),
    });
    if (!journal) {
      return { ok: false, code: "write_failed", message: "write journal could not capture the source pre-image", operationId, path: displayPath };
    }

    await mkdir(path.dirname(absolute), { recursive: true });
    throwIfAborted(params.context.signal);
    resolveWorkspacePath(params.context.workspaceRoot, params.sourcePath);
    await writeFile(absolute, candidateBytes);
    setWriteJournalBatchState([journal], "committed");
    recordStructuredEffectReceipt({ operationId, journalRef: journalRefFor(journal), path: displayPath, outcome: "applied", recoverability: "journal-preimage", beforeSha256, afterSha256 });
    return {
      ok: true,
      operationId,
      path: displayPath,
      beforeSha256,
      afterSha256,
      journalRef: journalRefFor(journal),
      batchState: "committed",
      changed: true,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isCancelled = error instanceof Error && error.name === "AbortError";
    if (!journal) {
      return {
        ok: false,
        code: isCancelled ? "cancelled" : "write_failed",
        message,
        operationId,
        path: displayPath,
        beforeSha256: beforeBytes ? sha256Bytes(beforeBytes) : null,
      };
    }
    try {
      resolveWorkspacePath(params.context.workspaceRoot, params.sourcePath);
      if (beforeBytes === null) {
        await rm(absolute, { force: true });
      } else {
        await writeFile(absolute, beforeBytes);
      }
      setWriteJournalBatchState([journal], "rolled_back");
      recordStructuredEffectReceipt({ operationId, journalRef: journalRefFor(journal), path: displayPath, outcome: "not_applied", recoverability: "rolled-back", beforeSha256: beforeBytes ? sha256Bytes(beforeBytes) : null, afterSha256: beforeBytes ? sha256Bytes(beforeBytes) : null });
      return {
        ok: false,
        code: isCancelled ? "cancelled" : "write_failed",
        message,
        operationId,
        path: displayPath,
        beforeSha256: beforeBytes ? sha256Bytes(beforeBytes) : null,
        batchState: "rolled_back",
        journalRef: journalRefFor(journal),
      };
    } catch (rollbackError) {
      setWriteJournalBatchState([journal], "recovery_required");
      const recoveryRef = writeJournalRecoveryRef([journal]) ?? journalRefFor(journal);
      recordStructuredEffectReceipt({ operationId, journalRef: recoveryRef, path: displayPath, outcome: "unknown", recoverability: "recovery_required" });
      return {
        ok: false,
        code: "recovery_required",
        message: `${message}; rollback failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
        operationId,
        path: displayPath,
        beforeSha256: beforeBytes ? sha256Bytes(beforeBytes) : null,
        batchState: "recovery_required",
        journalRef: recoveryRef,
      };
    }
  } finally {
    release?.();
  }
}

/** Commit UTF-8 text through the same owner. */
export async function commitStructuredArtifactCandidate(params: {
  context: StructuredArtifactWriteContext;
  sourcePath: string;
  candidate: string;
  expectedBeforeSha256?: string | null;
  operationId?: string;
}): Promise<StructuredArtifactWriteResult> {
  return commitStructuredArtifactBytes({
    ...params,
    candidate: Buffer.from(params.candidate, "utf8"),
  });
}


export {
  closeOpenClawStateDatabase,
  openOpenClawStateDatabase,
  runOpenClawStateWriteTransaction,
  type OpenClawStateDatabase,
  type OpenClawStateDatabaseOptions,
} from "../state/openclaw-state-db.js";
