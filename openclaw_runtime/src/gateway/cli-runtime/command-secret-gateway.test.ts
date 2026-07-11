import { describe, expect, it } from "vitest";
import { resolveCommandSecretRefsViaGateway } from "./command-secret-gateway.js";

describe("resolveCommandSecretRefsViaGateway", () => {
  it("returns the original config by reference when no selected targets are configured", async () => {
    const config = { agents: { defaults: {} } };

    const result = await resolveCommandSecretRefsViaGateway({
      config,
      commandName: "test",
      targetIds: new Set(["agents.defaults.memorySearch.remote.apiKey"]),
    });

    expect(result).toEqual({
      resolvedConfig: config,
      diagnostics: [],
      targetStatesByPath: {},
      hadUnresolvedTargets: false,
    });
    expect(result.resolvedConfig).toBe(config);
  });

  it("accepts retained read-only resolution modes", async () => {
    const result = await resolveCommandSecretRefsViaGateway({
      config: {},
      commandName: "status",
      targetIds: new Set(),
      mode: "read_only_status",
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.hadUnresolvedTargets).toBe(false);
  });
});
