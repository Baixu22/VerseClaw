#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { isMainEntrypoint } from './lib/entrypoint.mjs';
import { sha256 } from './lib/agent-first-task-corpus.mjs';

const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
const artifactPath = 'harness/specs/fixtures/agent-first-system/trials/acceptance.json';
const reviewPath = 'harness/specs/fixtures/agent-first-system/adjudication/review.json';
const verificationPath = 'harness/specs/fixtures/agent-first-system/adjudication/verification.json';
const oatPath = 'harness/specs/fixtures/agent-first-system/oat/acceptance.json';
const matrixPath = 'harness/specs/fixtures/agent-first-acceptance/matrix.json';
const historicalPaths = [
  'harness/specs/fixtures/product-acceptance-closeout/a0-contract/manifest.json',
  'harness/specs/fixtures/product-acceptance-closeout/a1-memory/receipt.json',
  'harness/specs/fixtures/product-acceptance-closeout/a2-runner-path/receipt.json',
  'harness/specs/fixtures/product-acceptance-closeout/a3-source-safety/receipt.json',
  'harness/specs/fixtures/product-acceptance-closeout/a4-coding-final/receipt.json',
  'harness/specs/fixtures/product-acceptance-closeout/a5-qa-pack/receipt.json',
  'harness/specs/fixtures/product-acceptance-closeout/b1-space-bunny/receipt.json',
  'harness/specs/fixtures/product-acceptance-closeout/b2-moyu/manifest.json',
];

function statusFor(id, dimensions, verification) {
  if (['A1', 'A2', 'B1', 'B2', 'B3'].includes(id)) return dimensions.engineering.status;
  if (id === 'C1') return dimensions.effect.status;
  if (id === 'C2') return dimensions.agentQuality.status;
  if (id === 'D1') return dimensions.distribution.status;
  if (id === 'D2') return dimensions.operational.status;
  if (['E1', 'E2'].includes(id)) return dimensions.agentQuality.status;
  if (['F1', 'F2'].includes(id)) return verification.verification;
  if (id === 'G1') return dimensions.releaseApproval.status;
  throw new Error(`unmapped mainline gate: ${id}`);
}

function artifactFor(id) {
  if (['A1', 'A2', 'E1', 'E2'].includes(id)) return artifactPath;
  if (['B1', 'B2', 'B3', 'F1', 'F2'].includes(id)) return reviewPath;
  if (['C1', 'C2', 'D1', 'D2'].includes(id)) return oatPath;
  if (id === 'G1') return matrixPath;
  throw new Error(`unmapped mainline artifact: ${id}`);
}

