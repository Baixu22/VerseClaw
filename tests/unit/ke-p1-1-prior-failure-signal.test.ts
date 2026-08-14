// KE-P1-1: prior-failure signal (countKePriorFailures + terminal evidence passthrough).
import { describe, expect, it } from "vitest";
import {
  buildKeTaskTerminalEvidence,
  countKePriorFailures,
} from "../../openclaw_runtime/src/runtime-core/ke-candidate-generation";

describe("KE-P1-1 prior-failure signal", () => {
  it("counts only matching prior error signatures", () => {
    expect(countKePriorFailures(["sig-a", "sig-b", "sig-a"], "sig-a")).toBe(2);
    expect(countKePriorFailures(["sig-a"], "sig-b")).toBe(0);
    expect(countKePriorFailures([], "sig-a")).toBe(0);
    expect(countKePriorFailures(["sig-a"], undefined)).toBe(0);
  });

  it("passes priorFailureCount through terminal evidence", () => {
    const evidence = buildKeTaskTerminalEvidence({
      taskId: "loop_1",
      status: "error",
      error: "command exited 1",
      sourceRefs: ["task-loop:loop_1:error:error"],
      priorFailureCount: 2,
    });
    expect(evidence.priorFailureCount).toBe(2);
  });
});
