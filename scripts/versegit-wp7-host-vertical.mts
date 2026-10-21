#!/usr/bin/env -S node --import tsx
/**
 * WP7 real host vertical slice.
 *
 * This script creates a disposable Git repository and worktrees, drives real VerseGit
 * sessions/checks through VerseShell, composes a candidate tree, executes two real
 * VerseShell verification runs, turns the continuation observation into a host-owned
 * receipt, and then cleans every disposable resource. It never mutates the user repo.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChatRuntimeEvent } from '../shared/chat-runtime-events.ts';
import type { Observation } from '../shared/verseshell/types.ts';
import {
  buildBehaviorCoverage,
  type BehaviorCoverageReport,
} from '../electron/services/versegit-behavior-coverage.ts';
import {
  VerseGitObservationBridge,
  type ObservationBinding,
  type VerseGitBehaviorEvent,
} from '../electron/services/versegit-observation.ts';
import {
  VerseGitModule,
} from '../electron/services/versegit-module.ts';
import {
  VerseGitReceiptBridge,
  createVerificationPlan,
  type VerificationPlan,
  type VerseShellReceipt,
} from '../electron/services/versegit-receipt-bridge.ts';
import {
  createGovernedVerseShellProcessConfig,
} from '../openclaw_runtime/src/agents/verseshell/governed-exec.js';
import { VerseShellProcessManager } from '../openclaw_runtime/src/agents/verseshell/process-manager.js';
import { isMainEntrypoint } from './lib/entrypoint.mjs';

export const WP7_SCHEMA = 'clawx.versegit.wp7-host-vertical/v1';
export const WP7_FIXTURE_PATH = 'harness/specs/fixtures/versegit-planning-correction/wp7-host-vertical-fixture.json';
export const WP7_EVIDENCE_PATH = 'harness/specs/fixtures/versegit-planning-correction/wp7-evidence/report.json';
export const WP7_ARTIFACT_PATH = 'artifacts/versegit/wp7/host-vertical-report.json';
export const MC0_BASELINE_PATH = 'harness/specs/fixtures/versegit-planning-correction/mc0-evidence/baseline.json';
export const WP0_CONTRACT_PATH = 'harness/specs/fixtures/versegit-planning-correction/wp0-evidence/contract.json';
export const WP2_REPORT_PATH = 'harness/specs/fixtures/versegit-planning-correction/wp2-evidence/report.json';
export const VERSESHELL_CATALOG_DIGEST = 'sha256:67f78a723d582bf0809aab1f94352772c8a2818367b2f5e9d931722c06e979e8';
export const VERSESHELL_CATALOG_COUNT = '32';
export const VERSESHELL_RUNTIME_VERSION = '1.0.0';
export const VERSESHELL_PROTOCOL = 'verseshell.jsonl/v1';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PRICEDB_BASE = [
  'def charge(amount: int, currency: str = "USD") -> int:',
  '    """Charge the customer."""',
  '    return amount * 100',
  '',
  'def credit(amount: int) -> int:',
  '    """Credit the customer."""',
  '    return amount',
  '',
].join(String.fromCharCode(10));
const PRICEDB_CONSUMER = PRICEDB_BASE.replace('currency: str = "USD"', 'currency: str = "EUR"');
const PRICEDB_PRODUCER = PRICEDB_BASE.replace('    return amount' + String.fromCharCode(10), '    return amount + 1' + String.fromCharCode(10));
const NOTES_BASE = ['def note():', '    return 1', ''].join(String.fromCharCode(10));
const NOTES_EDITED = ['def note():', '    return 2', ''].join(String.fromCharCode(10));
const VERIFY_SCRIPT = `
const fs = require('node:fs');
const crypto = require('node:crypto');
const text = fs.readFileSync('pricedb.py', 'utf8');
const ok = text.includes('currency: str = "EUR"') && text.includes('return amount + 1');
const payload = {
  schema: 'clawx.wp7.candidate-check/v1',
  ok,
  contentDigest: crypto.createHash('sha256').update(text).digest('hex'),
};
process.stdout.write(JSON.stringify(payload) + String.fromCharCode(10));
process.stdout.write('wp7-proof-' + 'x'.repeat(24000) + String.fromCharCode(10));
if (!ok) process.exit(1);
`;

export function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export function stableJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : 'null';
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
  }
  return 'null';
}

function documentDigest(document: Record<string, unknown>): string {
  return sha256(stableJson({ ...document, generated_at: undefined, digest: undefined }));
}

function runGit(args: string[], cwd: string): string {
  try {
    return String(execFileSync('git', ['-c', 'core.autocrlf=false', ...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120_000,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    })).trim();
  } catch (error) {
    const failure = error as { stdout?: unknown; stderr?: unknown; status?: number | null };
    throw new Error(`git ${args[0] ?? 'command'} failed (${String(failure.status ?? 'unknown')}): ${String(failure.stderr ?? failure.stdout ?? error)}`);
  }
}

function recordShape(value: string, root: string, replacements: Record<string, string>): string {
  let output = value;
  for (const [needle, replacement] of Object.entries(replacements).sort((a, b) => b[0].length - a[0].length)) {
    output = output.split(needle).join(replacement);
    output = output.split(needle.replaceAll('\\', '/')).join(replacement);
  }
  output = output.split(root).join('<temp_root>').split(root.replaceAll('\\', '/')).join('<temp_root>');
  return output;
}

function captureText(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  return typeof record.text === 'string' ? record.text : typeof record.summary === 'string' ? record.summary : '';
}

function observationData(observation: Observation): Record<string, unknown> {
  return observation.data && typeof observation.data === 'object' && !Array.isArray(observation.data)
    ? observation.data as Record<string, unknown>
    : {};
}

export type GovernedCall = {
  id: string;
  route: 'verseshell-governed-aci';
  argvShape: string[];
  cwdRole: string;
  approvalRequired: boolean;
  approvedByHost: boolean;
  success: boolean;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  stdout: string;
  stderr: string;
  stdoutDigest: string;
  stderrDigest: string;
  observationDigest: string;
  processKeyDigest: string;
  capabilities: string[];
  authorityObserved: boolean;
};

function rawObservationCall(observation: Observation, processKey: string, approvalRequired: boolean): GovernedCall {
  const data = observationData(observation);
  const stdout = captureText(data.stdout);
  const stderr = captureText(data.stderr);
  const exitCode = typeof data.exit_code === 'number' && Number.isInteger(data.exit_code) ? data.exit_code : null;
  const timedOut = data.timed_out === true;
  const capabilities = Array.isArray(observation.meta?.capabilities_used)
    ? observation.meta.capabilities_used.filter((value): value is string => typeof value === 'string')
    : [];
  return {
    id: observation.id,
    route: 'verseshell-governed-aci',
    argvShape: [],
    cwdRole: '',
    approvalRequired,
    approvedByHost: approvalRequired,
    success: observation.ok === true && exitCode === 0 && !timedOut,
    exitCode,
    timedOut,
    durationMs: typeof observation.meta?.elapsed_ms === 'number' ? observation.meta.elapsed_ms : 0,
    stdout,
    stderr,
    stdoutDigest: sha256(stdout),
    stderrDigest: sha256(stderr),
    observationDigest: sha256(stableJson(observation)),
    processKeyDigest: sha256(processKey),
    capabilities,
    authorityObserved: observation.schema === 'verseshell.observation/v1'
      && observation.status === 'ok'
      && capabilities.includes('shell.exec'),
  };
}

async function governedCall(input: {
  manager: VerseShellProcessManager;
  env: NodeJS.ProcessEnv;
  cwd: string;
  argv: string[];
  timeoutMs: number;
  approvalId: string;
  root: string;
  replacements: Record<string, string>;
  cwdRole: string;
}): Promise<GovernedCall> {
  const config = createGovernedVerseShellProcessConfig({ cwd: input.cwd, env: input.env, timeoutMs: input.timeoutMs });
  const args = {
    argv: input.argv,
    cwd: '.',
    profile: 'auto',
    artifact: 'auto',
    timeout_ms: input.timeoutMs,
  };
  let client = await input.manager.getClient(config);
  let observation = await client.execute('exec.run', args, { timeoutMs: input.timeoutMs, effectful: true });
  let approvalRequired = false;
  if (observation.error?.code === 'E_NEEDS_APPROVAL') {
    const token = observationData(observation).approval_token;
    if (typeof token !== 'string' || !/^apv_[a-f0-9]{16}$/u.test(token)) {
      throw new Error('VerseShell did not return a valid host approval token');
    }
    approvalRequired = true;
    client = await input.manager.getClient({ ...config, approvalToken: token });
    observation = await client.execute('exec.run', { ...args, approval_token: token }, {
      timeoutMs: input.timeoutMs,
      effectful: true,
    });
  }
  const call = rawObservationCall(observation, client.processKey, approvalRequired);
  call.id = input.approvalId;
  call.cwdRole = input.cwdRole;
  call.argvShape = input.argv.map((arg) => recordShape(String(arg), input.root, input.replacements));
  return call;
}

function parseJson(text: string, label: string): Record<string, unknown> {
  try {
    const value = JSON.parse(text.trim());
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object');
    return value as Record<string, unknown>;
  } catch (error) {
    throw new Error(`${label} did not return a JSON object: ${String((error as Error)?.message ?? error)}`);
  }
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${label} is missing`);
  return value.trim();
}

function roadmapMeta(): { contractDigest: string; capabilitiesDigest: string } {
  const wp0 = JSON.parse(readFileSync(resolve(repositoryRoot, WP0_CONTRACT_PATH), 'utf8')) as Record<string, unknown>;
  const binary = (wp0.binary_identity ?? {}) as Record<string, unknown>;
  return {
    contractDigest: requiredString(binary.consumer_contract_digest, 'WP0 consumer contract digest'),
    capabilitiesDigest: requiredString(binary.capabilities_digest, 'WP0 capabilities digest'),
  };
}

function verseshellEnv(aeDigest: string): NodeJS.ProcessEnv {
  return {
    VERSESHELL_RUNTIME_VERSION: VERSESHELL_RUNTIME_VERSION,
    VERSESHELL_SERVER_PROTOCOL: VERSESHELL_PROTOCOL,
    VERSESHELL_OPERATION_CATALOG_DIGEST: VERSESHELL_CATALOG_DIGEST,
    VERSESHELL_OPERATION_CATALOG_COUNT: VERSESHELL_CATALOG_COUNT,
    VERSESHELL_AE_SHA256: aeDigest,
    VERSESHELL_OS_SHELL: 'powershell',
  };
}

export type ProviderCall = {
  id: string;
  route: 'host-owned-sidecar-fixed-argv';
  argvShape: string[];
  cwdRole: string;
  success: boolean;
  exitCode: number | null;
  stdoutDigest: string;
  stderrDigest: string;
};

async function invokeVg(input: {
  label: string;
  cwd: string;
  cwdRole: string;
  args: string[];
  vgBinary: string;
  root: string;
  replacements: Record<string, string>;
  providerCalls: ProviderCall[];
  timeoutMs: number;
  expectJson?: boolean;
}): Promise<Record<string, unknown>> {
  let stdout = '';
  let stderr = '';
  let exitCode: number | null = null;
  try {
    stdout = String(execFileSync(input.vgBinary, input.args, {
      cwd: input.cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: input.timeoutMs,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    })).trim();
    exitCode = 0;
  } catch (error) {
    const failure = error as { stdout?: unknown; stderr?: unknown; status?: number | null };
    stdout = String(failure.stdout ?? '').trim();
    stderr = String(failure.stderr ?? failure.message ?? error).replace(/\r/g, '');
    exitCode = typeof failure.status === 'number' ? failure.status : null;
  }
  const call: ProviderCall = {
    id: input.label,
    route: 'host-owned-sidecar-fixed-argv',
    argvShape: [input.vgBinary, ...input.args].map((arg) => recordShape(String(arg), input.root, input.replacements)),
    cwdRole: input.cwdRole,
    success: exitCode === 0,
    exitCode,
    stdoutDigest: sha256(stdout),
    stderrDigest: sha256(stderr),
  };
  input.providerCalls.push(call);
  if (!call.success) throw new Error(`${input.label} failed: ${stderr.slice(0, 400)}`);
  if (input.expectJson === false) return { text: stdout };
  return parseJson(stdout, input.label);
}

function toolStarted(runId: string, sessionKey: string, seq: number, toolCallId: string, name: string, args: unknown, ts: number): ChatRuntimeEvent {
  return { type: 'tool.started', runId, sessionKey, seq, ts, toolCallId, name, args };
}

function toolCompleted(runId: string, sessionKey: string, seq: number, toolCallId: string, name: string, result: unknown, ts: number, isError = false): ChatRuntimeEvent {
  return { type: 'tool.completed', runId, sessionKey, seq, ts, toolCallId, name, result, isError };
}

function advisoryFacts(document: Record<string, unknown>): Array<{ kind: string; file: string | null; line: number | null }> {
  const advisory = Array.isArray(document.advisories) ? document.advisories : [];
  return advisory
    .filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object' && !Array.isArray(entry)))
    .map((entry) => ({
      kind: typeof entry.kind === 'string' ? entry.kind : 'unknown',
      file: typeof entry.file === 'string' ? entry.file : null,
      line: typeof entry.line === 'number' && Number.isInteger(entry.line) ? entry.line : null,
    }));
}

function normalizedOutcome(input: {
  producerConsumerKinds: string[];
  ownWriteKinds: string[];
  crossWorktreeViolations: number;
  candidateMaterialized: boolean;
  candidateCheckOk: boolean;
  wrongReceiptStatus: string;
  continuationVerdict: string;
  hostVerdictBefore: string;
  hostVerdictAfter: string;
  cleanup: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    producerConsumerKinds: [...input.producerConsumerKinds].sort(),
    ownWriteKinds: [...input.ownWriteKinds].sort(),
    crossWorktreeViolations: input.crossWorktreeViolations,
    candidateMaterialized: input.candidateMaterialized,
    candidateCheckOk: input.candidateCheckOk,
    wrongReceiptStatus: input.wrongReceiptStatus,
    continuationVerdict: input.continuationVerdict,
    hostVerdictBefore: input.hostVerdictBefore,
    hostVerdictAfter: input.hostVerdictAfter,
    cleanup: input.cleanup,
  };
}

export async function buildWp7Report({
  root = repositoryRoot,
  fixturePath = resolve(root, WP7_FIXTURE_PATH),
  generatedAt = new Date().toISOString(),
}: {
  root?: string;
  fixturePath?: string;
  generatedAt?: string;
} = {}): Promise<Record<string, unknown>> {
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as Record<string, unknown>;
  if (fixture.schema !== 'clawx.versegit.wp7-host-vertical-fixture/v1') throw new Error(`WP7 fixture schema mismatch: ${String(fixture.schema)}`);
  const mc0 = JSON.parse(readFileSync(resolve(root, MC0_BASELINE_PATH), 'utf8')) as Record<string, unknown>;
  const mc0Binary = (mc0.binary ?? {}) as Record<string, unknown>;
  const vgBinary = requiredString(mc0Binary.path, 'MC0 VerseGit binary path');
  if (!existsSync(vgBinary)) throw new Error(`VerseGit binary is unavailable: ${vgBinary}`);
  const vgDigest = sha256(readFileSync(vgBinary));
  if (vgDigest !== mc0Binary.sha256) throw new Error('VerseGit binary digest drifted from MC0');
  const aeBinary = resolve(root, 'resources/bin/win32-x64/ae.exe');
  if (!existsSync(aeBinary)) throw new Error('Bundled VerseShell ae.exe is unavailable');
  const aeDigest = sha256(readFileSync(aeBinary));
  const env = verseshellEnv(aeDigest);
  const manager = new VerseShellProcessManager({
    resolveBinary: () => ({ path: aeBinary, source: 'verified-bundled', verified: true }),
  });
  const rootBase = process.env.VERSEGIT_WP7_TEMP_ROOT || process.env.TEMP || process.env.TMP || tmpdir();
  mkdirSync(rootBase, { recursive: true });
  const runRoot = mkdtempSync(join(rootBase, 'versegit-wp7-'));
  const repo = join(runRoot, 'repo');
  const producerWorktree = join(runRoot, 'producer');
  const consumerWorktree = join(runRoot, 'consumer');
  const candidateWorktree = join(runRoot, 'candidate');
  const calls: GovernedCall[] = [];
  const providerCalls: ProviderCall[] = [];
  const replacements: Record<string, string> = {
    [vgBinary]: '<vg_binary>',
    [aeBinary]: '<ae_binary>',
    [process.execPath]: '<node_executable>',
    [repo]: '<repo>',
    [producerWorktree]: '<producer_worktree>',
    [consumerWorktree]: '<consumer_worktree>',
    [candidateWorktree]: '<candidate_worktree>',
    [runRoot]: '<temp_root>',
  };
  const timeoutMs = typeof fixture.maxDurationMs === 'number' ? fixture.maxDurationMs : 240_000;
  const startedAt = Date.now();
  let cleanup: Record<string, unknown> = { status: 'not_run', survivors: [] };
  let error: string | null = null;
  try {
    mkdirSync(repo, { recursive: true });
    runGit(['init', '--quiet', '-b', 'main'], repo);
    runGit(['config', 'user.name', 'versegit-wp7'], repo);
    runGit(['config', 'user.email', 'versegit-wp7@example.invalid'], repo);
    writeFileSync(join(repo, 'pricedb.py'), PRICEDB_BASE, 'utf8');
    runGit(['add', 'pricedb.py'], repo);
    runGit(['commit', '--quiet', '-m', 'base'], repo);
    runGit(['worktree', 'add', '--quiet', '-b', 'producer', producerWorktree], repo);
    runGit(['worktree', 'add', '--quiet', '-b', 'consumer', consumerWorktree], repo);

    await invokeVg({ label: 'vg-init', cwd: repo, cwdRole: 'repo', args: ['init', '--json'], vgBinary, root: runRoot, replacements, providerCalls, timeoutMs });
    const versionDocument = await invokeVg({ label: 'vg-version', cwd: repo, cwdRole: 'repo', args: ['--version'], vgBinary, root: runRoot, replacements, providerCalls, timeoutMs, expectJson: false });
    const vgVersion = requiredString(versionDocument.text, 'VG version text');
    const capabilities = await invokeVg({ label: 'vg-capabilities', cwd: repo, cwdRole: 'repo', args: ['capabilities', '--json'], vgBinary, root: runRoot, replacements, providerCalls, timeoutMs });
    const capabilitiesSchema = requiredString(capabilities.schema, 'VG capabilities schema');
    const safety = (capabilities.safety ?? {}) as Record<string, unknown>;
    const verdictCapability = (capabilities.verdict ?? {}) as Record<string, unknown>;
    if (safety.default_enable !== false) throw new Error('VG default_enable changed');
    if (verdictCapability.single_green_light !== false) throw new Error('VG single_green_light changed');

    const startSession = async (label: string, actor: string, worktree: string) => {
      const result = await invokeVg({
        label, cwd: repo, cwdRole: 'repo',
        args: ['session', 'start', '--json', '--actor', actor, '--worktree', worktree, '--client', 'manual'],
        vgBinary, root: runRoot, replacements, providerCalls, timeoutMs,
      });
      return requiredString(result.session_id, `${label} session_id`);
    };
    const producerVgSessionRaw = await startSession('vg-session-start-producer', 'agent:wp7-producer', producerWorktree);
    const consumerVgSessionRaw = await startSession('vg-session-start-consumer', 'agent:wp7-consumer', consumerWorktree);
    const selfWriterVgSessionRaw = await startSession('vg-session-start-self-writer', 'agent:wp7-self-writer', producerWorktree);
    replacements[producerVgSessionRaw] = '<producer_vg_session>';
    replacements[consumerVgSessionRaw] = '<consumer_vg_session>';
    replacements[selfWriterVgSessionRaw] = '<self_writer_vg_session>';
    const producerVgSession = `vg-session-producer-${sha256(producerVgSessionRaw).slice(0, 16)}`;
    const consumerVgSession = `vg-session-consumer-${sha256(consumerVgSessionRaw).slice(0, 16)}`;
    const repoId = `repo-${sha256(repo).slice(0, 16)}`;
    const producerWorktreeId = `worktree-producer-${sha256(producerWorktree).slice(0, 16)}`;
    const consumerWorktreeId = `worktree-consumer-${sha256(consumerWorktree).slice(0, 16)}`;
    const producerAgentSessionId = `agent-session-producer-${sha256('producer').slice(0, 12)}`;
    const consumerAgentSessionId = `agent-session-consumer-${sha256('consumer').slice(0, 12)}`;
    const epoch = 7;
    const producerBinding: ObservationBinding = {
      runId: 'run-wp7-producer', sessionKey: 'session-wp7-producer', traceId: 'trace-wp7-producer', requestId: 'request-wp7-producer',
      repoId, worktreeId: producerWorktreeId, agentSessionId: producerAgentSessionId, vgSessionId: producerVgSession,
      ownerId: 'owner-wp7-producer', actor: 'agent:codex', epoch, boundAt: Date.now(),
    };
    const consumerBinding: ObservationBinding = {
      runId: 'run-wp7-consumer', sessionKey: 'session-wp7-consumer', traceId: 'trace-wp7-consumer', requestId: 'request-wp7-consumer',
      repoId, worktreeId: consumerWorktreeId, agentSessionId: consumerAgentSessionId, vgSessionId: consumerVgSession,
      ownerId: 'owner-wp7-consumer', actor: 'agent:codex', epoch, boundAt: Date.now(),
    };
    const observationBridge = new VerseGitObservationBridge();
    for (const binding of [producerBinding, consumerBinding]) {
      const attached = observationBridge.bind(binding);
      if (attached.status !== 'attached') throw new Error(`observation binding failed for ${binding.runId}: ${attached.issues.join('; ')}`);
    }
    const observed: VerseGitBehaviorEvent[] = [];
    const ingest = (event: ChatRuntimeEvent, context: Record<string, unknown>) => {
      const result = observationBridge.ingest(event, context);
      if (!result.event) throw new Error(`host event was not observed: ${result.status} ${result.issues.join('; ')}`);
      observed.push(result.event);
      return result;
    };
    const now = Date.now();
    ingest(toolStarted('run-wp7-producer', 'session-wp7-producer', 1, 'call-producer-read', 'Read', { path: 'pricedb.py' }, now), { epoch, ownerId: 'owner-wp7-producer', requestId: 'request-wp7-producer-read', traceId: 'trace-wp7-producer-read', eventId: 'producer-read-start' });
    ingest(toolCompleted('run-wp7-producer', 'session-wp7-producer', 2, 'call-producer-read', 'Read', { contentDigest: sha256(PRICEDB_BASE), lines: [1, 3] }, now + 1), { epoch, ownerId: 'owner-wp7-producer', requestId: 'request-wp7-producer-read', traceId: 'trace-wp7-producer-read', eventId: 'producer-read-end' });
    ingest(toolStarted('run-wp7-consumer', 'session-wp7-consumer', 1, 'call-consumer-write', 'Edit', { path: 'pricedb.py', kind: 'modify_signature' }, now + 2), { epoch, ownerId: 'owner-wp7-consumer', requestId: 'request-wp7-consumer-write', traceId: 'trace-wp7-consumer-write', eventId: 'consumer-write-start' });
    ingest(toolCompleted('run-wp7-consumer', 'session-wp7-consumer', 2, 'call-consumer-write', 'Edit', { contentDigest: sha256(PRICEDB_CONSUMER), ok: true }, now + 3), { epoch, ownerId: 'owner-wp7-consumer', requestId: 'request-wp7-consumer-write', traceId: 'trace-wp7-consumer-write', eventId: 'consumer-write-end' });

    await invokeVg({ label: 'vg-observe-producer-read', cwd: repo, cwdRole: 'repo', args: ['observe', 'read', '--json', '--session', producerVgSessionRaw, '--path', 'pricedb.py', '--line-start', '1', '--line-end', '3'], vgBinary, root: runRoot, replacements, providerCalls, timeoutMs, expectJson: false });
    writeFileSync(join(consumerWorktree, 'pricedb.py'), PRICEDB_CONSUMER, 'utf8');
    await invokeVg({ label: 'vg-observe-consumer-write', cwd: repo, cwdRole: 'repo', args: ['observe', 'write', '--json', '--session', consumerVgSessionRaw, '--path', 'pricedb.py', '--kind', 'modify_signature'], vgBinary, root: runRoot, replacements, providerCalls, timeoutMs, expectJson: false });
    const producerCheck = await invokeVg({ label: 'vg-check-producer-stale-read', cwd: repo, cwdRole: 'repo', args: ['check', '--json', '--file', 'pricedb.py', '--session', producerVgSessionRaw], vgBinary, root: runRoot, replacements, providerCalls, timeoutMs });
    writeFileSync(join(producerWorktree, 'notes.py'), NOTES_BASE, 'utf8');
    await invokeVg({ label: 'vg-observe-self-read', cwd: repo, cwdRole: 'repo', args: ['observe', 'read', '--json', '--session', selfWriterVgSessionRaw, '--path', 'notes.py', '--line-start', '1', '--line-end', '2'], vgBinary, root: runRoot, replacements, providerCalls, timeoutMs, expectJson: false });
    writeFileSync(join(producerWorktree, 'notes.py'), NOTES_EDITED, 'utf8');
    await invokeVg({ label: 'vg-observe-self-write', cwd: repo, cwdRole: 'repo', args: ['observe', 'write', '--json', '--session', selfWriterVgSessionRaw, '--path', 'notes.py', '--kind', 'modify_body'], vgBinary, root: runRoot, replacements, providerCalls, timeoutMs, expectJson: false });
    const ownWriteCheck = await invokeVg({ label: 'vg-check-self-own-write', cwd: repo, cwdRole: 'repo', args: ['check', '--json', '--file', 'notes.py', '--session', selfWriterVgSessionRaw], vgBinary, root: runRoot, replacements, providerCalls, timeoutMs });
    const producerConsumerKinds = advisoryFacts(producerCheck).map((entry) => entry.kind);
    const ownWriteKinds = advisoryFacts(ownWriteCheck).map((entry) => entry.kind);
    if (!producerConsumerKinds.includes('ssi/stale-read')) throw new Error('VG producer-consumer stale-read positive did not fire');
    if (ownWriteKinds.length !== 0) throw new Error('VG own-write negative control was not silent');

    writeFileSync(join(producerWorktree, 'pricedb.py'), PRICEDB_PRODUCER, 'utf8');
    await invokeVg({ label: 'vg-observe-producer-write', cwd: repo, cwdRole: 'repo', args: ['observe', 'write', '--json', '--session', producerVgSessionRaw, '--path', 'pricedb.py', '--kind', 'modify_body'], vgBinary, root: runRoot, replacements, providerCalls, timeoutMs, expectJson: false });
    runGit(['add', 'pricedb.py'], consumerWorktree);
    runGit(['commit', '--quiet', '-m', 'consumer signature'], consumerWorktree);
    runGit(['add', 'pricedb.py'], producerWorktree);
    runGit(['commit', '--quiet', '-m', 'producer body'], producerWorktree);
    const producerHead = runGit(['rev-parse', 'HEAD'], producerWorktree);
    const consumerHead = runGit(['rev-parse', 'HEAD'], consumerWorktree);
    const mergeOutput = runGit(['merge-tree', '--write-tree', 'producer', 'consumer'], repo);
    const treeOid = mergeOutput.split(String.fromCharCode(10)).map((line) => line.trim()).find((line) => /^[0-9a-f]{40,64}$/u.test(line));
    if (!treeOid) throw new Error('git merge-tree did not return a candidate tree');
    const candidateCommit = runGit(['commit-tree', treeOid, '-p', producerHead, '-p', consumerHead, '-m', 'wp7 composed candidate'], repo);
    runGit(['worktree', 'add', '--quiet', '--detach', candidateWorktree, candidateCommit], repo);
    const candidateFile = readFileSync(join(candidateWorktree, 'pricedb.py'), 'utf8');
    if (!candidateFile.includes('currency: str = "EUR"') || !candidateFile.includes('return amount + 1')) {
      throw new Error('composed candidate does not contain producer and consumer changes');
    }
    writeFileSync(join(candidateWorktree, 'verify.cjs'), VERIFY_SCRIPT, 'utf8');
    const candidateId = sha256(stableJson({
      schemaVersion: 1,
      repoId,
      baseOid: runGit(['rev-parse', 'main'], repo),
      parentOrder: [producerHead, consumerHead],
      materializedTreeOid: treeOid,
      inputDigest: sha256(`${PRICEDB_CONSUMER}
${PRICEDB_PRODUCER}`),
    }));

    const createCandidatePlan = (runId: string) => createVerificationPlan({
      runId,
      candidateId,
      checkId: 'candidate-composite-check',
      owner: 'owner-wp7-host',
      epoch,
      authorizationId: 'host-policy-wp7-verification',
      commands: [{
        argv: [process.execPath, 'verify.cjs'],
        cwd: candidateWorktree,
        env: {},
        effect: 'read',
        retry: 'never',
        expectedArtifacts: ['stdout', 'stderr'],
      }],
      requiredScope: 'full',
    });
    const primaryPlan = createCandidatePlan('run-wp7-primary');
    const continuationPlan = createCandidatePlan('run-wp7-continuation');
    if (!primaryPlan.plan || primaryPlan.issues.length > 0) throw new Error(`primary plan invalid: ${primaryPlan.issues.join('; ')}`);
    if (!continuationPlan.plan || continuationPlan.issues.length > 0) throw new Error(`continuation plan invalid: ${continuationPlan.issues.join('; ')}`);
    const receiptBridge = new VerseGitReceiptBridge();
    if (receiptBridge.registerPlan(primaryPlan.plan).status !== 'accepted') throw new Error('primary plan was not registered');
    if (receiptBridge.registerPlan(continuationPlan.plan).status !== 'accepted') throw new Error('continuation plan was not registered');

    const runCandidateCheck = async (label: string) => {
      const call = await governedCall({
        manager, env, cwd: candidateWorktree,
        argv: [process.execPath, 'verify.cjs'],
        timeoutMs,
        approvalId: label,
        root: runRoot,
        replacements,
        cwdRole: 'candidate_worktree',
      });
      calls.push(call);
      if (!call.success) throw new Error(`${label} failed: ${call.stderr.slice(0, 400)}`);
      const firstLine = call.stdout.split(String.fromCharCode(10)).find((line) => line.trim().startsWith('{')) ?? '';
      const parsed = parseJson(firstLine, label);
      return { call, parsed };
    };
    const primaryRun = await runCandidateCheck('verseshell-candidate-primary');
    const primaryCheckOk = primaryRun.parsed.ok === true && primaryRun.parsed.schema === 'clawx.wp7.candidate-check/v1';
    if (!primaryCheckOk) throw new Error('host candidate check did not pass');
    const hostVerdictBefore = primaryCheckOk ? 'pass' : 'fail';

    const makeReceipt = (plan: VerificationPlan, call: GovernedCall, cleanupStatus: VerseShellReceipt['cleanupStatus'], receiptId: string): VerseShellReceipt => {
      const command = plan.commands[0];
      return {
        schema: 'clawx.verseshell.execution-receipt/v2',
        receiptId,
        planId: plan.runId,
        planDigest: requiredString(plan.planDigest, 'plan digest'),
        candidateId: plan.candidateId,
        checkId: plan.checkId,
        ownerId: plan.owner,
        epoch: plan.epoch,
        authorizationId: plan.authorizationId,
        argvDigest: sha256(JSON.stringify(command.argv)),
        cwdDigest: sha256(JSON.stringify(command.cwd)),
        envDigest: sha256(JSON.stringify(command.env)),
        executionInputDigest: sha256(JSON.stringify({ argv: command.argv, cwd: command.cwd, env: command.env })),
        requiredScope: plan.requiredScope,
        artifactDigests: [...new Set([call.observationDigest, call.stdoutDigest, call.stderrDigest])],
        cleanupStatus,
        status: call.timedOut ? 'timed-out' : 'exited',
        exitCode: call.exitCode,
        signal: null,
        durationMs: call.durationMs,
        stdoutDigest: call.stdoutDigest,
        stderrDigest: call.stderrDigest,
        processKey: call.processKeyDigest,
        authority: { writer: 'verseshell', trusted_source: 'clawx-host-process-artifact-authority' },
        origin: 'verseshell',
        realVerseshell: call.authorityObserved,
      };
    };

    const wrongReceipt = {
      ...makeReceipt(primaryPlan.plan, primaryRun.call, 'failed', 'receipt-wp7-wrong-candidate'),
      candidateId: 'candidate-wrong',
    };
    const wrongReceiptResult = receiptBridge.receive(primaryPlan.plan.runId, wrongReceipt);
    if (wrongReceiptResult.status !== 'rejected_by_policy') throw new Error('wrong-candidate receipt was not rejected');
    const hostVerdictAfterFailure = hostVerdictBefore;

    const continuationRun = await runCandidateCheck('verseshell-candidate-continuation');
    const continuationCheckOk = continuationRun.parsed.ok === true && continuationRun.parsed.schema === 'clawx.wp7.candidate-check/v1';
    if (!continuationCheckOk) throw new Error('continuation candidate check did not pass');

    const producerSeal = observationBridge.detach('run-wp7-producer', { epoch, ownerId: 'owner-wp7-producer', reason: 'wp7-evidence-sealed' });
    const consumerSeal = observationBridge.detach('run-wp7-consumer', { epoch, ownerId: 'owner-wp7-consumer', reason: 'wp7-evidence-sealed' });
    if (producerSeal.status !== 'detached' || consumerSeal.status !== 'detached') throw new Error('observation sessions did not detach cleanly');
    const lateProducerEvent = observationBridge.ingest(
      toolStarted('run-wp7-producer', 'session-wp7-producer', 9, 'late-read', 'Read', { path: 'pricedb.py' }, now + 9),
      { epoch, ownerId: 'owner-wp7-producer', requestId: 'request-late', traceId: 'trace-late', eventId: 'late-event' },
    );
    if (lateProducerEvent.status !== 'stale') throw new Error('late event after detach was not stale');

    await invokeVg({ label: 'vg-session-end-consumer', cwd: repo, cwdRole: 'repo', args: ['session', 'end', consumerVgSessionRaw, '--reason', 'wp7-complete', '--json'], vgBinary, root: runRoot, replacements, providerCalls, timeoutMs, expectJson: false });
    await invokeVg({ label: 'vg-session-end-producer', cwd: repo, cwdRole: 'repo', args: ['session', 'end', producerVgSessionRaw, '--reason', 'wp7-complete', '--json'], vgBinary, root: runRoot, replacements, providerCalls, timeoutMs, expectJson: false });
    await invokeVg({ label: 'vg-session-end-self-writer', cwd: repo, cwdRole: 'repo', args: ['session', 'end', selfWriterVgSessionRaw, '--reason', 'wp7-complete', '--json'], vgBinary, root: runRoot, replacements, providerCalls, timeoutMs, expectJson: false });

    await manager.shutdownAll();
    const processSurvivors = manager.list().length;
    const deleted: string[] = [];
    const deletionErrors: string[] = [];
    for (const [role, path] of [['candidate', candidateWorktree], ['consumer', consumerWorktree], ['producer', producerWorktree]] as const) {
      try {
        if (existsSync(path)) runGit(['worktree', 'remove', '--force', path], repo);
        deleted.push(role);
      } catch (cleanupError) {
        deletionErrors.push(`${role}: ${String((cleanupError as Error)?.message ?? cleanupError).slice(0, 240)}`);
      }
    }
    try { runGit(['worktree', 'prune'], repo); } catch (pruneError) { deletionErrors.push(`prune: ${String((pruneError as Error)?.message ?? pruneError).slice(0, 240)}`); }
    rmSync(runRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    const worktreeSurvivors = [producerWorktree, consumerWorktree, candidateWorktree].filter((path) => existsSync(path)).length;
    const tempRootRemoved = !existsSync(runRoot);
    cleanup = {
      status: processSurvivors === 0 && worktreeSurvivors === 0 && tempRootRemoved && deletionErrors.length === 0 ? 'clean' : 'recovery_required',
      processesDeleted: processSurvivors === 0,
      processSurvivors,
      worktreesDeleted: deleted.length,
      worktreeSurvivors,
      tempRootRemoved,
      deletionErrors,
      hostWorktreesDeleted: 0,
    };

    const validReceipt = makeReceipt(continuationPlan.plan, continuationRun.call, cleanup.status === 'clean' ? 'clean' : 'failed', 'receipt-wp7-continuation');
    const continuationReceiptResult = receiptBridge.receive(continuationPlan.plan.runId, validReceipt);
    const abandonedVerdict = receiptBridge.verdict(primaryPlan.plan.runId);
    const continuationVerdict = receiptBridge.verdict(continuationPlan.plan.runId);
    const hostVerdictAfter = hostVerdictBefore;

    const sealedEvents = [producerSeal.sessionEnd, consumerSeal.sessionEnd].filter((event): event is VerseGitBehaviorEvent => Boolean(event));
    const behaviorCoverage: BehaviorCoverageReport = buildBehaviorCoverage({ events: [...observed, ...sealedEvents] });
    const crossWorktreeViolations = observed.filter((event) => (
      (event.runId === 'run-wp7-producer' && event.worktreeId !== producerWorktreeId)
      || (event.runId === 'run-wp7-consumer' && event.worktreeId !== consumerWorktreeId)
    )).length;
    const contractBindings = roadmapMeta();
    const module = new VerseGitModule({
      binaryPath: vgBinary,
      cwd: repo,
      contractDigest: contractBindings.contractDigest,
      expectedCapabilitiesDigest: contractBindings.capabilitiesDigest,
      run: () => { throw new Error('WP7 forbids direct provider execution'); },
    });
    const attached = module.attach('M3', { mode: 'M3', authorizationId: 'host-policy-wp7-module', promotedFrom: 'M2' });
    if (!attached.ok) throw new Error(`VG module M3 attach failed: ${attached.issues.join('; ')}`);
    const moduleReport = module.buildReport({
      mode: 'M3',
      component: 'versegit-wp7-host-vertical',
      trigger: { reason: 'multiple-worktrees', worktreeCount: 3, activeSessionCount: 2 },
      repository: { repoId, worktrees: [producerWorktreeId, consumerWorktreeId] },
      identity: {
        repoId,
        worktreeIds: [producerWorktreeId, consumerWorktreeId],
        agentSessionIds: [producerAgentSessionId, consumerAgentSessionId],
        vgSessionIds: [producerVgSession, consumerVgSession],
        epoch,
      },
      correlation: { runId: continuationPlan.plan.runId, requestId: 'request-wp7-continuation', traceId: 'trace-wp7-continuation', epoch },
      sessions: [
        { agentSessionId: producerAgentSessionId, vgSessionId: producerVgSession, worktreeId: producerWorktreeId, epoch, traceId: 'trace-wp7-producer', status: 'detached' },
        { agentSessionId: consumerAgentSessionId, vgSessionId: consumerVgSession, worktreeId: consumerWorktreeId, epoch, traceId: 'trace-wp7-consumer', status: 'detached' },
      ],
      facts: {
        conflicts: advisoryFacts(producerCheck),
        warnings: [],
        unknowns: behaviorCoverage.knownGaps,
      },
      coverage: {
        declared: ['fileRead', 'fileWrite', 'test'],
        unobserved: ['shellRead', 'directFs', 'mcpWrite', 'network', 'browser'],
        vector: behaviorCoverage.coverageVector,
      },
      result: { status: continuationVerdict.status === 'observed' && cleanup.status === 'clean' ? 'observed' : 'partial', reasons: continuationVerdict.reasons.filter((reason): reason is 'unmeasured' => reason === 'unmeasured') },
      verification: {
        status: continuationReceiptResult.status === 'accepted' && continuationVerdict.dimensions.execution === 'verified' ? 'verified' : 'partial',
        executor: 'verseshell',
        receiptId: validReceipt.receiptId,
        realVerseshellExecution: continuationVerdict.realVerseshellExecution,
        dimensions: continuationVerdict.dimensions,
      },
      candidate: {
        candidateId,
        baseOid: runGit(['rev-parse', 'main'], repositoryRoot),
        parentHeads: [producerHead, consumerHead],
        materializedTreeOid: treeOid,
        commitOid: candidateCommit,
        inputDigest: sha256(`${PRICEDB_CONSUMER}
${PRICEDB_PRODUCER}`),
      },
      timings: { orchestrationMs: Date.now() - startedAt },
      digests: { candidate: candidateId, evidence: continuationVerdict.evidenceGrade },
    });
    const publicCalls = calls.map(({ stdout, stderr, ...rest }) => rest);
    const passed = crossWorktreeViolations === 0
      && producerConsumerKinds.includes('ssi/stale-read')
      && ownWriteKinds.length === 0
      && primaryCheckOk
      && continuationCheckOk
      && wrongReceiptResult.status === 'rejected_by_policy'
      && continuationReceiptResult.status === 'accepted'
      && continuationVerdict.status === 'observed'
      && continuationVerdict.realVerseshellExecution === true
      && hostVerdictBefore === 'pass'
      && hostVerdictAfterFailure === hostVerdictBefore
      && hostVerdictAfter === hostVerdictBefore
      && cleanup.status === 'clean';
    const outcome = normalizedOutcome({
      producerConsumerKinds,
      ownWriteKinds,
      crossWorktreeViolations,
      candidateMaterialized: candidateFile.includes('currency: str = "EUR"') && candidateFile.includes('return amount + 1'),
      candidateCheckOk: primaryCheckOk && continuationCheckOk,
      wrongReceiptStatus: wrongReceiptResult.status,
      continuationVerdict: continuationVerdict.status,
      hostVerdictBefore,
      hostVerdictAfter,
      cleanup,
    });
    const report: Record<string, unknown> = {
      schema: WP7_SCHEMA,
      generated_at: generatedAt,
      driven_by: 'agent',
      actor: 'codex',
      task: 'TF-0513',
      fixture: WP7_FIXTURE_PATH,
      fixtureDigest: sha256(readFileSync(fixturePath)),
      status: passed ? 'passed' : 'failed',
      passed,
      identity: {
        repoId,
        worktrees: [
          { role: 'producer', worktreeId: producerWorktreeId, agentSessionId: producerAgentSessionId, vgSessionId: producerVgSession, traceId: 'trace-wp7-producer', epoch },
          { role: 'consumer', worktreeId: consumerWorktreeId, agentSessionId: consumerAgentSessionId, vgSessionId: consumerVgSession, traceId: 'trace-wp7-consumer', epoch },
        ],
        crossWorktreeViolations,
      },
      provider: {
        binarySha256: vgDigest,
        version: vgVersion,
        capabilitiesSchema,
        defaultEnable: safety.default_enable,
        singleGreenLight: verdictCapability.single_green_light,
        factRoute: 'host-owned-sidecar-fixed-argv',
        verificationRoute: 'verseshell-governed-aci',
        providerCalls,
        nativeVerificationFallbacks: 0,
      },
      verseshell: {
        binarySha256: aeDigest,
        runtimeVersion: VERSESHELL_RUNTIME_VERSION,
        protocol: VERSESHELL_PROTOCOL,
        catalogDigest: VERSESHELL_CATALOG_DIGEST,
        catalogCount: Number(VERSESHELL_CATALOG_COUNT),
        governedCalls: publicCalls,
        approvalRequiredCalls: publicCalls.filter((call) => call.approvalRequired).length,
        shellExecAuthorityCalls: publicCalls.filter((call) => call.capabilities.includes('shell.exec')).length,
      },
      vgFacts: {
        producerConsumer: { advisoryKinds: producerConsumerKinds, advisories: advisoryFacts(producerCheck) },
        ownWriteNegativeControl: { advisoryKinds: ownWriteKinds, advisories: advisoryFacts(ownWriteCheck) },
      },
      candidate: moduleReport.candidate,
      receiptFlow: {
        wrongReceipt: { status: wrongReceiptResult.status, reason: wrongReceiptResult.reason, issues: wrongReceiptResult.issues, hostVerdict: wrongReceiptResult.hostVerdict },
        abandonedVerdict,
        continuationReceipt: continuationReceiptResult,
        continuationVerdict,
      },
      behavior: {
        coverage: behaviorCoverage.coverageVector,
        counts: { eventCount: behaviorCoverage.eventCount, uniqueEventCount: behaviorCoverage.uniqueEventCount, duplicateCount: behaviorCoverage.duplicateCount, droppedCount: behaviorCoverage.droppedCount },
        knownGaps: behaviorCoverage.knownGaps,
        lateEventStatus: lateProducerEvent.status,
        sessionSeals: [producerSeal, consumerSeal],
      },
      moduleReport,
      hostVerdict: { owner: 'host', before: hostVerdictBefore, afterFailure: hostVerdictAfterFailure, afterContinuation: hostVerdictAfter, unchanged: hostVerdictBefore === hostVerdictAfter, value: hostVerdictAfter },
      continuation: { failedReceiptRejected: wrongReceiptResult.status === 'rejected_by_policy', continuationExecuted: true, continuationAccepted: continuationReceiptResult.status === 'accepted', status: continuationVerdict.status },
      cleanup,
      normalizedOutcome: outcome,
      normalizedOutcomeDigest: sha256(stableJson(outcome)),
      boundaries: {
        hostSourceMutated: false,
        userIdRepositoryMutated: false,
        landOrAdmitInvoked: false,
        defaultOn: false,
        ga: false,
        releaseEligible: false,
        m4Authorized: false,
        rawPayloadStored: false,
        rawAbsolutePathsStored: false,
        realHumanEvidenceClaimed: false,
        unobservedSurfaces: ['shellRead', 'directFs', 'mcpWrite', 'network', 'browser'],
      },
      limitations: [
        'Real host-shaped ChatRuntimeEvent objects were generated by the agent harness; no external model conversation is claimed.',
        'VerseGit init/session/observe/check facts are fixed-argv host-adapter calls in a disposable repository; only candidate verification is executed through VerseShell.',
        'The verification receipt binds retained observation/stdout/stderr digests; the bundled VerseShell run did not expose an artifact handle for this output size.',
        'Only Windows win32-x64 was executed.',
        'No GA, release, default-on, land/admit or M4 authority is claimed.',
      ],
      issues: [],
      digest: null,
    };
    report.digest = documentDigest(report);
    report.issues = validateWp7Report(report).issues;
    report.passed = report.issues.length === 0 && passed;
    report.status = report.passed ? 'passed' : 'failed';
    report.digest = documentDigest(report);
    return report;
  } catch (caught) {
    error = String((caught as Error)?.stack ?? caught);
    throw caught;
  } finally {
    await manager.shutdownAll().catch(() => undefined);
    for (const [role, path] of [['candidate', candidateWorktree], ['consumer', consumerWorktree], ['producer', producerWorktree]] as const) {
      try { if (existsSync(path) && existsSync(repo)) runGit(['worktree', 'remove', '--force', path], repo); } catch { void role; }
    }
    try { if (existsSync(repo)) runGit(['worktree', 'prune'], repo); } catch { /* best effort */ }
    try { rmSync(runRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch { /* best effort */ }
    if (error) void error;
  }
}

