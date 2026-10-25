import { describe, expect, it } from 'vitest';
import {
  PAIRED_FREEZE_EPOCH,
  PAIRED_TARGET_COUNT,
  PAIRED_WORKLOAD_FAMILIES,
  assertFrozenWorkload,
  buildLongSessionPairedWorkload,
  deriveLongSessionPairedStructuralRow,
  deriveLongSessionPairedStructuralRows,
  evaluateLongSessionPair,
  hashLongSessionPairedWorkload,
  renderLongSessionPairedBaselineInput,
  renderLongSessionPairedCandidateInput,
  summarizeLongSessionPairedEvaluation,
} from '@shared/long-session-paired-evaluation';
import type { PairedArmMeasurement, PairedMeasurementRow } from '@shared/long-session-paired-evaluation';

const GENERATED_AT = '2026-10-23T12:00:00.000Z';

function arm(overrides: Partial<PairedArmMeasurement> = {}): Omit<
  PairedArmMeasurement,
  'arm' | 'matchedMustPreserve' | 'missedMustPreserve' | 'leakedForbiddenFacts' | 'nextActionCorrect' | 'falseCompletion'
> {
  return {
    provider: 'deepseek',
    model: 'frozen-paired-evaluation-model',
    measurementBasis: 'live-provider',
    outputText: '',
    costSource: 'provider-report',
    inputTokens: 1000,
    outputTokens: 200,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalCostUsd: 0.01,
    firstTokenMs: 400,
    wallClockMs: 1200,
    ...overrides,
  };
}

function measuredRows(manifest = buildLongSessionPairedWorkload(), overrides: Partial<PairedArmMeasurement> = {}): PairedMeasurementRow[] {
  return manifest.cases.map((caseValue) => {
    const baseline = evaluateLongSessionPair({
      caseValue,
      baseline: arm({ outputText: renderLongSessionPairedBaselineInput(caseValue) }),
      candidate: arm({ outputText: renderLongSessionPairedCandidateInput(caseValue.candidateArtifact), ...overrides }),
    });
    return {
      ...baseline,
      candidate: {
        ...baseline.candidate,
        inputTokens: Math.round((baseline.baseline.inputTokens ?? 0) * 0.8),
        totalCostUsd: (baseline.baseline.totalCostUsd ?? 0) * 0.8,
      },
    };
  });
}

