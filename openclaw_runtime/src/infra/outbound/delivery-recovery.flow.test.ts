import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeOpenClawStateDatabase } from "../../state/openclaw-state-db.js";
import { createMessageReceiptFromOutboundResults } from "../../channels/message/receipt.js";
import { upsertDeliveryQueueEntry } from "../delivery-queue-sqlite.js";

const transport = vi.hoisted(() => ({ reconcile: vi.fn() }));
vi.mock("./channel-resolution.js", () => ({
  resolveOutboundChannelMessageAdapter: () => ({
    durableFinal: {
      capabilities: { reconcileUnknownSend: true },
      reconcileUnknownSend: transport.reconcile,
    },
  }),
}));

import { computeBackoffMs, recoverPendingDeliveries } from "./delivery-queue-recovery.js";
import {
  ackDelivery,
  admitQueuedDeliveryRecovery,
  enqueueDelivery,
  finishQueuedDeliveryRecovery,
  loadPendingDelivery,
  markDeliveryPlatformOutcomeUnknown,
  type QueuedDelivery,
} from "./delivery-queue-storage.js";

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
let stateDir: string;

async function queued() {
  return await enqueueDelivery(
    {
      channel: "telegram",
      to: "fixture-chat",
      payloads: [{ text: "original answer" }],
      session: { key: "agent:main:delivery-proof" },
    },
    stateDir,
  );
}

async function recover(
  deliver = vi.fn().mockResolvedValue([{ channel: "telegram", messageId: "one" }]),
) {
  return await recoverPendingDeliveries({ cfg: {}, stateDir, deliver, log });
}

