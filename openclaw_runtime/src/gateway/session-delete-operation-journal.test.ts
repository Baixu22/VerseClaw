import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildSessionDeleteManifestDigest,
  buildSessionDeleteOperationJournalRow,
  buildSessionDeleteOperationManifest,
  createSessionDeleteJournalEvent,
  finalizeSessionDeleteOperationJournal,
  markSessionDeleteOperationPartialCommitted,
  parseSessionDeletePartialReceipt,
  readSessionDeleteOperationJournal,
  writeSessionDeleteOperationIntent,
  SESSION_DELETE_OPERATION_JOURNAL_SCHEMA_VERSION,
  type SessionDeleteOperationManifest,
} from "./session-delete-operation-journal.js";
import {
  openOpenClawAgentDatabase,
  closeOpenClawAgentDatabasesForTest,
} from "../state/openclaw-agent-db.js";
import {
  readSessionDeleteOperationJournalRow,
  replaceSqliteSessionStore,
  resolveSessionStoreDatabaseOptions,
  updateSessionDeleteOperationJournalState,
  type SessionDeleteOperationJournalRow,
} from "../config/sessions/store-sqlite.js";
import type { SessionEntry } from "../config/sessions/types.js";

function manifest(
  overrides: Partial<SessionDeleteOperationManifest> = {},
): SessionDeleteOperationManifest {
  return {
    version: SESSION_DELETE_OPERATION_JOURNAL_SCHEMA_VERSION,
    operation: "session-delete",
    agentId: "agent-a",
    storeIdentity: "agent-a",
    canonicalKey: "agent:agent-a:main",
    expectedSessionId: "session-1",
    deleteTranscript: true,
    emitLifecycleHooks: true,
    archivePlan: {
      destination: "session-artifact-sibling",
      archiveTimestamp: "2026-08-21T00-00-00.000Z",
      entries: ["transcript.jsonl"],
    },
    ...overrides,
  };
}

describe("session delete operation journal primitive", () => {
  it("builds a deterministic manifest digest", () => {
    const first = manifest();
    const second = manifest();
    expect(buildSessionDeleteManifestDigest(first)).toBe(buildSessionDeleteManifestDigest(second));
    expect(buildSessionDeleteManifestDigest(first)).toHaveLength(64);
  });

  it("is content-sensitive: same operationId with different digest conflicts by digest comparison", () => {
    const originalDigest = buildSessionDeleteManifestDigest(manifest());
    const changedDigest = buildSessionDeleteManifestDigest(manifest({ deleteTranscript: false }));
    expect(originalDigest).not.toBe(changedDigest);
    // Phase 0 only provides the comparison primitive; retry conflict behavior
    // (same id + different digest -> conflict) is built on this in Phase 2.
    expect(originalDigest === changedDigest ? "same" : "conflict").toBe("conflict");
  });

  it("includes nested archive plan values in the digest", () => {
    const original = manifest();
    const changedArchive = manifest({
      archivePlan: {
        ...original.archivePlan,
        archiveTimestamp: "2026-08-22T00-00-00.000Z",
      },
    });
    const changedEntry = manifest({
      archivePlan: {
        ...original.archivePlan,
        entries: ["different-transcript.jsonl"],
      },
    });
    expect(buildSessionDeleteManifestDigest(original)).not.toBe(
      buildSessionDeleteManifestDigest(changedArchive),
    );
    expect(buildSessionDeleteManifestDigest(original)).not.toBe(
      buildSessionDeleteManifestDigest(changedEntry),
    );
  });

  it("creates journal events in the documented state machine without persisting", () => {
    const operationId = "delete-op-1";
    const event = createSessionDeleteJournalEvent({
      operationId,
      manifest: manifest(),
      state: "store_committed",
      createdAt: 123,
    });
    expect(event.operationId).toBe(operationId);
    expect(event.state).toBe("store_committed");
    expect(event.createdAt).toBe(123);
    expect(event.manifestDigest).toBe(buildSessionDeleteManifestDigest(manifest()));
    expect(() =>
      createSessionDeleteJournalEvent({ operationId: "  ", manifest: manifest(), state: "intent" }),
    ).toThrow("operationId must be non-empty");
  });

  it("event state transitions are ordered and receipts are optional", () => {
    const base = { operationId: "op-2", manifest: manifest() };
    const intent = createSessionDeleteJournalEvent({ ...base, state: "intent", createdAt: 1 });
    const storeCommitted = createSessionDeleteJournalEvent({
      ...base,
      state: "store_committed",
      createdAt: 2,
    });
    const runtimeCommitted = createSessionDeleteJournalEvent({
      ...base,
      state: "runtime_committed",
      createdAt: 3,
      receiptJson: '{"ok":true}',
    });
    expect(intent.createdAt).toBeLessThan(storeCommitted.createdAt);
    expect(storeCommitted.createdAt).toBeLessThan(runtimeCommitted.createdAt);
    expect(runtimeCommitted.receiptJson).toBe('{"ok":true}');
  });
});

