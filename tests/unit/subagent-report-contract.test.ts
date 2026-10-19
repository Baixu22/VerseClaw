import { describe, expect, it } from "vitest";
import {
  SUBAGENT_REPORT_MAX_CHARS,
  buildSubagentReport,
} from "../../openclaw_runtime/src/agents/orchestration-runtime-blackboard";

describe("bounded subagent report contract (TF-0448)", () => {
  it("returns an empty, non-truncated report for no output", () => {
    const report = buildSubagentReport({});
    expect(report.body).toBe("");
    expect(report.originalChars).toBe(0);
    expect(report.truncated).toBe(false);
    expect(report.failures).toEqual([]);
  });

  it("treats null output as empty rather than throwing", () => {
    const report = buildSubagentReport({ outputText: null });
    expect(report.body).toBe("");
    expect(report.truncated).toBe(false);
  });

  it("keeps a short report whole", () => {
    const report = buildSubagentReport({ outputText: "  found 3 call sites  " });
    expect(report.body).toBe("found 3 call sites");
    expect(report.originalChars).toBe("found 3 call sites".length);
    expect(report.truncated).toBe(false);
  });

  it("truncates at the cap and records the pre-truncation size", () => {
    const long = "x".repeat(SUBAGENT_REPORT_MAX_CHARS + 500);
    const report = buildSubagentReport({ outputText: long });
    expect(report.body).toHaveLength(SUBAGENT_REPORT_MAX_CHARS);
    expect(report.originalChars).toBe(long.length);
    expect(report.truncated).toBe(true);
  });

  it("normalises whitespace so streaming newlines cannot eat the budget", () => {
    // A subagent that narrates progress across many lines must not be able to
    // spend the whole report budget on formatting.
    const noisy = `line one\n\n  line two\r\n\tline three   `;
    const report = buildSubagentReport({ outputText: noisy });
    expect(report.body).toBe("line one line two line three");
    expect(report.body).not.toContain("\n");
  });

  it("honours a caller-supplied cap", () => {
    const report = buildSubagentReport({ outputText: "abcdefghij", maxChars: 4 });
    expect(report.body).toBe("abcd");
    expect(report.truncated).toBe(true);
    expect(report.originalChars).toBe(10);
  });

  it("never returns a cap below one character", () => {
    const report = buildSubagentReport({ outputText: "abc", maxChars: 0 });
    expect(report.body.length).toBeGreaterThanOrEqual(1);
  });

  it("cannot receive intermediate narration through any field other than outputText", () => {
    // The contract's only content input is outputText. A caller that still
    // holds reasoning/trace fields cannot leak them into the report body, so
    // the intermediate churn is structurally dropped rather than filtered.
    const withChurn = {
      outputText: "final answer only",
      reasoning: "step 1: think\nstep 2: reconsider\nstep 3: discard",
      intermediateSteps: ["tool call 1", "tool call 2"],
      trace: "internal narration",
    } as unknown as { outputText: string };
    const report = buildSubagentReport(withChurn);
    expect(report.body).toBe("final answer only");
    expect(report.body).not.toContain("step 1");
    expect(report.body).not.toContain("tool call");
    expect(report.body).not.toContain("internal narration");
  });
  it("keeps failures out of the report body", () => {
    // Failures are structured, not prose: a role cannot smuggle unbounded text
    // into the bounded body by putting it in the failures channel.
    const report = buildSubagentReport({
      outputText: "partial progress",
      failures: ["tool_a timed out", "tool_b denied"],
    });
    expect(report.body).toBe("partial progress");
    expect(report.failures).toEqual(["tool_a timed out", "tool_b denied"]);
  });

  it("copies the failures array so callers cannot mutate the report", () => {
    const failures = ["one"];
    const report = buildSubagentReport({ outputText: "body", failures });
    failures.push("two");
    expect(report.failures).toEqual(["one"]);
  });

  it("produces a body that is always within the cap", () => {
    for (const size of [0, 1, 10, 1_999, 2_000, 2_001, 100_000]) {
      const report = buildSubagentReport({ outputText: "y".repeat(size) });
      expect(report.body.length).toBeLessThanOrEqual(SUBAGENT_REPORT_MAX_CHARS);
    }
  });
});
