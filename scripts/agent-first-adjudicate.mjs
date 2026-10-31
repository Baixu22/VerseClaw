#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { isMainEntrypoint } from './lib/entrypoint.mjs';
import { verifyOperationalAcceptance } from './agent-first-operational-check.mjs';
import { verifyTrialAcceptance } from './lib/agent-first-trials.mjs';
import { sha256 } from './lib/agent-first-task-corpus.mjs';

const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
const present = (value) => typeof value === 'string' && value.trim().length > 0;
const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
const within = (root, path) => {
  const full = resolve(root, path), rel = relative(resolve(root), full);
  return rel && !isAbsolute(rel) && !rel.startsWith('..') && !rel.startsWith('..\\') && rel !== '..';
};

function artifact(root, entry) {
  assert(entry && present(entry.id) && present(entry.path) && /^sha256:[a-f0-9]{64}$/u.test(entry.sha256), `invalid evidence artifact: ${entry?.id ?? 'unknown'}`);
  assert(within(root, entry.path), `evidence artifact escapes root: ${entry.path}`);
  const path = resolve(root, entry.path);
  assert.equal(sha256(readFileSync(path)), entry.sha256, `evidence artifact changed: ${entry.id}`);
  return { path, value: read(path) };
}

function loadPlan(root, planPath) {
  assert(within(root, planPath), 'adjudication plan escapes source root');
  const path = resolve(root, planPath), plan = read(path), digest = sha256(readFileSync(path));
  assert.equal(plan.schemaVersion, 'AgentFirstAdjudicationPlan/v1', 'invalid adjudication plan schema');
  assert.equal(plan.driven_by, 'agent', 'adjudication plan must be agent-driven');
  assert(present(plan.actor) && present(plan.candidate?.commit) && present(plan.candidate?.tree), 'missing adjudication plan provenance');
  assert.equal(plan.candidate.dirty, false, 'adjudication plan candidate must be clean');
  assert(plan.actors && present(plan.actors.executor) && present(plan.actors.reviewer) && present(plan.actors.verifier), 'missing adjudication actors');
  assert.notEqual(plan.actors.executor, plan.actors.reviewer, 'reviewer must differ from executor');
  assert.notEqual(plan.actors.reviewer, plan.actors.verifier, 'verifier must differ from reviewer');
  assert.notEqual(plan.actors.executor, plan.actors.verifier, 'verifier must differ from executor');
  assert(Array.isArray(plan.requiredArtifacts) && plan.requiredArtifacts.length >= 4, 'required evidence artifacts are missing');
  assert(Array.isArray(plan.requiredDimensions) && plan.requiredDimensions.includes('releaseApproval'), 'required dimensions are incomplete');
  assert(present(plan.residualOwner) && present(plan.reviewBy), 'residual owner/review date missing');
  return { path, digest, value: plan };
}

