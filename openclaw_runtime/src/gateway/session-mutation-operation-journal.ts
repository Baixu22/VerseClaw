// Runtime lifecycle-governance journal for archive/restore mutations.
// It deliberately reuses the existing session_delete_operation_journal table
// and manifest/digest primitives: this is a new operation kind in the existing
// session mutation journal, not a second lifecycle truth store.
import type { SessionEntry } from "../config/sessions/types.js";
import {
  readSessionDeleteOperationJournalRow,
  updateSessionDeleteOperationJournalState,
  writeSessionDeleteOperationJournalRow,
  type SessionDeleteOperationJournalRow,
} from "../config/sessions/store-sqlite.js";
import {
  buildSessionOperationJournalRow,
  buildSessionOperationManifestDigest,
  type SessionDeleteOperationJournalState,
} from "./session-delete-operation-journal.js";

export const SESSION_MUTATION_OPERATION_JOURNAL_SCHEMA_VERSION = "1";

export type SessionMutationOperationKind = "session-archive" | "session-restore";

export type SessionArchiveIndexSnapshot = {
  sessionKey: string;
  agentId: string;
  transcriptPath: string;
  label: string;
  archivedAt: number;
  originalWorkspaceId: string | null;
  originalFolderId: string | null;
  sessionsJsonSnapshot: SessionEntry | { key: string };
};

export type SessionArchiveOperationManifest = {
  version: "1";
  operation: "session-archive";
  agentId: string;
  storeIdentity: string;
  canonicalKey: string;
  expectedSessionId: string;
  sessionFile?: string;
  liveTranscriptPath: string;
  archivedTranscriptPath: string;
  archiveIndexPath: string;
  archiveEntry: SessionArchiveIndexSnapshot;
};

export type SessionRestoreOperationManifest = {
  version: "1";
  operation: "session-restore";
  agentId: string;
  storeIdentity: string;
  canonicalKey: string;
  previousSessionId: string;
  archivedTranscriptPath: string;
  liveTranscriptPath: string;
  archiveIndexPath: string;
  archiveEntry: SessionArchiveIndexSnapshot;
  restoredEntry: SessionEntry;
};

export type SessionMutationOperationManifest =
  | SessionArchiveOperationManifest
  | SessionRestoreOperationManifest;

export type SessionMutationOperationJournalReadResult = {
  row: SessionDeleteOperationJournalRow;
  manifest: SessionMutationOperationManifest;
  state: SessionDeleteOperationJournalState;
  receiptJson: string | null;
};

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validateArchiveEntry(value: unknown): SessionArchiveIndexSnapshot {
  if (!isRecord(value)) throw new Error("session archive entry must be an object");
  const snapshot = value.sessionsJsonSnapshot;
  if (!isRecord(snapshot)) throw new Error("session archive snapshot must be an object");
  if (
    !isNonEmptyString(value.sessionKey) ||
    !isNonEmptyString(value.agentId) ||
    !isNonEmptyString(value.transcriptPath) ||
    !isNonEmptyString(value.label) ||
    typeof value.archivedAt !== "number" ||
    !Number.isFinite(value.archivedAt)
  ) {
    throw new Error("session archive entry is missing required fields");
  }
  if (value.originalWorkspaceId !== null && !isNonEmptyString(value.originalWorkspaceId)) {
    throw new Error("session archive originalWorkspaceId must be string or null");
  }
  if (value.originalFolderId !== null && !isNonEmptyString(value.originalFolderId)) {
    throw new Error("session archive originalFolderId must be string or null");
  }
  return value as SessionArchiveIndexSnapshot;
}

