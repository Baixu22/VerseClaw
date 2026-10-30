// Agent-first evaluation loop contract (TF-0621).
//
// TF-0620 froze *where* a subject, suite and grader plug in. This module freezes
// what happens after a verdict exists: how a verdict becomes a located
// improvement signal, how a candidate is re-evaluated against the same frozen
// suite and held-out split, and how a saturated capability task graduates into a
// regression task.
//
// The loop deliberately does not generate candidates, change product defaults or
// locks, or approve publication. Candidate generation belongs to the
// self-improvement layer; publication stays a publisher decision. The validator
// fails closed on the declared negative controls.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { REQUIRED_DIMENSIONS, REQUIRED_GATE_IDS } from './agent-first-acceptance-contract.mjs';
import {
  MINIMUM_SUITE_CASES,
  MINIMUM_SUITE_K,
  validateFrameworkRegistry,
} from './agent-first-evaluation-framework.mjs';

export const AGENT_FIRST_LOOP_SCHEMA = 'AgentFirstEvaluationLoop/v1';
export const AGENT_FIRST_LOOP_VALIDATION_SCHEMA = 'AgentFirstEvaluationLoopValidation/v1';

export const LOOP_PATHS = Object.freeze({
  guide: 'harness/specs/guides/agent-first-acceptance.md',
  registry: 'harness/specs/fixtures/agent-first-framework/registry.json',
  loop: 'harness/specs/fixtures/agent-first-framework/loop-record.json',
  promotionPolicy: 'harness/specs/fixtures/rsi-evidence-loop/promotion-policy.v1.json',
});

export const SIGNAL_STATUSES = Object.freeze(['open', 'resolved', 'accepted-shortfall']);

/** The framework and the subject under test may never author a candidate. */
export const FRAMEWORK_AUTHOR = 'framework';

export const REQUIRED_LOOP_GUIDE_PHRASES = Object.freeze([
  'improvement signal',
  'regression graduation',
]);

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isDigest(value) {
  return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/u.test(value);
}

