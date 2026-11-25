import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  loaded: [] as string[],
  events: [] as string[],
  resetCatalog: vi.fn(),
  clearAuth: vi.fn(),
  resetDirectory: vi.fn(),
  rewarm: vi.fn(async () => {}),
  dispose: vi.fn(async () => {}),
  createCron: vi.fn(),
  startCron: vi.fn(),
  watch: vi.fn(() => ({ stop: vi.fn(async () => {}) })),
}));
vi.mock("../agents/agent-bundle-mcp-tools.js", () => {
  state.loaded.push("mcp");
  return { disposeAllSessionMcpRuntimes: state.dispose };
});
vi.mock("../agents/model-provider-auth.js", () => {
  state.loaded.push("provider");
  return { warmCurrentProviderAuthStateOffMainThread: state.rewarm };
});
vi.mock("../agents/model-provider-auth-state.js", () => ({
  clearCurrentProviderAuthState: state.clearAuth,
}));
vi.mock("../agents/model-catalog.js", () => ({ resetModelCatalogCache: state.resetCatalog }));
vi.mock("../infra/outbound/target-resolver.js", () => ({
  resetDirectoryCache: state.resetDirectory,
}));
vi.mock("./server-cron.js", () => {
  state.loaded.push("cron");
  return { buildGatewayCronService: state.createCron };
});
vi.mock("./server-runtime-services.js", () => {
  state.loaded.push("scheduled-services");
  return { startGatewayCronWithLogging: state.startCron };
});
vi.mock("./config-reload.js", () => ({ startGatewayConfigReloader: state.watch }));
vi.mock("./server-lanes.js", () => ({ applyGatewayLaneConcurrency: vi.fn() }));
vi.mock("./server-model-catalog.js", () => ({ markGatewayModelCatalogStaleForReload: vi.fn() }));

import { buildGatewayReloadPlan } from "./config-reload-plan.js";
import {
  createGatewayReloadHandlers,
  startManagedGatewayConfigReloader,
} from "./server-reload-handlers.js";

function fixture() {
  const current = {
    hooksConfig: null,
    hookClientIpConfig: {},
    heartbeatRunner: { updateConfig: vi.fn() },
    cronState: { cron: { stop: vi.fn(() => state.events.push("stop")) } },
    channelHealthMonitor: null,
  };
  const params = {
    deps: {},
    broadcast: vi.fn(),
    getState: () => current,
    setState: vi.fn(),
    startChannel: vi.fn(),
    stopChannel: vi.fn(),
    reloadPlugins: vi.fn(),
    logHooks: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    logChannels: { info: vi.fn(), error: vi.fn() },
    logCron: { error: vi.fn() },
    logReload: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    createHealthMonitor: vi.fn(),
    onCronRestart: vi.fn(() => state.events.push("restart")),
  };
  const handlers = createGatewayReloadHandlers(params as never);
  return { params, current, handlers };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.events = [];
  state.rewarm.mockResolvedValue(undefined);
  state.dispose.mockResolvedValue(undefined);
});

describe("Gateway reload execution dependencies", () => {
  it("registers the config watcher without loading cron, MCP or provider execution", async () => {
    expect(state.loaded).toEqual([]);
    const { params } = fixture();
    const watcher = startManagedGatewayConfigReloader({
      ...params,
      minimalTestGateway: false,
      initialConfig: {},
      initialInternalWriteHash: null,
      watchPath: "fixture-config.json",
      channelManager: {},
      sharedGatewaySessionGenerationState: {},
      clients: [],
    } as never);
    expect(state.watch).toHaveBeenCalledOnce();
    expect(state.loaded).toEqual([]);
    await watcher.stop();
  });

  it("resets model and directory caches and rewarms auth for a real hot reload", async () => {
    const { handlers, params } = fixture();
    const cfg = {};
    await handlers.applyHotReload(buildGatewayReloadPlan(["tools.exec.ask"]), cfg);
    await vi.waitFor(() => expect(state.rewarm).toHaveBeenCalledExactlyOnceWith(cfg));
    expect(state.resetCatalog).toHaveBeenCalledOnce();
    expect(state.clearAuth).toHaveBeenCalledOnce();
    expect(state.resetDirectory).toHaveBeenCalledOnce();
    expect(params.setState).toHaveBeenCalledOnce();
    expect(state.loaded).toEqual(["provider"]);
    expect(state.dispose).not.toHaveBeenCalled();
    expect(state.createCron).not.toHaveBeenCalled();
  });

  it("loads cron before stopping its previous owner and keeps the restart order", async () => {
    const { handlers, params } = fixture();
    const cron = { start: vi.fn() };
    state.createCron.mockImplementation(() => {
      state.events.push("create");
      return { cron };
    });
    state.startCron.mockImplementation(() => state.events.push("start"));
    const plan = { ...buildGatewayReloadPlan([]), restartCron: true };
    await handlers.applyHotReload(plan, {});
    expect(state.events).toEqual(["restart", "stop", "create", "start"]);
    expect(state.startCron).toHaveBeenCalledWith({ cron, logCron: params.logCron });
    expect(params.setState).toHaveBeenCalledWith(expect.objectContaining({ cronState: { cron } }));
    expect(state.dispose).not.toHaveBeenCalled();
  });

  it("keeps MCP disposal failures bounded and reports provider rewarm failures", async () => {
    const { handlers, params } = fixture();
    state.dispose.mockRejectedValueOnce(new Error("dispose failed"));
    state.rewarm.mockRejectedValueOnce(new Error("warm failed"));
    await handlers.applyHotReload({ ...buildGatewayReloadPlan([]), disposeMcpRuntimes: true }, {});
    await vi.waitFor(() =>
      expect(params.logReload.warn).toHaveBeenCalledWith(
        "provider auth state rewarm failed: Error: warm failed",
      ),
    );
    expect(params.logReload.warn).toHaveBeenCalledWith(
      "bundle-mcp runtime disposal during config reload failed: Error: dispose failed",
    );
    expect(state.dispose).toHaveBeenCalledOnce();
    expect(params.setState).toHaveBeenCalledOnce();
  });
});
