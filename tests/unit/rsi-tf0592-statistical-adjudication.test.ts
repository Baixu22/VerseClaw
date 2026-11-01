// @vitest-environment node
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  buildNegativeControls, buildTf0592Report, collectResourceFingerprint,
  runNegativeControls, summarizeTf0592Trials, TF0592_PACK_DIR,
  validateTf0592Pack, validateTf0592Report, wilsonCi95,
  type Tf0592Corpus, type Tf0592Policy, type Tf0592RawTrials, type Tf0592Report, type Tf0592Trial,
} from '../../scripts/rsi-tf0592-statistical-adjudication.mjs';
import { sha256File, TF0604_PACK_DIR } from '../../scripts/rsi-tf0604-baseline.mjs';

const ROOT = process.cwd();
const TEMP_ROOT = 'D:/tmp';
const temporaryRoots: string[] = [];
const corpus: Tf0592Corpus = JSON.parse(readFileSync(join(ROOT, TF0604_PACK_DIR, 'task-corpus.v1.json'), 'utf8'));
const policy: Tf0592Policy = JSON.parse(readFileSync(join(ROOT, 'harness/specs/fixtures/rsi-evidence-loop/promotion-policy.v1.json'), 'utf8'));
const codes = (result: { errors: Array<{ code: string }> }) => result.errors.map((entry) => entry.code);

function trials(baselineFailures = 0, treatmentFailures?: number): Tf0592RawTrials {
  const arms: Array<'baseline' | 'treatment'> = treatmentFailures === undefined ? ['baseline'] : ['baseline', 'treatment'];
  return { cases: corpus.cases.map((task, index) => ({
    caseId: task.id,
    trials: index >= 20 ? [] : arms.flatMap((arm) =>
      Array.from({ length: 3 }, (_, repeat): Tf0592Trial => ({
        arm, repeat: repeat + 1,
        outcome: index < (arm === 'baseline' ? baselineFailures : treatmentFailures ?? 0) ? 'fail' : 'pass',
        failureClass: index < (arm === 'baseline' ? baselineFailures : treatmentFailures ?? 0) ? 'agent' : null,
        tokens: 10, turns: 1, toolCalls: 2, wallClockMs: (repeat + 1) * 10, cost: 0.01,
      }))),
  })) };
}

function copyPack(): string {
  mkdirSync(TEMP_ROOT, { recursive: true });
  const temp = mkdtempSync(join(TEMP_ROOT, 'rsi-tf0592-test-'));
  temporaryRoots.push(temp);
  const report: Tf0592Report = JSON.parse(readFileSync(join(ROOT, TF0592_PACK_DIR, 'statistical-report.v1.json'), 'utf8'));
  const paths = [...Object.keys(report.resourceFingerprint.candidate.sourceHashes), report.inputs.corpusPath, report.inputs.rawTrialsPath, report.inputs.policyPath, report.inputs.systemRunPath,
    ...['resource-fingerprint.v1.json', 'statistical-report.v1.json', 'negative-controls.v1.json', 'negative-control-results.v1.json', 'validation-report.v1.json', 'SHA256SUMS'].map((file) => `${TF0592_PACK_DIR}/${file}`)];
  for (const path of paths) {
    mkdirSync(dirname(join(temp, path)), { recursive: true });
    copyFileSync(join(ROOT, path), join(temp, path));
  }
  return temp;
}

function reseal(temp: string): void {
  const pack = join(temp, TF0592_PACK_DIR);
  const files = ['resource-fingerprint.v1.json', 'statistical-report.v1.json', 'negative-controls.v1.json', 'negative-control-results.v1.json', 'validation-report.v1.json'];
  writeFileSync(join(pack, 'SHA256SUMS'), `${files.map((file) => `${sha256File(join(pack, file))}  ${file}`).join('\n')}\n`);
}

afterAll(() => {
  for (const path of temporaryRoots) {
    if (!resolve(path).startsWith(`${resolve(TEMP_ROOT)}${sep}rsi-tf0592-test-`)) throw new Error('unexpected temporary cleanup path');
    rmSync(path, { recursive: true, force: true });
  }
});