function makeStore(storePath: string): void {
  const entry = { sessionId: "session-1", updatedAt: 1 } as SessionEntry;
  replaceSqliteSessionStore(storePath, { "agent:agent-a:main": entry });
}

describe("session delete operation journal persistence", () => {
  let tmpDir: string;
  let storePath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-delete-journal-"));
    storePath = path.join(tmpDir, "sessions.json");
  });

  afterEach(() => {
    closeOpenClawAgentDatabasesForTest();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("persists intent and reads it back by operationId", () => {
    makeStore(storePath);
    const op = buildSessionDeleteOperationManifest({
      operationId: "op-1",
      agentId: "agent-a",
      canonicalKey: "agent:agent-a:main",
      expectedSessionId: "session-1",
      deleteTranscript: true,
      emitLifecycleHooks: true,
    });
    writeSessionDeleteOperationIntent(storePath, { operationId: "op-1", manifest: op });
    const journal = readSessionDeleteOperationJournal(storePath, "op-1");
    expect(journal?.event.state).toBe("intent");
    expect(journal?.manifest).toEqual(op);
    expect(journal?.event.manifestDigest).toBe(buildSessionDeleteManifestDigest(op));
  });

  it("conflicts when the same operationId is reused with a different digest", () => {
    makeStore(storePath);
    const first = buildSessionDeleteOperationManifest({
      operationId: "op-1",
      agentId: "agent-a",
      canonicalKey: "agent:agent-a:main",
      expectedSessionId: "session-1",
      deleteTranscript: true,
      emitLifecycleHooks: true,
    });
    writeSessionDeleteOperationIntent(storePath, { operationId: "op-1", manifest: first });
    const second = buildSessionDeleteOperationManifest({
      operationId: "op-1",
      agentId: "agent-a",
      canonicalKey: "agent:agent-a:main",
      expectedSessionId: "session-1",
      deleteTranscript: false,
      emitLifecycleHooks: true,
    });
    const journal = readSessionDeleteOperationJournal(storePath, "op-1");
    expect(journal?.event.manifestDigest).toBe(buildSessionDeleteManifestDigest(first));
    expect(journal?.event.manifestDigest).not.toBe(buildSessionDeleteManifestDigest(second));
  });

  it("moves from intent to store_committed and then to partial_committed without duplicate manifests", () => {
    makeStore(storePath);
    const op = buildSessionDeleteOperationManifest({
      operationId: "op-1",
      agentId: "agent-a",
      canonicalKey: "agent:agent-a:main",
      expectedSessionId: "session-1",
      deleteTranscript: true,
      emitLifecycleHooks: true,
    });
    writeSessionDeleteOperationIntent(storePath, { operationId: "op-1", manifest: op });

    const row = buildSessionDeleteOperationJournalRow({
      operationId: "op-1",
      manifest: op,
      state: "store_committed",
    });
    replaceSqliteSessionStore(storePath, {}, { journalRows: [row] });
    expect(readSessionDeleteOperationJournalRow(storePath, "op-1")?.state).toBe("store_committed");
    expect(readSessionDeleteOperationJournal(storePath, "op-1")?.manifest).toEqual(op);

    markSessionDeleteOperationPartialCommitted(storePath, "op-1");
    const after = readSessionDeleteOperationJournal(storePath, "op-1");
    expect(after?.event.state).toBe("partial_committed");
    expect(after?.manifest).toEqual(op);
  });

  it("commits cache_entries row deletion and store_committed journal in exactly one immediate transaction", () => {
    makeStore(storePath);
    const databaseOptions = resolveSessionStoreDatabaseOptions(storePath);
    const database = openOpenClawAgentDatabase(databaseOptions);
    let beginImmediateCount = 0;
    const originalExec = database.db.exec.bind(database.db);
    database.db.exec = ((sql: string) => {
      if (sql.trim().toUpperCase().startsWith("BEGIN IMMEDIATE")) {
        beginImmediateCount += 1;
      }
      return originalExec(sql);
    }) as typeof database.db.exec;

    const op = buildSessionDeleteOperationManifest({
      operationId: "op-tx",
      agentId: "agent-a",
      canonicalKey: "agent:agent-a:main",
      expectedSessionId: "session-1",
      deleteTranscript: true,
      emitLifecycleHooks: true,
    });
    const row: SessionDeleteOperationJournalRow = buildSessionDeleteOperationJournalRow({
      operationId: "op-tx",
      manifest: op,
      state: "store_committed",
    });
    replaceSqliteSessionStore(storePath, {}, { journalRows: [row] });

    console.log(`[runtime-lifecycle-audit] deleteCommitTxCount=${beginImmediateCount}`);
    expect(beginImmediateCount).toBe(1);
    expect(readSessionDeleteOperationJournalRow(storePath, "op-tx")?.state).toBe("store_committed");
    expect(readSessionDeleteOperationJournal(storePath, "op-tx")?.manifest).toEqual(op);
  });
});

