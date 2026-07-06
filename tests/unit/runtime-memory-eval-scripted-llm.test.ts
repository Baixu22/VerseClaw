// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ScriptedLlmDriver } from "../../openclaw_runtime/src/agents/runtime-memory-eval/scripted-llm.js";

describe("ScriptedLlmDriver", () => {
  it("dequeues responses in FIFO order", () => {
    const driver = new ScriptedLlmDriver([
      {
        sessionKey: "session-1",
        responses: [
          { text: "first" },
          { text: "second" },
          { text: "third" },
        ],
      },
    ]);
    expect(driver.respond("session-1").text).toBe("first");
    expect(driver.respond("session-1").text).toBe("second");
    expect(driver.respond("session-1").text).toBe("third");
  });

  it("throws when the queue is exhausted", () => {
    const driver = new ScriptedLlmDriver([
      { sessionKey: "s", responses: [{ text: "only" }] },
    ]);
    driver.respond("s");
    expect(() => driver.respond("s")).toThrow(/queue exhausted/);
  });

  it("throws when no script is registered for a key", () => {
    const driver = new ScriptedLlmDriver([
      { sessionKey: "known", responses: [{ text: "x" }] },
    ]);
    expect(() => driver.respond("unknown")).toThrow(/no script registered/);
  });

  it("supports A/B arm selection via respondForArm", () => {
    const driver = new ScriptedLlmDriver([
      {
        sessionKey: "ab",
        arm: "baseline",
        responses: [{ text: "baseline-1" }, { text: "baseline-2" }],
      },
      {
        sessionKey: "ab",
        arm: "treatment",
        responses: [{ text: "treatment-1" }, { text: "treatment-2" }],
      },
    ]);
    expect(driver.respondForArm("ab", "baseline").text).toBe("baseline-1");
    expect(driver.respondForArm("ab", "treatment").text).toBe("treatment-1");
    expect(driver.respondForArm("ab", "baseline").text).toBe("baseline-2");
    expect(driver.respondForArm("ab", "treatment").text).toBe("treatment-2");
  });

  it("isolates queues by sessionKey", () => {
    const driver = new ScriptedLlmDriver([
      { sessionKey: "a", responses: [{ text: "a-1" }] },
      { sessionKey: "b", responses: [{ text: "b-1" }, { text: "b-2" }] },
    ]);
    expect(driver.respond("a").text).toBe("a-1");
    expect(driver.respond("b").text).toBe("b-1");
    expect(driver.remaining("a")).toBe(0);
    expect(driver.remaining("b")).toBe(1);
  });

  it("reset restores all queues to their original state", () => {
    const driver = new ScriptedLlmDriver([
      { sessionKey: "s", responses: [{ text: "x" }, { text: "y" }] },
    ]);
    driver.respond("s");
    expect(driver.remaining("s")).toBe(1);
    driver.reset();
    expect(driver.remaining("s")).toBe(2);
    expect(driver.respond("s").text).toBe("x");
  });

  it("throws on duplicate script registration for the same key", () => {
    expect(
      () =>
        new ScriptedLlmDriver([
          { sessionKey: "dup", responses: [{ text: "a" }] },
          { sessionKey: "dup", responses: [{ text: "b" }] },
        ]),
    ).toThrow(/duplicate script/);
  });

  it("preserves toolCalls and usage fields", () => {
    const driver = new ScriptedLlmDriver([
      {
        sessionKey: "s",
        responses: [
          {
            text: "calling tool",
            toolCalls: [{ name: "search", args: { q: "hello" } }],
            usage: { input: 10, output: 20, total: 30 },
          },
        ],
      },
    ]);
    const r = driver.respond("s");
    expect(r.toolCalls).toEqual([{ name: "search", args: { q: "hello" } }]);
    expect(r.usage).toEqual({ input: 10, output: 20, total: 30 });
  });
});