function findAbsolutePathLeaks(value: unknown, path = 'root', output: string[] = []): string[] {
  if (typeof value === 'string') {
    if (/^[A-Za-z]:[\\/]/u.test(value) || /(?:^|[\s"'=:(,])([A-Za-z]:[\\/][^\s"'),;]+)/u.test(value)) output.push(path);
  } else if (Array.isArray(value)) {
    value.forEach((entry, index) => findAbsolutePathLeaks(entry, `${path}[${index}]`, output));
  } else if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) findAbsolutePathLeaks(entry, `${path}.${key}`, output);
  }
  return output;
}

export function validateWp7Report(report: Record<string, unknown>): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  const add = (condition: boolean, message: string) => { if (!condition) issues.push(message); };
  add(report.schema === WP7_SCHEMA, 'schema mismatch');
  add(report.task === 'TF-0513', 'task mismatch');
  add(report.passed === true && report.status === 'passed', 'report did not pass');
  add(Array.isArray(report.issues) && report.issues.length === 0, 'issues must be empty');
  const identity = report.identity as Record<string, unknown> | undefined;
  add(Number(identity?.crossWorktreeViolations) === 0, 'cross-worktree identity violations must be zero');
  add(Array.isArray(identity?.worktrees) && identity.worktrees.length === 2, 'two host worktree/session identities required');
  const provider = report.provider as Record<string, unknown> | undefined;
  add(provider?.factRoute === 'host-owned-sidecar-fixed-argv' && provider?.verificationRoute === 'verseshell-governed-aci' && provider?.nativeVerificationFallbacks === 0, 'provider/verification execution route is not separated correctly');
  add(Array.isArray(provider?.providerCalls) && provider.providerCalls.length >= 10, 'provider fact-call evidence is incomplete');
  add(/^[0-9a-f]{64}$/u.test(String(provider?.binarySha256 ?? '')), 'VG binary digest missing');
  add(provider?.defaultEnable === false && provider?.singleGreenLight === false, 'provider product locks changed');
  const facts = report.vgFacts as Record<string, unknown> | undefined;
  const positive = facts?.producerConsumer as Record<string, unknown> | undefined;
  const negative = facts?.ownWriteNegativeControl as Record<string, unknown> | undefined;
  add(Array.isArray(positive?.advisoryKinds) && positive.advisoryKinds.includes('ssi/stale-read'), 'producer-consumer stale-read fact missing');
  add(Array.isArray(negative?.advisoryKinds) && negative.advisoryKinds.length === 0, 'own-write negative control not silent');
  const candidate = report.candidate as Record<string, unknown> | undefined;
  add(/^[0-9a-f]{64}$/u.test(String(candidate?.candidateId ?? '')), 'candidate ID missing');
  add(/^[0-9a-f]{40,64}$/u.test(String(candidate?.materializedTreeOid ?? '')), 'candidate tree missing');
  add(Array.isArray(candidate?.parentHeads) && candidate.parentHeads.length === 2, 'candidate parent order missing');
  const receiptFlow = report.receiptFlow as Record<string, unknown> | undefined;
  const wrong = receiptFlow?.wrongReceipt as Record<string, unknown> | undefined;
  const continuationReceipt = receiptFlow?.continuationReceipt as Record<string, unknown> | undefined;
  const continuationVerdict = receiptFlow?.continuationVerdict as Record<string, unknown> | undefined;
  add(wrong?.status === 'rejected_by_policy' && wrong?.hostVerdict === 'unchanged', 'wrong receipt was not rejected');
  add(continuationReceipt?.status === 'accepted', 'continuation receipt was not accepted');
  add(continuationVerdict?.status === 'observed' && continuationVerdict?.realVerseshellExecution === true, 'continuation verdict is not observed');
  add(continuationVerdict?.singleGreenLight === false && continuationVerdict?.hostVerdict === 'unchanged', 'continuation verdict flattened authority');
  const hostVerdict = report.hostVerdict as Record<string, unknown> | undefined;
  add(hostVerdict?.before === 'pass' && hostVerdict?.afterContinuation === 'pass' && hostVerdict?.unchanged === true, 'host verdict changed or was not independently produced');
  const continuation = report.continuation as Record<string, unknown> | undefined;
  add(continuation?.failedReceiptRejected === true && continuation?.continuationAccepted === true && continuation?.continuationExecuted === true, 'failure continuation proof incomplete');
  const cleanup = report.cleanup as Record<string, unknown> | undefined;
  add(cleanup?.status === 'clean' && cleanup?.processSurvivors === 0 && cleanup?.worktreeSurvivors === 0 && cleanup?.tempRootRemoved === true && cleanup?.hostWorktreesDeleted === 0, 'cleanup boundary failed');
  const verseshell = report.verseshell as Record<string, unknown> | undefined;
  add(Array.isArray(verseshell?.governedCalls) && verseshell.governedCalls.length >= 2, 'governed call evidence is incomplete');
  add(verseshell?.shellExecAuthorityCalls === verseshell?.governedCalls.length, 'not every governed call used shell.exec authority');
  add(Number(verseshell?.approvalRequiredCalls) > 0, 'host approval evidence missing');
  const boundaries = report.boundaries as Record<string, unknown> | undefined;
  add(boundaries?.hostSourceMutated === false && boundaries?.userIdRepositoryMutated === false && boundaries?.landOrAdmitInvoked === false, 'repository or landing boundary failed');
  add(boundaries?.defaultOn === false && boundaries?.ga === false && boundaries?.releaseEligible === false && boundaries?.m4Authorized === false, 'product authority boundary failed');
  add(boundaries?.realHumanEvidenceClaimed === false, 'real-human evidence was claimed');
  const behavior = report.behavior as Record<string, unknown> | undefined;
  add(behavior?.lateEventStatus === 'stale', 'late event was not stale');
  const normalized = report.normalizedOutcome;
  add(report.normalizedOutcomeDigest === sha256(stableJson(normalized)), 'normalized outcome digest is not reproducible');
  add(findAbsolutePathLeaks(report).length === 0, `absolute path leak: ${findAbsolutePathLeaks(report).slice(0, 3).join(', ')}`);
  if (report.digest !== documentDigest(report)) issues.push('digest is not reproducible');
  return { ok: issues.length === 0, issues };
}

