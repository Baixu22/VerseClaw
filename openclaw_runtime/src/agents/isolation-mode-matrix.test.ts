import { describe, expect, it } from "vitest";
import { recommendIsolationMode } from "./isolation-mode-matrix.js";

describe("isolation-mode-matrix (C5-3)", () => {
  it("recommends shared for light work", () => {
    expect(
      recommendIsolationMode({ durationMinutes: 5, workerCount: 1, writeDensity: 0.1 }).mode,
    ).toBe("shared");
  });
  it("recommends worktree for multi-writer", () => {
    expect(
      recommendIsolationMode({ durationMinutes: 15, workerCount: 2, writeDensity: 0.4 }).mode,
    ).toBe("worktree");
  });
  it("recommends worktree for long dense multi-worker", () => {
    expect(
      recommendIsolationMode({ durationMinutes: 45, workerCount: 4, writeDensity: 0.7 }).mode,
    ).toBe("worktree");
  });
  it("treats high writeSet overlap like write density for multi-worker", () => {
    expect(
      recommendIsolationMode({
        durationMinutes: 10,
        workerCount: 2,
        writeDensity: 0.1,
        writeSetOverlapRisk: 0.5,
      }).mode,
    ).toBe("worktree");
  });
  it("keeps shared when writeSet empty / zero overlap risk and low density", () => {
    expect(
      recommendIsolationMode({
        durationMinutes: 20,
        workerCount: 2,
        writeDensity: 0.1,
        writeSetOverlapRisk: 0,
      }).mode,
    ).toBe("shared");
  });
});
