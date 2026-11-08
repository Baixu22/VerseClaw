import { mkdtempSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeOpenClawAgentDatabasesForTest } from "../state/openclaw-agent-db.js";
import { updateSessionStore, updateSessionStoreEntry, loadSessionStore } from "./sessions/store.js";
import type { SessionEntry } from "./sessions/types.js";
import {
  prepareOwnerRecoveryAdmission,
  buildRecoveryAdmissionKey,
} from "../agents/recovery-authority/owner-admission.js";
import {
  loadSqliteSessionStore,
  mutateSqliteSessionStoreAtomic,
  resolveSqliteSessionStoreDatabasePath,
} from "./sessions/store-sqlite.js";

const interleave = vi.hoisted(() => ({ afterRead: undefined as undefined | (() => void) }));
vi.mock("./sessions/skill-prompt-blobs.js", () => ({
  hydrateSessionStoreSkillPromptRefs: () => {
    const callback = interleave.afterRead;
    interleave.afterRead = undefined;
    callback?.();
    return false;
  },
}));

let dir: string;
let storePath: string;
beforeEach(() => {
  interleave.afterRead = undefined;
  vi.stubEnv("OPENCLAW_SESSION_CACHE_TTL_MS", "60000");
  dir = mkdtempSync(join(tmpdir(), "session-admission-"));
  storePath = join(dir, "sessions.json");
  mutateSqliteSessionStoreAtomic(storePath, (store) => {
    store.owner = { sessionId: "generation", updatedAt: 1, abortedLastRun: true };
  });
});
afterEach(() => {
  closeOpenClawAgentDatabasesForTest();
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe("session writes beside atomic owner admission", () => {
  it("invalidates a no-op cache when the owner changes after the SQLite read", async () => {
    mutateSqliteSessionStoreAtomic(storePath, (store) => {
      store.owner.lifecycleRunId = "before";
    });
    interleave.afterRead = () => {
      mutateSqliteSessionStoreAtomic(storePath, (store) => {
        store.owner.lifecycleRunId = "after";
      });
      const changed = new Date(Date.now() + 5000);
      utimesSync(resolveSqliteSessionStoreDatabasePath(storePath), changed, changed);
    };
    await updateSessionStore(storePath, () => false, {
      skipMaintenance: true,
      skipSaveWhenResult: () => true,
    });
    expect(loadSessionStore(storePath).owner.lifecycleRunId).toBe("after");
  });
  it("preserves a concurrently reserved owner and new entries when another key changes", async () => {
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const metadata = updateSessionStore(
      storePath,
      async (store) => {
        store.metadata = { sessionId: "metadata", updatedAt: 2 };
        entered();
        await waiting;
      },
      { skipMaintenance: true },
    );
    await ready;
    mutateSqliteSessionStoreAtomic(storePath, (store) => {
      store.owner.lifecycleRunId = "admitted-run";
      store.newcomer = { sessionId: "newcomer", updatedAt: 3 };
    });
    release();
    await metadata;
    const current = loadSqliteSessionStore(storePath);
    expect(current.owner.lifecycleRunId).toBe("admitted-run");
    expect(current.newcomer.sessionId).toBe("newcomer");
    expect(current.metadata.sessionId).toBe("metadata");
  });

  it.each(["store", "entry"] as const)(
    "rejects a stale %s facade write to the reserved owner",
    async (writer) => {
      let release!: () => void;
      const waiting = new Promise<void>((resolve) => {
        release = resolve;
      });
      let entered!: () => void;
      const ready = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const mutate = async (entry: SessionEntry) => {
        entry.abortedLastRun = false;
        entered();
        await waiting;
        return { abortedLastRun: false };
      };
      const stale =
        writer === "store"
          ? updateSessionStore(
              storePath,
              async (store) => {
                await mutate(store.owner);
              },
              { skipMaintenance: true },
            )
          : updateSessionStoreEntry({
              storePath,
              sessionKey: "owner",
              update: mutate,
              skipMaintenance: true,
            });
      await ready;
      mutateSqliteSessionStoreAtomic(storePath, (store) => {
        store.owner.lifecycleRunId = "admitted-run";
      });
      const rejected = expect(stale).rejects.toThrow("session store revision conflict for owner");
      release();
      await rejected;
      expect(loadSqliteSessionStore(storePath).owner).toMatchObject({
        lifecycleRunId: "admitted-run",
        abortedLastRun: true,
      });
    },
  );

  it("preserves an interrupted running owner during enforced metadata maintenance", async () => {
    mutateSqliteSessionStoreAtomic(storePath, (store) => {
      store.owner.status = "running";
    });
    await updateSessionStore(
      storePath,
      (store) => {
        store.metadata = { sessionId: "metadata", updatedAt: Date.now() };
      },
      {
        activeSessionKey: "metadata",
        maintenanceOverride: { mode: "enforce", pruneAfterMs: 0, maxEntries: 1 },
      },
    );
    expect(loadSqliteSessionStore(storePath).owner).toMatchObject({
      status: "running",
      abortedLastRun: true,
      sessionId: "generation",
    });
  });

  it("keeps legacy metadata migration in the async writer", async () => {
    mutateSqliteSessionStoreAtomic(storePath, (store) => {
      Object.assign(store.owner, { provider: "telegram", room: "old-room" });
    });
    await updateSessionStore(
      storePath,
      (store) => {
        expect(store.owner.channel).toBe("telegram");
        expect(store.owner.groupChannel).toBe("old-room");
      },
      { skipMaintenance: true },
    );
    const current = loadSqliteSessionStore(storePath).owner;
    expect(current.channel).toBe("telegram");
    expect(current).not.toHaveProperty("provider");
  });

  it("reclaims a completed cancellation during enforced maintenance", async () => {
    mutateSqliteSessionStoreAtomic(storePath, (store) => {
      store.owner.status = "killed";
      store.owner.endedAt = 2;
    });
    await updateSessionStore(
      storePath,
      (store) => {
        store.metadata = { sessionId: "metadata", updatedAt: Date.now() };
      },
      {
        activeSessionKey: "metadata",
        maintenanceOverride: { mode: "enforce", pruneAfterMs: 0, maxEntries: 1 },
      },
    );
    expect(loadSqliteSessionStore(storePath)).not.toHaveProperty("owner");
  });

  it("retains an unknown recovery reservation after an early terminal callback", async () => {
    const admission = prepareOwnerRecoveryAdmission({
      requestId: "unknown-ack",
      entry: "subagent-orphan",
      owner: {
        kind: "subagent-run",
        ownerId: "original-run",
        runId: "original-run",
        sessionKey: "owner",
      },
      admission: {
        trigger: "gateway-restart",
        requiredPreState: "active-subagent-run",
        admitted: true,
        visibleOutputObserved: false,
      },
      budget: {
        attempts: { current: 1, max: 2 },
        backoff: { initialMs: 5000, multiplier: 2 },
        wedge: { afterAttempts: 2, wedged: false },
      },
      replayClass: "reconcile",
      effect: "unknown",
      requestedAction: "resume",
      idempotencyKey: buildRecoveryAdmissionKey(
        "subagent-orphan",
        "original-run",
        "generation",
        "original-run",
      ),
      evidence: [],
      requestedAt: Date.now(),
    });
    mutateSqliteSessionStoreAtomic(storePath, (store) => {
      store.owner.status = "killed";
      store.owner.endedAt = 2;
      store.owner.abortedLastRun = false;
      store.owner.subagentRecovery = { authority: admission.record };
    });
    await updateSessionStore(
      storePath,
      (store) => {
        store.metadata = { sessionId: "metadata", updatedAt: Date.now() };
      },
      {
        activeSessionKey: "metadata",
        maintenanceOverride: { mode: "enforce", pruneAfterMs: 0, maxEntries: 1 },
      },
    );
    expect(loadSqliteSessionStore(storePath).owner?.subagentRecovery?.authority).toEqual(
      admission.record,
    );
  });
});
