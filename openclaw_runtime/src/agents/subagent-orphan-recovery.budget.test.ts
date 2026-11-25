import { describe, expect, it, vi } from "vitest";
import { mergeSessionEntry, mergeSessionEntryWithPolicy } from "../config/sessions/types.js";
import { state, key, recover } from "./subagent-orphan-recovery.test-support.js";

describe("subagent recovery chain budget", () => {
  it.each([false, true])(
    "retains the two-attempt budget after registry adoption and long delays (compacted=%s)",
    async (compacted) => {
      vi.useFakeTimers();
      vi.setSystemTime(1_000_000);
      state.steer.mockImplementation(
        ({ previousRunId, nextRunId }: { previousRunId: string; nextRunId: string }) => {
          const previous = state.runs.get(previousRunId)!;
          state.runs.delete(previousRunId);
          state.runs.set(nextRunId, { ...previous, runId: nextRunId });
        },
      );
      try {
        expect((await recover()).recovered).toBe(1);
        const firstRunId = state.store[key].lifecycleRunId;
        if (compacted) {
          state.store[key] = mergeSessionEntryWithPolicy(
            state.store[key],
            {
              sessionId: "compaction-successor",
              usageFamilySessionIds: ["generation-1", "compaction-successor"],
            },
            { identityTransition: "compaction" },
          );
        }
        vi.setSystemTime(1_120_001);
        state.store[key].abortedLastRun = true;
        expect((await recover()).recovered).toBe(1);
        expect(state.store[key].lifecycleRunId).not.toBe(firstRunId);
        expect(state.store[key].subagentRecovery?.authority?.attempts).toBe(2);

        vi.setSystemTime(1_240_002);
        state.store[key].abortedLastRun = true;
        const exhausted = await recover();
        expect(exhausted.recovered).toBe(0);
        expect(exhausted.failedRuns).toHaveLength(1);
        expect(state.gateway).toHaveBeenCalledTimes(2);
        expect(state.store[key].subagentRecovery?.authority).toMatchObject({
          attempts: 2,
          state: "wedged",
        });
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it("starts a fresh budget after an ordinary session generation replacement", async () => {
    await recover();
    const prior = state.runs.get("original-run")!;
    state.store[key] = mergeSessionEntry(state.store[key], {
      sessionId: "new-generation",
      lifecycleRunId: "new-run",
      abortedLastRun: true,
    });
    state.runs = new Map([["new-run", { ...prior, runId: "new-run" }]]);
    expect((await recover()).recovered).toBe(1);
    expect(state.gateway).toHaveBeenCalledTimes(2);
    expect(state.store[key].subagentRecovery?.authority).toMatchObject({
      attempts: 1,
      ownerId: "new-run",
    });
  });
});
