// @vitest-environment node
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

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
  sha256File,
  TF0604_PACK_DIR,
} from '../../scripts/rsi-tf0604-baseline.mjs';

const ROOT = process.cwd();
const TEMP_ROOT = 'D:/tmp';
const temporaryRoots: string[] = [];
const packFiles = ['task-corpus.v1.json', 'negative-controls.v1.json', 'raw-trials.v1.json', 'aggregate.v1.json', 'negative-control-results.v1.json', 'validation-report.v1.json'];

function copyPack(): string {
  mkdirSync(TEMP_ROOT, { recursive: true });
  const root = mkdtempSync(join(TEMP_ROOT, 'rsi-tf0604-readback-'));
  temporaryRoots.push(root);
  const corpus = JSON.parse(readFileSync(join(ROOT, TF0604_PACK_DIR, packFiles[0]), 'utf8'));
  const paths = [...packFiles, 'SHA256SUMS'].map((file) => `${TF0604_PACK_DIR}/${file}`)
    .concat(corpus.cases.flatMap((entry: { sourceRefs: string[] }) => entry.sourceRefs));
  for (const path of new Set(paths)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    copyFileSync(join(ROOT, path), join(root, path));
  }
  return root;
}

function reseal(root: string): void {
  const pack = join(root, TF0604_PACK_DIR);
  writeFileSync(join(pack, 'SHA256SUMS'), `${packFiles.map((file) => `${sha256File(join(pack, file))}  ${file}`).join('\n')}\n`);
}

afterAll(() => {
  for (const root of temporaryRoots) {
    if (!resolve(root).startsWith(`${resolve(TEMP_ROOT)}${sep}rsi-tf0604-readback-`)) throw new Error('Unexpected fixture cleanup path');
    rmSync(root, { recursive: true, force: true });
  }
});

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
  it('rejects a duplicate reservation and invented execution instead of counting them as baseline', () => {
    const corpus = buildTf0604Corpus();
    const duplicate = buildRawTrials(corpus);
    duplicate.cases[1] = structuredClone(duplicate.cases[0]);
    expect(errorCodes(validateRawTrials(duplicate, corpus))).toContain('duplicate-raw-case');
    const fabricated = buildRawTrials(corpus);
    fabricated.cases[0].trials = ['pass', 'pass', 'pass'];
    expect(errorCodes(validateRawTrials(fabricated, corpus))).toContain('raw-reservation-mismatch');
  });
  it.each([
    ['aggregate.v1.json', 'aggregate-recomputation'],
    ['negative-control-results.v1.json', 'negative-control-report'],
    ['negative-controls.v1.json', 'negative-control-registry'],
    ['task-corpus.v1.json', 'case-definition-mismatch'],
    ['validation-report.v1.json', 'validation-report'],
  ])('rejects re-signed semantic tamper in %s', (file, expectedCode) => {
    const root = copyPack();
    expect(validateTf0604Pack(root).passed).toBe(true);
    const path = join(root, TF0604_PACK_DIR, file);
    const value = JSON.parse(readFileSync(path, 'utf8'));
    if (file === 'aggregate.v1.json') { value.completeCaseCount = 24; value.passK = 1; value.passAtK = 1; value.status = 'pass'; }
    if (file === 'negative-control-results.v1.json') value[0].observedCode = 'fabricated-result';
    if (file === 'negative-controls.v1.json') value.controls.pop();
    if (file === 'task-corpus.v1.json') value.cases[0].taskDefinition.referenceOutcome.decision = 'invented-PASS';
    if (file === 'validation-report.v1.json') value.gates.negativeControls.count = 999;
    writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
    reseal(root);
    expect(errorCodes(validateTf0604Pack(root))).toContain(expectedCode);
  });
  it('rejects omitted hash entries and undeclared pack files', () => {
    const root = copyPack();
    const pack = join(root, TF0604_PACK_DIR);
    writeFileSync(join(pack, 'SHA256SUMS'), readFileSync(join(pack, 'SHA256SUMS'), 'utf8').split('\n').slice(1).join('\n'));
    expect(errorCodes(validateTf0604Pack(root))).toContain('hash-mismatch');
    reseal(root);
    writeFileSync(join(pack, 'unreviewed.json'), '{}');
    expect(errorCodes(validateTf0604Pack(root))).toContain('pack-file-coverage');
  });
});
