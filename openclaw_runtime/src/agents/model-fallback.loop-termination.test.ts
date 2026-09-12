import { describe, expect, it, vi } from "vitest";
import { PostCompactionLoopPersistedError } from "./embedded-agent-runner/post-compaction-loop-guard.js";
import { runWithModelFallback } from "./model-fallback.js";
import { ToolLoopTerminatedError } from "./tool-loop-termination.js";

describe("model fallback respects runtime loop termination", () => {
  it.each([
    new ToolLoopTerminatedError({
      toolName: "read",
      detector: "generic_repeat",
      count: 20,
      message: "loop stopped",
    }),
    new PostCompactionLoopPersistedError("loop persisted", {
      detector: "compaction_loop_persisted",
      toolName: "read",
      count: 6,
    }),
  ])("preserves $name without trying another model", async (error) => {
    const run = vi.fn().mockRejectedValueOnce(error).mockResolvedValue("must not restart");
    const onError = vi.fn();
    await expect(
      runWithModelFallback({
        cfg: undefined,
        provider: "test-provider",
        model: "primary",
        fallbacksOverride: ["test-provider/secondary"],
        skipAuthProfileRuntime: true,
        run,
        onError,
      }),
    ).rejects.toBe(error);
    expect(run).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
  });

  it("still tries the next model for a provider failure", async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(new Error("provider unavailable"))
      .mockResolvedValue("recovered");
    await expect(
      runWithModelFallback({
        cfg: undefined,
        provider: "test-provider",
        model: "primary",
        fallbacksOverride: ["test-provider/secondary"],
        skipAuthProfileRuntime: true,
        run,
      }),
    ).resolves.toMatchObject({ result: "recovered", model: "secondary" });
    expect(run).toHaveBeenCalledTimes(2);
  });
});
