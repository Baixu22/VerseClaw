/**
 * P1 UFTK: unified file transaction service.
 *
 * One prepare/commit/rollback state machine over the existing write-journal,
 * apply-patch preflight, per-path batch leases, and atomic write layer. Events
 * are returned in-memory only; JSONL/SQLite audit storage is intentionally
 * Phase 4 work and `listAudit` fails closed until then.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { ApplyPatchBatchOptions, PatchFileOps } from "../apply-patch-types.js";
import {
  applyPreparedBatch,
  preflightPatch,
  type PreparedPatchBatch,
} from "../apply-patch-preflight.js";
import { resolvePathFromInput, toRelativeWorkspacePath } from "../path-policy.js";
import {
  applyEditsToNormalizedContent,
  captureLineEndings,
  normalizeToLF,
  stripBom,
} from "../sessions/tools/edit-diff.js";
import { decodeTextFile } from "../sessions/tools/text-file-codec.js";
import {
  discardWriteJournalEntries,
  getWriteJournalEntriesForBatch,
  hashFileContent,
  journalEntryId,
  setWriteJournalBatchState,
  snapshotBeforeDelete,
  snapshotBeforeMove,
  snapshotPreparedWrite,
  undoWriteJournalEntries,
  updateWriteJournalAfterState,
  writeJournalRecoveryRef,
  type WriteJournalEntry,
} from "../tools/write-journal.js";
import {
  CODING_RUNTIME_EVENT_TYPES,
  CODING_RUNTIME_SCHEMA_VERSION,
  type AuditPage,
  type CodingAuditEvent,
  type CodingBatchState,
  type CodingEventFlags,
  type CodingFileCommitOutcome,
  type CodingMutation,
  type CodingMutationEvent,
  type CodingRollbackEvent,
  type CodingRollbackFileOutcome,
  type CodingRuntimeErrorCode,
  type CodingRuntimeError as CodingRuntimeErrorInfo,
  type CommitResult,
  type FileTransactionService as FileTransactionServiceContract,
  type FileVersion,
  type MutationPrepareOptions,
  type PreparedMutation,
  type RollbackResult,
} from "../../../../shared/coding-runtime/types.js";
import { assertCodingAuditEvent } from "../../../../shared/coding-runtime/schema.js";
import type { CodingAuditQuerySink } from "./audit-sink.js";
import { codingObservability } from "../../context-engine/coding-observability.js";
import { acquireCodingRuntimeFileLocks } from "./file-lock-manager.js";
import { buildVersionConflictDiff } from "./turn-diff.js";
import { CodingRuntimeError } from "./coding-runtime-error.js";
import { encodeAtomicText, writeFileAtomic } from "./atomic-write.js";
import { buildRollbackPreview } from "./rollback-preview.js";

export { CodingRuntimeError } from "./coding-runtime-error.js";

export class FileTransactionBatchRolledBackError extends Error {
  readonly batchState = "rolled_back";
  readonly files: CodingFileCommitOutcome[];
  readonly events: CodingMutationEvent[];
  readonly batchId: string;
  readonly mutationId: string;

  constructor(params: {
    batchId: string;
    mutationId: string;
    files: CodingFileCommitOutcome[];
    events: CodingMutationEvent[];
    cause?: unknown;
  }) {
    super(`File transaction ${params.batchId} failed and was rolled back`, {
      cause: params.cause,
    });
    this.name = "FileTransactionBatchRolledBackError";
    this.batchId = params.batchId;
    this.mutationId = params.mutationId;
    this.files = params.files;
    this.events = params.events;
  }
}

type ResolvedPath = {
  absPath: string;
  relPath: string;
};

type OptionalFileState = {
  exists: boolean;
  bytes?: Buffer;
  version?: FileVersion;
};

type PreparedFile = {
  kind: "write" | "edit" | "delete" | "move";
  path: ResolvedPath;
  before: OptionalFileState;
  afterBytes?: Buffer;
  afterExists?: boolean;
  destination?: ResolvedPath & {
    before: OptionalFileState;
  };
  journalEntries: WriteJournalEntry[];
};

type PreparedBatchInternal = {
  prepared: PreparedMutation;
  files: PreparedFile[];
  release: () => Promise<void>;
  applyPatch?: {
    batch: PreparedPatchBatch;
    fileOps: PatchFileOps;
  };
  toolName: string;
  flags?: CodingEventFlags;
};

type CommittedBatch = {
  internals: PreparedBatchInternal[];
  events: CodingMutationEvent[];
  committedAt: number;
};

function error(
  code: CodingRuntimeErrorCode,
  message: string,
  extra: Partial<CodingRuntimeErrorInfo> = {},
): CodingRuntimeError {
  return new CodingRuntimeError({ code, message, ...extra });
}

function isFileErrorCode(value: unknown, code: string): boolean {
  return (
    !!value &&
    typeof value === "object" &&
    "code" in value &&
    (value as { code?: unknown }).code === code
  );
}

function normalizeRel(root: string, absPath: string): string {
  return path.relative(root, absPath).split(path.sep).join("/");
}

function resolveWorkspaceFile(root: string, input: string): ResolvedPath {
  if (!input.trim()) {
    throw error("E_INVALID_MUTATION", "File path must not be empty");
  }
  const absPath = resolvePathFromInput(input, root);
  const rel = toRelativeWorkspacePath(root, absPath);
  return { absPath, relPath: rel.split(path.sep).join("/") };
}

async function readOptionalFile(root: string, absPath: string): Promise<OptionalFileState> {
  try {
    const stat = await fs.stat(absPath);
    if (!stat.isFile()) {
      throw error("E_INVALID_MUTATION", `Target is not a regular file: ${absPath}`, {
        path: absPath,
      });
    }
    const bytes = await fs.readFile(absPath);
    const relPath = normalizeRel(root, absPath);
    return {
      exists: true,
      bytes,
      version: {
        path: relPath,
        contentHash: hashFileContent(bytes),
        mtimeMs: stat.mtimeMs,
        size: stat.size,
      },
    };
  } catch (caught) {
    if (caught instanceof CodingRuntimeError) throw caught;
    if (isFileErrorCode(caught, "ENOENT")) {
      return { exists: false };
    }
    throw caught;
  }
}

function isUnrestoredPath(unrestored: string[], relPath: string): boolean {
  return unrestored.some((entry) => entry === relPath || entry.startsWith(`${relPath}:`));
}

function normalizeVersionPath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\//, "");
}

function baseVersionMismatch(expected: FileVersion, current: FileVersion | undefined): boolean {
  if (!current) return true;
  if (
    expected.path.trim() !== "" &&
    normalizeVersionPath(expected.path) !== normalizeVersionPath(current.path)
  ) {
    return true;
  }
  return (
    current.contentHash !== expected.contentHash ||
    current.mtimeMs !== expected.mtimeMs ||
    current.size !== expected.size
  );
}

function expectedBaseVersionFor(
  mutation: CodingMutation,
  options: MutationPrepareOptions,
): FileVersion | undefined {
  if (options.baseVersion) return options.baseVersion;
  if (
    mutation.kind === "write" ||
    mutation.kind === "edit" ||
    mutation.kind === "delete" ||
    mutation.kind === "move"
  ) {
    return mutation.baseVersion;
  }
  return undefined;
}

function conflictError(params: {
  path: string;
  baseVersion: FileVersion;
  currentVersion: FileVersion | undefined;
  currentText?: string;
}): CodingRuntimeError {
  const currentVersion = params.currentVersion
    ? { ...params.currentVersion, path: params.path }
    : undefined;
  return error("E_CONFLICT", `Base version changed for ${params.path}`, {
    path: params.path,
    baseVersion: params.baseVersion,
    ...(currentVersion ? { currentVersion } : {}),
    diff: buildVersionConflictDiff({
      path: params.path,
      baseVersion: params.baseVersion,
      currentVersion,
      ...(params.currentText !== undefined ? { currentText: params.currentText } : {}),
    }),
  });
}

function toAuditFileVersion(
  relPath: string,
  version: { contentHash: string; mtimeMs: number; size: number } | undefined,
): FileVersion | null {
  return version ? { path: relPath, ...version } : null;
}

function eventBase(params: {
  sessionId: string;
  requestId: string;
  toolName: string;
  workspaceRoot: string;
  flags?: CodingEventFlags;
}) {
  return {
    schemaVersion: CODING_RUNTIME_SCHEMA_VERSION,
    sessionId: params.sessionId,
    requestId: params.requestId,
    toolName: params.toolName,
    timestamp: Date.now(),
    workspaceRoot: params.workspaceRoot,
    ...(params.flags ? { flags: params.flags } : {}),
  };
}

function mutationEvent(params: {
  sessionId: string;
  requestId: string;
  toolName: string;
  workspaceRoot: string;
  flags?: CodingEventFlags;
  mutationId: string;
  batchId: string;
  mutation: CodingMutation;
  kind: CodingMutation["kind"];
  path: string;
  targetPath?: string;
  beforeVersion: FileVersion | null;
  afterVersion: FileVersion | null;
  hadPrior: boolean;
  bytesBefore: number;
  bytesAfter: number;
  phase: CodingMutationEvent["phase"];
  error?: string;
}): CodingMutationEvent {
  const event: CodingMutationEvent = {
    ...eventBase(params),
    eventId: `coding-mutation:${params.mutationId}:${randomUUID()}`,
    eventType: CODING_RUNTIME_EVENT_TYPES.MUTATION,
    path: params.path,
    beforeHash: params.beforeVersion?.contentHash ?? null,
    afterHash: params.afterVersion?.contentHash ?? null,
    phase: params.phase,
    mutationId: params.mutationId,
    batchId: params.batchId,
    kind: params.kind,
    mutation: params.mutation,
    hadPrior: params.hadPrior,
    bytesBefore: params.bytesBefore,
    bytesAfter: params.bytesAfter,
    beforeVersion: params.beforeVersion,
    afterVersion: params.afterVersion,
    ...(params.targetPath ? { targetPath: params.targetPath } : {}),
    ...(params.error ? { error: params.error } : {}),
  };
  assertCodingAuditEvent(event);
  return event;
}

function rollbackEvent(params: {
  sessionId: string;
  requestId: string;
  workspaceRoot: string;
  flags?: CodingEventFlags;
  batchId: string;
  status: CodingRollbackEvent["status"];
  preview: boolean;
  diff: string;
  files: CodingRollbackFileOutcome[];
  error?: string;
}): CodingRollbackEvent {
  const event: CodingRollbackEvent = {
    ...eventBase({ toolName: "rollback", ...params }),
    eventId: `coding-rollback:${params.batchId}:${randomUUID()}`,
    eventType: CODING_RUNTIME_EVENT_TYPES.ROLLBACK,
    batchId: params.batchId,
    rollbackId: randomUUID(),
    status: params.status,
    preview: params.preview,
    diff: params.diff,
    files: params.files,
    path: ".",
    beforeHash: null,
    afterHash: null,
    ...(params.error ? { error: params.error } : {}),
  };
  assertCodingAuditEvent(event);
  return event;
}

export type FileTransactionServiceOptions = {
  workspaceRoot?: string;
  sessionId?: string;
  /**
   * Test/sandbox seam for apply_patch file operations. The production local
   * path uses atomic writes; callers that override this keep the same P1
   * prepare/commit/rollback state machine.
   */
  applyPatchFileOps?: PatchFileOps;
  /**
   * P2 optimistic-concurrency guard. The service keeps the P1 opt-in behavior
   * for direct internal callers by default, but the production agent-tools
   * wiring passes the resolved `runtime.coding.uftk.baseVersionGuard.enabled`
   * flag here (default false) so no model-visible path changes default
   * behavior.
   */
  baseVersionGuardEnabled?: boolean;
  /**
   * P4 durable audit sink. When provided, committed/rolled-back mutation and
   * rollback events are written to this sink and `listAudit` delegates to it.
   * When absent, `listAudit` keeps the P1/P2/P3 fail-closed behavior.
   */
  auditLogSink?: CodingAuditQuerySink;
  /**
   * P6A concurrencyV2 gate. When enabled, commit performs a final CAS recheck
   * under the held write lock (E_CONFLICT + diff, zero mutation on mismatch)
   * and lock scheduling enables the P6A cross-process shared-read / barrier
   * semantics through the module-level lock flag. Default false.
   */
  concurrencyV2Enabled?: boolean;
};

