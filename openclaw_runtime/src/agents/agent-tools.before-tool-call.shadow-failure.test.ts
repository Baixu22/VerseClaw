import { Type } from "@sinclair/typebox";
import { afterEach, describe, expect, it, vi } from "vitest";

const memo = vi.hoisted(() => ({ enabled: vi.fn(), append: vi.fn() }));
vi.mock("../context-engine/coding-runtime-flags.js", () => ({
  isCodingRoutingMemoShadowEnabled: memo.enabled,
}));
vi.mock("../knowledge/routing-memo-shadow.js", () => ({ appendRoutingMemo: memo.append }));

import { wrapToolWithBeforeToolCallHook } from "./agent-tools.before-tool-call.js";

afterEach(() => vi.clearAllMocks());

describe("optional routing memo failure isolation", () => {
  it.each([true, false])(
    "keeps tool success and contains asynchronous errors (enabled=%s)",
    async (enabled) => {
      memo.enabled.mockReturnValue(enabled);
      memo.append.mockImplementation(() => {
        throw new Error("EACCES: memo store unavailable");
      });
      const unhandled = vi.fn();
      process.on("unhandledRejection", unhandled);
      try {
        const tool = wrapToolWithBeforeToolCallHook(
          {
            name: "read",
            label: "read",
            description: "read",
            parameters: Type.Object({}),
            execute: async () => ({
              content: [{ type: "text" as const, text: "result preserved" }],
              details: {},
            }),
          },
          { workspaceDir: process.cwd(), config: {} },
        );
        await expect(tool.execute("memo-failure", {})).resolves.toMatchObject({
          content: [{ text: "result preserved" }],
        });
        await vi.waitFor(() => expect(memo.enabled).toHaveBeenCalled());
        if (enabled) await vi.waitFor(() => expect(memo.append).toHaveBeenCalledOnce());
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(memo.append).toHaveBeenCalledTimes(enabled ? 1 : 0);
        expect(unhandled).not.toHaveBeenCalled();
      } finally {
        process.removeListener("unhandledRejection", unhandled);
      }
    },
  );
});
