import { describe, expect, it, vi } from "vitest";

const { callGateway } = vi.hoisted(() => ({ callGateway: vi.fn() }));
vi.mock("../call.js", () => ({ callGateway }));

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

  it("runs the sink authorization callback before Gateway resolution", async () => {
    const authorizeSecretRead = vi.fn(() => {
      throw new Error("blocked-before-resolution");
    });
    await expect(
      resolveCommandSecretRefsViaGateway({
        config: {
          tools: {
            web: {
              search: {
                apiKey: { source: "env", provider: "default", id: "SEARCH_KEY" },
              },
            },
          },
        },
        commandName: "tools.message",
        targetIds: new Set(["tools.web.search.apiKey"]),
        authorizeSecretRead,
      }),
    ).rejects.toThrow("blocked-before-resolution");
    expect(authorizeSecretRead).toHaveBeenCalledWith({
      commandName: "tools.message",
      selectedTargets: [
        {
          path: "tools.web.search.apiKey",
          pathSegments: ["tools", "web", "search", "apiKey"],
        },
      ],
    });
    expect(callGateway).not.toHaveBeenCalled();
  });
});