describe('TF-0592 statistical adjudication', () => {
  it('reads the sealed measured system run and publishes its actual statistics', () => {
    const { report } = buildTf0592Report(ROOT);
    expect(report.status).toBe('fail');
    expect(report.run.completeCaseCount).toBe(20);
    expect(report.run.trialCount).toBe(144);
    expect(report.perTask).toHaveLength(24);
    expect(report.aggregate.passK).toBe(0.15);
    expect(report.aggregate.passAtK).toBe(0.35);
    expect(report.aggregate.confidenceInterval95).toEqual([0.052369, 0.360419]);
    expect(report.pairedDiff.status).toBe('computed');
    expect(report.power.status).toBe('underpowered');
    expect(Object.values(report.claims)).toEqual([false, false, false, false]);
    expect(validateTf0592Report(report, ROOT, { allowDraft: true }).passed).toBe(true);
  });

  it('uses complete cases rather than trial successes in the Wilson interval', () => {
    const result = summarizeTf0592Trials(corpus, trials(), policy);
    expect(result.run.completeCaseCount).toBe(20);
    expect(result.run.trialCount).toBe(60);
    expect(result.aggregate.passK).toBe(1);
    expect(result.aggregate.passAtK).toBe(1);
    expect(result.aggregate.confidenceInterval95).toEqual([0.838875, 1]);
    expect(wilsonCi95(0, 20)).toEqual([0, 0.161125]);
  });

  it('keeps all-k and any-k reliability separate and preserves the first failure', () => {
    const raw = trials();
    const first = raw.cases[0].trials[0] as Tf0592Trial;
    first.outcome = 'fail'; first.failureClass = 'agent';
    const result = summarizeTf0592Trials(corpus, raw, policy);
    expect(result.aggregate.passK).toBe(0.95);
    expect(result.aggregate.passAtK).toBe(1);
    expect(result.aggregate.flakeRate).toBe(0.05);
    expect(result.perTask[0].trials[0].outcome).toBe('fail');
  });

  it.each([[4, 0, 0.2], [0, 4, -0.2], [0, 0, 0]])('reuses paired baseline/treatment comparison (%i, %i)', (baseline, treatment, difference) => {
    const result = summarizeTf0592Trials(corpus, trials(baseline, treatment), policy);
    expect(result.run.trialCount).toBe(120);
    expect(result.pairedDiff.status).toBe('computed');
    expect(result.pairedDiff.pairCount).toBe(20);
    expect(result.pairedDiff.repeatPairCount).toBe(60);
    expect(result.pairedDiff.meanDiff).toBe(difference);
    expect(result.pairedDiff.passKDelta).toBe(difference);
    if (difference > 0) expect(result.pairedDiff.ci95![0]).toBeGreaterThan(0);
    else if (difference < 0) expect(result.pairedDiff.ci95![1]).toBeLessThan(0);
    else expect(result.pairedDiff.ci95).toBeNull();
    expect(result.power.passKPower).toBe(difference === 0 ? 'insufficient-evidence' : 'underpowered');
  });

  it('counts timeout trials, excludes incomplete cases and audits infra separately', () => {
    const raw = trials();
    const first = raw.cases[0].trials[0] as Tf0592Trial;
    first.outcome = 'timeout'; first.failureClass = 'infrastructure';
    const result = summarizeTf0592Trials(corpus, raw, policy);
    expect(result.run.trialCount).toBe(60);
    expect(result.run.completeCaseCount).toBe(19);
    expect(result.status).toBe('insufficient-evidence');
    expect(result.aggregate.passK).toBeNull();
    expect(result.aggregate.incomplete).toContainEqual({ caseId: corpus.cases[0].id, trialIndex: 0, outcome: 'timeout' });
    expect(result.failureClasses.infrastructure.trialCount).toBe(1);
    expect(result.failureClasses.agent.trialCount).toBe(0);
  });

  it('preserves unmatched pairs and refuses a thin paired interval', () => {
    const raw = trials(4, 0);
    raw.cases[0].trials.pop();
    const result = summarizeTf0592Trials(corpus, raw, policy);
    expect(result.run.trialCount).toBe(119);
    expect(result.pairedDiff.pairCount).toBe(19);
    expect(result.pairedDiff.repeatPairCount).toBe(59);
    expect(result.pairedDiff.status).toBe('insufficient-evidence');
    expect(result.pairedDiff.ci95).toBeNull();
    expect(result.pairedDiff.unmatched).toContainEqual({ caseId: corpus.cases[0].id, repeat: 3, baseline: 'fail', treatment: 'missing' });
  });

  it('keeps infra, task and grader failures out of agent reliability denominators', () => {
    const raw = trials(4);
    for (const [index, failureClass] of (['infrastructure', 'task', 'grader', 'agent'] as const).entries()) {
      for (const trial of raw.cases[index].trials) (trial as Tf0592Trial).failureClass = failureClass;
    }
    const result = summarizeTf0592Trials(corpus, raw, policy);
    expect(result.run.trialCount).toBe(60);
    expect(result.run.completeCaseCount).toBe(17);
    expect(Object.values(result.failureClasses).map((entry) => entry.trialCount)).toEqual([3, 3, 3, 3]);
    expect(result.aggregate.incomplete).toContainEqual({ caseId: corpus.cases[0].id, trialIndex: 0, outcome: 'fail', failureClass: 'infrastructure', reason: 'not-agent-failure' });
  });

  it('uses the same complete case cohort for the paired pass^k difference', () => {
    const raw = trials(4, 0);
    for (const entry of raw.cases.slice(20)) entry.trials = Array.from({ length: 3 }, (_, repeat) => ({ arm: 'baseline', repeat: repeat + 1, outcome: 'pass', failureClass: null }));
    const result = summarizeTf0592Trials(corpus, raw, policy);
    expect(result.run.completeCaseCount).toBe(24);
    expect(result.pairedDiff.completePairCaseCount).toBe(20);
    expect(result.pairedDiff.passKDelta).toBe(0.2);
  });

  it('excludes every partial-case pair from inference and retains it in the audit', () => {
    const raw = trials(0, 0);
    for (const entry of raw.cases.slice(20)) entry.trials = [1, 2].flatMap((repeat) => [
      { arm: 'baseline' as const, repeat, outcome: 'fail' as const, failureClass: 'agent' as const },
      { arm: 'treatment' as const, repeat, outcome: 'pass' as const, failureClass: null },
    ]);
    const result = summarizeTf0592Trials(corpus, raw, policy);
    expect(result.pairedDiff.repeatPairCount).toBe(68);
    expect(result.pairedDiff.pairCount).toBe(20);
    expect(result.pairedDiff.meanDiff).toBe(0);
    expect(result.pairedDiff.ci95).toBeNull();
    expect(result.pairedDiff.excludedPartialPairs).toHaveLength(8);
  });

  it('does not manufacture significance by treating correlated repeats as independent', () => {
    const result = summarizeTf0592Trials(corpus, trials(2, 0), policy);
    expect(result.pairedDiff.meanDiff).toBe(0.1);
    expect(result.pairedDiff.inferenceUnit).toBe('caseId');
    expect(result.pairedDiff.ci95![0]).toBeLessThan(0);
    expect(result.pairedDiff.ci95![1]).toBeGreaterThan(0);
  });

  it('does not hide incomplete-case spend from the cost ceiling numerator', () => {
    const raw = trials();
    raw.cases[20].trials = [{ outcome: 'timeout', failureClass: 'agent', repeat: 1, cost: 100, tokens: 10000, turns: 1, toolCalls: 1, wallClockMs: 60000 }];
    const result = summarizeTf0592Trials(corpus, raw, policy);
    expect(result.budget.costPerCompletedCase).toBe(5.03);
    expect(result.budget.tokensPerCompletedCase).toBe(530);
    expect(result.budget.incompleteCaseConsumption.cost).toBe(100);
    expect(result.budget.completedCaseOnly.costPerCompletedCase).toBe(0.03);
    expect(result.budget.observedTrialCount).toBe(61);
  });

  it('keeps zero-variance standardized effect and power unavailable', () => {
    const result = summarizeTf0592Trials(corpus, trials(20, 0), policy);
    expect(result.pairedDiff.meanDiff).toBe(1);
    expect(result.pairedDiff.effectSize).toBeNull();
    expect(result.pairedDiff.ci95).toBeNull();
    expect(result.power.status).toBe('insufficient-evidence');
    expect(result.power.requiredCasesApprox).toBeNull();
    expect(result.power.requiredPairsApprox).toBeNull();
  });

  it('reports measured cost per case and latency without invented missing values', () => {
    const result = summarizeTf0592Trials(corpus, trials(), policy);
    expect(result.budget).toMatchObject({ tokensPerCompletedCase: 30, turnsPerCompletedCase: 3, toolCallsPerCompletedCase: 6, costPerCompletedCase: 0.03, wallClockP50Ms: 20, wallClockP95Ms: 30 });
    const raw = trials();
    delete (raw.cases[0].trials[0] as Tf0592Trial).tokens;
    expect(summarizeTf0592Trials(corpus, raw, policy).budget.tokensPerCompletedCase).toBeNull();
  });

  it('rejects unknown classes, unclassified failures, duplicate repeats and invalid metrics', () => {
    for (const mutation of ['unknown-class', 'unclassified', 'repeat', 'metric', 'missing-case']) {
      const raw = trials(1);
      const first = raw.cases[0].trials[0] as Tf0592Trial;
      if (mutation === 'unknown-class') Object.assign(first, { failureClass: 'unknown' });
      if (mutation === 'unclassified') first.failureClass = null;
      if (mutation === 'repeat') raw.cases[0].trials[1] = { ...first };
      if (mutation === 'metric') first.tokens = Number.NaN;
      if (mutation === 'missing-case') raw.cases.pop();
      expect(() => summarizeTf0592Trials(corpus, raw, policy), mutation).toThrow();
    }
  });

  it('binds observed resources and rejects all twelve mutation controls', () => {
    const { report } = buildTf0592Report(ROOT);
    const resources = collectResourceFingerprint(ROOT);
    expect(resources.runtime.pnpm.length).toBeGreaterThan(0);
    expect(resources.observedResources.cpuCount).toBeGreaterThan(0);
    expect(resources.candidate.commit).toMatch(/^[a-f0-9]{40}$/);
    expect(resources.envelope.model).toEqual({ status: 'not-run', id: null, version: null });
    const results = runNegativeControls(report, buildNegativeControls(), ROOT);
    expect(results).toHaveLength(12);
    expect(results.every((entry) => entry.passed)).toBe(true);
    report.resourceFingerprint.candidate.dirty = true;
    expect(codes(validateTf0592Report(report, ROOT, { verifyCandidate: false }))).toContain('dirty-candidate');
  });

  it('reads a copied pack and detects changed bytes through SHA256SUMS', () => {
    const temp = copyPack();
    expect(validateTf0592Pack(temp, { allowDraft: true, verifyCandidate: false, sourceChecks: false }).passed).toBe(true);
    const path = join(temp, TF0592_PACK_DIR, 'resource-fingerprint.v1.json');
    writeFileSync(path, `${readFileSync(path, 'utf8')} `);
    expect(codes(validateTf0592Pack(temp, { allowDraft: true, verifyCandidate: false, sourceChecks: false }))).toContain('pack-digest-mismatch');
  });

  it('rejects fabricated statistics even when the attacker rehashes the pack', () => {
    const temp = copyPack();
    const path = join(temp, TF0592_PACK_DIR, 'statistical-report.v1.json');
    const report: Tf0592Report = JSON.parse(readFileSync(path, 'utf8'));
    report.run.trialCount = 72;
    writeFileSync(path, JSON.stringify(report));
    reseal(temp);
    expect(codes(validateTf0592Pack(temp, { allowDraft: true, verifyCandidate: false, sourceChecks: false }))).toContain('statistical-recomputation');
  });

  it('rejects an edited input and a truncated control registry after rehashing', () => {
    const temp = copyPack();
    const rawPath = join(temp, TF0604_PACK_DIR, 'raw-trials.v1.json');
    writeFileSync(rawPath, `${readFileSync(rawPath, 'utf8')} `);
    expect(codes(validateTf0592Pack(temp, { allowDraft: true, verifyCandidate: false, sourceChecks: false }))).toContain('input-digest-mismatch');
    const controlsPath = join(temp, TF0592_PACK_DIR, 'negative-controls.v1.json');
    const controls = buildNegativeControls(); controls.controls.pop();
    writeFileSync(controlsPath, JSON.stringify(controls));
    reseal(temp);
    expect(codes(validateTf0592Pack(temp, { allowDraft: true, verifyCandidate: false, sourceChecks: false }))).toContain('negative-control-registry');
  });
});
