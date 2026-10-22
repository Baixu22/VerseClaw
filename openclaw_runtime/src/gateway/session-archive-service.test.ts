import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const cleanupState = vi.hoisted(() => ({
  cleanup: vi.fn(),
}));

vi.mock("./session-reset-service.js", () => ({
  cleanupSessionBeforeMutation: cleanupState.cleanup,
}));

import type { OpenClawConfig } from "../config/types.openclaw.js";
import { loadSessionStore, updateSessionStore, type SessionEntry } from "../config/sessions.js";
import { closeOpenClawAgentDatabasesForTest } from "../state/openclaw-agent-db.js";
import { replaceSqliteSessionStore } from "../config/sessions/store-sqlite.js";
import {
  archiveSessionWithLifecycle,
  readSessionArchiveIndex,
  resolveSessionArchiveIndexPath,
  restoreSessionWithLifecycle,
} from "./session-archive-service.js";
import {
  markSessionMutationOperationStoreCommitted,
  readSessionMutationOperationJournal,
  writeSessionMutationOperationIntent,
  type SessionRestoreOperationManifest,
  type SessionArchiveOperationManifest,
} from "./session-mutation-operation-journal.js";

const SESSION_KEY = "agent:agent-a:main";

function makeEntry(sessionId = "session-1"): SessionEntry {
  return {
    sessionId,
    updatedAt: 1,
    label: "Long session",
    origin: { provider: "test" },
  } as SessionEntry;
}