export function parseSessionMutationOperationManifest(
  raw: string,
): SessionMutationOperationManifest {
  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed)) throw new Error("session mutation journal manifest is not an object");
  if (parsed.version !== SESSION_MUTATION_OPERATION_JOURNAL_SCHEMA_VERSION) {
    throw new Error(`session mutation journal schema version ${String(parsed.version)} is unsupported`);
  }
  if (parsed.operation !== "session-archive" && parsed.operation !== "session-restore") {
    throw new Error(`session mutation operation is unsupported: ${String(parsed.operation)}`);
  }
  if (
    !isNonEmptyString(parsed.agentId) ||
    !isNonEmptyString(parsed.storeIdentity) ||
    !isNonEmptyString(parsed.canonicalKey) ||
    !isNonEmptyString(parsed.archiveIndexPath) ||
    !isNonEmptyString(parsed.archivedTranscriptPath) ||
    !isNonEmptyString(parsed.liveTranscriptPath)
  ) {
    throw new Error("session mutation journal manifest is missing required paths or identity");
  }
  const archiveEntry = validateArchiveEntry(parsed.archiveEntry);
  if (parsed.operation === "session-archive") {
    if (!isNonEmptyString(parsed.expectedSessionId)) {
      throw new Error("session archive manifest is missing expectedSessionId");
    }
    return { ...(parsed as SessionArchiveOperationManifest), archiveEntry };
  }
  if (
    !isNonEmptyString(parsed.previousSessionId) ||
    !isRecord(parsed.restoredEntry) ||
    !isNonEmptyString(parsed.restoredEntry.sessionId)
  ) {
    throw new Error("session restore manifest is missing its restored generation");
  }
  return { ...(parsed as SessionRestoreOperationManifest), archiveEntry };
}

export function readSessionMutationOperationJournal(
  storePath: string,
  operationId: string,
  expectedOperation?: SessionMutationOperationKind,
): SessionMutationOperationJournalReadResult | undefined {
  const row = readSessionDeleteOperationJournalRow(storePath, operationId);
  if (!row) return undefined;
  const manifest = parseSessionMutationOperationManifest(row.manifest_json);
  if (expectedOperation && manifest.operation !== expectedOperation) {
    throw new Error(
      `session operation ${operationId} belongs to ${manifest.operation}, not ${expectedOperation}`,
    );
  }
  if (buildSessionOperationManifestDigest(manifest) !== row.manifest_digest) {
    throw new Error("session mutation journal manifest digest mismatch");
  }
  return {
    row,
    manifest,
    state: row.state as SessionDeleteOperationJournalState,
    receiptJson: row.receipt_json,
  };
}

export function buildSessionMutationJournalRow(input: {
  operationId: string;
  manifest: SessionMutationOperationManifest;
  state: SessionDeleteOperationJournalState;
  receiptJson?: string | null;
  createdAt?: number;
}): SessionDeleteOperationJournalRow {
  return buildSessionOperationJournalRow(input);
}

export function writeSessionMutationOperationIntent(input: {
  storePath: string;
  operationId: string;
  manifest: SessionMutationOperationManifest;
  createdAt?: number;
}): void {
  writeSessionDeleteOperationJournalRow(
    input.storePath,
    buildSessionMutationJournalRow({
      operationId: input.operationId,
      manifest: input.manifest,
      state: "intent",
      createdAt: input.createdAt,
    }),
  );
}

export function markSessionMutationOperationStoreCommitted(input: {
  storePath: string;
  operationId: string;
  receiptJson?: string | null;
}): void {
  updateSessionDeleteOperationJournalState(
    input.storePath,
    input.operationId,
    "store_committed",
    input.receiptJson ?? null,
  );
}

export function finalizeSessionMutationOperationJournal(input: {
  storePath: string;
  operationId: string;
  receipt: unknown;
}): void {
  updateSessionDeleteOperationJournalState(
    input.storePath,
    input.operationId,
    "runtime_committed",
    JSON.stringify(input.receipt),
  );
}

export function parseSessionMutationReceipt<T>(raw: string | null | undefined): T | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? (parsed as T) : undefined;
  } catch {
    return undefined;
  }
}
