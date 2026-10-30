import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { checkAgentFirstLoopContract } from '../../scripts/agent-first-loop-check.mjs';
import {
  LOOP_NEGATIVE_CONTROLS,
  LOOP_PATHS,
  REQUIRED_LOOP_GUIDE_PHRASES,
  computeGraduationPolicyDigest,
  computeHeldOutDigest,
  countLoop,
  loadLoopFiles,
  runLoopNegativeControls,
  validateLoopContract,
  validateLoopRecord,
} from '../../scripts/lib/agent-first-evaluation-loop.mjs';

const ROOT = process.cwd();
const REPORT_PATH = join(ROOT, 'harness/specs/fixtures/agent-first-framework/loop-validation-report.json');

type Entry = Record<string, unknown>;
type Loop = {
  schemaVersion: string;
  profileId: string;
  suiteBinding: Entry;
  heldOutSplit: Entry;
  signals: Entry[];
  candidateProducer: Entry;
  promotionPolicyDigest: string;
  candidates: Entry[];
  reEvaluations: Entry[];
  candidateDecisions: Entry[];
  taskGraduationPolicies: Entry[];
  taskGraduations: Entry[];
  promotions: Entry[];
  publicationApproval: unknown;
  productLockChanges: unknown[];
};
type Registry = { registeredSuites: Entry[]; registeredProfiles: Entry[] };

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function frozenFixture() {
  const files = structuredClone(loadLoopFiles(ROOT));
  const loop = files.loop as Loop;
  const registry = files.registry as Registry;
  const suite = registry.registeredSuites[0];
  const contentDigest = `sha256:${'a'.repeat(64)}`;
  suite.corpusStatus = 'frozen';
  suite.contentDigest = contentDigest;
  suite.taskIds = ['task-1', 'task-2'];
  loop.suiteBinding = { suiteId: 'acceptance-core', status: 'frozen', contentDigest };
  loop.heldOutSplit.digest = computeHeldOutDigest(suite);
  loop.heldOutSplit.status = 'frozen';
  loop.candidateProducer.status = 'registered';
  loop.candidates = [{
    id: 'cand-1', authoredBy: 'rsi-self-improvement', digest: `sha256:${'d'.repeat(64)}`,
    sourceSignalIds: ['sig-effect-not-run'], promotionPolicyDigest: loop.promotionPolicyDigest,
  }];
  return { files, loop, registry };
}

function resultFixture() {
  const fixture = frozenFixture();
  const { loop } = fixture;
  const policy: Entry = {
    id: 'grad-1', taskId: 'task-1', from: 'capability', to: 'regression', frozenBeforeCandidate: true,
    minCompleteCases: 20, k: 3, minimumPassKLower95: 0.8, maximumFlakeRate: 0.01, minimumConsecutiveRuns: 2,
  };
  policy.digest = computeGraduationPolicyDigest(policy);
  loop.taskGraduationPolicies = [policy];
  loop.candidates[0].graduationPolicyDigests = [policy.digest];
  loop.reEvaluations = [1, 2].map((sequence) => ({
    id: `re-${sequence}`, runId: `fixture-run-${sequence}`, sequence,
    status: 'complete', driven_by: 'agent', evidenceKind: 'deterministic-fixture',
    candidateId: 'cand-1', candidateDigest: loop.candidates[0].digest,
    taskId: 'task-1', taskClass: 'capability', graduationPolicyDigest: policy.digest,
    suiteId: 'acceptance-core', suiteContentDigest: loop.suiteBinding.contentDigest,
    heldOutSplitDigest: loop.heldOutSplit.digest, resultRef: `fixture://contract/run-${sequence}`,
    resultDigest: `sha256:${String(sequence).repeat(64)}`, sealed: true, independentVerifier: true,
    executorActor: 'fixture-executor', verifierActor: 'fixture-verifier', completeCases: 20, k: 3,
    failureClasses: { infrastructure: 0, task: 0, grader: 0, agent: 0 },
    metrics: { passKLower95: 0.9, flakeRate: 0, negativeControlRegressions: 0, safetyRegressions: 0, safetySkips: 0, safetyFlakes: 0 },
  }));
  return fixture;
}

