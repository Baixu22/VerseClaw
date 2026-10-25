#!/usr/bin/env node
// Independent WP9 verifier: replay checksum surfaces, rehash every retained
// acceptance input, validate whole-goal semantics and re-run WP6/WP8 gates.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainEntrypoint } from './lib/entrypoint.mjs';
import {
  WP9_EVIDENCE_MANIFEST_PATH,
  WP9_EVIDENCE_REPORT_PATH,
  WP9_EVIDENCE_SHA_PATH,
  WP9_EVIDENCE_SHA_PATHS,
  WP9_EXPECTED_ACCEPTANCE_IDS,
  WP9_ACCEPTANCE_EVIDENCE,
  WP9_FIXTURE_PATH,
  WP9_INDEPENDENT_REVIEW_PATH,
  WP9_INDEPENDENT_RESPONSE_PATH,
  WP9_MANIFEST_SCHEMA,
  WP9_PRIMARY_REVIEW_FAILURE_PATH,
  WP9_REPORT_PATH,
  WP9_SCHEMA,
  WP9_SHA_PATH,
  WP9_SHA_PATHS,
  documentDigest,
  sha256,
} from './versegit-wp9-global-acceptance.mjs';
import { verifyWp6Closeout } from './verify-versegit-wp6.mjs';
import { verifyWp8Artifact } from './verify-versegit-wp8.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WP8_P2_IDS = ['P2-evidence-snapshot-pairing', 'P2-bounded-validation', 'P2-historical-manifest'];
const WP6_RESIDUAL_IDS = [
  'live-verseShell-receipt',
  'conflicts-plan-seam',
  'partial-read-surfaces',
  'language-completeness',
  'non-windows-platforms',
  'release-package',
  'real-agent-invocation',
  'm4-recovery',
  'independent-final-review',
  'historical-planning-manifest',
  'verifier-shared-builder',
];