export class FileTransactionService implements FileTransactionServiceContract {
  readonly #workspaceRoot?: string;
  readonly #sessionId?: string;
  readonly #applyPatchFileOps?: PatchFileOps;
  readonly #baseVersionGuardEnabled: boolean;
  readonly #concurrencyV2Enabled: boolean;
  readonly #auditLogSink?: CodingAuditQuerySink;
  readonly #prepared = new Map<string, PreparedBatchInternal>();
  readonly #committed = new Map<string, CommittedBatch>();

  constructor(options: FileTransactionServiceOptions = {}) {
    this.#applyPatchFileOps = options.applyPatchFileOps;
    this.#baseVersionGuardEnabled = options.baseVersionGuardEnabled ?? true;
    this.#concurrencyV2Enabled = options.concurrencyV2Enabled ?? false;
    this.#auditLogSink = options.auditLogSink;
    if (options.workspaceRoot) {
      this.#workspaceRoot = path.resolve(options.workspaceRoot);
    }
    if (options.sessionId?.trim()) {
      this.#sessionId = options.sessionId.trim();
    }
  }

  async prepare(
    mutation: CodingMutation,
    options: MutationPrepareOptions,
  ): Promise<PreparedMutation> {
    codingObservability.recordUftkPrepare();
    const workspaceRoot = path.resolve(options.workspaceRoot);
    const sessionId = options.sessionId.trim() || "default";
    const requestId = options.requestId.trim() || "unknown-request";
    const toolName = options.toolName?.trim() || mutation.kind;
    const batchId = options.batchId?.trim() || randomUUID();
    const mutationId = randomUUID();

    const prepared: PreparedMutation = {
      mutationId,
      batchId,
      sessionId,
      requestId,
      workspaceRoot,
      preparedAt: Date.now(),
      mutation,
      baseVersions: [],
      status: "prepared",
    };

    try {
      const internal = await this.#prepareInternal(mutation, {
        ...options,
        sessionId,
        requestId,
        toolName,
        batchId,
        workspaceRoot,
      });
      prepared.baseVersions = this.#collectBaseVersions(internal);
      internal.prepared = prepared;
      this.#prepared.set(mutationId, internal);
      return prepared;
    } catch (caught) {
      throw caught instanceof CodingRuntimeError
        ? caught
        : error("E_INVALID_MUTATION", caught instanceof Error ? caught.message : String(caught));
    }
  }

  async commit(prepared: PreparedMutation): Promise<CommitResult> {
    codingObservability.recordUftkCommit();
    const internal = this.#takePrepared(prepared);
    if (internal.applyPatch) {
      return this.#commitApplyPatch(internal);
    }
    return this.#commitFiles(internal);
  }

  /**
   * apply_patch-specific commit that also returns the existing tool summary
   * shape, so the producer envelope and patch text stay byte-compatible.
   */
  async commitApplyPatch(
    prepared: PreparedMutation,
  ): Promise<
    CommitResult & {
      tool: {
        text: string;
        modifiedFiles: string[];
        journalEntries: WriteJournalEntry[];
      };
    }
  > {
    const result = await this.commit(prepared);
    const group = this.#committed.get(prepared.batchId);
    const internal = group?.internals.find((candidate) => candidate.applyPatch);
    if (!internal?.applyPatch || result.status === "recovery_required") {
      return { ...result, tool: { text: result.error ?? "", modifiedFiles: [], journalEntries: [] } };
    }
    const evidence = this.writeJournalEvidence(prepared);
    const modifiedFiles = result.files.map((file) => file.path);
    const added = result.files
      .filter((file) => file.beforeVersion === null && file.afterVersion !== null)
      .map((file) => file.path);
    const deleted = result.files
      .filter((file) => file.beforeVersion !== null && file.afterVersion === null)
      .map((file) => file.path);
    const modified = result.files
      .filter((file) => file.beforeVersion !== null && file.afterVersion !== null)
      .map((file) => file.path);
    const text = ["Success. Updated the following files:"]
      .concat(added.map((file) => `A ${file}`))
      .concat(modified.map((file) => `M ${file}`))
      .concat(deleted.map((file) => `D ${file}`))
      .join("\n");
    return {
      ...result,
      tool: {
        text,
        modifiedFiles,
        journalEntries: evidence?.snapshots
          ? internal.applyPatch.batch.journalEntries
          : [],
      },
    };
  }

  async rollback(batchId: string, options: { preview?: boolean } = {}): Promise<RollbackResult> {
    codingObservability.recordUftkRollback();
    const root = this.#workspaceRoot;
    const sessionId = this.#sessionId ?? "default";
    if (!root) {
      throw error("E_NOT_PREPARED", "FileTransactionService has no workspaceRoot for rollback");
    }
    const committed = this.#committed.get(batchId);
    const entries =
      committed?.internals.flatMap((internal) =>
        internal.applyPatch?.batch.journalEntries ?? internal.files.flatMap((file) => file.journalEntries),
      ) ?? getWriteJournalEntriesForBatch(root, sessionId, batchId);
    if (entries.length === 0) {
      throw error("E_NOT_PREPARED", `No journal entries found for batch ${batchId}`, { batchId });
    }

    const preview = await buildRollbackPreview(entries).catch((caught: unknown) => ({
      diff: "",
      files: entries.map((entry) => ({
        path: entry.relPath,
        status: entry.hadPrior ? ("restored" as const) : ("removed" as const),
        beforeHash: null,
        afterHash: null,
        ...(caught instanceof Error ? { error: caught.message } : {}),
      })),
    }));
    if (options.preview === true) {
      return {
        batchId,
        status: "rolled_back",
        preview: true,
        diff: preview.diff,
        files: preview.files,
        events: [],
      };
    }

    const outcome = undoWriteJournalEntries({ workspaceRoot: root, sessionId, entries });
    const fallbackFiles = preview.files.map((file) => ({
      ...file,
      ...(outcome.restored.includes(file.path) ? {} : { status: "restore_failed" as const, error: outcome.errors.join("; ") }),
    }));
    if (outcome.errors.length > 0) {
      const retainedEntries = getWriteJournalEntriesForBatch(root, sessionId, batchId);
      const rollbackResult: RollbackResult = {
        batchId,
        status: "recovery_required",
        preview: false,
        diff: preview.diff,
        files: fallbackFiles,
        events: [
          rollbackEvent({
            sessionId: committed?.internals[0]?.prepared.sessionId ?? sessionId,
            requestId: committed?.internals[0]?.prepared.requestId ?? "rollback",
            workspaceRoot: root,
            flags: committed?.internals[0]?.flags,
            batchId,
            status: "recovery_required",
            preview: false,
            diff: preview.diff,
            files: fallbackFiles,
            error: outcome.errors.join("; "),
          }),
        ],
        error: outcome.errors.join("; "),
        ...(retainedEntries.length > 0
          ? {
              recoveryRef:
                writeJournalRecoveryRef(retainedEntries) ??
                `journal:${getWriteJournalEntriesForBatch(root, sessionId, batchId).length}`,
            }
          : {}),
      };
      this.#writeAuditEvents(rollbackResult.events);
      return rollbackResult;
    }

    this.#committed.delete(batchId);
    const event = rollbackEvent({
      sessionId: committed?.internals[0]?.prepared.sessionId ?? sessionId,
      requestId: committed?.internals[0]?.prepared.requestId ?? "rollback",
      workspaceRoot: root,
      flags: committed?.internals[0]?.flags,
      batchId,
      status: "rolled_back",
      preview: false,
      diff: preview.diff,
      files: preview.files,
    });
    const rollbackResult: RollbackResult = {
      batchId,
      status: "rolled_back",
      preview: false,
      diff: preview.diff,
      files: preview.files,
      events: [event],
    };
    this.#writeAuditEvents(rollbackResult.events);
    return rollbackResult;
  }

  async previewRollback(batchId: string): Promise<RollbackResult> {
    return this.rollback(batchId, { preview: true });
  }

  async listAudit(
    sessionId: string,
    query: Parameters<FileTransactionServiceContract["listAudit"]>[1],
  ): Promise<AuditPage<CodingAuditEvent>> {
    if (this.#auditLogSink) {
      return await this.#auditLogSink.query(sessionId, query);
    }
    throw error(
      "E_AUDIT_WRITE_FAILED",
      "Audit storage (JSONL + SQLite) is unavailable. listAudit is intentionally fail-closed when no P4 durable audit sink is configured, instead of returning an empty page.",
    );
  }

  /** Internal tool-facing evidence; not part of the P0 service contract. */
  writeJournalEvidence(prepared: PreparedMutation): {
    batchId: string;
    batchState: CodingBatchState;
    undoable: boolean;
    snapshots: Array<{ seq: number; journalEntryId: string; path: string; hadPrior: boolean }>;
  } | undefined {
    const committedGroup = this.#committed.get(prepared.batchId);
    const internals = committedGroup?.internals ?? (this.#prepared.get(prepared.mutationId) ? [this.#prepared.get(prepared.mutationId)!] : []);
    const entries = internals.flatMap((internal) =>
      internal.applyPatch?.batch.journalEntries ?? internal.files.flatMap((f) => f.journalEntries),
    );
    const first = entries[0];
    if (!first) return undefined;
    const batchState = first.batch?.state ?? "committed";
    return {
      batchId: prepared.batchId,
      batchState,
      undoable: batchState === "committed" || batchState === "recovery_required",
      snapshots: entries.map((entry) => ({
        seq: entry.seq,
        journalEntryId: journalEntryId(entry.lineage?.sessionId ?? "default", entry.seq),
        path: entry.relPath,
        hadPrior: entry.hadPrior,
      })),
    };
  }

  async #prepareInternal(
    mutation: CodingMutation,
    options: MutationPrepareOptions & {
      sessionId: string;
      requestId: string;
      toolName: string;
      batchId: string;
      workspaceRoot: string;
    },
  ): Promise<PreparedBatchInternal> {
    if (mutation.kind === "apply_patch") {
      return this.#prepareApplyPatch(mutation, options);
    }

    const batch: WriteJournalEntry["batch"] = { id: options.batchId, state: "prepared" };
    const root = options.workspaceRoot;

    if (mutation.kind === "write") {
      const target = resolveWorkspaceFile(root, mutation.path);
      const release = (
        await acquireCodingRuntimeFileLocks([target.absPath], {
          mode: "write",
          owner: `${options.toolName}:${options.sessionId}`,
        })
      ).release;
      try {
        const before = await readOptionalFile(root, target.absPath);
        const expectedBaseVersion = expectedBaseVersionFor(mutation, options);
        if (
          this.#baseVersionGuardEnabled &&
          expectedBaseVersion &&
          baseVersionMismatch(expectedBaseVersion, before.version)
        ) {
          throw conflictError({
            path: target.relPath,
            baseVersion: expectedBaseVersion,
            currentVersion: before.version,
            ...(before.bytes ? { currentText: before.bytes.toString("utf8") } : {}),
          });
        }
        const afterBytes = Buffer.from(mutation.content, "utf8");
        const entry = snapshotPreparedWrite({
          workspaceRoot: root,
          sessionId: options.sessionId,
          filePath: target.absPath,
          toolName: options.toolName,
          kind: "write",
          requestId: options.requestId,
          flags: options.flags,
          batch,
          hadPrior: before.exists,
          ...(before.bytes ? { priorContent: before.bytes } : {}),
          ...(before.version
            ? { beforeStat: { mtimeMs: before.version.mtimeMs, size: before.version.size } }
            : {}),
        });
        if (!entry) {
          throw error("E_AUDIT_WRITE_FAILED", `Failed to snapshot ${target.relPath}`, {
            path: target.relPath,
          });
        }
        return {
          prepared: {} as PreparedMutation,
          files: [
            {
              kind: "write",
              path: target,
              before,
              afterBytes,
              journalEntries: [entry],
            },
          ],
          release,
          toolName: options.toolName,
          flags: options.flags,
        };
      } catch (caught) {
        await release();
        throw caught;
      }
    }

    if (mutation.kind === "edit") {
      const target = resolveWorkspaceFile(root, mutation.path);
      const release = (
        await acquireCodingRuntimeFileLocks([target.absPath], {
          mode: "write",
          owner: `${options.toolName}:${options.sessionId}`,
        })
      ).release;
      try {
        const before = await readOptionalFile(root, target.absPath);
        if (!before.exists || !before.bytes) {
          throw error("E_INVALID_MUTATION", `Cannot edit missing file ${target.relPath}`, {
            path: target.relPath,
          });
        }
        const expectedBaseVersion = expectedBaseVersionFor(mutation, options);
        if (
          this.#baseVersionGuardEnabled &&
          expectedBaseVersion &&
          baseVersionMismatch(expectedBaseVersion, before.version)
        ) {
          throw conflictError({
            path: target.relPath,
            baseVersion: expectedBaseVersion,
            currentVersion: before.version,
            currentText: before.bytes.toString("utf8"),
          });
        }
        const decoded = decodeTextFile(before.bytes, target.relPath);
        const { text: content } = stripBom(decoded.text);
        const originalEndings = captureLineEndings(content);
        const normalized = normalizeToLF(content);
        const { newContent } = applyEditsToNormalizedContent(
          normalized,
          mutation.edits.map((edit) => ({ oldText: edit.oldText, newText: edit.newText })),
          target.relPath,
        );
        const afterBytes = encodeAtomicText(newContent, {
          encoding: decoded.encoding,
          lineEndings: originalEndings,
        });
        const entry = snapshotPreparedWrite({
          workspaceRoot: root,
          sessionId: options.sessionId,
          filePath: target.absPath,
          toolName: options.toolName,
          kind: "edit",
          requestId: options.requestId,
          flags: options.flags,
          batch,
          hadPrior: true,
          priorContent: before.bytes,
          beforeStat: { mtimeMs: before.version!.mtimeMs, size: before.version!.size },
        });
        if (!entry) {
          throw error("E_AUDIT_WRITE_FAILED", `Failed to snapshot ${target.relPath}`, {
            path: target.relPath,
          });
        }
        return {
          prepared: {} as PreparedMutation,
          files: [{ kind: "edit", path: target, before, afterBytes, journalEntries: [entry] }],
          release,
          toolName: options.toolName,
          flags: options.flags,
        };
      } catch (caught) {
        await release();
        throw caught;
      }
    }

    if (mutation.kind === "delete") {
      const target = resolveWorkspaceFile(root, mutation.path);
      const release = (
        await acquireCodingRuntimeFileLocks([target.absPath], {
          mode: "write",
          owner: `${options.toolName}:${options.sessionId}`,
        })
      ).release;
      try {
        const before = await readOptionalFile(root, target.absPath);
        if (!before.exists) {
          throw error("E_INVALID_MUTATION", `Cannot delete missing file ${target.relPath}`, {
            path: target.relPath,
          });
        }
        const expectedBaseVersion = expectedBaseVersionFor(mutation, options);
        if (
          this.#baseVersionGuardEnabled &&
          expectedBaseVersion &&
          baseVersionMismatch(expectedBaseVersion, before.version)
        ) {
          throw conflictError({
            path: target.relPath,
            baseVersion: expectedBaseVersion,
            currentVersion: before.version,
            ...(before.bytes ? { currentText: before.bytes.toString("utf8") } : {}),
          });
        }
        const entry = snapshotBeforeDelete({
          workspaceRoot: root,
          sessionId: options.sessionId,
          filePath: target.absPath,
          toolName: options.toolName,
          requestId: options.requestId,
          flags: options.flags,
          batch,
        });
        if (!entry) {
          throw error("E_AUDIT_WRITE_FAILED", `Failed to snapshot ${target.relPath}`, {
            path: target.relPath,
          });
        }
        return {
          prepared: {} as PreparedMutation,
          files: [
            { kind: "delete", path: target, before, afterExists: false, journalEntries: [entry] },
          ],
          release,
          toolName: options.toolName,
          flags: options.flags,
        };
      } catch (caught) {
        await release();
        throw caught;
      }
    }

    const source = resolveWorkspaceFile(root, mutation.from);
    const destination = resolveWorkspaceFile(root, mutation.to);
    const release = (
      await acquireCodingRuntimeFileLocks([source.absPath, destination.absPath], {
        mode: "write",
        owner: `${options.toolName}:${options.sessionId}`,
      })
    ).release;
    try {
      const before = await readOptionalFile(root, source.absPath);
      if (!before.exists || !before.bytes) {
        throw error("E_INVALID_MUTATION", `Cannot move missing file ${source.relPath}`, {
          path: source.relPath,
        });
      }
      const expectedBaseVersion = expectedBaseVersionFor(mutation, options);
      if (
        this.#baseVersionGuardEnabled &&
        expectedBaseVersion &&
        baseVersionMismatch(expectedBaseVersion, before.version)
      ) {
        throw conflictError({
          path: source.relPath,
          baseVersion: expectedBaseVersion,
          currentVersion: before.version,
          currentText: before.bytes.toString("utf8"),
        });
      }
      const destinationBefore = await readOptionalFile(root, destination.absPath);
      if (destinationBefore.exists && mutation.overwrite === false) {
        throw error("E_INVALID_MUTATION", `Move destination exists and overwrite is false: ${destination.relPath}`);
      }
      const entries = snapshotBeforeMove({
        workspaceRoot: root,
        sessionId: options.sessionId,
        sourcePath: source.absPath,
        destinationPath: destination.absPath,
        toolName: options.toolName,
        requestId: options.requestId,
        flags: options.flags,
        batch,
      });
      if (!entries) {
        throw error("E_AUDIT_WRITE_FAILED", `Failed to snapshot move ${source.relPath} -> ${destination.relPath}`);
      }
      return {
        prepared: {} as PreparedMutation,
        files: [
          {
            kind: "move",
            path: source,
            before,
            destination: { ...destination, before: destinationBefore },
            journalEntries: entries,
          },
        ],
        release,
        toolName: options.toolName,
        flags: options.flags,
      };
    } catch (caught) {
      await release();
      throw caught;
    }
  }

  async #prepareApplyPatch(
    mutation: Extract<CodingMutation, { kind: "apply_patch" }>,
    options: MutationPrepareOptions & {
      sessionId: string;
      requestId: string;
      toolName: string;
      batchId: string;
      workspaceRoot: string;
    },
  ): Promise<PreparedBatchInternal> {
    const { parsePatchText } = await import("../apply-patch.js");
    const parsed = parsePatchText(mutation.input);
    if (parsed.hunks.length === 0) {
      throw new Error("No files were modified.");
    }
    const root = options.workspaceRoot;
    const fileOps: PatchFileOps =
      this.#applyPatchFileOps ??
      {
        exists: async (filePath) => {
          try {
            return (await fs.stat(filePath)).isFile();
          } catch (caught) {
            if (isFileErrorCode(caught, "ENOENT")) return false;
            throw caught;
          }
        },
        readFile: async (filePath) => decodeTextFile(await fs.readFile(filePath), filePath),
        stat: async (filePath) => {
          try {
            const fileStat = await fs.stat(filePath);
            return fileStat.isFile()
              ? { mtimeMs: fileStat.mtimeMs, size: fileStat.size }
              : null;
          } catch (caught) {
            if (isFileErrorCode(caught, "ENOENT")) return null;
            throw caught;
          }
        },
        writeFile: async (filePath, content) => writeFileAtomic(filePath, content),
        remove: async (filePath) => fs.rm(filePath),
        mkdirp: async (dir) => {
          await fs.mkdir(dir, { recursive: true });
        },
      };
    const batch = await preflightPatch(
      parsed.hunks,
      {
        journal: {
          workspaceRoot: root,
          sessionId: options.sessionId,
          enabled: true,
          requestId: options.batchId,
          flags: options.flags,
        },
        ...(this.#baseVersionGuardEnabled && mutation.baseVersions?.length
          ? { baseVersions: mutation.baseVersions }
          : {}),
      } satisfies ApplyPatchBatchOptions,
      fileOps,
      {
        resolvePath: async (filePath) => {
          const resolved = resolvePathFromInput(filePath, root);
          const rel = toRelativeWorkspacePath(root, resolved);
          return { resolved, display: rel.split(path.sep).join("/") };
        },
        assertParentPath: async (filePath) => {
          const resolved = resolvePathFromInput(filePath, root);
          const parent = path.dirname(resolved);
          if (parent && parent !== ".") {
            toRelativeWorkspacePath(root, parent, { allowRoot: true });
          }
        },
      },
    );
    if (batch.journalEntries.length !== batch.originals.size) {
      discardWriteJournalEntries(batch.journalEntries);
      batch.release();
      throw error(
        "E_AUDIT_WRITE_FAILED",
        `apply_patch journal snapshot incomplete (${batch.journalEntries.length}/${batch.originals.size})`,
      );
    }
    return {
      prepared: {} as PreparedMutation,
      files: [],
      release: async () => {
        batch.release();
      },
      applyPatch: { batch, fileOps },
      toolName: options.toolName,
      flags: options.flags,
    };
  }

  #collectBaseVersions(internal: PreparedBatchInternal): FileVersion[] {
    if (internal.applyPatch) {
      return internal.applyPatch.batch.journalEntries
        .map((entry) => toAuditFileVersion(entry.relPath, entry.beforeVersion))
        .filter((version): version is FileVersion => version !== null);
    }
    const versions: FileVersion[] = [];
    for (const file of internal.files) {
      if (file.before.version) versions.push(file.before.version);
      if (file.destination?.before.version) versions.push(file.destination.before.version);
    }
    return versions;
  }

  /**
   * P6A: commit-time CAS recheck inside the already-held write lock. Re-reads
   * every target and compares against the version captured at prepare. If the
   * file changed (a cross-process writer slipped through, or an external edit
   * raced the sidecar), it returns a structured E_CONFLICT with the diff and
   * leaves targets zero-changed by refusing to apply anything.
   */
  async #recheckCommitCas(internal: PreparedBatchInternal): Promise<void> {
    if (!this.#baseVersionGuardEnabled || !this.#concurrencyV2Enabled) return;
    if (internal.applyPatch) return;
    const root = internal.prepared.workspaceRoot;
    for (const file of internal.files) {
      if (file.before.version) {
        const current = await readOptionalFile(root, file.path.absPath);
        if (baseVersionMismatch(file.before.version, current.version)) {
          throw conflictError({
            path: file.path.relPath,
            baseVersion: file.before.version,
            currentVersion: current.version,
            ...(current.bytes ? { currentText: current.bytes.toString("utf8") } : {}),
          });
        }
      }
      if (file.destination?.before.version) {
        const current = await readOptionalFile(root, file.destination.absPath);
        if (baseVersionMismatch(file.destination.before.version, current.version)) {
          throw conflictError({
            path: file.destination.relPath,
            baseVersion: file.destination.before.version,
            currentVersion: current.version,
            ...(current.bytes ? { currentText: current.bytes.toString("utf8") } : {}),
          });
        }
      }
    }
  }

  #writeAuditEvents(events: readonly CodingAuditEvent[]): void {
    if (!this.#auditLogSink) return;
    for (const event of events) {
      // Events are built through assertCodingAuditEvent, so this is the
      // P4 schema-validated unified sink write path.
      this.#auditLogSink.write(event);
    }
  }

  #addCommitted(batchId: string, internal: PreparedBatchInternal, events: CodingMutationEvent[]): void {
    const existing = this.#committed.get(batchId);
    if (existing) {
      existing.internals.push(internal);
      existing.events.push(...events);
      existing.committedAt = Date.now();
      return;
    }
    this.#committed.set(batchId, { internals: [internal], events, committedAt: Date.now() });
  }

  #takePrepared(prepared: PreparedMutation): PreparedBatchInternal {
    const internal = this.#prepared.get(prepared.mutationId);
    if (!internal) {
      throw error("E_NOT_PREPARED", `No prepared mutation ${prepared.mutationId}`);
    }
    if (internal.prepared.status !== "prepared") {
      throw error("E_BATCH_STATE", `Mutation ${prepared.mutationId} is not prepared`);
    }
    this.#prepared.delete(prepared.mutationId);
    return internal;
  }

  async #commitFiles(internal: PreparedBatchInternal): Promise<CommitResult> {
    const prepared = internal.prepared;
    const applied: PreparedFile[] = [];
    try {
      // P6A: commit-time CAS recheck before touching any file so a stale
      // baseVersion yields E_CONFLICT with zero applied mutations.
      await this.#recheckCommitCas(internal);
      for (const file of internal.files) {
        await this.#applyFile(file);
        applied.push(file);
        if (!this.#recordAfterState(file)) {
          throw error("E_AUDIT_WRITE_FAILED", `Failed to persist journal after-state for ${file.path.relPath}`);
        }
      }
      const entries = internal.files.flatMap((file) => file.journalEntries);
      if (!setWriteJournalBatchState(entries, "committed")) {
        throw error("E_AUDIT_WRITE_FAILED", `Failed to persist committed batch ${prepared.batchId}`);
      }
      const events = await this.#buildFileMutationEvents(internal, "committed");
      this.#writeAuditEvents(events);
      const files = await this.#buildFileCommitOutcomes(internal, "committed");
      const result: CommitResult = {
        mutationId: prepared.mutationId,
        batchId: prepared.batchId,
        status: "committed",
        files,
        events,
      };
      this.#addCommitted(prepared.batchId, internal, events);
      return result;
    } catch (caught) {
      const failure = caught instanceof Error ? caught : new Error(String(caught));
      const rollbackFiles = await this.#rollbackFiles(applied);
      const entries = internal.files.flatMap((file) => file.journalEntries);
      const phase: CodingMutationEvent["phase"] =
        rollbackFiles.length === 0 ? "rolled_back" : "recovery_required";
      const events = await this.#buildFileMutationEvents(
        internal,
        phase,
        rollbackFiles.length === 0 ? undefined : rollbackFiles.join("; "),
      );
      this.#writeAuditEvents(events);
      const files = await this.#buildFileCommitOutcomes(
        internal,
        rollbackFiles.length === 0 ? "rolled_back" : "recovery_required",
        rollbackFiles,
      );

      if (rollbackFiles.length > 0) {
        setWriteJournalBatchState(entries, "recovery_required");
        const result: CommitResult = {
          mutationId: prepared.mutationId,
          batchId: prepared.batchId,
          status: "recovery_required",
          files,
          events,
          error: `Commit failed and rollback was incomplete: ${failure.message}`,
          recoveryRef:
            writeJournalRecoveryRef(entries) ?? `unrestored:${rollbackFiles.join(",")}`,
        };
        this.#addCommitted(prepared.batchId, internal, events);
        return result;
      }

      setWriteJournalBatchState(entries, "rolled_back");
      discardWriteJournalEntries(entries);
      throw new FileTransactionBatchRolledBackError({
        batchId: prepared.batchId,
        mutationId: prepared.mutationId,
        files,
        events,
        cause: failure,
      });
    } finally {
      await internal.release();
    }
  }

  async #commitApplyPatch(internal: PreparedBatchInternal): Promise<CommitResult> {
    const prepared = internal.prepared;
    const patch = internal.applyPatch!;
    const result = await applyPreparedBatch(patch.batch, {}, patch.fileOps);
    if (result.batchState === "prepared") {
      throw error("E_BATCH_STATE", `apply_patch batch ${prepared.batchId} never left prepared state`);
    }
    const batchState = result.batchState;
    const errorText = batchState === "committed" ? undefined : result.text;
    const events = await this.#buildApplyPatchEvents(internal, batchState, errorText);
    this.#writeAuditEvents(events);
    const files = await this.#buildApplyPatchOutcomes(internal, batchState);

    if (batchState === "committed") {
      const commit: CommitResult = {
        mutationId: prepared.mutationId,
        batchId: prepared.batchId,
        status: "committed",
        files,
        events,
      };
      this.#addCommitted(prepared.batchId, internal, events);
      return commit;
    }

    if (batchState === "recovery_required") {
      const commit: CommitResult = {
        mutationId: prepared.mutationId,
        batchId: prepared.batchId,
        status: "recovery_required",
        files,
        events,
        error: result.text,
        ...(result.recoveryRef ? { recoveryRef: result.recoveryRef } : {}),
      };
      this.#addCommitted(prepared.batchId, internal, events);
      return commit;
    }

    throw new FileTransactionBatchRolledBackError({
      batchId: prepared.batchId,
      mutationId: prepared.mutationId,
      files,
      events,
      cause: new Error(result.text),
    });
  }

  async #applyFile(file: PreparedFile): Promise<void> {
    switch (file.kind) {
      case "write":
      case "edit": {
        await fs.mkdir(path.dirname(file.path.absPath), { recursive: true });
        await writeFileAtomic(file.path.absPath, file.afterBytes!);
        return;
      }
      case "delete": {
        await fs.rm(file.path.absPath);
        return;
      }
      case "move": {
        const destination = file.destination!;
        await fs.mkdir(path.dirname(destination.absPath), { recursive: true });
        // Node's rename maps to MoveFileExW(MOVEFILE_REPLACE_EXISTING) on
        // Windows. If it cannot replace the destination atomically, fail
        // closed and let rollback restore the journaled pre-images.
        await fs.rename(file.path.absPath, destination.absPath);
        return;
      }
    }
  }

  #recordAfterState(file: PreparedFile): boolean {
    const sourceEntry = file.journalEntries.find((entry) => entry.absPath === file.path.absPath);
    const destinationEntry = file.destination
      ? file.journalEntries.find((entry) => entry.absPath === file.destination!.absPath)
      : undefined;
    if (!sourceEntry) return false;
    if (file.kind === "move") {
      if (!destinationEntry) return false;
      const sourceAfter = updateWriteJournalAfterState({
        entry: sourceEntry,
        afterExists: false,
      });
      const destinationAfter = updateWriteJournalAfterState({
        entry: destinationEntry,
        afterPath: file.destination!.absPath,
        afterContent: file.before.bytes!,
      });
      return sourceAfter && destinationAfter;
    }
    if (file.kind === "delete") {
      return updateWriteJournalAfterState({ entry: sourceEntry, afterExists: false });
    }
    return updateWriteJournalAfterState({
      entry: sourceEntry,
      afterPath: file.path.absPath,
      afterContent: file.afterBytes!,
    });
  }

  async #rollbackFiles(files: PreparedFile[]): Promise<string[]> {
    const unrestored: string[] = [];
    for (const file of [...files].reverse()) {
      try {
        if (file.kind === "move" && file.destination) {
          const destination = file.destination;
          if (destination.before.exists && destination.before.bytes) {
            await fs.mkdir(path.dirname(destination.absPath), { recursive: true });
            await writeFileAtomic(destination.absPath, destination.before.bytes);
          } else {
            await fs.rm(destination.absPath, { force: true });
          }
          if (file.before.exists && file.before.bytes) {
            await fs.mkdir(path.dirname(file.path.absPath), { recursive: true });
            await writeFileAtomic(file.path.absPath, file.before.bytes);
          } else {
            await fs.rm(file.path.absPath, { force: true });
          }
          continue;
        }
        if (file.before.exists && file.before.bytes) {
          await fs.mkdir(path.dirname(file.path.absPath), { recursive: true });
          await writeFileAtomic(file.path.absPath, file.before.bytes);
        } else {
          await fs.rm(file.path.absPath, { force: true });
        }
      } catch (caught) {
        unrestored.push(`${file.path.relPath}: ${caught instanceof Error ? caught.message : String(caught)}`);
      }
    }
    return unrestored;
  }

  async #buildFileMutationEvents(
    internal: PreparedBatchInternal,
    phase: CodingMutationEvent["phase"],
    errorText?: string,
  ): Promise<CodingMutationEvent[]> {
    const events: CodingMutationEvent[] = [];
    for (const file of internal.files) {
      const afterState = await readOptionalFile(internal.prepared.workspaceRoot, file.path.absPath);
      const beforeVersion =
        file.before.version ??
        toAuditFileVersion(file.path.relPath, file.journalEntries[0]?.beforeVersion);
      if (file.kind === "move" && file.destination) {
        const destinationAfter = await readOptionalFile(
          internal.prepared.workspaceRoot,
          file.destination.absPath,
        );
        const destinationBefore =
          file.destination.before.version ??
          toAuditFileVersion(
            file.destination.relPath,
            file.journalEntries[1]?.beforeVersion,
          );
        events.push(
          mutationEvent({
            sessionId: internal.prepared.sessionId,
            requestId: internal.prepared.requestId,
            toolName: internal.toolName,
            workspaceRoot: internal.prepared.workspaceRoot,
            flags: internal.flags,
            mutationId: internal.prepared.mutationId,
            batchId: internal.prepared.batchId,
            mutation: internal.prepared.mutation,
            kind: "move",
            path: file.path.relPath,
            targetPath: file.destination.relPath,
            beforeVersion,
            afterVersion: phase === "rolled_back" ? beforeVersion : null,
            hadPrior: true,
            bytesBefore: beforeVersion?.size ?? file.before.bytes?.byteLength ?? 0,
            bytesAfter: phase === "rolled_back" ? beforeVersion?.size ?? 0 : 0,
            phase,
            ...(errorText ? { error: errorText } : {}),
          }),
        );
        events.push(
          mutationEvent({
            sessionId: internal.prepared.sessionId,
            requestId: internal.prepared.requestId,
            toolName: internal.toolName,
            workspaceRoot: internal.prepared.workspaceRoot,
            flags: internal.flags,
            mutationId: internal.prepared.mutationId,
            batchId: internal.prepared.batchId,
            mutation: internal.prepared.mutation,
            kind: "move",
            path: file.destination.relPath,
            beforeVersion: destinationBefore,
            afterVersion:
              phase === "rolled_back"
                ? destinationBefore
                : destinationAfter.version ?? null,
            hadPrior: file.destination.before.exists,
            bytesBefore: destinationBefore?.size ?? 0,
            bytesAfter:
              phase === "rolled_back"
                ? destinationBefore?.size ?? 0
                : destinationAfter.version?.size ?? 0,
            phase,
            ...(errorText ? { error: errorText } : {}),
          }),
        );
        continue;
      }

      events.push(
        mutationEvent({
          sessionId: internal.prepared.sessionId,
          requestId: internal.prepared.requestId,
          toolName: internal.toolName,
          workspaceRoot: internal.prepared.workspaceRoot,
          flags: internal.flags,
          mutationId: internal.prepared.mutationId,
          batchId: internal.prepared.batchId,
          mutation: internal.prepared.mutation,
          kind: file.kind,
          path: file.path.relPath,
          beforeVersion,
          afterVersion:
            phase === "rolled_back" ? beforeVersion : afterState.version ?? null,
          hadPrior: file.before.exists,
          bytesBefore: beforeVersion?.size ?? file.before.bytes?.byteLength ?? 0,
          bytesAfter:
            phase === "rolled_back"
              ? beforeVersion?.size ?? 0
              : afterState.version?.size ?? 0,
          phase,
          ...(errorText ? { error: errorText } : {}),
        }),
      );
    }
    return events;
  }

  async #buildFileCommitOutcomes(
    internal: PreparedBatchInternal,
    status: CodingFileCommitOutcome["status"],
    unrestored: string[] = [],
  ): Promise<CodingFileCommitOutcome[]> {
    const files: CodingFileCommitOutcome[] = [];
    for (const file of internal.files) {
      const afterState = await readOptionalFile(internal.prepared.workspaceRoot, file.path.absPath);
      const beforeVersion = file.before.version ?? null;
      if (file.kind === "move" && file.destination) {
        const destinationAfter = await readOptionalFile(
          internal.prepared.workspaceRoot,
          file.destination.absPath,
        );
        files.push({
          path: file.path.relPath,
          targetPath: file.destination.relPath,
          status: isUnrestoredPath(unrestored, file.path.relPath) ? "recovery_required" : status,
          beforeVersion,
          afterVersion: status === "rolled_back" ? beforeVersion : null,
          ...(isUnrestoredPath(unrestored, file.path.relPath) ? { error: "restore failed" } : {}),
        });
        files.push({
          path: file.destination.relPath,
          status: isUnrestoredPath(unrestored, file.destination.relPath) ? "recovery_required" : status,
          beforeVersion: file.destination.before.version ?? null,
          afterVersion:
            status === "rolled_back"
              ? file.destination.before.version ?? null
              : destinationAfter.version ?? null,
        });
        continue;
      }
      files.push({
        path: file.path.relPath,
        status: isUnrestoredPath(unrestored, file.path.relPath) ? "recovery_required" : status,
        beforeVersion,
        afterVersion: status === "rolled_back" ? beforeVersion : afterState.version ?? null,
        ...(isUnrestoredPath(unrestored, file.path.relPath) ? { error: "restore failed" } : {}),
      });
    }
    return files;
  }

  async #buildApplyPatchEvents(
    internal: PreparedBatchInternal,
    batchState: Extract<CodingBatchState, "committed" | "rolled_back" | "recovery_required">,
    errorText?: string,
  ): Promise<CodingMutationEvent[]> {
    const batch = internal.applyPatch!.batch;
    const events: CodingMutationEvent[] = [];
    for (const original of batch.originals.values()) {
      const entry = batch.journalEntries.find((candidate) => candidate.absPath === original.resolvedPath);
      const beforeVersion =
        toAuditFileVersion(entry?.relPath ?? original.displayPath, entry?.beforeVersion) ??
        null;
      const afterState = await readOptionalFile(
        internal.prepared.workspaceRoot,
        original.resolvedPath,
      );
      const hadPrior = original.existed;
      events.push(
        mutationEvent({
          sessionId: internal.prepared.sessionId,
          requestId: internal.prepared.requestId,
          toolName: internal.toolName,
          workspaceRoot: internal.prepared.workspaceRoot,
          flags: internal.flags,
          mutationId: internal.prepared.mutationId,
          batchId: internal.prepared.batchId,
          mutation: internal.prepared.mutation,
          kind: "apply_patch",
          path: entry?.relPath ?? original.displayPath,
          targetPath: this.#moveTargetForPath(batch, original.resolvedPath),
          beforeVersion,
          afterVersion: batchState === "committed" ? afterState.version ?? null : beforeVersion,
          hadPrior,
          bytesBefore: beforeVersion?.size ?? 0,
          bytesAfter: batchState === "committed" ? afterState.version?.size ?? 0 : beforeVersion?.size ?? 0,
          phase: batchState,
          ...(errorText ? { error: errorText } : {}),
        }),
      );
    }
    return events;
  }

  #moveTargetForPath(batch: PreparedPatchBatch, absPath: string): string | undefined {
    for (const hunk of batch.hunks) {
      if (hunk.kind === "update" && hunk.moveTarget && hunk.target.resolvedPath === absPath) {
        return hunk.moveTarget.displayPath.split(path.sep).join("/");
      }
    }
    return undefined;
  }

  async #buildApplyPatchOutcomes(
    internal: PreparedBatchInternal,
    batchState: Extract<CodingBatchState, "committed" | "rolled_back" | "recovery_required">,
  ): Promise<CodingFileCommitOutcome[]> {
    const batch = internal.applyPatch!.batch;
    const files: CodingFileCommitOutcome[] = [];
    for (const original of batch.originals.values()) {
      const entry = batch.journalEntries.find((candidate) => candidate.absPath === original.resolvedPath);
      const beforeVersion =
        toAuditFileVersion(entry?.relPath ?? original.displayPath, entry?.beforeVersion) ??
        null;
      const afterState = await readOptionalFile(
        internal.prepared.workspaceRoot,
        original.resolvedPath,
      );
      files.push({
        path: entry?.relPath ?? original.displayPath,
        ...(this.#moveTargetForPath(batch, original.resolvedPath)
          ? { targetPath: this.#moveTargetForPath(batch, original.resolvedPath) }
          : {}),
        status: batchState,
        beforeVersion,
        afterVersion: batchState === "committed" ? afterState.version ?? null : beforeVersion,
      });
    }
    return files;
  }
}

export function __resetFileTransactionBatches(): void {
  // Kept as a test seam; service instances own their maps and need no global reset.
}
