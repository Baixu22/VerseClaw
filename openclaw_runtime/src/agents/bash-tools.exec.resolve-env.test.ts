import { beforeEach, describe, expect, it, vi } from "vitest";

const hookMocks = vi.hoisted(() => ({
  runResolveExecEnv: vi.fn(async () => ({ PLUGIN_TOKEN: "test-token" })),
}));

vi.mock("../plugins/hook-runner-global.js", () => ({
  getGlobalHookRunner: () => ({
    hasHooks: (hookName: string) => hookName === "resolve_exec_env",
    runResolveExecEnv: hookMocks.runResolveExecEnv,
  }),
}));

import { createExecTool } from "./bash-tools.exec.js";

describe("exec resolve_exec_env routing", () => {
  beforeEach(() => {
    hookMocks.runResolveExecEnv.mockClear();
  });

  it("skips process environment hooks for verseshell", async () => {
    const tool = createExecTool({ host: "verseshell" });
    const params = { command: "echo test" };

    const prepared = await tool.prepareBeforeToolCallParams?.(params, {});

    expect(prepared).toBe(params);
    expect(hookMocks.runResolveExecEnv).not.toHaveBeenCalled();
  });

  it("retains process environment hooks for gateway exec", async () => {
    const tool = createExecTool({ host: "gateway" });
    const params = { command: "echo test" };

    await tool.prepareBeforeToolCallParams?.(params, {});

    expect(hookMocks.runResolveExecEnv).toHaveBeenCalledOnce();
    expect(hookMocks.runResolveExecEnv).toHaveBeenCalledWith(
      expect.objectContaining({ host: "gateway", toolName: "exec" }),
      expect.any(Object),
    );
  });
});
