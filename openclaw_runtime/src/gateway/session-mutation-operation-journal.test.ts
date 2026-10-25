import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  closeOpenClawAgentDatabasesForTest,
} from "../state/openclaw-agent-db.js";
import {
  readSessionDeleteOperationJournalRow,
  replaceSqliteSessionStore,
} from "../config/sessions/store-sqlite.js";
import type { SessionEntry } from "../config/sessions/types.js";
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

function archiveManifest(operation: "session-archive" | "session-restore" = "session-archive"): SessionArchiveOperationManifest {
  return {
    version: "1",
    operation,
    agentId: "agent-a",
    storeIdentity: "agent-a",
    canonicalKey: "agent:agent-a:main",
    expectedSessionId: "session-1",
    liveTranscriptPath: "/tmp/session-1.jsonl",
    archivedTranscriptPath: "/tmp/session-1.archived.jsonl",
    archiveIndexPath: "/tmp/sessions.archives.json",
    archiveEntry: {
      sessionKey: "agent:agent-a:main",
      agentId: "agent-a",
      transcriptPath: "/tmp/session-1.archived.jsonl",
      label: "Long session",
      archivedAt: 1,
      originalWorkspaceId: "workspace-a",
      originalFolderId: null,
      sessionsJsonSnapshot: {
        sessionId: "session-1",
        updatedAt: 1,
        label: "Long session",
      },
    },
  };
}

function restoreManifest(): SessionRestoreOperationManifest {
  return {
    version: "1",
    operation: "session-restore",
    agentId: "agent-a",
    storeIdentity: "agent-a",
    canonicalKey: "agent:agent-a:main",
    previousSessionId: "session-1",
    archivedTranscriptPath: "/tmp/session-1.archived.jsonl",
    liveTranscriptPath: "/tmp/session-2.jsonl",
    archiveIndexPath: "/tmp/sessions.archives.json",
    archiveEntry: archiveManifest().archiveEntry,
    restoredEntry: {
      sessionId: "session-2",
      sessionFile: "session-2.jsonl",
      updatedAt: 2,
      label: "Long session",
    } as SessionEntry,
  };
}

describe("session mutation operation journal", () => {
  let tmpDir: string;
  let storePath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-mutation-journal-"));
    storePath = path.join(tmpDir, "sessions.json");
    replaceSqliteSessionStore(storePath, {
      "agent:agent-a:main": { sessionId: "session-1", updatedAt: 1 } as SessionEntry,
    });
  });

  afterEach(() => {
    closeOpenClawAgentDatabasesForTest();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("persists archive intent in the existing operation journal", () => {
    const manifest = archiveManifest();
    writeSessionMutationOperationIntent({ storePath, operationId: "archive-op-1", manifest });
    const readback = readSessionMutationOperationJournal(storePath, "archive-op-1", "session-archive");
    expect(readback?.manifest).toEqual(manifest);
    expect(readback?.state).toBe("intent");
    expect(readSessionDeleteOperationJournalRow(storePath, "archive-op-1")?.manifest_digest).toHaveLength(64);
  });

  it("moves archive through store_committed to a durable runtime receipt", () => {
    const manifest = archiveManifest();
    writeSessionMutationOperationIntent({ storePath, operationId: "archive-op-2", manifest });
    markSessionMutationOperationStoreCommitted({ storePath, operationId: "archive-op-2" });
    expect(readSessionMutationOperationJournal(storePath, "archive-op-2")?.state).toBe("store_committed");
    const receipt = {
      ok: true as const,
      key: manifest.canonicalKey,
      operationId: "archive-op-2",
      journalState: "runtime_committed" as const,
      archived: true as const,
    };
    finalizeSessionMutationOperationJournal({ storePath, operationId: "archive-op-2", receipt });
    const readback = readSessionMutationOperationJournal(storePath, "archive-op-2");
    expect(readback?.state).toBe("runtime_committed");
    expect(parseSessionMutationReceipt(readback?.receiptJson)).toEqual(receipt);
  });

  it("rejects reuse of the same operationId by another mutation kind", () => {
    writeSessionMutationOperationIntent({
      storePath,
      operationId: "shared-op",
      manifest: archiveManifest(),
    });
    expect(() =>
      readSessionMutationOperationJournal(storePath, "shared-op", "session-restore"),
    ).toThrow(/belongs to session-archive/);
  });

  it("writes restore manifests with a fresh physical generation", () => {
    const manifest = restoreManifest();
    writeSessionMutationOperationIntent({ storePath, operationId: "restore-op-1", manifest });
    const row = buildSessionMutationJournalRow({
      operationId: "restore-op-2",
      manifest,
      state: "store_committed",
    });
    expect(row.manifest_digest).toHaveLength(64);
    expect(readSessionMutationOperationJournal(storePath, "restore-op-1")?.manifest).toMatchObject({
      operation: "session-restore",
      previousSessionId: "session-1",
      restoredEntry: { sessionId: "session-2" },
    });
  });
});