function reviewEvidence(root, plan) {
  const artifacts = new Map();
  for (const entry of plan.requiredArtifacts) artifacts.set(entry.id, artifact(root, entry));
  for (const id of ['tf0592', 'tf0593-review', 'tf0593-controls', 'tf0594']) assert(artifacts.has(id), `required evidence missing: ${id}`);

  const trial = verifyTrialAcceptance(plan.requiredArtifacts.find((entry) => entry.id === 'tf0592').path, { root });
  const operational = verifyOperationalAcceptance(plan.requiredArtifacts.find((entry) => entry.id === 'tf0594').path, root);
  const review = artifacts.get('tf0593-review').value, controls = artifacts.get('tf0593-controls').value;
  assert.notEqual(review.actor, review.executorActor, 'reviewer actor equals executor');
  assert.equal(review.complete, true, 'review is incomplete');
  assert.deepEqual(review.counts, { pass: 144, fail: 0, unknown: 0 }, 'review counts differ');
  assert.equal(review.rubricCalibration?.agreementRate, 1, 'rubric calibration did not pass');
  assert.equal(controls.sourceManifestDigest, review.manifestDigest, 'control manifest differs from review');
  assert.equal(controls.sourceReviewDigest, sha256(readFileSync(artifacts.get('tf0593-review').path)), 'control review digest differs');
  assert.equal(controls.passed, true, 'negative controls did not pass');
  assert(controls.results.every((row) => row.actual === row.expected), 'negative control result differs');

  const evidenceCandidates = {
    tf0592: artifacts.get('tf0592').value.sourceCandidate,
    tf0593: review.sourceCandidate,
    tf0594: artifacts.get('tf0594').value.candidate,
  };
  const closure = Object.fromEntries(Object.entries(evidenceCandidates).map(([id, candidate]) => {
    if (candidate.commit === plan.candidate.commit && candidate.tree === plan.candidate.tree) {
      return [id, { status: 'same-candidate', changedPaths: 0, evaluationOnly: true }];
    }
    const changedPaths = git(root, ['diff', '--name-only', `${candidate.commit}..${plan.candidate.commit}`]).split('\n').filter(Boolean);
    const productPaths = changedPaths.filter((path) => !/^(?:harness|scripts|tests|docs)\//u.test(path));
    return [id, { status: productPaths.length === 0 ? 'evaluation-only-closure' : 'product-drift', changedPaths: changedPaths.length, evaluationOnly: productPaths.length === 0, productPaths }];
  }));
  const stale = Object.entries(closure).filter(([, value]) => value.status === 'product-drift').map(([id]) => id);
  const evidenceFresh = stale.length === 0;
  const operationalStatus = operational.operational?.operational ?? operational.operational;

  const sourceCandidate = { commit: git(root, ['rev-parse', `${plan.candidate.commit}^{tree}`]), tree: plan.candidate.tree };
  assert.equal(sourceCandidate.commit, plan.candidate.tree, 'candidate tree does not match plan');
  try { git(root, ['merge-base', '--is-ancestor', plan.candidate.commit, 'HEAD']); }
  catch { assert.fail('candidate is not in the current history'); }

  const distribution = operational.distribution;
  const nextGate = stale.length > 0
    ? 'engineering: rerun TF-0592/TF-0593 on the current candidate and refresh their source bindings'
    : distribution === 'not-run' ? 'distribution: build a frozen win-unpacked artifact and rerun packaged parity'
      : operationalStatus === 'pass' ? 'agentQuality: run a live-provider or broader current-candidate quality evaluation' : 'operational: close the failing OAT drill';
  const dimensions = {
    source: { status: evidenceFresh ? 'pass' : 'stale', candidate: plan.candidate, checked: ['commit', 'tree', 'clean', 'history', 'source-closure'] },
    engineering: { status: evidenceFresh ? 'pass' : 'stale', trials: trial.recordedTrials, controls: controls.results.length, rubricAgreement: review.rubricCalibration.agreementRate, staleEvidence: stale.filter((id) => id !== 'tf0594'), sourceClosure: closure },
    runtime: { status: operationalStatus === 'pass' ? 'pass-source' : 'fail', scope: 'source Electron/Gateway OAT; package runtime not run' },
    effect: { status: 'partial', scope: 'OAT core journey only; full current-candidate product-effect matrix is not rerun here' },
    distribution: { status: distribution, source: operational },
    operational: { status: operationalStatus, drills: operational.drills, providerFaults: operational.providerFaults },
    agentQuality: { status: evidenceFresh ? 'partial' : 'stale', reason: evidenceFresh ? 'TF-0592/0593 use a deterministic scripted provider; no live-provider quality claim' : 'TF-0592/0593 evidence has product-runtime drift relative to the current candidate; live quality was not run' },
    releaseApproval: { status: 'not-approved', releaseApproved: false },
  };
  return { dimensions, stale, closure, nextGate, verdict: stale.length > 0 ? 'invalid' : distribution === 'not-run' ? 'not-release-ready' : 'pass-with-residuals' };
}

export function buildAdjudicationReport(root, planPath, reviewerActor) {
  const plan = loadPlan(root, planPath);
  assert.notEqual(reviewerActor, plan.value.actors.executor, 'reviewer actor must differ from executor');
  assert.equal(reviewerActor, plan.value.actors.reviewer, 'reviewer actor differs from plan reviewer');
  const reviewed = reviewEvidence(root, plan.value);
  const dimensions = reviewed.dimensions;
  const residuals = [
    ...(reviewed.stale.length > 0 ? [{ dimension: 'engineering', status: 'stale', owner: plan.value.residualOwner, reviewBy: plan.value.reviewBy, reason: `evidence candidate differs from plan candidate: ${reviewed.stale.join(', ')}` }] : []),
    ...(dimensions.distribution.status === 'not-run' ? [{ dimension: 'distribution', status: 'not-run', owner: plan.value.residualOwner, reviewBy: plan.value.reviewBy, reason: 'frozen package unavailable or not executed' }] : []),
    { dimension: 'agentQuality', status: 'partial', owner: plan.value.residualOwner, reviewBy: plan.value.reviewBy, reason: 'scripted provider and partial current-candidate effect matrix; no live quality claim' },
    { dimension: 'releaseApproval', status: 'not-approved', owner: plan.value.residualOwner, reviewBy: plan.value.reviewBy, reason: 'release is outside agent authority' },
  ];
  return {
    schemaVersion: 'AgentFirstAdjudicationReport/v1', taskId: 'TF-0595', driven_by: 'agent', actor: reviewerActor,
    sourceCandidate: plan.value.candidate, plan: { path: planPath, digest: plan.digest },
    requiredDimensions: plan.value.requiredDimensions, dimensions, sourceClosure: reviewed.closure, residuals,
    verdict: reviewed.verdict, nextGate: reviewed.nextGate,
    limitations: ['Adjudication reads retained disk evidence; it does not infer a live model quality result from a scripted provider.', 'Distribution remains not-run when no frozen package was executed.'],
    claims: { realHuman: false, releaseApproved: false, distributionApproved: false, evidenceFresh: reviewed.stale.length === 0 },
  };
}

export function verifyAdjudicationReport(root, planPath, reportPath, verifierActor = 'codex/adjudicator-verifier') {
  const plan = loadPlan(root, planPath);
  const report = read(resolve(root, reportPath));
  assert.equal(report.schemaVersion, 'AgentFirstAdjudicationReport/v1', 'invalid adjudication report');
  assert.equal(report.driven_by, 'agent', 'adjudication report must be agent-driven');
  assert.equal(report.actor, plan.value.actors.reviewer, 'report reviewer differs from plan');
  assert.equal(verifierActor, plan.value.actors.verifier, 'verifier actor differs from plan');
  assert.notEqual(verifierActor, report.actor, 'verifier must differ from reviewer');
  assert.equal(report.plan?.digest, plan.digest, 'report plan digest differs');
  assert.equal(report.plan?.path, planPath.replaceAll('\\', '/'), 'report plan path differs');
  const expected = buildAdjudicationReport(root, planPath, report.actor);
  assert.deepEqual(report.dimensions, expected.dimensions, 'report dimensions differ from disk replay');
  assert.deepEqual(report.sourceClosure, expected.sourceClosure, 'report source closure differs from disk replay');
  assert.deepEqual(report.residuals, expected.residuals, 'report residuals differ from disk replay');
  assert.equal(report.verdict, expected.verdict, 'verdict differs from disk replay');
  assert.equal(report.nextGate, expected.nextGate, 'next gate differs from disk replay');
  assert.deepEqual(report.claims, expected.claims, 'report claims differ from disk replay');
  return { schemaVersion: 'AgentFirstAdjudicationVerification/v1', verification: 'pass', reportVerdict: report.verdict, candidate: report.sourceCandidate,
    planDigest: report.plan.digest, reportDigest: sha256(readFileSync(resolve(root, reportPath))), reviewer: report.actor, verifier: verifierActor,
    dimensions: Object.fromEntries(Object.entries(report.dimensions).map(([name, value]) => [name, value.status])), nextGate: report.nextGate };
}

function write(path, value) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(value, null, 2) + '\n', 'utf8'); }

