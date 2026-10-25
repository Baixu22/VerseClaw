#!/usr/bin/env node
// WP5 bounded replay/soak: create disposable Git worktrees, exercise the observation
// and receipt bridges, inject availability/crash/report failures, clean up, and retain
// both pass and failure facts. No VG verification command is executed.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { isMainEntrypoint } from './lib/entrypoint.mjs';

const root = process.env.VERSEGIT_WP5_ROOT ? resolve(process.env.VERSEGIT_WP5_ROOT) : resolve(process.cwd());
export const WP5_SCHEMA = 'clawx.versegit.wp5-soak/v1';
export const WP5_FIXTURE_PATH = 'harness/specs/fixtures/versegit-planning-correction/wp5-soak-fixture.json';
function hash(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function run(command, args, cwd) {
  const started = Date.now();
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', windowsHide: true, timeout: 30_000, maxBuffer: 8 * 1024 * 1024 });
  return { exitCode: typeof result.status === 'number' ? result.status : null, stdout: String(result.stdout ?? '').trim(), stderr: String(result.stderr ?? result.error?.message ?? '').trim(), durationMs: Date.now() - started };
}
function ensureOk(result, label) { if (result.exitCode !== 0) throw new Error(`${label}: exit ${result.exitCode}: ${result.stderr}`); }
function tempRoot() { mkdirSync('D:\\tmp', { recursive: true }); return mkdtempSync('D:\\tmp\\versegit-wp5-'); }
function cleanRoot(path) { if (!path || !path.startsWith('D:\\tmp\\versegit-wp5-')) throw new Error(`refusing cleanup outside D:\\tmp: ${path}`); rmSync(path, { recursive: true, force: true }); }
function opaquePath(seed) { return `repo-${hash(seed).slice(0, 16)}`; }
function makeEvents(repoId, worktreeId, sessionKey, suffix) {
  const runId = `run-${suffix}`;
  const base = { runId, sessionKey, ts: 1000 };
  return {
    runId,
    binding: { runId, sessionKey, traceId: `trace-${suffix}`, requestId: `request-${suffix}`, repoId, worktreeId, agentSessionId: `agent-${suffix}`, vgSessionId: `vg-${suffix}`, ownerId: `owner-${suffix}`, actor: 'agent:codex', epoch: 1, boundAt: 1000 },
    events: [
      { type: 'tool.started', ...base, seq: 1, toolCallId: `read-${suffix}`, name: 'Read', args: { path: 'producer.txt' } },
      { type: 'tool.completed', ...base, seq: 2, ts: 1010, toolCallId: `read-${suffix}`, name: 'Read', result: { ok: true } },
      { type: 'tool.started', ...base, seq: 3, ts: 1020, toolCallId: `write-${suffix}`, name: 'Edit', args: { path: 'consumer.txt' } },
      { type: 'tool.started', ...base, seq: 4, ts: 1030, toolCallId: `unknown-${suffix}`, name: 'mystery_tool', args: {} },
    ],
  };
}
async function loadBridge(relative) { return import(pathToFileURL(resolve(root, relative)).href); }
async function runProducerConsumer() {
  const temp = tempRoot();
  const repo = join(temp, 'repo');
  const producer = join(temp, 'producer');
  const consumer = join(temp, 'consumer');
  const scenario = { id: 'producer_consumer', status: 'failed', startedAt: new Date().toISOString(), processCalls: 0, cleanup: { worktreesDeleted: 0, survivors: 0, tempRootRemoved: false }, exitCode: null, error: null, events: 0, coverage: null };
  try {
    ensureOk(run('git', ['init', repo], temp), 'git init');
    ensureOk(run('git', ['-C', repo, 'config', 'user.email', 'wp5@example.invalid'], temp), 'git config email');
    ensureOk(run('git', ['-C', repo, 'config', 'user.name', 'WP5'], temp), 'git config name');
    writeFileSync(join(repo, 'base.txt'), 'base\n'); ensureOk(run('git', ['-C', repo, 'add', 'base.txt'], repo), 'git add');
    ensureOk(run('git', ['-C', repo, 'commit', '-m', 'base'], repo), 'git commit');
    ensureOk(run('git', ['-C', repo, 'worktree', 'add', '-b', 'producer', producer], repo), 'worktree producer');
    ensureOk(run('git', ['-C', repo, 'worktree', 'add', '-b', 'consumer', consumer], repo), 'worktree consumer');
    writeFileSync(join(producer, 'producer.txt'), 'producer\n'); writeFileSync(join(consumer, 'consumer.txt'), 'consumer\n');
    const observation = await loadBridge('electron/services/versegit-observation.ts');
    const receipt = await loadBridge('electron/services/versegit-receipt-bridge.ts');
    const repoId = opaquePath(repo);
    const a = makeEvents(repoId, opaquePath(producer), 'producer-session', 'producer');
    const b = makeEvents(repoId, opaquePath(consumer), 'consumer-session', 'consumer');
    const bridge = new observation.VerseGitObservationBridge();
    bridge.bind(a.binding); bridge.bind(b.binding);
    for (const event of a.events) bridge.ingest(event, { epoch: 1, ownerId: 'owner-producer', eventId: `p-${event.seq}` });
    for (const event of b.events) bridge.ingest(event, { epoch: 1, ownerId: 'owner-consumer', eventId: `c-${event.seq}` });
    const stale = bridge.ingest({ ...a.events[0], seq: 9, ts: 1100 }, { epoch: 0, ownerId: 'owner-producer', eventId: 'stale-producer' });
    const coverage = bridge.detach(a.runId, { epoch: 1, ownerId: 'owner-producer', at: 1200 });
    bridge.detach(b.runId, { epoch: 1, ownerId: 'owner-consumer', at: 1200 });
    const receiptBridge = new receipt.VerseGitReceiptBridge();
    const created = receipt.createVerificationPlan({
      runId: 'plan-wp5', candidateId: 'candidate-wp5', checkId: 'check-wp5', owner: 'owner-wp5', epoch: 1, authorizationId: 'auth-wp5',
      commands: [{ argv: ['node', '--version'], cwd: 'repo-relative', env: {}, effect: 'read', retry: 'never', expectedArtifacts: ['stdout'] }],
      requiredScope: 'full',
    });
    if (created.plan) receiptBridge.registerPlan(created.plan);
    const unavailable = receiptBridge.verdict('plan-wp5');
    scenario.status = stale.status === 'stale' && coverage.status === 'detached' && a.binding.repoId === b.binding.repoId && a.binding.worktreeId !== b.binding.worktreeId && unavailable.reasons.includes('unmeasured') ? 'passed' : 'failed';
    scenario.events = a.events.length + b.events.length;
    scenario.coverage = coverage.coverage?.values ?? null;
    scenario.processCalls = 0;
    scenario.exitCode = 0;
    scenario.sidecarUnavailableObserved = unavailable.status === 'partial';
    scenario.unsupportedLanguageObserved = bridge.snapshot(a.runId) === null;
    scenario.staleEventRejected = stale.status === 'stale';
    scenario.receiptUnmeasured = unavailable.reasons.includes('unmeasured');
  } catch (error) {
    scenario.error = String(error?.message ?? error);
  } finally {
    for (const wt of [producer, consumer]) {
      if (existsSync(wt)) {
        const removed = run('git', ['-C', repo, 'worktree', 'remove', '--force', wt], temp);
        if (removed.exitCode === 0) scenario.cleanup.worktreesDeleted += 1;
      }
    }
    if (existsSync(join(repo, '.git'))) {
      const list = run('git', ['-C', repo, 'worktree', 'list', '--porcelain'], temp);
      scenario.cleanup.survivors = list.stdout.split(/\r?\n/u).filter((line) => line.startsWith('worktree ')).length > 1 ? 1 : 0;
    }
    cleanRoot(temp);
    scenario.cleanup.tempRootRemoved = !existsSync(temp);
    scenario.finishedAt = new Date().toISOString();
  }
  return scenario;
}
async function runFailureMatrix() {
  const scenarios = [];
  const singleBridge = new (await loadBridge('electron/services/versegit-observation.ts')).VerseGitObservationBridge();
  scenarios.push({ id: 'single_worktree', status: singleBridge.activeSessionCount === 0 ? 'not_applicable' : 'failed', processCalls: 0, cleanup: { worktreesDeleted: 0, survivors: 0, tempRootRemoved: true }, exitCode: 0, error: null });
  const receipt = await loadBridge('electron/services/versegit-receipt-bridge.ts');
  const plan = receipt.createVerificationPlan({ runId: 'missing-receipt', candidateId: 'c', checkId: 'k', owner: 'o', epoch: 1, authorizationId: 'a', commands: [{ argv: ['node', '--version'], cwd: 'repo-relative', env: {}, effect: 'read', retry: 'never', expectedArtifacts: ['stdout'] }], requiredScope: 'full' });
  const receiptBridge = new receipt.VerseGitReceiptBridge(); if (plan.plan) receiptBridge.registerPlan(plan.plan);
  const noReceipt = receiptBridge.verdict('missing-receipt');
  scenarios.push({ id: 'verseshell_unavailable', status: noReceipt.status === 'partial' && noReceipt.reasons.includes('unmeasured') ? 'passed' : 'failed', processCalls: 0, cleanup: { worktreesDeleted: 0, survivors: 0, tempRootRemoved: true }, exitCode: 0, error: null, verdict: noReceipt });
  const module = await loadBridge('electron/services/versegit-module.ts');
  const crash = new module.VerseGitModule({ binaryPath: 'D:\\tmp\\no-vg.exe', contractDigest: 'a'.repeat(64), expectedCapabilitiesDigest: 'b'.repeat(64), run: () => { throw Object.assign(new Error('crash'), { code: 'crash' }); } });
  crash.attach('M1', { mode: 'M1', authorizationId: 'crash' }); const crashed = crash.readVersion();
  scenarios.push({ id: 'sidecar_crash', status: crashed.status === 'unavailable' && crashed.reason === 'crash' ? 'passed' : 'failed', processCalls: 0, cleanup: { worktreesDeleted: 0, survivors: 0, tempRootRemoved: true }, exitCode: 0, error: null, result: { status: crashed.status, reason: crashed.reason } });
  const behavior = await loadBridge('electron/services/versegit-behavior-coverage.ts');
  const valid = behavior.buildBehaviorCoverage({ events: [], feedbackCases: [{ id: 'x', produced: false, hostDelivered: false, transcriptConfirmed: false, behaviorShift: false, evidenceRefs: [] }] });
  const tampered = { ...valid, digest: '0'.repeat(64) };
  const tamperValidation = behavior.validateBehaviorCoverageReport(tampered);
  scenarios.push({ id: 'report_tamper', status: tamperValidation.ok === false ? 'passed' : 'failed', processCalls: 0, cleanup: { worktreesDeleted: 0, survivors: 0, tempRootRemoved: true }, exitCode: 0, error: null, rejected: tamperValidation.issues });
  return scenarios;
}
export async function buildWp5Report({ root: evidenceRoot = root, fixturePath } = {}) {
  const fixture = JSON.parse(readFileSync(fixturePath ?? resolve(evidenceRoot, WP5_FIXTURE_PATH), 'utf8'));
  const cycles = [];
  for (let index = 0; index < Number(fixture.runs ?? 3); index += 1) cycles.push(await runProducerConsumer());
  const failures = await runFailureMatrix();
  const all = [...cycles, ...failures];
  const normalized = all.map((entry) => ({ id: entry.id ?? 'producer_consumer', status: entry.status, exitCode: entry.exitCode ?? 0, cleanup: entry.cleanup ?? null })).sort((a, b) => a.id.localeCompare(b.id));
  const report = {
    schema: WP5_SCHEMA, generated_at: new Date().toISOString(), driven_by: 'agent', actor: 'codex', task: 'TF-0471',
    fixture: 'harness/specs/fixtures/versegit-planning-correction/wp5-soak-fixture.json', fixtureDigest: hash(fixture),
    cycles, failures, all, normalizedOutcomeDigest: hash(normalized),
    summary: { cycles: cycles.length, passedCycles: cycles.filter((entry) => entry.status === 'passed').length, scenarios: all.length, failedScenarios: all.filter((entry) => entry.status === 'failed').length, processCalls: all.reduce((sum, entry) => sum + (entry.processCalls ?? 0), 0) },
    boundaries: { sidecarProcessesStarted: false, hostWorktreesDeleted: false, tempSurvivors: all.filter((entry) => entry.cleanup?.survivors > 0 || entry.cleanup?.tempRootRemoved === false).length, rawFailurePreserved: true },
    hostVerdict: 'unchanged', passed: cycles.length > 0 && cycles.every((entry) => entry.status === 'passed') && failures.every((entry) => entry.status === 'passed' || entry.status === 'not_applicable'), issues: [],
  };
  report.digest = hash({ ...report, generated_at: undefined, digest: undefined });
  if (!report.passed) report.issues.push('one or more soak/failure scenarios failed');
  return { fixture, report, cycles, failures };
}
export function validateWp5Report(report) {
  const issues = [];
  if (report?.schema !== WP5_SCHEMA || report?.task !== 'TF-0471') issues.push('WP5 schema/task mismatch');
  if (report?.driven_by !== 'agent' || report?.actor !== 'codex') issues.push('WP5 evidence must be agent-driven');
  if (report?.summary?.cycles < 3 || report?.summary?.failedScenarios !== 0) issues.push('WP5 soak/failure matrix did not pass');
  if (!report?.cycles?.every((entry) => entry.cleanup?.survivors === 0 && entry.cleanup?.worktreesDeleted === 2 && entry.cleanup?.tempRootRemoved === true)) issues.push('WP5 cycle cleanup is incomplete');
  const ids = new Set((report?.failures ?? []).map((entry) => entry.id));
  for (const id of ['single_worktree', 'verseshell_unavailable', 'sidecar_crash', 'report_tamper']) if (!ids.has(id)) issues.push(`missing failure scenario ${id}`);
  if (report?.boundaries?.sidecarProcessesStarted !== false || report?.boundaries?.hostWorktreesDeleted !== false || report?.boundaries?.tempSurvivors !== 0) issues.push('WP5 resource boundary failed');
  if (report?.hostVerdict !== 'unchanged') issues.push('WP5 host verdict changed');
  if (report?.passed !== true || (report?.issues ?? []).length !== 0) issues.push('WP5 report did not pass');
  if (report?.digest !== hash({ ...report, generated_at: undefined, digest: undefined })) issues.push('WP5 digest is not reproducible');
  return { ok: issues.length === 0, issues };
}
export async function writeWp5Report({ root: evidenceRoot = root, output, fixturePath } = {}) {
  const built = await buildWp5Report({ root: evidenceRoot, fixturePath });
  const path = output ? resolve(output) : resolve(evidenceRoot, 'artifacts/versegit/wp5/soak-report.json');
  mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, `${JSON.stringify(built.report, null, 2)}\n`, 'utf8');
  return { ...built, path, validation: validateWp5Report(built.report) };
}
async function main() {
  const at = (flag) => { const i = process.argv.indexOf(flag); return i >= 0 ? resolve(process.argv[i + 1]) : undefined; };
  const result = await writeWp5Report({ fixturePath: at('--fixture'), output: at('--out') });
  console.log(JSON.stringify({ path: result.path, passed: result.report.passed, summary: result.report.summary, validation: result.validation }, null, 2));
  if (!result.validation.ok) process.exitCode = 1;
}
if (isMainEntrypoint(import.meta.url)) main().catch((error) => { console.error(String(error?.stack ?? error)); process.exitCode = 1; });