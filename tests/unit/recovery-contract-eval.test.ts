import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";

import {
  MIN_LONG_SESSION_PAIRS,
  MIN_LONG_SESSION_PAIRS_PER_FAMILY,
  MIN_REPEATS_PER_WINDOW,
  RECOVERY_CONTRACT_FREEZE_EPOCH,
  RECOVERY_CONTRACT_METRIC_FIELDS,
  RECOVERY_FAILURE_WINDOW_IDS,
  RECOVERY_FAILURE_WINDOWS,
  RECOVERY_LONG_SESSION_FAMILIES,
  RECOVERY_WINDOW_ANNOTATION_FIELDS,
  assertFrozenRecoveryContractManifest,
  buildRecoveryContractManifest,
  evaluateRecoveryContractEval,
  hashRecoveryContractManifest,
} from "@shared/recovery-contract-eval";
import type {
  RecoveryContractManifest,
  RecoveryLongSessionMeasurement,
  RecoveryWindowTrial,
} from "@shared/recovery-contract-eval";

const GENERATED_AT = "2026-11-03T12:00:00.000Z";

it("the evidence driver does not relabel observed fault windows as frozen windows", () => {
  const dir = mkdtempSync(join(tmpdir(), "recovery-wrong-window-"));
  try {
    const manifest = buildRecoveryContractManifest();
    for (const trial of completeWindowTrials(manifest)) {
      writeFileSync(
        join(dir, `trial-${trial.windowId}-${trial.trialIndex}.json`),
        JSON.stringify({
          ...trial,
          injectionPoint: "a different boundary observed on disk",
        }),
      );
    }
    const child = spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        resolve("scripts/recovery-contract-eval.mjs"),
        "--check",
        "--dir",
        dir,
        "--pairs",
        dir,
      ],
      {
        encoding: "utf8",
        windowsHide: true,
        timeout: 30_000,
      },
    );
    expect(child.error).toBeUndefined();
    const report = JSON.parse(child.stdout);
    expect(child.status).toBe(1);
    expect(report.status).toBe("EVIDENCE_INSUFFICIENT");
    expect(report.metrics.lostTasks).toBeNull();
    expect(report.qualityClaimAllowed).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("rejudges the saved assistant answer instead of trusting a stale preliminary score", () => {
  const dir = mkdtempSync(join(tmpdir(), "recovery-answer-oracle-"));
  try {
    const pair = buildRecoveryContractManifest().longSessionPairs.find(
      (pair) => pair.family === "handoff",
    )!;
    const assistantText = JSON.stringify({
      objective: pair.mustPreserve[0],
      constraint: pair.mustPreserve[1],
      decision: pair.mustPreserve[2],
      nextAction: pair.expectedNextAction,
      complete: false,
    });
    const branch = [
      { id: "question-1", message: { role: "user", content: "Recovery readback for " + pair.id } },
      {
        id: "answer-1",
        message: { role: "assistant", content: assistantText, stopReason: "stop" },
      },
    ];
    const artifacts = ["before.json", "boundary.json", "answer.json"].map((name) => {
      const value =
        name === "answer.json"
          ? {
              assistantEntryId: "answer-1",
              assistantText,
              disk: { branch },
            }
          : name === "boundary.json"
            ? { disk: { entries: [] } }
            : {};
      const bytes = JSON.stringify(value);
      const path = join(dir, name);
      writeFileSync(path, bytes);
      return { path, sha256: createHash("sha256").update(bytes).digest("hex") };
    });
    writeFileSync(
      join(dir, `pair-${pair.id}.json`),
      JSON.stringify({
        schema: "RecoveryLongSessionPairReceipt/v2",
        pairId: pair.id,
        family: pair.family,
        provider: "fixture",
        model: "fixture",
        measurementBasis: "live-provider",
        artifacts,
        observed: { postBoundaryAnswer: true, assistantEntryId: "answer-1" },
        mustPreserveMatched: 0,
        nextActionCorrect: false,
        falseCompletionClaim: true,
        recoveryLatencyMs: 1000,
        evidenceRef: dir,
      }),
    );
    const output = join(dir, "report.json");
    const child = spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        resolve("scripts/recovery-contract-eval.mjs"),
        "--dir",
        dir,
        "--pairs",
        dir,
        "--output",
        output,
      ],
      { encoding: "utf8", windowsHide: true, timeout: 30_000 },
    );
    expect(child.status).toBe(1);
    const report = JSON.parse(readFileSync(output, "utf8"));
    expect(report.readbackJudgements[0]).toMatchObject({
      preliminary: { mustPreserveMatched: 0, nextActionCorrect: false, falseCompletionClaim: true },
      judged: {
        mustPreserveMatched: 4,
        nextActionCorrect: true,
        falseCompletionClaim: false,
        schemaValid: false,
      },
    });
    const verification=spawnSync(process.execPath,['--experimental-strip-types',resolve('scripts/recovery-contract-eval.mjs'),
      '--dir',dir,'--pairs',dir,'--verify',output],{encoding:'utf8',windowsHide:true,timeout:30_000});
    expect(verification.status).toBe(0);expect(JSON.parse(verification.stdout).reproduced).toBe(true);
    writeFileSync(artifacts[2].path, "{}");
    const invalid = spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        resolve("scripts/recovery-contract-eval.mjs"),
        "--dir",
        dir,
        "--pairs",
        dir,
        "--output",
        output,
      ],
      { encoding: "utf8", windowsHide: true, timeout: 30_000 },
    );
    expect(invalid.status).toBe(1);
    expect(JSON.parse(readFileSync(output, "utf8")).readbackJudgements).toHaveLength(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it.each([
  { name: "actual throw", point: "session-store-before-ack", action: "throw", tamper: false, failures: 0 },
  { name: "reported hit only", point: "different-boundary", action: "throw", tamper: false, failures: 3 },
  { name: "pause instead of failure", point: "session-store-before-ack", action: "pause", tamper: false, failures: 3 },
  { name: "tampered bytes", point: "session-store-before-ack", action: "throw", tamper: true, failures: 3 },
])("verifies K4 from the hashed failed-write artifact: $name", ({ point, action, tamper, failures }) => {
  const dir = mkdtempSync(join(tmpdir(), "recovery-store-boundary-"));
  try {
    for (const trial of completeWindowTrials(buildRecoveryContractManifest()).filter(
      (trial) => trial.windowId === "store-write-failure",
    )) {
      const evidenceDir = join(dir, String(trial.trialIndex));
      mkdirSync(evidenceDir);
      const artifacts = ["before.json", "failed-write.json", "retry.json"].map((name) => {
        const bytes = JSON.stringify(name === "failed-write.json" ? {
          error: "EIO", hit: [{ point, action }], failed: {},
        } : {});
        const artifactPath = join(evidenceDir, name);
        writeFileSync(artifactPath, bytes);
        const sha256 = createHash("sha256").update(bytes).digest("hex");
        if (tamper && name === "failed-write.json") writeFileSync(artifactPath, "{}");
        return { path: artifactPath, sha256 };
      });
      writeFileSync(join(dir, "trial-store-" + String(trial.trialIndex) + ".json"), JSON.stringify({
        ...trial, artifacts,
        observed: {
          error: "EIO", unchanged: true, retryApplied: true,
          ...(failures ? { hit: [{ point: "session-store-before-ack", action: "throw" }] } : {}),
        },
      }));
    }
    const output = join(dir, "report.json");
    const execution = spawnSync(process.execPath, [
      "--experimental-strip-types", resolve("scripts/recovery-contract-eval.mjs"),
      "--dir", dir, "--pairs", dir, "--output", output,
    ], { encoding: "utf8", windowsHide: true, timeout: 30_000 });
    expect(execution.error).toBeUndefined();
    const report = JSON.parse(readFileSync(output, "utf8"));
    expect(report.evaluation.gates.find((gate: { name: string }) => gate.name === "diskEvidenceComplete"))
      .toMatchObject({ observed: failures, pass: failures === 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function completeWindowTrials(manifest: RecoveryContractManifest): RecoveryWindowTrial[] {
  return manifest.windows.flatMap((window) =>
    Array.from({ length: MIN_REPEATS_PER_WINDOW }, (_, index) => ({
      windowId: window.id,
      trialIndex: index,
      injectionPoint: window.annotation.injectionPoint,
      duplicateEffects: 0,
      lostTasks: 0,
      terminalCorrect: true,
      unknownClassifiable: false,
      recoveryLatencyMs: 1000,
      diskEvidenceComplete: true,
      rerunOutsideAllowedRegion: false,
      evidenceRef: "artifacts/recovery/windows/" + window.id + "-" + String(index) + ".json",
    })),
  );
}

function completeLongSessionMeasurements(
  manifest: RecoveryContractManifest,
): RecoveryLongSessionMeasurement[] {
  return manifest.longSessionPairs.map((pair) => ({
    pairId: pair.id,
    family: pair.family,
    provider: "deepseek",
    model: "frozen-recovery-eval-model",
    measurementBasis: "live-provider" as const,
    mustPreserveMatched: pair.mustPreserve.length,
    falseCompletionClaim: false,
    nextActionCorrect: true,
    recoveryLatencyMs: 1200,
    evidenceRef: "artifacts/recovery/long-session/" + pair.id + ".json",
  }));
}

function completeInput(manifest: RecoveryContractManifest = buildRecoveryContractManifest()) {
  return {
    manifest,
    windowTrials: completeWindowTrials(manifest),
    longSessionMeasurements: completeLongSessionMeasurements(manifest),
    generatedAt: GENERATED_AT,
  };
}

describe("recovery contract eval — frozen matrix", () => {
  it("freezes exactly five failure windows with all five annotations", () => {
    expect(MIN_REPEATS_PER_WINDOW).toBe(3);
    expect(RECOVERY_FAILURE_WINDOWS).toHaveLength(5);
    expect(RECOVERY_FAILURE_WINDOWS.map((window) => window.id)).toEqual([
      ...RECOVERY_FAILURE_WINDOW_IDS,
    ]);
    for (const window of RECOVERY_FAILURE_WINDOWS) {
      expect(window.minRepeats).toBeGreaterThanOrEqual(MIN_REPEATS_PER_WINDOW);
      expect(Object.keys(window.annotation).sort()).toEqual(
        [...RECOVERY_WINDOW_ANNOTATION_FIELDS].sort(),
      );
      for (const field of RECOVERY_WINDOW_ANNOTATION_FIELDS) {
        const value = window.annotation[field];
        if (Array.isArray(value)) {
          expect(value.length).toBeGreaterThan(0);
          expect(value.every((entry) => entry.trim().length > 0)).toBe(true);
        } else {
          expect(value.trim().length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("freezes at least 30 long-session pairs across every required family", () => {
    const manifest = buildRecoveryContractManifest();
    expect(MIN_LONG_SESSION_PAIRS).toBe(30);
    expect(MIN_LONG_SESSION_PAIRS_PER_FAMILY).toBe(6);
    expect(manifest.longSessionPairs.length).toBeGreaterThanOrEqual(MIN_LONG_SESSION_PAIRS);
    expect(manifest.frozenAt).toBe(RECOVERY_CONTRACT_FREEZE_EPOCH);
    expect(manifest.frozenBeforeMeasurement).toBe(true);
    expect(manifest.drivenBy).toBe("agent");
    expect(manifest.actor).toBe("recovery-eval-agent");
    for (const family of RECOVERY_LONG_SESSION_FAMILIES) {
      const familyPairs = manifest.longSessionPairs.filter((pair) => pair.family === family);
      expect(familyPairs.length).toBeGreaterThanOrEqual(MIN_LONG_SESSION_PAIRS_PER_FAMILY);
    }
    expect(new Set(manifest.longSessionPairs.map((pair) => pair.id)).size).toBe(
      manifest.longSessionPairs.length,
    );
    expect(assertFrozenRecoveryContractManifest(manifest).ok).toBe(true);
  });

  it("keeps the frozen manifest hash stable and rejects tampering", () => {
    const first = buildRecoveryContractManifest();
    const second = buildRecoveryContractManifest();

    expect(first.manifestHash).toBe(second.manifestHash);
    expect(hashRecoveryContractManifest(first)).toBe(first.manifestHash);
    expect(hashRecoveryContractManifest(second)).toBe(second.manifestHash);

    const editedAnnotation = structuredClone(first);
    editedAnnotation.windows[0].annotation.injectionPoint = "a different injection point";
    const annotationCheck = assertFrozenRecoveryContractManifest(editedAnnotation);
    expect(annotationCheck.ok).toBe(false);
    expect(annotationCheck.blockers).toContain("manifest hash mismatch after freeze");

    const relaxedThreshold = structuredClone(first);
    (relaxedThreshold.thresholds as { nextActionAccuracyMin: number }).nextActionAccuracyMin = 0.5;
    const thresholdCheck = assertFrozenRecoveryContractManifest(relaxedThreshold);
    expect(thresholdCheck.ok).toBe(false);
    expect(thresholdCheck.blockers).toContain("quantified thresholds changed after freeze");
  });
});
describe("recovery contract eval — evidence sufficiency", () => {
  it("returns EVIDENCE_INSUFFICIENT with every metric null when no sample exists", () => {
    const manifest = buildRecoveryContractManifest();
    const result = evaluateRecoveryContractEval({
      manifest,
      windowTrials: [],
      longSessionMeasurements: [],
      generatedAt: GENERATED_AT,
    });

    expect(result.status).toBe("EVIDENCE_INSUFFICIENT");
    expect(result.qualityClaimAllowed).toBe(false);
    expect(result.realHumanEvidence).toBe(false);
    expect(result.drivenBy).toBe("agent");
    expect(result.actor).toBe("recovery-eval-agent");
    expect(result.unmeasured.length).toBeGreaterThan(0);
    expect(Object.keys(result.metrics).sort()).toEqual([...RECOVERY_CONTRACT_METRIC_FIELDS].sort());
    for (const field of RECOVERY_CONTRACT_METRIC_FIELDS) {
      expect(result.metrics[field]).toBeNull();
      expect(result.metrics[field]).not.toBe(0);
    }
    expect(result.coverage.windows.every((window) => window.completeRepeats === 0)).toBe(true);
  });

  it("requires three complete repeats in every window", () => {
    const manifest = buildRecoveryContractManifest();
    const trials = completeWindowTrials(manifest).filter(
      (trial) => !(trial.windowId === "repeated-restart" && trial.trialIndex >= 2),
    );
    const result = evaluateRecoveryContractEval({
      manifest,
      windowTrials: trials,
      longSessionMeasurements: completeLongSessionMeasurements(manifest),
      generatedAt: GENERATED_AT,
    });

    expect(result.status).toBe("EVIDENCE_INSUFFICIENT");
    expect(result.unmeasured).toContain("window repeated-restart: 2/3 complete repeats");
    expect(result.metrics.duplicateEffects).toBeNull();
    expect(result.metrics.terminalCorrectness).toBeNull();
  });

  it("requires 30 live-provider long-session pairs and never counts scripted rows", () => {
    const manifest = buildRecoveryContractManifest();
    const short = evaluateRecoveryContractEval({
      manifest,
      windowTrials: completeWindowTrials(manifest),
      longSessionMeasurements: completeLongSessionMeasurements(manifest).slice(0, 29),
      generatedAt: GENERATED_AT,
    });
    expect(short.status).toBe("EVIDENCE_INSUFFICIENT");
    expect(short.unmeasured).toContain("long-session live-provider pairs: 29/30");
    expect(short.metrics.mustPreserveFidelity).toBeNull();

    const scripted = completeLongSessionMeasurements(manifest).map((measurement) => ({
      ...measurement,
      measurementBasis: "scripted-provider" as const,
    }));
    const scriptedResult = evaluateRecoveryContractEval({
      manifest,
      windowTrials: completeWindowTrials(manifest),
      longSessionMeasurements: scripted,
      generatedAt: GENERATED_AT,
    });
    expect(scriptedResult.status).toBe("EVIDENCE_INSUFFICIENT");
    expect(scriptedResult.coverage.longSession.scriptedProviderPairs).toBe(30);
    expect(scriptedResult.coverage.longSession.liveProviderPairs).toBe(0);
    expect(scriptedResult.unmeasured.join("\n")).toContain(
      "scripted-provider and agent-derived long-session rows are recorded but never counted as quality evidence",
    );
    expect(scriptedResult.metrics.mustPreserveFidelity).toBeNull();
  });

  it("rejects measurements outside the frozen workload instead of scoring them", () => {
    const manifest = buildRecoveryContractManifest();
    const measurements = completeLongSessionMeasurements(manifest);
    const result = evaluateRecoveryContractEval({
      manifest,
      windowTrials: completeWindowTrials(manifest),
      longSessionMeasurements: [
        ...measurements,
        {
          ...measurements[0],
          pairId: "ls-not-in-the-frozen-workload",
        },
      ],
      generatedAt: GENERATED_AT,
    });

    expect(result.status).toBe("EVIDENCE_INSUFFICIENT");
    expect(result.blockers).toContain(
      "long-session measurement outside the frozen workload: ls-not-in-the-frozen-workload",
    );
  });

  it("rejects a tampered manifest before scoring any evidence", () => {
    const manifest = buildRecoveryContractManifest();
    const tampered = structuredClone(manifest);
    tampered.windows[0].annotation.allowedRerunRegion = "replay everything";
    const result = evaluateRecoveryContractEval({
      ...completeInput(tampered),
      generatedAt: GENERATED_AT,
    });

    expect(result.status).toBe("EVIDENCE_INSUFFICIENT");
    expect(result.blockers).toContain("manifest hash mismatch after freeze");
    expect(result.qualityClaimAllowed).toBe(false);
  });
});
describe("recovery contract eval — quantified gates", () => {
  it("passes only a complete sample that clears every metric gate", () => {
    const manifest = buildRecoveryContractManifest();
    const result = evaluateRecoveryContractEval(completeInput(manifest));

    expect(result.status).toBe("PASS");
    expect(result.qualityClaimAllowed).toBe(true);
    expect(result.decision.disposition).toBe("contract-passed");
    expect(result.decision.productDefaultChanged).toBe(false);
    expect(result.metrics.duplicateEffects).toBe(0);
    expect(result.metrics.lostTasks).toBe(0);
    expect(result.metrics.terminalCorrectness).toBe(1);
    expect(result.metrics.unknownClassifiableRate).toBe(0);
    expect(result.metrics.mustPreserveFidelity).toBe(1);
    expect(result.metrics.falseCompletionClaims).toBe(0);
    expect(result.metrics.nextActionAccuracy).toBe(1);
    expect(result.metrics.recoveryLatencyP50).toBe(1200);
    expect(result.metrics.recoveryLatencyP95).toBeCloseTo(1200, 5);
    expect(result.gates).toHaveLength(11);
    expect(result.gates.every((gateResult) => gateResult.pass === true)).toBe(true);
    expect(result.coverage.windows).toHaveLength(5);
    expect(result.coverage.longSession.liveProviderPairs).toBe(30);
  });

  it("fails a sample that duplicates effects, loses tasks, invents completion or misses latency", () => {
    const manifest = buildRecoveryContractManifest();
    const input = completeInput(manifest);
    input.windowTrials[0] = { ...input.windowTrials[0], duplicateEffects: 1 };
    input.windowTrials[1] = { ...input.windowTrials[1], lostTasks: 1 };
    input.longSessionMeasurements[0] = {
      ...input.longSessionMeasurements[0],
      falseCompletionClaim: true,
    };
    input.windowTrials = input.windowTrials.map((trial) => ({
      ...trial,
      recoveryLatencyMs: 20000,
    }));
    input.longSessionMeasurements = input.longSessionMeasurements.map((measurement) => ({
      ...measurement,
      recoveryLatencyMs: 20000,
    }));

    const result = evaluateRecoveryContractEval(input);

    expect(result.status).toBe("FAIL");
    expect(result.qualityClaimAllowed).toBe(false);
    expect(result.metrics.duplicateEffects).toBe(1);
    expect(result.metrics.lostTasks).toBe(1);
    expect(result.metrics.falseCompletionClaims).toBe(1);
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        "duplicateEffects must be 0 (observed 1)",
        "lostTasks must be 0 (observed 1)",
        "falseCompletionClaims must be 0 (observed 1)",
        "recoveryLatencyP50 must be <= 5000ms (observed 20000)",
        "recoveryLatencyP95 must be <= 15000ms (observed 20000)",
      ]),
    );
  });

  it("fails when required disk evidence is incomplete or a forbidden region is replayed", () => {
    const manifest = buildRecoveryContractManifest();
    const input = completeInput(manifest);
    input.windowTrials[0] = { ...input.windowTrials[0], diskEvidenceComplete: false };
    input.windowTrials[1] = { ...input.windowTrials[1], rerunOutsideAllowedRegion: true };

    const result = evaluateRecoveryContractEval(input);

    expect(result.status).toBe("FAIL");
    expect(result.blockers).toContain(
      "1 window trial(s) did not read back all required disk evidence",
    );
    expect(result.blockers).toContain("1 window trial(s) reran work inside the forbidden region");
    const diskGate = result.gates.find((gateResult) => gateResult.name === "diskEvidenceComplete");
    const rerunGate = result.gates.find(
      (gateResult) => gateResult.name === "rerunOutsideAllowedRegion",
    );
    expect(diskGate?.pass).toBe(false);
    expect(rerunGate?.pass).toBe(false);
  });

  it("keeps every metric field present on both PASS and FAIL results", () => {
    const manifest = buildRecoveryContractManifest();
    const passResult = evaluateRecoveryContractEval(completeInput(manifest));
    const failResult = evaluateRecoveryContractEval({
      ...completeInput(manifest),
      windowTrials: completeWindowTrials(manifest).map((trial) => ({
        ...trial,
        terminalCorrect: false,
      })),
    });

    for (const result of [passResult, failResult]) {
      expect(Object.keys(result.metrics).sort()).toEqual(
        [...RECOVERY_CONTRACT_METRIC_FIELDS].sort(),
      );
      for (const field of RECOVERY_CONTRACT_METRIC_FIELDS) {
        expect(result.metrics[field]).not.toBeUndefined();
      }
    }
    expect(failResult.status).toBe("FAIL");
    expect(failResult.metrics.terminalCorrectness).toBe(0);
  });
});
