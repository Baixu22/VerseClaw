// Runtime Lifecycle Governance — session delete operation journal.
//
// Phase 0 delivered the manifest/digest/event primitives. Phase 2 adds the
// persisted retry state machine: caller-generated operationId, immutable
// manifest, content-sensitive idempotency, and the same-transaction
// `store_committed` journal write.
import { createHash } from "node:crypto";

import { isTruthyEnvValue } from "../infra/env.js";
import {
  readSessionDeleteOperationJournalRow,
  type SessionDeleteOperationJournalRow,
  updateSessionDeleteOperationJournalState,
  writeSessionDeleteOperationJournalRow,
} from "../config/sessions/store-sqlite.js";

export const SESSION_DELETE_OPERATION_JOURNAL_SCHEMA_VERSION = "1";
export const RUNTIME_LIFECYCLE_DELETE_JOURNAL_ENABLED_ENV =
  "RUNTIME_LIFECYCLE_DELETE_JOURNAL_ENABLED";

export type SessionDeleteOperationKind = "session-delete";

export type SessionDeleteArchivePlan = {
  /** Archive destination is deterministic from the manifest (never wall-clock). */
  destination: "session-store-relative";
  relativeDir: string;
  fileName: string;
  /** Expected transcript/cache artifact paths, in deterministic order. */
  entries: string[];
};

export type SessionDeleteOperationManifest = {
  version: string;
  operation: SessionDeleteOperationKind;
  agentId: string;
  storeIdentity: string;
  canonicalKey: string;
  expectedSessionId: string;
  deleteTranscript: boolean;
  /** Original session file path hint, retained so a retry after store commit
   * can still archive custom transcript paths. */
  sessionFile?: string;
  archivePlan: SessionDeleteArchivePlan;
};

export type SessionDeleteOperationJournalState =
  | "intent"
  | "store_committed"
  | "runtime_committed"
  | "partial_committed";

export type SessionDeleteOperationJournalEvent = {
  operationId: string;
  manifestDigest: string;
  state: SessionDeleteOperationJournalState;
  createdAt: number;
  receiptJson?: string | null;
};

export type SessionDeleteOperationJournalReadResult = {
  row: SessionDeleteOperationJournalRow;
  manifest: SessionDeleteOperationManifest;
  event: SessionDeleteOperationJournalEvent;
};

/** Stable digest for content-sensitive idempotency (same id + same digest). */
export function buildSessionDeleteManifestDigest(manifest: SessionDeleteOperationManifest): string {
  const canonical = JSON.stringify(manifest, Object.keys(manifest).sort());
  return createHash("sha256").update(canonical).digest("hex");
}

export function sessionDeleteOperationJournalEnabled(): boolean {
  return isTruthyEnvValue(process.env[RUNTIME_LIFECYCLE_DELETE_JOURNAL_ENABLED_ENV]);
}

/**
 * Builds the immutable delete manifest. The archive plan is deterministic and
 * never depends on wall-clock time.
 */
export function buildSessionDeleteOperationManifest(input: {
  operationId: string;
  agentId: string;
  canonicalKey: string;
  expectedSessionId: string;
  deleteTranscript: boolean;
  sessionFile?: string;
}): SessionDeleteOperationManifest {
  const operationId = input.operationId.trim();
  if (!operationId) {
    throw new Error("operationId must be non-empty");
  }
  return {
    version: SESSION_DELETE_OPERATION_JOURNAL_SCHEMA_VERSION,
    operation: "session-delete",
    agentId: input.agentId,
    storeIdentity: input.agentId,
    canonicalKey: input.canonicalKey,
    expectedSessionId: input.expectedSessionId,
    deleteTranscript: input.deleteTranscript,
    ...(input.sessionFile?.trim() ? { sessionFile: input.sessionFile.trim() } : {}),
    archivePlan: {
      destination: "session-store-relative",
      relativeDir: "deleted",
      fileName: `${operationId}.jsonl`,
      entries: [],
    },
  };
}

