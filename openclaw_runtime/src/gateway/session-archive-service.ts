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
  resolveStorePath,
  updateSessionStore,
  type SessionEntry,
} from "../config/sessions.js";
import { resolveDefaultAgentId } from "../agents/agent-scope.js";
import { writeJsonAtomic } from "../infra/json-files.js";
import { normalizeAgentId, parseAgentSessionKey } from "../routing/session-key.js";
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
  type SessionArchiveIndexSnapshot,
  type SessionArchiveOperationManifest,
  type SessionRestoreOperationManifest,
} from "./session-mutation-operation-journal.js";

export const SESSION_ARCHIVE_INDEX_VERSION = 1;

export type SessionArchiveEntry = SessionArchiveIndexSnapshot;

export type SessionArchiveIndex = {
  version: 1;
  entries: SessionArchiveEntry[];
};

type SessionStoreTarget = ReturnType<typeof resolveGatewaySessionStoreTarget>;

export type LifecycleMutationFailure = {
  ok: false;
  code: "invalid" | "conflict" | "unavailable";
  error: string;
  retryable: boolean;
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

type ArchiveLease = {
  manifest: SessionArchiveOperationManifest;
  cleanup: SessionMutationCleanupOutcome;
};

const archiveLeases = new Map<string, ArchiveLease>();

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

function normalizeOptional(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function resolveSessionArchiveIndexPath(storePath: string): string {
  return path.join(path.dirname(path.resolve(storePath)), "sessions.archives.json");
}

export function resolveSessionArchiveIndexPathForAgent(
  cfg: OpenClawConfig,
  agentId: string,
): string {
  const storePath = resolveStorePath(cfg.session?.store, { agentId: normalizeAgentId(agentId) });
  return resolveSessionArchiveIndexPath(storePath);
}

function validateArchiveEntry(value: unknown): SessionArchiveEntry | null {
  if (!isRecord(value)) return null;
  if (
    !isNonEmptyString(value.sessionKey) ||
    !isNonEmptyString(value.agentId) ||
    !isNonEmptyString(value.transcriptPath) ||
    !isNonEmptyString(value.label) ||
    typeof value.archivedAt !== "number" ||
    !Number.isFinite(value.archivedAt) ||
    !isRecord(value.sessionsJsonSnapshot)
  ) {
    return null;
  }
  if (value.originalWorkspaceId !== null && !isNonEmptyString(value.originalWorkspaceId)) {
    return null;
  }
  if (value.originalFolderId !== null && !isNonEmptyString(value.originalFolderId)) {
    return null;
  }
  return value as SessionArchiveEntry;
}

export async function readSessionArchiveIndex(indexPath: string): Promise<SessionArchiveIndex> {
  let raw: string;
  try {
    raw = await fs.readFile(indexPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: SESSION_ARCHIVE_INDEX_VERSION, entries: [] };
    }
    throw error;
  }
  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed) || parsed.version !== SESSION_ARCHIVE_INDEX_VERSION || !Array.isArray(parsed.entries)) {
    throw new Error(`Invalid session archive index schema at ${indexPath}`);
  }
  const entries = parsed.entries
    .map(validateArchiveEntry)
    .filter((entry): entry is SessionArchiveEntry => Boolean(entry));
  if (entries.length !== parsed.entries.length) {
    throw new Error(`Session archive index at ${indexPath} contains invalid entries`);
  }
  return { version: SESSION_ARCHIVE_INDEX_VERSION, entries };
}

async function writeSessionArchiveIndex(
  indexPath: string,
  index: SessionArchiveIndex,
): Promise<void> {
  await fs.mkdir(path.dirname(indexPath), { recursive: true });
  await writeJsonAtomic(indexPath, index, {
    mode: 0o600,
    dirMode: 0o700,
    trailingNewline: true,
  });
}

async function upsertArchiveEntry(
  indexPath: string,
  entry: SessionArchiveEntry,
): Promise<void> {
  const index = await readSessionArchiveIndex(indexPath);
  const entries = index.entries.filter((candidate) => candidate.sessionKey !== entry.sessionKey);
  entries.push(entry);
  await writeSessionArchiveIndex(indexPath, { version: 1, entries });
}

