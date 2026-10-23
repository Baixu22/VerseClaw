// Runtime-owned archive/restore mutations.
//
// Filesystem rename, archive-index persistence and the session-store row change
// all run behind the existing session admission fence. The existing
// session_delete_operation_journal table records operation kind and retry state;
// Main and renderer never perform the authoritative transcript mutation.
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import {
  resolveSessionFilePath,
  loadSessionStore,
  updateSessionStore,
  type SessionEntry,
} from "../config/sessions.js";
import { resolveDefaultAgentId } from "../agents/agent-scope.js";
import { normalizeAgentId } from "../routing/session-key.js";
import { sessionAdmissionRegistry } from "../sessions/session-admission-registry.js";
import { drainScope } from "./session-drain-service.js";
import {
  cleanupSessionBeforeMutation,
  type SessionMutationCleanupOutcome,
} from "./session-reset-service.js";
import {
  migrateAndPruneGatewaySessionStoreKey,
  type resolveGatewaySessionStoreTarget,
} from "./session-utils.js";
import {
  buildSessionMutationJournalRow,
  finalizeSessionMutationOperationJournal,
  markSessionMutationOperationStoreCommitted,
  parseSessionMutationReceipt,
  readSessionMutationOperationJournal,
  writeSessionMutationOperationIntent,
  type SessionArchiveOperationManifest,
  type SessionRestoreOperationManifest,
} from "./session-mutation-operation-journal.js";

import { readSessionArchiveIndex, resolveSessionArchiveIndexPath, upsertArchiveEntry, removeArchiveEntry } from "./session-archive-index.js";
import type { SessionArchiveIndex } from "./session-archive-index.js";
export { readSessionArchiveIndex, resolveSessionArchiveIndexPath, resolveSessionArchiveIndexPathForAgent, filterArchivedSessionStore } from "./session-archive-index.js";

type SessionStoreTarget = ReturnType<typeof resolveGatewaySessionStoreTarget>;

export type LifecycleMutationFailure = {
  ok: false;
  code: "invalid" | "conflict" | "unavailable";
  error: string;
  retryable: boolean;
  operationId?: string;
  key?: string;
  noMutation?: true;
};

export type ArchiveSessionMutationResult =
  | LifecycleMutationFailure
  | {
      ok: true;
      key: string;
      operationId: string;
      journalState: "runtime_committed";
      archived: true;
      sessionId: string;
      archivedTranscriptPath: string;
      archiveIndexPath: string;
    };

export type RestoreSessionMutationResult =
  | LifecycleMutationFailure
  | {
      ok: true;
      key: string;
      operationId: string;
      journalState: "runtime_committed";
      restored: true;
      previousSessionId: string;
      entry: SessionEntry;
      transcriptPath: string;
      archiveIndexPath: string;
    };

type UnknownRecord = Record<string, unknown>;

class SessionMutationConflictError extends Error {}
class SessionTranscriptConflictError extends Error {}

type ArchiveLease = {
  manifest: SessionArchiveOperationManifest;
  cleanup: SessionMutationCleanupOutcome;
};

const archiveLeases = new Map<string, ArchiveLease>();
const restoreFences = new Map<string, Awaited<ReturnType<typeof sessionAdmissionRegistry.fence>>>();
const mutationQueues = new Map<string, Promise<unknown>>();

