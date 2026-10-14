import { describe, expect, it } from "vitest";
import { BackgroundWorkGate } from "../../openclaw_runtime/src/resources/background-work-gate";

function clock(start = 1_000) {
  let now = start;
  return { now: () => now, advance: (ms: number) => { now += ms; } };
}

describe("background work gate", () => {
  it("defers background work and resumes after low watermark plus dwell", async () => {
    const time = clock();
    const gate = new BackgroundWorkGate({
      now: time.now,
      watermarks: { highQueueDepth: 10, lowQueueDepth: 2, minDwellMs: 2_000 },
    });
    expect(gate.update({ queueDepth: 11 }).deferring).toBe(true);

    let ran = 0;
    const pending = gate.runBackground("index", async () => { ran += 1; return "ok"; });
    expect(gate.getState()).toMatchObject({ deferredCount: 1, pendingCount: 1 });
    expect(gate.shouldDefer("foreground")).toBe(false);

    time.advance(1_000);
    expect(gate.update({ queueDepth: 1 }).deferring).toBe(true);
    time.advance(1_000);
    expect(gate.update({ queueDepth: 1 }).deferring).toBe(false);
    await expect(pending).resolves.toBe("ok");
    expect(ran).toBe(1);
    expect(gate.getState()).toMatchObject({ resumeCount: 1, foregroundDeferredCount: 0 });
  });

  it("does not flip-flop while only the high-side condition remains", () => {
    const time = clock();
    const gate = new BackgroundWorkGate({
      now: time.now,
      watermarks: { highCpuPercent: 200, lowCpuPercent: 80, minDwellMs: 1_000 },
    });
    gate.update({ treeCpuPercent: 250 });
    for (let i = 0; i < 5; i += 1) {
      time.advance(100);
      expect(gate.update({ treeCpuPercent: 150 }).deferring).toBe(true);
    }
    expect(gate.getState().transitionCount).toBe(1);
  });

  it("foreground work is never deferred", () => {
    const gate = new BackgroundWorkGate();
    gate.update({ shedSignal: true });
    expect(gate.shouldDefer("foreground")).toBe(false);
    expect(gate.shouldDefer("background")).toBe(true);
    expect(gate.getState().foregroundDeferredCount).toBe(0);
  });
});