async function removeArchiveEntry(
  indexPath: string,
  sessionKey: string,
): Promise<SessionArchiveEntry | null> {
  const index = await readSessionArchiveIndex(indexPath);
  let removed: SessionArchiveEntry | null = null;
  const entries = index.entries.filter((candidate) => {
    if (candidate.sessionKey === sessionKey) {
      removed = candidate;
      return false;
    }
    return true;
  });
  if (removed) await writeSessionArchiveIndex(indexPath, { version: 1, entries });
  return removed;
}

export async function readArchivedSessionKeysForStore(
  cfg: OpenClawConfig,
  store: Record<string, SessionEntry>,
): Promise<Set<string>> {
  const indexCache = new Map<string, SessionArchiveIndex>();
  const keys = new Set<string>();
  for (const sessionKey of Object.keys(store)) {
    const agentId = normalizeAgentId(
      parseAgentSessionKey(sessionKey)?.agentId ?? resolveDefaultAgentId(cfg),
    );
    const indexPath = resolveSessionArchiveIndexPathForAgent(cfg, agentId);
    let index = indexCache.get(indexPath);
    if (!index) {
      try {
        index = await readSessionArchiveIndex(indexPath);
      } catch {
        index = { version: 1, entries: [] };
      }
      indexCache.set(indexPath, index);
    }
    if (index.entries.some((entry) => entry.sessionKey === sessionKey)) keys.add(sessionKey);
  }
  return keys;
}

export async function filterArchivedSessionStore(
  cfg: OpenClawConfig,
  store: Record<string, SessionEntry>,
): Promise<Record<string, SessionEntry>> {
  const archivedKeys = await readArchivedSessionKeysForStore(cfg, store);
  if (archivedKeys.size === 0) return store;
  return Object.fromEntries(
    Object.entries(store).filter(([sessionKey]) => !archivedKeys.has(sessionKey)),
  );
}

