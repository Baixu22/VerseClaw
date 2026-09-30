import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  createReplyRuntimeMocks,
  createTempHomeHarness,
  installReplyRuntimeMocks,
  makeEmbeddedTextResult,
  makeReplyConfig,
  resetReplyRuntimeMocks,
} from "./reply.test-harness.js";
import { buildGetReplyCtx } from "./reply/get-reply.test-fixtures.js";
import { closeTrackedSqliteHandlesUnder } from "../infra/node-sqlite.js";

const prepared = vi.hoisted(() => ({
  sessionKey: "agent:main:telegram:123",
  injection: { sspString: "COMPASS-PREPARED", iFrameRefreshed: false },
  candidateFactIds: [],
  appliedFactIds: [],
}));
vi.mock("../context-engine/compass-context.js", () => ({
  prepareCompassContext: vi.fn(async () => ({ context: prepared, facts: [] })),
}));

const mocks = createReplyRuntimeMocks();
installReplyRuntimeMocks(mocks);
const { withTempHome } = createTempHomeHarness({ prefix: "compass-reply-wiring-" });
beforeEach(() => {
  resetReplyRuntimeMocks(mocks);
  mocks.runEmbeddedAgent.mockResolvedValue(makeEmbeddedTextResult("ok"));
});
afterEach(() => vi.clearAllMocks());

it("reply preparation places COMPASS on the run payload instead of raw extraSystemPrompt", async () => {
  await withTempHome(async (home) => {
    try {
      const { getReplyFromConfig } = await import("./reply/get-reply.js");
      await getReplyFromConfig(buildGetReplyCtx(), {}, makeReplyConfig(home));
      expect(mocks.runEmbeddedAgent).toHaveBeenCalledOnce();
      const run = mocks.runEmbeddedAgent.mock.calls[0]![0];
      expect(run.compassContext).toBe(prepared);
      expect(run.extraSystemPrompt ?? "").not.toContain("COMPASS-PREPARED");
    } finally {
      closeTrackedSqliteHandlesUnder(home);
    }
  });
}, 60_000);
