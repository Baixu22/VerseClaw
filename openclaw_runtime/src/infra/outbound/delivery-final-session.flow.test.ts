// Production durable send and recovery, with a controlled channel transport and real Session/queue SQLite.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadSessionStore,
  type SessionEntry,
  updateSessionStoreAtomic,
} from "../../config/sessions.js";
import { pendingFinalDeliveryIdentity } from "../../agents/recovery-authority/final-delivery-session.js";
import { closeOpenClawStateDatabase } from "../../state/openclaw-state-db.js";
import { closeOpenClawAgentDatabasesForTest } from "../../state/openclaw-agent-db.js";
import { closeTrackedSqliteHandlesUnder } from "../node-sqlite.js";

const transport = vi.hoisted(() => ({
  send: vi.fn(),
  reconcile: vi.fn(),
  commit: vi.fn(),
  prepare: vi.fn(),
}));
vi.mock("../../channels/plugins/outbound/load.js", () => ({
  loadChannelOutboundAdapter: async () => {
    await transport.prepare();
    return { deliveryMode: "direct", sendText: transport.send };
  },
}));
vi.mock("./channel-resolution.js", () => ({
  resolveOutboundChannelMessageAdapter: () => ({
    send: { text: transport.send, lifecycle: { afterCommit: transport.commit } },
    durableFinal: {
      capabilities: { reconcileUnknownSend: true },
      reconcileUnknownSend: transport.reconcile,
    },
  }),
}));
vi.mock("../../plugins/hook-runner-global.js", () => ({ getGlobalHookRunner: () => undefined }));

import { sendDurableMessageBatch } from "../../channels/message/send.js";
import { createMessageReceiptFromOutboundResults } from "../../channels/message/receipt.js";
import { deliverOutboundPayloadsInternal } from "./deliver.js";
import { computeBackoffMs, recoverPendingDeliveries } from "./delivery-queue-recovery.js";
import {
  ackDelivery,
  admitQueuedDeliveryRecovery,
  enqueueDelivery,
  loadPendingDeliveries,
  loadPendingDelivery,
  type QueuedDelivery,
} from "./delivery-queue-storage.js";
import { getRecoveryAdmissionIdentity } from "../../agents/recovery-authority/owner-admission.js";
import { upsertDeliveryQueueEntry } from "../delivery-queue-sqlite.js";

const key = "agent:main:final-session-proof";
const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
let stateDir: string;
let storePath: string;
let original: SessionEntry;

function session() {
  return loadSessionStore(storePath, { skipCache: true })[key];
}

function send() {
  return sendDurableMessageBatch({
    cfg: {},
    channel: "telegram",
    to: "fixture-chat",
    payloads: [{ text: "original answer" }],
    session: { key },
    durability: "required",
    deliveryQueueStateDir: stateDir,
    pendingFinalDelivery: {
      storePath,
      sessionKey: key,
      expected: pendingFinalDeliveryIdentity(original),
    },
  });
}

async function recover() {
  return await recoverPendingDeliveries({
    cfg: {},
    stateDir,
    deliver: deliverOutboundPayloadsInternal,
    log,
  });
}

async function replaceReply(change: Partial<SessionEntry>) {
  await updateSessionStoreAtomic(storePath, (store) => {
    store[key] = { ...store[key], ...change, updatedAt: Date.now() };
  });
}

async function failedSend() {
  transport.send.mockRejectedValueOnce(new Error("platform outcome unknown"));
  expect((await send()).status).toBe("failed");
  const pending = (await loadPendingDeliveries(stateDir))[0];
  if (!pending) throw new Error("failed send fixture did not retain its queue intent");
  return pending;
}