if (isMainEntrypoint(import.meta.url)) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { plan: { type: 'string' }, out: { type: 'string' }, actor: { type: 'string' }, report: { type: 'string' }, root: { type: 'string' } } });
  try {
    const root = resolve(values.root ?? resolve(import.meta.dirname, '..')), plan = values.plan ?? 'harness/specs/fixtures/agent-first-system/adjudication/plan.v1.json';
    if (positionals[0] === 'review') {
      const report = buildAdjudicationReport(root, plan, values.actor ?? 'codex/adjudicator-reviewer');
      if (!values.out) throw new Error('--out is required');
      write(resolve(values.out), report);
      console.log(JSON.stringify({ reportVerdict: report.verdict, operational: report.dimensions.operational.status, distribution: report.dimensions.distribution.status, nextGate: report.nextGate, out: resolve(values.out) }));
    } else if (positionals[0] === 'verify') {
      if (!values.report) throw new Error('--report is required');
      const result = verifyAdjudicationReport(root, plan, values.report, values.actor ?? 'codex/adjudicator-verifier');
      if (!values.out) throw new Error('--out is required');
      write(resolve(values.out), result);
      console.log(JSON.stringify(result));
    } else throw new Error('use review --out <report> or verify --report <report> --out <verification>');
  } catch (error) { console.error(error?.stack ?? String(error)); process.exitCode = 1; }
}