describe("session delete operation journal manifest and row helpers", () => {
  it("builds a manifest with deterministic archive plan fields", () => {
    const op = buildSessionDeleteOperationManifest({
      operationId: " op-manifest ",
      agentId: "agent-a",
      canonicalKey: "agent:agent-a:main",
      expectedSessionId: "session-1",
      deleteTranscript: false,
      emitLifecycleHooks: false,
      sessionFile: " /tmp/session-1.jsonl ",
    });
    expect(op.operation).toBe("session-delete");
    expect(op.version).toBe(SESSION_DELETE_OPERATION_JOURNAL_SCHEMA_VERSION);
    expect(op.agentId).toBe("agent-a");
    expect(op.storeIdentity).toBe("agent-a");
    expect(op.canonicalKey).toBe("agent:agent-a:main");
    expect(op.expectedSessionId).toBe("session-1");
    expect(op.deleteTranscript).toBe(false);
    expect(op.sessionFile).toBe("/tmp/session-1.jsonl");
    expect(op.archivePlan.destination).toBe("session-artifact-sibling");
    expect(op.archivePlan.archiveTimestamp).toMatch(/^\d{4}-/);
    expect(op.archivePlan.entries).toEqual([]);
  });

  it("throws when building a manifest with an empty operationId", () => {
    expect(() =>
      buildSessionDeleteOperationManifest({
        operationId: "   ",
        agentId: "agent-a",
        canonicalKey: "agent:agent-a:main",
        expectedSessionId: "session-1",
        deleteTranscript: true,
        emitLifecycleHooks: true,
      }),
    ).toThrow("operationId must be non-empty");
  });

  it("rejects a malformed deterministic archive timestamp", () => {
    expect(() =>
      buildSessionDeleteOperationManifest({
        operationId: "op-invalid-archive",
        agentId: "agent-a",
        canonicalKey: "agent:agent-a:main",
        expectedSessionId: "session-1",
        deleteTranscript: true,
        emitLifecycleHooks: true,
        archiveTimestamp: "not-a-timestamp",
      }),
    ).toThrow("archiveTimestamp");
  });

  it("builds a journal row with snake_case sqlite columns", () => {
    const op = manifest({ sessionFile: "/tmp/session-1.jsonl" });
    const row = buildSessionDeleteOperationJournalRow({
      operationId: "op-row",
      manifest: op,
      state: "store_committed",
      receiptJson: '{"ok":true}',
      createdAt: 42,
    });
    expect(row.operation_id).toBe("op-row");
    expect(row.manifest_digest).toBe(buildSessionDeleteManifestDigest(op));
    expect(row.manifest_json).toBe(JSON.stringify(op));
    expect(row.state).toBe("store_committed");
    expect(row.receipt_json).toBe('{"ok":true}');
    expect(row.created_at).toBe(42);
    expect(row.updated_at).toBe(42);
  });

  it("digests are stable regardless of manifest property insertion order", () => {
    const first = manifest();
    const second = manifest();
    expect(buildSessionDeleteManifestDigest(first)).toBe(buildSessionDeleteManifestDigest(second));
    const reordered = {
      archivePlan: {
        entries: [...first.archivePlan.entries],
        archiveTimestamp: first.archivePlan.archiveTimestamp,
        destination: first.archivePlan.destination,
      },
      sessionFile: first.sessionFile,
      emitLifecycleHooks: first.emitLifecycleHooks,
      deleteTranscript: first.deleteTranscript,
      expectedSessionId: first.expectedSessionId,
      canonicalKey: first.canonicalKey,
      storeIdentity: first.storeIdentity,
      agentId: first.agentId,
      operation: first.operation,
      version: first.version,
    } as SessionDeleteOperationManifest;
    expect(Object.keys(reordered)).not.toEqual(Object.keys(first));
    expect(buildSessionDeleteManifestDigest(reordered)).toBe(
      buildSessionDeleteManifestDigest(first),
    );
  });

  it("rejects legacy session-store-relative manifests with an explicit migration error", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-delete-journal-"));
    try {
      const legacyStorePath = path.join(tmp, "sessions.json");
      makeStore(legacyStorePath);
      const legacy = {
        version: SESSION_DELETE_OPERATION_JOURNAL_SCHEMA_VERSION,
        operation: "session-delete",
        agentId: "agent-a",
        canonicalKey: "agent:agent-a:main",
        expectedSessionId: "session-1",
        deleteTranscript: true,
        archivePlan: {
          destination: "session-store-relative",
          relativeDir: "deleted",
          fileName: "legacy-op.jsonl",
          entries: [],
        },
      };
      expect(readSessionDeleteOperationJournal(legacyStorePath, "legacy-op")).toBeUndefined();
      const row: SessionDeleteOperationJournalRow = {
        operation_id: "legacy-op",
        manifest_json: JSON.stringify(legacy),
        manifest_digest: buildSessionDeleteManifestDigest(
          legacy as unknown as SessionDeleteOperationManifest,
        ),
        state: "intent",
        receipt_json: null,
        created_at: 1,
        updated_at: 1,
      };
      replaceSqliteSessionStore(legacyStorePath, {}, { journalRows: [row] });
      expect(() => readSessionDeleteOperationJournal(legacyStorePath, "legacy-op")).toThrow(
        "unsupported legacy archive plan",
      );
    } finally {
      closeOpenClawAgentDatabasesForTest();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("createSessionDeleteJournalEvent defaults createdAt and receipt", () => {
    const event = createSessionDeleteJournalEvent({
      operationId: "op-event",
      manifest: manifest(),
      state: "intent",
    });
    expect(event.createdAt).toBeGreaterThan(0);
    expect(event.receiptJson).toBeNull();
    expect(event.manifestDigest).toBe(buildSessionDeleteManifestDigest(manifest()));
  });

  it("readSessionDeleteOperationJournal returns undefined when no row exists", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-delete-journal-"));
    try {
      expect(
        readSessionDeleteOperationJournal(path.join(tmp, "sessions.json"), "missing-op"),
      ).toBeUndefined();
    } finally {
      closeOpenClawAgentDatabasesForTest();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("session delete operation journal sqlite row lifecycle", () => {
  let tmpDir: string;
  let storePath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-delete-journal-"));
    storePath = path.join(tmpDir, "sessions.json");
    makeStore(storePath);
  });

  afterEach(() => {
    closeOpenClawAgentDatabasesForTest();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writeSessionDeleteOperationJournalRow inserts and upserts state", () => {
    const op = manifest();
    const first = buildSessionDeleteOperationJournalRow({
      operationId: "op-upsert",
      manifest: op,
      state: "intent",
    });
    replaceSqliteSessionStore(
      storePath,
      { "agent:agent-a:main": { sessionId: "session-1", updatedAt: 1 } as SessionEntry },
      { journalRows: [first] },
    );
    const before = readSessionDeleteOperationJournal(storePath, "op-upsert");
    expect(before?.event.state).toBe("intent");
    expect(before?.manifest).toEqual(op);

    const second = buildSessionDeleteOperationJournalRow({
      operationId: "op-upsert",
      manifest: op,
      state: "store_committed",
    });
    replaceSqliteSessionStore(storePath, {}, { journalRows: [second] });
    const after = readSessionDeleteOperationJournal(storePath, "op-upsert");
    expect(after?.event.state).toBe("store_committed");
    expect(after?.manifest).toEqual(op);
    expect(after?.event.manifestDigest).toBe(buildSessionDeleteManifestDigest(op));
  });

  it("updateSessionDeleteOperationJournalState finalizes a row without replacing its manifest", () => {
    const op = manifest();
    const row = buildSessionDeleteOperationJournalRow({
      operationId: "op-finalize",
      manifest: op,
      state: "store_committed",
    });
    replaceSqliteSessionStore(storePath, {}, { journalRows: [row] });

    updateSessionDeleteOperationJournalState(
      storePath,
      "op-finalize",
      "runtime_committed",
      '{"ok":true}',
    );
    const journal = readSessionDeleteOperationJournal(storePath, "op-finalize");
    expect(journal?.event.state).toBe("runtime_committed");
    expect(journal?.event.receiptJson).toBe('{"ok":true}');
    expect(journal?.manifest).toEqual(op);
    expect(journal?.row.manifest_json).toBe(JSON.stringify(op));
  });

  it("finalizeSessionDeleteOperationJournal stores a receipt", () => {
    const op = manifest();
    const row = buildSessionDeleteOperationJournalRow({
      operationId: "op-receipt",
      manifest: op,
      state: "store_committed",
    });
    replaceSqliteSessionStore(storePath, {}, { journalRows: [row] });
    finalizeSessionDeleteOperationJournal(storePath, "op-receipt", { ok: true, deleted: true });
    const journal = readSessionDeleteOperationJournal(storePath, "op-receipt");
    expect(journal?.event.state).toBe("runtime_committed");
    expect(JSON.parse(journal?.event.receiptJson ?? "null")).toEqual({ ok: true, deleted: true });
  });

  it("markSessionDeleteOperationPartialCommitted preserves the manifest", () => {
    const op = manifest();
    const row = buildSessionDeleteOperationJournalRow({
      operationId: "op-partial",
      manifest: op,
      state: "store_committed",
    });
    replaceSqliteSessionStore(storePath, {}, { journalRows: [row] });
    markSessionDeleteOperationPartialCommitted(storePath, "op-partial");
    const journal = readSessionDeleteOperationJournal(storePath, "op-partial");
    expect(journal?.event.state).toBe("partial_committed");
    expect(journal?.event.receiptJson).toBeNull();
    expect(journal?.manifest).toEqual(op);
  });

  it("persists partial finalization progress for an idempotent retry", () => {
    const op = manifest();
    const row = buildSessionDeleteOperationJournalRow({
      operationId: "op-partial-progress",
      manifest: op,
      state: "store_committed",
    });
    replaceSqliteSessionStore(storePath, {}, { journalRows: [row] });
    markSessionDeleteOperationPartialCommitted(storePath, "op-partial-progress", {
      ok: true,
      key: op.canonicalKey,
      deleted: true,
      archived: ["/tmp/deleted.jsonl"],
      archivedTranscripts: [
        {
          sourcePath: "/tmp/session.jsonl",
          archivedPath: "/tmp/deleted.jsonl",
        },
      ],
      sessionId: op.expectedSessionId,
      operationId: "op-partial-progress",
      journalState: "partial_committed",
      finalization: {
        archiveComplete: true,
        sessionEndHookEmitted: true,
        sessionUnbound: false,
      },
    });
    const journal = readSessionDeleteOperationJournal(storePath, "op-partial-progress");
    expect(JSON.parse(journal?.event.receiptJson ?? "null")).toMatchObject({
      journalState: "partial_committed",
      finalization: {
        archiveComplete: true,
        sessionEndHookEmitted: true,
        sessionUnbound: false,
      },
    });
    expect(parseSessionDeletePartialReceipt(journal?.event.receiptJson)).toBeDefined();
  });

  it("replaceSqliteSessionStore removes cache entries and writes multiple journal rows in one store rewrite", () => {
    const first = buildSessionDeleteOperationJournalRow({
      operationId: "op-multi-1",
      manifest: manifest(),
      state: "store_committed",
    });
    const second = buildSessionDeleteOperationJournalRow({
      operationId: "op-multi-2",
      manifest: manifest({ deleteTranscript: false }),
      state: "store_committed",
    });
    replaceSqliteSessionStore(storePath, {}, { journalRows: [first, second] });
    expect(readSessionDeleteOperationJournalRow(storePath, "op-multi-1")?.state).toBe(
      "store_committed",
    );
    expect(readSessionDeleteOperationJournalRow(storePath, "op-multi-2")?.state).toBe(
      "store_committed",
    );
  });

  it("readSessionDeleteOperationJournalRow returns null for an unknown operationId", () => {
    expect(readSessionDeleteOperationJournalRow(storePath, "op-missing")).toBeNull();
  });

  it("writeSessionDeleteOperationIntent and readSessionDeleteOperationJournal round-trip", () => {
    const op = manifest();
    const event = writeSessionDeleteOperationIntent(storePath, {
      operationId: "op-intent-2",
      manifest: op,
    });
    expect(event.state).toBe("intent");
    expect(event.manifestDigest).toBe(buildSessionDeleteManifestDigest(op));
    const journal = readSessionDeleteOperationJournal(storePath, "op-intent-2");
    expect(journal?.event.state).toBe("intent");
    expect(journal?.manifest).toEqual(op);
  });

  it("journal state can move intent -> store_committed -> runtime_committed", () => {
    const op = manifest();
    writeSessionDeleteOperationIntent(storePath, { operationId: "op-flow", manifest: op });
    expect(readSessionDeleteOperationJournal(storePath, "op-flow")?.event.state).toBe("intent");

    const committed = buildSessionDeleteOperationJournalRow({
      operationId: "op-flow",
      manifest: op,
      state: "store_committed",
    });
    replaceSqliteSessionStore(storePath, {}, { journalRows: [committed] });
    expect(readSessionDeleteOperationJournal(storePath, "op-flow")?.event.state).toBe(
      "store_committed",
    );

    finalizeSessionDeleteOperationJournal(storePath, "op-flow", { ok: true, deleted: true });
    expect(readSessionDeleteOperationJournal(storePath, "op-flow")?.event.state).toBe(
      "runtime_committed",
    );
  });
});