describe("runtime session archive/restore lifecycle", () => {
  let tmpDir: string;
  let storePath: string;
  let cfg: OpenClawConfig;
  let entry: SessionEntry;
  let target: never;
  let settle: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-archive-service-"));
    storePath = path.join(tmpDir, "sessions.json");
    cfg = { session: { store: storePath } } as OpenClawConfig;
    entry = makeEntry();
    replaceSqliteSessionStore(storePath, { [SESSION_KEY]: entry });
    fs.writeFileSync(
      path.join(tmpDir, "session-1.jsonl"),
      `${JSON.stringify({ type: "session", version: 1, id: "session-1" })}\n`,
      "utf8",
    );
    settle = vi.fn();
    cleanupState.cleanup.mockReset();
    cleanupState.cleanup.mockResolvedValue({ settle });
    target = {
      agentId: "agent-a",
      storePath,
      canonicalKey: SESSION_KEY,
      storeKeys: [SESSION_KEY],
      store: { [SESSION_KEY]: entry },
    } as never;
  });

  afterEach(() => {
    cleanupState.cleanup.mockReset();
    closeOpenClawAgentDatabasesForTest();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("archives through the admission finalizer and commits a restart-safe receipt", async () => {
    const result = await archiveSessionWithLifecycle({
      cfg,
      key: SESSION_KEY,
      operationId: "archive-op-1",
      target,
      entry,
      canonicalKey: SESSION_KEY,
      originalWorkspaceId: "workspace-a",
    });
    expect(result.ok).toBe(true);
    expect(cleanupState.cleanup).toHaveBeenCalledTimes(1);
    expect(settle).toHaveBeenCalledWith(true);
    expect(fs.existsSync(path.join(tmpDir, "session-1.jsonl"))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, "session-1.archived.jsonl"))).toBe(true);
    expect(loadSessionStore(storePath)[SESSION_KEY]).toBeUndefined();
    const index = await readSessionArchiveIndex(resolveSessionArchiveIndexPath(storePath));
    expect(index.entries).toHaveLength(1);
    expect(index.entries[0]).toMatchObject({
      sessionKey: SESSION_KEY,
      originalWorkspaceId: "workspace-a",
    });
    const journal = readSessionMutationOperationJournal(storePath, "archive-op-1", "session-archive");
    expect(journal?.state).toBe("runtime_committed");
  });

  it("returns the committed receipt without rerunning cleanup on an archive retry", async () => {
    const first = await archiveSessionWithLifecycle({
      cfg,
      key: SESSION_KEY,
      operationId: "archive-op-2",
      target,
      entry,
      canonicalKey: SESSION_KEY,
    });
    expect(first.ok).toBe(true);
    const second = await archiveSessionWithLifecycle({
      cfg,
      key: SESSION_KEY,
      operationId: "archive-op-2",
      target,
      canonicalKey: SESSION_KEY,
    });
    expect(second).toEqual(first);
    expect(cleanupState.cleanup).toHaveBeenCalledTimes(1);
  });

  it("restores with a fresh sessionId, removes the archive index and preserves history", async () => {
    const archived = await archiveSessionWithLifecycle({
      cfg,
      key: SESSION_KEY,
      operationId: "archive-op-3",
      target,
      entry,
      canonicalKey: SESSION_KEY,
    });
    expect(archived.ok).toBe(true);
    const restoreTarget = {
      agentId: "agent-a",
      storePath,
      canonicalKey: SESSION_KEY,
      storeKeys: [SESSION_KEY],
      store: {},
    } as never;
    const restored = await restoreSessionWithLifecycle({
      cfg,
      key: SESSION_KEY,
      operationId: "restore-op-3",
      target: restoreTarget,
      canonicalKey: SESSION_KEY,
    });
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(restored.previousSessionId).toBe("session-1");
    expect(restored.entry.sessionId).not.toBe("session-1");
    expect(fs.existsSync(restored.transcriptPath)).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "session-1.archived.jsonl"))).toBe(false);
    const store = loadSessionStore(storePath);
    expect(store[SESSION_KEY]?.sessionId).toBe(restored.entry.sessionId);
    const index = await readSessionArchiveIndex(resolveSessionArchiveIndexPath(storePath));
    expect(index.entries).toEqual([]);
  });

  it("recovers a pre-commit archive journal instead of requiring a new operationId", async () => {
    const indexPath = resolveSessionArchiveIndexPath(storePath);
    const archiveEntry = {
      sessionKey: SESSION_KEY,
      agentId: "agent-a",
      transcriptPath: path.join(tmpDir, "session-1.archived.jsonl"),
      label: "Long session",
      archivedAt: 10,
      originalWorkspaceId: null,
      originalFolderId: null,
      sessionsJsonSnapshot: entry,
    };
    fs.renameSync(
      path.join(tmpDir, "session-1.jsonl"),
      path.join(tmpDir, "session-1.archived.jsonl"),
    );
    fs.writeFileSync(indexPath, JSON.stringify({ version: 1, entries: [archiveEntry] }), "utf8");
    const manifest: SessionArchiveOperationManifest = {
      version: "1",
      operation: "session-archive",
      agentId: "agent-a",
      storeIdentity: "agent-a",
      canonicalKey: SESSION_KEY,
      expectedSessionId: "session-1",
      liveTranscriptPath: path.join(tmpDir, "session-1.jsonl"),
      archivedTranscriptPath: path.join(tmpDir, "session-1.archived.jsonl"),
      archiveIndexPath: indexPath,
      archiveEntry,
    };
    writeSessionMutationOperationIntent({
      storePath,
      operationId: "archive-op-recovery",
      manifest,
    });
    const recovered = await archiveSessionWithLifecycle({
      cfg,
      key: SESSION_KEY,
      operationId: "archive-op-recovery",
      target,
      entry,
      canonicalKey: SESSION_KEY,
    });
    expect(recovered.ok).toBe(true);
    expect(cleanupState.cleanup).toHaveBeenCalledTimes(1);
    expect(loadSessionStore(storePath)[SESSION_KEY]).toBeUndefined();
  });


  it("recovers a restore after the store row commits but before transcript/index finalization", async () => {
    const archived = await archiveSessionWithLifecycle({
      cfg,
      key: SESSION_KEY,
      operationId: "archive-op-restore-recovery",
      target,
      entry,
      canonicalKey: SESSION_KEY,
    });
    expect(archived.ok).toBe(true);
    const index = await readSessionArchiveIndex(resolveSessionArchiveIndexPath(storePath));
    const archiveEntry = index.entries[0];
    expect(archiveEntry).toBeTruthy();
    const restoredSessionId = "session-restored-2";
    const liveTranscriptPath = path.join(tmpDir, `${restoredSessionId}.jsonl`);
    const manifest: SessionRestoreOperationManifest = {
      version: "1",
      operation: "session-restore",
      agentId: "agent-a",
      storeIdentity: "agent-a",
      canonicalKey: SESSION_KEY,
      previousSessionId: "session-1",
      archivedTranscriptPath: archiveEntry.transcriptPath,
      liveTranscriptPath,
      archiveIndexPath: resolveSessionArchiveIndexPath(storePath),
      archiveEntry,
      restoredEntry: {
        ...(archiveEntry.sessionsJsonSnapshot as SessionEntry),
        sessionId: restoredSessionId,
        sessionFile: path.basename(liveTranscriptPath),
        updatedAt: 20,
      },
    };
    writeSessionMutationOperationIntent({
      storePath,
      operationId: "restore-op-recovery",
      manifest,
    });
    await updateSessionStore(storePath, (store) => {
      store[SESSION_KEY] = manifest.restoredEntry;
    });
    markSessionMutationOperationStoreCommitted({
      storePath,
      operationId: "restore-op-recovery",
    });
    const restoreTarget = {
      agentId: "agent-a",
      storePath,
      canonicalKey: SESSION_KEY,
      storeKeys: [SESSION_KEY],
      store: { [SESSION_KEY]: manifest.restoredEntry },
    } as never;
    const recovered = await restoreSessionWithLifecycle({
      cfg,
      key: SESSION_KEY,
      operationId: "restore-op-recovery",
      target: restoreTarget,
      canonicalKey: SESSION_KEY,
    });
    expect(recovered.ok).toBe(true);
    expect(fs.existsSync(liveTranscriptPath)).toBe(true);
    const after = await readSessionArchiveIndex(resolveSessionArchiveIndexPath(storePath));
    expect(after.entries).toEqual([]);
    expect(readSessionMutationOperationJournal(storePath, "restore-op-recovery")?.state).toBe("runtime_committed");
  });

  it("does not mutate transcript or store when the lifecycle finalizer fails", async () => {
    cleanupState.cleanup.mockResolvedValueOnce({
      error: { code: "UNAVAILABLE", message: "drain timed out" },
      settle,
    });
    const result = await archiveSessionWithLifecycle({
      cfg,
      key: SESSION_KEY,
      operationId: "archive-op-fail",
      target,
      entry,
      canonicalKey: SESSION_KEY,
    });
    expect(result).toMatchObject({ ok: false, code: "unavailable", retryable: true });
    expect(fs.existsSync(path.join(tmpDir, "session-1.jsonl"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "session-1.archived.jsonl"))).toBe(false);
    expect(loadSessionStore(storePath)[SESSION_KEY]?.sessionId).toBe("session-1");
    expect(settle).toHaveBeenCalledWith(false);
  });
});