// ponytail: serialize archive-index mutations per agent store; split only if measured contention warrants it.
function serializeMutation<T>(storePath: string, run: () => Promise<T>): Promise<T> {
  const key = path.resolve(storePath);
  const previous = mutationQueues.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(run);
  mutationQueues.set(key, next);
  void next
    .finally(() => {
      if (mutationQueues.get(key) === next) mutationQueues.delete(key);
    })
    .catch(() => undefined);
  return next;
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function cloneEntry(entry: SessionEntry): SessionEntry {
  return JSON.parse(JSON.stringify(entry)) as SessionEntry;
}

function fail(
  code: LifecycleMutationFailure["code"],
  error: string,
  retryable = false,
): LifecycleMutationFailure {
  return { ok: false, code, error, retryable };
}

function refuseBeforeIntent(operationId: string, key: string, error: string): LifecycleMutationFailure {
  return { ok: false, code: "invalid", error, retryable: false, operationId, key, noMutation: true };
}

function normalizeOptional(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function resolveArchivedTranscriptPath(livePath: string): string {
  if (livePath.endsWith(".archived.jsonl")) return livePath;
  return livePath.endsWith(".jsonl")
    ? `${livePath.slice(0, -".jsonl".length)}.archived.jsonl`
    : `${livePath}.archived.jsonl`;
}

function resolveArchivedSessionId(transcriptPath: string): string | undefined {
  const match = path.basename(transcriptPath).match(/^(.+)\.archived\.jsonl$/);
  return match?.[1] && isNonEmptyString(match[1]) ? match[1] : undefined;
}

function resolveContainedPath(sessionsDir: string, candidate: string): string {
  const resolvedDir = path.resolve(sessionsDir);
  const resolved = path.resolve(resolvedDir, candidate);
  const relative = path.relative(resolvedDir, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Session archive path escapes sessions directory: ${candidate}`);
  }
  return resolved;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function archiveTranscriptFiles(manifest: SessionArchiveOperationManifest): Promise<void> {
  const liveExists = await exists(manifest.liveTranscriptPath);
  const archivedExists = await exists(manifest.archivedTranscriptPath);
  if (liveExists && archivedExists) {
    throw new SessionTranscriptConflictError("both live and archived session transcripts exist");
  }
  if (archivedExists) return;
  if (!liveExists) throw new Error("live session transcript is missing");
  await fs.mkdir(path.dirname(manifest.archivedTranscriptPath), { recursive: true });
  await fs.rename(manifest.liveTranscriptPath, manifest.archivedTranscriptPath);
}

async function restoreTranscriptFiles(manifest: SessionRestoreOperationManifest): Promise<void> {
  const liveExists = await exists(manifest.liveTranscriptPath);
  const archivedExists = await exists(manifest.archivedTranscriptPath);
  if (liveExists && archivedExists) {
    throw new SessionTranscriptConflictError("both live and archived session transcripts exist");
  }
  if (liveExists) return;
  if (!archivedExists) throw new Error("archived session transcript is missing");
  await fs.mkdir(path.dirname(manifest.liveTranscriptPath), { recursive: true });
  await fs.rename(manifest.archivedTranscriptPath, manifest.liveTranscriptPath);
}

function buildRestoredEntry(
  snapshot: SessionEntry | { key: string },
  sessionId: string,
  liveTranscriptPath: string,
): SessionEntry {
  const now = Date.now();
  const base = isRecord(snapshot) ? snapshot : {};
  return {
    ...(base as SessionEntry),
    sessionId,
    sessionFile: path.basename(liveTranscriptPath),
    sessionStartedAt: now,
    updatedAt: now,
  };
}

function buildArchiveReceipt(input: {
  manifest: SessionArchiveOperationManifest;
  operationId: string;
}): ArchiveSessionMutationResult {
  return {
    ok: true,
    key: input.manifest.canonicalKey,
    operationId: input.operationId,
    journalState: "runtime_committed",
    archived: true,
    sessionId: input.manifest.expectedSessionId,
    archivedTranscriptPath: input.manifest.archivedTranscriptPath,
    archiveIndexPath: input.manifest.archiveIndexPath,
  };
}

function buildRestoreReceipt(input: {
  manifest: SessionRestoreOperationManifest;
  operationId: string;
}): RestoreSessionMutationResult {
  return {
    ok: true,
    key: input.manifest.canonicalKey,
    operationId: input.operationId,
    journalState: "runtime_committed",
    restored: true,
    previousSessionId: input.manifest.previousSessionId,
    entry: input.manifest.restoredEntry,
    transcriptPath: input.manifest.liveTranscriptPath,
    archiveIndexPath: input.manifest.archiveIndexPath,
  };
}

function archiveManifestIdentityMatches(
  manifest: SessionArchiveOperationManifest,
  input: { canonicalKey: string; agentId: string },
): boolean {
  // Operation identity owns retry semantics. Renderer metadata may change while
  // an outcome is unknown; the original journaled manifest remains authoritative.
  return manifest.canonicalKey === input.canonicalKey && manifest.agentId === input.agentId;
}

async function archiveSessionMutation(input: {
  cfg: OpenClawConfig;
  key: string;
  operationId: string;
  target: SessionStoreTarget;
  entry?: SessionEntry;
  legacyKey?: string;
  canonicalKey: string;
  label?: string;
  originalWorkspaceId?: string | null;
  originalFolderId?: string | null;
}): Promise<ArchiveSessionMutationResult> {
  const operationId = input.operationId.trim();
  if (!operationId) return fail("invalid", "operationId is required");
  const storePath = input.target.storePath;
  const agentId = normalizeAgentId(input.target.agentId ?? resolveDefaultAgentId(input.cfg));
  const canonicalKey = input.canonicalKey;
  const originalWorkspaceId = normalizeOptional(input.originalWorkspaceId);
  const originalFolderId = normalizeOptional(input.originalFolderId);

  let journal;
  try {
    journal = readSessionMutationOperationJournal(storePath, operationId, "session-archive");
  } catch (error) {
    return fail("conflict", String(error));
  }
  const label =
    input.label?.trim() ||
    journal?.manifest.archiveEntry.label ||
    input.entry?.label?.trim() ||
    input.entry?.displayName?.trim() ||
    canonicalKey;
  if (
    journal &&
    !archiveManifestIdentityMatches(journal.manifest as SessionArchiveOperationManifest, {
      canonicalKey,
      agentId,
    })
  ) {
    return fail(
      "conflict",
      `archive operation ${operationId} was already used with a different request`,
    );
  }
  const currentEntry = loadSessionStore(storePath)[canonicalKey];
  if (!journal && currentEntry && input.entry && currentEntry.sessionId !== input.entry.sessionId) {
    return fail("conflict", "archive source generation changed before admission");
  }
  if (
    journal &&
    currentEntry &&
    currentEntry.sessionId !==
      (journal.manifest as SessionArchiveOperationManifest).expectedSessionId
  ) {
    return fail(
      "conflict",
      `archive operation ${operationId} belongs to a different session generation`,
    );
  }
  if (journal?.state === "runtime_committed") {
    const receipt = parseSessionMutationReceipt<ArchiveSessionMutationResult>(journal.receiptJson);
    return receipt ?? fail("unavailable", "archive receipt is unavailable", true);
  }

  let manifest: SessionArchiveOperationManifest;
  if (journal) {
    manifest = journal.manifest as SessionArchiveOperationManifest;
    if (
      !archiveManifestIdentityMatches(manifest, {
        canonicalKey,
        agentId,
      })
    ) {
      return fail(
        "conflict",
        `archive operation ${operationId} was already used with a different request`,
      );
    }
  } else {
    if (!input.entry?.sessionId) return refuseBeforeIntent(operationId, canonicalKey, `unknown source session: ${input.key}`);
    const sessionsDir = path.dirname(path.resolve(storePath));
    let liveTranscriptPath: string;
    try {
      liveTranscriptPath = resolveSessionFilePath(input.entry.sessionId, input.entry, {
        agentId,
        sessionsDir,
      });
    } catch (error) {
      return refuseBeforeIntent(operationId, canonicalKey, `session transcript path is unavailable: ${String(error)}`);
    }
    let archivedTranscriptPath: string;
    try {
      archivedTranscriptPath = resolveContainedPath(
        sessionsDir,
        resolveArchivedTranscriptPath(liveTranscriptPath),
      );
    } catch (error) {
      return refuseBeforeIntent(
        operationId,
        canonicalKey,
        `archived transcript path is outside the session store: ${String(error)}`,
      );
    }
    const archiveIndexPath = resolveSessionArchiveIndexPath(storePath);
    manifest = {
      version: "1",
      operation: "session-archive",
      agentId,
      storeIdentity: agentId,
      canonicalKey,
      expectedSessionId: input.entry.sessionId,
      ...(input.entry.sessionFile ? { sessionFile: input.entry.sessionFile } : {}),
      liveTranscriptPath,
      archivedTranscriptPath,
      archiveIndexPath,
      archiveEntry: {
        sessionKey: canonicalKey,
        agentId,
        transcriptPath: archivedTranscriptPath,
        label,
        archivedAt: Date.now(),
        originalWorkspaceId,
        originalFolderId,
        sessionsJsonSnapshot: cloneEntry(input.entry),
      },
    };
    try {
      writeSessionMutationOperationIntent({ storePath, operationId, manifest });
      journal = readSessionMutationOperationJournal(storePath, operationId, "session-archive");
    } catch (error) {
      return fail("unavailable", `archive intent could not be committed: ${String(error)}`, true);
    }
  }

  if (!journal) return fail("unavailable", "archive journal is unavailable", true);
  try {
    const sessionsDir = path.dirname(path.resolve(storePath));
    const expectedArchiveIndexPath = resolveSessionArchiveIndexPath(storePath);
    const liveTranscriptPath = resolveContainedPath(sessionsDir, manifest.liveTranscriptPath);
    const archivedTranscriptPath = resolveContainedPath(sessionsDir, manifest.archivedTranscriptPath);
    if (manifest.archiveIndexPath !== expectedArchiveIndexPath) {
      throw new Error("archive index path does not match the owning session store");
    }
    manifest = {
      ...manifest,
      liveTranscriptPath,
      archivedTranscriptPath,
      archiveIndexPath: expectedArchiveIndexPath,
      archiveEntry: { ...manifest.archiveEntry, transcriptPath: archivedTranscriptPath },
    };
  } catch (error) {
    return fail("conflict", `archive journal contains an unsafe path: ${String(error)}`);
  }
  const leaseKey = `${path.resolve(storePath)}:${operationId}`;
  let lease = archiveLeases.get(leaseKey);
  const retryCleanup = Boolean(lease?.cleanup.error);
  if (journal.state === "intent" && !lease) {
    const cleanup = await cleanupSessionBeforeMutation({
      cfg: input.cfg,
      key: input.key,
      target: input.target,
      entry: {
        ...(manifest.archiveEntry.sessionsJsonSnapshot as SessionEntry),
        sessionId: manifest.expectedSessionId,
      },
      legacyKey: input.legacyKey,
      canonicalKey,
      reason: "session-archive",
    });
    lease = { manifest, cleanup };
    archiveLeases.set(leaseKey, lease);
  }
  if (journal.state === "intent" && lease?.cleanup.error) {
    if (retryCleanup && lease.cleanup.retry) lease.cleanup = await lease.cleanup.retry();
    if (lease.cleanup.error) {
      lease.cleanup.settle(false);
      if (!lease.cleanup.retry) archiveLeases.delete(leaseKey);
      return fail("unavailable", lease.cleanup.error.message, true);
    }
  }

  try {
    if (journal.state === "intent") {
      const removed = await updateSessionStore(
        storePath,
        async (store) => {
          const { primaryKey } = migrateAndPruneGatewaySessionStoreKey({
            cfg: input.cfg,
            key: input.key,
            store,
            agentId,
          });
          if (!store[primaryKey]) {
            throw new SessionMutationConflictError(
              "archive source is missing before store commit",
            );
          }
          if (store[primaryKey].sessionId !== manifest.expectedSessionId) {
            throw new SessionMutationConflictError(
              "archive source generation changed before store commit",
            );
          }
          // Keep generation verification and transcript mutation under the existing store lock.
          await upsertArchiveEntry(manifest.archiveIndexPath, manifest.archiveEntry);
          await archiveTranscriptFiles(manifest);
          delete store[primaryKey];
          return true;
        },
        {
          sqliteJournalRows: [
            buildSessionMutationJournalRow({
              operationId,
              manifest,
              state: "store_committed",
            }),
          ],
          skipSaveWhenResult: (removed) => removed === false,
        },
      );
      if (!removed) {
        markSessionMutationOperationStoreCommitted({ storePath, operationId });
      }
    } else {
      await upsertArchiveEntry(manifest.archiveIndexPath, manifest.archiveEntry);
      await archiveTranscriptFiles(manifest);
    }

    const receipt = buildArchiveReceipt({ manifest, operationId });
    finalizeSessionMutationOperationJournal({ storePath, operationId, receipt });
    lease?.cleanup.settle(true);
    archiveLeases.delete(leaseKey);
    return receipt;
  } catch (error) {
    // Definitive pre-commit conflicts prove this attempt made no user-visible
    // mutation, so release the recovery fence and its cached lease. Unknown or
    // partial outcomes keep both until the same operationId converges.
    if (
      error instanceof SessionMutationConflictError ||
      error instanceof SessionTranscriptConflictError
    ) {
      lease?.cleanup.settle(false, true);
      archiveLeases.delete(leaseKey);
      return fail("conflict", error.message);
    }
    return fail("unavailable", `archive committed incompletely: ${String(error)}`, true);
  }
}

async function restoreSessionMutation(input: {
  cfg: OpenClawConfig;
  key: string;
  operationId: string;
  target: SessionStoreTarget;
  canonicalKey: string;
}): Promise<RestoreSessionMutationResult> {
  const operationId = input.operationId.trim();
  if (!operationId) return fail("invalid", "operationId is required");
  const storePath = input.target.storePath;
  const agentId = normalizeAgentId(input.target.agentId ?? resolveDefaultAgentId(input.cfg));
  const canonicalKey = input.canonicalKey;
  const archiveIndexPath = resolveSessionArchiveIndexPath(storePath);

  let journal;
  try {
    journal = readSessionMutationOperationJournal(storePath, operationId, "session-restore");
  } catch (error) {
    return fail("conflict", String(error));
  }
  if (
    journal &&
    (journal.manifest.canonicalKey !== canonicalKey || journal.manifest.agentId !== agentId)
  ) {
    return fail(
      "conflict",
      `restore operation ${operationId} was already used for a different session`,
    );
  }
  const currentEntry = loadSessionStore(storePath)[canonicalKey];
  if (
    journal &&
    currentEntry &&
    currentEntry.sessionId !==
      (journal.manifest as SessionRestoreOperationManifest).restoredEntry.sessionId
  ) {
    return fail(
      "conflict",
      `restore operation ${operationId} belongs to a different session generation`,
    );
  }
  if (journal?.state === "runtime_committed") {
    const receipt = parseSessionMutationReceipt<RestoreSessionMutationResult>(journal.receiptJson);
    return receipt ?? fail("unavailable", "restore receipt is unavailable", true);
  }

  let manifest: SessionRestoreOperationManifest;
  if (journal) {
    manifest = journal.manifest as SessionRestoreOperationManifest;
    if (manifest.canonicalKey !== canonicalKey || manifest.agentId !== agentId) {
      return fail(
        "conflict",
        `restore operation ${operationId} was already used for a different session`,
      );
    }
  } else {
    let archiveIndex: SessionArchiveIndex;
    try {
      archiveIndex = await readSessionArchiveIndex(archiveIndexPath);
    } catch (error) {
      return fail("unavailable", `archive index is unreadable: ${String(error)}`, true);
    }
    const archiveEntry = archiveIndex.entries.find((entry) => entry.sessionKey === canonicalKey);
    if (!archiveEntry)
      return refuseBeforeIntent(operationId, canonicalKey, `Session is not in the archive index: ${canonicalKey}`);
    const sessionsDir = path.dirname(path.resolve(storePath));
    let archivedTranscriptPath: string;
    try {
      archivedTranscriptPath = resolveContainedPath(sessionsDir, archiveEntry.transcriptPath);
    } catch (error) {
      return refuseBeforeIntent(
        operationId,
        canonicalKey,
        `archived transcript path is outside the session store: ${String(error)}`,
      );
    }
    const snapshotRecord: UnknownRecord = isRecord(archiveEntry.sessionsJsonSnapshot)
      ? archiveEntry.sessionsJsonSnapshot
      : {};
    const snapshotSessionId = snapshotRecord["sessionId"];
    const previousSessionId = isNonEmptyString(snapshotSessionId)
      ? snapshotSessionId
      : resolveArchivedSessionId(archiveEntry.transcriptPath);
    if (!previousSessionId) {
      return refuseBeforeIntent(
        operationId,
        canonicalKey,
        "Archived snapshot and transcript filename have no recoverable generation",
      );
    }
    const sessionId = randomUUID();
    let liveTranscriptPath: string;
    try {
      liveTranscriptPath = resolveContainedPath(sessionsDir, `${sessionId}.jsonl`);
    } catch (error) {
      return refuseBeforeIntent(
        operationId,
        canonicalKey,
        `restored transcript path is outside the session store: ${String(error)}`,
      );
    }
    manifest = {
      version: "1",
      operation: "session-restore",
      agentId,
      storeIdentity: agentId,
      canonicalKey,
      previousSessionId,
      archivedTranscriptPath,
      liveTranscriptPath,
      archiveIndexPath,
      archiveEntry,
      restoredEntry: buildRestoredEntry(
        archiveEntry.sessionsJsonSnapshot,
        sessionId,
        liveTranscriptPath,
      ),
    };
    try {
      writeSessionMutationOperationIntent({ storePath, operationId, manifest });
      journal = readSessionMutationOperationJournal(storePath, operationId, "session-restore");
    } catch (error) {
      return fail("unavailable", `restore intent could not be committed: ${String(error)}`, true);
    }
  }

  if (!journal) return fail("unavailable", "restore journal is unavailable", true);
  try {
    const sessionsDir = path.dirname(path.resolve(storePath));
    const expectedArchiveIndexPath = resolveSessionArchiveIndexPath(storePath);
    const archivedTranscriptPath = resolveContainedPath(sessionsDir, manifest.archivedTranscriptPath);
    const liveTranscriptPath = resolveContainedPath(sessionsDir, manifest.liveTranscriptPath);
    if (manifest.archiveIndexPath !== expectedArchiveIndexPath) {
      throw new Error("archive index path does not match the owning session store");
    }
    manifest = {
      ...manifest,
      archivedTranscriptPath,
      liveTranscriptPath,
      archiveIndexPath: expectedArchiveIndexPath,
      archiveEntry: { ...manifest.archiveEntry, transcriptPath: archivedTranscriptPath },
    };
  } catch (error) {
    return fail("conflict", `restore journal contains an unsafe path: ${String(error)}`);
  }
  const oldIdentity = { agentId, canonicalSessionKey: canonicalKey, expectedSessionId: manifest.previousSessionId };
  if (sessionAdmissionRegistry.isFenced(oldIdentity)) {
    const drained = await drainScope(oldIdentity);
    if (!drained.ok) return fail("unavailable", `Archived generation recovery is incomplete: ${drained.message}`, true);
  } else {
    // Legacy archives and Gateway restarts must prove old owners drained before admitting a new generation.
    const cleanup = await cleanupSessionBeforeMutation({ cfg: input.cfg, key: input.key, target: input.target, entry: { ...(manifest.archiveEntry.sessionsJsonSnapshot as SessionEntry), sessionId: manifest.previousSessionId }, canonicalKey, reason: "session-archive" });
    if (cleanup.error) return fail("unavailable", `Archived generation cleanup is incomplete: ${cleanup.error.message}`, true);
    cleanup.settle(true);
  }
  const fenceKey = `${path.resolve(storePath)}:${operationId}`;
  if (!restoreFences.has(fenceKey)) {
    try {
      const fence = await sessionAdmissionRegistry.fence(
        {
          agentId,
          canonicalSessionKey: canonicalKey,
          expectedSessionId: manifest.restoredEntry.sessionId,
        },
        { operation: "session-restore" },
      );
      restoreFences.set(fenceKey, fence);
    } catch (error) {
      return fail("unavailable", `restore admission could not be fenced: ${String(error)}`, true);
    }
  }
  try {
    if (journal.state === "intent") {
      const committed = await updateSessionStore(
        storePath,
        (store) => {
          const { primaryKey, entry: current } = migrateAndPruneGatewaySessionStoreKey({
            cfg: input.cfg,
            key: input.key,
            store,
            agentId,
          });
          if (current && current.sessionId !== manifest.restoredEntry.sessionId) {
            throw new SessionMutationConflictError(
              `restore target already has a different live generation: ${current.sessionId}`,
            );
          }
          if (current?.sessionId === manifest.restoredEntry.sessionId) return false;
          store[primaryKey] = manifest.restoredEntry;
          return true;
        },
        {
          sqliteJournalRows: [
            buildSessionMutationJournalRow({
              operationId,
              manifest,
              state: "store_committed",
            }),
          ],
          skipSaveWhenResult: (committed) => committed === false,
        },
      );
      if (!committed) markSessionMutationOperationStoreCommitted({ storePath, operationId });
    }
    await restoreTranscriptFiles(manifest);
    await removeArchiveEntry(manifest.archiveIndexPath, canonicalKey);
    const receipt = buildRestoreReceipt({ manifest, operationId });
    finalizeSessionMutationOperationJournal({ storePath, operationId, receipt });
    restoreFences.get(fenceKey)?.release();
    restoreFences.delete(fenceKey);
    return receipt;
  } catch (error) {
    if (
      error instanceof SessionMutationConflictError ||
      error instanceof SessionTranscriptConflictError
    ) {
      restoreFences.get(fenceKey)?.release();
      restoreFences.delete(fenceKey);
      return fail("conflict", error.message);
    }
    return fail("unavailable", `restore committed incompletely: ${String(error)}`, true);
  }
}

export function archiveSessionWithLifecycle(
  input: Parameters<typeof archiveSessionMutation>[0],
): Promise<ArchiveSessionMutationResult> {
  return serializeMutation(input.target.storePath, () => archiveSessionMutation(input));
}

export function restoreSessionWithLifecycle(
  input: Parameters<typeof restoreSessionMutation>[0],
): Promise<RestoreSessionMutationResult> {
  return serializeMutation(input.target.storePath, () => restoreSessionMutation(input));
}