describe('D2 frozen paired workload', () => {
  it('freezes at least 30 agent-driven pairs with every required family before measurement', () => {
    const manifest = buildLongSessionPairedWorkload();
    const frozen = assertFrozenWorkload(manifest);

    expect(frozen.ok).toBe(true);
    expect(frozen.blockers).toEqual([]);
    expect(manifest.workloadCount).toBe(PAIRED_TARGET_COUNT);
    expect(manifest.cases).toHaveLength(PAIRED_TARGET_COUNT);
    expect(manifest.frozenBeforeMeasurement).toBe(true);
    expect(manifest.drivenBy).toBe('agent');
    expect(manifest.frozenAt).toBe(PAIRED_FREEZE_EPOCH);
    for (const family of PAIRED_WORKLOAD_FAMILIES) {
      expect(manifest.families[family]).toBe(6);
      expect(manifest.cases.filter((entry) => entry.family === family)).toHaveLength(6);
    }
    for (const caseValue of manifest.cases) {
      expect(caseValue.mustPreserve.length).toBeGreaterThanOrEqual(4);
      expect(caseValue.expectedNextAction).toContain(caseValue.id);
      expect(caseValue.forbiddenCompletionClaims.length).toBeGreaterThan(0);
      expect(caseValue.forbiddenFacts.map((entry) => entry.reason)).toEqual(
        expect.arrayContaining(['pending-not-accepted', 'unverified-claim']),
      );
    }
    expect(manifest.cases.filter((entry) => entry.family === 'revocation').every((entry) => entry.forbiddenFacts.some((factValue) => factValue.reason === 'revoked-or-superseded'))).toBe(true);
  });

  it('keeps one identical model/parameter block and the frozen hash stable across regeneration', () => {
    const first = buildLongSessionPairedWorkload();
    const second = buildLongSessionPairedWorkload();

    expect(first.workloadHash).toBe(second.workloadHash);
    expect(first.modelParameters).toEqual({
      model: 'frozen-paired-evaluation-model',
      temperature: 0,
      maxOutputTokens: 2048,
    });
    expect(second.cases.map((entry) => entry.inputHash)).toEqual(first.cases.map((entry) => entry.inputHash));
    expect(hashLongSessionPairedWorkload(first)).toBe(first.workloadHash);
    expect(hashLongSessionPairedWorkload(second)).toBe(second.workloadHash);
  });

  it('rejects a tampered workload, budget or case input instead of silently re-measuring', () => {
    const manifest = buildLongSessionPairedWorkload();

    const relaxed = structuredClone(manifest);
    (relaxed.metricBudget as { nextActionTarget: number }).nextActionTarget = 0.6;
    expect(assertFrozenWorkload(relaxed).blockers).toContain('metric budget nextActionTarget changed');

    const shortened = structuredClone(manifest);
    shortened.cases = shortened.cases.slice(0, 29);
    shortened.workloadCount = 29;
    expect(assertFrozenWorkload(shortened).blockers).toEqual(
      expect.arrayContaining(['fewer than 30 workload pairs', 'workload hash mismatch after freeze']),
    );

    const editedCase = structuredClone(manifest);
    editedCase.cases[0].mustPreserve = editedCase.cases[0].mustPreserve.slice(0, 3);
    const editedCheck = assertFrozenWorkload(editedCase);
    expect(editedCheck.blockers).toEqual(
      expect.arrayContaining(['workload hash mismatch after freeze', expect.stringContaining('case input hash mismatch')]),
    );

    const notFrozen = structuredClone(manifest);
    (notFrozen as { frozenBeforeMeasurement: boolean }).frozenBeforeMeasurement = false;
    expect(assertFrozenWorkload(notFrozen).blockers).toContain('workload was not frozen before measurement');
  });

  it('excludes pending, unverified, revoked and cross-scope facts from the candidate projection', () => {
    const manifest = buildLongSessionPairedWorkload();
    const revocation = manifest.cases.find((entry) => entry.family === 'revocation');
    expect(revocation).toBeDefined();
    if (!revocation) throw new Error('frozen workload has no revocation family');

    const rendered = renderLongSessionPairedCandidateInput(revocation.candidateArtifact);
    for (const forbidden of revocation.forbiddenFacts) {
      expect(rendered).not.toContain(forbidden.text);
    }
    for (const required of revocation.mustPreserve) {
      expect(rendered).toContain(required.text);
    }
    expect(rendered).toContain(revocation.expectedNextAction);
    expect(rendered).not.toContain('unverifiedClaims');
  });
});

