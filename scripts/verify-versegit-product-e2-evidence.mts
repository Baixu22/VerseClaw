#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = 'harness/specs/fixtures/versegit-product-integration/e2';
const PATHS = {
  plans: `${OUT}/plans.json`,
  receipts: `${OUT}/execution-receipts.json`,
  negative: `${OUT}/receipt-negative.json`,
  cleanup: `${OUT}/execution-cleanup.json`,
  independent: `${OUT}/independent-review.json`,
  sums: `${OUT}/SHA256SUMS`,
};
const REQUIRED_CASES = [
  'missing-observation', 'fake-self-reported', 'wrong-candidate', 'old-epoch',
  'input-drift', 'revoked-grant', 'partial-scope', 'tampered-artifact',
].sort();

function sha(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [key, stable((value as Record<string, unknown>)[key])]));
  }
  return value;
}
function digest(document: Record<string, unknown>): string {
  return sha(JSON.stringify(stable({ ...document, generated_at: undefined, digest: undefined })));
}
function readJson(path: string): Record<string, any> {
  return JSON.parse(readFileSync(resolve(ROOT, path), 'utf8')) as Record<string, any>;
}
function leakCount(value: unknown): number {
  return (JSON.stringify(value).match(/[A-Za-z]:[\\/]/gu) ?? []).length;
}
function sign(document: Record<string, any>): Record<string, any> {
  const copy = { ...document };
  delete copy.digest;
  copy.digest = digest(copy);
  return copy;
}
function buildReview(generatedAt: string): Record<string, any> {
  const plans = readJson(PATHS.plans);
  const receipts = readJson(PATHS.receipts);
  const negative = readJson(PATHS.negative);
  const cleanup = readJson(PATHS.cleanup);
  const checks: Array<{ id: string; passed: boolean; issues: string[] }> = [];

  const planIssues: string[] = [];
  if (plans.passed !== true) planIssues.push('plans document is not passed');
  if (plans.digest !== digest(plans)) planIssues.push('plans digest is not reproducible');
  if (leakCount(plans) > 0) planIssues.push('plans contain an absolute host path');
  if (!Array.isArray(plans.runs) || plans.runs.length !== 2) planIssues.push('exactly two plan runs are required');
  if (JSON.stringify(plans.required_tests) !== JSON.stringify(['producer-api', 'consumer-a', 'consumer-b-rework', 'required-env'])) planIssues.push('requiredTests list drifted');
  for (const run of plans.runs ?? []) {
    const plan = run.plan ?? {};
    if (plan.evidenceVersion !== 2 || plan.requiredScope !== 'full') planIssues.push(`${run.id}: plan is not full evidenceVersion 2`);
    if (!Array.isArray(plan.requiredChecks) || !plan.requiredChecks.includes('consumer-b-rework')) planIssues.push(`${run.id}: required checks are incomplete`);
    if (!/^[a-f0-9]{64}$/u.test(String(plan.planDigest ?? ''))) planIssues.push(`${run.id}: plan digest is invalid`);
    if (!/^[a-f0-9]{64}$/u.test(String(run.candidate?.candidateId ?? ''))) planIssues.push(`${run.id}: candidate identity is invalid`);
    if (!/^[a-f0-9]{64}$/u.test(String(run.candidate?.inputDigest ?? ''))) planIssues.push(`${run.id}: candidate input digest is invalid`);
    if (JSON.stringify(plan.commands?.[0]?.argv) !== JSON.stringify(['node', 'verify.cjs'])) planIssues.push(`${run.id}: fixed argv drifted`);
    if (plan.commands?.[0]?.cwd !== '.') planIssues.push(`${run.id}: fixed cwd drifted`);
    if (plan.commands?.[0]?.env?.CLAWX_VG_REQUIRED_SCOPE !== 'full') planIssues.push(`${run.id}: required environment is missing`);
    if (plan.commands?.[0]?.timeoutMs !== 30_000 || plan.commands?.[0]?.maxOutputBytes !== 262_144) planIssues.push(`${run.id}: output or deadline bound drifted`);
  }
  const failed = plans.runs?.find((run: any) => run.id === 'failure');
  const continued = plans.runs?.find((run: any) => run.id === 'continuation');
  if (failed?.observed_checks?.ok !== false) planIssues.push('failure run did not retain failing required tests');
  if (continued?.observed_checks?.ok !== true) planIssues.push('continuation run did not pass required tests');
  if (plans.native_fallback_used !== false || plans.host_policy_approved !== true) planIssues.push('host policy boundary is invalid');
  checks.push({ id: 'plans', passed: planIssues.length === 0, issues: planIssues });

  const receiptIssues: string[] = [];
  if (receipts.passed !== true) receiptIssues.push('receipts document is not passed');
  if (receipts.digest !== digest(receipts)) receiptIssues.push('receipts digest is not reproducible');
  if (leakCount(receipts) > 0) receiptIssues.push('receipts contain an absolute host path');
  if (!Array.isArray(receipts.runs) || receipts.runs.length !== 2) receiptIssues.push('exactly two execution receipts are required');
  for (const run of receipts.runs ?? []) {
    const receipt = run.receipt ?? {};
    if (run.receipt_result?.status !== 'accepted') receiptIssues.push(`${run.run_id}: receipt was not accepted`);
    if (run.verdict?.status !== 'observed' || run.verdict?.realVerseshellExecution !== true) receiptIssues.push(`${run.run_id}: verdict is not direct observed evidence`);
    if (run.authority_replay?.ok !== true) receiptIssues.push(`${run.run_id}: authority replay did not pass`);
    if (receipt.planId !== run.plan_id || receipt.planDigest !== run.plan_digest) receiptIssues.push(`${run.run_id}: receipt plan binding drifted`);
    if (receipt.candidateId !== run.candidate_id || receipt.checkId !== run.check_id) receiptIssues.push(`${run.run_id}: receipt candidate or check binding drifted`);
    if (receipt.ownerId !== run.owner_id || receipt.epoch !== run.epoch) receiptIssues.push(`${run.run_id}: receipt owner or epoch binding drifted`);
    if (receipt.planFileDigest !== run.plan_ref?.digest) receiptIssues.push(`${run.run_id}: plan evidence digest binding drifted`);
    if (receipt.inputManifestDigest !== run.input_manifest_ref?.digest) receiptIssues.push(`${run.run_id}: input evidence digest binding drifted`);
    if (receipt.authorizationDigest !== run.authorization_ref?.digest) receiptIssues.push(`${run.run_id}: authorization evidence digest binding drifted`);
    if (receipt.cleanupEvidenceDigest !== run.cleanup_ref?.digest) receiptIssues.push(`${run.run_id}: cleanup evidence digest binding drifted`);
    if (!/^[a-f0-9]{64}$/u.test(String(receipt.authorizationDigest ?? ''))) receiptIssues.push(`${run.run_id}: authorization digest is missing`);
    if (!/^[a-f0-9]{64}$/u.test(String(receipt.cleanupEvidenceDigest ?? ''))) receiptIssues.push(`${run.run_id}: cleanup digest is missing`);
    if (!Array.isArray(receipt.artifactDigests) || !receipt.artifactDigests.includes(receipt.authorizationDigest) || !receipt.artifactDigests.includes(receipt.cleanupEvidenceDigest)) receiptIssues.push(`${run.run_id}: required artifacts are not bound`);
    if (run.observation?.approved_by_host !== true || run.observation?.op !== 'process.start') receiptIssues.push(`${run.run_id}: governed process observation is invalid`);
  }
  if (failed?.receipt?.exitCode === 0 || continued?.receipt?.exitCode !== 0) receiptIssues.push('failure/continuation exit ordering drifted');
  const boundary = receipts.failure_before_continuation ?? {};
  if (boundary.failure_receipt_retained_after_continuation !== true || boundary.failure_before_continuation !== true) receiptIssues.push('failure-before-continuation evidence is not ordered');
  if (boundary.candidate_ids_distinct !== true || boundary.observation_digests_distinct !== true) receiptIssues.push('failure and continuation identities are not distinct');
  if (boundary.main_writeback_performed !== false) receiptIssues.push('verification wrote back to main');
  const expectedBoundary = receipts.boundaries ?? {};
  if (expectedBoundary.real_human_evidence !== false || expectedBoundary.default_off !== true || expectedBoundary.m4_authorized !== false || expectedBoundary.vg_landing_authority !== false) receiptIssues.push('receipt boundary flags drifted');
  checks.push({ id: 'receipts', passed: receiptIssues.length === 0, issues: receiptIssues });

  const negativeIssues: string[] = [];
  if (negative.passed !== true) negativeIssues.push('negative document is not passed');
  if (negative.digest !== digest(negative)) negativeIssues.push('negative digest is not reproducible');
  if (leakCount(negative) > 0) negativeIssues.push('negative evidence contains an absolute host path');
  const present = (negative.cases ?? []).map((entry: any) => entry.id).sort();
  if (JSON.stringify(present) !== JSON.stringify(REQUIRED_CASES)) negativeIssues.push('required negative case set drifted');
  for (const entry of negative.cases ?? []) {
    if (entry.passed !== true || entry.actual?.reason === null) negativeIssues.push(`${entry.id}: negative case was not explained`);
    if (entry.id === 'missing-observation' && entry.actual?.reason !== 'host observation record is missing') negativeIssues.push('missing observation reason drifted');
    if (entry.id === 'revoked-grant' && entry.actual?.reason !== 'authorization is revoked') negativeIssues.push('revoked grant reason drifted');
    if (entry.id === 'partial-scope' && entry.actual?.reason !== 'plan scope is not full') negativeIssues.push('partial scope reason drifted');
    if (entry.id === 'tampered-artifact' && !String(entry.actual?.reason).includes('digest mismatch')) negativeIssues.push('tampered artifact reason drifted');
  }
  checks.push({ id: 'negative', passed: negativeIssues.length === 0, issues: negativeIssues });

  const cleanupIssues: string[] = [];
  if (cleanup.passed !== true) cleanupIssues.push('cleanup document is not passed');
  if (cleanup.digest !== digest(cleanup)) cleanupIssues.push('cleanup digest is not reproducible');
  if (leakCount(cleanup) > 0) cleanupIssues.push('cleanup evidence contains an absolute host path');
  if (!Array.isArray(cleanup.runs) || cleanup.runs.length !== 2) cleanupIssues.push('exactly two cleanup records are required');
  for (const run of cleanup.runs ?? []) {
    if (run.cleanup?.status !== 'clean' || run.cleanup?.processesDeleted !== true) cleanupIssues.push(`${run.run_id}: cleanup is not clean`);
    if (run.cleanup?.managerProcessSurvivors !== 0 || run.cleanup?.processSurvivors !== 0) cleanupIssues.push(`${run.run_id}: cleanup retained processes`);
    if (run.cleanup?.candidateWorktreeSurvivors !== 0 || run.cleanup?.verificationRootRemoved !== true) cleanupIssues.push(`${run.run_id}: cleanup retained verification resources`);
    if (!Array.isArray(run.cleanup?.deletionErrors) || run.cleanup.deletionErrors.length !== 0) cleanupIssues.push(`${run.run_id}: cleanup retained deletion errors`);
    const checksById = run.cleanup?.processInventory?.ownedPidChecks;
    if (!Array.isArray(checksById) || !checksById.every((entry: any) => entry.ok === true && entry.exists === false)) cleanupIssues.push(`${run.run_id}: managed PID exit checks failed`);
    if (run.managed_processes_exited !== true || run.candidate_worktree_removed !== true) cleanupIssues.push(`${run.run_id}: cleanup assertions failed`);
  }
  if (cleanup.main_workspace?.unchanged !== true || cleanup.main_workspace?.status !== '') cleanupIssues.push('main workspace changed');
  checks.push({ id: 'cleanup', passed: cleanupIssues.length === 0, issues: cleanupIssues });

  const sourceIssues: string[] = [];
  const source = plans.source;
  for (const document of [plans, receipts, negative, cleanup]) {
    if (document.driven_by !== 'agent' || document.actor !== 'codex') sourceIssues.push('agent actor labels drifted');
    if (document.source?.commit !== source?.commit || document.source?.tree !== source?.tree) sourceIssues.push('source identity differs across documents');
  }
  if (!/^[a-f0-9]{40,64}$/u.test(String(source?.commit ?? '')) || !/^[a-f0-9]{40,64}$/u.test(String(source?.tree ?? ''))) sourceIssues.push('source commit or tree is invalid');
  checks.push({ id: 'source-and-actor', passed: sourceIssues.length === 0, issues: sourceIssues });

  const passed = checks.every((check) => check.passed);
  return sign({
    schema: 'clawx.versegit.e2-independent-review/v1',
    generated_at: generatedAt,
    task: 'TF-0533',
    driven_by: 'agent',
    actor: 'codex',
    reviewer_role: 'independent-e2-verifier-process',
    status: passed ? 'passed' : 'failed',
    checks,
    evidence_digests: Object.fromEntries(Object.values(PATHS).filter((path) => path !== PATHS.independent && path !== PATHS.sums).map((path) => [path, sha(readFileSync(resolve(ROOT, path)))])),
    boundaries: {
      real_human_evidence: false,
      default_off: true,
      m4_authorized: false,
      host_authority: 'ClawX',
      vg_landing_authority: false,
      merge_performed: false,
    },
    passed,
  });
}
function writeSums(): void {
  const paths = [PATHS.plans, PATHS.receipts, PATHS.negative, PATHS.cleanup, PATHS.independent];
  writeFileSync(resolve(ROOT, PATHS.sums), `${paths.map((path) => `${sha(readFileSync(resolve(ROOT, path)))}  ${path}`).sort().join('\n')}\n`, 'utf8');
}
function checkSums(): string[] {
  const issues: string[] = [];
  const lines = readFileSync(resolve(ROOT, PATHS.sums), 'utf8').trim().split(/\r?\n/u).filter(Boolean);
  const expected = new Set([PATHS.plans, PATHS.receipts, PATHS.negative, PATHS.cleanup, PATHS.independent]);
  for (const line of lines) {
    const match = /^([a-f0-9]{64})  (.+)$/u.exec(line);
    if (!match) { issues.push('malformed SHA256SUMS line'); continue; }
    const [, expectedDigest, path] = match;
    if (!expected.delete(path)) issues.push(`unexpected SHA256SUMS path: ${path}`);
    if (sha(readFileSync(resolve(ROOT, path))) !== expectedDigest) issues.push(`SHA256SUMS mismatch: ${path}`);
  }
  if (expected.size > 0) issues.push(`SHA256SUMS missing: ${[...expected].join(', ')}`);
  return issues;
}
function main(): void {
  const check = process.argv.includes('--check');
  if (![PATHS.plans, PATHS.receipts, PATHS.negative, PATHS.cleanup].every((path) => existsSync(resolve(ROOT, path)))) throw new Error('E2 evidence inputs are incomplete');
  if (check) {
    const stored = readJson(PATHS.independent);
    const rebuilt = buildReview(stored.generated_at);
    const issues = [
      ...(stored.digest === digest(stored) ? [] : ['independent review digest is not reproducible']),
      ...(rebuilt.digest === stored.digest ? [] : ['independent review result drifted']),
      ...checkSums(),
    ];
    if (stored.status !== 'passed' || stored.passed !== true) issues.push('independent review did not pass');
    if (issues.length > 0) throw new Error(issues.join('; '));
    console.log('[versegit-e2-review] CHECK OK');
    return;
  }
  const review = buildReview(new Date().toISOString());
  writeFileSync(resolve(ROOT, PATHS.independent), `${JSON.stringify(review, null, 2)}\n`, 'utf8');
  writeSums();
  if (review.passed !== true) throw new Error(JSON.stringify(review.checks));
  console.log('[versegit-e2-review] WRITE OK');
}
try {
  main();
} catch (error) {
  console.error(`[versegit-e2-review] FAIL: ${String((error as Error)?.stack ?? error)}`);
  process.exitCode = 1;
}