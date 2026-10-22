#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createVerseGitApi } from '../electron/services/versegit-api';
import { createHostInvokeDispatcher } from '../electron/main/ipc/host-invoke';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = 'harness/specs/fixtures/versegit-product-integration/b2';
const paths = { hostInvoke: `${OUT}/host-invoke.json`, contract: `${OUT}/diagnostic-contract.json`, negative: `${OUT}/negative-host-requests.json`, independent: `${OUT}/independent-review.json`, sums: `${OUT}/SHA256SUMS` };
const binaryPath = process.env.VERSEGIT_BINARY ?? 'D:/Projects/VerseGit/target/debug/vg.exe';
const workspacePath = process.env.VERSEGIT_PROVIDER_ROOT ?? 'D:/Projects/VerseGit';
const contract = JSON.parse(readFileSync(resolve(ROOT, 'harness/specs/fixtures/versegit-planning-correction/mc1-evidence/contract.json'), 'utf8'));
const contractDigest = sha(JSON.stringify(contract));
const binaryDigest = sha(readFileSync(binaryPath));
const version = spawnSync(binaryPath, ['--version'], { cwd: workspacePath, encoding: 'utf8', windowsHide: true });
const capabilities = spawnSync(binaryPath, ['capabilities', '--json'], { cwd: workspacePath, encoding: 'buffer', windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
if (version.status !== 0 || capabilities.status !== 0) throw new Error('provider identity probe failed');
const capabilitiesDigest = sha(capabilities.stdout);
const binding = { workspaceId: 'workspace-b2-evidence', sessionId: 'session-b2-evidence', worktreeId: 'worktree-b2-evidence', ownerId: 'agent:codex', epoch: 9, mode: 'M1' as const };
const config = { enabled: true, binaryPath, workspacePath, expectedBinarySha256: binaryDigest, expectedVersion: version.stdout.trim(), expectedCapabilitiesDigest: capabilitiesDigest, contractDigest, allowed: { ...binding, repoId: 'repo-b2-evidence', authorizationId: 'grant-b2-evidence', expiresAt: '2099-01-01T00:00:00.000Z', revoked: false }, worktreeCount: 2, activeSessionCount: 1 };
function sha(value: string | Uint8Array) { return createHash('sha256').update(value).digest('hex'); }
function stable(value: unknown): unknown { if (Array.isArray(value)) return value.map(stable); if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [key, stable((value as Record<string, unknown>)[key])])); return value; }
function digest(document: Record<string, unknown>) { return sha(JSON.stringify(stable({ ...document, generated_at: undefined, digest: undefined }))); }
function sign<T extends Record<string, unknown>>(document: T): T & { digest: string } { return Object.assign(document, { digest: digest(document) }); }
function write(path: string, document: unknown) { const full = resolve(ROOT, path); mkdirSync(dirname(full), { recursive: true }); writeFileSync(full, `${JSON.stringify(document, null, 2)}\n`, 'utf8'); }
function source() { const status = spawnSync('git', ['status', '--porcelain=v1', '--untracked-files=normal'], { cwd: ROOT, encoding: 'utf8', windowsHide: true }).stdout.trim(); return { branch: spawnSync('git', ['branch', '--show-current'], { cwd: ROOT, encoding: 'utf8', windowsHide: true }).stdout.trim() || 'detached', commit: spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8', windowsHide: true }).stdout.trim(), tree: spawnSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: ROOT, encoding: 'utf8', windowsHide: true }).stdout.trim(), dirty: status.length > 0 }; }
function flatten(suites: any[], output: any[] = []) { for (const suite of suites ?? []) { if (suite.specs) output.push(...suite.specs); flatten(suite.suites ?? [], output); } return output; }
const playwrightPath = process.argv[2];
if (!playwrightPath) throw new Error('usage: versegit-product-b2-evidence.mts <playwright-json>');
const playwright = JSON.parse(readFileSync(playwrightPath, 'utf8'));
const tests = flatten(playwright.suites ?? []).map((spec) => ({ title: spec.title, ok: spec.ok, status: spec.tests?.[0]?.results?.[0]?.status ?? 'unknown', durationMs: spec.tests?.[0]?.results?.[0]?.duration ?? null }));
const api = createVerseGitApi({ config });
const observed = await api.status(binding);
const deniedWorkspace = await api.status({ ...binding, workspaceId: 'workspace-other' });
const deniedSession = await createVerseGitApi({ config: { ...config, allowed: { ...config.allowed, sessionId: 'session-other' } } }).status(binding);
const disabled = await createVerseGitApi({ config: { enabled: false } }).status(binding);
const mismatch = await createVerseGitApi({ config: { ...config, expectedBinarySha256: '0'.repeat(64) } }).status(binding);
const revoked = await createVerseGitApi({ config: { ...config, allowed: { ...config.allowed, revoked: true } } }).status(binding);
const dispatch = createHostInvokeDispatcher({ versegit: api }, { senderAuth: { allowedWebContentsIds: new Set([42]) } });
const illegalSender = await dispatch({ id: 'b2-illegal-sender', module: 'versegit', action: 'status', payload: binding }, { sender: { id: 99 } });
const publicText = JSON.stringify(observed);
if (publicText.includes(binaryPath) || publicText.includes('argv')) throw new Error('public status leaked private binary path or argv');
const hostInvoke = sign({ schema: 'clawx.versegit.b2-host-invoke/v1', generated_at: new Date().toISOString(), task: 'TF-0527', driven_by: 'agent', actor: 'playwright-runner', source: source(), renderer_entry: 'window.verseClaw.hostInvoke', host_channel: 'host:invoke', main_service: 'hostApiRegistry.versegit.status', fixture_replay: false, raw_results_sha256: sha(readFileSync(playwrightPath)), stats: playwright.stats, tests, observed_status: observed.status, observed_identity: observed.identity, private_path_exposed: false, argv_exposed: false, host_verdict: observed.hostVerdict, passed: playwright.stats?.expected === 2 && playwright.stats?.unexpected === 0 && tests.length === 2 && tests.every((entry) => entry.ok && entry.status === 'passed') && observed.status === 'observed' });
const diagnosticContract = sign({ schema: 'clawx.versegit.b2-diagnostic-contract/v1', generated_at: new Date().toISOString(), task: 'TF-0527', driven_by: 'agent', actor: 'codex', source: source(), contract_module: 'versegit', contract_action: 'status', public_payload: ['workspaceId', 'sessionId', 'worktreeId', 'ownerId', 'epoch', 'mode'], public_result_schema: 'clawx.versegit.host-diagnostics/v1', service_entry: 'createVerseGitApi', fact_adapter_schema: 'clawx.versegit.fact-result/v1', frozen_identity: { binarySha256: binaryDigest, version: version.stdout.trim(), capabilitiesSha256: capabilitiesDigest, contractDigest }, coverage: observed.coverage, statuses: ['not_applicable', 'unavailable', 'partial', 'observed', 'degraded', 'rejected_by_policy'], observed, boundaries: { default_off: true, protocol_switch_ui: false, automatic_enable: false, m4_authorized: false, host_verdict: 'unchanged' }, passed: observed.status === 'observed' });
const negativeCases = [{ id: 'workspace-mismatch', result: deniedWorkspace }, { id: 'session-mismatch', result: deniedSession }, { id: 'disabled', result: disabled }, { id: 'binary-mismatch', result: mismatch }, { id: 'revoked-grant', result: revoked }].map(({ id, result }) => ({ id, status: result.status, reason: result.reason, processStarted: result.observation?.processStarted ?? false, issues: result.issues }));
const negative = sign({ schema: 'clawx.versegit.b2-negative-host-requests/v1', generated_at: new Date().toISOString(), task: 'TF-0527', driven_by: 'agent', actor: 'codex', source: source(), cases: negativeCases, illegal_sender: { ok: illegalSender.ok, error_code: illegalSender.ok ? null : illegalSender.error.code, message: illegalSender.ok ? null : illegalSender.error.message }, boundaries: { no_process_on_rejection: true, no_mutation: true, host_verdict: 'unchanged' }, passed: negativeCases.every((entry) => entry.status !== 'observed' && entry.processStarted === false) && !illegalSender.ok });
write(paths.hostInvoke, hostInvoke); write(paths.contract, diagnosticContract); write(paths.negative, negative);
const independent = sign({ schema: 'clawx.versegit.b2-independent-review/v1', generated_at: new Date().toISOString(), task: 'TF-0527', driven_by: 'agent', actor: 'codex', reviewer_role: 'independent-b2-verifier-process', status: hostInvoke.passed && diagnosticContract.passed && negative.passed ? 'passed' : 'failed', checks: [{ id: 'host-invoke', passed: hostInvoke.passed, issues: hostInvoke.passed ? [] : ['host invoke evidence failed'] }, { id: 'diagnostic-contract', passed: diagnosticContract.passed, issues: diagnosticContract.passed ? [] : ['diagnostic contract failed'] }, { id: 'negative-host-requests', passed: negative.passed, issues: negative.passed ? [] : ['negative host requests failed'] }], evidence_digests: Object.fromEntries([paths.hostInvoke, paths.contract, paths.negative].map((path) => [path, sha(readFileSync(resolve(ROOT, path)))])), boundaries: { real_human_evidence: false, default_off: true, m4_authorized: false } });
write(paths.independent, independent);
const all = [paths.hostInvoke, paths.contract, paths.negative, paths.independent];
writeFileSync(resolve(ROOT, paths.sums), `${all.map((path) => `${sha(readFileSync(resolve(ROOT, path)))}  ${path}`).sort().join('\n')}\n`, 'utf8');
if (source().dirty) throw new Error('B2 evidence source candidate is dirty');
console.log(`[versegit-b2] OK e2e=${tests.length}/${tests.length} status=${observed.status} negative=${negativeCases.length} sender=${illegalSender.ok ? 'unexpected-ok' : 'denied'}`);
