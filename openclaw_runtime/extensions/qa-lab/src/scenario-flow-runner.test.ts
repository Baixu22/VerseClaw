import { describe, expect, it } from "vitest";
import { runScenarioFlow, type QaFlowEvent } from "./scenario-flow-runner.js";

describe("QA executed flow observations", () => {
  function fixture() {
    const events: QaFlowEvent[] = [];
    let executions = 0;
    const api = {
      state: {}, scenario: {}, config: {},
      increment: () => ++executions,
      runScenario: async (name: string, steps: Array<{ name: string; run: () => Promise<unknown> }>) => {
        const results = [];
        for (const step of steps) {
          try { await step.run(); results.push({ name: step.name, status: "pass" }); }
          catch (error) { results.push({ name: step.name, status: "fail", details: String(error) }); break; }
        }
        return { name, status: results.every((result) => result.status === "pass") ? "pass" : "fail", steps: results };
      },
    };
    return { events, api, count: () => executions };
  }

  it("records only actual nested actions and assertions, preserving the result", async () => {
    const f = fixture();
    const result = await runScenarioFlow({
      api: f.api as never, observe: (event) => f.events.push(event), scenarioTitle: "fixture",
      flow: { steps: [{ name: "nested", actions: [
        { call: "increment", saveAs: "count" },
        { if: { expr: "count === 1", then: [{ assert: { expr: "count === 1" } }], else: [{ call: "increment" }] } },
      ] }] } as never,
    });
    expect(result.status).toBe("pass");
    expect(f.count()).toBe(1);
    expect(f.events).toEqual([{ kind: "call", call: "increment", phase: "begin" }, { kind: "call", call: "increment", phase: "complete" }, { kind: "assert", expression: "count === 1", actual: true }]);
  });

  it("records a false assertion and preserves failure instead of inventing a pass", async () => {
    const f = fixture();
    const result = await runScenarioFlow({ api: f.api as never, observe: (event) => f.events.push(event), scenarioTitle: "false",
      flow: { steps: [{ name: "assert", actions: [{ assert: { expr: "false" } }, { call: "increment" }] }] } as never });
    expect(result.status).toBe("fail");
    expect(f.count()).toBe(0);
    expect(f.events).toEqual([{ kind: "assert", expression: "false", actual: false }]);
  });

  it("works with the original no-observer API", async () => {
    const f = fixture();
    const result = await runScenarioFlow({ api: f.api as never, scenarioTitle: "old call",
      flow: { steps: [{ name: "execute", actions: [{ call: "increment" }] }] } as never });
    expect(result.status).toBe("pass"); expect(f.count()).toBe(1);
  });
});
