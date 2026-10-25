#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = 'harness/specs/fixtures/versegit-product-integration/e3';
const REPORT_PATH = process.env.VERSEGIT_E3_REPORT_PATH?.trim();
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
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
function sign(document: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...document };
  delete copy.digest;
  copy.digest = digest(copy);
  return copy;
}
function writeJson(name: string, value: unknown): void {
  const path = resolve(ROOT, OUT, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', 'utf8');
}
if (!REPORT_PATH || !existsSync(REPORT_PATH)) throw new Error('VERSEGIT_E3_REPORT_PATH does not exist');
const rawBytes = readFileSync(REPORT_PATH);
const report = JSON.parse(rawBytes.toString('utf8')) as Record<string, any>;
const failures: string[] = [];
if (report.schema !== 'clawx.versegit.e3-probe-report/v1') failures.push('probe report schema mismatch');
if (report.driven_by !== 'agent' || report.actor !== 'codex') failures.push('probe actor labels are invalid');
if (report.source?.dirty !== false) failures.push('probe source was dirty');
if (report.individual_workers?.length !== 2 || !report.individual_workers.every((worker: any) => worker.verdict === 'passed')) failures.push('individual worker verification incomplete');
if (report.combined_failure?.status !== 'verification-failed' || report.combined_failure?.main_unchanged !== true || report.combined_failure?.first_write_started !== false) failures.push('combined failure did not stop before write');
if (report.combined_success?.status !== 'applied' || report.combined_success?.head_unchanged !== true || report.combined_success?.refs_unchanged !== true) failures.push('verified candidate apply did not pass');
if (report.ordering_trace?.verification_before_first_write !== true) failures.push('ordering trace is invalid');
if (report.toctou_negative?.cases?.length !== 5 || !report.toctou_negative.cases.every((entry: any) => entry.passed === true)) failures.push('TOCTOU matrix is incomplete');
if (report.write_journal?.recovery_restored_base !== true) failures.push('write journal recovery did not restore base');
if (report.boundaries?.real_human_evidence !== false || report.boundaries?.default_off !== true || report.boundaries?.m4_authorized !== false || report.boundaries?.vg_landing_authority !== false) failures.push('boundary flags drifted');
const rawReportDigest = sha(rawBytes);
const source = report.source;
const generatedAt = new Date().toISOString();
const applyDecision = sign({
  schema: 'clawx.versegit.e3-apply-decision/v1',
  generated_at: generatedAt,
  task: 'TF-0534',
  driven_by: 'agent',
  actor: 'codex',
  source,
  raw_report_digest: rawReportDigest,
  individual_workers: report.individual_workers,
  combined_failure: report.combined_failure,
  combined_success: report.combined_success,
  permission_checkpoint: {
    permit: report.combined_success.permit,
    decision: report.combined_success.decision,
    grant_status: 'active',
    final_authority_owner: 'openclaw_runtime.agents.stage4-capability-grant',
  },
  boundaries: report.boundaries,
  passed: failures.length === 0,
});
const orderingTrace = sign({
  schema: 'clawx.versegit.e3-ordering-trace/v1',
  generated_at: generatedAt,
  task: 'TF-0534',
  driven_by: 'agent',
  actor: 'codex',
  source,
  raw_report_digest: rawReportDigest,
  events: report.ordering_trace.events,
  verification_index: report.ordering_trace.verification_index,
  first_write_index: report.ordering_trace.first_write_index,
  post_apply_index: report.ordering_trace.post_apply_index,
  verification_before_first_write: report.ordering_trace.verification_before_first_write,
  journal_batch_ids: report.ordering_trace.journal_batch_ids,
  journal_snapshot_ids: report.ordering_trace.journal_snapshot_ids,
  passed: report.ordering_trace.passed === true && report.ordering_trace.verification_before_first_write === true,
});
const toctouNegative = sign({
  schema: 'clawx.versegit.e3-toctou-negative/v1',
  generated_at: generatedAt,
  task: 'TF-0534',
  driven_by: 'agent',
  actor: 'codex',
  source,
  raw_report_digest: rawReportDigest,
  cases: report.toctou_negative.cases,
  passed: report.toctou_negative.passed === true && report.toctou_negative.cases.length === 5,
});
const sanitizedUndo = Object.fromEntries(
  Object.entries(report.write_journal.undo ?? {}).filter(([key]) => key !== 'journalDir'),
);
const writeJournalIndex = sign({
  schema: 'clawx.versegit.e3-write-journal-index/v1',
  generated_at: generatedAt,
  task: 'TF-0534',
  driven_by: 'agent',
  actor: 'codex',
  source,
  raw_report_digest: rawReportDigest,
  result_journals: report.write_journal.result_journals,
  journal_steps: report.write_journal.journal_steps,
  snapshot_files: report.write_journal.snapshot_files,
  undo: sanitizedUndo,
  recovery_restored_base: report.write_journal.recovery_restored_base,
  passed: report.write_journal.passed === true && report.write_journal.recovery_restored_base === true,
});
const serialized = JSON.stringify([applyDecision, orderingTrace, toctouNegative, writeJournalIndex]);
if (/[A-Za-z]:[\\/]/u.test(serialized)) throw new Error('E3 curated evidence contains an absolute host path');
writeJson('apply-decision.json', applyDecision);
writeJson('ordering-trace.json', orderingTrace);
writeJson('toctou-negative.json', toctouNegative);
writeJson('write-journal-index.json', writeJournalIndex);
if (failures.length > 0) throw new Error(failures.join('; '));
console.log(JSON.stringify({ ok: true, rawReportDigest, combinedFailure: report.combined_failure.status, combinedSuccess: report.combined_success.status, toctou: report.toctou_negative.cases.length }));
