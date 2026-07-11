import { afterEach, describe, expect, it } from "vitest";
import {
  clearHealthChecksForTest,
  exitCodeFromFindings,
  getHealthCheck,
  healthFindingMeetsSeverity,
  listHealthChecks,
  parseHealthFindingSeverity,
  registerHealthCheck,
  type HealthCheck,
} from "./health.js";

function makeCheck(id: string): HealthCheck {
  return {
    id,
    kind: "plugin",
    description: id,
    async detect() {
      return [];
    },
  };
}

afterEach(() => {
  clearHealthChecksForTest();
});

describe("plugin SDK health contract", () => {
  it("parses only the closed severity set and applies deterministic thresholds", () => {
    expect(parseHealthFindingSeverity("info")).toBe("info");
    expect(parseHealthFindingSeverity("warning")).toBe("warning");
    expect(parseHealthFindingSeverity("error")).toBe("error");
    expect(parseHealthFindingSeverity("warn")).toBeNull();
    expect(parseHealthFindingSeverity(undefined)).toBeNull();

    expect(healthFindingMeetsSeverity({ severity: "warning" }, "info")).toBe(true);
    expect(healthFindingMeetsSeverity({ severity: "warning" }, "warning")).toBe(true);
    expect(healthFindingMeetsSeverity({ severity: "warning" }, "error")).toBe(false);
  });

  it("derives process exit status from the requested minimum severity", () => {
    const findings = [
      { checkId: "policy/info", severity: "info" as const, message: "info" },
      { checkId: "policy/warning", severity: "warning" as const, message: "warning" },
    ];

    expect(exitCodeFromFindings(findings, "error")).toBe(0);
    expect(exitCodeFromFindings(findings, "warning")).toBe(1);
    expect(exitCodeFromFindings(findings, "info")).toBe(1);
  });

  it("keeps health checks in registration order and rejects duplicate ids", () => {
    const first = makeCheck("policy/first");
    const second = makeCheck("policy/second");

    registerHealthCheck(first);
    registerHealthCheck(second);

    expect(listHealthChecks()).toEqual([first, second]);
    expect(getHealthCheck(first.id)).toBe(first);
    expect(() => registerHealthCheck(makeCheck(first.id))).toThrow(
      "health check already registered: policy/first",
    );
  });
});
