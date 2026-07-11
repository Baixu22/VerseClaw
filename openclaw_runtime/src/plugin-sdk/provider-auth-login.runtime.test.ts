import { describe, expect, it, vi } from "vitest";

const facadeMocks = vi.hoisted(() => ({
  load: vi.fn(),
  loginChutes: vi.fn(),
}));

vi.mock("./facade-runtime.js", () => ({
  loadBundledPluginPublicSurfaceModuleSync: facadeMocks.load,
}));

describe("provider auth login runtime compatibility", () => {
  it("delegates the retained Chutes login helper to the plugin public facade", async () => {
    const credentials = {
      access: "access-token",
      refresh: "refresh-token",
      expires: 1_800_000,
    };
    facadeMocks.loginChutes.mockResolvedValue(credentials);
    facadeMocks.load.mockReturnValue({
      loginChutes: facadeMocks.loginChutes,
    });

    const runtime = await import("./provider-auth-login.runtime.js");
    const loginChutes = Reflect.get(runtime, "loginChutes");
    expect(loginChutes).toBeTypeOf("function");
    if (typeof loginChutes !== "function") {
      throw new Error("provider auth login runtime did not export loginChutes");
    }

    const params = {
      app: {
        clientId: "client-id",
        redirectUri: "http://127.0.0.1:1456/oauth-callback",
        scopes: ["openid"],
      },
      manual: true,
      onAuth: vi.fn(),
      onPrompt: vi.fn(),
    };
    await expect(Reflect.apply(loginChutes, undefined, [params])).resolves.toBe(credentials);
    expect(facadeMocks.load).toHaveBeenCalledWith({
      dirName: "chutes",
      artifactBasename: "api.js",
    });
    expect(facadeMocks.loginChutes).toHaveBeenCalledWith(params);
  });

  it("preserves Chutes login errors from the plugin public facade", async () => {
    const error = new Error("Chutes login failed");
    facadeMocks.loginChutes.mockRejectedValue(error);
    facadeMocks.load.mockReturnValue({
      loginChutes: facadeMocks.loginChutes,
    });

    const runtime = await import("./provider-auth-login.runtime.js");
    const loginChutes = Reflect.get(runtime, "loginChutes");
    expect(loginChutes).toBeTypeOf("function");
    if (typeof loginChutes !== "function") {
      throw new Error("provider auth login runtime did not export loginChutes");
    }

    await expect(Reflect.apply(loginChutes, undefined, [{}])).rejects.toBe(error);
  });
});
