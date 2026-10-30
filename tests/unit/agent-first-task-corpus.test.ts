import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CORPUS_DIR, GRADER_IDS, checkCorpus, gradeObservation, loadCorpus, runCalibration, validateCorpus, zeroPassDiagnosis } from '../../scripts/lib/agent-first-task-corpus.mjs';

const root = process.cwd();
const loaded = loadCorpus(root);
const fixtures = JSON.parse(readFileSync(join(root, CORPUS_DIR, 'calibration.v1.json'), 'utf8'));

describe('Agent First task corpus and executable calibration', () => {
  it('binds 24 real source definitions and a disjoint 16/8 split', () => {
    const report = checkCorpus(root);
    expect(report.ok).toBe(true);
    expect(report.taskCount).toBe(24);
    expect(report.counts).toEqual({ capability: 3, regression: 5, negative: 8, adversarial: 6, recovery: 2 });
    expect(loaded.corpus.split.public).toHaveLength(16);
    expect(loaded.corpus.split.heldOut).toHaveLength(8);
    expect(new Set([...loaded.corpus.split.public, ...loaded.corpus.split.heldOut]).size).toBe(24);
    expect(report.evaluationStatus).toBe('not-run');
  });

  it('executes all 144 known-good/bad/unknown calibrations', () => {
    const results = runCalibration(loaded.corpus, fixtures.cases);
    expect(results).toHaveLength(144);
    expect(results.every((result) => result.ok)).toBe(true);
    for (const id of GRADER_IDS) expect(results.filter((result) => result.graderId === id)).toHaveLength(72);
  });

  it('uses final-state values before text and model opinions', () => {
    const task = loaded.corpus.tasks[0];
    const observation = structuredClone(fixtures.cases.find((entry: { taskId: string; graderId: string; expected: string }) => entry.taskId === task.id && entry.graderId === 'system-condition-set' && entry.expected === 'pass').observation);
    observation.conditions[0].actual = false;
    observation.narrative = 'Everything succeeded';
    observation.modelVerdict = 'pass';
    expect(gradeObservation(task, observation).verdict).toBe('fail');
    observation.conditions = [];
    expect(gradeObservation(task, observation).verdict).toBe('unknown');
    observation.source = 'agent-text';
    expect(gradeObservation(task, observation).verdict).toBe('unknown');
  });

  it('rejects duplicate evidence and unauthorized/cross-trial events', () => {
    const task = loaded.corpus.tasks[0];
    const observation = structuredClone(fixtures.cases[0].observation);
    observation.conditions.push(observation.conditions[0]);
    expect(gradeObservation(task, observation).verdict).toBe('fail');
    observation.events[0].trialId = 'another-trial';
    expect(gradeObservation(task, observation, 'system-trace-policy').verdict).toBe('fail');
    observation.events[0].trialId = observation.trialId;
    observation.events[0].effect = 'publish';
    expect(gradeObservation(task, observation, 'system-trace-policy').verdict).toBe('fail');
    observation.events = [];
    expect(gradeObservation(task, observation, 'system-trace-policy').verdict).toBe('unknown');
  });

  it('rejects missing or misleading task/reference definitions', () => {
    const mutations: Array<(corpus: typeof loaded.corpus) => void> = [
      (c) => { c.tasks[0].prompt = ''; },
      (c) => { c.tasks[0].reference.command = ''; },
      (c) => { c.tasks[0].reference.entrypoint = 'openclaw_runtime/scripts/qa-lab-personal-agent-acceptance.mjs'; },
      (c) => { c.tasks[0].source.sha256 = 'sha256:' + '0'.repeat(64); },
      (c) => { c.tasks[0].source.path = '../outside.md'; },
      (c) => { c.tasks[0].executor.scenarioId = 'unknown'; },
      (c) => { c.tasks[0].oracle.conditions[0].expression = 'true'; },
      (c) => { c.tasks[0].graders = []; },
      (c) => { c.tasks[1].id = c.tasks[0].id; },
      (c) => { c.split.heldOut[0] = c.split.public[0]; },
      (c) => { c.split.writableByCandidate = true; },
      (c) => { c.profileStatus = 'pass'; },
      (c) => { c.driven_by = 'real-human'; },
    ];
    for (const mutate of mutations) {
      const corpus = structuredClone(loaded.corpus);
      mutate(corpus);
      expect(validateCorpus(corpus, root).length).toBeGreaterThan(0);
    }
  });

  it('routes zero-pass trial sets into task/grader investigation', () => {
    expect(zeroPassDiagnosis(0, 12)).toEqual({ category: 'task-or-grader-investigation', agentFailure: false });
    expect(zeroPassDiagnosis(0, 0)).toBeNull();
    expect(zeroPassDiagnosis(1, 12)).toBeNull();
  });

  it('keeps the frozen base and active extension separate without a core edit', () => {
    expect(loaded.extension.baseRegistry).toBe('harness/specs/fixtures/agent-first-framework/registry.json');
    expect(loaded.extension.registeredSuites[0].contentDigest).toBe(loaded.corpusDigest);
    expect(loaded.extension.registeredProfiles[0].status).toBe('not-run');
    expect(loaded.registry.registeredSuites).toHaveLength(2);
    expect(loaded.registry.registeredGraders).toHaveLength(4);
  });
});