export function createSessionDeleteJournalEvent(input: {
  operationId: string;
  manifest: SessionDeleteOperationManifest;
  state: SessionDeleteOperationJournalState;
  receiptJson?: string | null;
  createdAt?: number;
}): SessionDeleteOperationJournalEvent {
  const operationId = input.operationId.trim();
  if (!operationId) {
    throw new Error("operationId must be non-empty");
  }
  return {
    operationId,
    manifestDigest: buildSessionDeleteManifestDigest(input.manifest),
    state: input.state,
    createdAt: input.createdAt ?? Date.now(),
    receiptJson: input.receiptJson ?? null,
  };
}

export function buildSessionDeleteOperationJournalRow(input: {
  operationId: string;
  manifest: SessionDeleteOperationManifest;
  state: SessionDeleteOperationJournalState;
  receiptJson?: string | null;
  createdAt?: number;
}): SessionDeleteOperationJournalRow {
  const event = createSessionDeleteJournalEvent(input);
  return {
    operation_id: event.operationId,
    manifest_json: JSON.stringify(input.manifest),
    manifest_digest: event.manifestDigest,
    state: event.state,
    receipt_json: event.receiptJson ?? null,
    created_at: event.createdAt,
    updated_at: event.createdAt,
  };
}

function parseManifestJson(raw: string): SessionDeleteOperationManifest {
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("session delete journal manifest is not an object");
  }
  const manifest = parsed as SessionDeleteOperationManifest;
  if (!manifest.version || !manifest.operation || !manifest.agentId || !manifest.canonicalKey || !manifest.expectedSessionId) {
    throw new Error("session delete journal manifest is missing required fields");
  }
  return manifest;
}

/** Retry state machine: always query by operationId before any delete work. */
export function readSessionDeleteOperationJournal(
  storePath: string,
  operationId: string,
): SessionDeleteOperationJournalReadResult | undefined {
  const row = readSessionDeleteOperationJournalRow(storePath, operationId);
  if (!row) {
    return undefined;
  }
  const manifest = parseManifestJson(row.manifest_json);
  return {
    row,
    manifest,
    event: {
      operationId: row.operation_id,
      manifestDigest: row.manifest_digest,
      state: row.state as SessionDeleteOperationJournalState,
      createdAt: row.created_at,
      receiptJson: row.receipt_json,
    },
  };
}

export function writeSessionDeleteOperationIntent(
  storePath: string,
  input: {
    operationId: string;
    manifest: SessionDeleteOperationManifest;
    createdAt?: number;
  },
): SessionDeleteOperationJournalEvent {
  const row = buildSessionDeleteOperationJournalRow({
    operationId: input.operationId,
    manifest: input.manifest,
    state: "intent",
    createdAt: input.createdAt,
  });
  writeSessionDeleteOperationJournalRow(storePath, row);
  return {
    operationId: row.operation_id,
    manifestDigest: row.manifest_digest,
    state: "intent",
    createdAt: row.created_at,
    receiptJson: null,
  };
}

export function finalizeSessionDeleteOperationJournal(
  storePath: string,
  operationId: string,
  receipt: unknown,
): void {
  updateSessionDeleteOperationJournalState(
    storePath,
    operationId,
    "runtime_committed",
    JSON.stringify(receipt),
  );
}

export function markSessionDeleteOperationPartialCommitted(
  storePath: string,
  operationId: string,
): void {
  updateSessionDeleteOperationJournalState(
    storePath,
    operationId,
    "partial_committed",
    null,
  );
}

/**
 * Default-off production hook for `sessions.delete`. Kept for Phase 0
 * compatibility; the real Phase 2 path builds and persists the manifest
 * through the functions above.
 */
export function probeSessionDeleteOperationJournal(input: {
  operationId?: string;
  agentId: string;
  canonicalKey: string;
  expectedSessionId?: string;
  deleteTranscript: boolean;
}): string | undefined {
  if (!sessionDeleteOperationJournalEnabled()) return undefined;
  if (!input.operationId?.trim()) return undefined;
  if (!input.canonicalKey.trim() || !input.expectedSessionId?.trim()) {
    return undefined;
  }
  const manifest = buildSessionDeleteOperationManifest({
    operationId: input.operationId,
    agentId: input.agentId,
    canonicalKey: input.canonicalKey,
    expectedSessionId: input.expectedSessionId,
    deleteTranscript: input.deleteTranscript,
  });
  return createSessionDeleteJournalEvent({
    operationId: input.operationId,
    manifest,
    state: "intent",
  }).manifestDigest;
}
