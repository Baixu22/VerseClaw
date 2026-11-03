import { describe, expect, it, vi } from "vitest";
import { PostCompactionLoopPersistedError } from "./embedded-agent-runner/post-compaction-loop-guard.js";
import { runWithModelFallback } from "./model-fallback.js";
import { createRequestAttemptBudget, runWithRequestAttemptBudget } from "./request-attempt-budget.js";
import { ToolLoopTerminatedError } from "./tool-loop-termination.js";

function physicalFailureRun(budget: ReturnType<typeof createRequestAttemptBudget>) {
  return vi.fn(async () => {
    const attempt = budget.tryRecordAttempt({ layer: "provider-transport", outcome: "failure" });
    if (attempt === undefined) {
      throw new Error("request attempt budget exhausted");
    }
    budget.completeAttempt(attempt, "failure");
    throw new Error("provider unavailable");
  });
}

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

  it("uses the ambient logical-request budget when none is passed explicitly", async () => {
    const budget = createRequestAttemptBudget({ maxPhysicalAttempts: 1 });
    const run = physicalFailureRun(budget);
    await expect(
      runWithRequestAttemptBudget(budget, () =>
        runWithModelFallback({
          cfg: undefined,
          provider: "test-provider",
          model: "primary",
          fallbacksOverride: ["test-provider/secondary"],
          skipAuthProfileRuntime: true,
          run,
        }),
      ),
    ).rejects.toThrow();
    expect(run).toHaveBeenCalledOnce();
    expect(budget.snapshot()).toMatchObject({
      used: 1,
      remaining: 0,
      attempts: [{ physicalAttempt: 1, layer: "provider-transport", outcome: "failure" }],
      decisions: [{ layer: "model-fallback", reason: "candidate:1" }],
    });
  });

  it("stops fallback candidates at the shared physical-attempt budget", async () => {
    const budget = createRequestAttemptBudget({ logicalRequestId: "fallback-cap", maxPhysicalAttempts: 1 });
    const run = physicalFailureRun(budget);
    await expect(
      runWithModelFallback({
        cfg: undefined,
        provider: "test-provider",
        model: "primary",
        fallbacksOverride: ["test-provider/secondary", "test-provider/tertiary"],
        skipAuthProfileRuntime: true,
        run,
        attemptBudget: budget,
      }),
    ).rejects.toThrow();
    expect(run).toHaveBeenCalledOnce();
    expect(budget.snapshot()).toMatchObject({
      used: 1,
      remaining: 0,
      attempts: [{ physicalAttempt: 1, layer: "provider-transport", outcome: "failure" }],
      decisions: [{ layer: "model-fallback", reason: "candidate:1" }],
    });
  });

  it("leaves charging to provider transport when the run does not record a physical attempt", async () => {
    const budget = createRequestAttemptBudget({ maxPhysicalAttempts: 2 });
    const run = vi.fn().mockRejectedValue(new Error("provider unavailable"));
    await expect(
      runWithModelFallback({
        cfg: undefined,
        provider: "test-provider",
        model: "primary",
        fallbacksOverride: ["test-provider/secondary"],
        skipAuthProfileRuntime: true,
        run,
        attemptBudget: budget,
      }),
    ).rejects.toThrow();
    expect(run).toHaveBeenCalledTimes(2);
    expect(budget.snapshot()).toMatchObject({
      used: 0,
      remaining: 2,
      attempts: [],
      decisions: [
        { layer: "model-fallback", reason: "candidate:1" },
        { layer: "model-fallback", reason: "candidate:2" },
      ],
    });
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
  it("does not exhaust a four-slot budget after two failed physical attempts", async () => {
    const budget = createRequestAttemptBudget({ maxPhysicalAttempts: 4 });
    let physicalAttempts = 0;
    const run = vi.fn(async () => {
      physicalAttempts += 1;
      const attempt = budget.tryRecordAttempt({ layer: "provider-transport", outcome: "failure" });
      if (attempt === undefined) {
        throw new Error("request attempt budget exhausted");
      }
      if (physicalAttempts < 3) {
        budget.completeAttempt(attempt, "failure");
        throw new Error("provider unavailable");
      }
      budget.completeAttempt(attempt, "success");
      return "recovered";
    });
    await expect(
      runWithModelFallback({
        cfg: undefined,
        provider: "test-provider",
        model: "primary",
        fallbacksOverride: [
          "test-provider/secondary",
          "test-provider/tertiary",
          "test-provider/quaternary",
        ],
        skipAuthProfileRuntime: true,
        run,
        attemptBudget: budget,
      }),
    ).resolves.toMatchObject({ result: "recovered", model: "tertiary" });
    expect(physicalAttempts).toBe(3);
    expect(budget.snapshot()).toMatchObject({
      used: 2,
      remaining: 2,
      attempts: [
        { physicalAttempt: 1, layer: "provider-transport", outcome: "failure" },
        { physicalAttempt: 2, layer: "provider-transport", outcome: "failure" },
        { physicalAttempt: 3, layer: "provider-transport", outcome: "success" },
      ],
      decisions: [
        { layer: "model-fallback", reason: "candidate:1" },
        { layer: "model-fallback", reason: "candidate:2" },
        { layer: "model-fallback", reason: "candidate:3" },
      ],
    });
  });
