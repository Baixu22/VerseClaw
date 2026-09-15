import { afterEach, describe, expect, it, vi } from "vitest";
import { startGatewayPostAttachRuntime, testing } from "./server-startup-post-attach.js";

describe("startGatewayPostAttachRuntime deferred sidecars", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns before startup plugins and sidecars finish when sidecars are deferred", async () => {
    vi.useFakeTimers();

    let releasePluginLoad!: () => void;
    const pluginLoadStarted = vi.fn();
    const pluginLoadFinished = vi.fn();
    const sidecarsStarted = vi.fn();

    const slowPluginLoad = new Promise<void>((resolve) => {
      releasePluginLoad = () => {
        pluginLoadFinished();
        resolve();
      };
    });

    const runtime = await startGatewayPostAttachRuntime(
      {
        minimalTestGateway: false,
        cfgAtStart: {} as never,
        bindHost: "127.0.0.1",
        bindHosts: ["127.0.0.1"],
        port: 18789,
        tlsEnabled: false,
        log: { info: vi.fn(), warn: vi.fn() },
        isNixMode: false,
        broadcast: vi.fn(),
        tailscaleMode: "off",
        resetOnExit: false,
        preserveFunnel: false,
        controlUiBasePath: "/",
        logTailscale: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
        gatewayPluginConfigAtStart: {} as never,
        pluginRegistry: { plugins: [] } as never,
        defaultWorkspaceDir: "C:/tmp/openclaw-runtime-test",
        deps: {} as never,
        startChannels: vi.fn(),
        logHooks: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        logChannels: { info: vi.fn(), error: vi.fn() },
        unavailableGatewayMethods: new Set<string>(),
        loadStartupPlugins: async () => {
          pluginLoadStarted();
          await slowPluginLoad;
          return { pluginRegistry: { plugins: [] } as never, gatewayMethods: [] };
        },
        deferSidecars: true,
      },
      {
        getGlobalHookRunner: vi.fn(async () => null),
        logGatewayStartup: vi.fn(async () => undefined),
        refreshLatestUpdateRestartSentinel: vi.fn(async () => null),
        scheduleGatewayUpdateCheck: vi.fn(async () => ({ stop: vi.fn() })),
        startGatewaySidecars: vi.fn(async () => {
          sidecarsStarted();
          return { pluginServices: null, postReadySidecars: [] };
        }),
        startGatewayTailscaleExposure: vi.fn(async () => null),
      } as never,
    );

    expect(runtime).toEqual({
      stopGatewayUpdateCheck: expect.any(Function),
      tailscaleCleanup: null,
      pluginServices: null,
    });
    expect(pluginLoadStarted).not.toHaveBeenCalled();
    expect(sidecarsStarted).not.toHaveBeenCalled();

    releasePluginLoad();
    await vi.runAllTimersAsync();
    await vi.waitFor(() => expect(sidecarsStarted).toHaveBeenCalledTimes(1));
    expect(pluginLoadStarted).toHaveBeenCalledTimes(1);
    expect(pluginLoadFinished).toHaveBeenCalledTimes(1);
  });

  it("uses OPENCLAW_DEFERRED_SIDECAR_START_DELAY_MS when present", () => {
    expect(
      testing.resolveDeferredSidecarStartDelayMs({
        OPENCLAW_DEFERRED_SIDECAR_START_DELAY_MS: "600000",
      } as NodeJS.ProcessEnv),
    ).toBe(600_000);
    expect(
      testing.resolveDeferredSidecarStartDelayMs({
        OPENCLAW_DEFERRED_SIDECAR_START_DELAY_MS: "not-a-number",
      } as NodeJS.ProcessEnv),
    ).toBe(10_000);
  });
});