export function writeWp7Report({ output, fixturePath, root = repositoryRoot }: { output?: string; fixturePath?: string; root?: string } = {}): Promise<{ path: string; report: Record<string, unknown>; validation: { ok: boolean; issues: string[] } }> {
  return (async () => {
    const report = await buildWp7Report({
      root,
      fixturePath: fixturePath ?? resolve(root, WP7_FIXTURE_PATH),
    });
    const validation = validateWp7Report(report);
    const path = output ? resolve(output) : resolve(root, WP7_ARTIFACT_PATH);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(report, null, 2)}
`, 'utf8');
    return { path, report, validation };
  })();
}

function at(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const output = at('--out') ? resolve(repositoryRoot, at('--out')!) : undefined;
  const fixturePath = at('--fixture') ? resolve(repositoryRoot, at('--fixture')!) : undefined;
  const result = await writeWp7Report({ output, fixturePath });
  console.log(JSON.stringify({
    path: result.path,
    passed: result.report.passed,
    normalizedOutcomeDigest: result.report.normalizedOutcomeDigest,
    cleanup: result.report.cleanup,
    validation: result.validation,
  }, null, 2));
  if (!result.validation.ok || result.report.passed !== true) process.exitCode = 1;
}

if (isMainEntrypoint(import.meta.url)) {
  main().catch((error) => {
    console.error(String(error?.stack ?? error));
    process.exitCode = 1;
  });
}
