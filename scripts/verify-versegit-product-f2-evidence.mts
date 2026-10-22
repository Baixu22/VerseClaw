#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'harness/specs/fixtures/versegit-product-integration/f2');
const mode = process.argv.includes('--write') ? 'write' : process.argv.includes('--check') ? 'check' : null;
if (!mode) throw new Error('use --write or --check');
const sha = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex');
const readJson = (name: string): Record<string, any> => JSON.parse(readFileSync(join(OUT, name), 'utf8'));

function sourceState() {
  const git = (args: string[]) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', windowsHide: true }).trim();
  return {
    commit: git(['rev-parse', 'HEAD']),
    tree: git(['rev-parse', 'HEAD^{tree}']),
  };
}

function inspect(): { passed: boolean; issues: string[]; review: Record<string, unknown> } {
  const issues: string[] = [];
  const cleanup = readJson('cleanup-barrier.json');
  const inventory = readJson('resource-inventory.json');
  const recovery = readJson('recovery-required.json');
  const source = sourceState();
  for (const [name, document] of [['cleanup', cleanup], ['inventory', inventory], ['recovery', recovery]] as const) {
    if (document.driven_by !== 'agent' || document.actor !== 'codex') issues.push(`${name}: actor attribution is not agent/codex`);
    const documentSource = document.source?.before ?? document.source;
    if (documentSource?.commit !== source.commit || documentSource?.tree !== source.tree) issues.push(`${name}: source commit/tree is stale`);
  }
  if (cleanup.passed !== true) issues.push('cleanup-barrier evidence did not pass');
  if (!Array.isArray(cleanup.commands) || cleanup.commands.some((entry: any) => entry.exitCode !== 0)) issues.push('required command failed');
  if (cleanup.e2?.passed !== true) issues.push('Electron E2 did not pass');
  if (cleanup.events?.attached !== 3 || cleanup.events?.ended !== 3 || cleanup.events?.allAgentDriven !== true) issues.push('binding event inventory is incomplete');
  if (inventory.passed !== true || !Array.isArray(inventory.cases) || inventory.cases.length !== 3) issues.push('resource inventory is incomplete');
  if (inventory.cases?.some((entry: any) => entry.zeroSurvivors !== true)) issues.push('resource inventory reports survivors');
  if (recovery.passed !== true || !Array.isArray(recovery.cases)) issues.push('recovery-required evidence is incomplete');
  const requiredRecovery = new Set([
    'identity_mismatch_ownerId', 'identity_mismatch_epoch', 'identity_mismatch_authorizationId',
    'identity_mismatch_baseOid', 'identity_mismatch_refsDigest', 'stage_failure_stop_accepting',
    'stage_failure_drain_cancel', 'stage_failure_evidence', 'stage_failure_inventory',
    'survivor_recovery_required', 'late_event_after_delete',
  ]);
  for (const name of requiredRecovery) if (!recovery.cases.some((entry: any) => entry.case === name)) issues.push(`recovery case missing: ${name}`);
  const late = recovery.cases.find((entry: any) => entry.case === 'late_event_after_delete');
  if (!late || late.accepted !== false || late.status !== 'deleted' || late.sealStable !== true) issues.push('late event changed the sealed outcome');
  const survivor = recovery.cases.find((entry: any) => entry.case === 'survivor_recovery_required');
  if (!survivor || survivor.status !== 'recovery_required') issues.push('survivor did not produce recovery_required');
  const review = {
    schema: 'clawx.versegit.f2-independent-review/v1',
    driven_by: 'agent',
    actor: 'codex',
    reviewedAt: new Date().toISOString(),
    source,
    verdict: issues.length === 0 ? 'pass' : 'fail',
    priority: { p0: issues.length > 0 ? 1 : 0, p1: 0, p2: 0 },
    issues,
    criteria: [
      { id: 'single-barrier-all-delete-paths', passed: cleanup.passed === true && recovery.passed === true, evidence: ['cleanup-barrier.json', 'recovery-required.json'] },
      { id: 'identity-drift-blocks-delete', passed: recovery.cases.filter((entry: any) => entry.case.startsWith('identity_mismatch_')).every((entry: any) => entry.rejected === true), evidence: ['recovery-required.json'] },
      { id: 'stage-faults-preserve-resources', passed: recovery.cases.filter((entry: any) => entry.case.startsWith('stage_failure_')).every((entry: any) => entry.rejected === true), evidence: ['recovery-required.json'] },
      { id: 'late-event-does-not-revive', passed: late?.accepted === false && late?.status === 'deleted', evidence: ['recovery-required.json'] },
      { id: 'process-manager-worktree-temp-zero', passed: inventory.passed === true && inventory.cases.every((entry: any) => entry.zeroSurvivors === true), evidence: ['resource-inventory.json'] },
      { id: 'unobserved-not-zero', passed: recovery.cases.some((entry: any) => entry.case === 'stage_failure_inventory' && entry.rejected === true), evidence: ['recovery-required.json'] },
      { id: 'product-locks-unchanged', passed: cleanup.e2?.boundaries?.liveReady === false && cleanup.e2?.boundaries?.productApproved === false && cleanup.e2?.boundaries?.m4Authorized === false && cleanup.e2?.boundaries?.realHumanEvidence === false, evidence: ['cleanup-barrier.json'] },
    ],
  };
  return { passed: issues.length === 0, issues, review };
}

function writeChecksums(): void {
  const files = readdirSync(OUT).filter((name) => name !== 'SHA256SUMS').sort();
  const lines = files.map((name) => `${sha(readFileSync(join(OUT, name)))}  ${name}`);
  writeFileSync(join(OUT, 'SHA256SUMS'), `${lines.join('\n')}\n`, 'utf8');
}

function checkChecksums(): string[] {
  const path = join(OUT, 'SHA256SUMS');
  if (!existsSync(path)) return ['SHA256SUMS is missing'];
  const issues: string[] = [];
  for (const line of readFileSync(path, 'utf8').trim().split(/\r?\n/)) {
    if (!line.trim()) continue;
    const match = /^([a-f0-9]{64})  (.+)$/u.exec(line);
    if (!match) { issues.push(`malformed checksum line: ${line}`); continue; }
    const file = join(OUT, match[2]!);
    if (!existsSync(file)) { issues.push(`checksum target missing: ${match[2]}`); continue; }
    if (sha(readFileSync(file)) !== match[1]) issues.push(`checksum mismatch: ${match[2]}`);
  }
  const listed = new Set(readFileSync(path, 'utf8').trim().split(/\r?\n/).map((line) => line.split('  ')[1]).filter(Boolean));
  for (const file of readdirSync(OUT).filter((name) => name !== 'SHA256SUMS')) if (!listed.has(file)) issues.push(`unlisted retained file: ${file}`);
  return issues;
}

const result = inspect();
if (mode === 'write') {
  writeFileSync(join(OUT, 'independent-review.json'), `${JSON.stringify(result.review, null, 2)}\n`, 'utf8');
  writeChecksums();
}
const checksumIssues = mode === 'check' ? checkChecksums() : [];
const finalIssues = [...result.issues, ...checksumIssues];
if (finalIssues.length > 0) {
  console.error(JSON.stringify({ ok: false, issues: finalIssues }, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ ok: true, mode, verdict: result.review.verdict, files: readdirSync(OUT).sort() }, null, 2));
}
