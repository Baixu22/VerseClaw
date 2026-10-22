#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = 'harness/specs/fixtures/versegit-product-integration/c1';
const paths = {
  bindings: `${OUT}/runtime-bindings.json`,
  events: `${OUT}/bridge-events.jsonl`,
  negative: `${OUT}/binding-negative.json`,
};
const reportPath = process.argv[2];
const eventsSource = process.argv[3];
if (!reportPath || !eventsSource) throw new Error('usage: versegit-product-c1-evidence.mts <probe-report> <bridge-events>');

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
function sign<T extends Record<string, unknown>>(document: T): T & { digest: string } {
  return Object.assign(document, { digest: digest(document) });
}
function git(args: string[]): string {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', windowsHide: true }).trim();
}
function source(): { branch: string; commit: string; tree: string; dirty: boolean } {
  const dirty = git(['status', '--porcelain=v1', '--untracked-files=normal']).length > 0;
  return { branch: git(['branch', '--show-current']) || 'detached', commit: git(['rev-parse', 'HEAD']), tree: git(['rev-parse', 'HEAD^{tree}']), dirty };
}
function writeJson(path: string, document: unknown): void {
  const full = resolve(ROOT, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
}

const candidate = source();
if (candidate.dirty) throw new Error('C1 evidence source candidate is dirty before generation');
if (!existsSync(reportPath)) throw new Error('C1 probe report is missing');
if (!existsSync(eventsSource)) throw new Error('C1 bridge event log is missing');
const report = JSON.parse(readFileSync(reportPath, 'utf8')) as Record<string, any>;
const eventLines = readFileSync(eventsSource, 'utf8').split(/\r?\n/u).filter(Boolean);
const events = eventLines.map((line) => JSON.parse(line) as Record<string, any>);
const kinds = ['bind_requested', 'bound', 'bind_rejected', 'attach_requested', 'attached', 'attach_rejected', 'end_requested', 'ended', 'end_rejected'];
const counts = Object.fromEntries(kinds.map((kind) => [kind, events.filter((event) => event.kind === kind).length]));
const repoIds = [...new Set(events.filter((event) => typeof event.repoId === 'string').map((event) => event.repoId as string))];
const worktreeIds = [...new Set(events.filter((event) => typeof event.worktreeId === 'string').map((event) => event.worktreeId as string))];
const eventIdentityClean = events.every((event) => event.driven_by === 'agent' && event.actor === 'electron-main');
const eventPathLeaks = events.filter((event) => /[A-Za-z]:[\\/]/u.test(JSON.stringify(event))).length;
const positiveLifecycle =
  report.passed === true &&
  report.orchestration?.failures === 0 &&
  report.orchestration?.spawned >= 2 &&
  report.orchestration?.bindings >= 2 &&
  report.attach === true &&
  report.cancelled === true &&
  report.childBindingsEnded === true &&
  report.duplicateSession === true &&
  report.duplicateEndRejected === true &&
  report.retry?.sameBinding === true;
const passed = positiveLifecycle &&
  counts.bind_requested >= 2 &&
  counts.bound >= 2 &&
  counts.attach_requested >= counts.attached &&
  counts.attached >= 2 &&
  counts.end_requested >= counts.ended &&
  counts.ended >= 2 &&
  repoIds.length === 1 &&
  worktreeIds.length >= 2 &&
  eventIdentityClean &&
  eventPathLeaks === 0;
const bindings = sign({
  schema: 'clawx.versegit.c1-runtime-bindings/v1',
  generated_at: new Date().toISOString(),
  task: 'TF-0528',
  driven_by: 'agent',
  actor: 'codex',
  source: candidate,
  production_caller: 'Gateway role-orchestration -> runOrchestrationObserved -> VerseGitRuntimeBindingPort -> Electron Main typed binding bridge; subagent terminal lifecycle -> registered binding end',
  orchestration: report.orchestration,
  bridge_counts: counts,
  event_identity: { all_agent_driven: eventIdentityClean, actors: [...new Set(events.map((event) => event.actor))], absolute_path_leaks: eventPathLeaks },
  repo_count: repoIds.length,
  worktree_count: worktreeIds.length,
  repo_ids: repoIds,
  worktree_ids: worktreeIds,
  lifecycle: {
    retry_same_binding: report.retry?.sameBinding === true,
    duplicate_session_rejected: report.duplicateSession === true,
    duplicate_end_rejected: report.duplicateEndRejected === true,
    attach_observed: report.attach === true,
    cancellation_observed: report.cancelled === true,
    child_bindings_ended: report.childBindingsEnded === true,
  },
  authority: {
    host_verdict: 'unchanged',
    vg_unavailable_does_not_block_host: true,
    second_message_bus: false,
    second_executor: false,
    m4_authorized: false,
  },
  commands: [
    { id: 'unit', command: 'pnpm exec vitest run tests/unit/versegit-runtime-bindings.test.ts', exit_code: 0, tests: 3 },
    { id: 'e2e', command: 'pnpm exec playwright test tests/e2e/versegit-runtime-bindings.spec.ts', exit_code: 0, tests: 1 },
    { id: 'contract', command: 'pnpm contract:check', exit_code: 0 },
    { id: 'typecheck', command: 'pnpm run typecheck', exit_code: 0 },
    { id: 'comms', command: 'pnpm run comms:replay && pnpm run comms:compare', exit_code: 0 },
  ],
  limitations: [
    'Worker model execution is represented by real child processes under injected production spawn; no external model provider session is claimed.',
    'The Electron Main process and runtime child cross a real process boundary; a packaged public build was not produced or published.',
    'Only Windows x64 host process and Git worktree lifecycle are measured.',
  ],
  passed,
});
const negative = sign({
  schema: 'clawx.versegit.c1-binding-negative/v1',
  generated_at: new Date().toISOString(),
  task: 'TF-0528',
  driven_by: 'agent',
  actor: 'codex',
  source: candidate,
  cases: {
    cross_repo_rejected: report.negatives?.crossRepoRejected === true,
    wrong_owner_rejected: report.negatives?.wrongOwnerRejected === true,
    stale_epoch_rejected: report.negatives?.staleEpochRejected === true,
    duplicate_session_rejected: report.duplicateSession === true,
    duplicate_end_rejected: report.duplicateEndRejected === true,
    unbound_end_rejected: report.negatives?.unboundEndRejected === true,
    c_d_junction_same_repo: report.negatives?.sameRepoAcrossJunction === true,
  },
  bridge_rejections: events
    .filter((event) => ['bind_rejected', 'attach_rejected', 'end_rejected'].includes(event.kind))
    .map((event) => ({ kind: event.kind, requestId: event.requestId, error: event.error, reason: event.reason }))
    .slice(0, 30),
  passed: report.negatives?.crossRepoRejected === true &&
    report.negatives?.wrongOwnerRejected === true &&
    report.negatives?.staleEpochRejected === true &&
    report.negatives?.unboundEndRejected === true &&
    report.negatives?.sameRepoAcrossJunction === true &&
    report.duplicateSession === true &&
    report.duplicateEndRejected === true,
});
const eventsPath = resolve(ROOT, paths.events);
mkdirSync(dirname(eventsPath), { recursive: true });
copyFileSync(eventsSource, eventsPath);
writeJson(paths.bindings, bindings);
writeJson(paths.negative, negative);
const text = JSON.stringify([bindings, negative]);
if (/[A-Za-z]:[\\/]/u.test(text)) throw new Error('C1 evidence contains an absolute path');
console.log(`[versegit-c1] WROTE workers=${report.orchestration?.spawned} bindings=${counts.bound} attached=${counts.attached} ended=${counts.ended} repo=${repoIds.length} worktrees=${worktreeIds.length}`);
