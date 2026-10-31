// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  buildAggregate,
  buildNegativeControls,
  buildRawTrials,
  buildTf0604Corpus,
  runNegativeControls,
  validateAggregate,
  validateCorpus,
  validateRawTrials,
  validateTf0604Pack,
} from '../../scripts/rsi-tf0604-baseline.mjs';

const ROOT = process.cwd();

const errorCodes = (result: { errors?: Array<{ code: string }> }) =>
  (result.errors ?? []).map((entry) => entry.code);

describe('RSI TF-0604 baseline corpus', () => {
  it('reads the sealed pack from disk and keeps the baseline honest', () => {
    const result = validateTf0604Pack(ROOT);

    expect(result.passed).toBe(true);
    expect(result.corpusCaseCount).toBeGreaterThanOrEqual(20);
    expect(result.baselineStatus).toBe('insufficient-evidence');
    expect(result.negativeControlCount).toBe(8);
  });

  it('builds distinct task definitions from committed acceptance records', () => {
    const corpus = buildTf0604Corpus();
    const ids = new Set(corpus.cases.map((entry) => entry.id));

    expect(corpus.cases).toHaveLength(24);
    expect(ids.size).toBe(corpus.cases.length);
    expect(corpus.driven_by).toBe('agent');
    expect(corpus.provenance.realHuman).toBe(false);
    expect(corpus.provenance.realProvider).toBe(false);
    expect(corpus.cases.every((entry) => entry.taskDefinition.input.taskId === entry.taskId)).toBe(true);
    expect(corpus.cases.every((entry) => entry.taskDefinition.referenceOutcome.decision.length > 0)).toBe(true);
    expect(corpus.cases.every((entry) => Boolean(entry.sourceDigest))).toBe(true);
  });

  it('reserves raw trials and returns insufficient-evidence without inventing metrics', () => {
    const corpus = buildTf0604Corpus();
    const rawTrials = buildRawTrials(corpus);
    const aggregate = buildAggregate(corpus, rawTrials);

    expect(rawTrials.cases).toHaveLength(corpus.cases.length);
    expect(rawTrials.cases.every((entry) => entry.status === 'not-run' && entry.trials.length === 0)).toBe(true);
    expect(aggregate.status).toBe('insufficient-evidence');
    expect(aggregate.completeCaseCount).toBe(0);
    expect(aggregate.passK).toBeNull();
    expect(aggregate.passAtK).toBeNull();
    expect(validateRawTrials(rawTrials, corpus).passed).toBe(true);
    expect(validateAggregate(aggregate, corpus, rawTrials).passed).toBe(true);
  });

  it('runs every registered negative control and rejects all mutations', () => {
    const corpus = buildTf0604Corpus();
    const rawTrials = buildRawTrials(corpus);
    const aggregate = buildAggregate(corpus, rawTrials);
    const controls = buildNegativeControls();
    const results = runNegativeControls(corpus, aggregate, controls, ROOT);

    expect(results).toHaveLength(8);
    expect(results.every((entry) => entry.passed)).toBe(true);
    expect(results.map((entry) => entry.observedCode)).toEqual([
      'case-count-floor',
      'duplicate-case-id',
      'source-digest-mismatch',
      'missing-source-record',
      'real-human-claim',
      'unknown-failure-class',
      'negative-anchor-violated',
      'insufficient-evidence-bypass',
    ]);
  });

  it('fails closed when a source digest or the corpus floor is tampered', () => {
    const digestTampered = buildTf0604Corpus();
    digestTampered.cases[0].sourceDigest = '0'.repeat(64);
    expect(errorCodes(validateCorpus(digestTampered))).toContain('source-digest-mismatch');

    const tooSmall = buildTf0604Corpus();
    tooSmall.cases.length = 19;
    expect(errorCodes(validateCorpus(tooSmall))).toContain('case-count-floor');
  });

  it('rejects a promoted metric when the complete-case floor is not met', () => {
    const corpus = buildTf0604Corpus();
    const rawTrials = buildRawTrials(corpus);
    const aggregate = buildAggregate(corpus, rawTrials);
    aggregate.status = 'pass';
    aggregate.passK = 1;
    aggregate.passAtK = 1;

    expect(errorCodes(validateAggregate(aggregate, corpus, rawTrials))).toContain('insufficient-evidence-bypass');
    expect(errorCodes(validateAggregate(aggregate, corpus, rawTrials))).toContain('thin-sample-metric');
  });
});
