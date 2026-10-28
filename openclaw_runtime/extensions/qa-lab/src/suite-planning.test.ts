import { describe, expect, it } from "vitest";
import { selectQaSuiteScenarios } from "./suite-planning.js";
import type { QaSeedScenarioWithSource } from "./scenario-catalog.js";

const scenario: QaSeedScenarioWithSource = {
  id: "one",
  title: "One",
  surface: "qa-channel",
  objective: "One executed task",
  successCriteria: ["Final state is observed"],
  sourcePath: "qa/scenarios/one.md",
  execution: { kind: "flow" },
};
const selection = { providerMode: "mock-openai" as const, primaryModel: "mock-openai/gpt-5.5" };

describe("QA suite selection", () => {
  it("rejects an empty catalog", () => {
    expect(() => selectQaSuiteScenarios({ ...selection, scenarios: [] })).toThrow(
      "selected no scenarios",
    );
  });
  it("rejects an empty eligible lane", () => {
    expect(() =>
      selectQaSuiteScenarios({
        ...selection,
        scenarios: [{ ...scenario, runtimeParityTier: "live-only" }],
      }),
    ).toThrow("selected no scenarios");
  });
  it("rejects missing requested IDs instead of running the rest", () => {
    expect(() =>
      selectQaSuiteScenarios({
        ...selection,
        scenarios: [scenario],
        scenarioIds: ["one", "missing"],
      }),
    ).toThrow("missing");
  });
  it("runs an explicitly requested available scenario", () => {
    expect(
      selectQaSuiteScenarios({ ...selection, scenarios: [scenario], scenarioIds: ["one"] }),
    ).toEqual([scenario]);
  });
});
