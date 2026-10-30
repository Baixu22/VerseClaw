// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { buildTaskCorpus, validateTaskCorpus, buildCalibrationSamples, replayCalibration, TF0590_PACK_DIR } from '../../scripts/lib/agent-first-task-corpus.mjs';
import { validateTaskCorpusPack } from '../../scripts/agent-first-task-corpus.mjs';
import type { RubricReceipt } from '../../scripts/lib/agent-first-graders.mjs';

describe('TF-0590 real task corpus and grader calibration', () => {
  it('expands all 24 repository tasks with explicit inputs and executable source-bound oracles', () => {
    const corpus = buildTaskCorpus();
    expect(corpus.tasks).toHaveLength(24);
    expect(validateTaskCorpus(corpus).passed).toBe(true);
    expect(corpus.tasks.every((task) => task.input.acceptanceCriteria.length && task.oracle.testPaths.length && task.referenceSolution.referenceCommit)).toBe(true);
    expect(Object.values(corpus.distribution).reduce((sum, count) => sum + count, 0)).toBe(24);
    expect(Object.values(corpus.distribution).every((count) => count > 0)).toBe(true);
  });
  it('retains historical NO-GO and nonzero gates as reference limitations', () => {
    const corpus = buildTaskCorpus();
    expect(corpus.tasks.find((task) => task.sourceTaskId === 'TF-0296')).toMatchObject({ kind: 'negative', referenceSolution: { historicalDecision: 'NO-GO' } });
    expect(corpus.tasks.find((task) => task.sourceTaskId === 'TF-0285')!.referenceSolution.nonzeroHistoricalGates.some((gate) => gate.exitCode !== 0)).toBe(true);
    expect(corpus.tasks.every((task) => task.feasibility.currentSystemPassClaimed === false)).toBe(true);
  });
  it('seals disjoint public/held-out membership and rejects source/input tamper', () => {
    const corpus = buildTaskCorpus();
    expect(corpus.split.public).toHaveLength(12);
    expect(corpus.split.heldOut).toHaveLength(12);
    corpus.tasks[0].oracle.inputDigests[corpus.tasks[0].oracle.testPaths[0]] = '0'.repeat(64);
    expect(validateTaskCorpus(corpus).passed).toBe(false);
    const invalid = buildTaskCorpus(); invalid.split.heldOut[0] = invalid.split.public[0];
    expect(validateTaskCorpus(invalid).errors).toContain('split-invalid');
  });
  it('replays raw provider calibration instead of accepting unknown from missing votes', () => {
    const corpus = buildTaskCorpus();
    const samples = buildCalibrationSamples(corpus);
    const model: { receipts: RubricReceipt[] } = JSON.parse(readFileSync(`${TF0590_PACK_DIR}/model-calibration.v1.json`, 'utf8'));
    const result = replayCalibration(corpus, samples, model.receipts);
    expect(result.passed).toBe(true);
    expect(result.rows).toHaveLength(16);
    expect(replayCalibration(corpus, samples, []).passed).toBe(false);
  });
  it('validates every retained pack checksum and raw calibration outcome from disk', () => {
    expect(validateTaskCorpusPack(process.cwd(), { allowDraft: true })).toMatchObject({ passed: true, taskCount: 24, calibratedRows: 16 });
  });
});
