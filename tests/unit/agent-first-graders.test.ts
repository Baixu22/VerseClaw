// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { buildTaskCorpus, buildCalibrationSamples, RUBRIC_CONFIG } from '../../scripts/lib/agent-first-task-corpus.mjs';
import { gradeExecutionRecord, gradeTaskExecutions, gradeTraceEvidence, gradeRubricReceipts, buildRubricRequest, graderDigest, combineGraderVerdicts, classifyZeroPassTrials, type RubricReceipt } from '../../scripts/lib/agent-first-graders.mjs';

const corpus = buildTaskCorpus();
const samples = buildCalibrationSamples(corpus);
const task = corpus.tasks[0];

describe('Agent-first executable graders', () => {
  it('calibrates code grading against known good, bad and unknown raw evidence', () => {
    for (const sample of samples.deterministic) expect(gradeExecutionRecord(task, sample.record, sample.stdout, sample.stderr).verdict, sample.id).toBe(sample.expected);
  });
  it('requires the complete frozen oracle set rather than a duplicated passing command', () => {
    const good = samples.deterministic[0];
    const multi = { ...task, oracle: { ...task.oracle, commandLines: [...task.oracle.commandLines, 'pnpm exec vitest run tests/unit/extra.test.ts'] } };
    expect(gradeTaskExecutions(multi, [{ record: good.record, stdout: good.stdout, stderr: '' }]).verdict).toBe('unknown');
  });
  it('calibrates authorization traces without treating missing effects as a pass', () => {
    for (const sample of samples.trace) expect(gradeTraceEvidence(sample.trace).verdict, sample.id).toBe(sample.expected);
  });
  it('does not permit supplementary votes to override deterministic fail or unknown', () => {
    const pass = { verdict: 'pass' as const }, fail = { verdict: 'fail' as const }, unknown = { verdict: 'unknown' as const };
    expect(combineGraderVerdicts(fail, pass, pass).verdict).toBe('fail');
    expect(combineGraderVerdicts(unknown, pass, pass).verdict).toBe('unknown');
  });
  it('distinguishes a valid unknown vote from missing or forged model receipts', () => {
    const sample = samples.rubric[0];
    const make = (id: string): RubricReceipt => {
      const response = { id, model: RUBRIC_CONFIG.model, content: [{ type: 'text', text: '{"verdict":"unknown","reason":"Evidence is inconclusive"}' }] };
      return { driven_by: 'agent', actor: 'fixture-judge', sampleId: sample.id, vote: Number(id.slice(-1)), requestedModel: RUBRIC_CONFIG.model, status: 200, request: buildRubricRequest(sample, RUBRIC_CONFIG), requestSha256: graderDigest(buildRubricRequest(sample, RUBRIC_CONFIG)), responseSha256: graderDigest(response), response };
    };
    const receipts = [make('vote-0'), make('vote-1'), make('vote-2')];
    expect(gradeRubricReceipts(sample, receipts, RUBRIC_CONFIG)).toMatchObject({ verdict: 'unknown', receiptsValid: true });
    expect(gradeRubricReceipts(sample, [], RUBRIC_CONFIG)).toMatchObject({ verdict: 'unknown', receiptsValid: false });
    receipts[1] = { ...receipts[0] };
    expect(gradeRubricReceipts(sample, receipts, RUBRIC_CONFIG).receiptsValid).toBe(false);
  });
  it('does not let a claimed request digest hide changed provider request parameters', () => {
    const sample = samples.rubric[0];
    const request = buildRubricRequest(sample, RUBRIC_CONFIG);
    const receipts = Array.from({ length: 3 }, (_, vote): RubricReceipt => {
      const response = { id: `tamper-${vote}`, model: RUBRIC_CONFIG.model, content: [{ type: 'text', text: '{"verdict":"pass","reason":"Clear"}' }] };
      return { driven_by: 'agent', actor: 'fixture-judge', sampleId: sample.id, vote, requestedModel: RUBRIC_CONFIG.model, status: 200, request: { ...request, temperature: 1 }, requestSha256: graderDigest(request), responseSha256: graderDigest(response), response };
    });
    expect(gradeRubricReceipts(sample, receipts, RUBRIC_CONFIG).receiptsValid).toBe(false);
  });
  it('investigates zero-pass task/grader failures before attributing agent failure', () => {
    const trials = [{ verdict: 'fail' as const }];
    expect(classifyZeroPassTrials(trials, false, true).classification).toBe('task-defect-investigation');
    expect(classifyZeroPassTrials(trials, true, false).classification).toBe('grader-defect-investigation');
    expect(classifyZeroPassTrials([{ verdict: 'unknown' }], true, true).classification).toBe('insufficient-evidence');
    expect(classifyZeroPassTrials(trials, true, true).classification).toBe('agent');
  });
});