describe('agent-first evaluation loop contract', () => {
  it('validates the registered loop record with no violation', () => {
    const files = loadLoopFiles(ROOT);
    const { violations, counts } = validateLoopContract(files);

    expect(violations).toEqual([]);
    expect(counts).toEqual({ signals: 2, candidates: 0, reEvaluations: 0, promotions: 0 });
  });

  it('accepts a frozen candidate fixture while its fully bound re-evaluation remains not-run', () => {
    const { files, loop } = frozenFixture();
    loop.reEvaluations = [{
      id: 're-1',
      candidateId: 'cand-1',
      candidateDigest: loop.candidates[0].digest,
      status: 'not-run',
      suiteId: 'acceptance-core',
      suiteContentDigest: loop.suiteBinding.contentDigest,
      heldOutSplitDigest: loop.heldOutSplit.digest,
    }];

    const { violations, counts } = validateLoopContract(files);

    expect(violations).toEqual([]);
    expect(counts).toEqual({ signals: 2, candidates: 1, reEvaluations: 1, promotions: 0 });
  });

  it('accepts deterministic sealed-result fixtures and counts the measured-policy task graduation', () => {
    const { files, loop } = resultFixture();
    loop.taskGraduations = [{
      taskId: 'task-1', from: 'capability', to: 'regression', policyId: 'grad-1',
      policyDigest: loop.taskGraduationPolicies[0].digest, reEvaluationIds: ['re-1', 're-2'],
    }];
    loop.candidateDecisions = [{
      id: 'decision-1', candidateId: 'cand-1', disposition: 'promote', authoredBy: 'rsi-self-improvement',
      promotionPolicyDigest: loop.promotionPolicyDigest, reEvaluationIds: ['re-1', 're-2'],
    }];
    expect(validateLoopContract(files)).toEqual({
      violations: [], counts: { signals: 2, candidates: 1, reEvaluations: 2, promotions: 1 },
    });

    loop.candidates.push({ ...loop.candidates[0], id: 'cand-2' });
    loop.candidateDecisions[0].candidateId = 'cand-2';
    expect(validateLoopContract(files).violations.map((entry) => entry.code)).toContain('candidate-decision.evidence-missing');
  });

  it('resolves registry-added task signals and requires a measured source for observations', () => {
    const { files, loop } = resultFixture();
    loop.signals[0].gateId = null;
    loop.signals[0].taskId = 'task-1';
    loop.signals[0].kind = 'observed-regression';
    loop.signals[0].sourceRunId = 'fixture-run-1';
    expect(validateLoopContract(files).violations).toEqual([]);

    loop.signals[0].sourceRunId = 'never-run';
    expect(validateLoopContract(files).violations.map((entry) => entry.code)).toContain('signal.unobserved-result');
  });

  it('fails closed on every declared negative control', () => {
    const files = loadLoopFiles(ROOT);
    const controls = runLoopNegativeControls(files);

    expect(controls.length).toBe(42);
    for (const control of controls) {
      expect(control.baselineValid, `${control.id} must start from a valid fixture`).toBe(true);
      expect(control.rejected, `${control.id} must be rejected with ${control.expectedCode}`).toBe(true);
      expect(control.observedCodes).toContain(control.expectedCode);
    }

    const byId = new Map(controls.map((control) => [control.id, control]));
    expect(byId.get('signal-evidence-missing')?.expectedCode).toBe('signal.evidence-missing');
    expect(byId.get('signal-unresolved')?.expectedCode).toBe('signal.unresolved');
    expect(byId.get('heldout-falsely-sealed')?.expectedCode).toBe('heldout.digest-before-freeze');
    expect(byId.get('graduation-reverse-direction')?.expectedCode).toBe('graduation.direction-invalid');
    expect(byId.get('candidate-decision-without-run')?.expectedCode).toBe('candidate-decision.evidence-missing');
    expect(byId.get('loop-publication-approval')?.expectedCode).toBe('loop.publication-approval');
    expect(byId.get('loop-locked-default-change')?.expectedCode).toBe('loop.locked-default-change');
    expect(LOOP_NEGATIVE_CONTROLS.length).toBe(controls.length);
  });

  it('keeps an unfrozen held-out split digest-free and rejects a falsely sealed digest', () => {
    const files = loadLoopFiles(ROOT);
    const loop = files.loop as Loop;
    const registry = files.registry as Registry;

    expect(loop.heldOutSplit.status).toBe('not-frozen');
    expect(loop.heldOutSplit.digest).toBeNull();
    expect(computeHeldOutDigest(registry.registeredSuites[0])).toBeNull();

    const tampered = structuredClone(loop);
    tampered.heldOutSplit.digest = 'sha256:0000000000000000000000000000000000000000000000000000000000000000';
    const { violations } = validateLoopRecord(tampered, registry);
    expect(violations.map((violation) => violation.code)).toContain('heldout.digest-before-freeze');
  });

  it('keeps the tracked validation report in lockstep with a fresh read', () => {
    const tracked = readJson<{ checkedAt: string; actor: string }>(REPORT_PATH);
    const fresh = checkAgentFirstLoopContract(ROOT, tracked.actor, tracked.checkedAt);

    expect(fresh.ok).toBe(true);
    expect(fresh.report).toEqual(tracked);
  });

  it('keeps the loop paths and the guide contract in one place', () => {
    expect(LOOP_PATHS.loop).toBe('harness/specs/fixtures/agent-first-framework/loop-record.json');
    expect(LOOP_PATHS.registry).toBe('harness/specs/fixtures/agent-first-framework/registry.json');
    expect(LOOP_PATHS.promotionPolicy).toBe('harness/specs/fixtures/rsi-evidence-loop/promotion-policy.v1.json');

    const guide = readFileSync(join(ROOT, LOOP_PATHS.guide), 'utf8');
    for (const phrase of REQUIRED_LOOP_GUIDE_PHRASES) {
      expect(guide).toContain(phrase);
    }
  });

  it('reports an empty loop as all-zero counts, never as a pass', () => {
    const files = loadLoopFiles(ROOT);
    const loop = files.loop as Loop;

    expect(loop.candidates).toEqual([]);
    expect(loop.reEvaluations).toEqual([]);
    expect(loop.promotions).toEqual([]);
    expect(loop.candidateProducer.status).toBe('not-implemented');
    expect(loop.publicationApproval).toBeNull();
    expect(countLoop(loop)).toEqual({ signals: 2, candidates: 0, reEvaluations: 0, promotions: 0 });
  });
});
