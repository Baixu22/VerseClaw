#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = 'harness/specs/fixtures/versegit-product-integration/c1';
const PATHS = {
  bindings: `${OUT}/runtime-bindings.json`,
  events: `${OUT}/bridge-events.jsonl`,
  negative: `${OUT}/binding-negative.json`,
  independent: `${OUT}/independent-review.json`,
  sums: `${OUT}/SHA256SUMS`,
};

function sha(value: string | Uint8Array): string { return createHash('sha256').update(value).digest('hex'); }
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
function absoluteLeaks(value: unknown): number {
  return (JSON.stringify(value).match(/[A-Za-z]:[\\/]/gu) ?? []).length;
}
function readEvents(): Array<Record<string, any>> {
  return readFileSync(resolve(ROOT, PATHS.events), 'utf8').split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line));
}
function expectedKinds(events: Array<Record<string, any>>): Record<string, number> {
  const kinds = ['bind_requested', 'bound', 'bind_rejected', 'attach_requested', 'attached', 'attach_rejected', 'end_requested', 'ended', 'end_rejected'];
  return Object.fromEntries(kinds.map((kind) => [kind, events.filter((event) => event.kind === kind).length]));
}
function checkOrderedLifecycle(events: Array<Record<string, any>>): string[] {
  const issues: string[] = [];
  const bound = events.filter((event) => event.kind === 'bound' && typeof event.bindingId === 'string');
  const unique = [...new Map(bound.map((event) => [event.bindingId as string, event])).values()];
  let completed = 0;
  for (const boundEvent of unique) {
    const bindingId = boundEvent.bindingId as string;
    const index = events.indexOf(boundEvent);
    const attached = events.findIndex((event, candidateIndex) => candidateIndex > index && event.kind === 'attached' && event.bindingId === bindingId);
    const ended = events.findIndex((event, candidateIndex) => candidateIndex > attached && event.kind === 'ended' && event.bindingId === bindingId);
    if (attached < 0) issues.push(`binding ${bindingId} has no attached event`);
    if (ended < 0) issues.push(`binding ${bindingId} has no ended event`);
    if (attached >= 0 && ended > attached) completed += 1;
  }
  if (unique.length < 2) issues.push(`expected at least two unique bindings, got ${unique.length}`);
  if (completed < 2) issues.push(`expected at least two ordered bind-attach-end lifecycles, got ${completed}`);
  return issues;
}
function buildReview(generatedAt: string): Record<string, any> {
  const bindings = readJson(PATHS.bindings);
  const negative = readJson(PATHS.negative);
  const events = readEvents();
  const issues: Array<{ id: string; passed: boolean; issues: string[] }> = [];
  const bindingIssues: string[] = [];
  if (bindings.schema !== 'clawx.versegit.c1-runtime-bindings/v1') bindingIssues.push('binding schema mismatch');
  if (bindings.task !== 'TF-0528') bindingIssues.push('binding task mismatch');
  if (bindings.driven_by !== 'agent' || bindings.actor !== 'codex') bindingIssues.push('binding actor identity mismatch');
  if (bindings.passed !== true) bindingIssues.push('binding evidence is not passed');
  if (bindings.source?.dirty !== false) bindingIssues.push('binding source was not clean');
  if (bindings.authority?.host_verdict !== 'unchanged') bindingIssues.push('host verdict authority drifted');
  if (bindings.authority?.m4_authorized !== false) bindingIssues.push('M4 authority was claimed');
  if (bindings.authority?.second_executor !== false || bindings.authority?.second_message_bus !== false) bindingIssues.push('parallel control-plane ownership was claimed');
  if (bindings.repo_count !== 1 || bindings.worktree_count < 2) bindingIssues.push('repo/worktree cardinality is insufficient');
  if (bindings.digest !== digest(bindings)) bindingIssues.push('binding evidence digest is not reproducible');
  if (absoluteLeaks(bindings) > 0) bindingIssues.push('binding evidence contains an absolute path');
  if (!events.every((event) => event.driven_by === 'agent' && event.actor === 'electron-main')) bindingIssues.push('bridge event actor identity mismatch');
  if (absoluteLeaks(events) > 0) bindingIssues.push('bridge events contain an absolute path');
  const counts = expectedKinds(events);
  if (JSON.stringify(counts) !== JSON.stringify(bindings.bridge_counts)) bindingIssues.push('bridge event counts do not match the retained evidence');
  bindingIssues.push(...checkOrderedLifecycle(events));
  issues.push({ id: 'runtime-bindings', passed: bindingIssues.length === 0, issues: bindingIssues });

  const negativeIssues: string[] = [];
  if (negative.schema !== 'clawx.versegit.c1-binding-negative/v1') negativeIssues.push('negative schema mismatch');
  if (negative.passed !== true) negativeIssues.push('negative evidence is not passed');
  if (negative.digest !== digest(negative)) negativeIssues.push('negative evidence digest is not reproducible');
  if (negative.source?.commit !== bindings.source?.commit || negative.source?.tree !== bindings.source?.tree) negativeIssues.push('negative evidence source differs from binding evidence');
  for (const [name, passed] of Object.entries(negative.cases ?? {})) {
    if (passed !== true) negativeIssues.push(`negative case is not passed: ${name}`);
  }
  if (absoluteLeaks(negative) > 0) negativeIssues.push('negative evidence contains an absolute path');
  issues.push({ id: 'binding-negative', passed: negativeIssues.length === 0, issues: negativeIssues });

  const passed = issues.every((entry) => entry.passed);
  return {
    schema: 'clawx.versegit.c1-independent-review/v1',
    generated_at: generatedAt,
    task: 'TF-0528',
    driven_by: 'agent',
    actor: 'codex',
    reviewer_role: 'independent-c1-verifier-process',
    status: passed ? 'passed' : 'failed',
    checks: issues,
    evidence_digests: Object.fromEntries([PATHS.bindings, PATHS.events, PATHS.negative].map((path) => [path, sha(readFileSync(resolve(ROOT, path)))])),
    boundaries: {
      real_human_evidence: false,
      default_off: true,
      m4_authorized: false,
      host_authority: 'unchanged',
      public_release_authorized: false,
    },
    passed,
    digest: '',
  };
}
function sign(document: Record<string, any>): Record<string, any> {
  const next = { ...document };
  delete next.digest;
  next.digest = digest(next);
  return next;
}
function writeSums(): void {
  const paths = [PATHS.bindings, PATHS.events, PATHS.negative, PATHS.independent];
  const body = paths.map((path) => `${sha(readFileSync(resolve(ROOT, path)))}  ${path}`).sort().join('\n');
  writeFileSync(resolve(ROOT, PATHS.sums), `${body}\n`, 'utf8');
}
function checkSums(): string[] {
  const issues: string[] = [];
  const expected = new Set([PATHS.bindings, PATHS.events, PATHS.negative, PATHS.independent]);
  const lines = readFileSync(resolve(ROOT, PATHS.sums), 'utf8').trim().split(/\r?\n/u).filter(Boolean);
  for (const line of lines) {
    const match = /^([a-f0-9]{64})  (.+)$/u.exec(line);
    if (!match) { issues.push('malformed SHA256SUMS line'); continue; }
    const [, expectedDigest, path] = match;
    if (!expected.has(path)) { issues.push(`unexpected SHA256SUMS path: ${path}`); continue; }
    expected.delete(path);
    if (sha(readFileSync(resolve(ROOT, path))) !== expectedDigest) issues.push(`SHA256SUMS mismatch: ${path}`);
  }
  if (expected.size > 0) issues.push(`SHA256SUMS missing: ${[...expected].join(', ')}`);
  return issues;
}
function main(): void {
  const checkMode = process.argv.includes('--check');
  if (![PATHS.bindings, PATHS.events, PATHS.negative].every((path) => existsSync(resolve(ROOT, path)))) {
    throw new Error('C1 evidence inputs are incomplete');
  }
  if (checkMode) {
    const review = readJson(PATHS.independent);
    const rebuilt = sign(buildReview(review.generated_at));
    const issues = [
      ...(review.digest === digest(review) ? [] : ['independent review digest is not reproducible']),
      ...(rebuilt.digest === review.digest ? [] : ['independent review result drifted']),
      ...checkSums(),
    ];
    if (review.status !== 'passed' || review.passed !== true) issues.push('independent review did not pass');
    if (issues.length > 0) throw new Error(issues.join('; '));
    console.log('[versegit-c1-review] CHECK OK');
    return;
  }
  const review = sign(buildReview(new Date().toISOString()));
  writeFileSync(resolve(ROOT, PATHS.independent), `${JSON.stringify(review, null, 2)}\n`, 'utf8');
  writeSums();
  if (review.passed !== true) throw new Error(JSON.stringify(review.checks));
  console.log('[versegit-c1-review] WRITE OK');
}

try { main(); } catch (error) { console.error(`[versegit-c1-review] FAIL: ${String((error as Error)?.stack ?? error)}`); process.exitCode = 1; }
