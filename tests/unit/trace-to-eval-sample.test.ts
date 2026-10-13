// @vitest-environment node
// G03: redacted failure traces -> re-runnable eval samples.
import { describe, expect, it } from "vitest";

import {
  traceToEvalSample,
  traceToEvalSamples,
  type RedactedFailureTrace,
} from "../../scripts/lib/trace-to-eval-sample.mjs";

function trace(over: Partial<RedactedFailureTrace> = {}): RedactedFailureTrace {
  return {
    runId: "run-1",
    createdAt: "2026-10-13T00:00:00.000Z",
    outcome: "failure",
    reproducer: { kind: "scenario", ref: "agent-dev-scenario:checkout" },
    signature: "tool-loop-timeout",
    ...over,
  };
}

describe("G03 trace-to-eval sample", () => {
  it("turns a failure trace into a sample expected to fail before the fix and pass after", () => {
    const result = traceToEvalSample(trace());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sample.expected).toEqual({ "before-fix": "fail", "after-fix": "pass" });
    expect(result.sample.reproducer).toEqual({ kind: "scenario", ref: "agent-dev-scenario:checkout" });
    expect(result.sample.digest).toMatch(/^[a-f0-9]{16}$/);
    // Deterministic digest for the same input.
    const again = traceToEvalSample(trace());
    if (again.ok) expect(again.sample.digest).toBe(result.sample.digest);
  });

  it("keeps success/refusal/cancelled traces as passing samples (a fix must not regress them)", () => {
    for (const outcome of ["success", "refusal", "cancelled"] as const) {
      const result = traceToEvalSample(trace({ outcome }));
      expect(result.ok, outcome).toBe(true);
      if (result.ok) expect(result.sample.expected["before-fix"]).toBe("pass");
    }
  });

  it("refuses a trace that is not redacted (raw prompt or secret-like value)", () => {
    const withPrompt = traceToEvalSample({ ...trace(), prompt: "secret user prompt" });
    expect(withPrompt.ok).toBe(false);
    if (!withPrompt.ok) expect(withPrompt.diagnostics[0].code).toBe("trace-not-redacted");

    const fakeKey = ["sk", "-", "a".repeat(20)].join(""); // synthetic, built at runtime so no secret literal is checked in
    const withSecret = traceToEvalSample({ ...trace(), signature: `leak ${fakeKey}` });
    expect(withSecret.ok).toBe(false);
    if (!withSecret.ok) expect(withSecret.diagnostics[0].code).toBe("trace-not-redacted");
  });

  it("rejects a reproducer that is not a bounded kind (no shell command)", () => {
    const shell = traceToEvalSample({ ...trace(), reproducer: { kind: "shell", ref: "rm -rf /" } as never });
    expect(shell.ok).toBe(false);
    if (!shell.ok) expect(shell.diagnostics[0].code).toBe("invalid-reproducer");

    const empty = traceToEvalSample({ ...trace(), reproducer: { kind: "route", ref: "" } as never });
    expect(empty.ok).toBe(false);
  });

  it("is an explicit-trigger batch: selected traces only, with per-trace rejections", () => {
    const batch = traceToEvalSamples([
      trace({ runId: "run-a" }),
      trace({ runId: "run-b", outcome: "success" }),
      { ...trace({ runId: "run-c" }), prompt: "leak" },
      trace({ runId: "run-d", signature: "second-failure" }),
    ]);
    expect(batch.samples.map((sample) => sample.sourceRunId)).toEqual(["run-a", "run-b", "run-d"]);
    expect(batch.rejected.map((entry) => entry.runId)).toEqual(["run-c"]);
  });

  it("rejects a trace with a missing required field", () => {
    const missing = traceToEvalSample({ runId: "run-x" });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.diagnostics[0].code).toBe("missing-field");
  });
});