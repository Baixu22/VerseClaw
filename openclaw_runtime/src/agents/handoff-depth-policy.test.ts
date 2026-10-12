// FP-P1-179 / TF-0284: "no handoff cycles, no unbounded recursion" as an assertion.
import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_HANDOFF_DEPTH,
  evaluateHandoffChain,
  evaluateHandoffDepth,
  nextHandoffDepth,
  resolveMaxHandoffDepth,
} from "./handoff-depth-policy.js";

describe("handoff depth policy (FP-P1-179 / TF-0284)", () => {
  it("allows hops up to the limit and refuses the next one with a convergence instruction", () => {
    expect(DEFAULT_MAX_HANDOFF_DEPTH).toBe(3);

    for (const depth of [0, 1, 2, 3]) {
      expect(evaluateHandoffDepth({ depth })).toEqual({ allow: true, depth });
    }

    const denied = evaluateHandoffDepth({ depth: DEFAULT_MAX_HANDOFF_DEPTH + 1 });
    expect(denied.allow).toBe(false);
    if (!denied.allow) {
      expect(denied.reason).toBe("handoff_depth_exceeded");
      // TF-0284: converge into the same controller instead of deriving another session.
      expect(denied.convergence).toContain("Converge back into the same controller");
    }
  });

  it("detects a handoff back into its own ancestry", () => {
    const denied = evaluateHandoffDepth({
      depth: 2,
      targetSessionKey: "session:B",
      ancestorSessionKeys: ["session:A", "session:B"],
    });

    expect(denied.allow).toBe(false);
    if (!denied.allow) {
      expect(denied.reason).toBe("handoff_cycle_detected");
      expect(denied.detail).toContain("session:B");
    }
  });

  it("reports a cycle as a cycle even when the depth is also over the limit", () => {
    const denied = evaluateHandoffDepth({
      depth: 99,
      targetSessionKey: "session:A",
      ancestorSessionKeys: ["session:A"],
    });

    expect(denied.allow).toBe(false);
    if (!denied.allow) expect(denied.reason).toBe("handoff_cycle_detected");
  });

  it("honours an explicit limit and falls back to the default for unusable input", () => {
    expect(resolveMaxHandoffDepth(1)).toBe(1);
    // An unreadable config must not remove the only bound that exists.
    expect(resolveMaxHandoffDepth("5")).toBe(DEFAULT_MAX_HANDOFF_DEPTH);
    expect(resolveMaxHandoffDepth(0)).toBe(DEFAULT_MAX_HANDOFF_DEPTH);
    expect(evaluateHandoffDepth({ depth: 2, maxDepth: 1 }).allow).toBe(false);
    expect(evaluateHandoffDepth({ depth: 1, maxDepth: 1 }).allow).toBe(true);
  });

  it("derives the child depth from the parent depth", () => {
    expect(nextHandoffDepth(0)).toBe(1);
    expect(nextHandoffDepth(2)).toBe(3);
    expect(nextHandoffDepth(undefined)).toBe(0);
    expect(nextHandoffDepth(-4)).toBe(0);
  });

  it("walks spawnedBy to find a cycle back into the ancestry", () => {
    // A was spawned by nobody; B by A; C by B. Spawning A again is a cycle.
    const spawnedBy: Record<string, string | undefined> = { A: undefined, B: "A", C: "B" };
    const decision = evaluateHandoffChain({
      parentDepth: 2,
      parentSessionKey: "C",
      targetSessionKey: "A",
      resolveSpawnedBy: (key) => spawnedBy[key],
    });

    expect(decision.allow).toBe(false);
    if (!decision.allow) {
      expect(decision.reason).toBe("handoff_cycle_detected");
      expect(decision.detail).toContain("A -> B -> C");
    }
  });

  it("refuses the hop past the limit using the parent depth", () => {
    const decision = evaluateHandoffChain({
      parentDepth: DEFAULT_MAX_HANDOFF_DEPTH,
      parentSessionKey: "B",
      targetSessionKey: "C",
      resolveSpawnedBy: () => undefined,
    });

    expect(decision.allow).toBe(false);
    if (!decision.allow) expect(decision.reason).toBe("handoff_depth_exceeded");
  });

  it("allows an ordinary child and survives a malformed ancestry loop", () => {
    expect(
      evaluateHandoffChain({
        parentDepth: 0,
        parentSessionKey: "A",
        targetSessionKey: "B",
        resolveSpawnedBy: () => undefined,
      }),
    ).toEqual({ allow: true, depth: 1 });

    // A -> B -> A in the links must terminate, not hang.
    const looped: Record<string, string> = { A: "B", B: "A" };
    const decision = evaluateHandoffChain({
      parentDepth: 0,
      parentSessionKey: "B",
      targetSessionKey: "C",
      resolveSpawnedBy: (key) => looped[key],
    });
    expect(decision.allow).toBe(true);
  });
});
