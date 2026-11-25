import { beforeEach, expect, it, vi } from "vitest";
import type { HealthSummary } from "../health-summary.js";
import type { GatewayEventLoopHealth } from "./event-loop-health.js";

const state = vi.hoisted(() => ({
  loaded: [] as string[],
  snapshot: vi.fn<(params?: unknown) => Promise<HealthSummary>>(),
}));
vi.mock("../health-summary.js", () => {
  state.loaded.push("health");
  return { getHealthSnapshot: state.snapshot };
});
vi.mock("../../infra/update-startup.js", () => {
  state.loaded.push("updater");
  return { getUpdateAvailable: () => null };
});
vi.mock("../../agents/agent-scope-config.js", () => ({ resolveDefaultAgentId: () => "ops" }));
vi.mock("../../config/io.js", () => ({
  getRuntimeConfig: () => ({ agents: { list: [{ id: "ops", default: true }] } }),
  createConfigIO: () => ({ configPath: "fixture/config.json" }),
}));
vi.mock("../../config/paths.js", () => ({ STATE_DIR: "fixture/state" }));
vi.mock("../../infra/system-presence.js", () => ({ listSystemPresence: () => [] }));
vi.mock("../auth.js", () => ({ resolveGatewayAuth: () => ({ mode: "token" }) }));

let health: typeof import("./health-state.js");
let updates: typeof import("../../infra/update-available-state.js");
beforeEach(async () => {
  vi.resetModules();
  state.snapshot.mockReset();
  health = await import("./health-state.js");
  updates = await import("../../infra/update-available-state.js");
});

function summary(ts: number): HealthSummary {
  return {
    ok: true,
    ts,
    durationMs: 0,
    channels: {},
    channelOrder: [],
    channelLabels: {},
    heartbeatSeconds: 0,
    defaultAgentId: "ops",
    agents: [],
    sessions: { path: "fixture/sessions", count: 0, recent: [] },
  };
}

it("builds handshake snapshots without loading health probes or updater execution", () => {
  const snapshot = health.buildGatewaySnapshot();
  expect(state.loaded).toEqual([]);
  expect(state.snapshot).not.toHaveBeenCalled();
  expect(snapshot.health).toEqual({});
  expect(snapshot.sessionDefaults?.mainSessionKey).toBe("agent:ops:main");
  expect(snapshot.configPath).toBeUndefined();
  expect(health.buildGatewaySnapshot({ includeSensitive: true })).toMatchObject({
    configPath: "fixture/config.json",
    stateDir: "fixture/state",
    authMode: "token",
  });
  const next = { currentVersion: "1.0.0", latestVersion: "1.0.1", channel: "stable" };
  updates.setUpdateAvailableCache({ next });
  expect(health.buildGatewaySnapshot().updateAvailable).toBe(next);
  expect(state.loaded).toEqual([]);
});

it("coalesces refreshes while keeping sensitive results outside the public cache", async () => {
  let resolvePublic!: (value: HealthSummary) => void;
  let resolveSensitive!: (value: HealthSummary) => void;
  const publicPending = new Promise<HealthSummary>((resolve) => {
    resolvePublic = resolve;
  });
  const sensitivePending = new Promise<HealthSummary>((resolve) => {
    resolveSensitive = resolve;
  });
  state.snapshot.mockReturnValueOnce(publicPending).mockReturnValueOnce(sensitivePending);
  const broadcast = vi.fn();
  health.setBroadcastHealthUpdate(broadcast);
  const runtimeSnapshot = { channels: {}, channelAccounts: {} };
  const eventLoop: GatewayEventLoopHealth = {
    degraded: true,
    reasons: ["event_loop_delay"],
    intervalMs: 1000,
    delayP99Ms: 1100,
    delayMaxMs: 1200,
    utilization: 0.5,
    cpuCoreRatio: 0.5,
  };
  const options = {
    probe: false,
    getRuntimeSnapshot: () => runtimeSnapshot,
    getEventLoopHealth: () => eventLoop,
  };
  const first = health.refreshGatewayHealthSnapshot(options);
  const concurrent = health.refreshGatewayHealthSnapshot(options);
  await vi.waitFor(() => expect(state.snapshot).toHaveBeenCalledOnce());
  const sensitive = health.refreshGatewayHealthSnapshot({ ...options, includeSensitive: true });
  await vi.waitFor(() => expect(state.snapshot).toHaveBeenCalledTimes(2));
  expect(state.snapshot).toHaveBeenNthCalledWith(1, {
    probe: false,
    includeSensitive: false,
    runtimeSnapshot,
    eventLoop,
  });
  expect(state.snapshot).toHaveBeenNthCalledWith(2, {
    probe: false,
    includeSensitive: true,
    runtimeSnapshot,
    eventLoop,
  });
  const publicResult = summary(1);
  const sensitiveResult = summary(2);
  resolveSensitive(sensitiveResult);
  expect(await sensitive).toBe(sensitiveResult);
  expect(health.getHealthCache()).toBeNull();
  expect(broadcast).not.toHaveBeenCalled();
  resolvePublic(publicResult);
  expect(await first).toBe(publicResult);
  expect(await concurrent).toBe(publicResult);
  expect(health.getHealthCache()).toBe(publicResult);
  expect(health.getHealthVersion()).toBe(2);
  expect(broadcast).toHaveBeenCalledExactlyOnceWith(publicResult);
});

it("propagates refresh failures and releases the pending refresh for a retry", async () => {
  const error = new Error("health probe failed");
  state.snapshot.mockRejectedValueOnce(error).mockResolvedValueOnce(summary(3));
  await expect(health.refreshGatewayHealthSnapshot({ probe: true })).rejects.toBe(error);
  expect(health.getHealthCache()).toBeNull();
  expect(health.getHealthVersion()).toBe(1);
  const result = await health.refreshGatewayHealthSnapshot({
    probe: true,
    getRuntimeSnapshot: () => {
      throw new Error("channel snapshot unavailable");
    },
  });
  expect(state.snapshot).toHaveBeenLastCalledWith({
    probe: true,
    includeSensitive: false,
    runtimeSnapshot: undefined,
  });
  expect(health.getHealthCache()).toBe(result);
  expect(health.getHealthVersion()).toBe(2);
});