function resolveArchivedTranscriptPath(livePath: string): string {
  if (livePath.endsWith(".archived.jsonl")) return livePath;
  return livePath.endsWith(".jsonl")
    ? `${livePath.slice(0, -".jsonl".length)}.archived.jsonl`
    : `${livePath}.archived.jsonl`;
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
    throw new Error("both live and archived session transcripts exist");
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
    throw new Error("both live and archived session transcripts exist");
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

function archiveManifestMatchesRequest(
  manifest: SessionArchiveOperationManifest,
  input: {
    canonicalKey: string;
    agentId: string;
    label: string;
    originalWorkspaceId: string | null;
    originalFolderId: string | null;
  },
): boolean {
  return manifest.canonicalKey === input.canonicalKey &&
    manifest.agentId === input.agentId &&
    manifest.archiveEntry.label === input.label &&
    manifest.archiveEntry.originalWorkspaceId === input.originalWorkspaceId &&
    manifest.archiveEntry.originalFolderId === input.originalFolderId;
}

export async function archiveSessionWithLifecycle(input: {
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
  const label = input.label?.trim() || input.entry?.label?.trim() || input.entry?.displayName?.trim() || canonicalKey;
  const originalWorkspaceId = normalizeOptional(input.originalWorkspaceId);
  const originalFolderId = normalizeOptional(input.originalFolderId);

  let journal;
  try {
    journal = readSessionMutationOperationJournal(storePath, operationId, "session-archive");
  } catch (error) {
    return fail("conflict", String(error));
  }
  if (journal?.state === "runtime_committed") {
    const receipt = parseSessionMutationReceipt<ArchiveSessionMutationResult>(journal.receiptJson);
    return receipt ?? fail("unavailable", "archive receipt is unavailable", true);
  }

  let manifest: SessionArchiveOperationManifest;
  if (journal) {
    manifest = journal.manifest as SessionArchiveOperationManifest;
    if (!archiveManifestMatchesRequest(manifest, { canonicalKey, agentId, label, originalWorkspaceId, originalFolderId })) {
      return fail("conflict", `archive operation ${operationId} was already used with a different request`);
    }
  } else {
    if (!input.entry?.sessionId) return fail("invalid", `unknown source session: ${input.key}`);
    const sessionsDir = path.dirname(path.resolve(storePath));
    let liveTranscriptPath: string;
    try {
      liveTranscriptPath = resolveSessionFilePath(input.entry.sessionId, input.entry, {
        agentId,
        sessionsDir,
      });
    } catch (error) {
      return fail("invalid", `session transcript path is unavailable: ${String(error)}`);
    }
    const archivedTranscriptPath = resolveContainedPath(
      sessionsDir,
      resolveArchivedTranscriptPath(liveTranscriptPath),
    );
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
  let lease = archiveLeases.get(operationId);
  if (journal.state === "intent" && !lease) {
    const cleanup = await cleanupSessionBeforeMutation({
      cfg: input.cfg,
      key: input.key,
      target: input.target,
      entry: input.entry,
      legacyKey: input.legacyKey,
      canonicalKey,
      reason: "session-archive",
    });
    if (cleanup.error) {
      cleanup.settle(false);
      return fail("unavailable", cleanup.error.message, true);
    }
    lease = { manifest, cleanup };
    archiveLeases.set(operationId, lease);
  }

  try {
    if (journal.state === "intent") {
      await upsertArchiveEntry(manifest.archiveIndexPath, manifest.archiveEntry);
      await archiveTranscriptFiles(manifest);
      const removed = await updateSessionStore(
        storePath,
        (store) => {
          const { primaryKey } = migrateAndPruneGatewaySessionStoreKey({
            cfg: input.cfg,
            key: input.key,
            store,
            agentId,
          });
          if (!store[primaryKey]) return false;
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
    archiveLeases.delete(operationId);
    return receipt;
  } catch (error) {
    // Keep the admission fence closed after a partial filesystem/store attempt.
    // The same operationId can be retried and will resume from the journal.
    return fail("unavailable", `archive committed incompletely: ${String(error)}`, true);
  }
}

export async function restoreSessionWithLifecycle(input: {
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
  if (journal?.state === "runtime_committed") {
    const receipt = parseSessionMutationReceipt<RestoreSessionMutationResult>(journal.receiptJson);
    return receipt ?? fail("unavailable", "restore receipt is unavailable", true);
  }

  let manifest: SessionRestoreOperationManifest;
  if (journal) {
    manifest = journal.manifest as SessionRestoreOperationManifest;
    if (manifest.canonicalKey !== canonicalKey || manifest.agentId !== agentId) {
      return fail("conflict", `restore operation ${operationId} was already used for a different session`);
    }
  } else {
    let archiveIndex: SessionArchiveIndex;
    try {
      archiveIndex = await readSessionArchiveIndex(archiveIndexPath);
    } catch (error) {
      return fail("unavailable", `archive index is unreadable: ${String(error)}`, true);
    }
    const archiveEntry = archiveIndex.entries.find((entry) => entry.sessionKey === canonicalKey);
    if (!archiveEntry) return fail("invalid", `Session is not in the archive index: ${canonicalKey}`);
    const sessionsDir = path.dirname(path.resolve(storePath));
    const archivedTranscriptPath = resolveContainedPath(sessionsDir, archiveEntry.transcriptPath);
    const snapshotRecord: UnknownRecord = isRecord(archiveEntry.sessionsJsonSnapshot)
      ? archiveEntry.sessionsJsonSnapshot
      : {};
    const previousSessionId = isNonEmptyString(snapshotRecord["sessionId"])
      ? snapshotRecord["sessionId"]
      : "unknown";
    const sessionId = randomUUID();
    const liveTranscriptPath = resolveContainedPath(sessionsDir, `${sessionId}.jsonl`);
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
      restoredEntry: buildRestoredEntry(archiveEntry.sessionsJsonSnapshot, sessionId, liveTranscriptPath),
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
            throw new Error(`restore target already has a different live generation: ${current.sessionId}`);
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
    return receipt;
  } catch (error) {
    return fail("unavailable", `restore committed incompletely: ${String(error)}`, true);
  }
}
