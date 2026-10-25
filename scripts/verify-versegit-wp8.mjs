#!/usr/bin/env node
// WP8 verifier: check the independent reviewer identity/verdict, candidate identity,
// historical-review preservation and every retained input digest.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainEntrypoint } from './lib/entrypoint.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const WP8_SCHEMA = 'clawx.versegit.wp8-final-review/v1';
export const WP8_FIXTURE_PATH = 'harness/specs/fixtures/versegit-planning-correction/wp8-final-review-fixture.json';
export const WP8_ARTIFACT_PATH = 'artifacts/versegit/wp8/review-report.json';
export const WP8_EVIDENCE_PATH = 'harness/specs/fixtures/versegit-planning-correction/wp8-evidence/review-report.json';

const sha = (value) => createHash('sha256').update(value).digest('hex');
const digest = (document) => sha(JSON.stringify({ ...document, generated_at: undefined, digest: undefined }));

function readJson(path) {
  if (!existsSync(path)) throw new Error(`missing JSON: ${path}`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

function verifyInputs(report, issues) {
  if (!Array.isArray(report.inputs) || report.inputs.length < 8) issues.push('input digest list is incomplete');
  for (const entry of report.inputs ?? []) {
    if (typeof entry.path !== 'string' || !/^[0-9a-f]{64}$/u.test(String(entry.sha256 ?? ''))) {
      issues.push('input digest entry is malformed');
      continue;
    }
    const path = resolve(repositoryRoot, entry.path);
    if (!existsSync(path)) issues.push(`input missing: ${entry.path}`);
    else if (sha(readFileSync(path)) !== entry.sha256) issues.push(`input digest mismatch: ${entry.path}`);
  }
}

function verifySums(path) {
  if (!existsSync(path)) return [`SHA256SUMS missing: ${path}`];
  const issues = [];
  for (const [index, line] of readFileSync(path, 'utf8').split(String.fromCharCode(10)).filter(Boolean).entries()) {
    const match = /^([0-9a-f]{64})  (.+)$/u.exec(line);
    if (!match) { issues.push(`SHA256SUMS line ${index + 1} malformed`); continue; }
    const target = resolve(repositoryRoot, match[2]);
    if (!existsSync(target)) { issues.push(`SHA256SUMS target missing: ${match[2]}`); continue; }
    if (sha(readFileSync(target)) !== match[1]) issues.push(`SHA256SUMS mismatch: ${match[2]}`);
  }
  return issues;
}

export function validateWp8Report(report) {
  const issues = [];
  const add = (condition, message) => { if (!condition) issues.push(message); };
  add(report?.schema === WP8_SCHEMA, 'schema mismatch');
  add(report?.task === 'TF-0514', 'task mismatch');
  add(report?.driven_by === 'agent', 'review must be agent-driven');
  add(['ccs-agentrouter/gpt-6.1-sol', 'ccs-any/gpt-6.1-sol', 'ccs-hub/gpt-6.1-sol'].includes(String(report?.actor ?? '')), 'independent reviewer identity mismatch');
  add(['PASS', 'PASS_WITH_GAPS', 'FAIL'].includes(report?.verdict), 'invalid verdict');
  add(Array.isArray(report?.p0) && report.p0.length === 0, 'P0 findings must be zero');
  add(Array.isArray(report?.p1) && report.p1.length === 0, 'P1 findings must be zero');
  add(Array.isArray(report?.p2) && report.p2.length > 0, 'P2 residual findings must remain explicit');
  add(report?.verdict === 'PASS' || report?.verdict === 'PASS_WITH_GAPS', 'review did not pass');
  add(report?.candidate?.clean === true, 'review candidate is not clean');
  add(/^[0-9a-f]{40}$/u.test(String(report?.candidate?.commit ?? '')), 'candidate commit missing');
  add(/^[0-9a-f]{40}$/u.test(String(report?.candidate?.tree ?? '')), 'candidate tree missing');
  add(report?.historicalReview?.originalVerdict === 'FAIL', 'historical FAIL must be preserved');
  add(report?.historicalReview?.finalReviewCompleted === true, 'final independent review must be completed');
  add(report?.historicalReview?.historyRewritten === false, 'historical review may not be rewritten');
  add(report?.scope?.includesHostIntegration === true, 'review must cover host integration');
  add(report?.scope?.includesHistoricalPlanning === true, 'review must cover historical planning');
  for (const key of [
    'factAdapterBoundaryReviewed', 'eventToFactWiringReviewed', 'candidateInputBindingReviewed',
    'receiptAuthorityReviewed', 'cleanupBarrierReviewed',
  ]) add(report?.scope?.[key] === true, `review scope missing ${key}`);
  const closure = report?.initialReview?.closureEvidence ?? [];
  add(report?.initialReview?.verdict === 'FAIL', 'initial independent review FAIL must be retained');
  add(report?.initialReview?.historyRewritten === false, 'initial review history may not be rewritten');
  add(closure.length >= 5, 'five initial P1 findings must have explicit closure evidence');
  for (const id of ['P1-fact-authority', 'P1-event-wiring', 'P1-candidate-input', 'P1-receipt-authority', 'P1-cleanup-evidence']) {
    const entry = closure.find((candidate) => candidate.id === id);
    add(entry?.status === 'closed', `${id} is not closed`);
    add(Array.isArray(entry?.evidence) && entry.evidence.length > 0, `${id} closure evidence is missing`);
  }
  add(report?.authority?.humanEvidence === false, 'real-human evidence may not be claimed');
  add(report?.authority?.ga === false && report?.authority?.releaseEligible === false && report?.authority?.m4Authorized === false, 'review exceeded product authority');
  add(typeof report?.rawResponsePath === 'string' && existsSync(resolve(repositoryRoot, report.rawResponsePath)), 'raw reviewer response missing');
  if (report?.actor !== 'ccs-agentrouter/gpt-6.1-sol') {
    add(report?.primaryReviewer?.model === 'ccs-agentrouter/gpt-6.1-sol', 'fallback must retain the primary reviewer identity');
    add(report?.primaryReviewer?.providerFailure === true && report?.primaryReviewer?.httpStatus === 403, 'fallback must retain the primary provider failure');
    add(typeof report?.primaryReviewer?.evidencePath === 'string' && existsSync(resolve(repositoryRoot, report.primaryReviewer.evidencePath)), 'primary reviewer failure evidence is missing');
  }
  verifyInputs(report, issues);
  if (report?.digest !== digest(report)) issues.push('digest is not reproducible');
  return { ok: issues.length === 0, issues };
}

export function verifyWp8Artifact({ artifact } = {}) {
  const artifactPath = artifact ? resolve(repositoryRoot, artifact) : resolve(repositoryRoot, WP8_ARTIFACT_PATH);
  const storedPath = existsSync(artifactPath) ? artifactPath : resolve(repositoryRoot, WP8_EVIDENCE_PATH);
  const report = readJson(storedPath);
  const fixture = readJson(resolve(repositoryRoot, WP8_FIXTURE_PATH));
  const issues = [...validateWp8Report(report).issues];
  if (report.fixtureDigest !== sha(readFileSync(resolve(repositoryRoot, WP8_FIXTURE_PATH)))) issues.push('fixture digest mismatch');
  if (fixture.reviewerModel !== report.actor) issues.push('reviewer model does not match fixture');
  if (report.candidate?.commit !== fixture.candidateCommit) issues.push('candidate commit mismatch');
  if (report.candidate?.tree !== fixture.candidateTree) issues.push('candidate tree mismatch');
  try {
    const actualCommit = execFileSync('git', ['rev-parse', String(report.candidate.commit)], { cwd: repositoryRoot, encoding: 'utf8', windowsHide: true }).trim();
    const actualTree = execFileSync('git', ['rev-parse', `${String(report.candidate.commit)}^{tree}`], { cwd: repositoryRoot, encoding: 'utf8', windowsHide: true }).trim();
    if (actualCommit !== report.candidate.commit) issues.push('candidate commit is not resolvable');
    if (actualTree !== report.candidate.tree) issues.push('candidate tree differs from repository');
  } catch (error) {
    issues.push(`candidate git resolution failed: ${String(error?.message ?? error).slice(0, 200)}`);
  }
  const evidencePath = resolve(repositoryRoot, WP8_EVIDENCE_PATH);
  if (existsSync(evidencePath) && evidencePath !== storedPath && sha(readFileSync(evidencePath)) !== sha(readFileSync(storedPath))) issues.push('curated review report differs from artifact');
  issues.push(...verifySums(resolve(repositoryRoot, 'harness/specs/fixtures/versegit-planning-correction/wp8-evidence/SHA256SUMS')));
  if (existsSync(resolve(repositoryRoot, 'artifacts/versegit/wp8/SHA256SUMS'))) issues.push(...verifySums(resolve(repositoryRoot, 'artifacts/versegit/wp8/SHA256SUMS')));
  return { ok: issues.length === 0, issues: [...new Set(issues)], report };
}

function main() {
  const index = process.argv.indexOf('--artifact');
  const result = verifyWp8Artifact({ artifact: index >= 0 ? process.argv[index + 1] : undefined });
  if (!result.ok) {
    for (const issue of result.issues) console.error(`[versegit-wp8] FAIL: ${issue}`);
    process.exitCode = 1;
    return;
  }
  console.log(`[versegit-wp8] OK verdict=${result.report.verdict} p0=0 p1=0 p2=${result.report.p2.length} candidate=${result.report.candidate.commit.slice(0, 12)}`);
}

if (isMainEntrypoint(import.meta.url)) {
  try { main(); } catch (error) {
    console.error(`[versegit-wp8] FAIL: ${String(error?.stack ?? error)}`);
    process.exitCode = 1;
  }
}
