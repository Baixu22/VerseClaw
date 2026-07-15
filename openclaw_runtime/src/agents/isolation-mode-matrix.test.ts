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
  it("recommends patch-flow for long dense multi-worker", () => {
    expect(
      recommendIsolationMode({ durationMinutes: 45, workerCount: 4, writeDensity: 0.7 }).mode,
    ).toBe("patch-flow");
  });
});
