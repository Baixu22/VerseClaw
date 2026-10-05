import { afterEach, describe, expect, it, vi } from "vitest";
import { startGatewaySidecars } from "./server-startup-post-attach.js";

function buildParams(overrides: Record<string, unknown> = {}) {
  return {
    cfg: {} as never,
    pluginRegistry: { plugins: [] } as never,
    defaultWorkspaceDir: "C:/tmp/rc10-channel-start",
    deps: {} as never,
    startChannels: vi.fn(async () => {}),
    onChannelsStarted: vi.fn(),
    prewarmPrimaryModel: vi.fn(async () => {}),
    shouldStartPluginServices: () => false,
    log: { warn: vi.fn() },
    logHooks: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    logChannels: { info: vi.fn(), error: vi.fn() },
    ...overrides,
  };
}

describe("startGatewaySidecars channel startup", () => {
  afterEach(() => {
    delete process.env.OPENCLAW_SKIP_CHANNELS;
    delete process.env.OPENCLAW_SKIP_PROVIDERS;
    vi.restoreAllMocks();
  });

  it("starts channels when channel startup is not skipped", async () => {
    const params = buildParams();
    await startGatewaySidecars(params as never);
    expect(params.startChannels).toHaveBeenCalledTimes(1);
    expect(params.onChannelsStarted).toHaveBeenCalledTimes(1);
  });

  it("skips channel startup when OPENCLAW_SKIP_CHANNELS=1", async () => {
    process.env.OPENCLAW_SKIP_CHANNELS = "1";
    const params = buildParams();
    await startGatewaySidecars(params as never);
    expect(params.startChannels).not.toHaveBeenCalled();
    expect(params.logChannels.info).toHaveBeenCalledWith(
      expect.stringContaining("skipping channel start"),
    );
  });

  it("skips channel startup when OPENCLAW_SKIP_PROVIDERS=1", async () => {
    process.env.OPENCLAW_SKIP_PROVIDERS = "1";
    const params = buildParams();
    await startGatewaySidecars(params as never);
    expect(params.startChannels).not.toHaveBeenCalled();
  });
});
