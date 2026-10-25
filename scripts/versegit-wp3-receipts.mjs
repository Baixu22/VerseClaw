#!/usr/bin/env node
// WP3 receipt bridge evidence: construct a fixed plan, bind structural VerseShell
// receipts and prove the rejection matrix without claiming a live execution.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isMainEntrypoint } from './lib/entrypoint.mjs';

const root = process.env.VERSEGIT_WP3_ROOT ? resolve(process.env.VERSEGIT_WP3_ROOT) : resolve(process.cwd());
export const WP3_SCHEMA = 'clawx.versegit.wp3-receipt-evidence/v1';
export const WP3_FIXTURE_PATH = 'harness/specs/fixtures/versegit-planning-correction/wp3-receipt-fixture.json';
function digest(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function readJson(path) { return JSON.parse(readFileSync(path, 'utf8')); }
async function loadBridge() { return import(pathToFileURL(resolve(root, 'electron/services/versegit-receipt-bridge.ts')).href); }
function baseReceipt(plan, bridge, receiptId) {
  const command = plan.commands[0];
  return {
    schema: bridge.VG_RECEIPT_SCHEMA,
    receiptId,
    planId: plan.runId,
    planDigest: plan.planDigest,
    candidateId: plan.candidateId,
    checkId: plan.checkId,
    ownerId: plan.owner,
    epoch: plan.epoch,
    authorizationId: plan.authorizationId,
    argvDigest: digest(command.argv),
    cwdDigest: digest(command.cwd),
    envDigest: digest(command.env),
    executionInputDigest: digest({ argv: command.argv, cwd: command.cwd, env: command.env }),
    requiredScope: 'full',
    artifactDigests: [digest('artifact:stdout')],
    cleanupStatus: 'clean',
    status: 'exited',
    exitCode: 0,
    signal: null,
    durationMs: 12,
    stdoutDigest: digest('stdout'),
    stderrDigest: digest('stderr'),
    processKey: 'process-wp3',
    authority: { writer: 'verseshell', trusted_source: 'clawx-host-process-artifact-authority' },
    origin: 'host-fixture',
    realVerseshell: false,
  };
}
export async function buildWp3Evidence({ root: evidenceRoot = root, fixturePath } = {}) {
  const fixture = readJson(fixturePath ?? resolve(evidenceRoot, WP3_FIXTURE_PATH));
  const bridge = await loadBridge();
  const created = bridge.createVerificationPlan(fixture.plan);
  if (!created.plan) throw new Error(`invalid fixture plan: ${created.issues.join('; ')}`);
  const plan = created.plan;
  const cases = [];
  const issues = [];
  for (const spec of fixture.cases ?? []) {
    const own = new bridge.VerseGitReceiptBridge();
    const planResult = own.registerPlan(plan);
    if (planResult.status !== 'accepted') throw new Error(`plan registration failed: ${planResult.issues.join('; ')}`);
    const receipt = baseReceipt(plan, bridge, `receipt-${spec.id}`);
    let result;
    if (spec.mutation === 'none') {
      result = own.receive(plan.runId, receipt);
    } else if (spec.mutation === 'wrong_candidate') {
      result = own.receive(plan.runId, { ...receipt, candidateId: 'wrong-candidate' });
    } else if (spec.mutation === 'stale_epoch') {
      result = own.receive(plan.runId, { ...receipt, epoch: 2 });
    } else if (spec.mutation === 'plan_digest_mismatch') {
      result = own.receive(plan.runId, { ...receipt, planDigest: 'f'.repeat(64) });
    } else if (spec.mutation === 'argv_digest_mismatch') {
      result = own.receive(plan.runId, { ...receipt, argvDigest: 'f'.repeat(64) });
    } else if (spec.mutation === 'missing_artifact') {
      result = own.receive(plan.runId, { ...receipt, artifactDigests: [] });
    } else if (spec.mutation === 'selected_scope_claimed_full') {
      result = own.receive(plan.runId, { ...receipt, requiredScope: 'selected', selected_scope: 'full' });
    } else if (spec.mutation === 'caller_self_report') {
      result = own.receive(plan.runId, { ...receipt, authority: { writer: 'caller', trusted_source: 'caller' } });
    } else if (spec.mutation === 'duplicate_receipt') {
      const first = own.receive(plan.runId, receipt);
      const second = own.receive(plan.runId, receipt);
      result = second.status === 'duplicate' ? second : first;
    } else if (spec.mutation === 'missing_receipt') {
      result = { status: 'rejected_by_policy', reason: 'missing_receipt', issues: ['no host receipt supplied'], hostVerdict: 'unchanged' };
    } else {
      result = { status: 'rejected_by_policy', reason: 'unknown_case', issues: [spec.mutation], hostVerdict: 'unchanged' };
    }
    const verdict = own.verdict(plan.runId);
    cases.push({ caseId: spec.id, mutation: spec.mutation, receiptResult: result, verdict, hostVerdict: 'unchanged' });
    if (result.status !== spec.expectedReceipt) issues.push(`${spec.id}: expected receipt ${spec.expectedReceipt}, got ${result.status}`);
    if (verdict.status !== spec.expectedVerdict) issues.push(`${spec.id}: expected verdict ${spec.expectedVerdict}, got ${verdict.status}`);
    if (verdict.hostVerdict !== 'unchanged' || verdict.singleGreenLight !== false) issues.push(`${spec.id}: verdict authority boundary failed`);
  }
  const valid = cases.find((entry) => entry.caseId === 'valid_structural_receipt');
  if (valid?.verdict?.realVerseshellExecution !== false || valid?.verdict?.dimensions?.execution !== 'unmeasured') issues.push('structural fixture must not claim live VerseShell execution');
  const report = {
    schema: WP3_SCHEMA, generated_at: new Date().toISOString(), driven_by: 'agent', actor: 'codex', task: 'TF-0469',
    fixture: WP3_FIXTURE_PATH, planDigest: plan.planDigest, plan, cases,
    summary: { caseCount: cases.length, accepted: cases.filter((entry) => entry.receiptResult.status === 'accepted').length, rejected: cases.filter((entry) => entry.receiptResult.status === 'rejected_by_policy').length, duplicate: cases.filter((entry) => entry.receiptResult.status === 'duplicate').length },
    realVerseshellExecutionClaimed: false,
    structuralOnly: true,
    boundaries: { secondExecutor: false, callerSelfReportAccepted: false, selectedScopeAsFull: false, hostVerdictChanged: false, providerSourceImported: false, rawSecretStored: false },
    hostVerdict: 'unchanged', issues, passed: issues.length === 0,
  };
  report.digest = digest({ ...report, generated_at: undefined, digest: undefined });
  return { fixture, plan, cases, report, issues };
}
export function validateWp3Report(report) {
  const issues = [];
  if (report?.schema !== WP3_SCHEMA || report?.task !== 'TF-0469') issues.push('WP3 schema/task mismatch');
  if (report?.driven_by !== 'agent' || report?.actor !== 'codex') issues.push('WP3 evidence must be agent-driven');
  if (!Array.isArray(report?.cases) || report.cases.length !== 10) issues.push('WP3 must cover ten receipt cases');
  const byId = new Map((report?.cases ?? []).map((entry) => [entry.caseId, entry]));
  if (byId.get('valid_structural_receipt')?.receiptResult?.status !== 'accepted') issues.push('valid structural receipt must be accepted');
  if (byId.get('valid_structural_receipt')?.verdict?.dimensions?.execution !== 'unmeasured') issues.push('structural receipt must not be promoted to live execution');
  for (const id of ['wrong_candidate', 'stale_epoch', 'plan_digest_mismatch', 'argv_digest_mismatch', 'missing_artifact', 'selected_scope_claimed_full', 'caller_self_report', 'missing_receipt']) {
    if (!byId.get(id) || byId.get(id).receiptResult?.status === 'accepted') issues.push(`${id} must be rejected`);
  }
  if (byId.get('duplicate_receipt')?.receiptResult?.status !== 'duplicate') issues.push('duplicate receipt must be rejected');
  if (report?.realVerseshellExecutionClaimed !== false || report?.structuralOnly !== true) issues.push('WP3 must state its structural-only boundary');
  if (report?.hostVerdict !== 'unchanged') issues.push('WP3 must leave host verdict unchanged');
  for (const key of ['secondExecutor', 'callerSelfReportAccepted', 'selectedScopeAsFull', 'hostVerdictChanged', 'providerSourceImported', 'rawSecretStored']) if (report?.boundaries?.[key] !== false) issues.push(`boundary ${key} must be false`);
  if (report?.passed !== true || (report?.issues ?? []).length !== 0) issues.push('WP3 report did not pass');
  if (report?.digest !== digest({ ...report, generated_at: undefined, digest: undefined })) issues.push('WP3 report digest is not reproducible');
  return { ok: issues.length === 0, issues };
}
export async function writeWp3Evidence({ root: evidenceRoot = root, output, fixturePath } = {}) {
  const built = await buildWp3Evidence({ root: evidenceRoot, fixturePath });
  const path = output ? resolve(output) : resolve(evidenceRoot, 'artifacts/versegit/wp3/verdict.json');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(built.report, null, 2)}\n`, 'utf8');
  return { ...built, path, validation: validateWp3Report(built.report) };
}
async function main() {
  const at = (flag) => { const index = process.argv.indexOf(flag); return index >= 0 ? resolve(process.argv[index + 1]) : undefined; };
  const result = await writeWp3Evidence({ fixturePath: at('--fixture'), output: at('--out') });
  console.log(JSON.stringify({ path: result.path, passed: result.report.passed, summary: result.report.summary, validation: result.validation }, null, 2));
  if (!result.validation.ok) process.exitCode = 1;
}
if (isMainEntrypoint(import.meta.url)) main().catch((error) => { console.error(String(error?.stack ?? error)); process.exitCode = 1; });