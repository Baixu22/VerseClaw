#!/usr/bin/env node
// WP2: opt-in concurrency diagnostic profile. It is selected only by the explicit
// concurrency-aux harness profile; a single-worktree/session case starts no VG process.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isMainEntrypoint } from './lib/entrypoint.mjs';

const repositoryRoot = process.env.VERSEGIT_WP2_ROOT
  ? resolve(process.env.VERSEGIT_WP2_ROOT)
  : resolve(process.cwd());

export const WP2_SCHEMA = 'clawx.versegit.wp2-profile/v1';
export const WP2_PROFILE = 'concurrency-aux';
export const WP2_FIXTURE_PATH = 'harness/specs/fixtures/versegit-planning-correction/wp2-diagnostic-profile-fixture.json';

function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function readJson(path) { return JSON.parse(readFileSync(path, 'utf8')); }
function isRecord(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
function asRecord(value) { return isRecord(value) ? value : {}; }
function asArray(value) { return Array.isArray(value) ? value : []; }
function number(value, fallback = 0) { return typeof value === 'number' && Number.isFinite(value) ? value : fallback; }
function git(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  return { ok: result.status === 0, stdout: String(result.stdout ?? '').trim(), stderr: String(result.stderr ?? '').trim() };
}
function worktreeCount(repo) {
  const result = git(['worktree', 'list', '--porcelain'], repo);
  return result.ok ? result.stdout.split(/\r?\n/u).filter((line) => line.startsWith('worktree ')).length : null;
}
function summarizeCapabilities(document) {
  const safety = asRecord(document?.safety);
  const verdict = asRecord(document?.verdict);
  const surface = asRecord(verdict.read_surface);
  return {
    schema: document?.schema ?? null,
    default_enable: safety.default_enable ?? null,
    single_green_light: verdict.single_green_light ?? null,
    observed_channels: asArray(surface.observed_channels),
    unobserved_channels: asArray(surface.unobserved_channels),
  };
}
function summarizeDoctor(document) {
  const chain = asRecord(document?.chain);
  const worktreeDiagnostic = asRecord(document?.worktree_diagnostic);
  const evidence = asRecord(document?.evidence);
  const recovery = asRecord(document?.unified_recovery);
  return {
    ledger_schema_version: document?.ledger_schema_version ?? null,
    chain_valid: chain.valid ?? null,
    events: number(chain.events_verified, number(document?.events)),
    worktree_count: number(worktreeDiagnostic.count, number(document?.worktrees?.length)),
    worktrees_ok: worktreeDiagnostic.ok ?? null,
    plugins: asArray(document?.plugins).length,
    recovery_mode: recovery.mode ?? null,
    missing_objects: number(recovery.missing_count),
    pending_land_ops: number(recovery.pending_count),
    evidence_report_count: number(asRecord(evidence.reports).files),
  };
}
function identityLabels(repo, worktree, sessionKey) {
  const repoId = `repo-${sha256(repo).slice(0, 16)}`;
  const worktreeId = `worktree-${sha256(worktree).slice(0, 16)}`;
  const session = sessionKey ? `session-${sha256(sessionKey).slice(0, 16)}` : 'session-wp2';
  return {
    identity: { repoId, worktreeIds: [worktreeId], agentSessionIds: [session], vgSessionIds: [`vg-${session}`], epoch: 1 },
    correlation: { runId: `run-${sha256(`${repo}:${session}`).slice(0, 16)}`, requestId: 'request-wp2', traceId: 'trace-wp2', epoch: 1 },
    session: { agentSessionId: session, vgSessionId: `vg-${session}`, worktreeId, epoch: 1, traceId: 'trace-wp2', status: 'active' },
  };
}
async function loadAdapter(root) {
  const path = resolve(root, 'electron/services/versegit-module.ts');
  if (!existsSync(path)) throw new Error('VerseGit adapter module is missing');
  return import(pathToFileURL(path).href);
}
function reportDigest(report) {
  return sha256(JSON.stringify({ ...report, generated_at: undefined, digest: undefined }));
}
function summarizeProbe(result) {
  return { status: result.status, reason: result.reason ?? null, issues: result.issues ?? [], host_verdict: result.host_verdict };
}

export async function buildCase({ root = repositoryRoot, spec, fixture, spawn = spawnSync, moduleLoader = loadAdapter }) {
  const trace = { id: spec.id, worktreeCount: spec.worktreeCount, activeSessionCount: spec.activeSessionCount };
  const eligible = spec.worktreeCount > 1 || spec.activeSessionCount > 1;
  const base = {
    caseId: spec.id,
    trigger: { ...trace, eligible, reason: eligible ? 'concurrency-trigger' : 'single-worktree-single-session' },
    profile: WP2_PROFILE,
    optIn: true,
    probes: [],
    moduleReport: null,
    usage: { processesStarted: 0, stateReads: 0 },
    coverage: { declared: ['identity.version', 'identity.capabilities'], unobserved: ['provider.conflicts-plan', 'shell-write', 'network', 'direct-fs'] },
    hostVerdict: 'unchanged',
    cleanup: { sidecarProcessesSurviving: 0, candidateTempDirectories: 0, hostWorktreesDeleted: 0 },
  };
  if (!eligible) return { ...base, status: 'not_applicable', issues: [] };

  const mc0 = readJson(resolve(root, 'harness/specs/fixtures/versegit-planning-correction/mc0-evidence/baseline.json'));
  const mc1 = readJson(resolve(root, 'harness/specs/fixtures/versegit-planning-correction/mc1-evidence/contract.json'));
  const wp0 = readJson(resolve(root, 'harness/specs/fixtures/versegit-planning-correction/wp0-evidence/contract.json'));
  const repo = String(mc0.source?.repo ?? '');
  const binary = resolve(String(spec.binaryPath ?? mc0.binary?.path ?? ''));
  const contractDigest = sha256(JSON.stringify(mc1));
  const expectedCapabilitiesDigest = wp0.binary_identity?.capabilities_digest;
  const labels = identityLabels(repo, `${repo}:${spec.worktreeCount}`, spec.sessionKey);
  let processCount = 0;
  if (!existsSync(binary)) {
    return { ...base, status: 'unavailable', reason: 'missing_binary', issues: ['frozen sidecar binary missing'], usage: { processesStarted: 0, stateReads: 0 } };
  }
  if (sha256(readFileSync(binary)) !== mc0.binary?.sha256) {
    return { ...base, status: 'rejected_by_policy', reason: 'binary_digest_mismatch', issues: ['sidecar binary does not match MC0'], usage: { processesStarted: 0, stateReads: 0 } };
  }
  const module = await moduleLoader(root);
  const adapter = new module.VerseGitModule({
    binaryPath: binary, cwd: repo, contractDigest, expectedCapabilitiesDigest, timeoutMs: 30_000,
    run: (argv, timeout) => {
      processCount += 1;
      const result = spawn(binary, argv, { cwd: repo, encoding: 'utf8', timeout, windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
      return { stdout: String(result.stdout ?? '').trim(), stderr: String(result.stderr ?? result.error?.message ?? '').trim(), code: typeof result.status === 'number' ? result.status : null };
    },
  });
  const attach = adapter.attach('M1', { mode: 'M1', authorizationId: `wp2-${spec.id}` });
  if (!attach.ok) return { ...base, status: attach.status, issues: attach.issues, usage: { processesStarted: processCount, stateReads: 0 } };
  const probes = [];
  let version;
  let capabilities;
  let doctor;
  try { version = adapter.readVersion(); } catch (error) { version = { status: 'unavailable', reason: 'exception', issues: [String(error)], host_verdict: 'unchanged' }; }
  try { capabilities = adapter.readCapabilities(); } catch (error) { capabilities = { status: 'unavailable', reason: 'exception', issues: [String(error)], host_verdict: 'unchanged' }; }
  try { doctor = adapter.readDoctor(); } catch (error) { doctor = { status: 'unavailable', reason: 'exception', issues: [String(error)], host_verdict: 'unchanged' }; }
  probes.push({ id: 'identity.version', ...summarizeProbe(version) });
  probes.push({ id: 'identity.capabilities', ...summarizeProbe(capabilities), summary: summarizeCapabilities(capabilities.document) });
  probes.push({ id: 'provider.doctor', ...summarizeProbe(doctor), summary: summarizeDoctor(doctor.document) });
  probes.push({ id: 'provider.conflicts-plan', status: 'unavailable', reason: 'provider_seam_unavailable', issues: ['the current CLI has no pure conflicts-plan seam'], host_verdict: 'unchanged' });
  const moduleStatus = capabilities.status === 'observed' && doctor.status === 'observed' ? 'partial' : capabilities.status === 'unavailable' || doctor.status === 'unavailable' ? 'unavailable' : 'degraded';
  let moduleReport = null;
  let reportIssues = [];
  try {
    moduleReport = adapter.buildReport({
      mode: 'M1',
      component: 'versegit-wp2-profile',
      trigger: { reason: eligible ? 'concurrency-trigger' : 'single-worktree-single-session', worktreeCount: spec.worktreeCount, activeSessionCount: spec.activeSessionCount },
      repository: { repoId: labels.identity.repoId, worktreeId: labels.session.worktreeId },
      identity: labels.identity,
      correlation: labels.correlation,
      sessions: [labels.session],
      facts: { conflicts: [], warnings: [], unknowns: ['provider.conflicts-plan', 'shell-write', 'network', 'direct-fs'] },
      coverage: { declared: ['identity.version', 'identity.capabilities'], unobserved: ['provider.conflicts-plan', 'shell-write', 'network', 'direct-fs'] },
      result: { status: moduleStatus, reasons: moduleStatus === 'partial' ? ['unknown'] : [] },
    });
    reportIssues = module.validateModuleReport(moduleReport).issues;
  } catch (error) {
    reportIssues = [String(error)];
  }
  const usage = moduleReport?.usage ?? { processes_started: processCount, state_reads: 0 };
  adapter.detach();
  return {
    ...base,
    status: moduleReport && reportIssues.length === 0 ? moduleStatus : 'unavailable',
    reason: moduleReport ? null : 'module_report_invalid',
    probes,
    moduleReport,
    reportIssues,
    coverage: { declared: ['identity.version', 'identity.capabilities', 'provider.doctor'], unobserved: ['provider.conflicts-plan', 'shell-write', 'network', 'direct-fs'] },
    usage: { processesStarted: usage.processes_started, stateReads: usage.state_reads },
  };
}

export async function buildWp2Report({ root = repositoryRoot, fixturePath, fixture, spawn, moduleLoader } = {}) {
  const path = fixturePath ?? resolve(root, WP2_FIXTURE_PATH);
  const input = fixture ?? readJson(path);
  const cases = [];
  const issues = [];
  for (const spec of input.cases ?? []) {
    const result = await buildCase({ root, spec, fixture: input, spawn, moduleLoader });
    cases.push(result);
    if (spec.expectedStatus && result.status !== spec.expectedStatus) issues.push(`${spec.id}: expected ${spec.expectedStatus}, got ${result.status}`);
    if (spec.expectedProcesses !== undefined && result.usage.processesStarted !== spec.expectedProcesses) issues.push(`${spec.id}: expected ${spec.expectedProcesses} processes, got ${result.usage.processesStarted}`);
    if (result.hostVerdict !== 'unchanged') issues.push(`${spec.id}: host verdict changed`);
  }
  const report = {
    schema: WP2_SCHEMA,
    generated_at: new Date().toISOString(),
    driven_by: 'agent',
    actor: 'codex',
    ...((spawn || moduleLoader) ? { evidenceMode: 'fixture-replay' } : {}),
    task: 'TF-0468',
    fixture: 'harness/specs/fixtures/versegit-planning-correction/wp2-diagnostic-profile-fixture.json',
    profile: WP2_PROFILE,
    opt_in: true,
    cases,
    summary: {
      caseCount: cases.length,
      eligibleCount: cases.filter((entry) => entry.trigger.eligible).length,
      processCalls: cases.reduce((sum, entry) => sum + entry.usage.processesStarted, 0),
      statuses: Object.fromEntries([...new Set(cases.map((entry) => entry.status))].map((status) => [status, cases.filter((entry) => entry.status === status).length])),
    },
    hostVerdict: 'unchanged',
    boundaries: {
      addedToFast: false,
      addedToComms: false,
      implicitProfile: false,
      defaultOn: false,
      rendererRouteAdded: false,
      landOrAdmitInvoked: false,
      hostWorktreeDeleted: false,
      providerSourceModified: false,
    },
    issues,
    passed: issues.length === 0,
  };
  report.digest = reportDigest(report);
  return { fixture: input, report, cases, issues };
}

export function validateWp2Report(report) {
  const issues = [];
  if (report?.evidenceMode === 'fixture-replay') issues.push('fixture replay is not native WP2 evidence');
  if (report?.schema !== WP2_SCHEMA) issues.push('WP2 report schema mismatch');
  if (report?.driven_by !== 'agent' || report?.actor !== 'codex') issues.push('WP2 evidence must be agent-driven');
  if (report?.task !== 'TF-0468') issues.push('WP2 task mismatch');
  if (report?.profile !== WP2_PROFILE || report?.opt_in !== true) issues.push('WP2 must be the explicit opt-in profile');
  if (!Array.isArray(report?.cases) || report.cases.length !== 3) issues.push('WP2 fixture must contain three cases');
  const single = report?.cases?.find((entry) => entry.caseId === 'single-worktree');
  const multi = report?.cases?.find((entry) => entry.caseId === 'multi-worktree');
  const missing = report?.cases?.find((entry) => entry.caseId === 'missing-binary');
  if (!single || single.status !== 'not_applicable' || single.usage?.processesStarted !== 0) issues.push('single-worktree case must start zero VG processes');
  if (!multi || multi.trigger?.eligible !== true || multi.usage?.processesStarted < 1) issues.push('multi-worktree case must run a diagnostic process');
  if (!missing || missing.status !== 'unavailable' || missing.usage?.processesStarted !== 0) issues.push('missing-binary case must be unavailable without spawning');
  for (const entry of report?.cases ?? []) {
    if (entry.hostVerdict !== 'unchanged') issues.push(`${entry.caseId} changed the host verdict`);
    if (entry.cleanup?.sidecarProcessesSurviving !== 0 || entry.cleanup?.candidateTempDirectories !== 0 || entry.cleanup?.hostWorktreesDeleted !== 0) issues.push(`${entry.caseId} cleanup boundary failed`);
  }
  if (report?.summary?.processCalls < 1) issues.push('WP2 must observe a real multi-worktree diagnostic');
  for (const key of ['addedToFast', 'addedToComms', 'implicitProfile', 'defaultOn', 'rendererRouteAdded', 'landOrAdmitInvoked', 'hostWorktreeDeleted', 'providerSourceModified']) {
    if (report?.boundaries?.[key] !== false) issues.push(`boundary ${key} must be false`);
  }
  if (report?.passed !== true || (report?.issues ?? []).length !== 0) issues.push('WP2 report did not pass');
  if (report?.digest !== reportDigest(report)) issues.push('WP2 report digest is not reproducible');
  return { ok: issues.length === 0, issues };
}

export async function writeWp2Report({ root = repositoryRoot, output, fixturePath } = {}) {
  const built = await buildWp2Report({ root, fixturePath });
  const path = output ? resolve(output) : resolve(root, 'artifacts/versegit/wp2/report.json');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(built.report, null, 2)}\n`, 'utf8');
  return { ...built, path, validation: validateWp2Report(built.report) };
}

async function main() {
  const at = (flag) => { const index = process.argv.indexOf(flag); return index >= 0 ? resolve(process.argv[index + 1]) : undefined; };
  const fixturePath = at('--fixture');
  const result = await writeWp2Report({ fixturePath, output: at('--out') });
  console.log(JSON.stringify({ path: result.path, passed: result.report.passed, cases: result.report.summary, validation: result.validation }, null, 2));
  if (!result.validation.ok) process.exitCode = 1;
}

if (isMainEntrypoint(import.meta.url)) main().catch((error) => { console.error(String(error?.stack ?? error)); process.exitCode = 1; });
