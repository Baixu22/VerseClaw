import { describe, expect, it } from "vitest";
import {
  normalizeArm,
  normalizeTrial,
  summarizeTrials,
  type PairedArm,
  type PairedTrial,
} from "../../scripts/versegit-product-paired-evaluation.mts";

function arm(overrides: Partial<PairedArm> = {}): PairedArm {
  return {
    arm: "off",
    feedback_delivered: false,
    feedback_evidence_id: null,
    reread_count: 0,
    rework_count: 0,
    validation_exit_code: 1,
    validation_status: "failed",
    validation_output_sha256: "failed-output",
    ...overrides,
  };
}
function trial(kind: "positive" | "negative", index: number, overrides: Partial<PairedTrial> = {}): PairedTrial {
  return {
    kind,
    trial: index,
    off: kind === "positive" ? arm({ arm: "off" }) : arm({ arm: "off", validation_exit_code: 0, validation_status: "passed", validation_output_sha256: "passed-output" }),
    on: kind === "positive"
      ? arm({ arm: "on", feedback_delivered: true, feedback_evidence_id: "vgf-test", reread_count: 1, rework_count: 1, validation_exit_code: 0, validation_status: "passed", validation_output_sha256: "passed-output" })
      : arm({ arm: "on", validation_exit_code: 0, validation_status: "passed", validation_output_sha256: "passed-output" }),
    ...overrides,
  };
}

describe("D2 paired evaluation normalization", () => {
  it("records the positive behavior shift and unrelated negative without conflating transcript presence", () => {
    const trials = [trial("positive", 1), trial("positive", 2), trial("negative", 1), trial("negative", 2)];
    const summary = summarizeTrials(trials);
    expect(summary).toMatchObject({
      positive_trials: 2,
      negative_trials: 2,
      positive_off_fail_count: 2,
      positive_on_pass_count: 2,
      behavior_shift_count: 2,
      negative_false_positive_count: 0,
      stable_normalized_outcomes: true,
      passed: true,
    });
    expect(JSON.stringify(normalizeTrial(trials[0]!))).not.toContain("validation_exit_code");
    expect(normalizeArm(trials[0]!.on)).toEqual({
      arm: "on",
      feedback_delivered: true,
      reread_count: 1,
      rework_count: 1,
      validation_status: "passed",
    });
  });

  it("fails stability and behavior-shift gates when repeated outcomes drift", () => {
    const drift = trial("positive", 2, {
      on: arm({ arm: "on", feedback_delivered: true, reread_count: 0, rework_count: 0, validation_exit_code: 1, validation_status: "failed", validation_output_sha256: "failed-output" }),
    });
    const summary = summarizeTrials([trial("positive", 1), drift, trial("negative", 1)]);
    expect(summary.stable_normalized_outcomes).toBe(false);
    expect(summary.behavior_shift_count).toBe(1);
    expect(summary.passed).toBe(false);
  });

  it("does not invent a behavior shift from delivery alone", () => {
    const deliveredButBroken = trial("positive", 1, {
      on: arm({ arm: "on", feedback_delivered: true, reread_count: 0, rework_count: 0, validation_exit_code: 1, validation_status: "failed", validation_output_sha256: "failed-output" }),
    });
    const summary = summarizeTrials([deliveredButBroken, trial("negative", 1)]);
    expect(summary.behavior_shift_count).toBe(0);
    expect(summary.passed).toBe(false);
  });
});