describe("final Session reply bound to the original durable send intent", () => {
  beforeEach(async () => {
    stateDir = mkdtempSync(path.join(tmpdir(), "delivery-final-session-"));
    storePath = path.join(stateDir, "agents", "main", "sessions", "sessions.json");
    vi.stubEnv("OPENCLAW_STATE_DIR", stateDir);
    vi.stubEnv("OPENCLAW_RECOVERY_AUTHORITY_MODE", "authority");
    vi.stubEnv("OPENCLAW_DISABLE_BUNDLED_PLUGINS", "1");
    original = {
      sessionId: "original-session",
      updatedAt: 1,
      lifecycleRunId: "producer-run",
      pendingFinalDelivery: true,
      pendingFinalDeliveryRunId: "producer-run",
      pendingFinalDeliveryText: "original answer",
      pendingFinalDeliveryCreatedAt: 1,
      pendingFinalDeliveryContext: { channel: "telegram", to: "fixture-chat" },
    };
    await updateSessionStoreAtomic(storePath, (store) => {
      store[key] = original;
    });
    transport.send.mockReset().mockResolvedValue({ messageId: "fixture-message" });
    transport.reconcile.mockReset();
    transport.commit.mockReset();
    transport.prepare.mockReset();
  });
  afterEach(() => {
    closeOpenClawAgentDatabasesForTest();
    closeOpenClawStateDatabase();
    closeTrackedSqliteHandlesUnder(stateDir);
    vi.unstubAllEnvs();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it("commits the queue and Session reference before the actual send, then settles both", async () => {
    transport.send.mockImplementationOnce(async () => {
      const intentId = session().pendingFinalDeliveryIntentId;
      expect(intentId).toBeTruthy();
      const pending = await loadPendingDelivery(intentId!, stateDir);
      expect(pending).toMatchObject({
        recoveryEffect: "unknown",
        pendingFinalDelivery: {
          expected: { sessionId: "original-session", pendingFinalDeliveryIntentId: intentId },
        },
      });
      return { messageId: "fixture-message" };
    });
    expect((await send()).status).toBe("sent");
    expect(session().pendingFinalDeliveryText).toBeUndefined();
    expect(await loadPendingDeliveries(stateDir)).toEqual([]);
    expect(transport.send).toHaveBeenCalledOnce();
    expect(transport.commit).toHaveBeenCalledOnce();
  });

  it("retains the same Session text and intent when platform reconciliation is unresolved", async () => {
    const pending = await failedSend();
    transport.reconcile.mockResolvedValue({ status: "unresolved", retryable: false });
    await recover();
    expect(session()).toMatchObject({
      pendingFinalDeliveryText: "original answer",
      pendingFinalDeliveryIntentId: pending.id,
    });
    expect((await loadPendingDelivery(pending.id, stateDir))?.payloads).toEqual([
      { text: "original answer" },
    ]);
    expect(transport.send).toHaveBeenCalledOnce();
  });

  it("settles an adapter-confirmed send without sending or regenerating the reply", async () => {
    const pending = await failedSend();
    transport.reconcile.mockResolvedValue({
      status: "sent",
      receipt: createMessageReceiptFromOutboundResults({
        results: [{ messageId: "fixture-message" }],
      }),
    });
    expect((await recover()).recovered).toBe(1);
    expect(session().pendingFinalDeliveryText).toBeUndefined();
    expect(await loadPendingDelivery(pending.id, stateDir)).toBeNull();
    expect(transport.send).toHaveBeenCalledOnce();
    expect(transport.commit).toHaveBeenCalledOnce();
  });

  it("retains an authority-created unknown intent after rollback before its first recovery scan", async () => {
    const pending = await failedSend();
    expect(pending.recoveryAdmission).toBeUndefined();
    vi.stubEnv("OPENCLAW_RECOVERY_AUTHORITY_MODE", "legacy");
    transport.reconcile.mockResolvedValue({ status: "unresolved", retryable: false });
    await recover();
    expect(await loadPendingDelivery(pending.id, stateDir)).not.toBeNull();
    expect(session().pendingFinalDeliveryText).toBe("original answer");
    expect(transport.send).toHaveBeenCalledOnce();
  });

  it("keeps the existing legacy queue path for a new legacy send", async () => {
    vi.stubEnv("OPENCLAW_RECOVERY_AUTHORITY_MODE", "legacy");
    transport.send.mockRejectedValueOnce(new Error("legacy outcome unknown"));
    const result = await sendDurableMessageBatch({
      cfg: {},
      channel: "telegram",
      to: "fixture-chat",
      payloads: [{ text: "legacy answer" }],
      deliveryQueueStateDir: stateDir,
    });
    expect(result.status).toBe("failed");
    const pending = (await loadPendingDeliveries(stateDir))[0];
    if (!pending) throw new Error("legacy queue fixture missing");
    expect(pending.recoveryEffect).toBeUndefined();
    expect(pending.recoveryAdmission).toBeUndefined();
    transport.reconcile.mockResolvedValue({ status: "unresolved", retryable: false });
    upsertDeliveryQueueEntry({
      queueName: "outbound",
      stateDir,
      entry: {
        ...pending,
        lastAttemptAt: Date.now() - computeBackoffMs(pending.retryCount + 1) - 1,
      },
    });
    await recover();
    expect(await loadPendingDelivery(pending.id, stateDir)).toBeNull();
    expect(transport.send).toHaveBeenCalledOnce();
  });

  it("binds an unstarted queue intent after a crash before the initial Session reference", async () => {
    const id = await enqueueDelivery(
      {
        channel: "telegram",
        to: "fixture-chat",
        payloads: [{ text: "original answer" }],
        session: { key },
        pendingFinalDelivery: {
          storePath,
          sessionKey: key,
          expected: pendingFinalDeliveryIdentity(original),
        },
      },
      stateDir,
    );
    expect(session().pendingFinalDeliveryIntentId).toBeUndefined();
    expect((await recover()).recovered).toBe(1);
    expect(await loadPendingDelivery(id, stateDir)).toBeNull();
    expect(session().pendingFinalDeliveryText).toBeUndefined();
    expect(transport.send).toHaveBeenCalledOnce();
  });

  it("retains a pending reply when an abort happens after platform send has started", async () => {
    transport.send.mockRejectedValueOnce(
      new DOMException("platform outcome unknown", "AbortError"),
    );
    expect((await send()).status).toBe("failed");
    expect(session().pendingFinalDeliveryText).toBe("original answer");
    expect((await loadPendingDeliveries(stateDir))[0]).toMatchObject({ recoveryEffect: "unknown" });
  });

  it("preserves a partially sent batch as unknown without replaying the applied prefix", async () => {
    original = { ...original, pendingFinalDeliveryText: "first\n\nsecond" };
    await updateSessionStoreAtomic(storePath, (store) => {
      store[key] = original;
    });
    transport.send
      .mockResolvedValueOnce({ messageId: "first-message" })
      .mockRejectedValueOnce(new Error("second outcome unknown"));
    const result = await sendDurableMessageBatch({
      cfg: {},
      channel: "telegram",
      to: "fixture-chat",
      payloads: [{ text: "first" }, { text: "second" }],
      bestEffort: true,
      deliveryQueueStateDir: stateDir,
      pendingFinalDelivery: {
        storePath,
        sessionKey: key,
        expected: pendingFinalDeliveryIdentity(original),
      },
    });
    expect(result.status).toBe("partial_failed");
    const pending = (await loadPendingDeliveries(stateDir))[0];
    if (!pending) throw new Error("partial send fixture did not retain its queue intent");
    expect(pending).toMatchObject({ recoveryEffect: "unknown" });
    transport.reconcile.mockResolvedValue({ status: "unresolved", retryable: false });
    await recover();
    expect(transport.send).toHaveBeenCalledTimes(2);
    expect(session().pendingFinalDeliveryText).toBe("first\n\nsecond");
    expect(await loadPendingDelivery(pending.id, stateDir)).not.toBeNull();
  });

  it.each([true, false])(
    "commits direct recovery hooks only for a complete batch: partial=%s",
    async (partial) => {
      const payloads = [{ text: "first" }, { text: "second" }];
      const id = await enqueueDelivery(
        { channel: "telegram", to: "fixture-chat", payloads, bestEffort: true },
        stateDir,
      );
      const entry = await loadPendingDelivery(id, stateDir);
      if (!entry) throw new Error("direct recovery queue fixture missing");
      const prepared = admitQueuedDeliveryRecovery(entry, stateDir);
      if (!prepared?.admitted) throw new Error("direct recovery fixture was not admitted");
      transport.send.mockResolvedValueOnce({ messageId: "first-message" });
      if (partial) transport.send.mockRejectedValueOnce(new Error("second outcome unknown"));
      const results = await deliverOutboundPayloadsInternal({
        cfg: {},
        channel: "telegram",
        to: "fixture-chat",
        payloads,
        bestEffort: true,
        deliveryQueueId: id,
        deliveryQueueStateDir: stateDir,
        skipQueue: true,
        recoveryAdmission: getRecoveryAdmissionIdentity(prepared.record),
      });
      expect(transport.send).toHaveBeenCalledTimes(2);
      expect(results).toHaveLength(partial ? 1 : 2);
      expect((await loadPendingDelivery(id, stateDir))?.recoveryEffect).toBe(
        partial ? "unknown" : "applied",
      );
      expect(transport.commit).toHaveBeenCalledTimes(partial ? 0 : 2);
    },
  );

  it.each([
    {
      pendingFinalDeliveryText: "new answer",
      pendingFinalDeliveryRunId: "new-run",
      pendingFinalDeliveryCreatedAt: 2,
      pendingFinalDeliveryIntentId: "new-intent",
    },
    { sessionId: "replacement-session", pendingFinalDeliveryIntentId: "new-intent" },
  ])(
    "preserves a replaced reply or Session when the old reconciliation finishes: %j",
    async (replacement) => {
      const pending = await failedSend();
      transport.reconcile.mockImplementation(async () => {
        await replaceReply(replacement);
        return {
          status: "sent",
          receipt: createMessageReceiptFromOutboundResults({
            results: [{ messageId: "fixture-message" }],
          }),
        };
      });
      await recover();
      expect(session()).toMatchObject({ ...replacement, pendingFinalDelivery: true });
      expect(await loadPendingDelivery(pending.id, stateDir)).toBeNull();
      expect(transport.send).toHaveBeenCalledOnce();
    },
  );

  it("preserves the original backoff and budget after an unknown send is proved not sent", async () => {
    const pending = await failedSend();
    transport.reconcile.mockResolvedValue({ status: "not_sent" });
    expect((await recover()).deferredBackoff).toBe(1);
    expect(transport.send).toHaveBeenCalledOnce();
    const deferred = await loadPendingDelivery(pending.id, stateDir);
    expect(deferred?.retryCount).toBe(1);
    if (!deferred) throw new Error("deferred send fixture missing");
    upsertDeliveryQueueEntry({
      queueName: "outbound",
      stateDir,
      entry: {
        ...deferred,
        lastAttemptAt: Date.now() - computeBackoffMs(deferred.retryCount + 1) - 1,
      },
    });
    expect((await recover()).recovered).toBe(1);
    expect(transport.send).toHaveBeenCalledTimes(2);
    expect(await loadPendingDelivery(pending.id, stateDir)).toBeNull();
    expect(session().pendingFinalDeliveryText).toBeUndefined();
  });

  it("rejects a stale producer before platform send and retains the newer pending reply", async () => {
    await replaceReply({
      pendingFinalDeliveryText: "new answer",
      pendingFinalDeliveryRunId: "new-run",
      pendingFinalDeliveryCreatedAt: 2,
    });
    expect((await send()).status).toBe("failed");
    expect(transport.send).not.toHaveBeenCalled();
    expect(session().pendingFinalDeliveryText).toBe("new answer");
    expect(await loadPendingDeliveries(stateDir)).toEqual([]);
  });

  it("rejects a stale recovery admission before sending with best-effort queue policy", async () => {
    const id = await enqueueDelivery(
      { channel: "telegram", to: "fixture-chat", payloads: [{ text: "original answer" }] },
      stateDir,
    );
    const entry = await loadPendingDelivery(id, stateDir);
    if (!entry) throw new Error("stale admission queue fixture missing");
    const prepared = admitQueuedDeliveryRecovery(entry, stateDir);
    if (!prepared?.admitted) throw new Error("stale admission fixture was not admitted");
    transport.prepare.mockImplementationOnce(async () => {
      const replacement: QueuedDelivery = {
        ...prepared.entry,
        payloads: [{ text: "new answer" }],
        enqueuedAt: prepared.entry.enqueuedAt + 1,
        recoveryAdmission: undefined,
        retryCount: 0,
        recoveryEffect: "not_applied",
      };
      upsertDeliveryQueueEntry({ queueName: "outbound", stateDir, entry: replacement });
    });
    await expect(
      deliverOutboundPayloadsInternal({
        cfg: {},
        channel: "telegram",
        to: "fixture-chat",
        payloads: [{ text: "original answer" }],
        deliveryQueueId: id,
        deliveryQueueStateDir: stateDir,
        skipQueue: true,
        queuePolicy: "best_effort",
        recoveryAdmission: getRecoveryAdmissionIdentity(prepared.record),
      }),
    ).rejects.toThrow("no longer owns its intent");
    expect(transport.send).not.toHaveBeenCalled();
    expect((await loadPendingDelivery(id, stateDir))?.payloads).toEqual([{ text: "new answer" }]);
  });

  it.each(["authority", "legacy"])(
    "handles an initial best-effort queue write failure in %s mode",
    async (mode) => {
      vi.stubEnv("OPENCLAW_RECOVERY_AUTHORITY_MODE", mode);
      const invalidStateDir = path.join(stateDir, "invalid-state-dir");
      writeFileSync(invalidStateDir, "not a directory");
      const result = await sendDurableMessageBatch({
        cfg: {},
        channel: "telegram",
        to: "fixture-chat",
        payloads: [{ text: "original answer" }],
        durability: "best_effort",
        deliveryQueueStateDir: invalidStateDir,
      });
      expect(result.status).toBe(mode === "authority" ? "failed" : "sent");
      expect(transport.send).toHaveBeenCalledTimes(mode === "authority" ? 0 : 1);
    },
  );

  it("stops an initial authority send when its platform boundary write loses the queue row", async () => {
    transport.prepare.mockImplementationOnce(async () => {
      const [pending] = await loadPendingDeliveries(stateDir);
      if (!pending) throw new Error("initial boundary queue fixture missing");
      await ackDelivery(pending.id, stateDir);
    });
    const result = await sendDurableMessageBatch({
      cfg: {},
      channel: "telegram",
      to: "fixture-chat",
      payloads: [{ text: "original answer" }],
      durability: "best_effort",
      deliveryQueueStateDir: stateDir,
    });
    expect(result.status).toBe("failed");
    expect(transport.send).not.toHaveBeenCalled();
  });

  it("retains applied truth while an altered Session still references the original intent", async () => {
    transport.send.mockImplementationOnce(async () => {
      await replaceReply({
        pendingFinalDeliveryText: "new answer",
        pendingFinalDeliveryRunId: "new-run",
        pendingFinalDeliveryCreatedAt: 2,
      });
      return { messageId: "fixture-message" };
    });
    expect((await send()).status).toBe("sent");
    const id = session().pendingFinalDeliveryIntentId;
    expect(id).toBeTruthy();
    expect(await loadPendingDelivery(id!, stateDir)).toMatchObject({ recoveryEffect: "applied" });
    await recover();
    expect(await loadPendingDelivery(id!, stateDir)).toMatchObject({ recoveryEffect: "applied" });
    expect(session().pendingFinalDeliveryText).toBe("new answer");
    expect(transport.send).toHaveBeenCalledOnce();
    await replaceReply({ pendingFinalDeliveryIntentId: "new-intent" });
    await recover();
    expect(await loadPendingDelivery(id!, stateDir)).toBeNull();
    expect(session().pendingFinalDeliveryIntentId).toBe("new-intent");
    expect(transport.send).toHaveBeenCalledOnce();
  });

  it("lets the newer producer send after the old unstarted intent loses its Session binding", async () => {
    const id = await enqueueDelivery(
      {
        channel: "telegram",
        to: "fixture-chat",
        payloads: [{ text: "original answer" }],
        pendingFinalDelivery: {
          storePath,
          sessionKey: key,
          expected: pendingFinalDeliveryIdentity(original),
        },
      },
      stateDir,
    );
    await replaceReply({
      pendingFinalDeliveryText: "new answer",
      pendingFinalDeliveryRunId: "new-run",
      pendingFinalDeliveryCreatedAt: 2,
      pendingFinalDeliveryIntentId: undefined,
    });
    await recover();
    expect(await loadPendingDelivery(id, stateDir)).toBeNull();
    expect(transport.send).not.toHaveBeenCalled();
    expect(session().pendingFinalDeliveryText).toBe("new answer");
    const result = await sendDurableMessageBatch({
      cfg: {},
      channel: "telegram",
      to: "fixture-chat",
      payloads: [{ text: "new answer" }],
      durability: "required",
      deliveryQueueStateDir: stateDir,
      pendingFinalDelivery: {
        storePath,
        sessionKey: key,
        expected: pendingFinalDeliveryIdentity(session()),
      },
    });
    expect(result.status).toBe("sent");
    expect(transport.send).toHaveBeenCalledOnce();
    expect(session().pendingFinalDeliveryText).toBeUndefined();
  });
});