describe('D2 paired scoring', () => {
  it('scores fidelity, next action, false completion and revoked leaks from raw arm text', () => {
    const manifest = buildLongSessionPairedWorkload();
    const caseValue = manifest.cases[0];

    const good = evaluateLongSessionPair({
      caseValue,
      baseline: arm({ outputText: renderLongSessionPairedBaselineInput(caseValue) }),
      candidate: arm({ outputText: renderLongSessionPairedCandidateInput(caseValue.candidateArtifact) }),
    });
    expect(good.baseline.missedMustPreserve).toEqual([]);
    expect(good.candidate.missedMustPreserve).toEqual([]);
    expect(good.candidate.nextActionCorrect).toBe(true);
    expect(good.candidate.falseCompletion).toBe(false);
    expect(good.candidate.leakedForbiddenFacts).toEqual([]);

    const lossy = evaluateLongSessionPair({
      caseValue,
      baseline: arm({ outputText: renderLongSessionPairedBaselineInput(caseValue) }),
      candidate: arm({
        outputText: `${caseValue.expectedNextAction}\n${caseValue.mustPreserve[0].text}\n${caseValue.mustPreserve[1].text}\n${caseValue.mustPreserve[2].text}\n${caseValue.forbiddenFacts[0].text}\nAll work for ${caseValue.id} is finished.`,
      }),
    });
    expect(lossy.candidate.missedMustPreserve).toContain(caseValue.mustPreserve[3].id);
    expect(lossy.candidate.leakedForbiddenFacts).toContain(caseValue.forbiddenFacts[0].id);
    expect(lossy.candidate.falseCompletion).toBe(true);
  });

  it('promotes nothing without live-provider evidence and returns keep-baseline NO-GO inputs', () => {
    const manifest = buildLongSessionPairedWorkload();
    const rows = deriveLongSessionPairedStructuralRows(manifest, { model: 'frozen-paired-evaluation-model' });
    const report = summarizeLongSessionPairedEvaluation({ manifest, rows, generatedAt: GENERATED_AT });

    expect(report.status).toBe('EVIDENCE_INSUFFICIENT');
    expect(report.liveProviderEvidence).toBe(false);
    expect(report.qualityClaimAllowed).toBe(false);
    expect(report.decisionInputs.disposition).toBe('NO-GO');
    expect(report.decisionInputs.keepBaseline).toBe(true);
    expect(report.decisionInputs.promotionCandidateEligible).toBe(false);
    expect(report.decisionInputs.productDefaultChanged).toBe(false);
    expect(report.blockers).toEqual(
      expect.arrayContaining([
        'no live-provider evidence: agent-derived or synthetic measurements cannot promote a candidate',
        'token and cost reduction are unmeasured for the current sample',
        'first-token and wall-clock P95 are unmeasured for the current sample',
      ]),
    );
    expect(report.unmeasured.length).toBeGreaterThan(0);
    expect(report.decisionInputs.requiresPublisherDecision.length).toBeGreaterThan(0);
    // Unmeasured cells stay null, never zero and never a character estimate.
    expect(report.metrics.baselineInputTokens).toBeNull();
    expect(report.metrics.candidateCostUsd).toBeNull();
    expect(report.metrics.baselineWallClockP95Ms).toBeNull();
    expect(report.metrics.unmeasuredTokenCells).toBe(120);
    expect(report.metrics.unmeasuredLatencyCells).toBe(120);
  });

  it('keeps a structurally clean agent-derived candidate blocked only on missing live evidence', () => {
    const manifest = buildLongSessionPairedWorkload();
    const rows = deriveLongSessionPairedStructuralRows(manifest);
    const report = summarizeLongSessionPairedEvaluation({ manifest, rows, generatedAt: GENERATED_AT });
    const candidateGateBlockers = report.blockers.filter((blocker) =>
      /fidelity|next-action|false task-completion|revoked/iu.test(blocker));

    expect(candidateGateBlockers).toEqual([]);
  });

  it('rejects character-estimated cost as evidence of savings', () => {
    const manifest = buildLongSessionPairedWorkload();
    const rows = measuredRows(manifest, { costSource: 'character-estimate' });
    const report = summarizeLongSessionPairedEvaluation({ manifest, rows, generatedAt: GENERATED_AT });

    expect(report.status).toBe('NO_GO');
    expect(report.qualityClaimAllowed).toBe(false);
    expect(report.metrics.characterEstimatedCostCells).toBe(PAIRED_TARGET_COUNT);
    expect(report.blockers).toEqual(expect.arrayContaining([`${PAIRED_TARGET_COUNT} pair(s) reported a character-estimated cost instead of a provider cost report`]));
  });

  it('fails a candidate that drops a required fact, invents completion or re-injects a revoked fact', () => {
    const manifest = buildLongSessionPairedWorkload();

    const lossy = summarizeLongSessionPairedEvaluation({
      manifest,
      rows: measuredRows(manifest, {
        outputText: (manifest.cases[0].expectedNextAction),
      }),
      generatedAt: GENERATED_AT,
    });
    expect(lossy.status).toBe('NO_GO');
    expect(lossy.metrics.candidateFidelity).toBeLessThan(1);
    expect(lossy.blockers).toContain('candidate fidelity is below the 100% target');

    const lying = summarizeLongSessionPairedEvaluation({
      manifest,
      rows: measuredRows(manifest, {
        outputText: `${manifest.cases[0].mustPreserve.map((entry) => entry.text).join('\n')}\n${manifest.cases[0].expectedNextAction}\nAll work for ${manifest.cases[0].id} is finished.`,
      }),
      generatedAt: GENERATED_AT,
    });
    expect(lying.metrics.candidateFalseCompletions).toBeGreaterThan(0);
    expect(lying.blockers).toContain('candidate contains false task-completion claims');

    const leaked = summarizeLongSessionPairedEvaluation({
      manifest,
      rows: measuredRows(manifest, {
        outputText: `${manifest.cases[0].mustPreserve.map((entry) => entry.text).join('\n')}\n${manifest.cases[0].expectedNextAction}\n${manifest.cases[0].forbiddenFacts[0].text}`,
      }),
      generatedAt: GENERATED_AT,
    });
    expect(leaked.metrics.candidateRevokedLeaks).toBeGreaterThan(0);
    expect(leaked.blockers).toContain('candidate re-injected revoked, pending, unverified or out-of-scope facts');
  });

  it('blocks a candidate whose P95 latency exceeds 1.10x of baseline', () => {
    const manifest = buildLongSessionPairedWorkload();
    const rows = measuredRows(manifest).map((row) => ({
      ...row,
      candidate: {
        ...row.candidate,
        firstTokenMs: (row.baseline.firstTokenMs ?? 0) * 1.5,
        wallClockMs: (row.baseline.wallClockMs ?? 0) * 1.5,
      },
    }));
    const report = summarizeLongSessionPairedEvaluation({ manifest, rows, generatedAt: GENERATED_AT });

    expect(report.blockers).toEqual(
      expect.arrayContaining([
        'candidate first-token P95 exceeds baseline by more than 10%',
        'candidate wall-clock P95 exceeds baseline by more than 10%',
      ]),
    );
    expect(report.decisionInputs.promotionCandidateEligible).toBe(false);
  });

  it('allows promotion only with a full live-provider sample that also clears cost and latency gates', () => {
    const manifest = buildLongSessionPairedWorkload();
    const rows = measuredRows(manifest);
    expect(rows).toHaveLength(PAIRED_TARGET_COUNT);

    const report = summarizeLongSessionPairedEvaluation({ manifest, rows, generatedAt: GENERATED_AT });
    const partial = summarizeLongSessionPairedEvaluation({
      manifest,
      rows: rows.slice(0, PAIRED_TARGET_COUNT - 1),
      generatedAt: GENERATED_AT,
    });

    expect(report.status).toBe('PASS');
    expect(report.qualityClaimAllowed).toBe(true);
    expect(report.liveProviderEvidence).toBe(true);
    expect(report.decisionInputs.disposition).toBe('promote-candidate-eligible');
    expect(report.decisionInputs.keepBaseline).toBe(false);
    expect(report.metrics.inputTokenReduction).toBeCloseTo(0.2, 5);
    expect(report.metrics.costReduction).toBeCloseTo(0.2, 5);
    expect(partial.status).toBe('EVIDENCE_INSUFFICIENT');
    expect(partial.blockers).toContain('no live-provider evidence: agent-derived or synthetic measurements cannot promote a candidate');
  });

  it('rejects measurement rows outside the frozen workload and mixed model identity', () => {
    const manifest = buildLongSessionPairedWorkload();
    const rows = measuredRows(manifest);
    const stranger = deriveLongSessionPairedStructuralRow(manifest.cases[0]);
    const withStranger = [...rows.slice(1), { ...stranger, caseId: 'd2-not-frozen' }];

    const report = summarizeLongSessionPairedEvaluation({
      manifest,
      rows: withStranger,
      generatedAt: GENERATED_AT,
    });
    expect(report.blockers).toContain('1 measured row(s) outside the frozen workload');
    expect(report.negativeCases.map((entry) => entry.id)).toContain('measurement-outside-frozen-workload');
    expect(report.samplePairs).toBe(PAIRED_TARGET_COUNT - 1);

    const mixedModel = summarizeLongSessionPairedEvaluation({
      manifest,
      rows: rows.map((row, index) => (index === 0 ? { ...row, candidate: { ...row.candidate, model: 'other-model' } } : row)),
      generatedAt: GENERATED_AT,
    });
    expect(mixedModel.blockers).toContain('baseline and candidate did not share identical model parameters');
  });
});