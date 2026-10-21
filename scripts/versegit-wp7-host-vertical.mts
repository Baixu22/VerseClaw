#!/usr/bin/env -S node --import tsx
/**
 * WP7 real host vertical slice.
 *
 * This script creates a disposable Git repository and worktrees, drives real VerseGit
 * sessions/checks through VerseShell, composes a candidate tree, executes two real
 * VerseShell verification runs, turns the continuation observation into a host-owned
 * receipt, and then cleans every disposable resource. It never mutates the user repo.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChatRuntimeEvent } from '../shared/chat-runtime-events.ts';
import type { Observation } from '../shared/verseshell/types.ts';
import {
  buildBehaviorCoverage,
  type BehaviorCoverageReport,
} from '../electron/services/versegit-behavior-coverage.ts';
import {
  VerseGitObservationBridge,
  classifyToolSurface,
  type ObservationBinding,
  type VerseGitBehaviorEvent,
} from '../electron/services/versegit-observation.ts';
import {
  VerseGitModule,
} from '../electron/services/versegit-module.ts';
import {
  VerseGitReceiptBridge,
  createVerificationPlan,
  executionInputDigest,
  planDigest,
  validateReceipt,
  type VerificationPlan,
  type VerseShellReceipt,
} from '../electron/services/versegit-receipt-bridge.ts';
import {
  FileVerseShellReceiptAuthority,
  type HostEvidenceManifest,
  type HostObservationEvidence,
} from '../electron/services/versegit-receipt-evidence.ts';
import {
  createGovernedVerseShellProcessConfig,
} from '../openclaw_runtime/src/agents/verseshell/governed-exec.js';
import { VerseShellProcessManager } from '../openclaw_runtime/src/agents/verseshell/process-manager.js';
import { isMainEntrypoint } from './lib/entrypoint.mjs';

export const WP7_SCHEMA = 'clawx.versegit.wp7-host-vertical/v1';
export const WP7_FIXTURE_PATH = 'harness/specs/fixtures/versegit-planning-correction/wp7-host-vertical-fixture.json';
export const WP7_EVIDENCE_PATH = 'harness/specs/fixtures/versegit-planning-correction/wp7-evidence/report.json';
export const WP7_EVIDENCE_DIR = 'artifacts/versegit/wp7/evidence';
export const WP7_CURATED_EVIDENCE_DIR = 'harness/specs/fixtures/versegit-planning-correction/wp7-evidence/evidence';
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
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const files = ['pricedb.py', 'verify.cjs'].map((path) => ({ path, sha256: sha256(fs.readFileSync(path)) }));
const inputDigest = sha256(JSON.stringify({ schemaVersion: 1, files }));
const text = fs.readFileSync('pricedb.py', 'utf8');
const contentOk = text.includes('currency: str = "EUR"') && text.includes('return amount + 1');
const expectedInputDigest = process.argv[2] ?? '';
const ok = contentOk && inputDigest === expectedInputDigest;
const payload = {
  schema: 'clawx.wp7.candidate-check/v1',
  ok,
  inputDigest,
  contentDigest: sha256(text),
};
process.stdout.write(JSON.stringify(payload) + String.fromCharCode(10));
process.stdout.write('wp7-proof-' + 'x'.repeat(24000) + String.fromCharCode(10));
if (!ok) process.exit(1);
`;

export function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export function candidateInputDigestAt(rootDirectory: string): string {
  const files = ['pricedb.py', 'verify.cjs'].map((path) => ({ path, sha256: sha256(readFileSync(join(rootDirectory, path))) }));
  return sha256(JSON.stringify({ schemaVersion: 1, files }));
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

function candidateStatusAt(cwd: string): string {
  return runGit(['status', '--porcelain=v1', '--untracked-files=all', '--', '.', ':(exclude).ae'], cwd);
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
  observationId: string;
  route: 'verseshell-governed-aci';
  routeProfile: 'clawx-governed-exec-v1';
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
  processPid: number | null;
  managerKeyDigest: string;
  capabilities: string[];
  authorityObserved: boolean;
  artifactHandles: string[];
  artifactDigests: string[];
  observation: Observation;
};

function rawObservationCall(
  observation: Observation,
  processKey: string,
  approvalRequired: boolean,
  processPid: number | null,
  managerKey: string,
): GovernedCall {
  const data = observationData(observation);
  const stdout = captureText(data.stdout);
  const stderr = captureText(data.stderr);
  const exitCode = typeof data.exit_code === 'number' && Number.isInteger(data.exit_code) ? data.exit_code : null;
  const timedOut = data.timed_out === true;
  const capabilities = Array.isArray(observation.meta?.capabilities_used)
    ? observation.meta.capabilities_used.filter((value): value is string => typeof value === 'string')
    : [];
  const artifactRecords = Array.isArray(data.artifacts)
    ? data.artifacts.filter((value): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value)))
    : [];
  const artifactHandles = artifactRecords
    .map((value) => value.handle)
    .filter((value): value is string => typeof value === 'string' && value.startsWith('result://sha256/'));
  const artifactDigests = [
    sha256(stdout),
    sha256(stderr),
    sha256(stableJson(observation)),
    ...artifactRecords
      .map((value) => typeof value.digest === 'string' ? value.digest.replace(/^sha256:/iu, '') : '')
      .filter((value) => /^[0-9a-f]{64}$/u.test(value)),
  ];
  return {
    id: observation.id,
    observationId: observation.id,
    route: 'verseshell-governed-aci',
    routeProfile: 'clawx-governed-exec-v1',
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
    processPid,
    managerKeyDigest: sha256(managerKey),
    capabilities,
    authorityObserved: observation.schema === 'verseshell.observation/v1'
      && observation.status === 'ok'
      && capabilities.includes('shell.exec'),
    artifactHandles,
    artifactDigests: [...new Set(artifactDigests)].sort(),
    observation,
  };
}

function outputEvidence(call: GovernedCall): Record<string, unknown> {
  return {
    id: call.id,
    observationId: call.observationId,
    route: call.route,
    routeProfile: call.routeProfile,
    approvalRequired: call.approvalRequired,
    approvedByHost: call.approvedByHost,
    success: call.success,
    exitCode: call.exitCode,
    timedOut: call.timedOut,
    durationMs: call.durationMs,
    stdout: call.stdout,
    stderr: call.stderr,
    stdoutDigest: call.stdoutDigest,
    stderrDigest: call.stderrDigest,
    observationDigest: call.observationDigest,
    processKeyDigest: call.processKeyDigest,
    processPid: call.processPid,
    managerKeyDigest: call.managerKeyDigest,
    capabilities: call.capabilities,
    authorityObserved: call.authorityObserved,
    artifactHandles: call.artifactHandles,
    artifactDigests: call.artifactDigests,
    observation: call.observation,
  };
}
type ProcessQuery = { ok: true; pids: number[] } | { ok: false; pids: []; error: string };
type PidState = { ok: true; pid: number; exists: boolean } | { ok: false; pid: number; exists: null; error: string };

function queryPidState(pid: number): PidState {
  if (process.platform !== 'win32') return { ok: false, pid, exists: null, error: 'PID inventory is only implemented for win32 in WP7' };
  try {
    const output = execFileSync('tasklist.exe', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
      encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], timeout: 15_000,
    });
    const exists = output.split(String.fromCharCode(10)).some((line) => new RegExp(`^"ae\.exe","${pid}"`, 'iu').test(line.trim()));
    return { ok: true, pid, exists };
  } catch (error) {
    return { ok: false, pid, exists: null, error: String((error as Error)?.message ?? error).slice(0, 300) };
  }
}

function queryAeProcesses(): ProcessQuery {
  if (process.platform !== 'win32') return { ok: false, pids: [], error: 'OS process inventory is only implemented for win32 in WP7' };
  try {
    const output = execFileSync('tasklist.exe', ['/FO', 'CSV', '/NH'], {
      encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], timeout: 15_000,
    });
    const pids = output.split(String.fromCharCode(10))
      .map((line) => /^"ae\.exe","(\d+)"/iu.exec(line.trim())?.[1])
      .filter((value): value is string => Boolean(value))
      .map(Number)
      .filter((value) => Number.isInteger(value) && value > 0)
      .sort((a, b) => a - b);
    return { ok: true, pids };
  } catch (error) {
    return { ok: false, pids: [], error: String((error as Error)?.message ?? error).slice(0, 300) };
  }
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
  const health = input.manager.health(client.processKey);
  const processHealth = Array.isArray(health) ? undefined : health;
  const call = rawObservationCall(
    observation,
    client.processKey,
    approvalRequired,
    processHealth?.pid ?? null,
    processHealth?.key ?? client.processKey,
  );
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

export type HostToolCall = {
  toolCallId: string;
  runId: string;
  name: string;
  args: Record<string, unknown>;
  started: VerseGitBehaviorEvent;
  completion: VerseGitBehaviorEvent;
};

export type ProviderCall = {
  id: string;
  route: 'host-owned-sidecar-fixed-argv';
  argvShape: string[];
  argvDigest: string;
  cwdRole: string;
  cwdDigest: string;
  processPid: number | null;
  processKeyDigest: string;
  success: boolean;
  exitCode: number | null;
  timedOut: boolean;
  stdoutDigest: string;
  stderrDigest: string;
  commandSpecDigest: string;
  sourceBehaviorEventId?: string;
  sourceInputEventId?: string;
  sourceEventInputDigest?: string;
  sourceSurface?: string;
  sourceStatus?: string;
  sourceOutputDigest?: string;
  evidenceRef?: string;
  evidenceDigest?: string;
};

async function invokeVg(input: {
  label: string;
  cwd: string;
  cwdRole: string;
  args: string[];
  vgBinary: string;
  root: string;
  replacements: Record<string, string>;
  evidenceAuthority: FileVerseShellReceiptAuthority;
  providerCalls: ProviderCall[];
  timeoutMs: number;
  expectJson?: boolean;
  source?: HostToolCall;
}): Promise<Record<string, unknown>> {
  const argv = [input.vgBinary, ...input.args];
  const result = spawnSync(input.vgBinary, input.args, {
    cwd: input.cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: input.timeoutMs,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  const stdout = String(result.stdout ?? '').trim();
  const stderr = String(result.stderr ?? (result.error ? result.error.message : '')).replace(/\r/g, '').trim();
  const timedOut = (result.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT';
  const exitCode = typeof result.status === 'number' ? result.status : null;
  const processPid = typeof result.pid === 'number' && result.pid > 0 ? result.pid : null;
  const success = exitCode === 0 && !timedOut && !result.error;
  const argvShape = [input.vgBinary, ...input.args].map((arg) => recordShape(String(arg), input.root, input.replacements));
  const evidence = input.evidenceAuthority.recordCommandEvidence(input.label, {
    route: 'host-owned-sidecar-fixed-argv',
    argvShape,
    cwdRole: input.cwdRole,
    stdout,
    stderr,
    processPid,
    exitCode,
    timedOut,
  });
  const commandSpecDigest = sha256(stableJson({ argvShape, cwdRole: input.cwdRole }));
  const providerCall: ProviderCall = {
    id: input.label,
    route: 'host-owned-sidecar-fixed-argv',
    argvShape,
    argvDigest: sha256(JSON.stringify(argv)),
    cwdRole: input.cwdRole,
    cwdDigest: sha256(stableJson({ cwdRole: input.cwdRole })),
    processPid,
    processKeyDigest: sha256(`host-sidecar:${String(processPid)}:${input.label}`),
    success,
    exitCode,
    timedOut,
    stdoutDigest: sha256(stdout),
    stderrDigest: sha256(stderr),
    commandSpecDigest,
    evidenceRef: evidence.path,
    evidenceDigest: evidence.digest,
    ...(input.source ? {
      sourceBehaviorEventId: input.source.completion.eventId,
      sourceInputEventId: input.source.started.eventId,
      sourceEventInputDigest: input.source.started.inputDigest,
      sourceSurface: input.source.completion.surface,
      sourceStatus: input.source.completion.status,
      sourceOutputDigest: input.source.completion.outputDigest,
    } : {}),
  };
  input.providerCalls.push(providerCall);
  if (!providerCall.success) throw new Error(`${input.label} failed: ${stderr.slice(0, 400)}`);
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

function decideHostVerdict(input: { candidateCheckOk: boolean; repositoryHealthy: boolean; residualReceiptStatus: string }): { value: 'pass' | 'fail'; inputs: Record<string, unknown> } {
  return {
    value: input.candidateCheckOk && input.repositoryHealthy ? 'pass' : 'fail',
    inputs: {
      candidateCheckOk: input.candidateCheckOk,
      repositoryHealthy: input.repositoryHealthy,
      residualReceiptStatus: input.residualReceiptStatus,
      rule: 'VG receipt status is residual; only host candidate check and repository health determine the host verdict',
    },
  };
}
function normalizedOutcome(input: {
  producerConsumerKinds: string[];
  ownWriteKinds: string[];
  crossWorktreeViolations: number;
  candidateMaterialized: boolean;
  candidateCheckOk: boolean;
  candidateInputDigest: string;
  factProjectionCount: number;
  providerCallCount: number;
  governedCallCount: number;
  behaviorEventCount: number;
  wrongReceiptStatus: string;
  failureRejectedBeforeContinuation: boolean;
  continuationVerdict: string;
  receiptAuthorityVerified: boolean;
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
    candidateInputDigest: input.candidateInputDigest,
    factProjectionCount: input.factProjectionCount,
    providerCallCount: input.providerCallCount,
    governedCallCount: input.governedCallCount,
    behaviorEventCount: input.behaviorEventCount,
    wrongReceiptStatus: input.wrongReceiptStatus,
    failureRejectedBeforeContinuation: input.failureRejectedBeforeContinuation,
    continuationVerdict: input.continuationVerdict,
    receiptAuthorityVerified: input.receiptAuthorityVerified,
    hostVerdictBefore: input.hostVerdictBefore,
    hostVerdictAfter: input.hostVerdictAfter,
    cleanup: {
      status: input.cleanup.status,
      processesDeleted: input.cleanup.processesDeleted,
      processSurvivors: input.cleanup.processSurvivors,
      managerProcessSurvivors: input.cleanup.managerProcessSurvivors,
      worktreesDeleted: input.cleanup.worktreesDeleted,
      worktreeSurvivors: input.cleanup.worktreeSurvivors,
      tempRootRemoved: input.cleanup.tempRootRemoved,
      deletionErrors: input.cleanup.deletionErrors,
      hostWorktreesDeleted: input.cleanup.hostWorktreesDeleted,
    },
  };
}

export async function buildWp7Report({
  root = repositoryRoot,
  fixturePath = resolve(root, WP7_FIXTURE_PATH),
  generatedAt = new Date().toISOString(),
  evidenceDir,
}: {
  root?: string;
  fixturePath?: string;
  generatedAt?: string;
  evidenceDir?: string;
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
  const baselineProcessQuery = queryAeProcesses();
  if (!baselineProcessQuery.ok) throw new Error(`OS process baseline unavailable: ${baselineProcessQuery.error}`);
  const aeBaselinePids = baselineProcessQuery.pids;
  const evidenceAuthority = new FileVerseShellReceiptAuthority(evidenceDir ?? resolve(root, WP7_EVIDENCE_DIR));
  evidenceAuthority.reset();
  const manager = new VerseShellProcessManager({
    resolveBinary: () => ({ path: aeBinary, source: 'verified-bundled', verified: true }),
  });
  const rootBase = process.env.VERSEGIT_WP7_TEMP_ROOT || (process.platform === 'win32' ? 'D:\\tmp' : tmpdir());
  mkdirSync(rootBase, { recursive: true });
  const runRoot = mkdtempSync(join(rootBase, 'versegit-wp7-'));
  const vgBinaryForRun = join(runRoot, 'vg.exe');
  cpSync(vgBinary, vgBinaryForRun);
  if (sha256(readFileSync(vgBinaryForRun)) !== vgDigest) throw new Error('copied VerseGit binary digest drifted');
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
  const runVg = (
    input: Omit<Parameters<typeof invokeVg>[0], 'evidenceAuthority'>,
  ) => invokeVg({ ...input, vgBinary: vgBinaryForRun, evidenceAuthority });
  const hostFixtureOperations: Array<Record<string, unknown>> = [];
  const gitHost = (args: string[], cwd: string): string => {
    const id = `git-fixture-${hostFixtureOperations.length + 1}`;
    const argvShape = args.map((arg) => recordShape(String(arg), runRoot, replacements));
    try {
      const output = runGit(args, cwd);
      hostFixtureOperations.push({
        id, route: 'host-worktree-fixture-fixed-argv', argvShape,
        cwdRole: cwd === repo ? 'repo' : cwd === producerWorktree ? 'producer_worktree'
          : cwd === consumerWorktree ? 'consumer_worktree' : cwd === candidateWorktree ? 'candidate_worktree' : 'unknown',
        success: true, stdoutDigest: sha256(output), stderrDigest: sha256(''),
      });
      return output;
    } catch (error) {
      hostFixtureOperations.push({
        id, route: 'host-worktree-fixture-fixed-argv', argvShape,
        cwdRole: cwd === repo ? 'repo' : cwd === producerWorktree ? 'producer_worktree'
          : cwd === consumerWorktree ? 'consumer_worktree' : cwd === candidateWorktree ? 'candidate_worktree' : 'unknown',
        success: false, stdoutDigest: sha256(''), stderrDigest: sha256(String((error as Error)?.message ?? error).slice(0, 400)),
      });
      throw error;
    }
  };
  let cleanup: Record<string, unknown> = { status: 'not_run', survivors: [] };
  let error: string | null = null;
  try {
    mkdirSync(repo, { recursive: true });
    gitHost(['init', '--quiet', '-b', 'main'], repo);
    gitHost(['config', 'user.name', 'versegit-wp7'], repo);
    gitHost(['config', 'user.email', 'versegit-wp7@example.invalid'], repo);
    writeFileSync(join(repo, 'pricedb.py'), PRICEDB_BASE, 'utf8');
    writeFileSync(join(repo, 'verify.cjs'), VERIFY_SCRIPT, 'utf8');
    gitHost(['add', 'pricedb.py', 'verify.cjs'], repo);
    gitHost(['commit', '--quiet', '-m', 'base'], repo);
    gitHost(['worktree', 'add', '--quiet', '-b', 'producer', producerWorktree], repo);
    gitHost(['worktree', 'add', '--quiet', '-b', 'consumer', consumerWorktree], repo);

    await runVg({ label: 'vg-init', cwd: repo, cwdRole: 'repo', args: ['init', '--json'], vgBinary, root: runRoot, replacements, providerCalls, timeoutMs });
    const versionDocument = await runVg({ label: 'vg-version', cwd: repo, cwdRole: 'repo', args: ['--version'], vgBinary, root: runRoot, replacements, providerCalls, timeoutMs, expectJson: false });
    const vgVersion = requiredString(versionDocument.text, 'VG version text');
    const capabilities = await runVg({ label: 'vg-capabilities', cwd: repo, cwdRole: 'repo', args: ['capabilities', '--json'], vgBinary, root: runRoot, replacements, providerCalls, timeoutMs });
    const capabilitiesSchema = requiredString(capabilities.schema, 'VG capabilities schema');
    const safety = (capabilities.safety ?? {}) as Record<string, unknown>;
    const verdictCapability = (capabilities.verdict ?? {}) as Record<string, unknown>;
    if (safety.default_enable !== false) throw new Error('VG default_enable changed');
    if (verdictCapability.single_green_light !== false) throw new Error('VG single_green_light changed');

    const startSession = async (label: string, actor: string, worktree: string) => {
      const result = await runVg({
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
    const selfWriterAgentSessionId = `agent-session-self-writer-${sha256('self-writer').slice(0, 12)}`;
    const epoch = 7;
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
    const selfWriterBinding: ObservationBinding = {
      runId: 'run-wp7-self-writer', sessionKey: 'session-wp7-self-writer', traceId: 'trace-wp7-self-writer', requestId: 'request-wp7-self-writer',
      repoId, worktreeId: producerWorktreeId, agentSessionId: selfWriterAgentSessionId,
      vgSessionId: `vg-session-self-writer-${sha256(selfWriterVgSessionRaw).slice(0, 16)}`,
      ownerId: 'owner-wp7-self-writer', actor: 'agent:codex', epoch, boundAt: Date.now(),
    };
    const observationBridge = new VerseGitObservationBridge();
    const hostBindings = new Map<string, ObservationBinding>([
      [producerBinding.runId, producerBinding],
      [consumerBinding.runId, consumerBinding],
      [selfWriterBinding.runId, selfWriterBinding],
    ]);
    for (const binding of hostBindings.values()) {
      const attached = observationBridge.bind(binding);
      if (attached.status !== 'attached') throw new Error(`observation binding failed for ${binding.runId}: ${attached.issues.join('; ')}`);
    }
    const observed: VerseGitBehaviorEvent[] = [];
    const hostToolCalls: HostToolCall[] = [];
    const ingest = (event: ChatRuntimeEvent, context: Record<string, unknown>) => {
      const result = observationBridge.ingest(event, context);
      if (!result.event) throw new Error(`host event was not observed: ${result.status} ${result.issues.join('; ')}`);
      observed.push(result.event);
      return result;
    };
    const ingestToolCall = (input: {
      runId: string;
      sessionKey: string;
      toolCallId: string;
      name: string;
      args: Record<string, unknown>;
      result: Record<string, unknown>;
      requestId: string;
      traceId: string;
      ts: number;
    }): HostToolCall => {
      const binding = hostBindings.get(input.runId);
      if (!binding) throw new Error(`unbound host event run ${input.runId}`);
      const ownerId = binding.ownerId;
      const sequence = hostToolCalls.length * 2 + 1;
      const started = ingest(toolStarted(input.runId, input.sessionKey, sequence, input.toolCallId, input.name, input.args, input.ts), {
        epoch, ownerId, requestId: input.requestId, traceId: input.traceId, eventId: `${input.toolCallId}-start`,
      }).event;
      if (!started) throw new Error(`start event missing for ${input.toolCallId}`);
      const completion = ingest(toolCompleted(input.runId, input.sessionKey, sequence + 1, input.toolCallId, input.name, input.result, input.ts + 1), {
        epoch, ownerId, requestId: input.requestId, traceId: input.traceId, eventId: `${input.toolCallId}-end`,
      }).event;
      if (!completion) throw new Error(`completion event missing for ${input.toolCallId}`);
      const record: HostToolCall = { toolCallId: input.toolCallId, runId: input.runId, name: input.name, args: input.args, started, completion };
      hostToolCalls.push(record);
      return record;
    };
    const projectHostFact = async (record: HostToolCall) => {
      const expected = classifyToolSurface(record.name, record.args);
      if (record.completion.status !== 'succeeded') throw new Error(`successful completion required for ${record.toolCallId}`);
      if (record.started.surface !== expected.surface || record.completion.surface !== expected.surface) throw new Error(`normalized event surface mismatch for ${record.toolCallId}`);
      const binding = hostBindings.get(record.runId);
      if (!binding) throw new Error(`no VG binding for ${record.runId}`);
      const sessionByRun: Record<string, string> = {
        'run-wp7-producer': producerVgSessionRaw,
        'run-wp7-consumer': consumerVgSessionRaw,
        'run-wp7-self-writer': selfWriterVgSessionRaw,
      };
      const session = requiredString(sessionByRun[binding.runId], `${binding.runId} VG session`);
      const path = requiredString(record.args.path, `${record.toolCallId} path`);
      if (record.completion.surface === 'file.read') {
        const lineStart = Number(record.args.lineStart);
        const lineEnd = Number(record.args.lineEnd);
        if (!Number.isInteger(lineStart) || !Number.isInteger(lineEnd)) throw new Error(`${record.toolCallId} read range is invalid`);
        return runVg({
          label: `vg-observe-${record.toolCallId}`, cwd: repo, cwdRole: 'repo',
          args: ['observe', 'read', '--json', '--session', session, '--path', path, '--line-start', String(lineStart), '--line-end', String(lineEnd)],
          vgBinary, root: runRoot, replacements, providerCalls, timeoutMs, expectJson: false, source: record,
        });
      }
      if (record.completion.surface === 'file.write') {
        const kind = requiredString(record.args.kind, `${record.toolCallId} write kind`);
        return runVg({
          label: `vg-observe-${record.toolCallId}`, cwd: repo, cwdRole: 'repo',
          args: ['observe', 'write', '--json', '--session', session, '--path', path, '--kind', kind],
          vgBinary, root: runRoot, replacements, providerCalls, timeoutMs, expectJson: false, source: record,
        });
      }
      throw new Error(`host tool ${record.toolCallId} has no VG fact projection`);
    };
    const now = Date.now();
    const producerRead = ingestToolCall({
      runId: 'run-wp7-producer', sessionKey: 'session-wp7-producer', toolCallId: 'call-producer-read', name: 'Read',
      args: { path: 'pricedb.py', lineStart: 1, lineEnd: 3 },
      result: { contentDigest: sha256(PRICEDB_BASE), lines: [1, 3] },
      requestId: 'request-wp7-producer-read', traceId: 'trace-wp7-producer-read', ts: now,
    });
    await projectHostFact(producerRead);
    writeFileSync(join(consumerWorktree, 'pricedb.py'), PRICEDB_CONSUMER, 'utf8');
    const consumerWrite = ingestToolCall({
      runId: 'run-wp7-consumer', sessionKey: 'session-wp7-consumer', toolCallId: 'call-consumer-write', name: 'Edit',
      args: { path: 'pricedb.py', kind: 'modify_signature' },
      result: { contentDigest: sha256(PRICEDB_CONSUMER), ok: true },
      requestId: 'request-wp7-consumer-write', traceId: 'trace-wp7-consumer-write', ts: now + 2,
    });
    await projectHostFact(consumerWrite);
    const producerCheck = await runVg({ label: 'vg-check-producer-stale-read', cwd: repo, cwdRole: 'repo', args: ['check', '--json', '--file', 'pricedb.py', '--session', producerVgSessionRaw], vgBinary, root: runRoot, replacements, providerCalls, timeoutMs, source: consumerWrite });
    writeFileSync(join(producerWorktree, 'notes.py'), NOTES_BASE, 'utf8');
    const selfRead = ingestToolCall({
      runId: 'run-wp7-self-writer', sessionKey: 'session-wp7-self-writer', toolCallId: 'call-self-read', name: 'Read',
      args: { path: 'notes.py', lineStart: 1, lineEnd: 2 },
      result: { contentDigest: sha256(NOTES_BASE), lines: [1, 2] },
      requestId: 'request-wp7-self-read', traceId: 'trace-wp7-self-read', ts: now + 6,
    });
    await projectHostFact(selfRead);
    writeFileSync(join(producerWorktree, 'notes.py'), NOTES_EDITED, 'utf8');
    const selfWrite = ingestToolCall({
      runId: 'run-wp7-self-writer', sessionKey: 'session-wp7-self-writer', toolCallId: 'call-self-write', name: 'Edit',
      args: { path: 'notes.py', kind: 'modify_body' },
      result: { contentDigest: sha256(NOTES_EDITED), ok: true },
      requestId: 'request-wp7-self-write', traceId: 'trace-wp7-self-write', ts: now + 8,
    });
    await projectHostFact(selfWrite);
    const ownWriteCheck = await runVg({ label: 'vg-check-self-own-write', cwd: repo, cwdRole: 'repo', args: ['check', '--json', '--file', 'notes.py', '--session', selfWriterVgSessionRaw], vgBinary, root: runRoot, replacements, providerCalls, timeoutMs, source: selfWrite });
    const producerConsumerKinds = advisoryFacts(producerCheck).map((entry) => entry.kind);
    const ownWriteKinds = advisoryFacts(ownWriteCheck).map((entry) => entry.kind);
    if (!producerConsumerKinds.includes('ssi/stale-read')) throw new Error('VG producer-consumer stale-read positive did not fire');
    if (ownWriteKinds.length !== 0) throw new Error('VG own-write negative control was not silent');

    writeFileSync(join(producerWorktree, 'pricedb.py'), PRICEDB_PRODUCER, 'utf8');
    const producerWrite = ingestToolCall({
      runId: 'run-wp7-producer', sessionKey: 'session-wp7-producer', toolCallId: 'call-producer-write', name: 'Edit',
      args: { path: 'pricedb.py', kind: 'modify_body' },
      result: { contentDigest: sha256(PRICEDB_PRODUCER), ok: true },
      requestId: 'request-wp7-producer-write', traceId: 'trace-wp7-producer-write', ts: now + 4,
    });
    await projectHostFact(producerWrite);
    gitHost(['add', 'pricedb.py'], consumerWorktree);
    gitHost(['commit', '--quiet', '-m', 'consumer signature'], consumerWorktree);
    gitHost(['add', 'pricedb.py'], producerWorktree);
    gitHost(['commit', '--quiet', '-m', 'producer body'], producerWorktree);
    const producerHead = gitHost(['rev-parse', 'HEAD'], producerWorktree);
    const consumerHead = gitHost(['rev-parse', 'HEAD'], consumerWorktree);
    const mergeOutput = gitHost(['merge-tree', '--write-tree', 'producer', 'consumer'], repo);
    const treeOid = mergeOutput.split(String.fromCharCode(10)).map((line) => line.trim()).find((line) => /^[0-9a-f]{40,64}$/u.test(line));
    if (!treeOid) throw new Error('git merge-tree did not return a candidate tree');
    const candidateCommit = gitHost(['commit-tree', treeOid, '-p', producerHead, '-p', consumerHead, '-m', 'wp7 composed candidate'], repo);
    gitHost(['worktree', 'add', '--quiet', '--detach', candidateWorktree, candidateCommit], repo);
    const candidateFile = readFileSync(join(candidateWorktree, 'pricedb.py'), 'utf8');
    if (!candidateFile.includes('currency: str = "EUR"') || !candidateFile.includes('return amount + 1')) {
      throw new Error('composed candidate does not contain producer and consumer changes');
    }
    const candidateInputDigest = candidateInputDigestAt(candidateWorktree);
    const baseOid = gitHost(['rev-parse', 'main'], repo);
    const candidateWorktreeHead = gitHost(['rev-parse', 'HEAD'], candidateWorktree);
    const candidateStatus = candidateStatusAt(candidateWorktree);
    if (candidateWorktreeHead !== candidateCommit) throw new Error('candidate worktree HEAD differs from the composed commit');
    if (candidateStatus.length !== 0) throw new Error('candidate worktree is dirty before input freeze');
    const candidateManifest = {
      schemaVersion: 2,
      repoId,
      baseOid,
      parentOrder: [producerHead, consumerHead],
      materializedTreeOid: treeOid,
      commitOid: candidateCommit,
      candidateWorktreeHead,
      dirtyFiles: [] as string[],
      untrackedFiles: [] as string[],
      ignoredRuntimePaths: ['.ae/**'],
      verificationCwdRole: 'candidate_worktree',
      inputDigest: candidateInputDigest,
      inputFiles: ['pricedb.py', 'verify.cjs']
        .map((path) => ({ path, sha256: sha256(readFileSync(join(candidateWorktree, path))) }))
        .sort((a, b) => a.path.localeCompare(b.path)),
    };
    const candidateId = sha256(stableJson(candidateManifest));
    const candidateView = { candidateId, ...candidateManifest };
    const candidateEvidenceRef = evidenceAuthority.recordCandidateInput(candidateId, candidateManifest);
    const createCandidatePlan = (runId: string) => createVerificationPlan({
      runId,
      candidateId,
      candidateInputDigest,
      checkId: 'candidate-composite-check',
      owner: 'owner-wp7-host',
      epoch,
      authorizationId: 'host-policy-wp7-verification',
      commands: [{
        argv: [process.execPath, 'verify.cjs', candidateInputDigest],
        cwd: '.',
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
    const primaryPlanRef = evidenceAuthority.recordPlan(primaryPlan.plan);
    const continuationPlanRef = evidenceAuthority.recordPlan(continuationPlan.plan);
    const receiptBridge = new VerseGitReceiptBridge(evidenceAuthority);
    if (receiptBridge.registerPlan(primaryPlan.plan).status !== 'accepted') throw new Error('primary plan was not registered');
    if (receiptBridge.registerPlan(continuationPlan.plan).status !== 'accepted') throw new Error('continuation plan was not registered');

    const runCandidateCheck = async (plan: VerificationPlan, label: string) => {
      const beforeDigest = candidateInputDigestAt(candidateWorktree);
      const beforeHead = gitHost(['rev-parse', 'HEAD'], candidateWorktree);
      const beforeStatus = candidateStatusAt(candidateWorktree);
      if (beforeDigest !== candidateInputDigest || beforeHead !== candidateCommit || beforeStatus.length !== 0) {
        throw new Error(`${label} input freeze failed before execution`);
      }
      const call = await governedCall({
        manager, env, cwd: candidateWorktree,
        argv: plan.commands[0].argv,
        timeoutMs,
        approvalId: label,
        root: runRoot,
        replacements,
        cwdRole: 'candidate_worktree',
      });
      calls.push(call);
      const observationEvidence = evidenceAuthority.recordObservation({
        observation: call.observation,
        stdout: call.stdout,
        stderr: call.stderr,
        processKeyDigest: call.processKeyDigest,
        processPid: call.processPid,
        managerKeyDigest: call.managerKeyDigest,
        binding: {
          planId: plan.runId,
          planDigest: requiredString(plan.planDigest, 'plan digest'),
          candidateId: plan.candidateId,
          checkId: plan.checkId,
          argvDigest: sha256(JSON.stringify(plan.commands[0].argv)),
          cwdDigest: sha256(JSON.stringify(plan.commands[0].cwd)),
          envDigest: sha256(JSON.stringify(plan.commands[0].env)),
          executionInputDigest: executionInputDigest(plan),
        },
      });
      if (!call.success) throw new Error(`${label} failed: ${call.stderr.slice(0, 400)}`);
      const firstLine = call.stdout.split(String.fromCharCode(10)).find((line) => line.trim().startsWith('{')) ?? '';
      const parsed = parseJson(firstLine, label);
      const afterDigest = candidateInputDigestAt(candidateWorktree);
      const afterHead = gitHost(['rev-parse', 'HEAD'], candidateWorktree);
      const afterStatus = candidateStatusAt(candidateWorktree);
      const inputStable = parsed.inputDigest === candidateInputDigest
        && beforeDigest === afterDigest
        && beforeHead === afterHead
        && beforeStatus === afterStatus
        && afterStatus.length === 0;
      return { call, parsed, inputStable, inputDigest: beforeDigest, observationEvidence };
    };
    const primaryRun = await runCandidateCheck(primaryPlan.plan, 'verseshell-candidate-primary');
    const primaryCheckOk = primaryRun.parsed.ok === true && primaryRun.parsed.schema === 'clawx.wp7.candidate-check/v1' && primaryRun.inputStable;
    if (!primaryCheckOk) throw new Error('host candidate check did not pass');
    const collectHostVerdict = (candidateCheckOk: boolean, residualReceiptStatus: string) => {
      const currentHead = gitHost(['rev-parse', 'HEAD'], candidateWorktree);
      const currentStatus = candidateStatusAt(candidateWorktree);
      const currentInputDigest = candidateInputDigestAt(candidateWorktree);
      const repositoryHealthy = currentHead === candidateCommit
        && currentStatus.length === 0
        && currentInputDigest === candidateInputDigest;
      return decideHostVerdict({ candidateCheckOk, repositoryHealthy, residualReceiptStatus });
    };
    const hostDecisionBefore = collectHostVerdict(primaryCheckOk, 'not_run');
    const hostVerdictBefore = hostDecisionBefore.value;

    const makeReceipt = (
      plan: VerificationPlan,
      planEvidence: { path: string; digest: string },
      run: Awaited<ReturnType<typeof runCandidateCheck>>,
      cleanupStatus: VerseShellReceipt['cleanupStatus'],
      receiptId: string,
    ): VerseShellReceipt => ({
      schema: 'clawx.verseshell.execution-receipt/v2',
      receiptId,
      planId: plan.runId,
      planDigest: requiredString(plan.planDigest, 'plan digest'),
      candidateId: plan.candidateId,
      checkId: plan.checkId,
      ownerId: plan.owner,
      epoch: plan.epoch,
      authorizationId: plan.authorizationId,
      argvDigest: sha256(JSON.stringify(plan.commands[0].argv)),
      cwdDigest: sha256(JSON.stringify(plan.commands[0].cwd)),
      envDigest: sha256(JSON.stringify(plan.commands[0].env)),
      executionInputDigest: executionInputDigest(plan),
      requiredScope: plan.requiredScope,
      artifactDigests: [...new Set([
        run.call.observationDigest,
        run.call.stdoutDigest,
        run.call.stderrDigest,
        planEvidence.digest,
        candidateEvidenceRef.digest,
      ])].sort(),
      cleanupStatus,
      status: run.call.timedOut ? 'timed-out' : 'exited',
      exitCode: run.call.exitCode,
      signal: null,
      durationMs: run.call.durationMs,
      stdoutDigest: run.call.stdoutDigest,
      stderrDigest: run.call.stderrDigest,
      processKey: run.call.processKeyDigest,
      authority: { writer: 'verseshell', trusted_source: 'clawx-host-process-artifact-authority' },
      origin: 'verseshell',
      realVerseshell: run.call.authorityObserved,
      observationId: run.call.observationId,
      observationDigest: run.call.observationDigest,
      planFileDigest: planEvidence.digest,
      inputManifestDigest: candidateEvidenceRef.digest,
    });

    const wrongReceipt = {
      ...makeReceipt(primaryPlan.plan, primaryPlanRef, primaryRun, 'clean', 'receipt-wp7-wrong-candidate'),
      candidateId: 'candidate-wrong',
    };
    const wrongReceiptResult = receiptBridge.receive(primaryPlan.plan.runId, wrongReceipt);
    if (wrongReceiptResult.status !== 'rejected_by_policy') throw new Error('wrong-candidate receipt was not rejected');
    const failureRejectedAt = Date.now();
    const hostDecisionAfterFailure = collectHostVerdict(primaryCheckOk, wrongReceiptResult.status);
    const hostVerdictAfterFailure = hostDecisionAfterFailure.value;

    const observeProjectionLinks = hostToolCalls.map((call) => {
      const providerCall = providerCalls.find((entry) => entry.sourceBehaviorEventId === call.completion.eventId);
      return {
        kind: 'observe',
        toolCallId: call.toolCallId,
        runId: call.runId,
        surface: call.completion.surface,
        status: call.completion.status,
        inputDigest: call.started.inputDigest,
        outputDigest: call.completion.outputDigest,
        sourceStartedEventId: call.started.eventId,
        completionEventId: call.completion.eventId,
        behaviorEventId: call.completion.eventId,
        providerCallId: providerCall?.id ?? null,
        providerCallDigest: providerCall?.stdoutDigest ?? null,
        providerCallArgvDigest: providerCall?.argvDigest ?? null,
        providerEvidenceDigest: providerCall?.evidenceDigest ?? null,
      };
    });
    const checkProjectionLinks = [
      { kind: 'check', toolCallId: 'check-producer-stale-read', runId: producerRead.runId, surface: 'file.write', source: consumerWrite, providerCallId: 'vg-check-producer-stale-read' },
      { kind: 'check', toolCallId: 'check-self-own-write', runId: selfWrite.runId, surface: 'file.write', source: selfWrite, providerCallId: 'vg-check-self-own-write' },
    ].map((entry) => {
      const providerCall = providerCalls.find((call) => call.id === entry.providerCallId);
      return {
        kind: entry.kind,
        toolCallId: entry.toolCallId,
        runId: entry.runId,
        surface: entry.surface,
        status: entry.source.completion.status,
        inputDigest: entry.source.started.inputDigest,
        outputDigest: providerCall?.stdoutDigest ?? null,
        sourceStartedEventId: entry.source.started.eventId,
        completionEventId: entry.source.completion.eventId,
        behaviorEventId: entry.source.completion.eventId,
        providerCallId: providerCall?.id ?? null,
        providerCallDigest: providerCall?.stdoutDigest ?? null,
        providerCallArgvDigest: providerCall?.argvDigest ?? null,
        providerEvidenceDigest: providerCall?.evidenceDigest ?? null,
      };
    });
    const factProjectionLinks = [...observeProjectionLinks, ...checkProjectionLinks];
    if (factProjectionLinks.some((entry) => !entry.providerCallId || !entry.providerCallDigest || !entry.providerCallArgvDigest || !entry.providerEvidenceDigest)) {
      throw new Error('host event to VG fact projection is incomplete');
    }

    const continuationStartedAt = Date.now();
    const continuationRun = await runCandidateCheck(continuationPlan.plan, 'verseshell-candidate-continuation');
    const continuationCheckOk = continuationRun.parsed.ok === true
      && continuationRun.parsed.schema === 'clawx.wp7.candidate-check/v1'
      && continuationRun.inputStable;
    if (!continuationCheckOk) throw new Error('continuation candidate check did not pass');
    const hostDecisionAfterContinuation = collectHostVerdict(continuationCheckOk, 'not_run');
    const hostVerdictAfter = hostDecisionAfterContinuation.value;

    const executionEvidence: {
      candidate: { id: string; manifest: Record<string, unknown>; evidence: { path: string; digest: string } };
      primary: {
        plan: VerificationPlan;
        planEvidence: { path: string; digest: string };
        observation: Record<string, unknown>;
        observationEvidence: HostObservationEvidence;
        attemptedReceipt?: VerseShellReceipt;
      };
      continuation: {
        plan: VerificationPlan;
        planEvidence: { path: string; digest: string };
        observation: Record<string, unknown>;
        observationEvidence: HostObservationEvidence;
        receipt?: VerseShellReceipt;
      };
    } = {
      candidate: { id: candidateId, manifest: candidateManifest, evidence: candidateEvidenceRef },
      primary: {
        plan: primaryPlan.plan,
        planEvidence: primaryPlanRef,
        observation: outputEvidence(primaryRun.call),
        observationEvidence: primaryRun.observationEvidence,
        attemptedReceipt: wrongReceipt,
      },
      continuation: {
        plan: continuationPlan.plan,
        planEvidence: continuationPlanRef,
        observation: outputEvidence(continuationRun.call),
        observationEvidence: continuationRun.observationEvidence,
      },
    };
    const processPidsDuringQuery = queryAeProcesses();
    if (!processPidsDuringQuery.ok) throw new Error(`OS process inventory during run unavailable: ${processPidsDuringQuery.error}`);
    const processPidsDuring = processPidsDuringQuery.pids;
    const managedBeforeShutdown = manager.list().map((health) => ({
      keyDigest: sha256(health.key),
      pid: health.pid,
      state: health.state,
    }));
    const preCleanupSeal = {
      schema: 'clawx.versegit.wp7-pre-cleanup-seal/v1',
      generated_at: new Date().toISOString(),
      driven_by: 'agent',
      actor: 'codex',
      task: 'TF-0513',
      candidateManifest,
      candidateEvidence: candidateEvidenceRef,
      factProjectionLinks,
      executionEvidence,
      processBaselinePids: aeBaselinePids,
      processPidsDuring,
      managedProcesses: managedBeforeShutdown,
      observedEventIds: observed.map((event) => event.eventId),
      providerCalls,
      hostFixtureOperations,
    };
    const preCleanupSealEvidence = evidenceAuthority.recordJsonDocument('pre-cleanup-seal', preCleanupSeal);

    const producerSeal = observationBridge.detach('run-wp7-producer', { epoch, ownerId: 'owner-wp7-producer', reason: 'wp7-evidence-sealed' });
    const consumerSeal = observationBridge.detach('run-wp7-consumer', { epoch, ownerId: 'owner-wp7-consumer', reason: 'wp7-evidence-sealed' });
    const selfWriterSeal = observationBridge.detach('run-wp7-self-writer', { epoch, ownerId: 'owner-wp7-self-writer', reason: 'wp7-evidence-sealed' });
    if (producerSeal.status !== 'detached' || consumerSeal.status !== 'detached' || selfWriterSeal.status !== 'detached') {
      throw new Error('observation sessions did not detach cleanly');
    }
    const lateProducerEvent = observationBridge.ingest(
      toolStarted('run-wp7-producer', 'session-wp7-producer', 9, 'late-read', 'Read', { path: 'pricedb.py' }, now + 9),
      { epoch, ownerId: 'owner-wp7-producer', requestId: 'request-late', traceId: 'trace-late', eventId: 'late-event' },
    );
    if (lateProducerEvent.status !== 'stale') throw new Error('late event after detach was not stale');

    await runVg({ label: 'vg-session-end-consumer', cwd: repo, cwdRole: 'repo', args: ['session', 'end', consumerVgSessionRaw, '--reason', 'wp7-complete', '--json'], vgBinary, root: runRoot, replacements, providerCalls, timeoutMs, expectJson: false });
    await runVg({ label: 'vg-session-end-producer', cwd: repo, cwdRole: 'repo', args: ['session', 'end', producerVgSessionRaw, '--reason', 'wp7-complete', '--json'], vgBinary, root: runRoot, replacements, providerCalls, timeoutMs, expectJson: false });
    await runVg({ label: 'vg-session-end-self-writer', cwd: repo, cwdRole: 'repo', args: ['session', 'end', selfWriterVgSessionRaw, '--reason', 'wp7-complete', '--json'], vgBinary, root: runRoot, replacements, providerCalls, timeoutMs, expectJson: false });

    let shutdownError: string | null = null;
    try { await manager.shutdownAll(); } catch (shutdownFailure) {
      shutdownError = String((shutdownFailure as Error)?.message ?? shutdownFailure).slice(0, 400);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
    const processAfterShutdownQuery = queryAeProcesses();
    const managedAfterShutdown = manager.list();
    const managedPids = managedBeforeShutdown
      .map((entry) => entry.pid)
      .filter((pid): pid is number => typeof pid === 'number' && Number.isInteger(pid) && pid > 0);
    const ownedPidChecks = managedPids.map((pid) => queryPidState(pid));
    const survivorPids = ownedPidChecks
      .filter((entry): entry is Extract<PidState, { ok: true; exists: true }> => entry.ok && entry.exists === true)
      .map((entry) => entry.pid);
    const processInventoryClean = processAfterShutdownQuery.ok
      && ownedPidChecks.every((entry) => entry.ok)
      && survivorPids.length === 0
      && managedAfterShutdown.length === 0
      && shutdownError === null;
    const deleted: string[] = [];
    const deletionErrors: string[] = [];
    if (processInventoryClean) {
      for (const [role, path] of [['candidate', candidateWorktree], ['consumer', consumerWorktree], ['producer', producerWorktree]] as const) {
        try {
          if (existsSync(path)) gitHost(['worktree', 'remove', '--force', path], repo);
          deleted.push(role);
        } catch (cleanupError) {
          deletionErrors.push(`${role}: ${String((cleanupError as Error)?.message ?? cleanupError).slice(0, 240)}`);
        }
      }
      try { gitHost(['worktree', 'prune'], repo); } catch (pruneError) {
        deletionErrors.push(`prune: ${String((pruneError as Error)?.message ?? pruneError).slice(0, 240)}`);
      }
    }
    const worktreeSurvivors = [producerWorktree, consumerWorktree, candidateWorktree].filter((path) => existsSync(path)).length;
    let tempRootRemoved = false;
    if (processInventoryClean && deletionErrors.length === 0 && worktreeSurvivors === 0) {
      try {
        rmSync(runRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
        tempRootRemoved = !existsSync(runRoot);
      } catch (rootError) {
        deletionErrors.push(`temp-root: ${String((rootError as Error)?.message ?? rootError).slice(0, 240)}`);
      }
    }
    const newProcessPids = managedPids.filter((pid) => !aeBaselinePids.includes(pid));
    const foreignProcessPids = processPidsDuring.filter((pid) => !aeBaselinePids.includes(pid) && !managedPids.includes(pid));
    const cleanupStatus = processInventoryClean
      && worktreeSurvivors === 0
      && tempRootRemoved
      && deletionErrors.length === 0
      ? 'clean'
      : 'recovery_required';
    cleanup = {
      status: cleanupStatus,
      processesDeleted: processInventoryClean,
      processSurvivors: survivorPids.length,
      managerProcessSurvivors: managedAfterShutdown.length,
      processInventory: {
        baselinePids: aeBaselinePids,
        duringPids: processPidsDuring,
        afterPids: processAfterShutdownQuery.pids,
        newProcessPids,
        foreignProcessPids,
        managedPids,
        ownedPidChecks,
        survivorPids,
        queryOk: processAfterShutdownQuery.ok,
        queryError: processAfterShutdownQuery.ok ? null : processAfterShutdownQuery.error,
        managedBeforeShutdown,
        managedAfterShutdown,
        shutdownError,
      },
      worktreesDeleted: deleted.length,
      worktreeSurvivors,
      tempRootRemoved,
      deletionErrors,
      hostWorktreesDeleted: 0,
      preCleanupSealEvidence,
    };
    const cleanupEvidence = evidenceAuthority.recordCleanup(cleanup);

    const validReceipt = makeReceipt(continuationPlan.plan, continuationPlanRef, continuationRun, cleanupStatus === 'clean' ? 'clean' : 'failed', 'receipt-wp7-continuation');
    executionEvidence.continuation.receipt = validReceipt;
    evidenceAuthority.recordReceipt(validReceipt);
    const continuationReceiptResult = receiptBridge.receive(continuationPlan.plan.runId, validReceipt);
    const abandonedVerdict = receiptBridge.verdict(primaryPlan.plan.runId);
    const continuationVerdict = receiptBridge.verdict(continuationPlan.plan.runId);
    const evidenceManifest = evidenceAuthority.manifest();
    const evidenceAttachment = evidenceAuthority.recordJsonDocument('post-cleanup-attachment', {
      schema: 'clawx.versegit.wp7-cleanup-attachment/v1',
      sealedAt: new Date().toISOString(),
      cleanupEvidence,
      evidenceManifest,
      receiptFlow: {
        wrongReceipt: { status: wrongReceiptResult.status, issues: wrongReceiptResult.issues },
        continuationReceipt: continuationReceiptResult,
        continuationVerdict,
      },
      status: cleanupStatus,
    });

    const sealedEvents = [producerSeal.sessionEnd, consumerSeal.sessionEnd].filter((event): event is VerseGitBehaviorEvent => Boolean(event));
    const behaviorCoverage: BehaviorCoverageReport = buildBehaviorCoverage({ events: [...observed, ...sealedEvents] });
    const crossWorktreeViolations = observed.filter((event) => (
      (event.runId === 'run-wp7-producer' && event.worktreeId !== producerWorktreeId)
      || (event.runId === 'run-wp7-consumer' && event.worktreeId !== consumerWorktreeId)
      || (event.runId === 'run-wp7-self-writer' && event.worktreeId !== producerWorktreeId)
    )).length;
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
      candidate: candidateView,
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
      candidateInputDigest,
      factProjectionCount: factProjectionLinks.length,
      providerCallCount: providerCalls.length,
      governedCallCount: publicCalls.length,
      behaviorEventCount: observed.length + sealedEvents.length,
      wrongReceiptStatus: wrongReceiptResult.status,
      failureRejectedBeforeContinuation: failureRejectedAt <= continuationStartedAt,
      continuationVerdict: continuationVerdict.status,
      receiptAuthorityVerified: continuationVerdict.realVerseshellExecution,
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
        executionAuthority: 'split-provider-facts-and-verseshell-verification',
        fixedArgvAllowlist: ['init', 'version', 'capabilities', 'session', 'observe', 'check'],
        providerCalls,
        hostFixtureOperations,
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
      candidate: candidateView,
      factProjectionLinks,
      executionEvidence,
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
        events: [...observed, ...sealedEvents],
        sessionSeals: [producerSeal, consumerSeal, selfWriterSeal],
      },
      moduleReport,
      hostVerdict: {
        owner: 'host',
        before: hostVerdictBefore,
        afterFailure: hostVerdictAfterFailure,
        afterContinuation: hostVerdictAfter,
        unchanged: hostVerdictBefore === hostVerdictAfterFailure && hostVerdictBefore === hostVerdictAfter,
        value: hostVerdictAfter,
        decisions: { before: hostDecisionBefore, afterFailure: hostDecisionAfterFailure, afterContinuation: hostDecisionAfterContinuation },
      },
      continuation: {
        failedReceiptRejected: wrongReceiptResult.status === 'rejected_by_policy',
        failureRejectedAt: new Date(failureRejectedAt).toISOString(),
        continuationStartedAt: new Date(continuationStartedAt).toISOString(),
        failureRejectedBeforeContinuation: failureRejectedAt <= continuationStartedAt,
        continuationExecuted: true,
        continuationAccepted: continuationReceiptResult.status === 'accepted',
        status: continuationVerdict.status,
      },
      cleanup,
      evidence: {
        schema: 'clawx.versegit.wp7-evidence-bundle/v1',
        preCleanupSeal: preCleanupSealEvidence,
        cleanup: cleanupEvidence,
        postCleanupAttachment: evidenceAttachment,
        manifest: {
          path: evidenceManifest.path,
          digest: evidenceManifest.digest,
          aggregateDigest: evidenceManifest.aggregateDigest,
          fileCount: evidenceManifest.files.length,
        },
      },
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
        boundedVerificationOutputStored: true,
        planReceiptObservationRetained: true,
        providerFactsHostOwnedFixedArgv: true,
        userCodeAndVerificationViaVerseShell: true,
        hostFixtureGitOnly: true,
        nativeVerificationFallbacks: 0,
        rawAbsolutePathsStored: false,
        realHumanEvidenceClaimed: false,
        unobservedSurfaces: ['shellRead', 'directFs', 'mcpWrite', 'network', 'browser'],
      },
      limitations: [
        'Real host-shaped ChatRuntimeEvent objects were generated by the agent harness; no external model conversation is claimed.',
        'VerseGit init/session/observe/check facts use the host-owned typed fixed-argv adapter; candidate verification executes through VerseShell governed ACI.',
        'The host-owned fact adapter is not a second verifier: it cannot execute user code/tests/builds, accept arbitrary argv, or land/admit.',
        'Disposable Git worktree setup/merge/delete operations are host fixture operations and are not user-code execution or verification authority.',
        'The host retains plan, receipt, observation, stdout/stderr and candidate input evidence in a digest-addressed bundle before disposable worktrees are removed.',
        'Only Windows win32-x64 was executed.',
        'No GA, release, default-on, land/admit or M4 authority is claimed.',
      ],
      issues: [],
      digest: null,
    };
    report.digest = documentDigest(report);
    const validationIssues = validateWp7Report(report, { evidenceRoot: evidenceDir ?? resolve(root, WP7_EVIDENCE_DIR) }).issues;
    report.issues = validationIssues;
    report.passed = validationIssues.length === 0 && passed;
    report.status = report.passed ? 'passed' : 'failed';
    report.digest = documentDigest(report);
    return report;
  } catch (caught) {
    error = String((caught as Error)?.stack ?? caught);
    throw caught;
  } finally {
    await manager.shutdownAll().catch(() => undefined);
    if (error) {
      const worktreeRoles = [
        ['producer', producerWorktree],
        ['consumer', consumerWorktree],
        ['candidate', candidateWorktree],
      ].filter(([, path]) => existsSync(path)).map(([role]) => role);
      const failurePath = resolve(root, 'artifacts/versegit/wp7/failure-report.json');
      mkdirSync(dirname(failurePath), { recursive: true });
      const sanitizedError = error.replaceAll(repositoryRoot, '<clawx_root>').replaceAll(runRoot, '<temp_root>');
      writeFileSync(failurePath, `${JSON.stringify({
        schema: 'clawx.versegit.wp7-failure/v1',
        generated_at: new Date().toISOString(),
        driven_by: 'agent',
        actor: 'codex',
        task: 'TF-0513',
        error: sanitizedError,
        cleanup: 'recovery_required',
        tempRootPresent: existsSync(runRoot),
        tempRootName: basename(runRoot),
        worktreesPresent: worktreeRoles,
        processInventoryAfter: queryAeProcesses(),
        rule: 'Cleanup failures preserve disposable resources and evidence for recovery inspection.',
      }, null, 2)}\n`, 'utf8');
    }
  }
}

function findAbsolutePathLeaks(value: unknown, path = 'root', output: string[] = []): string[] {
  if (typeof value === 'string') {
    if (value === process.execPath) return output;
    if (/^[A-Za-z]:[\\/]/u.test(value) || /(?:^|[\s"'=:(,])([A-Za-z]:[\\/][^\s"'),;]+)/u.test(value)) output.push(path);
  } else if (Array.isArray(value)) {
    value.forEach((entry, index) => findAbsolutePathLeaks(entry, `${path}[${index}]`, output));
  } else if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) findAbsolutePathLeaks(entry, `${path}.${key}`, output);
  }
  return output;
}

export function validateWp7Report(
  report: Record<string, unknown>,
  { evidenceRoot }: { evidenceRoot?: string } = {},
): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  const root = resolve(evidenceRoot ?? resolve(repositoryRoot, WP7_EVIDENCE_DIR));
  const add = (condition: boolean, message: string) => { if (!condition) issues.push(message); };
  const evidencePath = (ref: unknown): string | null => {
    if (!ref || typeof ref !== 'object' || Array.isArray(ref)) return null;
    const value = ref as Record<string, unknown>;
    if (typeof value.path !== 'string' || !/^[0-9a-f]{64}$/u.test(String(value.digest ?? ''))) return null;
    const candidate = resolve(root, value.path);
    const rel = relative(root, candidate);
    if (rel.startsWith('..') || resolve(rel) === rel) return null;
    return candidate;
  };
  const readEvidence = <T,>(ref: unknown, label: string): T | null => {
    const path = evidencePath(ref);
    if (!path || !existsSync(path)) { issues.push(`${label} evidence is missing`); return null; }
    const value = ref as { digest: string };
    if (sha256(readFileSync(path)) !== value.digest) { issues.push(`${label} evidence digest mismatch`); return null; }
    try { return JSON.parse(readFileSync(path, 'utf8')) as T; }
    catch { issues.push(`${label} evidence is not JSON`); return null; }
  };

  add(report.schema === WP7_SCHEMA, 'schema mismatch');
  add(report.task === 'TF-0513', 'task mismatch');
  add(report.passed === true && report.status === 'passed', 'report did not pass');
  add(Array.isArray(report.issues) && report.issues.length === 0, 'issues must be empty');

  const identity = report.identity as Record<string, unknown> | undefined;
  const worktrees = (identity?.worktrees ?? []) as Array<Record<string, unknown>>;
  add(Number(identity?.crossWorktreeViolations) === 0, 'cross-worktree identity violations must be zero');
  add(worktrees.length === 2, 'two host worktree/session identities required');
  for (const field of ['role', 'worktreeId', 'agentSessionId', 'vgSessionId']) {
    add(new Set(worktrees.map((entry) => entry[field])).size === worktrees.length, `identity field ${field} must be unique`);
  }

  const provider = report.provider as Record<string, unknown> | undefined;
  add(
    provider?.factRoute === 'host-owned-sidecar-fixed-argv'
      && provider?.verificationRoute === 'verseshell-governed-aci'
      && provider?.executionAuthority === 'split-provider-facts-and-verseshell-verification'
      && provider?.nativeVerificationFallbacks === 0,
    'provider fact and verification execution-authority boundary is inconsistent',
  );
  const providerCalls = (provider?.providerCalls ?? []) as Array<Record<string, unknown>>;
  add(Array.isArray(providerCalls) && providerCalls.length >= 10, 'provider fact-call evidence is incomplete');
  add(providerCalls.every((entry) => (
    entry.success === true
      && entry.route === 'host-owned-sidecar-fixed-argv'
      && Number.isInteger(entry.processPid)
      && Number(entry.processPid) > 0
      && /^[0-9a-f]{64}$/u.test(String(entry.stdoutDigest))
      && /^[0-9a-f]{64}$/u.test(String(entry.stderrDigest))
      && /^[0-9a-f]{64}$/u.test(String(entry.evidenceDigest))
      && typeof entry.evidenceRef === 'string'
  )), 'provider fact adapter failed or did not retain host command evidence');
  for (const entry of providerCalls) {
    const stored = readEvidence<Record<string, unknown>>({ path: entry.evidenceRef, digest: entry.evidenceDigest }, `provider command ${String(entry.id)}`);
    add(stored?.route === 'host-owned-sidecar-fixed-argv', `provider command route evidence mismatch: ${String(entry.id)}`);
    add(stored?.processPid === entry.processPid, `provider command pid evidence mismatch: ${String(entry.id)}`);
    add(stableJson(stored?.argvShape) === stableJson(entry.argvShape), `provider command argv evidence mismatch: ${String(entry.id)}`);
    add(stored?.cwdRole === entry.cwdRole, `provider command cwd evidence mismatch: ${String(entry.id)}`);
    add(stored?.exitCode === entry.exitCode && stored?.timedOut === entry.timedOut, `provider command exit/timeout evidence mismatch: ${String(entry.id)}`);
    add(stored?.stdoutDigest === entry.stdoutDigest && stored?.stderrDigest === entry.stderrDigest, `provider command output evidence mismatch: ${String(entry.id)}`);
  }
  add(/^[0-9a-f]{64}$/u.test(String(provider?.binarySha256 ?? '')), 'VG binary digest missing');
  add(provider?.defaultEnable === false && provider?.singleGreenLight === false, 'provider product locks changed');
  const hostFixtureOperations = (provider?.hostFixtureOperations ?? []) as Array<Record<string, unknown>>;
  add(hostFixtureOperations.length >= 10, 'host worktree fixture operation evidence is incomplete');
  add(hostFixtureOperations.every((entry) => entry.success === true && entry.route === 'host-worktree-fixture-fixed-argv' && /^[0-9a-f]{64}$/u.test(String(entry.stdoutDigest))), 'host worktree fixture operation failed or escaped its boundary');

  const behavior = report.behavior as Record<string, unknown> | undefined;
  const behaviorEvents = (behavior?.events ?? []) as Array<Record<string, unknown>>;
  add(behaviorEvents.length >= 10, 'normalized host event set is incomplete');
  add(new Set(behaviorEvents.map((entry) => entry.eventId)).size === behaviorEvents.length, 'normalized host event IDs must be unique');
  const factProjectionLinks = (report.factProjectionLinks ?? []) as Array<Record<string, unknown>>;
  add(factProjectionLinks.length === 7, 'seven host event to VG fact/check projections required');
  add(new Set(factProjectionLinks.map((entry) => `${String(entry.behaviorEventId)}:${String(entry.providerCallId)}`)).size === factProjectionLinks.length, 'fact projection event/provider pairs must be unique');
  for (const link of factProjectionLinks) {
    const matching = providerCalls.find((entry) => entry.id === link.providerCallId);
    const behaviorEvent = behaviorEvents.find((entry) => entry.eventId === link.behaviorEventId);
    const sourceStartedEvent = behaviorEvents.find((entry) => entry.eventId === link.sourceStartedEventId);
    add(Boolean(matching), `provider call missing for fact projection ${String(link.toolCallId)}`);
    add(Boolean(behaviorEvent), `normalized completion event missing for ${String(link.behaviorEventId)}`);
    add(Boolean(sourceStartedEvent), `normalized started event missing for ${String(link.sourceStartedEventId)}`);
    add(link.inputDigest === sourceStartedEvent?.inputDigest, `fact projection started-input digest mismatch for ${String(link.toolCallId)}`);
    add(link.providerCallDigest === matching?.stdoutDigest, `fact projection digest mismatch for ${String(link.toolCallId)}`);
    add(link.providerCallArgvDigest === matching?.argvDigest, `fact projection argv digest mismatch for ${String(link.toolCallId)}`);
    add(link.providerEvidenceDigest === matching?.evidenceDigest, `fact projection host-command evidence mismatch for ${String(link.toolCallId)}`);
    add(matching?.sourceBehaviorEventId === link.behaviorEventId, `provider call is not bound to behavior event ${String(link.behaviorEventId)}`);
    add(matching?.sourceInputEventId === link.sourceStartedEventId, `provider call was not bound to the started event ${String(link.sourceStartedEventId)}`);
    add(matching?.sourceEventInputDigest === link.inputDigest, `provider call did not consume the normalized started-event input ${String(link.sourceStartedEventId)}`);
  }

  const facts = report.vgFacts as Record<string, unknown> | undefined;
  const positive = facts?.producerConsumer as Record<string, unknown> | undefined;
  const negative = facts?.ownWriteNegativeControl as Record<string, unknown> | undefined;
  add(Array.isArray(positive?.advisoryKinds) && positive.advisoryKinds.includes('ssi/stale-read'), 'producer-consumer stale-read fact missing');
  add(Array.isArray(negative?.advisoryKinds) && negative.advisoryKinds.length === 0, 'own-write negative control not silent');

  const candidate = report.candidate as Record<string, unknown> | undefined;
  add(candidate?.schemaVersion === 2, 'candidate manifest schema mismatch');
  const sourceHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8', windowsHide: true }).trim();
  add(candidate?.baseOid !== sourceHead, 'candidate base OID must come from the disposable repository, not the ClawX source checkout');
  add(candidate?.commitOid !== sourceHead, 'candidate commit OID must not alias the ClawX source commit');
  add(/^[0-9a-f]{64}$/u.test(String(candidate?.candidateId ?? '')), 'candidate ID missing');
  add(/^[0-9a-f]{40,64}$/u.test(String(candidate?.materializedTreeOid ?? '')), 'candidate tree missing');
  add(Array.isArray(candidate?.parentOrder) && candidate.parentOrder.length === 2, 'candidate parent order missing');
  add(/^[0-9a-f]{40,64}$/u.test(String(candidate?.commitOid ?? '')), 'candidate commit missing');
  add(candidate?.candidateWorktreeHead === candidate?.commitOid, 'candidate worktree HEAD is not bound to the candidate commit');
  add(Array.isArray(candidate?.dirtyFiles) && candidate.dirtyFiles.length === 0, 'candidate dirty inputs were not frozen');
  add(Array.isArray(candidate?.untrackedFiles) && candidate.untrackedFiles.length === 0, 'candidate untracked inputs were not frozen');
  add(Array.isArray(candidate?.ignoredRuntimePaths) && candidate.ignoredRuntimePaths.includes('.ae/**'), 'candidate runtime metadata exclusion is not declared');
  const inputFiles = (candidate?.inputFiles ?? []) as Array<Record<string, unknown>>;
  add(inputFiles.length === 2 && inputFiles.every((entry) => typeof entry.path === 'string' && /^[0-9a-f]{64}$/u.test(String(entry.sha256))), 'candidate input manifest is incomplete');
  const recomputedInputDigest = sha256(JSON.stringify({ schemaVersion: 1, files: inputFiles }));
  add(candidate?.inputDigest === recomputedInputDigest, 'candidate input digest is not reproducible');
  const { candidateId: storedCandidateId, ...candidateManifest } = candidate ?? {};
  add(storedCandidateId === sha256(stableJson(candidateManifest)), 'candidate ID does not match its retained manifest');

  const evidenceBundle = report.evidence as Record<string, unknown> | undefined;
  const manifestRef = evidenceBundle?.manifest as Record<string, unknown> | undefined;
  add(Boolean(manifestRef), 'evidence manifest reference is missing');
  const manifestPath = evidencePath({ path: manifestRef?.path, digest: manifestRef?.digest });
  add(Boolean(manifestPath && existsSync(manifestPath)), 'evidence manifest file is missing');
  let manifestFiles: Array<{ path: string; digest: string; bytes: number }> = [];
  if (manifestPath && existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as HostEvidenceManifest;
      manifestFiles = Array.isArray(manifest.files) ? manifest.files : [];
      add(manifest.aggregateDigest === sha256(stableJson(manifestFiles)), 'evidence manifest aggregate digest mismatch');
      add(manifestRef?.aggregateDigest === manifest.aggregateDigest, 'report evidence manifest digest mismatch');
      add(manifestFiles.length >= 10, 'evidence bundle is incomplete');
      for (const file of manifestFiles) {
        const absolute = resolve(root, file.path);
        add(!relative(root, absolute).startsWith('..'), `evidence path escaped root: ${file.path}`);
        add(existsSync(absolute), `evidence file is missing: ${file.path}`);
        if (existsSync(absolute)) {
          add(sha256(readFileSync(absolute)) === file.digest, `evidence file digest mismatch: ${file.path}`);
          add(statSyncSafe(absolute) === file.bytes, `evidence file size mismatch: ${file.path}`);
        }
      }
    } catch {
      issues.push('evidence manifest is not valid JSON');
    }
  }
  add(readEvidence(evidenceBundle?.preCleanupSeal, 'pre-cleanup seal') !== null, 'pre-cleanup seal is missing');
  const cleanupRecord = readEvidence<Record<string, unknown>>(evidenceBundle?.cleanup, 'cleanup');
  add(cleanupRecord !== null, 'cleanup evidence is missing');
  const cleanupAttachment = readEvidence<Record<string, unknown>>(evidenceBundle?.postCleanupAttachment, 'post-cleanup attachment');
  add(cleanupAttachment !== null, 'post-cleanup attachment is missing');
  add(cleanupAttachment?.status === 'clean', 'cleanup attachment is not clean');

  const verseshell = report.verseshell as Record<string, unknown> | undefined;
  const governedCalls = (verseshell?.governedCalls ?? []) as Array<Record<string, unknown>>;
  add(governedCalls.length >= 2, 'governed call evidence is incomplete');
  add(governedCalls.every((entry) => (
    entry.success === true
      && entry.authorityObserved === true
      && Number.isInteger(entry.processPid)
      && Number(entry.processPid) > 0
      && entry.routeProfile === 'clawx-governed-exec-v1'
      && Array.isArray(entry.capabilities)
      && entry.capabilities.includes('shell.exec')
      && /^[0-9a-f]{64}$/u.test(String(entry.observationDigest))
  )), 'a governed call did not succeed with shell-process authority');
  add(Number(verseshell?.approvalRequiredCalls) > 0, 'host approval evidence missing');
  add(verseshell?.shellExecAuthorityCalls === governedCalls.length, 'not every governed call used shell.exec authority');
  const governedIds = governedCalls.map((entry) => entry.id);
  add(new Set(governedIds).size === governedIds.length, 'governed call IDs must be unique');
  for (const call of governedCalls) {
    const observationPath = join(root, 'observations', `${sha256(String(call.observationId))}.json`);
    add(existsSync(observationPath), `host observation missing for governed call ${String(call.id)}`);
    if (existsSync(observationPath)) {
      const stored = JSON.parse(readFileSync(observationPath, 'utf8')) as HostObservationEvidence;
      add(stored.observationDigest === call.observationDigest, `governed observation digest mismatch for ${String(call.id)}`);
      add(stored.process.processKeyDigest === call.processKeyDigest, `governed process identity mismatch for ${String(call.id)}`);
      add(Number.isInteger(stored.process.pid) && Number(stored.process.pid) > 0, `governed process pid missing for ${String(call.id)}`);
    }
  }

  const executionEvidence = report.executionEvidence as Record<string, unknown> | undefined;
  const primaryEvidence = executionEvidence?.primary as Record<string, unknown> | undefined;
  const continuationEvidence = executionEvidence?.continuation as Record<string, unknown> | undefined;
  const candidateEvidence = executionEvidence?.candidate as Record<string, unknown> | undefined;
  add(candidateEvidence?.id === candidate?.candidateId, 'execution evidence candidate identity mismatch');
  const candidateInputEvidence = readEvidence<Record<string, unknown>>(candidateEvidence?.evidence, 'candidate input');
  add(candidateInputEvidence !== null, 'candidate input evidence is missing');
  add(candidateInputEvidence?.candidateId === candidate?.candidateId, 'candidate input evidence identity mismatch');
  add(stableJson(candidateInputEvidence?.manifest) === stableJson(candidateManifest), 'candidate report differs from the frozen input manifest');
  for (const [label, entry] of [['primary', primaryEvidence], ['continuation', continuationEvidence]] as const) {
    const plan = entry?.plan as VerificationPlan | undefined;
    const observation = entry?.observation as Record<string, unknown> | undefined;
    const observationEvidence = entry?.observationEvidence as Record<string, unknown> | undefined;
    add(Boolean(plan), `${label} plan missing`);
    if (plan) {
      add(plan.planDigest === planDigest(plan), `${label} plan digest is not reproducible`);
      add(plan.candidateId === candidate?.candidateId, `${label} plan candidate mismatch`);
      add(plan.candidateInputDigest === candidate?.inputDigest, `${label} plan input digest mismatch`);
      add(plan.commands?.[0]?.cwd === '.', `${label} plan cwd must be workspace-relative`);
      add(plan.commands?.[0]?.argv?.[2] === candidate?.inputDigest, `${label} plan argv must bind candidate input digest`);
    }
    add(readEvidence(entry?.planEvidence, `${label} plan`) !== null, `${label} plan evidence is missing`);
    add(observation?.success === true && observation?.authorityObserved === true, `${label} observation is not authoritative`);
    add(Number.isInteger(observation?.processPid) && Number(observation?.processPid) > 0, `${label} OS process evidence missing`);
    add(typeof observation?.stdout === 'string' && observation.stdout.length > 0, `${label} stdout evidence missing`);
    add(observationEvidence?.observationId === observation?.observationId, `${label} observation identity mismatch`);
    add(observationEvidence?.observationDigest === observation?.observationDigest, `${label} observation evidence digest mismatch`);
    const binding = observationEvidence?.binding as Record<string, unknown> | undefined;
    add(binding?.planId === plan?.runId, `${label} observation plan identity mismatch`);
    add(binding?.planDigest === plan?.planDigest, `${label} observation plan digest mismatch`);
    add(binding?.candidateId === plan?.candidateId, `${label} observation candidate mismatch`);
    add(binding?.checkId === plan?.checkId, `${label} observation check mismatch`);
    add(binding?.argvDigest === sha256(JSON.stringify(plan?.commands?.[0]?.argv ?? [])), `${label} observation argv mismatch`);
    add(binding?.executionInputDigest === (plan ? executionInputDigest(plan) : null), `${label} observation execution input mismatch`);
  }

  const attemptedReceipt = primaryEvidence?.attemptedReceipt as VerseShellReceipt | undefined;
  const continuationReceipt = continuationEvidence?.receipt as VerseShellReceipt | undefined;
  const primaryPlan = primaryEvidence?.plan as VerificationPlan | undefined;
  const continuationPlan = continuationEvidence?.plan as VerificationPlan | undefined;
  const continuationObservation = continuationEvidence?.observation as Record<string, unknown> | undefined;
  add(attemptedReceipt?.candidateId !== candidate?.candidateId && attemptedReceipt?.cleanupStatus === 'clean', 'wrong-candidate receipt negative control is missing');
  add(Boolean(continuationReceipt) && Boolean(continuationPlan), 'continuation receipt is missing');
  if (continuationReceipt && continuationPlan) {
    add(validateReceipt(continuationPlan, continuationReceipt).status === 'accepted', 'continuation receipt does not satisfy the structural binding contract');
    add(continuationReceipt.cleanupStatus === 'clean', 'continuation receipt cleanup is not clean');
    add(continuationReceipt.realVerseshell === true, 'continuation receipt is not real VerseShell evidence');
    add(continuationReceipt.observationId === continuationObservation?.observationId, 'continuation receipt observation identity mismatch');
    add(continuationReceipt.observationDigest === continuationObservation?.observationDigest, 'continuation observation digest mismatch');
    add(continuationReceipt.stdoutDigest === continuationObservation?.stdoutDigest, 'continuation stdout digest mismatch');
    add(continuationReceipt.stderrDigest === continuationObservation?.stderrDigest, 'continuation stderr digest mismatch');
    const planEvidence = continuationEvidence?.planEvidence as Record<string, unknown> | undefined;
    add(continuationReceipt.planFileDigest === planEvidence?.digest, 'continuation receipt plan-file digest mismatch');
    const candidateFileEvidence = candidateEvidence?.evidence as Record<string, unknown> | undefined;
    add(continuationReceipt.inputManifestDigest === candidateFileEvidence?.digest, 'continuation receipt input-manifest digest mismatch');
    const authorityCheck = new FileVerseShellReceiptAuthority(root).verifyReceipt({ plan: continuationPlan, receipt: continuationReceipt });
    add(authorityCheck.ok, `host evidence authority rejected continuation receipt: ${authorityCheck.issues.slice(0, 3).join('; ')}`);
  }

  const receiptFlow = report.receiptFlow as Record<string, unknown> | undefined;
  const wrong = receiptFlow?.wrongReceipt as Record<string, unknown> | undefined;
  const continuationResult = receiptFlow?.continuationReceipt as Record<string, unknown> | undefined;
  const continuationVerdict = receiptFlow?.continuationVerdict as Record<string, unknown> | undefined;
  add(wrong?.status === 'rejected_by_policy' && wrong?.hostVerdict === 'unchanged', 'wrong receipt was not rejected');
  add(continuationResult?.status === 'accepted', 'continuation receipt was not accepted');
  add(continuationVerdict?.status === 'observed' && continuationVerdict?.realVerseshellExecution === true, 'continuation verdict is not observed');
  add(continuationVerdict?.singleGreenLight === false && continuationVerdict?.hostVerdict === 'unchanged', 'continuation verdict flattened authority');

  const hostVerdict = report.hostVerdict as Record<string, unknown> | undefined;
  const decisions = hostVerdict?.decisions as Record<string, unknown> | undefined;
  add(hostVerdict?.before === 'pass' && hostVerdict?.afterFailure === 'pass' && hostVerdict?.afterContinuation === 'pass' && hostVerdict?.unchanged === true, 'host verdict changed or was not independently produced');
  for (const key of ['before', 'afterFailure', 'afterContinuation']) {
    const decision = decisions?.[key] as Record<string, unknown> | undefined;
    const inputs = decision?.inputs as Record<string, unknown> | undefined;
    add(decision?.value === 'pass' && inputs?.candidateCheckOk === true && inputs?.repositoryHealthy === true, `host decision evidence is incomplete: ${key}`);
  }
  const continuation = report.continuation as Record<string, unknown> | undefined;
  add(continuation?.failedReceiptRejected === true && continuation?.continuationAccepted === true && continuation?.continuationExecuted === true, 'failure continuation proof incomplete');
  add(continuation?.failureRejectedBeforeContinuation === true
    && typeof continuation?.failureRejectedAt === 'string'
    && typeof continuation?.continuationStartedAt === 'string'
    && Date.parse(continuation.failureRejectedAt) <= Date.parse(continuation.continuationStartedAt), 'failure rejection did not precede continuation');

  const cleanup = report.cleanup as Record<string, unknown> | undefined;
  const processInventory = cleanup?.processInventory as Record<string, unknown> | undefined;
  const baselinePids = (processInventory?.baselinePids ?? []) as number[];
  const afterPids = (processInventory?.afterPids ?? []) as number[];
  const duringPids = (processInventory?.duringPids ?? []) as number[];
  const managedBefore = (processInventory?.managedBeforeShutdown ?? []) as Array<Record<string, unknown>>;
  const managedPids = (processInventory?.managedPids ?? []) as number[];
  const declaredManagedPids = managedBefore.map((entry) => entry.pid).filter((pid): pid is number => typeof pid === 'number');
  const ownedPidChecks = (processInventory?.ownedPidChecks ?? []) as Array<Record<string, unknown>>;
  const survivorPids = ownedPidChecks.filter((entry) => entry.ok === true && entry.exists === true).map((entry) => entry.pid);
  add(stableJson(cleanupRecord) === stableJson(cleanup), 'report cleanup differs from host-recorded cleanup evidence');
  add(cleanup?.status === 'clean' && cleanup?.processesDeleted === true && cleanup?.processSurvivors === 0 && cleanup?.managerProcessSurvivors === 0 && cleanup?.worktreeSurvivors === 0 && cleanup?.tempRootRemoved === true && cleanup?.hostWorktreesDeleted === 0 && cleanup?.worktreesDeleted === 3 && Array.isArray(cleanup?.deletionErrors) && cleanup.deletionErrors.length === 0, 'cleanup boundary failed');
  add(processInventory?.queryOk === true && processInventory?.queryError === null, 'OS process inventory was not available after cleanup');
  add(processInventory?.shutdownError === null, 'VerseShell shutdown failed');
  add(managedBefore.length > 0 && declaredManagedPids.length === managedBefore.length, 'VerseShell process inventory before shutdown is missing');
  add(new Set(declaredManagedPids).size === declaredManagedPids.length, 'VerseShell managed PID vector contains duplicates');
  add(stableJson(managedPids) === stableJson(declaredManagedPids), 'declared owned PID vector is inconsistent');
  add(managedPids.length > 0 && ownedPidChecks.length === managedPids.length && ownedPidChecks.every((entry) => entry.ok === true), 'owned PID exit checks are incomplete');
  const checkedPids = ownedPidChecks.map((entry) => entry.pid).filter((pid): pid is number => Number.isInteger(pid) && Number(pid) > 0);
  add(checkedPids.length === ownedPidChecks.length, 'owned PID exit-check identities are malformed');
  add(new Set(checkedPids).size === checkedPids.length, 'owned PID exit-check identities are duplicated');
  add(stableJson([...checkedPids].sort((a, b) => a - b)) === stableJson([...managedPids].sort((a, b) => a - b)), 'owned PID exit-check identities differ from managed PIDs');
  add(managedPids.every((pid) => duringPids.includes(pid)), 'managed VerseShell PIDs were not observed during the run');
  add(managedPids.every((pid) => !baselinePids.includes(pid)), 'managed VerseShell PIDs overlap the baseline inventory');
  add(managedPids.every((pid) => !afterPids.includes(pid)), 'managed VerseShell PID survived cleanup');
  add(Array.isArray(processInventory?.managedAfterShutdown) && processInventory.managedAfterShutdown.length === 0, 'VerseShell manager retained managed processes');
  add(processInventory?.survivorPids?.length === 0 && survivorPids.length === 0, 'nonzero OS process survivor evidence was retained');
  add(JSON.stringify(survivorPids) === JSON.stringify(processInventory?.survivorPids), 'owned OS process survivor inventory is inconsistent');
  add(cleanup?.processSurvivors === survivorPids.length, 'cleanup survivor count differs from owned PID exit checks');

  const boundaries = report.boundaries as Record<string, unknown> | undefined;
  add(boundaries?.hostSourceMutated === false && boundaries?.userIdRepositoryMutated === false && boundaries?.landOrAdmitInvoked === false, 'repository or landing boundary failed');
  add(boundaries?.defaultOn === false && boundaries?.ga === false && boundaries?.releaseEligible === false && boundaries?.m4Authorized === false, 'product authority boundary failed');
  add(boundaries?.realHumanEvidenceClaimed === false, 'real-human evidence was claimed');
  add(boundaries?.planReceiptObservationRetained === true && boundaries?.providerFactsHostOwnedFixedArgv === true && boundaries?.userCodeAndVerificationViaVerseShell === true, 'host evidence or execution-authority boundary failed');
  add(behavior?.lateEventStatus === 'stale', 'late event was not stale');
  add(Array.isArray(behavior?.sessionSeals) && behavior.sessionSeals.length === 3 && behavior.sessionSeals.every((seal) => (seal as Record<string, unknown>)?.status === 'detached'), 'observation session seals are incomplete');

  const normalized = report.normalizedOutcome as Record<string, unknown> | undefined;
  add(report.normalizedOutcomeDigest === sha256(stableJson(normalized)), 'normalized outcome digest is not reproducible');
  add(normalized?.candidateInputDigest === candidate?.inputDigest, 'normalized candidate input digest mismatch');
  add(normalized?.factProjectionCount === factProjectionLinks.length, 'normalized fact projection count mismatch');
  add(normalized?.providerCallCount === providerCalls.length, 'normalized provider call count mismatch');
  add(normalized?.governedCallCount === governedCalls.length, 'normalized governed call count mismatch');
  add(normalized?.behaviorEventCount === behaviorEvents.length, 'normalized behavior event count mismatch');
  add(normalized?.receiptAuthorityVerified === true, 'normalized verdict did not retain host evidence authority');
  add(normalized?.failureRejectedBeforeContinuation === true, 'normalized outcome lost failure-before-continuation ordering');
  add(findAbsolutePathLeaks(report).length === 0, `absolute path leak: ${findAbsolutePathLeaks(report).slice(0, 3).join(', ')}`);
  if (report.digest !== documentDigest(report)) issues.push('digest is not reproducible');
  return { ok: issues.length === 0, issues: [...new Set(issues)] };
}

function statSyncSafe(path: string): number | null {
  try { return statSync(path).size; } catch { return null; }
}

function listRelativeFiles(root: string, current = root): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const absolute = join(current, entry.name);
    if (entry.isDirectory()) files.push(...listRelativeFiles(root, absolute));
    else if (entry.isFile()) files.push(relative(root, absolute).replaceAll('\\', '/'));
  }
  return files;
}

function writeShaManifest(root: string, manifestPath: string, paths: string[]): void {
  const lines = [...new Set(paths)].sort().map((path) => {
    const absolute = resolve(root, path);
    if (!existsSync(absolute)) throw new Error(`SHA256SUMS input missing: ${path}`);
    return `${sha256(readFileSync(absolute))}  ${path}`;
  });
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, `${lines.join(String.fromCharCode(10))}\n`, 'utf8');
}

export async function writeWp7Report({
  output,
  fixturePath,
  root = repositoryRoot,
  evidenceDir,
}: {
  output?: string;
  fixturePath?: string;
  root?: string;
  evidenceDir?: string;
} = {}): Promise<{ path: string; report: Record<string, unknown>; validation: { ok: boolean; issues: string[] } }> {
  return (async () => {
    const artifactEvidenceDir = resolve(root, WP7_EVIDENCE_DIR);
    const activeEvidenceDir = evidenceDir ? resolve(evidenceDir) : artifactEvidenceDir;
    const report = await buildWp7Report({
      root,
      fixturePath: fixturePath ?? resolve(root, WP7_FIXTURE_PATH),
      evidenceDir: activeEvidenceDir,
    });
    const validation = validateWp7Report(report, { evidenceRoot: activeEvidenceDir });
    const path = output ? resolve(output) : resolve(root, WP7_ARTIFACT_PATH);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

    if (!evidenceDir) {
      const curatedReportPath = resolve(root, WP7_EVIDENCE_PATH);
      const curatedEvidenceDir = resolve(root, WP7_CURATED_EVIDENCE_DIR);
      mkdirSync(dirname(curatedReportPath), { recursive: true });
      writeFileSync(curatedReportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
      rmSync(curatedEvidenceDir, { recursive: true, force: true });
      cpSync(artifactEvidenceDir, curatedEvidenceDir, { recursive: true });
    }

    const sourcePaths = [
      'scripts/versegit-wp7-host-vertical.mts',
      'scripts/verify-versegit-wp7.mts',
      'scripts/validate-versegit-planning-correction.mjs',
      'tests/unit/versegit-wp7-host-vertical.test.ts',
      'tests/unit/versegit-receipt-authority.test.ts',
      'harness/specs/tasks/versegit-wp7-host-vertical-slice.md',
      'harness/specs/rules/versegit-validation-layer-extension-boundary.md',
      'harness/specs/scenarios/versegit-validation-layer-extension.md',
      'harness/specs/guides/versegit-concurrency/implementation-roadmap-and-acceptance.md',
      'harness/specs/guides/versegit-concurrency/verseshell-and-behavior-observability.md',
      'harness/specs/guides/versegit-concurrency/versegit-planning-correction-matrix.md',
      'harness/specs/fixtures/versegit-planning-correction/wp7-host-vertical-fixture.json',
      'electron/services/versegit-receipt-bridge.ts',
      'electron/services/versegit-receipt-evidence.ts',
      'electron/services/versegit-module.ts',
      'electron/services/versegit-observation.ts',
      'electron/services/versegit-behavior-coverage.ts',
      'openclaw_runtime/src/agents/verseshell/governed-exec.ts',
      'openclaw_runtime/src/agents/verseshell/process-manager.ts',
      'openclaw_runtime/src/agents/verseshell/policy-profile.ts',
    ];
    const artifactRelative = relative(root, path).replaceAll('\\', '/');
    writeShaManifest(root, resolve(root, 'artifacts/versegit/wp7/SHA256SUMS'), [
      artifactRelative,
      ...sourcePaths,
      ...listRelativeFiles(artifactEvidenceDir).map((entry) => `${WP7_EVIDENCE_DIR}/${entry}`),
    ]);
    if (!evidenceDir) {
      writeShaManifest(root, resolve(root, 'harness/specs/fixtures/versegit-planning-correction/wp7-evidence/SHA256SUMS'), [
        WP7_EVIDENCE_PATH,
        ...sourcePaths,
        ...listRelativeFiles(resolve(root, WP7_CURATED_EVIDENCE_DIR)).map((entry) => `${WP7_CURATED_EVIDENCE_DIR}/${entry}`),
      ]);
    }
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
