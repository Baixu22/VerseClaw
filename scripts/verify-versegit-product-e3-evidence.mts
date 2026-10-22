#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = 'harness/specs/fixtures/versegit-product-integration/e3';
const PATHS = {
  apply: OUT + '/apply-decision.json',
  ordering: OUT + '/ordering-trace.json',
  toctou: OUT + '/toctou-negative.json',
  journal: OUT + '/write-journal-index.json',
  independent: OUT + '/independent-review.json',
  sums: OUT + '/SHA256SUMS',
};
const REQUIRED_CASES = ['target-uncommitted', 'candidate-drift', 'base-head', 'epoch', 'revoked'].sort();
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
function readJson(path: string): Record<string, any> {
  return JSON.parse(readFileSync(resolve(ROOT, path), 'utf8')) as Record<string, any>;
}
function leaks(value: unknown): number {
  return (JSON.stringify(value).match(/[A-Za-z]:[\\/]/gu) ?? []).length;
}
function sign(document: Record<string, any>): Record<string, any> {
  const copy = { ...document };
  delete copy.digest;
  copy.digest = digest(copy);
  return copy;
}
function buildReview(generatedAt: string): Record<string, any> {
  const apply = readJson(PATHS.apply);
  const ordering = readJson(PATHS.ordering);
  const toctou = readJson(PATHS.toctou);
  const journal = readJson(PATHS.journal);
  const checks: Array<{ id: string; passed: boolean; issues: string[] }> = [];

  const applyIssues: string[] = [];
  if (apply.digest !== digest(apply)) applyIssues.push('apply decision digest is not reproducible');
  if (leaks(apply) > 0) applyIssues.push('apply decision contains an absolute host path');
  if (apply.driven_by !== 'agent' || apply.actor !== 'codex') applyIssues.push('apply actor labels drifted');
  if (apply.individual_workers?.length !== 2 || !apply.individual_workers.every((worker: any) => worker.verdict === 'passed')) applyIssues.push('individual workers did not both pass');
  if (apply.combined_failure?.status !== 'verification-failed' || apply.combined_failure?.main_unchanged !== true || apply.combined_failure?.first_write_started !== false) applyIssues.push('combined failure wrote back or was not blocked');
  if (apply.combined_success?.status !== 'applied' || apply.combined_success?.head_unchanged !== true || apply.combined_success?.refs_unchanged !== true) applyIssues.push('verified candidate apply boundary drifted');
  if (apply.permission_checkpoint?.permit?.allowed !== true || apply.permission_checkpoint?.permit?.permitId !== 'permit-e3') applyIssues.push('host permit is missing');
  if (apply.boundaries?.real_human_evidence !== false || apply.boundaries?.default_off !== true || apply.boundaries?.m4_authorized !== false || apply.boundaries?.vg_landing_authority !== false) applyIssues.push('boundary flags drifted');
  checks.push({ id: 'apply-decision', passed: applyIssues.length === 0, issues: applyIssues });

  const orderingIssues: string[] = [];
  if (ordering.digest !== digest(ordering)) orderingIssues.push('ordering digest is not reproducible');
  if (leaks(ordering) > 0) orderingIssues.push('ordering trace contains an absolute host path');
  const kinds = (ordering.events ?? []).map((event: any) => event.kind);
  const requiredKinds = ['verification-start', 'verification-passed', 'permit-granted', 'preflight-checked', 'first-write-started', 'write-completed', 'post-apply-verified'];
  for (const kind of requiredKinds) if (!kinds.includes(kind)) orderingIssues.push('missing trace event: ' + kind);
  if (!(ordering.verification_index < ordering.first_write_index && ordering.first_write_index < ordering.post_apply_index)) orderingIssues.push('verification did not precede first write');
  if (ordering.verification_before_first_write !== true || ordering.passed !== true) orderingIssues.push('ordering verdict is not passed');
  if (!Array.isArray(ordering.journal_snapshot_ids) || ordering.journal_snapshot_ids.length === 0) orderingIssues.push('journal snapshot identities are missing');
  checks.push({ id: 'ordering-trace', passed: orderingIssues.length === 0, issues: orderingIssues });

  const toctouIssues: string[] = [];
  if (toctou.digest !== digest(toctou)) toctouIssues.push('TOCTOU digest is not reproducible');
  if (leaks(toctou) > 0) toctouIssues.push('TOCTOU evidence contains an absolute host path');
  const cases = (toctou.cases ?? []).map((entry: any) => entry.id).sort();
  if (JSON.stringify(cases) !== JSON.stringify(REQUIRED_CASES)) toctouIssues.push('required TOCTOU case set drifted');
  for (const entry of toctou.cases ?? []) {
    if (entry.passed !== true || entry.status !== 'preflight-rejected' || entry.firstWriteStarted !== false) toctouIssues.push(entry.id + ': negative case did not fail before write');
  }
  checks.push({ id: 'toctou-negative', passed: toctouIssues.length === 0, issues: toctouIssues });

  const journalIssues: string[] = [];
  if (journal.digest !== digest(journal)) journalIssues.push('journal digest is not reproducible');
  if (leaks(journal) > 0) journalIssues.push('journal evidence contains an absolute host path');
  if (journal.journal_steps <= 0 || journal.snapshot_files?.length === 0) journalIssues.push('journal snapshots are missing');
  if (journal.undo?.errors?.length !== 0 || journal.recovery_restored_base !== true || journal.passed !== true) journalIssues.push('journal recovery did not restore base');
  if (!(journal.result_journals ?? []).every((entry: any) => entry.batchState === 'committed' && entry.undoable === true)) journalIssues.push('journal batch was not committed and undoable');
  checks.push({ id: 'write-journal', passed: journalIssues.length === 0, issues: journalIssues });

  const sourceIssues: string[] = [];
  for (const document of [apply, ordering, toctou, journal]) {
    if (document.source?.commit !== apply.source?.commit || document.source?.tree !== apply.source?.tree) sourceIssues.push('source identity differs');
  }
  if (!/^[a-f0-9]{40,64}$/u.test(String(apply.source?.commit ?? '')) || !/^[a-f0-9]{40,64}$/u.test(String(apply.source?.tree ?? ''))) sourceIssues.push('source identity is malformed');
  checks.push({ id: 'source-and-actor', passed: sourceIssues.length === 0, issues: sourceIssues });

  const passed = checks.every((check) => check.passed);
  return sign({
    schema: 'clawx.versegit.e3-independent-review/v1',
    generated_at: generatedAt,
    task: 'TF-0534',
    driven_by: 'agent',
    actor: 'codex',
    reviewer_role: 'independent-e3-verifier-process',
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
  const paths = [PATHS.apply, PATHS.ordering, PATHS.toctou, PATHS.journal, PATHS.independent];
  writeFileSync(resolve(ROOT, PATHS.sums), paths.map((path) => sha(readFileSync(resolve(ROOT, path))) + '  ' + path).sort().join('\n') + '\n', 'utf8');
}
function checkSums(): string[] {
  const issues: string[] = [];
  const expected = new Set([PATHS.apply, PATHS.ordering, PATHS.toctou, PATHS.journal, PATHS.independent]);
  for (const line of readFileSync(resolve(ROOT, PATHS.sums), 'utf8').trim().split(/\r?\n/u).filter(Boolean)) {
    const match = /^([a-f0-9]{64})  (.+)$/u.exec(line);
    if (!match) { issues.push('malformed SHA256SUMS line'); continue; }
    if (!expected.delete(match[2])) issues.push('unexpected SHA256SUMS path: ' + match[2]);
    if (sha(readFileSync(resolve(ROOT, match[2]))) !== match[1]) issues.push('SHA256SUMS mismatch: ' + match[2]);
  }
  if (expected.size > 0) issues.push('SHA256SUMS missing: ' + [...expected].join(', '));
  return issues;
}
function main(): void {
  const check = process.argv.includes('--check');
  if (![PATHS.apply, PATHS.ordering, PATHS.toctou, PATHS.journal].every((path) => existsSync(resolve(ROOT, path)))) throw new Error('E3 evidence inputs incomplete');
  if (check) {
    const stored = readJson(PATHS.independent);
    const rebuilt = buildReview(stored.generated_at);
    const issues = [
      ...(stored.digest === digest(stored) ? [] : ['independent digest is not reproducible']),
      ...(stored.digest === rebuilt.digest ? [] : ['independent review drifted']),
      ...checkSums(),
    ];
    if (stored.status !== 'passed' || stored.passed !== true) issues.push('independent review did not pass');
    if (issues.length > 0) throw new Error(issues.join('; '));
    console.log('[versegit-e3-review] CHECK OK');
    return;
  }
  const review = buildReview(new Date().toISOString());
  writeFileSync(resolve(ROOT, PATHS.independent), JSON.stringify(review, null, 2) + '\n', 'utf8');
  writeSums();
  if (review.passed !== true) throw new Error(JSON.stringify(review.checks));
  console.log('[versegit-e3-review] WRITE OK');
}
try { main(); } catch (error) { console.error('[versegit-e3-review] FAIL: ' + String((error as Error)?.stack ?? error)); process.exitCode = 1; }
