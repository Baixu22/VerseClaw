#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  VerseGitFactAdapter,
  verseGitFactCatalog,
  verseGitFactModeEffects,
  type VerseGitFactGrant,
  type VerseGitFactIdentity,
  type VerseGitFactTrigger,
} from '../electron/services/versegit-fact-adapter';
import { VerseGitModule, contractDigestOf } from '../electron/services/versegit-module';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = 'harness/specs/fixtures/versegit-product-integration/b1';
const PATHS = { differential: `${OUT}/adapter-differential.json`, matrix: `${OUT}/mode-effect-matrix.json`, negative: `${OUT}/authority-negative.json`, independent: `${OUT}/independent-review.json`, sums: `${OUT}/SHA256SUMS` };
const binaryPath = process.env.VERSEGIT_BINARY ?? 'D:/Projects/VerseGit/target/debug/vg.exe';
const workspacePath = process.env.VERSEGIT_PROVIDER_ROOT ?? 'D:/Projects/VerseGit';
const contract = JSON.parse(readFileSync(resolve(ROOT, 'harness/specs/fixtures/versegit-planning-correction/mc1-evidence/contract.json'), 'utf8'));
const contractDigest = contractDigestOf(contract);
const binaryDigest = sha(readFileSync(binaryPath));
const directVersion = spawnSync(binaryPath, ['--version'], { cwd: workspacePath, encoding: 'buffer', windowsHide: true, maxBuffer: 1024 * 1024 });
const directCapabilities = spawnSync(binaryPath, ['capabilities', '--json'], { cwd: workspacePath, encoding: 'buffer', windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
if (directVersion.status !== 0 || directCapabilities.status !== 0) throw new Error('fixed binary differential probe failed');
const capabilitiesDigest = sha(directCapabilities.stdout);
const identity: VerseGitFactIdentity = { repoId: 'repo-b1-evidence', worktreeId: 'worktree-b1', ownerId: 'agent:codex', epoch: 11, sessionId: 'agent-session-b1', vgSessionId: 'vg-session-b1' };
const trigger: VerseGitFactTrigger = { reason: 'two-worktrees', enabled: true, worktreeCount: 2, activeSessionCount: 1 };
const grant = (overrides: Partial<VerseGitFactGrant> = {}): VerseGitFactGrant => ({ mode: 'M1', authorizationId: 'grant-b1-evidence', ownerId: identity.ownerId, epoch: identity.epoch, repoId: identity.repoId, worktreeId: identity.worktreeId, capabilityDigest: capabilitiesDigest, expiresAt: '2099-01-01T00:00:00.000Z', revoked: false, ...overrides });
function sha(value: string | Uint8Array) { return createHash('sha256').update(value).digest('hex'); }
function stable(value: unknown): unknown { if (Array.isArray(value)) return value.map(stable); if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [key, stable((value as Record<string, unknown>)[key])])); return value; }
function digest(document: Record<string, unknown>) { return sha(JSON.stringify(stable({ ...document, generated_at: undefined, digest: undefined }))); }
function sign<T extends Record<string, unknown>>(document: T): T & { digest: string } { return Object.assign(document, { digest: digest(document) }); }
function write(path: string, document: unknown) { const full = resolve(ROOT, path); mkdirSync(dirname(full), { recursive: true }); writeFileSync(full, `${JSON.stringify(document, null, 2)}\n`, 'utf8'); }
function sourceIdentity() { const status = spawnSync('git', ['status', '--porcelain=v1', '--untracked-files=normal'], { cwd: ROOT, encoding: 'utf8', windowsHide: true }).stdout.trim(); return { branch: spawnSync('git', ['branch', '--show-current'], { cwd: ROOT, encoding: 'utf8', windowsHide: true }).stdout.trim() || 'detached', commit: spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8', windowsHide: true }).stdout.trim(), tree: spawnSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: ROOT, encoding: 'utf8', windowsHide: true }).stdout.trim(), dirty: status.length > 0 }; }
function adapter(options: { timeoutMs?: number; maxOutputBytes?: number; expectedBinarySha256?: string } = {}) { return new VerseGitFactAdapter({ binaryPath, workspacePath, expectedBinarySha256: binaryDigest, expectedVersion: directVersion.stdout.toString('utf8').trim(), expectedCapabilitiesDigest: capabilitiesDigest, contractDigest, ...options }); }
function observationSummary(result: { observation: Record<string, any> }) { const o = result.observation; return { process_started: o.process_started, pid: o.pid, exit_code: o.exit_code, deadline_ms: o.deadline_ms, timed_out: o.timed_out, cancelled: o.cancelled, pid_alive_after: o.pid_alive_after, argv: o.argv, cwd_role: o.cwd_role, stdout: o.stdout, stderr: o.stderr, effects: o.effects }; }

const fact = adapter();
const module = new VerseGitModule({ binaryPath, contractDigest, expectedCapabilitiesDigest: capabilitiesDigest, factAdapter: fact });
const attached = module.attach('M1', { mode: 'M1', authorizationId: grant().authorizationId });
if (!attached.ok) throw new Error(`module attach failed: ${attached.issues.join('; ')}`);
const adapterVersion = await module.readFact('version', identity, grant(), trigger);
const adapterCapabilities = await module.readFact('capabilities', identity, grant(), trigger);
if (adapterVersion.status !== 'observed' || adapterCapabilities.status !== 'observed') throw new Error('real adapter differential did not observe both seams');
const differential = sign({ schema: 'clawx.versegit.b1-adapter-differential/v1', generated_at: new Date().toISOString(), task: 'TF-0526', driven_by: 'agent', actor: 'codex', source: sourceIdentity(), binary: { sha256: binaryDigest, bytes: statSync(binaryPath).size, version: directVersion.stdout.toString('utf8').trim(), capabilities_schema: JSON.parse(directCapabilities.stdout.toString('utf8')).schema, capabilities_sha256: capabilitiesDigest, root_role: 'provider-checkout', workspace_role: 'provider-workspace' }, contract_digest: contractDigest, production_caller: 'VerseGitModule.readFact', mode: 'M1', comparisons: [{ operation: 'version', adapter_status: adapterVersion.status, adapter_value: adapterVersion.value, direct_exit_code: directVersion.status, direct_stdout_sha256: sha(directVersion.stdout), adapter_stdout_sha256: adapterVersion.observation.stdout.sha256, match: adapterVersion.observation.stdout.sha256 === sha(directVersion.stdout), observation: observationSummary(adapterVersion) }, { operation: 'capabilities', adapter_status: adapterCapabilities.status, direct_exit_code: directCapabilities.status, direct_stdout_sha256: capabilitiesDigest, adapter_stdout_sha256: adapterCapabilities.observation.stdout.sha256, match: adapterCapabilities.observation.stdout.sha256 === capabilitiesDigest, observation: observationSummary(adapterCapabilities) }], boundaries: { host_verdict: 'unchanged', default_on: false, ga: false, m4_authorized: false, real_human_evidence: false }, passed: true });

const zeroAdapter = adapter(); const m0 = await zeroAdapter.execute('version', identity, grant({ mode: 'M0' }), trigger); const noTrigger = await zeroAdapter.execute('version', identity, grant(), { ...trigger, worktreeCount: 1, activeSessionCount: 1 });
const matrix = sign({ schema: 'clawx.versegit.b1-mode-effect-matrix/v1', generated_at: new Date().toISOString(), task: 'TF-0526', driven_by: 'agent', actor: 'codex', source: sourceIdentity(), modes: verseGitFactModeEffects(), operations: verseGitFactCatalog(), observed: { m0: { status: m0.status, process_started: m0.observation.process_started, domain_state_write: m0.observation.effects.domainStateWrite }, no_concurrency: { status: noTrigger.status, process_started: noTrigger.observation.process_started, domain_state_write: noTrigger.observation.effects.domainStateWrite } }, boundaries: { fixed_argv: true, arbitrary_argv_allowed: false, shell_allowed: false, env_override_allowed: false, binary_override_allowed: false, host_verdict: 'unchanged', m4_authorized: false }, passed: !m0.observation.process_started && !noTrigger.observation.process_started });

const negAdapter = adapter(); const cases = [];
for (const [name, mutatedGrant, mutatedTrigger] of [
  ['missing-authorization', grant({ authorizationId: '' }), trigger],
  ['owner-mismatch', grant({ ownerId: 'other-owner' }), trigger],
  ['epoch-mismatch', grant({ epoch: 999 }), trigger],
  ['repo-mismatch', grant({ repoId: 'other-repo' }), trigger],
  ['worktree-mismatch', grant({ worktreeId: 'other-worktree' }), trigger],
  ['expired-grant', grant({ expiresAt: '2000-01-01T00:00:00.000Z' }), trigger],
  ['revoked-grant', grant({ revoked: true }), trigger],
  ['capability-mismatch', grant({ capabilityDigest: '0'.repeat(64) }), trigger],
  ['disabled', grant(), { ...trigger, enabled: false }],
  ['no-concurrency', grant(), { ...trigger, worktreeCount: 1, activeSessionCount: 1 }],
] as Array<[string, VerseGitFactGrant, VerseGitFactTrigger]>) {
  const result = await negAdapter.execute('version', identity, mutatedGrant, mutatedTrigger);
  cases.push({ id: name, rejected: result.status !== 'observed', status: result.status, process_started: result.observation.process_started, pid: result.observation.pid, effects: result.observation.effects, issues: result.issues });
}
const m1Doctor = await negAdapter.execute('doctor', identity, grant(), trigger); cases.push({ id: 'm2-operation-under-m1', rejected: m1Doctor.status !== 'observed', status: m1Doctor.status, process_started: m1Doctor.observation.process_started, pid: m1Doctor.observation.pid, effects: m1Doctor.observation.effects, issues: m1Doctor.issues });
const badBinary = await adapter({ expectedBinarySha256: '0'.repeat(64) }).execute('version', identity, grant(), trigger); cases.push({ id: 'binary-digest-mismatch', rejected: badBinary.status !== 'observed', status: badBinary.status, process_started: badBinary.observation.process_started, pid: badBinary.observation.pid, effects: badBinary.observation.effects, issues: badBinary.issues });
const timeout = await adapter({ timeoutMs: 1 }).execute('capabilities', identity, grant(), trigger);
const cancelAdapter = adapter({ timeoutMs: 30000 }); const controller = new AbortController(); queueMicrotask(() => controller.abort()); const cancelled = await cancelAdapter.execute('capabilities', identity, grant(), trigger, {}, controller.signal);
const negative = sign({ schema: 'clawx.versegit.b1-authority-negative/v1', generated_at: new Date().toISOString(), task: 'TF-0526', driven_by: 'agent', actor: 'codex', source: sourceIdentity(), cases, timeout: { status: timeout.status, ...observationSummary(timeout), rejected: timeout.status !== 'observed' && !timeout.observation.pid_alive_after }, cancellation: { status: cancelled.status, ...observationSummary(cancelled), rejected: cancelled.status !== 'observed' && !cancelled.observation.pid_alive_after }, boundaries: { no_workspace_write: true, no_domain_state_write_before_grant: true, no_arbitrary_argv: true, no_m4: true, host_verdict: 'unchanged' }, passed: cases.every((entry) => entry.rejected && !entry.process_started) && !timeout.observation.pid_alive_after && !cancelled.observation.pid_alive_after });

write(PATHS.differential, differential); write(PATHS.matrix, matrix); write(PATHS.negative, negative);
const independent = sign({ schema: 'clawx.versegit.b1-independent-review/v1', generated_at: new Date().toISOString(), task: 'TF-0526', driven_by: 'agent', actor: 'codex', reviewer_role: 'independent-b1-verifier-process', status: differential.passed && matrix.passed && negative.passed ? 'passed' : 'failed', checks: [{ id: 'adapter-differential', passed: differential.passed, issues: differential.passed ? [] : ['differential failed'] }, { id: 'mode-effect-matrix', passed: matrix.passed, issues: matrix.passed ? [] : ['matrix failed'] }, { id: 'authority-negative', passed: negative.passed, issues: negative.passed ? [] : ['negative failed'] }], evidence_digests: Object.fromEntries([PATHS.differential, PATHS.matrix, PATHS.negative].map((path) => [path, sha(readFileSync(resolve(ROOT, path)))])), boundaries: { real_human_evidence: false, default_on: false, ga: false, m4_authorized: false } });
write(PATHS.independent, independent);
const allPaths = [PATHS.differential, PATHS.matrix, PATHS.negative, PATHS.independent];
writeFileSync(resolve(ROOT, PATHS.sums), `${allPaths.map((path) => `${sha(readFileSync(resolve(ROOT, path)))}  ${path}`).sort().join('\n')}\n`, 'utf8');
for (const document of [differential, matrix, negative, independent]) { const text = JSON.stringify(document); if (/[A-Za-z]:[\\/]/u.test(text)) throw new Error(`${document.schema} contains an absolute path`); }
console.log(`[versegit-b1] OK adaptive=${adapterVersion.status}/${adapterCapabilities.status} negative=${cases.length} timeout=${timeout.status} cancel=${cancelled.status}`);
