import { describe, expect, it } from 'vitest';

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
  hashRecoveryLongSessionPairInput,
} from '@shared/recovery-contract-eval';
import type {
  RecoveryContractManifest,
  RecoveryLongSessionMeasurement,
  RecoveryWindowTrial,
} from '@shared/recovery-contract-eval';

const GENERATED_AT = '2026-11-03T12:00:00.000Z';

function completeWindowTrials(manifest: RecoveryContractManifest): RecoveryWindowTrial[] {
  return manifest.windows.flatMap((window) => (
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
      evidenceRef: 'artifacts/recovery/windows/' + window.id + '-' + String(index) + '.json',
    }))
  ));
}

function completeLongSessionMeasurements(
  manifest: RecoveryContractManifest,
): RecoveryLongSessionMeasurement[] {
  return manifest.longSessionPairs.map((pair) => ({
    pairId: pair.id,
    family: pair.family,
    provider: 'deepseek',
    model: 'frozen-recovery-eval-model',
    measurementBasis: 'live-provider' as const,
    mustPreserveMatched: pair.mustPreserve.length,
    falseCompletionClaim: false,
    nextActionCorrect: true,
    recoveryLatencyMs: 1200,
    evidenceRef: 'artifacts/recovery/long-session/' + pair.id + '.json',
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

describe('recovery contract eval — frozen matrix', () => {
  it('freezes exactly five failure windows with all five annotations', () => {
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

  it('freezes at least 30 long-session pairs across every required family', () => {
    const manifest = buildRecoveryContractManifest();
    expect(MIN_LONG_SESSION_PAIRS).toBe(30);
    expect(MIN_LONG_SESSION_PAIRS_PER_FAMILY).toBe(6);
    expect(manifest.longSessionPairs.length).toBeGreaterThanOrEqual(MIN_LONG_SESSION_PAIRS);
    expect(manifest.frozenAt).toBe(RECOVERY_CONTRACT_FREEZE_EPOCH);
    expect(manifest.frozenBeforeMeasurement).toBe(true);
    expect(manifest.drivenBy).toBe('agent');
    expect(manifest.actor).toBe('recovery-eval-agent');
    for (const family of RECOVERY_LONG_SESSION_FAMILIES) {
      const familyPairs = manifest.longSessionPairs.filter((pair) => pair.family === family);
      expect(familyPairs.length).toBeGreaterThanOrEqual(MIN_LONG_SESSION_PAIRS_PER_FAMILY);
    }
    expect(new Set(manifest.longSessionPairs.map((pair) => pair.id)).size).toBe(
      manifest.longSessionPairs.length,
    );
    expect(assertFrozenRecoveryContractManifest(manifest).ok).toBe(true);
  });

  it('keeps the frozen manifest hash stable and rejects tampering', () => {
    const first = buildRecoveryContractManifest();
    const second = buildRecoveryContractManifest();

    expect(first.manifestHash).toBe(second.manifestHash);
    expect(hashRecoveryContractManifest(first)).toBe(first.manifestHash);
    expect(hashRecoveryContractManifest(second)).toBe(second.manifestHash);

    const editedAnnotation = structuredClone(first);
    editedAnnotation.windows[0].annotation.injectionPoint = 'a different injection point';
    const annotationCheck = assertFrozenRecoveryContractManifest(editedAnnotation);
    expect(annotationCheck.ok).toBe(false);
    expect(annotationCheck.blockers).toContain('manifest hash mismatch after freeze');

    const relaxedThreshold = structuredClone(first);
    (relaxedThreshold.thresholds as { nextActionAccuracyMin: number }).nextActionAccuracyMin = 0.5;
    const thresholdCheck = assertFrozenRecoveryContractManifest(relaxedThreshold);
    expect(thresholdCheck.ok).toBe(false);
    expect(thresholdCheck.blockers).toContain('quantified thresholds changed after freeze');
  });

  it('rejects a rehashed window matrix under the same frozen epoch', () => {
    const manifest = buildRecoveryContractManifest();
    manifest.windows[0].annotation.allowedRerunRegion = 'edited after freeze';
    manifest.manifestHash = hashRecoveryContractManifest(manifest);

    const result = assertFrozenRecoveryContractManifest(manifest);
    expect(result.ok).toBe(false);
    expect(result.blockers).toContain('failure window matrix changed under the frozen epoch');
  });

  it('rejects a rehashed workload under the same frozen epoch', () => {
    const manifest = buildRecoveryContractManifest();
    manifest.longSessionPairs[0].prompt += '\nedited after freeze';
    const { inputHash: _inputHash, ...pair } = manifest.longSessionPairs[0];
    manifest.longSessionPairs[0].inputHash = hashRecoveryLongSessionPairInput(pair);
    manifest.manifestHash = hashRecoveryContractManifest(manifest);

    const result = assertFrozenRecoveryContractManifest(manifest);
    expect(result.ok).toBe(false);
    expect(result.blockers).toContain('long-session workload changed under the frozen epoch');
  });
});
describe('recovery contract eval — evidence sufficiency', () => {
  it('retains an incomplete failing window after the complete repeat quota is met', () => {
    const input = completeInput();
    input.windowTrials.push({
      ...input.windowTrials[0], trialIndex: 3, duplicateEffects: 1, terminalCorrect: null,
    });

    const result = evaluateRecoveryContractEval(input);
    expect(result.status).toBe('EVIDENCE_INSUFFICIENT');
    expect(result.qualityClaimAllowed).toBe(false);
    expect(result.coverage.windows[0]).toMatchObject({ observedRepeats: 4, completeRepeats: 3 });
    expect(result.metrics.duplicateEffects).toBeNull();
    expect(result.metrics.recoveryLatencyP95).toBeNull();
    expect(result.blockers).toContain('incomplete failure window trial: intent-after-persist-kill#3');
  });

  it('retains an incomplete failing long-session row after the complete pair quota is met', () => {
    const input = completeInput();
    input.longSessionMeasurements.push({
      ...input.longSessionMeasurements[0],
      mustPreserveMatched: 0, falseCompletionClaim: true, recoveryLatencyMs: null,
    });

    const result = evaluateRecoveryContractEval(input);
    expect(result.status).toBe('EVIDENCE_INSUFFICIENT');
    expect(result.qualityClaimAllowed).toBe(false);
    expect(result.coverage.longSession).toMatchObject({ observedPairs: 31, completePairs: 30 });
    expect(result.metrics.mustPreserveFidelity).toBeNull();
    expect(result.metrics.falseCompletionClaims).toBeNull();
    expect(result.metrics.recoveryLatencyP95).toBeNull();
    expect(result.blockers).toContain('incomplete long-session measurement: ' + input.longSessionMeasurements[0].pairId);
  });

  it('rejects an incomplete row outside the frozen workload', () => {
    const input = completeInput();
    input.longSessionMeasurements.push({
      ...input.longSessionMeasurements[0], pairId: 'outside-frozen-workload', recoveryLatencyMs: null,
    });

    const result = evaluateRecoveryContractEval(input);
    expect(result.status).toBe('EVIDENCE_INSUFFICIENT');
    expect(result.qualityClaimAllowed).toBe(false);
    expect(result.metrics.mustPreserveFidelity).toBeNull();
    expect(result.blockers).toContain('incomplete long-session measurement: outside-frozen-workload');
  });

  it('returns EVIDENCE_INSUFFICIENT with every metric null when no sample exists', () => {
    const manifest = buildRecoveryContractManifest();
    const result = evaluateRecoveryContractEval({
      manifest,
      windowTrials: [],
      longSessionMeasurements: [],
      generatedAt: GENERATED_AT,
    });

    expect(result.status).toBe('EVIDENCE_INSUFFICIENT');
    expect(result.qualityClaimAllowed).toBe(false);
    expect(result.realHumanEvidence).toBe(false);
    expect(result.drivenBy).toBe('agent');
    expect(result.actor).toBe('recovery-eval-agent');
    expect(result.unmeasured.length).toBeGreaterThan(0);
    expect(Object.keys(result.metrics).sort()).toEqual(
      [...RECOVERY_CONTRACT_METRIC_FIELDS].sort(),
    );
    for (const field of RECOVERY_CONTRACT_METRIC_FIELDS) {
      expect(result.metrics[field]).toBeNull();
      expect(result.metrics[field]).not.toBe(0);
    }
    expect(result.coverage.windows.every((window) => window.completeRepeats === 0)).toBe(true);
  });

  it('requires three complete repeats in every window', () => {
    const manifest = buildRecoveryContractManifest();
    const trials = completeWindowTrials(manifest).filter((trial) => (
      !(trial.windowId === 'repeated-restart' && trial.trialIndex >= 2)
    ));
    const result = evaluateRecoveryContractEval({
      manifest,
      windowTrials: trials,
      longSessionMeasurements: completeLongSessionMeasurements(manifest),
      generatedAt: GENERATED_AT,
    });

    expect(result.status).toBe('EVIDENCE_INSUFFICIENT');
    expect(result.unmeasured).toContain('window repeated-restart: 2/3 complete repeats');
    expect(result.metrics.duplicateEffects).toBeNull();
    expect(result.metrics.terminalCorrectness).toBeNull();
  });

  it('requires 30 live-provider long-session pairs and never counts scripted rows', () => {
    const manifest = buildRecoveryContractManifest();
    const short = evaluateRecoveryContractEval({
      manifest,
      windowTrials: completeWindowTrials(manifest),
      longSessionMeasurements: completeLongSessionMeasurements(manifest).slice(0, 29),
      generatedAt: GENERATED_AT,
    });
    expect(short.status).toBe('EVIDENCE_INSUFFICIENT');
    expect(short.unmeasured).toContain('long-session live-provider pairs: 29/30');
    expect(short.metrics.mustPreserveFidelity).toBeNull();

    const scripted = completeLongSessionMeasurements(manifest).map((measurement) => ({
      ...measurement,
      measurementBasis: 'scripted-provider' as const,
    }));
    const scriptedResult = evaluateRecoveryContractEval({
      manifest,
      windowTrials: completeWindowTrials(manifest),
      longSessionMeasurements: scripted,
      generatedAt: GENERATED_AT,
    });
    expect(scriptedResult.status).toBe('EVIDENCE_INSUFFICIENT');
    expect(scriptedResult.coverage.longSession.scriptedProviderPairs).toBe(30);
    expect(scriptedResult.coverage.longSession.liveProviderPairs).toBe(0);
    expect(scriptedResult.unmeasured.join('\n')).toContain(
      'scripted-provider and agent-derived long-session rows are recorded but never counted as quality evidence',
    );
    expect(scriptedResult.metrics.mustPreserveFidelity).toBeNull();
  });

  it('rejects measurements outside the frozen workload instead of scoring them', () => {
    const manifest = buildRecoveryContractManifest();
    const measurements = completeLongSessionMeasurements(manifest);
    const result = evaluateRecoveryContractEval({
      manifest,
      windowTrials: completeWindowTrials(manifest),
      longSessionMeasurements: [
        ...measurements,
        {
          ...measurements[0],
          pairId: 'ls-not-in-the-frozen-workload',
        },
      ],
      generatedAt: GENERATED_AT,
    });

    expect(result.status).toBe('EVIDENCE_INSUFFICIENT');
    expect(result.blockers).toContain(
      'long-session measurement outside the frozen workload: ls-not-in-the-frozen-workload',
    );
  });

  it('rejects a tampered manifest before scoring any evidence', () => {
    const manifest = buildRecoveryContractManifest();
    const tampered = structuredClone(manifest);
    tampered.windows[0].annotation.allowedRerunRegion = 'replay everything';
    const result = evaluateRecoveryContractEval({
      ...completeInput(tampered),
      generatedAt: GENERATED_AT,
    });

    expect(result.status).toBe('EVIDENCE_INSUFFICIENT');
    expect(result.blockers).toContain('manifest hash mismatch after freeze');
    expect(result.qualityClaimAllowed).toBe(false);
  });
});
describe('recovery contract eval — quantified gates', () => {
  it('passes only a complete sample that clears every metric gate', () => {
    const manifest = buildRecoveryContractManifest();
    const result = evaluateRecoveryContractEval(completeInput(manifest));

    expect(result.status).toBe('PASS');
    expect(result.qualityClaimAllowed).toBe(true);
    expect(result.decision.disposition).toBe('contract-passed');
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

  it('fails a sample that duplicates effects, loses tasks, invents completion or misses latency', () => {
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

    expect(result.status).toBe('FAIL');
    expect(result.qualityClaimAllowed).toBe(false);
    expect(result.metrics.duplicateEffects).toBe(1);
    expect(result.metrics.lostTasks).toBe(1);
    expect(result.metrics.falseCompletionClaims).toBe(1);
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        'duplicateEffects must be 0 (observed 1)',
        'lostTasks must be 0 (observed 1)',
        'falseCompletionClaims must be 0 (observed 1)',
        'recoveryLatencyP50 must be <= 5000ms (observed 20000)',
        'recoveryLatencyP95 must be <= 15000ms (observed 20000)',
      ]),
    );
  });

  it('fails when required disk evidence is incomplete or a forbidden region is replayed', () => {
    const manifest = buildRecoveryContractManifest();
    const input = completeInput(manifest);
    input.windowTrials[0] = { ...input.windowTrials[0], diskEvidenceComplete: false };
    input.windowTrials[1] = { ...input.windowTrials[1], rerunOutsideAllowedRegion: true };

    const result = evaluateRecoveryContractEval(input);

    expect(result.status).toBe('FAIL');
    expect(result.blockers).toContain(
      '1 window trial(s) did not read back all required disk evidence',
    );
    expect(result.blockers).toContain(
      '1 window trial(s) reran work inside the forbidden region',
    );
    const diskGate = result.gates.find((gateResult) => gateResult.name === 'diskEvidenceComplete');
    const rerunGate = result.gates.find((gateResult) => gateResult.name === 'rerunOutsideAllowedRegion');
    expect(diskGate?.pass).toBe(false);
    expect(rerunGate?.pass).toBe(false);
  });

  it('keeps every metric field present on both PASS and FAIL results', () => {
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
    expect(failResult.status).toBe('FAIL');
    expect(failResult.metrics.terminalCorrectness).toBe(0);
  });
});
