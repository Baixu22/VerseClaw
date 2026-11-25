import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  loaded: [] as string[],
  recover: vi.fn(async (_options: unknown) => {}),
  send: vi.fn(async (_payload: unknown) => ["sent"]),
  pending: vi.fn(async () => [] as Array<{ enqueuedAt: number }>),
  continueSessions: vi.fn(async (_options: unknown) => {}),
}));
vi.mock("../infra/heartbeat-runner.js", () => ({
  startHeartbeatRunner: () => ({ stop: vi.fn(), updateConfig: vi.fn() }),
}));
vi.mock("./runtime-memory-consolidation-service.js", () => ({
  startRuntimeMemoryConsolidationService: () => ({ stop: vi.fn() }),
}));
vi.mock("./model-pricing-config.js", () => ({ isGatewayModelPricingEnabled: () => false }));
vi.mock("../infra/outbound/delivery-queue.js", () => ({ recoverPendingDeliveries: state.recover }));
vi.mock("../infra/outbound/deliver.js", () => {
  state.loaded.push("sender");
  return { deliverOutboundPayloadsInternal: state.send };
});
vi.mock("../infra/session-delivery-queue.js", () => ({
  loadPendingSessionDeliveries: state.pending,
}));
vi.mock("./server-restart-sentinel.js", () => {
  state.loaded.push("reply");
  return { recoverPendingRestartContinuationDeliveries: state.continueSessions };
});
import { activateGatewayScheduledServices } from "./server-runtime-services.js";

function start() {
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() };
  log.child.mockReturnValue(log);
  const deps = {};
  const cfg = {};
  const handles = activateGatewayScheduledServices({
    minimalTestGateway: false,
    cfgAtStart: cfg,
    deps,
    sessionDeliveryRecoveryMaxEnqueuedAt: 100,
    cron: { start: async () => {} },
    startCron: false,
    logCron: { error: vi.fn() },
    log,
  });
  return { log, deps, cfg, handles };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  state.recover.mockResolvedValue(undefined);
  state.pending.mockResolvedValue([]);
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

it("leaves send and reply runtimes unloaded for empty startup queues", async () => {
  const { cfg } = start();
  await vi.dynamicImportSettled();
  expect(state.recover).toHaveBeenCalledWith(expect.objectContaining({ cfg }));
  await vi.advanceTimersByTimeAsync(1250);
  await vi.dynamicImportSettled();
  expect(state.pending).toHaveBeenCalledOnce();
  expect(state.loaded).toEqual([]);
  expect(state.send).not.toHaveBeenCalled();
  expect(state.continueSessions).not.toHaveBeenCalled();
});

it("forwards the queue owner's exact admitted payload and result to the sender", async () => {
  const payload = {
    cfg: {},
    channel: "telegram",
    to: "chat",
    payloads: [],
    recoveryAdmission: { ownerId: "original" },
  };
  let result: unknown;
  state.recover.mockImplementationOnce(async (options) => {
    result = await (options as { deliver: (payload: unknown) => Promise<unknown> }).deliver(
      payload,
    );
  });
  start();
  await vi.dynamicImportSettled();
  expect(state.send).toHaveBeenCalledExactlyOnceWith(payload);
  expect(result).toEqual(["sent"]);
  expect(state.loaded).toEqual(["sender"]);
});

it("preserves the startup cutoff and invokes the existing continuation owner", async () => {
  state.pending.mockResolvedValue([{ enqueuedAt: 100 }]);
  const { deps, log } = start();
  await vi.advanceTimersByTimeAsync(1250);
  await vi.dynamicImportSettled();
  expect(state.continueSessions).toHaveBeenCalledExactlyOnceWith({ deps, log, maxEnqueuedAt: 100 });
});

it("leaves post-startup entries to their producer and reports queue read errors", async () => {
  state.pending.mockResolvedValueOnce([{ enqueuedAt: 101 }]);
  const first = start();
  await vi.advanceTimersByTimeAsync(1250);
  await vi.dynamicImportSettled();
  expect(state.continueSessions).not.toHaveBeenCalled();
  expect(first.log.error).not.toHaveBeenCalled();

  state.pending.mockRejectedValueOnce(new Error("queue read failed"));
  const second = start();
  await vi.advanceTimersByTimeAsync(1250);
  await vi.dynamicImportSettled();
  expect(second.log.error).toHaveBeenCalledWith(
    "Session delivery recovery failed: Error: queue read failed",
  );
  expect(state.continueSessions).not.toHaveBeenCalled();
});