export function buildCandidateReport(root) {
  const reviewFile = resolve(root, reviewPath), verificationFile = resolve(root, verificationPath), matrixFile = resolve(root, matrixPath);
  const review = read(reviewFile), verification = read(verificationFile), matrix = read(matrixFile);
  assert.equal(verification.verification, 'pass', 'adjudication verification did not pass');
  assert.equal(review.verdict, 'not-release-ready', 'current adjudication is not in the expected residual state');
  const candidate = review.sourceCandidate;
  assert(candidate && candidate.dirty === false, 'candidate is not clean');
  assert.equal(git(root, ['rev-parse', `${candidate.commit}^{tree}`]), candidate.tree, 'candidate tree differs');
  try { git(root, ['merge-base', '--is-ancestor', candidate.commit, 'HEAD']); }
  catch { assert.fail('candidate is not in current history'); }

  const gates = matrix.gates.map((gate) => {
    const row = {
      id: gate.id, phase: gate.phase, name: gate.name, input: gate.input, command: gate.command, oracle: gate.oracle,
      negative: gate.negative, evidence: gate.evidence, actor: gate.actor, automated: gate.automated,
      artifact: artifactFor(gate.id), skipBudget: 0, status: statusFor(gate.id, review.dimensions, verification),
    };
    for (const field of matrix.requiredGateFields) assert(row[field] !== undefined && row[field] !== null && row[field] !== '', `gate field missing: ${gate.id}.${field}`);
    assert.equal(row.skipBudget, 0, `unexpected skip budget: ${gate.id}`);
    assert(['pass', 'partial', 'stale', 'not-run', 'not-approved', 'fail', 'invalid'].includes(row.status), `invalid gate status: ${gate.id}`);
    return row;
  });
  assert.equal(gates.length, 14, 'mainline gate count differs');
  assert(gates.every((gate) => gate.command && gate.oracle && gate.negative && gate.artifact && gate.actor), 'mainline stage is incomplete');
  const historicalVerdicts = historicalPaths.map((path) => {
    assert(existsSync(resolve(root, path)), `historical verdict missing: ${path}`);
    return { path, sha256: sha256(readFileSync(resolve(root, path))), currentCandidate: false, historical: true, note: 'Preserved; not rewritten by the current candidate.' };
  });
  const productLocks = matrix.lockedBoundaries;
  for (const key of ['releaseApproved', 'liveReady', 'productApproved', 'defaultOn']) assert.equal(productLocks[key], false, `product lock changed: ${key}`);
  return {
    schemaVersion: 'AgentFirstCandidateReport/v1', taskId: 'TF-0596', driven_by: 'agent', actor: 'codex/agent-first-mainline-builder',
    recordedAt: '2026-10-31', candidate, adjudication: { review: reviewPath, verification: verificationPath, reportDigest: sha256(readFileSync(reviewFile)), verificationDigest: sha256(readFileSync(verificationFile)) },
    dimensions: review.dimensions, gates, productLocks, historicalVerdicts,
    verdict: review.verdict, nextGates: review.residuals, releaseApproved: productLocks.releaseApproved,
    claims: { realHuman: false, releaseApproved: productLocks.releaseApproved, distributionApproved: false, defaultOn: productLocks.defaultOn },
    limitations: ['Mainline status is not a release approval; G1 remains not-approved and D1 distribution is not-run.', 'Historical product-acceptance verdicts are retained by hash and are not promoted to current-candidate gates.', 'Agent quality remains partial: the current evidence uses a deterministic scripted provider, not a live-provider quality run.'],
  };
}

export function verifyCandidateReport(root, reportPath) {
  const report = read(resolve(root, reportPath));
  assert.equal(report.schemaVersion, 'AgentFirstCandidateReport/v1', 'invalid candidate report');
  assert.equal(report.driven_by, 'agent', 'candidate report must be agent-driven');
  assert.equal(report.gates.length, 14, 'candidate report gate count differs');
  assert(report.gates.every((gate) => gate.command && gate.oracle && gate.negative && gate.artifact && gate.actor && gate.skipBudget === 0), 'candidate report has an incomplete gate');
  const expected = buildCandidateReport(root);
  for (const key of ['candidate', 'adjudication', 'dimensions', 'gates', 'productLocks', 'historicalVerdicts', 'verdict', 'nextGates', 'releaseApproved', 'claims']) assert.deepEqual(report[key], expected[key], `candidate report differs: ${key}`);
  return { schemaVersion: 'AgentFirstCandidateReportVerification/v1', verification: 'pass', candidate: report.candidate, gates: report.gates.length, verdict: report.verdict, productLocks: report.productLocks, reportDigest: sha256(readFileSync(resolve(root, reportPath))) };
}

if (isMainEntrypoint(import.meta.url)) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { out: { type: 'string' }, report: { type: 'string' }, root: { type: 'string' } } });
  try {
    const root = resolve(values.root ?? resolve(import.meta.dirname, '..'));
    if (positionals[0] === 'build') {
      const report = buildCandidateReport(root); const out = resolve(values.out ?? 'harness/specs/fixtures/agent-first-system/mainline/candidate-report.v1.json');
      mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, JSON.stringify(report, null, 2) + '\n', 'utf8'); console.log(JSON.stringify({ verdict: report.verdict, gates: report.gates.length, out }));
    } else if (positionals[0] === 'verify') {
      if (!values.report) throw new Error('--report is required');
      const result = verifyCandidateReport(root, values.report);
      if (values.out) { const out = resolve(values.out); mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, JSON.stringify(result, null, 2) + '\n', 'utf8'); }
      console.log(JSON.stringify(result));
    } else throw new Error('use build --out <report> or verify --report <report>');
  } catch (error) { console.error(error?.stack ?? String(error)); process.exitCode = 1; }
}