function digest(content) {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

/** Hash the criteria, not the caller-supplied seal or descriptive metadata. */
export function computeGraduationPolicyDigest(policy) {
  return digest(JSON.stringify({
    id: policy?.id,
    taskId: policy?.taskId,
    from: policy?.from,
    to: policy?.to,
    minCompleteCases: policy?.minCompleteCases,
    k: policy?.k,
    minimumPassKLower95: policy?.minimumPassKLower95,
    maximumFlakeRate: policy?.maximumFlakeRate,
    minimumConsecutiveRuns: policy?.minimumConsecutiveRuns,
  }));
}

/**
 * The held-out split is frozen by digest over its declared shape, so a
 * re-evaluation that silently widens or narrows the split is detectable.
 * @param {{id?: string, version?: string, contentDigest?: string, split?: {public?: unknown, heldOut?: unknown}}} suite
 * @param {string|null} [suiteContentDigest]
 */
export function computeHeldOutDigest(suite, suiteContentDigest = suite?.contentDigest ?? null) {
  // A split is not "frozen" until the task content has a digest. This prevents
  // the 12/8 planning split from being mistaken for an actual sealed corpus.
  if (!/^sha256:[a-f0-9]{64}$/u.test(String(suiteContentDigest ?? ''))) return null;
  const canonical = JSON.stringify({
    suiteId: suite?.id ?? null,
    suiteVersion: suite?.version ?? null,
    contentDigest: suiteContentDigest,
    public: suite?.split?.public ?? null,
    heldOut: suite?.split?.heldOut ?? null,
  });
  return `sha256:${createHash('sha256').update(canonical, 'utf8').digest('hex')}`;
}

export function countLoop(loop) {
  return {
    signals: Array.isArray(loop?.signals) ? loop.signals.length : 0,
    candidates: Array.isArray(loop?.candidates) ? loop.candidates.length : 0,
    reEvaluations: Array.isArray(loop?.reEvaluations) ? loop.reEvaluations.length : 0,
    promotions: Array.isArray(loop?.taskGraduations) ? loop.taskGraduations.length : 0,
  };
}

/**
 * @param {unknown} loop
 * @param {unknown} registry the framework registry the loop composes over
 */
export function validateLoopRecord(loop, registry) {
  const violations = [];
  const push = (code, path, message) => violations.push({ code, path, message });

  if (!isPlainObject(loop)) {
    push('loop.invalid', 'loop', 'loop record must be an object');
    return { violations, counts: countLoop({}) };
  }
  if (loop.schemaVersion !== AGENT_FIRST_LOOP_SCHEMA) {
    push('loop.schema', 'schemaVersion', `schemaVersion must be ${AGENT_FIRST_LOOP_SCHEMA}`);
  }
  if (loop.driven_by !== 'agent' || !nonEmpty(loop.actor)) {
    push('loop.actor-invalid', 'driven_by', 'automated loop artifacts require driven_by=agent and a named actor');
  }
  for (const field of ['signals', 'candidates', 'reEvaluations', 'candidateDecisions', 'taskGraduationPolicies', 'taskGraduations', 'promotions', 'productLockChanges']) {
    if (!Array.isArray(loop[field])) push('loop.collection-invalid', field, `${field} must be an explicit array`);
  }
  if (!isDigest(loop.promotionPolicyDigest)) {
    push('loop.policy-digest-invalid', 'promotionPolicyDigest', 'the loop must bind the frozen RSI promotion policy');
  }

  const profiles = Array.isArray(registry?.registeredProfiles) ? registry.registeredProfiles : [];
  const subjects = Array.isArray(registry?.registeredSubjects) ? registry.registeredSubjects : [];
  const suites = Array.isArray(registry?.registeredSuites) ? registry.registeredSuites : [];
  const profile = profiles.find((entry) => entry?.id === loop.profileId);
  if (!profile) push('loop.unknown-profile', 'profileId', `profileId ${String(loop.profileId)} is not registered`);
  const subjectIds = new Set(subjects.filter((entry) => nonEmpty(entry?.id)).map((entry) => entry.id));
  const suite = profile ? suites.find((entry) => entry?.id === profile.suiteId) : undefined;
  const taskIds = new Set(Array.isArray(suite?.taskIds) ? suite.taskIds.filter(nonEmpty) : []);

  const suiteBinding = loop.suiteBinding;
  if (!isPlainObject(suiteBinding)) {
    push('suite.binding-missing', 'suiteBinding', 'the loop must declare whether this profile suite corpus is frozen');
  } else {
    if (profile && suiteBinding.suiteId !== profile.suiteId) {
      push('suite.binding-mismatch', 'suiteBinding.suiteId', 'suite binding must name the suite selected by the registered profile');
    }
    if (!['not-frozen', 'frozen'].includes(suiteBinding.status)) {
      push('suite.binding-status', 'suiteBinding.status', 'suite binding status must be not-frozen or frozen');
    }
    if (suite && suiteBinding.status !== (suite.corpusStatus ?? 'not-frozen')) {
      push('suite.binding-status-mismatch', 'suiteBinding.status', 'corpus freeze state must match the registered suite');
    }
    if (suiteBinding.status === 'not-frozen' && suiteBinding.contentDigest !== null) {
      push('suite.digest-before-freeze', 'suiteBinding.contentDigest', 'an unfrozen suite must not claim a content digest');
    }
    if (suiteBinding.status === 'frozen' && !/^sha256:[a-f0-9]{64}$/u.test(String(suiteBinding.contentDigest ?? ''))) {
      push('suite.content-digest-missing', 'suiteBinding.contentDigest', 'a frozen suite must carry a content digest');
    }
    if (suiteBinding.status === 'frozen' && suite && suite.contentDigest !== suiteBinding.contentDigest) {
      push('suite.content-digest-mismatch', 'suiteBinding.contentDigest', 'frozen suite content digest must match the registered suite');
    }
  }

  const heldOut = loop.heldOutSplit;
  if (!isPlainObject(heldOut)) {
    push('heldout.missing', 'heldOutSplit', 'a loop record must declare held-out split state');
  } else {
    if (heldOut.writableByCandidate !== false) {
      push('heldout.candidate-writable', 'heldOutSplit.writableByCandidate', 'held-out writability must be explicitly false');
    }
    if (profile && heldOut.suiteId !== profile.suiteId) {
      push('heldout.suite-mismatch', 'heldOutSplit.suiteId', `held-out suite ${String(heldOut.suiteId)} does not match profile suite ${String(profile.suiteId)}`);
    }
    if (heldOut.status === 'not-frozen') {
      if (heldOut.digest !== null) push('heldout.digest-before-freeze', 'heldOutSplit.digest', 'an unfrozen held-out split must not claim a digest');
      if (loop.suiteBinding?.status === 'frozen') push('heldout.not-frozen-for-run', 'heldOutSplit.status', 'a runnable frozen suite requires a frozen held-out split');
    } else if (heldOut.status === 'frozen') {
      if (loop.suiteBinding?.status !== 'frozen') push('heldout.suite-not-frozen', 'heldOutSplit.status', 'held-out cannot be frozen before its suite corpus is frozen');
      const expected = suite ? computeHeldOutDigest(suite, suiteBinding?.contentDigest) : null;
      if (!expected || heldOut.digest !== expected) {
        push('heldout.digest-stale', 'heldOutSplit.digest', `held-out digest does not match the frozen suite split (expected ${String(expected)})`);
      }
    } else {
      push('heldout.status-invalid', 'heldOutSplit.status', 'held-out split status must be not-frozen or frozen');
    }
  }

  const signals = Array.isArray(loop.signals) ? loop.signals : [];
  if (signals.length === 0) push('signal.missing', 'signals', 'the loop must declare at least one signal/gap input');
  const signalIds = new Set();
  for (const signal of signals) {
    const id = nonEmpty(signal?.id) ? signal.id : '<missing>';
    const path = `signals.${id}`;
    if (!nonEmpty(signal?.id)) push('signal.id-missing', path, 'a signal must have a nonempty string id');
    if (signalIds.has(id)) push('signal.duplicate-id', path, `signal id ${id} is duplicated`);
    signalIds.add(id);
    if (!REQUIRED_DIMENSIONS.includes(signal?.dimension)) {
      push('signal.unknown-dimension', path, `dimension ${String(signal?.dimension)} is not one of the sealed acceptance dimensions`);
    }
    if (!Array.isArray(signal?.evidenceLinks) || signal.evidenceLinks.length === 0 || signal.evidenceLinks.some((link) => !nonEmpty(link))) {
      push('signal.evidence-missing', path, 'a signal must link at least one evidence artifact');
    }
    const resolvesToGate = REQUIRED_GATE_IDS.includes(signal?.gateId);
    const resolvesToTask = taskIds.has(signal?.taskId);
    if (nonEmpty(signal?.taskId) && !resolvesToTask) {
      push('signal.unresolved', path, 'taskId must resolve to a task registered in the selected suite');
    }
    if (!resolvesToGate && !resolvesToTask) {
      push('signal.unresolved', path, 'a signal must resolve to a sealed gate id or a task id');
    }
    if (!['evaluation-gap', 'observed-regression', 'residual'].includes(signal?.kind)) {
      push('signal.invalid-kind', path, 'signal kind must distinguish an evaluation gap from an observed regression or residual');
    }
    if (!SIGNAL_STATUSES.includes(signal?.status)) {
      push('signal.invalid-status', path, `unknown signal status ${String(signal?.status)}`);
    }
  }

  const producer = loop.candidateProducer;
  if (!isPlainObject(producer) || !nonEmpty(producer.id) || producer.layer !== 'self-improvement' || !['not-implemented', 'registered'].includes(producer.status)) {
    push('candidate.producer-unregistered', 'candidateProducer', 'candidateProducer must name a self-improvement layer and its implementation status');
  } else if (producer.id === FRAMEWORK_AUTHOR || subjectIds.has(producer.id)) {
    push('candidate.producer-unregistered', 'candidateProducer', 'candidate producer may not be the framework or a subject under test');
  }

  const candidates = Array.isArray(loop.candidates) ? loop.candidates : [];
  if (producer?.status === 'not-implemented' && candidates.length > 0) {
    push('candidate.producer-not-implemented', 'candidates', 'no candidate is admissible until a self-improvement producer is registered');
  }
  const candidatesById = new Map();
  for (const candidate of candidates) {
    const id = nonEmpty(candidate?.id) ? candidate.id : '<missing>';
    const path = `candidates.${id}`;
    if (!nonEmpty(candidate?.id)) push('candidate.id-missing', path, 'a candidate must have a nonempty string id');
    if (candidatesById.has(id)) push('candidate.duplicate-id', path, `candidate id ${id} is duplicated`);
    else candidatesById.set(id, candidate);
    if (candidate?.authoredBy !== producer?.id || candidate?.authoredBy === FRAMEWORK_AUTHOR || subjectIds.has(candidate?.authoredBy)) {
      push('candidate.framework-authored', path, 'candidate author must match the registered self-improvement producer and may not be the framework or subject');
    }
    const sourceSignalIds = Array.isArray(candidate?.sourceSignalIds) ? candidate.sourceSignalIds : [];
    if (sourceSignalIds.length === 0 || sourceSignalIds.some((signalId) => !signalIds.has(signalId))) {
      push('candidate.signal-unlinked', path, 'candidate must link to one or more declared improvement signals');
    }
    if (!/^sha256:[a-f0-9]{64}$/u.test(String(candidate?.digest ?? ''))) {
      push('candidate.digest-missing', path, 'candidate must bind a content-addressed change digest');
    }
    if (loop.suiteBinding?.status !== 'frozen') {
      push('candidate.suite-not-frozen', path, 'a candidate may not be evaluated until the suite content and held-out split are frozen');
    }
    if (candidate?.promotionPolicyDigest !== loop.promotionPolicyDigest) {
      push('candidate.policy-digest-mismatch', path, 'candidate must bind the exact frozen promotion policy digest');
    }
  }

  const reEvaluations = Array.isArray(loop.reEvaluations) ? loop.reEvaluations : [];
  const reEvaluationsById = new Map();
  const measuredRunIds = new Set();
  const measuredSequences = new Set();
  for (const reEvaluation of reEvaluations) {
    const id = nonEmpty(reEvaluation?.id) ? reEvaluation.id : '<missing>';
    const path = `reEvaluations.${id}`;
    if (!nonEmpty(reEvaluation?.id)) push('reevaluation.id-missing', path, 'a re-evaluation must have a nonempty string id');
    if (reEvaluationsById.has(id)) push('reevaluation.duplicate-id', path, `re-evaluation id ${id} is duplicated`);
    else reEvaluationsById.set(id, reEvaluation);
    if (!['not-run', 'complete', 'insufficient-evidence', 'invalid'].includes(reEvaluation?.status)) {
      push('reevaluation.invalid-status', path, `unknown re-evaluation status ${String(reEvaluation?.status)}`);
    }
    if (reEvaluation?.status !== 'not-run' && (loop.suiteBinding?.status !== 'frozen' || heldOut?.status !== 'frozen')) {
      push('reevaluation.suite-not-frozen', path, 'a re-evaluation cannot run until suite content and held-out split are frozen');
    }
    if (profile && reEvaluation?.suiteId !== profile.suiteId) {
      push('reevaluation.suite-mismatch', path, `re-evaluation must use frozen suite ${String(profile.suiteId)}`);
    }
    if (reEvaluation?.suiteContentDigest !== suiteBinding?.contentDigest) {
      push('reevaluation.suite-content-mismatch', path, 're-evaluation must use the exact frozen suite content digest');
    }
    if (reEvaluation?.heldOutSplitDigest !== heldOut?.digest) {
      push('reevaluation.heldout-digest-mismatch', path, 're-evaluation must use the exact frozen held-out digest');
    }
    const candidate = candidatesById.get(reEvaluation?.candidateId);
    if (!candidate) {
      push('reevaluation.unknown-candidate', path, `candidateId ${String(reEvaluation?.candidateId)} is not declared in this loop record`);
    } else if (reEvaluation?.candidateDigest !== candidate.digest) {
      push('reevaluation.candidate-digest-mismatch', path, 're-evaluation must bind the exact candidate digest');
    }
    if (reEvaluation?.status === 'not-run') {
      if (nonEmpty(reEvaluation?.runId) || nonEmpty(reEvaluation?.resultDigest) || nonEmpty(reEvaluation?.resultRef) || reEvaluation?.sealed === true) {
        push('reevaluation.not-run-has-evidence', path, 'a not-run re-evaluation must not carry a run result');
      }
      continue;
    }
    if (!Number.isInteger(reEvaluation?.sequence) || reEvaluation.sequence < 1 || measuredSequences.has(reEvaluation.sequence)) {
      push('reevaluation.sequence-invalid', path, 'executed re-evaluations require distinct positive sequence numbers');
    }
    measuredSequences.add(reEvaluation?.sequence);
    if (reEvaluation?.status === 'complete') {
      if (!nonEmpty(reEvaluation?.runId) || !/^sha256:[a-f0-9]{64}$/u.test(String(reEvaluation?.resultDigest ?? '')) || !nonEmpty(reEvaluation?.resultRef)) {
        push('reevaluation.evidence-unsealed', path, 'complete re-evaluation needs runId, resultRef and sha256 resultDigest');
      }
      if (reEvaluation?.sealed !== true || reEvaluation?.independentVerifier !== true) {
        push('reevaluation.not-independently-sealed', path, 'complete re-evaluation must be sealed and independently verified');
      }
      if (!nonEmpty(reEvaluation?.executorActor) || !nonEmpty(reEvaluation?.verifierActor) || reEvaluation.executorActor === reEvaluation.verifierActor) {
        push('reevaluation.actor-not-independent', path, 'executor and verifier must be distinct named actors');
      }
      if (reEvaluation?.driven_by !== 'agent') {
        push('reevaluation.actor-invalid', path, 'measured records must be explicitly agent-driven');
      }
      if (measuredRunIds.has(reEvaluation?.runId)) {
        push('reevaluation.duplicate-run', path, 'one measured run cannot be counted as multiple re-evaluations');
      }
      measuredRunIds.add(reEvaluation?.runId);
      if (!Number.isInteger(reEvaluation?.completeCases) || reEvaluation.completeCases < (suite?.minCases ?? MINIMUM_SUITE_CASES) || reEvaluation?.k !== suite?.k) {
        push('reevaluation.insufficient-sample', path, 'complete-case count and k must meet the frozen suite floors');
      }
      const failureClasses = reEvaluation?.failureClasses;
      if (!isPlainObject(failureClasses) || ['infrastructure', 'task', 'grader', 'agent'].some((key) => !Number.isInteger(failureClasses[key]) || failureClasses[key] < 0)) {
        push('reevaluation.failure-classes-missing', path, 'infrastructure/task/grader/agent failure classes must be separately counted');
      }
      const metrics = reEvaluation?.metrics;
      if (!isPlainObject(metrics) || ['passKLower95', 'flakeRate'].some((key) => !Number.isFinite(metrics[key]) || metrics[key] < 0 || metrics[key] > 1) ||
        ['negativeControlRegressions', 'safetyRegressions', 'safetySkips', 'safetyFlakes'].some((key) => !Number.isInteger(metrics?.[key]) || metrics[key] < 0)) {
        push('reevaluation.metrics-invalid', path, 'complete metrics need probabilities in [0,1] and nonnegative integer regression/safety counts');
      }
    }
  }

  for (const signal of signals) {
    if (!['observed-regression', 'residual'].includes(signal?.kind)) continue;
    const sourceRun = reEvaluations.find((run) => run?.runId === signal.sourceRunId && run.status === 'complete');
    if (!nonEmpty(signal?.sourceRunId) || !sourceRun || suiteBinding?.status !== 'frozen') {
      push('signal.unobserved-result', `signals.${String(signal?.id)}`, 'observed regressions/residuals must reference a complete measured run; an evaluation gap is not an observation');
    }
  }

  const candidateDecisions = Array.isArray(loop.candidateDecisions) ? loop.candidateDecisions : [];
  const decisionIds = new Set();
  for (const decision of candidateDecisions) {
    const id = nonEmpty(decision?.id) ? decision.id : '<missing>';
    const path = `candidateDecisions.${id}`;
    if (!nonEmpty(decision?.id) || decisionIds.has(id)) push('candidate-decision.id-invalid', path, 'candidate decisions require distinct string ids');
    decisionIds.add(id);
    if (decision?.authoredBy !== producer?.id || decision?.promotionPolicyDigest !== loop.promotionPolicyDigest || !['promote', 'reject', 'defer'].includes(decision?.disposition)) {
      push('candidate-decision.authority-invalid', path, 'candidate decisions are supplied by the registered RSI producer under its frozen policy');
    }
    if (!candidatesById.has(decision?.candidateId)) {
      push('candidate-decision.unknown-candidate', path, 'a candidate decision must reference a declared candidate');
    }
    const runIds = Array.isArray(decision?.reEvaluationIds) ? decision.reEvaluationIds : [];
    if (runIds.length === 0 || new Set(runIds).size !== runIds.length || runIds.some((runId) => {
      const run = reEvaluationsById.get(runId);
      return !run || run.status !== 'complete' || run.candidateId !== decision.candidateId;
    })) {
      push('candidate-decision.evidence-missing', path, 'a candidate decision must reference measured re-evaluation evidence');
    }
  }

  const graduationPolicies = Array.isArray(loop.taskGraduationPolicies) ? loop.taskGraduationPolicies : [];
  const graduationById = new Map();
  for (const policy of graduationPolicies) {
    const id = nonEmpty(policy?.id) ? policy.id : '<missing>';
    const path = `taskGraduationPolicies.${id}`;
    if (graduationById.has(id)) push('graduation.policy-duplicate', path, `task graduation policy ${id} is duplicated`);
    else graduationById.set(id, policy);
    if (policy?.frozenBeforeCandidate !== true || !isDigest(policy?.digest) || policy.digest !== computeGraduationPolicyDigest(policy)) {
      push('graduation.policy-not-frozen', path, 'task-specific graduation policy must be frozen and digest-addressed before the measured candidate');
    }
    if (!nonEmpty(policy?.id) || !taskIds.has(policy?.taskId) || policy?.from !== 'capability' || policy?.to !== 'regression' ||
      !Number.isInteger(policy?.minCompleteCases) || policy.minCompleteCases < (suite?.minCases ?? MINIMUM_SUITE_CASES) ||
      !Number.isInteger(policy?.k) || policy.k < MINIMUM_SUITE_K || policy.k !== suite?.k ||
      !Number.isFinite(policy?.minimumPassKLower95) || policy.minimumPassKLower95 <= 0 || policy.minimumPassKLower95 > 1 ||
      !Number.isFinite(policy?.maximumFlakeRate) || policy.maximumFlakeRate < 0 || policy.maximumFlakeRate > 1 ||
      !Number.isInteger(policy?.minimumConsecutiveRuns) || policy.minimumConsecutiveRuns < 2) {
      push('graduation.policy-invalid', path, 'task graduation policy needs capability->regression, frozen floors, lower-CI/flakiness targets and >=2 consecutive runs');
    }
  }

  const taskGraduations = Array.isArray(loop.taskGraduations) ? loop.taskGraduations : [];
  const graduatedTasks = new Set();
  for (const graduation of taskGraduations) {
    const taskId = nonEmpty(graduation?.taskId) ? graduation.taskId : '<missing>';
    const path = `taskGraduations.${taskId}`;
    if (!taskIds.has(taskId) || graduatedTasks.has(taskId)) push('graduation.task-invalid', path, 'only distinct registered tasks may graduate');
    graduatedTasks.add(taskId);
    if (graduation?.from !== 'capability' || graduation?.to !== 'regression') {
      push('graduation.direction-invalid', path, 'task graduation may only move capability -> regression');
    }
    const policy = graduationById.get(graduation?.policyId);
    if (!policy) {
      push('graduation.policy-missing', path, `policyId ${String(graduation?.policyId)} is not pre-registered`);
      continue;
    }
    if (policy.taskId !== graduation.taskId || graduation?.policyDigest !== policy.digest) {
      push('graduation.policy-binding-mismatch', path, 'graduation must bind the pre-registered policy for the same task');
    }
    const runIds = Array.isArray(graduation?.reEvaluationIds) ? graduation.reEvaluationIds : [];
    if (runIds.length < policy.minimumConsecutiveRuns || new Set(runIds).size !== runIds.length) {
      push('graduation.runs-insufficient', path, 'graduation needs the pre-registered number of distinct consecutive complete runs');
      continue;
    }
    const runs = runIds.map((runId) => reEvaluationsById.get(runId));
    if (runs.some((run) => !run || run.status !== 'complete' || run.taskId !== taskId || run.taskClass !== 'capability' || run.graduationPolicyDigest !== policy.digest)) {
      push('graduation.run-invalid', path, 'every graduation run must be a complete capability-task run bound to the same frozen policy');
      continue;
    }
    if (new Set(runs.map((run) => run.candidateId)).size !== 1 || runs.some((run, index) => index > 0 && run.sequence !== runs[index - 1].sequence + 1)) {
      push('graduation.runs-not-consecutive', path, 'graduation requires consecutive ordered runs of the same candidate, without omitting intervening failures');
    }
    const candidate = candidatesById.get(runs[0]?.candidateId);
    if (!Array.isArray(candidate?.graduationPolicyDigests) || !candidate.graduationPolicyDigests.includes(policy.digest)) {
      push('graduation.candidate-policy-unbound', path, 'the candidate must bind the task graduation policy before its measured runs');
    }
    if (runs.some((run) => run.completeCases < policy.minCompleteCases || run.k !== policy.k ||
      !Number.isFinite(run.metrics?.passKLower95) || run.metrics.passKLower95 < policy.minimumPassKLower95 ||
      !Number.isFinite(run.metrics?.flakeRate) || run.metrics.flakeRate > policy.maximumFlakeRate ||
      run.metrics?.negativeControlRegressions !== 0 || run.metrics?.safetyRegressions !== 0 || run.metrics?.safetySkips !== 0 || run.metrics?.safetyFlakes !== 0 ||
      ['infrastructure', 'task', 'grader'].some((key) => run.failureClasses?.[key] !== 0))) {
      push('graduation.threshold-failed', path, 'each run must meet frozen sample/k, lower-CI, flake, negative-control and safety requirements');
    }
  }

  if (Array.isArray(loop.promotions) && loop.promotions.length > 0) {
    push('graduation.legacy-promotion', 'promotions', 'bare promotions bypass the measured policy contract; use taskGraduations with sealed run bindings');
  }
  if (loop.publicationApproval !== null) {
    push('loop.publication-approval', 'publicationApproval', 'the loop never approves publication; that stays a separate publisher decision');
  }
  if (Array.isArray(loop.productLockChanges) && loop.productLockChanges.length > 0) {
    push('loop.locked-default-change', 'productLockChanges', 'the loop may not change a product lock or a frozen default');
  }
  if (loop.suiteBinding?.status !== 'frozen' && (candidates.length > 0 || reEvaluations.some((run) => run?.status !== 'not-run') || taskGraduations.length > 0)) {
    push('loop.not-run-suite-mutated', 'suiteBinding.status', 'unfrozen suite state requires candidates, completed runs and graduations all remain empty/not-run');
  }

  return { violations, counts: countLoop(loop) };
}

export function validateLoopContract(input = {}) {
  const violations = [];
  const registryResult = validateFrameworkRegistry(input.registry);
  if (registryResult.violations.length > 0) {
    violations.push({ code: 'loop.registry-invalid', path: 'registry', message: 'the framework registry the loop composes over does not itself validate' });
  }
  const loopResult = validateLoopRecord(input.loop, input.registry);
  for (const violation of loopResult.violations) violations.push({ ...violation, path: `loop.${violation.path}` });
  if (!isDigest(input.promotionPolicyDigest) || input.loop?.promotionPolicyDigest !== input.promotionPolicyDigest) {
    violations.push({ code: 'loop.policy-source-mismatch', path: 'loop.promotionPolicyDigest', message: 'the loop must bind the actual frozen RSI promotion policy read from disk' });
  }
  const guide = String(input.guide ?? '');
  for (const phrase of REQUIRED_LOOP_GUIDE_PHRASES) {
    if (!guide.includes(phrase)) violations.push({ code: 'guide.required-phrase', path: 'guide', message: `guide must state "${phrase}"` });
  }
  return { violations, counts: loopResult.counts };
}

export function loadLoopFiles(root = process.cwd()) {
  const raw = Object.fromEntries(Object.entries(LOOP_PATHS).map(([key, path]) => [key, readFileSync(join(root, path))]));
  return {
    guide: raw.guide.toString('utf8'),
    registry: JSON.parse(raw.registry.toString('utf8')),
    loop: JSON.parse(raw.loop.toString('utf8')),
    promotionPolicyDigest: digest(raw.promotionPolicy),
    inputDigests: Object.fromEntries(Object.entries(raw).map(([key, content]) => [LOOP_PATHS[key], digest(content)])),
  };
}

function createFrozenLoop(draft) {
  const suite = draft.registry.registeredSuites[0];
  const contentDigest = `sha256:${'a'.repeat(64)}`;
  suite.corpusStatus = 'frozen';
  suite.contentDigest = contentDigest;
  suite.taskIds = ['task-1', 'task-2'];
  draft.loop.suiteBinding = {
    suiteId: suite.id,
    status: 'frozen',
    contentDigest,
  };
  draft.loop.heldOutSplit.status = 'frozen';
  draft.loop.heldOutSplit.digest = computeHeldOutDigest(suite);
  draft.loop.candidateProducer.status = 'registered';
  return draft;
}

function createCandidateLoop(draft) {
  createFrozenLoop(draft);
  draft.loop.candidates = [{
    id: 'cand-1',
    authoredBy: draft.loop.candidateProducer.id,
    digest: `sha256:${'d'.repeat(64)}`,
    sourceSignalIds: [draft.loop.signals[0].id],
    promotionPolicyDigest: draft.loop.promotionPolicyDigest,
  }];
}

// Deterministic contract fixtures, never observations about the current system.
function createMeasuredLoop(draft) {
  createCandidateLoop(draft);
  const policy = {
    id: 'grad-1', taskId: 'task-1', from: 'capability', to: 'regression',
    frozenBeforeCandidate: true, minCompleteCases: 20, k: 3,
    minimumPassKLower95: 0.8, maximumFlakeRate: 0.01, minimumConsecutiveRuns: 2,
  };
  policy.digest = computeGraduationPolicyDigest(policy);
  draft.loop.taskGraduationPolicies = [policy];
  draft.loop.candidates[0].graduationPolicyDigests = [policy.digest];
  draft.loop.reEvaluations = [1, 2].map((sequence) => ({
    id: `re-${sequence}`, runId: `fixture-run-${sequence}`, sequence,
    status: 'complete', driven_by: 'agent', evidenceKind: 'deterministic-fixture',
    candidateId: 'cand-1', candidateDigest: draft.loop.candidates[0].digest,
    taskId: 'task-1', taskClass: 'capability', graduationPolicyDigest: policy.digest,
    suiteId: draft.loop.suiteBinding.suiteId,
    suiteContentDigest: draft.loop.suiteBinding.contentDigest,
    heldOutSplitDigest: draft.loop.heldOutSplit.digest,
    resultRef: `fixture://contract/run-${sequence}`, resultDigest: `sha256:${String(sequence).repeat(64)}`,
    sealed: true, independentVerifier: true, executorActor: 'fixture-executor', verifierActor: 'fixture-verifier',
    completeCases: 20, k: 3, failureClasses: { infrastructure: 0, task: 0, grader: 0, agent: 0 },
    metrics: { passKLower95: 0.9, flakeRate: 0, negativeControlRegressions: 0, safetyRegressions: 0, safetySkips: 0, safetyFlakes: 0 },
  }));
}

function createGraduatedLoop(draft) {
  createMeasuredLoop(draft);
  draft.loop.taskGraduations = [{
    taskId: 'task-1', from: 'capability', to: 'regression', policyId: 'grad-1',
    policyDigest: draft.loop.taskGraduationPolicies[0].digest, reEvaluationIds: ['re-1', 're-2'],
  }];
}

function decisionFor(draft, reEvaluationIds) {
  return {
    id: 'decision-1', candidateId: 'cand-1', disposition: 'promote',
    authoredBy: draft.loop.candidateProducer.id,
    promotionPolicyDigest: draft.loop.promotionPolicyDigest, reEvaluationIds,
  };
}

/**
 * Each control mutates a copy of the real fixture and must be rejected by
 * validateLoopContract. The id names the failure class, not the fixture.
 */
export const LOOP_NEGATIVE_CONTROLS = Object.freeze([
  { id: 'signal-unknown-dimension', requirement: 'a signal outside the sealed dimensions cannot be acted on', expectedCode: 'signal.unknown-dimension', mutate: (draft) => { draft.loop.signals[0].dimension = 'vibes'; } },
  { id: 'signal-evidence-missing', requirement: 'a signal with no evidence link cannot justify a change', expectedCode: 'signal.evidence-missing', mutate: (draft) => { draft.loop.signals[0].evidenceLinks = []; } },
  { id: 'signal-unresolved', requirement: 'a signal that resolves to neither a gate nor a task is unusable', expectedCode: 'signal.unresolved', mutate: (draft) => { delete draft.loop.signals[0].gateId; draft.loop.signals[0].taskId = null; } },
  { id: 'signal-kind-ambiguous', requirement: 'an evaluation gap must not be mislabeled as an observed regression', expectedCode: 'signal.invalid-kind', mutate: (draft) => { draft.loop.signals[0].kind = 'promotion'; } },
  { id: 'heldout-candidate-writable', requirement: 'a held-out split writable by the candidate cannot back a loop decision', expectedCode: 'heldout.candidate-writable', mutate: (draft) => { draft.loop.heldOutSplit.writableByCandidate = true; } },
  { id: 'heldout-falsely-sealed', requirement: 'a planned, unfrozen split must not be represented as sealed', expectedCode: 'heldout.digest-before-freeze', mutate: (draft) => { draft.loop.heldOutSplit.status = 'not-frozen'; draft.loop.heldOutSplit.digest = 'sha256:' + 'a'.repeat(64); } },
  { id: 'heldout-suite-mismatch', requirement: 'a held-out split from a different suite cannot back this profile', expectedCode: 'heldout.suite-mismatch', mutate: (draft) => { draft.loop.heldOutSplit.suiteId = 'some-other-suite'; } },
  { id: 'candidate-producer-unregistered', requirement: 'an absent self-improvement producer cannot emit candidates', expectedCode: 'candidate.producer-not-implemented', prepare: createCandidateLoop, mutate: (draft) => { draft.loop.candidateProducer.status = 'not-implemented'; } },
  { id: 'reevaluation-before-freeze', requirement: 'an evaluation cannot run against an unfrozen suite', expectedCode: 'reevaluation.suite-not-frozen', prepare: createMeasuredLoop, mutate: (draft) => { draft.registry.registeredSuites[0].corpusStatus = 'not-frozen'; draft.registry.registeredSuites[0].contentDigest = null; draft.loop.suiteBinding.status = 'not-frozen'; draft.loop.suiteBinding.contentDigest = null; draft.loop.heldOutSplit.status = 'not-frozen'; draft.loop.heldOutSplit.digest = null; } },
  { id: 'reevaluation-unknown-suite', requirement: 'a re-evaluation must use the frozen suite, not another one', expectedCode: 'reevaluation.suite-mismatch', prepare: createMeasuredLoop, mutate: (draft) => { draft.loop.reEvaluations[0].suiteId = 'some-other-suite'; } },
  { id: 'candidate-unlinked-signal', requirement: 'a candidate must be grounded in a declared improvement signal', expectedCode: 'candidate.signal-unlinked', prepare: createCandidateLoop, mutate: (draft) => { draft.loop.candidates[0].sourceSignalIds = ['ghost-signal']; } },
  { id: 'candidate-policy-mismatch', requirement: 'a candidate must bind the frozen decision policy identity', expectedCode: 'candidate.policy-digest-mismatch', prepare: createCandidateLoop, mutate: (draft) => { draft.loop.candidates[0].promotionPolicyDigest = `sha256:${'f'.repeat(64)}`; } },
  { id: 'reevaluation-unsealed', requirement: 'a complete re-evaluation without a sealed independent evidence pack is invalid', expectedCode: 'reevaluation.evidence-unsealed', prepare: createMeasuredLoop, mutate: (draft) => { draft.loop.reEvaluations[0].resultDigest = null; } },
  { id: 'candidate-decision-without-run', requirement: 'a candidate decision must reference measured re-evaluation evidence', expectedCode: 'candidate-decision.evidence-missing', prepare: createCandidateLoop, mutate: (draft) => { draft.loop.candidateDecisions = [decisionFor(draft, [])]; } },
  { id: 'graduation-policy-not-frozen', requirement: 'task graduation criteria must be frozen before candidate evaluation', expectedCode: 'graduation.policy-not-frozen', prepare: createMeasuredLoop, mutate: (draft) => { draft.loop.taskGraduationPolicies[0].frozenBeforeCandidate = false; } },
  { id: 'graduation-reverse-direction', requirement: 'a task graduation cannot demote regression to capability', expectedCode: 'graduation.direction-invalid', prepare: createGraduatedLoop, mutate: (draft) => { draft.loop.taskGraduations[0].from = 'regression'; draft.loop.taskGraduations[0].to = 'capability'; } },
  { id: 'loop-publication-approval', requirement: 'the loop never approves publication', expectedCode: 'loop.publication-approval', mutate: (draft) => { draft.loop.publicationApproval = { approvedBy: 'some-agent', scope: 'release' }; } },
  { id: 'loop-locked-default-change', requirement: 'the loop may not change a product lock or frozen default', expectedCode: 'loop.locked-default-change', mutate: (draft) => { draft.loop.productLockChanges = [{ lock: 'defaultOn', value: true }]; } },
  { id: 'loop-unknown-profile', requirement: 'a loop over an unregistered profile cannot run', expectedCode: 'loop.unknown-profile', mutate: (draft) => { draft.loop.profileId = 'not-a-registered-profile'; } },
  { id: 'loop-malformed-collection', requirement: 'malformed collections cannot be treated as an empty not-run loop', expectedCode: 'loop.collection-invalid', mutate: (draft) => { draft.loop.candidates = {}; } },
  { id: 'loop-fabricated-human', requirement: 'automated artifacts may never claim a human actor', expectedCode: 'loop.actor-invalid', mutate: (draft) => { draft.loop.driven_by = 'real-human'; } },
  { id: 'signal-blank-id', requirement: 'a signal needs a stable identity', expectedCode: 'signal.id-missing', mutate: (draft) => { draft.loop.signals[0].id = ''; } },
  { id: 'signal-empty-evidence-entry', requirement: 'an empty evidence entry is not a link', expectedCode: 'signal.evidence-missing', mutate: (draft) => { draft.loop.signals[0].evidenceLinks = [null]; } },
  { id: 'signal-unknown-task', requirement: 'a task signal must resolve inside the selected suite', expectedCode: 'signal.unresolved', prepare: createFrozenLoop, mutate: (draft) => { draft.loop.signals[0].gateId = null; draft.loop.signals[0].taskId = 'ghost-task'; } },
  { id: 'signal-unobserved-regression', requirement: 'an evaluation gap is not a measured regression', expectedCode: 'signal.unobserved-result', mutate: (draft) => { draft.loop.signals[0].kind = 'observed-regression'; draft.loop.signals[0].sourceRunId = 'never-run'; } },
  { id: 'suite-freeze-state-mismatch', requirement: 'loop and registry freeze state must agree', expectedCode: 'suite.binding-status-mismatch', prepare: createFrozenLoop, mutate: (draft) => { draft.registry.registeredSuites[0].corpusStatus = 'not-frozen'; draft.registry.registeredSuites[0].contentDigest = null; } },
  { id: 'heldout-retuned', requirement: 'a retuned held-out split cannot reuse its original seal', expectedCode: 'heldout.digest-stale', prepare: createMeasuredLoop, mutate: (draft) => { draft.registry.registeredSuites[0].split.heldOut += 1; } },
  { id: 'reevaluation-heldout-mismatch', requirement: 'each re-evaluation binds the exact held-out digest', expectedCode: 'reevaluation.heldout-digest-mismatch', prepare: createMeasuredLoop, mutate: (draft) => { draft.loop.reEvaluations[0].heldOutSplitDigest = `sha256:${'f'.repeat(64)}`; } },
  { id: 'reevaluation-content-mismatch', requirement: 'each re-evaluation binds the exact corpus digest', expectedCode: 'reevaluation.suite-content-mismatch', prepare: createMeasuredLoop, mutate: (draft) => { draft.loop.reEvaluations[0].suiteContentDigest = `sha256:${'f'.repeat(64)}`; } },
  { id: 'reevaluation-candidate-mismatch', requirement: 'each re-evaluation binds the exact candidate digest', expectedCode: 'reevaluation.candidate-digest-mismatch', prepare: createMeasuredLoop, mutate: (draft) => { draft.loop.reEvaluations[0].candidateDigest = `sha256:${'f'.repeat(64)}`; } },
  { id: 'reevaluation-same-actor', requirement: 'the executor cannot impersonate its independent verifier', expectedCode: 'reevaluation.actor-not-independent', prepare: createMeasuredLoop, mutate: (draft) => { draft.loop.reEvaluations[0].verifierActor = draft.loop.reEvaluations[0].executorActor; } },
  { id: 'reevaluation-recounted-run', requirement: 'one result cannot count as two independent runs', expectedCode: 'reevaluation.duplicate-run', prepare: createMeasuredLoop, mutate: (draft) => { draft.loop.reEvaluations[1].runId = draft.loop.reEvaluations[0].runId; } },
  { id: 'reevaluation-invalid-metric', requirement: 'impossible probabilities do not support promotion', expectedCode: 'reevaluation.metrics-invalid', prepare: createMeasuredLoop, mutate: (draft) => { draft.loop.reEvaluations[0].metrics.passKLower95 = 1.1; } },
  { id: 'candidate-decision-not-run', requirement: 'a placeholder re-evaluation cannot support an RSI decision', expectedCode: 'candidate-decision.evidence-missing', prepare: createMeasuredLoop, mutate: (draft) => { draft.loop.reEvaluations = [{ id: 're-1', candidateId: 'cand-1', candidateDigest: draft.loop.candidates[0].digest, status: 'not-run', suiteId: draft.loop.suiteBinding.suiteId, suiteContentDigest: draft.loop.suiteBinding.contentDigest, heldOutSplitDigest: draft.loop.heldOutSplit.digest }]; draft.loop.candidateDecisions = [decisionFor(draft, ['re-1'])]; } },
  { id: 'graduation-below-threshold', requirement: 'saturation requires every run to meet the frozen lower confidence bound', expectedCode: 'graduation.threshold-failed', prepare: createGraduatedLoop, mutate: (draft) => { draft.loop.reEvaluations[1].metrics.passKLower95 = 0.5; } },
  { id: 'graduation-safety-skip', requirement: 'safety skips forbid graduation', expectedCode: 'graduation.threshold-failed', prepare: createGraduatedLoop, mutate: (draft) => { draft.loop.reEvaluations[1].metrics.safetySkips = 1; } },
  { id: 'graduation-duplicate-run', requirement: 'graduation needs distinct complete runs', expectedCode: 'graduation.runs-insufficient', prepare: createGraduatedLoop, mutate: (draft) => { draft.loop.taskGraduations[0].reEvaluationIds = ['re-1', 're-1']; } },
  { id: 'graduation-skipped-run', requirement: 'nonconsecutive runs cannot hide an intervening failure', expectedCode: 'graduation.runs-not-consecutive', prepare: createGraduatedLoop, mutate: (draft) => { draft.loop.reEvaluations[1].sequence = 3; } },
  { id: 'graduation-retuned-policy', requirement: 'the policy digest must cover the actual threshold values', expectedCode: 'graduation.policy-not-frozen', prepare: createGraduatedLoop, mutate: (draft) => { draft.loop.taskGraduationPolicies[0].minimumPassKLower95 = 0.2; } },
  { id: 'graduation-policy-not-bound-to-candidate', requirement: 'task thresholds must be bound before the candidate is measured', expectedCode: 'graduation.candidate-policy-unbound', prepare: createGraduatedLoop, mutate: (draft) => { draft.loop.candidates[0].graduationPolicyDigests = []; } },
  { id: 'graduation-bare-promotion', requirement: 'an unverified bare promotion cannot bypass the measured graduation contract', expectedCode: 'graduation.legacy-promotion', mutate: (draft) => { draft.loop.promotions = [{ taskId: 'ghost-task', from: 'regression', to: 'capability' }]; } },
  { id: 'loop-policy-source-mismatch', requirement: 'the loop cannot substitute a different RSI decision policy', expectedCode: 'loop.policy-source-mismatch', mutate: (draft) => { draft.loop.promotionPolicyDigest = `sha256:${'f'.repeat(64)}`; } },
]);

export function runLoopNegativeControls(files) {
  const results = [];
  for (const control of LOOP_NEGATIVE_CONTROLS) {
    const draft = structuredClone(files);
    let baselineValid = false;
    try {
      control.prepare?.(draft);
      const baseline = validateLoopContract(draft);
      baselineValid = baseline.violations.length === 0;
      if (!baselineValid) {
        results.push({ id: control.id, requirement: control.requirement, expectedCode: control.expectedCode, baselineValid, rejected: false, observedCodes: baseline.violations.map((entry) => `baseline:${entry.code}`) });
        continue;
      }
      control.mutate(draft);
    } catch (error) {
      results.push({
        id: control.id,
        requirement: control.requirement,
        expectedCode: control.expectedCode,
        baselineValid,
        rejected: false,
        observedCodes: [`mutate-threw: ${error?.message ?? String(error)}`],
      });
      continue;
    }
    const { violations } = validateLoopContract(draft);
    const observedCodes = [...new Set(violations.map((violation) => violation.code))];
    results.push({
      id: control.id,
      requirement: control.requirement,
      expectedCode: control.expectedCode,
      baselineValid,
      rejected: observedCodes.includes(control.expectedCode),
      observedCodes,
    });
  }
  return results;
}
