#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { aggregateStabilitySamples, type StabilitySample } from './versegit-product-stability.mts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'harness/specs/fixtures/versegit-product-integration/f4');
const mode = process.argv.includes('--write') ? 'write' : process.argv.includes('--check') ? 'check' : null;
if (!mode) throw new Error('use --write or --check');
const sha = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex');
const readJson = (name: string): Record<string, any> => JSON.parse(readFileSync(join(OUT, name), 'utf8'));
const git = (args: string[]): string => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', windowsHide: true }).trim();

function inspect() {
  const issues: string[] = [];
  const flow = readJson('packaged-flow.json');
  const report = readJson('stability-report.json');
  const survivors = readJson('resource-survivors.json');
  const samples = readFileSync(join(OUT, 'stability-samples.jsonl'), 'utf8').trim().split(/\r?\n/u).map((line) => JSON.parse(line) as StabilitySample);
  const aggregate = aggregateStabilitySamples(samples);
  const source = { commit: git(['rev-parse', 'HEAD']), tree: git(['rev-parse', 'HEAD^{tree}']) };
  for (const [name, document] of [['packaged-flow', flow], ['stability-report', report], ['resource-survivors', survivors]] as const) {
    if (document.driven_by !== 'agent' || document.actor !== 'codex') issues.push(name + ': actor attribution is invalid');
    if (document.source?.commit !== source.commit || document.source?.tree !== source.tree || document.source?.dirty !== false) issues.push(name + ': source identity is stale or dirty');
  }
  if (samples.some((sample) => sample.driven_by !== 'agent' || sample.actor !== 'codex')) issues.push('raw samples contain invalid actor attribution');
  if (samples.length !== 10) issues.push('expected 10 raw task loops');
  if (aggregate.passed !== true) issues.push('raw sample aggregation did not pass');
  if (JSON.stringify(aggregate) !== JSON.stringify(report.aggregate)) issues.push('stored stability aggregate differs from raw samples');
  if (flow.coldStarts?.length !== 3 || flow.coldStarts.some((entry: any) => entry.status !== 'observed' || entry.hostInvokeOk !== true)) issues.push('three packaged cold starts were not observed');
  if (flow.noProviderSourceReference !== true) issues.push('packaged flow retained provider/debug path');
  if (flow.restartRecovery !== true || flow.activeInterruptionCleanup !== true) issues.push('restart or active interruption evidence is missing');
  if (flow.undoRecovered !== true || flow.revokedGrantRejected !== true) issues.push('undo or revoked-grant evidence is missing');
  if (survivors.passed !== true || survivors.totals?.processes !== 0 || survivors.totals?.managers !== 0 || survivors.totals?.worktrees !== 0 || survivors.totals?.tempRoots !== 0) issues.push('resource survivors are nonzero or unobserved');
  const f3 = JSON.parse(readFileSync(join(ROOT, 'harness/specs/fixtures/versegit-product-integration/f3/sidecar-package-manifest.json'), 'utf8'));
  if (flow.package?.artifactSha256 !== f3.package.artifact.sha256 || report.package?.artifactSha256 !== f3.package.artifact.sha256) issues.push('package identity differs from F3');
  const review = {
    schema: 'clawx.versegit.f4-independent-review/v1',
    driven_by: 'agent',
    actor: 'codex',
    reviewedAt: new Date().toISOString(),
    source,
    verdict: issues.length === 0 ? 'pass' : 'fail',
    priority: { p0: issues.length > 0 ? 1 : 0, p1: 0, p2: 0 },
    issues,
    criteria: [
      { id: 'packaged-layout-no-provider-source', passed: flow.noProviderSourceReference === true && flow.package?.artifactSha256 === f3.package.artifact.sha256, evidence: ['packaged-flow.json'] },
      { id: 'ten-closed-task-loops', passed: samples.length === 10 && aggregate.successes === 10 && aggregate.uniqueCandidateCount >= 10, evidence: ['stability-samples.jsonl', 'stability-report.json'] },
      { id: 'restart-and-interruption', passed: flow.restartRecovery === true && flow.activeInterruptionCleanup === true, evidence: ['packaged-flow.json'] },
      { id: 'revoked-and-undo', passed: flow.revokedGrantRejected === true && flow.undoRecovered === true, evidence: ['packaged-flow.json', 'stability-samples.jsonl'] },
      { id: 'resource-cleanup', passed: survivors.passed === true && Object.values(survivors.totals ?? {}).every((value) => value === 0), evidence: ['resource-survivors.json'] },
      { id: 'raw-metric-recomputation', passed: JSON.stringify(aggregate) === JSON.stringify(report.aggregate), evidence: ['stability-report.json', 'stability-samples.jsonl'] },
      { id: 'unmeasured-explicit', passed: report.coverage?.unmeasured?.length > 0, evidence: ['stability-report.json'] },
    ],
  };
  return { passed: issues.length === 0, issues, review };
}

function writeChecksums(): void {
  const files = readdirSync(OUT).filter((file) => file !== 'SHA256SUMS').sort();
  writeFileSync(join(OUT, 'SHA256SUMS'), files.map((file) => sha(readFileSync(join(OUT, file))) + '  ' + file).join('\n') + '\n', 'utf8');
}

function checkChecksums(): string[] {
  const path = join(OUT, 'SHA256SUMS');
  if (!existsSync(path)) return ['SHA256SUMS is missing'];
  const issues: string[] = [];
  const listed = new Set<string>();
  for (const line of readFileSync(path, 'utf8').trim().split(/\r?\n/u)) {
    const match = /^([a-f0-9]{64})  (.+)$/u.exec(line);
    if (!match) { issues.push('malformed checksum line'); continue; }
    listed.add(match[2]!);
    if (!existsSync(join(OUT, match[2]!)) || sha(readFileSync(join(OUT, match[2]!))) !== match[1]) issues.push('checksum mismatch: ' + match[2]);
  }
  for (const file of readdirSync(OUT).filter((name) => name !== 'SHA256SUMS')) if (!listed.has(file)) issues.push('unlisted retained file: ' + file);
  return issues;
}

const result = inspect();
if (mode === 'write') {
  writeFileSync(join(OUT, 'independent-review.json'), JSON.stringify(result.review, null, 2) + '\n', 'utf8');
  writeChecksums();
}
const finalIssues = [...result.issues, ...(mode === 'check' ? checkChecksums() : [])];
if (finalIssues.length > 0) {
  console.error(JSON.stringify({ ok: false, issues: finalIssues }, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ ok: true, mode, verdict: result.review.verdict, files: readdirSync(OUT).sort() }, null, 2));
}
