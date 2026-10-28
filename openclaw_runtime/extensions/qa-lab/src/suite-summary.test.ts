import { describe, expect, it } from "vitest";
import { readQaSuiteFailedOrSkippedScenarioCountFromSummary } from "./suite-summary.js";

describe("QA suite execution evidence", () => {
  it.each([
    { counts: { total: 0, passed: 0, failed: 0 } },
    { counts: { failed: 0 }, scenarios: [] },
    { scenarios: [] },
  ])("rejects empty execution instead of returning zero failures: %j", (summary) => {
    expect(readQaSuiteFailedOrSkippedScenarioCountFromSummary(summary)).toBeNull();
  });
  it("accepts a nonempty passed execution", () => {
    expect(
      readQaSuiteFailedOrSkippedScenarioCountFromSummary({
        counts: { total: 1, passed: 1, failed: 0 },
        scenarios: [{ status: "pass" }],
      }),
    ).toBe(0);
  });
  it.each(["fail", "skip", "skipped", "unknown"])(
    "blocks %s even when counters claim success",
    (status) => {
      expect(
        readQaSuiteFailedOrSkippedScenarioCountFromSummary({
          counts: { total: 1, passed: 1, failed: 0 },
          scenarios: [{ status }],
        }),
      ).toBe(1);
    },
  );
});
