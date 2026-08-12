import { describe, expect, it } from "vitest";
import { buildGatewayReloadPlan, resolveConfigReloadMetadata } from "./config-reload-plan.js";

describe("tools config hot reload planning", () => {
  it.each(["tools.exec.security", "tools.exec.ask"])(
    "refreshes the active runtime config without restarting subsystems: %s",
    (path) => {
      const plan = buildGatewayReloadPlan([path]);

      expect(plan).toMatchObject({
        restartGateway: false,
        restartReasons: [],
        hotReasons: [path],
        reloadHooks: false,
        restartGmailWatcher: false,
        restartCron: false,
        restartHeartbeat: false,
        restartHealthMonitor: false,
        reloadPlugins: false,
        disposeMcpRuntimes: false,
        restartChannels: new Set(),
        noopPaths: [],
      });
      expect(resolveConfigReloadMetadata(path).kind).toBe("hot");
    },
  );

  it("preserves adjacent no-op and restart classifications", () => {
    expect(resolveConfigReloadMetadata("gateway.reload.mode").kind).toBe("none");
    expect(resolveConfigReloadMetadata("gateway.auth.token").kind).toBe("restart");
  });
});
