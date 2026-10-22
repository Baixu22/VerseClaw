#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = 'harness/specs/fixtures/versegit-product-integration/f1';
const PATHS = {
  contract: OUT + '/completion-contract.json',
  outcomes: OUT + '/persisted-outcomes.json',
  restart: OUT + '/restart-lifecycle.json',
  independent: OUT + '/independent-review.json',
  sums: OUT + '/SHA256SUMS',
};
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [key, stable((value as Record<string, unknown>)[key])]));
  return value;
}
function digest(document: Record<string, unknown>): string { return sha(JSON.stringify(stable({ ...document, generated_at: undefined, digest: undefined }))); }
function readJson(path: string): Record<string, any> { return JSON.parse(readFileSync(resolve(ROOT, path), 'utf8')) as Record<string, any>; }
function leaks(value: unknown): number { return (JSON.stringify(value).match(/[A-Za-z]:[\\/]/gu) ?? []).length; }
function sign(document: Record<string, any>): Record<string, any> {
  const copy = { ...document };
  delete copy.digest;
  copy.digest = digest(copy);
  return copy;
}
function buildReview(generatedAt: string): Record<string, any> {
  const contract = readJson(PATHS.contract);
  const outcomes = readJson(PATHS.outcomes);
  const restart = readJson(PATHS.restart);
  const checks: Array<{ id: string; passed: boolean; issues: string[] }> = [];
  const contractIssues: string[] = [];
  if (contract.digest !== digest(contract)) contractIssues.push('contract digest is not reproducible');
  if (leaks(contract) > 0) contractIssues.push('contract contains an absolute host path');
  if (contract.contract_version !== 'clawx.versegit.completion-contract/v1') contractIssues.push('contract version drifted');
  if (contract.mapping?.applied?.providerProjection !== 'host-completed' || contract.mapping?.applied?.providerLanded !== false) contractIssues.push('applied mapping drifted');
  if (contract.mapping?.not_applied?.providerProjection !== 'abandoned' || contract.mapping?.unknown?.providerProjection !== 'abandoned') contractIssues.push('non-applied mapping drifted');
  if (contract.mapping?.unknown?.recoveryRequired !== true || contract.mapping?.unknown?.activeSessionRisk !== false) contractIssues.push('unknown recovery/risk mapping drifted');
  if (contract.provider_semantics?.session_ended_means !== 'abandoned/non-landed' || contract.provider_semantics?.provider_landed !== false) contractIssues.push('provider landed semantics drifted');
  if (contract.boundaries?.real_human_evidence !== false || contract.boundaries?.default_off !== true || contract.boundaries?.m4_authorized !== false) contractIssues.push('contract boundaries drifted');
  checks.push({ id: 'completion-contract', passed: contractIssues.length === 0, issues: contractIssues });

  const outcomeIssues: string[] = [];
  if (outcomes.digest !== digest(outcomes)) outcomeIssues.push('outcomes digest is not reproducible');
  if (leaks(outcomes) > 0) outcomeIssues.push('outcomes contain an absolute host path');
  if (outcomes.outcomes?.applied?.host_outcome !== 'applied' || outcomes.outcomes?.applied?.provider_projection !== 'host-completed') outcomeIssues.push('applied outcome missing');
  if (outcomes.outcomes?.cancelled?.host_outcome !== 'not_applied' || outcomes.outcomes?.cancelled?.provider_projection !== 'abandoned') outcomeIssues.push('cancelled outcome missing');
  if (outcomes.outcomes?.unknown?.host_outcome !== 'unknown' || outcomes.outcomes?.unknown?.recovery_required !== true) outcomeIssues.push('unknown outcome missing');
  if (outcomes.duplicate?.status !== 'duplicate' || outcomes.duplicate?.reason !== 'duplicate_completion') outcomeIssues.push('duplicate completion was not idempotent');
  if (outcomes.late_epoch?.reason !== 'late_epoch' || outcomes.terminal_completion?.reason !== 'completion_terminal') outcomeIssues.push('late epoch or terminal completion drift was accepted');
  if (outcomes.legacy?.success?.legacyUnbound !== true || outcomes.legacy?.success?.host_outcome !== 'unknown') outcomeIssues.push('legacy success was promoted without identity');
  if (JSON.stringify(outcomes.active_risk_sessions) !== JSON.stringify(['active-session'])) outcomeIssues.push('active risk projection is polluted');
  checks.push({ id: 'persisted-outcomes', passed: outcomeIssues.length === 0, issues: outcomeIssues });

  const restartIssues: string[] = [];
  if (restart.digest !== digest(restart)) restartIssues.push('restart digest is not reproducible');
  if (leaks(restart) > 0) restartIssues.push('restart evidence contains an absolute host path');
  if (restart.restart_matched !== true || restart.persisted_fact_id !== restart.restarted_fact_id) restartIssues.push('restart did not reproduce fact identity');
  if (restart.duplicate_status !== 'duplicate') restartIssues.push('duplicate after restart was not idempotent');
  if (restart.implicit_recovery?.reason !== 'recovery_required') restartIssues.push('unknown completion became success implicitly');
  if (restart.explicit_recovery?.host_outcome !== 'applied' || restart.explicit_recovery?.provider_landed !== false) restartIssues.push('explicit recovery mapping drifted');
  if (restart.production_seam?.hostOutcome !== 'applied' && restart.production_seam?.host_outcome !== 'applied') restartIssues.push('production completion seam was not invoked');
  if (restart.provider_projection_after_restart !== 'host-completed' || restart.provider_landed !== false || restart.active_risk_after_restart !== false) restartIssues.push('post-restart provider projection drifted');
  checks.push({ id: 'restart-lifecycle', passed: restartIssues.length === 0, issues: restartIssues });

  const sourceIssues: string[] = [];
  for (const document of [contract, outcomes, restart]) {
    if (document.source?.commit !== contract.source?.commit || document.source?.tree !== contract.source?.tree) sourceIssues.push('source identity differs');
    if (document.driven_by !== 'agent' || document.actor !== 'codex') sourceIssues.push('actor labels drifted');
  }
  checks.push({ id: 'source-and-actor', passed: sourceIssues.length === 0, issues: sourceIssues });
  const passed = checks.every((check) => check.passed);
  return sign({
    schema: 'clawx.versegit.f1-independent-review/v1',
    generated_at: generatedAt,
    task: 'TF-0535',
    driven_by: 'agent',
    actor: 'codex',
    reviewer_role: 'independent-f1-verifier-process',
    status: passed ? 'passed' : 'failed',
    checks,
    evidence_digests: Object.fromEntries(Object.values(PATHS).filter((path) => path !== PATHS.independent && path !== PATHS.sums).map((path) => [path, sha(readFileSync(resolve(ROOT, path)))])),
    boundaries: { real_human_evidence: false, default_off: true, m4_authorized: false, provider_landed: false, vg_landing_authority: false },
    passed,
  });
}
function writeSums(): void {
  const paths = [PATHS.contract, PATHS.outcomes, PATHS.restart, PATHS.independent];
  writeFileSync(resolve(ROOT, PATHS.sums), paths.map((path) => sha(readFileSync(resolve(ROOT, path))) + '  ' + path).sort().join('\n') + '\n', 'utf8');
}
function checkSums(): string[] {
  const issues: string[] = [];
  const expected = new Set([PATHS.contract, PATHS.outcomes, PATHS.restart, PATHS.independent]);
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
  if (![PATHS.contract, PATHS.outcomes, PATHS.restart].every((path) => existsSync(resolve(ROOT, path)))) throw new Error('F1 evidence inputs incomplete');
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
    console.log('[versegit-f1-review] CHECK OK');
    return;
  }
  const review = buildReview(new Date().toISOString());
  writeFileSync(resolve(ROOT, PATHS.independent), JSON.stringify(review, null, 2) + '\n', 'utf8');
  writeSums();
  if (review.passed !== true) throw new Error(JSON.stringify(review.checks));
  console.log('[versegit-f1-review] WRITE OK');
}
try { main(); } catch (error) { console.error('[versegit-f1-review] FAIL: ' + String((error as Error)?.stack ?? error)); process.exitCode = 1; }