describe("final delivery recovery through the original SQLite queue", () => {
  beforeEach(() => {
    stateDir = mkdtempSync(path.join(tmpdir(), "delivery-owner-"));
    vi.stubEnv("OPENCLAW_STATE_DIR", stateDir);
    vi.stubEnv("OPENCLAW_RECOVERY_AUTHORITY_MODE", "authority");
    transport.reconcile.mockReset();
    vi.clearAllMocks();
  });
  afterEach(() => {
    closeOpenClawStateDatabase();
    vi.unstubAllEnvs();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it.each([undefined, false, true])(
    "retains unknown effect and payload when reconciliation retryable=%s",
    async (retryable) => {
      const id = await queued();
      await markDeliveryPlatformOutcomeUnknown(id, stateDir);
      transport.reconcile.mockResolvedValue({
        status: "unresolved",
        error: "no effect truth",
        retryable,
      });
      const deliver = vi.fn();
      await recover(deliver);
      const pending = await loadPendingDelivery(id, stateDir);
      expect(pending?.payloads).toEqual([{ text: "original answer" }]);
      expect(pending?.retryCount).toBe(0);
      expect(deliver).not.toHaveBeenCalled();
    },
  );

  it("persists the consumed recovery attempt before dispatch", async () => {
    const id = await queued();
    const deliver = vi.fn(async () => {
      const pending = await loadPendingDelivery(id, stateDir);
      expect(pending?.retryCount).toBe(1);
      expect(pending).toMatchObject({
        recoveryAdmission: {
          attempts: 1,
          state: "pending",
          decision: { entry: "final-delivery", kind: "deliver" },
        },
      });
      return [{ channel: "telegram", messageId: "one" }];
    });
    await recover(deliver);
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(await loadPendingDelivery(id, stateDir)).toBeNull();
  });

  it("settles an owner-proven applied effect without sending another message", async () => {
    const id = await queued();
    const entry = await loadPendingDelivery(id, stateDir);
    if (!entry) throw new Error("queue fixture missing");
    upsertDeliveryQueueEntry({
      queueName: "outbound",
      entry: { ...entry, recoveryEffect: "applied" } as QueuedDelivery,
      stateDir,
    });
    const deliver = vi.fn();
    await recover(deliver);
    expect(deliver).not.toHaveBeenCalled();
    expect(transport.reconcile).not.toHaveBeenCalled();
    expect(await loadPendingDelivery(id, stateDir)).toBeNull();
  });

  it("keeps an unknown effect pending after the original five-attempt ceiling", async () => {
    const id = await queued();
    await markDeliveryPlatformOutcomeUnknown(id, stateDir);
    const entry = await loadPendingDelivery(id, stateDir);
    if (!entry) throw new Error("queue fixture missing");
    upsertDeliveryQueueEntry({
      queueName: "outbound",
      entry: { ...entry, retryCount: 5 },
      stateDir,
    });
    transport.reconcile.mockResolvedValue({ status: "unresolved" });
    const deliver = vi.fn();
    await recover(deliver);
    expect((await loadPendingDelivery(id, stateDir))?.retryCount).toBe(5);
    expect(deliver).not.toHaveBeenCalled();
  });

  it("does not let an old reconciliation delete a replacement payload with the same queue id", async () => {
    const id = await queued();
    await markDeliveryPlatformOutcomeUnknown(id, stateDir);
    transport.reconcile.mockImplementation(async () => {
      const entry = await loadPendingDelivery(id, stateDir);
      if (!entry) throw new Error("queue fixture missing");
      const replacement: QueuedDelivery = {
        ...entry,
        payloads: [{ text: "new answer" }],
        enqueuedAt: entry.enqueuedAt + 1,
      };
      upsertDeliveryQueueEntry({
        queueName: "outbound",
        entry: replacement,
        stateDir,
      });
      return {
        status: "sent",
        receipt: createMessageReceiptFromOutboundResults({
          results: [{ messageId: "old-message" }],
        }),
      };
    });
    const deliver = vi.fn();
    await recover(deliver);
    expect((await loadPendingDelivery(id, stateDir))?.payloads).toEqual([{ text: "new answer" }]);
    expect(deliver).not.toHaveBeenCalled();
  });

  it("continues scanning when another owner settles a row during reconciliation", async () => {
    const id = await queued();
    await markDeliveryPlatformOutcomeUnknown(id, stateDir);
    const secondId = await queued();
    transport.reconcile.mockImplementation(async () => {
      await ackDelivery(id, stateDir);
      return {
        status: "sent",
        receipt: createMessageReceiptFromOutboundResults({
          results: [{ messageId: "original-message" }],
        }),
      };
    });
    const deliver = vi.fn().mockResolvedValue([{ channel: "telegram", messageId: "next-message" }]);
    await expect(recover(deliver)).resolves.toMatchObject({ recovered: 1 });
    expect(deliver).toHaveBeenCalledOnce();
    expect(await loadPendingDelivery(id, stateDir)).toBeNull();
    expect(await loadPendingDelivery(secondId, stateDir)).toBeNull();
  });

  it("treats a queue row settled between load and admission as already gone", async () => {
    const id = await queued();
    const entry = await loadPendingDelivery(id, stateDir);
    if (!entry) throw new Error("queue fixture missing");
    await ackDelivery(id, stateDir);
    expect(admitQueuedDeliveryRecovery(entry, stateDir)).toBeNull();
  });

  it("rebinds an exited unknown send to one reconciliation owner and releases each completed scan", async () => {
    const id = await queued();
    const entry = await loadPendingDelivery(id, stateDir);
    if (!entry) throw new Error("reconciliation ownership queue fixture missing");
    const dispatched = admitQueuedDeliveryRecovery(entry, stateDir);
    if (!dispatched?.admitted) throw new Error("reconciliation ownership fixture was not admitted");
    // Controlled predecessor identity; the separate process driver proves actual PID exit.
    const exited: QueuedDelivery = {
      ...dispatched.entry,
      recoveryEffect: "unknown",
      activeSendProcessId: undefined,
      lastAttemptAt: Date.now() - computeBackoffMs(2) - 1,
      recoveryAdmission: {
        ...dispatched.record,
        processId: 2_147_483_647,
        ownerEpoch: "exited-fixture-owner",
      },
    };
    upsertDeliveryQueueEntry({ queueName: "outbound", stateDir, entry: exited });
    const observer = admitQueuedDeliveryRecovery(exited, stateDir);
    expect(observer).toMatchObject({
      admitted: false,
      decision: { kind: "reconcile" },
      record: { processId: process.pid, attempts: 1 },
      entry: { activeSendProcessId: process.pid, retryCount: 1 },
    });
    if (!observer) throw new Error("reconciliation ownership fixture missing its observer");
    expect(admitQueuedDeliveryRecovery(observer.entry, stateDir)).toBeNull();
    finishQueuedDeliveryRecovery(observer.entry, "fixture scan completed", stateDir);
    transport.reconcile.mockResolvedValueOnce({ status: "unresolved" });
    const deliver = vi.fn(async () => {
      expect(await loadPendingDelivery(id, stateDir)).toMatchObject({
        recoveryAdmission: { processId: process.pid, attempts: 2, decision: { kind: "deliver" } },
      });
      return [{ channel: "telegram", messageId: "one" }];
    });
    await recover(deliver);
    expect((await loadPendingDelivery(id, stateDir))?.activeSendProcessId).toBeUndefined();
    transport.reconcile.mockResolvedValueOnce({ status: "not_sent" });
    expect((await recover(deliver)).recovered).toBe(1);
    expect(transport.reconcile).toHaveBeenCalledTimes(2);
    expect(deliver).toHaveBeenCalledOnce();
    expect(await loadPendingDelivery(id, stateDir)).toBeNull();
  });
});
