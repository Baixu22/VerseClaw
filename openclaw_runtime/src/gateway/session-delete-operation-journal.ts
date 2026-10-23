// Runtime Lifecycle Governance — session delete operation journal.
//
// Phase 0 delivered the manifest/digest/event primitives. Phase 2 adds the
// persisted retry state machine: caller-generated operationId, immutable
// manifest, content-sensitive idempotency, and the same-transaction
// `store_committed` journal write.
import { createHash } from "node:crypto";

import {
  formatSessionArchiveTimestamp,
  isSessionArchiveTimestamp,
} from "../config/sessions/artifacts.js";
import {
  readSessionDeleteOperationJournalRow,
  type SessionDeleteOperationJournalRow,
  updateSessionDeleteOperationJournalState,
  writeSessionDeleteOperationJournalRow,
} from "../config/sessions/store-sqlite.js";

export const SESSION_DELETE_OPERATION_JOURNAL_SCHEMA_VERSION = "1";
export type SessionDeleteOperationKind = "session-delete";

export type SessionDeleteArchivePlan = {
  /** Each source is renamed beside itself with the deterministic timestamp. */
  destination: "session-artifact-sibling";
  archiveTimestamp: string;
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
  emitLifecycleHooks: boolean;
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

export type SessionDeletePartialReceipt = {
  ok: true;
  key: string;
  deleted: true;
  archived: string[];
  archivedTranscripts: Array<{ sourcePath: string; archivedPath: string }>;
  sessionId?: string;
  operationId: string;
  journalState: "partial_committed";
  finalization: {
    archiveComplete: boolean;
    sessionEndHookEmitted: boolean;
    sessionUnbound: boolean;
  };
};

export function parseSessionDeletePartialReceipt(
  raw: string | null | undefined,
): SessionDeletePartialReceipt | undefined {
  if (!raw) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  const receipt = value as Partial<SessionDeletePartialReceipt>;
  const finalization = receipt.finalization;
  if (
    receipt.ok !== true ||
    receipt.deleted !== true ||
    typeof receipt.key !== "string" ||
    typeof receipt.operationId !== "string" ||
    receipt.journalState !== "partial_committed" ||
    !Array.isArray(receipt.archived) ||
    !receipt.archived.every((entry) => typeof entry === "string") ||
    !Array.isArray(receipt.archivedTranscripts) ||
    !receipt.archivedTranscripts.every(
      (entry) =>
        entry &&
        typeof entry === "object" &&
        typeof entry.sourcePath === "string" &&
        typeof entry.archivedPath === "string",
    ) ||
    !finalization ||
    typeof finalization.archiveComplete !== "boolean" ||
    typeof finalization.sessionEndHookEmitted !== "boolean" ||
    typeof finalization.sessionUnbound !== "boolean"
  ) {
    return undefined;
  }
  return receipt as SessionDeletePartialReceipt;
}

function comparePropertyNames(left: string, right: string): number {
  // Code-unit ordering keeps the canonical form identical across machines,
  // locales, and Node ICU builds; localeCompare does not guarantee that.
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function stableManifestJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableManifestJson(item)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => comparePropertyNames(left, right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableManifestJson(item)}`);
  return `{${entries.join(",")}}`;
}

/** Stable digest for content-sensitive idempotency (same id + same digest). */
export function buildSessionOperationManifestDigest(manifest: unknown): string {
  const canonical = stableManifestJson(manifest);
  return createHash("sha256").update(canonical).digest("hex");
}

export function buildSessionDeleteManifestDigest(manifest: SessionDeleteOperationManifest): string {
  return buildSessionOperationManifestDigest(manifest);
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
  emitLifecycleHooks: boolean;
  sessionFile?: string;
  archiveTimestamp?: string;
  archiveEntries?: string[];
}): SessionDeleteOperationManifest {
  const operationId = input.operationId.trim();
  if (!operationId) {
    throw new Error("operationId must be non-empty");
  }
  const requestedArchiveTimestamp = input.archiveTimestamp?.trim();
  if (requestedArchiveTimestamp && !isSessionArchiveTimestamp(requestedArchiveTimestamp)) {
    throw new Error("archiveTimestamp must be an ISO filename timestamp");
  }
  return {
    version: SESSION_DELETE_OPERATION_JOURNAL_SCHEMA_VERSION,
    operation: "session-delete",
    agentId: input.agentId,
    storeIdentity: input.agentId,
    canonicalKey: input.canonicalKey,
    expectedSessionId: input.expectedSessionId,
    deleteTranscript: input.deleteTranscript,
    emitLifecycleHooks: input.emitLifecycleHooks,
    ...(input.sessionFile?.trim() ? { sessionFile: input.sessionFile.trim() } : {}),
    archivePlan: {
      destination: "session-artifact-sibling",
      archiveTimestamp: requestedArchiveTimestamp ?? formatSessionArchiveTimestamp(),
      entries: [...(input.archiveEntries ?? [])],
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

export function buildSessionOperationJournalRow(input: {
  operationId: string;
  manifest: unknown;
  state: SessionDeleteOperationJournalState;
  receiptJson?: string | null;
  createdAt?: number;
}): SessionDeleteOperationJournalRow {
  const operationId = input.operationId.trim();
  if (!operationId) {
    throw new Error("operationId must be non-empty");
  }
  const createdAt = input.createdAt ?? Date.now();
  return {
    operation_id: operationId,
    manifest_json: JSON.stringify(input.manifest),
    manifest_digest: buildSessionOperationManifestDigest(input.manifest),
    state: input.state,
    receipt_json: input.receiptJson ?? null,
    created_at: createdAt,
    updated_at: createdAt,
  };
}

export function buildSessionDeleteOperationJournalRow(input: {
  operationId: string;
  manifest: SessionDeleteOperationManifest;
  state: SessionDeleteOperationJournalState;
  receiptJson?: string | null;
  createdAt?: number;
}): SessionDeleteOperationJournalRow {
  return buildSessionOperationJournalRow(input);
}

function parseManifestJson(raw: string): SessionDeleteOperationManifest {
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("session delete journal manifest is not an object");
  }
  const manifest = parsed as SessionDeleteOperationManifest;
  // Legacy Phase 0 rows (schema "1" with a `session-store-relative` archive
  // plan or without `emitLifecycleHooks`) must fail closed with an explicit
  // migration error instead of being silently accepted.
  if (
    manifest.archivePlan &&
    (manifest.archivePlan as { destination?: unknown }).destination === "session-store-relative"
  ) {
    throw new Error(
      "session delete journal manifest uses unsupported legacy archive plan; rebuild the operation with a new operationId",
    );
  }
  if (manifest.version !== SESSION_DELETE_OPERATION_JOURNAL_SCHEMA_VERSION) {
    throw new Error(
      `session delete journal manifest schema version ${String(manifest.version)} is unsupported`,
    );
  }
  if (
    !manifest.version ||
    !manifest.operation ||
    !manifest.agentId ||
    !manifest.canonicalKey ||
    !manifest.expectedSessionId ||
    typeof manifest.deleteTranscript !== "boolean" ||
    typeof manifest.emitLifecycleHooks !== "boolean" ||
    !manifest.archivePlan ||
    manifest.archivePlan.destination !== "session-artifact-sibling" ||
    !Array.isArray(manifest.archivePlan.entries) ||
    !manifest.archivePlan.entries.every((entry) => typeof entry === "string" && entry.trim()) ||
    !isSessionArchiveTimestamp(manifest.archivePlan.archiveTimestamp)
  ) {
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
  if (buildSessionDeleteManifestDigest(manifest) !== row.manifest_digest) {
    throw new Error("session delete journal manifest digest mismatch");
  }
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
  receipt?: SessionDeletePartialReceipt,
): void {
  updateSessionDeleteOperationJournalState(
    storePath,
    operationId,
    "partial_committed",
    receipt ? JSON.stringify(receipt) : null,
  );
}