function readJson(path) {
  if (!existsSync(path)) throw new Error(`missing JSON: ${path}`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

function sameSet(left, right) {
  const a = [...new Set(left)].sort();
  const b = [...new Set(right)].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function sameArray(left, right) {
  return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => value === right[index]);
}

function add(issues, condition, message) {
  if (!condition) issues.push(message);
}

function verifyInputDigest(root, entry, issues, label) {
  if (typeof entry?.path !== 'string' || !/^[0-9a-f]{64}$/u.test(String(entry?.sha256 ?? ''))) {
    issues.push(`${label}: malformed input entry`);
    return;
  }
  const full = resolve(root, entry.path);
  if (!existsSync(full)) issues.push(`${label}: input missing ${entry.path}`);
  else if (sha256(readFileSync(full)) !== entry.sha256) issues.push(`${label}: input digest mismatch ${entry.path}`);
}

export function validateWp9Report(report, { root, fixture } = {}) {
  const issues = [];
  add(issues, report?.schema === WP9_SCHEMA, 'schema mismatch');
  add(issues, report?.driven_by === 'agent', 'report must be agent-driven');
  add(issues, report?.actor === 'codex', 'report actor mismatch');
  add(issues, report?.task === 'TF-0515' && report?.parentTask === 'TF-0465', 'task identity mismatch');
  add(issues, report?.globalVerdict === 'PASS_WITH_GAPS', 'global verdict must remain PASS_WITH_GAPS');
  add(issues, report?.passed === true, 'report must pass with retained gaps');
  add(issues, Array.isArray(report?.p0) && report.p0.length === 0, 'P0 findings must be zero');
  add(issues, Array.isArray(report?.p1) && report.p1.length === 0, 'P1 findings must be zero');
  add(issues, Array.isArray(report?.p2) && report.p2.length >= 3, 'P2 findings must remain explicit');
  add(issues, WP8_P2_IDS.every((id) => (report?.p2 ?? []).some((entry) => entry.id === id && entry.disposition === 'residual')), 'WP8 P2 residual set is incomplete');
  add(issues, Array.isArray(report?.issues) && report.issues.length === 0, 'report must contain no unresolved issue');

  const acceptance = Array.isArray(report?.acceptance) ? report.acceptance : [];
  add(issues, sameSet(acceptance.map((entry) => entry.id), WP9_EXPECTED_ACCEPTANCE_IDS), 'acceptance id set mismatch');
  for (const [index, entry] of acceptance.entries()) {
    add(issues, typeof entry?.criterion === 'string' && entry.criterion.length > 0, `${String(entry?.id)}: criterion missing`);
    add(issues, entry?.criterion === report?.taskForest?.parent?.acceptanceCriteria?.[index], `${String(entry?.id)}: criterion differs from Task Forest snapshot`);
    add(issues, ['verified', 'not_applicable', 'retired'].includes(entry?.status), `${String(entry?.id)}: invalid disposition`);
    add(issues, Array.isArray(entry?.evidence) && entry.evidence.length > 0, `${String(entry?.id)}: evidence missing`);
    add(issues, Array.isArray(entry?.assertions) && entry.assertions.length > 0 && entry.assertions.every((item) => item.passed === true), `${String(entry?.id)}: assertion failed`);
    const evidencePaths = new Set((entry?.evidence ?? []).map((input) => input?.path));
    const requiredPaths = (WP9_ACCEPTANCE_EVIDENCE[entry?.id] ?? []).map(([path]) => path.replaceAll('\\', '/'));
    add(issues, requiredPaths.length > 0 && requiredPaths.every((path) => evidencePaths.has(path)), `${String(entry?.id)}: evidence mapping drifted`);
    for (const input of entry?.evidence ?? []) {
      if (root) verifyInputDigest(root, input, issues, String(entry?.id));
      else add(issues, typeof input?.path === 'string' && /^[0-9a-f]{64}$/u.test(String(input?.sha256 ?? '')), `${String(entry?.id)}: malformed evidence`);
    }
  }
  const actualVerified = acceptance.filter((entry) => entry?.status === 'verified').length;
  const actualWithoutEvidence = acceptance.filter((entry) => !Array.isArray(entry?.evidence) || entry.evidence.length === 0).length;
  add(issues, report?.acceptanceSummary?.required === 7 && report?.acceptanceSummary?.verified === actualVerified && report?.acceptanceSummary?.withoutEvidence === actualWithoutEvidence && actualVerified === 7 && actualWithoutEvidence === 0, 'acceptance summary is incomplete or self-reported');

  const forest = report?.taskForest ?? {};
  add(issues, /^[0-9a-f]{64}$/u.test(String(forest.graphHash ?? '')), 'Task Forest graph hash missing');
  if (fixture) {
    add(issues, forest.graphHash === fixture.graphHash, 'Task Forest graph hash differs from fixture');
    add(issues, sameArray(forest.parent?.acceptanceCriteria, fixture.parent?.acceptanceCriteria), 'Task Forest acceptance criteria differ from fixture');
    add(issues, sameArray(acceptance.map((entry) => entry.criterion), fixture.parent?.acceptanceCriteria), 'acceptance criterion text differs from fixture');
  }
  add(issues, ['ready', 'in_progress', 'done'].includes(forest?.self?.status), 'self node status is illegal');
  add(issues, ['in_progress', 'done'].includes(forest?.parent?.status), 'parent node status is illegal');
  add(issues, forest?.expectedFinal?.self === 'done' && forest?.expectedFinal?.parent === 'done', 'expected final Task Forest status is missing');
  const children = Array.isArray(forest?.children) ? forest.children : [];
  const requiredChildren = children.filter((child) => child.self !== true);
  const selfChild = children.find((child) => child.self === true);
  add(issues, requiredChildren.length === 18, 'required child count must be 18 excluding WP9 self');
  add(issues, forest?.self?.id === 'TF-0515' && selfChild?.id === 'TF-0515' && selfChild?.status === forest?.self?.status, 'self snapshot contradiction');
  add(issues, requiredChildren.every((child) => child.status === 'done' || child.status === 'deprecated'), 'a required child is not done/deprecated');
  add(issues, (forest?.openChildren ?? []).length === 0 && (forest?.blockedChildren ?? []).length === 0, 'required child remains open or blocked');
  add(issues, (forest?.unresolvedDependencies ?? []).length === 0, 'blocking dependency remains unresolved');
  add(issues, report?.childGateSummary?.total === 18 && report?.childGateSummary?.done + report?.childGateSummary?.deprecated === 18, 'child gate summary mismatch');
  add(issues, (report?.childGateSummary?.openOrBlocked ?? []).length === 0 && (report?.childGateSummary?.unresolvedDependencies ?? []).length === 0, 'child gate summary contains blockers');

  add(issues, Array.isArray(report?.gateChecks) && report.gateChecks.length >= 4 && report.gateChecks.every((check) => check.passed === true), 'underlying gate verifier failed');
  add(issues, report?.review?.wp6?.passed === true && report?.review?.wp6?.verifierPassed === true, 'WP6 review gate missing');
  add(issues, ['PASS', 'PASS_WITH_GAPS'].includes(report?.review?.wp8?.verdict) && report?.review?.wp8?.p0 === 0 && report?.review?.wp8?.p1 === 0 && report?.review?.wp8?.verifierPassed === true, 'WP8 review gate is not passing');
  add(issues, /^[0-9a-f]{40}$/u.test(String(report?.review?.wp7Candidate?.commit ?? '')) && /^[0-9a-f]{40}$/u.test(String(report?.review?.wp7Candidate?.tree ?? '')), 'WP7 candidate identity missing');
  add(issues, report?.review?.wp7Candidate?.commit === report?.review?.wp7Candidate?.fixtureCommit && report?.review?.wp7Candidate?.tree === report?.review?.wp7Candidate?.fixtureTree, 'WP7 candidate differs from fixture');
  add(issues, report?.review?.wp9?.actor === 'ccs-hub/gpt-6.1-sol' && report?.review?.wp9?.verdict === 'PASS_WITH_GAPS', 'WP9 independent review identity/verdict mismatch');
  add(issues, report?.review?.wp9?.p0 === 0 && report?.review?.wp9?.p1 === 0 && report?.review?.wp9?.p2 === 3 && report?.review?.wp9?.passed === true, 'WP9 independent review findings mismatch');
  add(issues, /^[0-9a-f]{40}$/u.test(String(report?.review?.wp9?.reviewedImplementationCommit ?? '')) && report?.review?.wp9?.reviewedCommitResolvable === true, 'WP9 independent review candidate is not resolvable');

  const authority = report?.authority ?? {};
  for (const key of ['humanEvidence', 'realHumanEvidenceClaimed', 'singleGreenLight', 'defaultOn', 'ga', 'releaseEligible', 'm4Authorized']) {
    add(issues, authority[key] === false, `authority promotion: ${key}`);
  }
  const lifecycle = report?.lifecycle ?? {};
  for (const key of ['m4Authorized', 'externalModelSessionObserved', 'realHumanEvidenceClaimed', 'singleSourceOfTruthReplaced', 'defaultOn', 'ga', 'releaseEligible', 'singleGreenLight']) {
    add(issues, lifecycle[key] === false, `lifecycle promotion: ${key}`);
  }
  add(issues, lifecycle.m3ProductComplete === false && lifecycle.m3BoundedHostSliceObserved === true, 'bounded M3 lifecycle posture drifted');
  add(issues, report?.residualDisposition === 'retain', 'residual disposition must remain retained');
  for (const id of [...WP8_P2_IDS, ...WP6_RESIDUAL_IDS]) {
    add(issues, (report?.residuals ?? []).some((entry) => entry.id === id), `residual missing: ${id}`);
  }
  for (const key of Object.keys(report?.boundaries ?? {})) add(issues, report.boundaries[key] === true, `boundary was removed: ${key}`);
  add(issues, Object.keys(report?.boundaries ?? {}).length >= 10, 'boundary set is incomplete');
  add(issues, report?.closeout?.preconditionsPassed === true && report?.closeout?.proposalRequired === true, 'closeout contract drifted');
  add(issues, /^[0-9a-f]{64}$/u.test(String(report?.fixtureDigest ?? '')), 'fixture digest missing');

  const inputs = Array.isArray(report?.inputs) ? report.inputs : [];
  add(issues, inputs.length >= 20, 'global input inventory is incomplete');
  add(issues, new Set(inputs.map((entry) => entry.path)).size === inputs.length, 'global input inventory has duplicates');
  for (const input of inputs) {
    if (root) verifyInputDigest(root, input, issues, 'input');
    else add(issues, typeof input?.path === 'string' && /^[0-9a-f]{64}$/u.test(String(input?.sha256 ?? '')), 'malformed global input');
  }
  if (report?.digest !== documentDigest(report)) issues.push('report digest is not reproducible');
  return { ok: issues.length === 0, issues: [...new Set(issues)] };
}

export function verifyShaManifest({ root = repositoryRoot, path, expectedPaths }) {
  const full = resolve(root, path);
  if (!existsSync(full)) return { ok: false, issues: [`SHA256SUMS missing: ${path}`] };
  const issues = [];
  const entries = new Map();
  for (const [index, line] of readFileSync(full, 'utf8').split('\n').filter(Boolean).entries()) {
    const match = /^([0-9a-f]{64})  (.+)$/u.exec(line);
    if (!match) {
      issues.push(`SHA256SUMS line ${index + 1} malformed`);
      continue;
    }
    if (entries.has(match[2])) issues.push(`SHA256SUMS duplicate: ${match[2]}`);
    entries.set(match[2], match[1]);
  }
  if (!sameSet([...entries.keys()], expectedPaths)) issues.push('SHA256SUMS path set mismatch');
  for (const [target, expected] of entries) {
    const targetPath = resolve(root, target);
    if (!existsSync(targetPath)) issues.push(`SHA256SUMS target missing: ${target}`);
    else if (sha256(readFileSync(targetPath)) !== expected) issues.push(`SHA256SUMS mismatch: ${target}`);
  }
  return { ok: issues.length === 0, issues };
}

function validateManifest(manifest, report, sha256Report) {
  const issues = [];
  add(issues, manifest?.schema === WP9_MANIFEST_SCHEMA, 'manifest schema mismatch');
  add(issues, manifest?.task === 'TF-0515' && manifest?.parentTask === 'TF-0465', 'manifest task mismatch');
  add(issues, manifest?.report?.path === WP9_REPORT_PATH && manifest?.report?.curatedPath === WP9_EVIDENCE_REPORT_PATH, 'manifest report paths mismatch');
  add(issues, manifest?.report?.sha256 === sha256Report, 'manifest report byte digest mismatch');
  add(issues, manifest?.report?.digest === report.digest, 'manifest report semantic digest mismatch');
  add(issues, manifest?.verdict?.globalVerdict === report.globalVerdict && manifest?.verdict?.passed === report.passed, 'manifest verdict mismatch');
  add(issues, manifest?.verdict?.p0 === 0 && manifest?.verdict?.p1 === 0 && manifest?.verdict?.p2 === report.p2.length, 'manifest finding counts mismatch');
  add(issues, manifest?.acceptance?.required === 7 && manifest?.acceptance?.verified === 7 && manifest?.acceptance?.withoutEvidence === 0, 'manifest acceptance mismatch');
  add(issues, manifest?.children?.total === 18 && manifest?.children?.done + manifest?.children?.deprecated === 18, 'manifest child summary mismatch');
  add(issues, manifest?.independentReview?.actor === report.review.wp9.actor && manifest?.independentReview?.verdict === report.review.wp9.verdict, 'manifest independent review identity mismatch');
  add(issues, manifest?.independentReview?.p0 === 0 && manifest?.independentReview?.p1 === 0 && manifest?.independentReview?.p2 === report.p2.length && manifest?.independentReview?.passed === true, 'manifest independent review findings mismatch');
  add(issues, manifest?.independentReview?.reviewedImplementationCommit === report.review.wp9.reviewedImplementationCommit, 'manifest independent review candidate mismatch');
  add(issues, manifest?.authority?.humanEvidence === false && manifest?.authority?.ga === false && manifest?.authority?.releaseEligible === false && manifest?.authority?.m4Authorized === false, 'manifest authority promoted');
  add(issues, manifest?.residualDisposition === 'retain' && manifest?.residualCount === report.residuals.length, 'manifest residual disposition mismatch');
  add(issues, manifest?.graphHash === report.taskForest.graphHash && manifest?.fixtureDigest === report.fixtureDigest, 'manifest graph/fixture identity mismatch');
  add(issues, manifest?.digest === documentDigest(manifest), 'manifest digest is not reproducible');
  return issues;
}

export function verifyWp9Artifacts({ artifact, root = repositoryRoot } = {}) {
  const artifactReportPath = artifact ? resolve(root, artifact) : resolve(root, WP9_REPORT_PATH);
  const storedReportPath = existsSync(artifactReportPath) ? artifactReportPath : resolve(root, WP9_EVIDENCE_REPORT_PATH);
  const reportBytes = readFileSync(storedReportPath);
  const report = JSON.parse(reportBytes.toString('utf8'));
  const fixture = readJson(resolve(root, WP9_FIXTURE_PATH));
  const issues = validateWp9Report(report, { root, fixture }).issues.slice();
  const independentReview = readJson(resolve(root, WP9_INDEPENDENT_REVIEW_PATH));
  const independentResponse = readFileSync(resolve(root, WP9_INDEPENDENT_RESPONSE_PATH), 'utf8');
  const primaryFailure = readFileSync(resolve(root, WP9_PRIMARY_REVIEW_FAILURE_PATH), 'utf8');
  add(issues, independentReview.schema === 'clawx.versegit.wp9-independent-review/v1', 'independent review schema mismatch');
  add(issues, independentReview.actor === report.review.wp9.actor && independentReview.verdict === report.review.wp9.verdict, 'independent review identity mismatch');
  add(issues, independentReview.reviewedImplementationCommit === fixture.wp9ImplementationCommit && independentReview.reviewedImplementationCommit === report.review.wp9.reviewedImplementationCommit, 'independent review candidate mismatch');
  add(issues, independentReview.passed === true && (independentReview.p0 ?? []).length === 0 && (independentReview.p1 ?? []).length === 0 && (independentReview.p2 ?? []).length === 3, 'independent review is not a passing bounded verdict');
  add(issues, independentReview.reviewerProviderFailure?.model === 'ccs-agentrouter/gpt-6.1-sol' && independentReview.reviewerProviderFailure?.httpStatus === 403 && independentReview.reviewerProviderFailure?.verdictCreated === false, 'primary reviewer failure provenance mismatch');
  add(issues, independentResponse.includes(String(fixture.wp9ImplementationCommit)) && independentResponse.includes('PASS_WITH_GAPS') && independentResponse.includes('P0=0') && independentResponse.includes('P1=0'), 'raw independent response is not bound to the reviewed candidate');
  add(issues, primaryFailure.includes('ccs-agentrouter/gpt-6.1-sol') && /403/u.test(primaryFailure) && /quota/u.test(primaryFailure), 'primary reviewer failure file is incomplete');
  if (report.fixtureDigest !== sha256(readFileSync(resolve(root, WP9_FIXTURE_PATH)))) issues.push('fixture digest mismatch');
  if (report.taskForest.graphHash !== fixture.graphHash) issues.push('graph hash differs from fixture');
  if (!sameArray(report.taskForest.parent?.acceptanceCriteria, fixture.parent?.acceptanceCriteria)) issues.push('Task Forest acceptance criteria differ from fixture');
  if (!sameArray(report.acceptance.map((entry) => entry.criterion), fixture.parent?.acceptanceCriteria)) issues.push('acceptance criterion text differs from fixture');
  if (!sameSet(report.taskForest.children.map((child) => child.id), fixture.children.map((child) => child.id))) issues.push('Task Forest snapshot child set differs from fixture');
  if (!sameSet(fixture.expectedAcceptanceIds, WP9_EXPECTED_ACCEPTANCE_IDS)) issues.push('fixture acceptance ids mismatch');
  if (fixture.wp8Reviewer !== report.review.wp8.actor) issues.push('WP8 reviewer differs from fixture');

  try {
    const commit = execFileSync('git', ['rev-parse', String(report.review.wp7Candidate.commit)], { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
    const tree = execFileSync('git', ['rev-parse', `${String(report.review.wp7Candidate.commit)}^{tree}`], { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
    if (commit !== report.review.wp7Candidate.commit) issues.push('candidate commit is not resolvable');
    if (tree !== report.review.wp7Candidate.tree) issues.push('candidate tree is not resolvable');
  } catch (error) {
    issues.push(`candidate resolution failed: ${String(error?.message ?? error).slice(0, 180)}`);
  }
  const wp6 = verifyWp6Closeout();
  const wp8 = verifyWp8Artifact();
  if (!wp6.ok) issues.push(...wp6.issues.map((issue) => `WP6 verifier: ${issue}`));
  if (!wp8.ok) issues.push(...wp8.issues.map((issue) => `WP8 verifier: ${issue}`));

  const curatedReportPath = resolve(root, WP9_EVIDENCE_REPORT_PATH);
  if (!existsSync(curatedReportPath)) issues.push('curated WP9 report missing');
  else if (sha256(readFileSync(curatedReportPath)) !== sha256(reportBytes)) issues.push('curated WP9 report differs from artifact');
  const manifestPath = existsSync(artifactReportPath) ? resolve(dirname(artifactReportPath), 'manifest.json') : resolve(root, WP9_EVIDENCE_MANIFEST_PATH);
  const manifest = readJson(manifestPath);
  issues.push(...validateManifest(manifest, report, sha256(reportBytes)));
  const curatedManifestPath = resolve(root, WP9_EVIDENCE_MANIFEST_PATH);
  if (!existsSync(curatedManifestPath)) issues.push('curated WP9 manifest missing');
  else if (sha256(readFileSync(curatedManifestPath)) !== sha256(readFileSync(manifestPath))) issues.push('curated WP9 manifest differs from artifact');

  issues.push(...verifyShaManifest({ root, path: WP9_EVIDENCE_SHA_PATH, expectedPaths: WP9_EVIDENCE_SHA_PATHS }).issues.map((issue) => `curated: ${issue}`));
  if (existsSync(resolve(root, WP9_REPORT_PATH))) issues.push(...verifyShaManifest({ root, path: WP9_SHA_PATH, expectedPaths: WP9_SHA_PATHS }).issues.map((issue) => `artifact: ${issue}`));
  return { ok: issues.length === 0, issues: [...new Set(issues)], report, manifest };
}

function main() {
  const index = process.argv.indexOf('--artifact');
  const result = verifyWp9Artifacts({ artifact: index >= 0 ? process.argv[index + 1] : undefined });
  if (!result.ok) {
    for (const issue of result.issues) console.error(`[versegit-wp9-verify] FAIL: ${issue}`);
    process.exitCode = 1;
    return;
  }
  console.log(`[versegit-wp9-verify] OK verdict=${result.report.globalVerdict} acceptance=${result.report.acceptanceSummary.verified}/7 children=${result.report.childGateSummary.total} p2=${result.report.p2.length} candidate=${result.report.review.wp7Candidate.commit.slice(0, 12)}`);
}

if (isMainEntrypoint(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`[versegit-wp9-verify] FAIL: ${String(error?.stack ?? error)}`);
    process.exitCode = 1;
  }
}
