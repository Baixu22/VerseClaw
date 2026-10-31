// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildHistoricalTrialPlan } from '../../scripts/lib/agent-first-trials.mjs';

describe('TF-0604 historical system trial plan', () => {
  it('binds 24 tasks, k=3, both arms and a sealed held-out digest', () => {
    const plan = buildHistoricalTrialPlan(process.cwd());
    expect(plan.corpus.tasks).toHaveLength(24);
    expect(plan.trials).toHaveLength(144);
    expect(plan.splitDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(plan.corpus.split.public).toHaveLength(12);
    expect(plan.corpus.split.heldOut).toHaveLength(12);
    expect(plan.trials.filter((trial) => trial.arm === 'baseline')).toHaveLength(72);
    expect(plan.trials.filter((trial) => trial.arm === 'treatment')).toHaveLength(72);
  });

  it('binds each hidden oracle to a distinct historical answer revision', () => {
    const plan = buildHistoricalTrialPlan(process.cwd());
    for (const task of plan.corpus.tasks) {
      expect(task.referenceSolution.baseCommit).toMatch(/^[a-f0-9]{40}$/u);
      expect(task.referenceSolution.referenceCommit).toMatch(/^[a-f0-9]{40}$/u);
      expect(task.referenceSolution.baseCommit).not.toBe(task.referenceSolution.referenceCommit);
      expect(task.oracle.testPaths.length).toBeGreaterThan(0);
    }
  });

  it('never duplicates trial identities and fixes k=3 per arm', () => {
    const plan = buildHistoricalTrialPlan(process.cwd());
    expect(new Set(plan.trials.map((trial) => trial.trialId)).size).toBe(plan.trials.length);
    expect(plan.trials.every((trial) => Number.isInteger(trial.repeat) && [1,2,3].includes(trial.repeat))).toBe(true);
  });
});
