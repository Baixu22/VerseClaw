/**
 * Bounded, host-owned VerseGit fact adapter for M1/M2 provider facts.
 *
 * The provider command surface is a fixed catalog. Callers supply only typed
 * operation inputs and an already-authorized mode/identity/grant envelope.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { spawn } from '../utils/counted-child-process';

export const VG_FACT_SCHEMA = 'clawx.versegit.fact-result/v1';
export const VG_FACT_OPERATION_SCHEMA = 'clawx.versegit.fact-operation/v1';
export const VG_FACT_MODES = ['M0', 'M1', 'M2', 'M3'] as const;
export type VerseGitFactMode = (typeof VG_FACT_MODES)[number];
export type VerseGitFactOperation = 'version' | 'capabilities' | 'doctor' | 'sessionList' | 'sessionShow' | 'observeRead' | 'check';
export type VerseGitFactStatus = 'not_applicable' | 'unavailable' | 'partial' | 'observed' | 'degraded' | 'rejected_by_policy';

export type VerseGitFactEffects = {
  process: boolean;
  fileRead: boolean;
  domainStateWrite: boolean;
  workspaceWrite: false;
  gitObjectWrite: false;
  execute: false;
  network: false;
};

export type VerseGitFactIdentity = {
  repoId: string;
  worktreeId: string;
  ownerId: string;
  epoch: number;
  sessionId: string;
  vgSessionId?: string;
};

export type VerseGitFactGrant = {
  mode: VerseGitFactMode;
  authorizationId: string;
  ownerId: string;
  epoch: number;
  repoId: string;
  worktreeId: string;
  capabilityDigest: string;
  expiresAt: string;
  revoked: boolean;
};

export type VerseGitFactTrigger = {
  reason: string;
  enabled: boolean;
  worktreeCount: number;
  activeSessionCount: number;
};

export type VerseGitFactInput = {
  sessionId?: string;
  vgSessionId?: string;
  path?: string;
  lineStart?: number;
  lineEnd?: number;
};

export type VerseGitOutputSummary = {
  sha256: string;
  bytes: number;
  truncated: boolean;
};

export type VerseGitObservation = {
  schema: 'clawx.versegit.fact-observation/v1';
  operation: VerseGitFactOperation;
  mode: VerseGitFactMode;
  authorizationId: string | null;
  ownerId: string | null;
  epoch: number | null;
  binary: { role: 'provider-binary'; sha256: string | null };
  argv: readonly string[];
  cwd_role: 'provider-workspace';
  pid: number | null;
  process_started: boolean;
  exit_code: number | null;
  signal: NodeJS.Signals | null;
  deadline_ms: number;
  timed_out: boolean;
  cancelled: boolean;
  pid_alive_after: boolean;
  started_at: string;
  ended_at: string;
  effects: VerseGitFactEffects;
  stdout: VerseGitOutputSummary;
  stderr: VerseGitOutputSummary;
  host_verdict: 'unchanged';
};

export type VerseGitFactResult<T = unknown> = {
  schema: typeof VG_FACT_SCHEMA;
  operation: VerseGitFactOperation;
  status: VerseGitFactStatus;
  reason?: string;
  value?: T;
  document?: T;
  issues: string[];
  observation: VerseGitObservation;
  host_verdict: 'unchanged';
};

type FactOperationSpec = {
  minMode: 'M1' | 'M2';
  effects: VerseGitFactEffects;
  argv: (identity: VerseGitFactIdentity, input: VerseGitFactInput) => readonly string[];
  parse: 'text' | 'json';
};

type BoundedResult = {
  pid: number | null;
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: Buffer;
  stderr: Buffer;
  truncated: boolean;
  timedOut: boolean;
  cancelled: boolean;
  startedAt: string;
  endedAt: string;
};

export type VerseGitFactAdapterOptions = {
  binaryPath: string;
  workspacePath: string;
  expectedBinarySha256: string;
  expectedVersion: string;
  expectedCapabilitiesDigest: string;
  contractDigest: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  now?: () => number;
};

const MODE_RANK: Record<VerseGitFactMode, number> = { M0: 0, M1: 1, M2: 2, M3: 3 };
const READ_EFFECTS: VerseGitFactEffects = { process: true, fileRead: true, domainStateWrite: false, workspaceWrite: false, gitObjectWrite: false, execute: false, network: false };
const STATE_OPEN_EFFECTS: VerseGitFactEffects = { process: true, fileRead: true, domainStateWrite: true, workspaceWrite: false, gitObjectWrite: false, execute: false, network: false };
const NO_EFFECTS: VerseGitFactEffects = { process: false, fileRead: false, domainStateWrite: false, workspaceWrite: false, gitObjectWrite: false, execute: false, network: false };
const FIXED_OPERATIONS: Record<VerseGitFactOperation, FactOperationSpec> = {
  version: { minMode: 'M1', effects: READ_EFFECTS, argv: () => ['--version'], parse: 'text' },
  capabilities: { minMode: 'M1', effects: READ_EFFECTS, argv: () => ['capabilities', '--json'], parse: 'json' },
  doctor: { minMode: 'M2', effects: STATE_OPEN_EFFECTS, argv: () => ['doctor', '--json'], parse: 'json' },
  sessionList: { minMode: 'M2', effects: STATE_OPEN_EFFECTS, argv: () => ['session', 'list', '--json'], parse: 'json' },
  sessionShow: { minMode: 'M2', effects: STATE_OPEN_EFFECTS, argv: (identity, input) => ['session', 'show', requireOpaque(input.vgSessionId ?? identity.vgSessionId, 'session id'), '--json'], parse: 'json' },
  observeRead: { minMode: 'M2', effects: STATE_OPEN_EFFECTS, argv: (identity, input) => ['observe', 'read', '--session', requireOpaque(input.vgSessionId ?? identity.vgSessionId, 'session id'), '--path', requireRelativePath(input.path), ...(input.lineStart === undefined ? [] : ['--line-start', String(requireLine(input.lineStart, 'lineStart'))]), ...(input.lineEnd === undefined ? [] : ['--line-end', String(requireLine(input.lineEnd, 'lineEnd'))]), '--json'], parse: 'json' },
  check: { minMode: 'M2', effects: STATE_OPEN_EFFECTS, argv: (identity, input) => ['check', '--file', requireRelativePath(input.path), '--session', requireOpaque(input.vgSessionId ?? identity.vgSessionId, 'session id'), '--json'], parse: 'json' },
};

function sha256(value: string | Uint8Array): string { return createHash('sha256').update(value).digest('hex'); }
function isSha256(value: unknown): value is string { return typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value); }
function requireOpaque(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.trim().length > 200 || isAbsolute(value.trim())) throw new Error(`${label} must be a non-empty opaque identifier`);
  return value.trim();
}
function requireRelativePath(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0 || isAbsolute(value) || value.includes('\0') || /[\r\n]/u.test(value)) throw new Error('path must be a non-empty relative path');
  const normalized = value.replaceAll('\\', '/');
  if (normalized.startsWith('../') || normalized.split('/').includes('..')) throw new Error('path must stay inside the provider workspace');
  return value;
}
function requireLine(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 1_000_000) throw new Error(`${label} must be a positive line number`);
  return Number(value);
}
function emptySummary(): VerseGitOutputSummary { return { sha256: sha256(Buffer.alloc(0)), bytes: 0, truncated: false }; }
function outputSummary(value: Buffer, truncated: boolean): VerseGitOutputSummary { return { sha256: sha256(value), bytes: value.byteLength, truncated }; }
function isAlive(pid: number | null): boolean { if (!pid) return false; try { process.kill(pid, 0); return true; } catch { return false; } }
function fixedEnv(): NodeJS.ProcessEnv {
  const keys = ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP'];
  return Object.fromEntries(keys.flatMap((key) => process.env[key] === undefined ? [] : [[key, process.env[key]]]));
}
async function runBounded(binaryPath: string, argv: readonly string[], options: { cwd: string; timeoutMs: number; maxOutputBytes: number; signal?: AbortSignal }): Promise<BoundedResult> {
  const startedAt = new Date().toISOString();
  const child = spawn(binaryPath, [...argv], { cwd: options.cwd, env: fixedEnv(), shell: false, windowsHide: true, detached: false, stdio: ['ignore', 'pipe', 'pipe'] });
  const pid = Number.isInteger(child.pid) && child.pid! > 0 ? child.pid! : null;
  const stdout: Buffer[] = []; const stderr: Buffer[] = []; let stdoutBytes = 0; let stderrBytes = 0; let truncated = false;
  const capture = (target: Buffer[], chunk: Buffer, currentBytes: number) => {
    const remaining = Math.max(0, options.maxOutputBytes - currentBytes);
    if (remaining > 0) target.push(chunk.subarray(0, remaining));
    if (chunk.byteLength > remaining) truncated = true;
    return currentBytes + chunk.byteLength;
  };
  child.stdout?.on('data', (chunk: Buffer) => { stdoutBytes = capture(stdout, chunk, stdoutBytes); });
  child.stderr?.on('data', (chunk: Buffer) => { stderrBytes = capture(stderr, chunk, stderrBytes); });
  let timedOut = false; let cancelled = false; let settled = false;
  const terminate = () => { if (pid) { try { process.kill(pid, 'SIGKILL'); } catch { /* process already exited */ } } try { child.kill('SIGKILL'); } catch { /* process already exited */ } };
  const timer = setTimeout(() => { timedOut = true; terminate(); }, options.timeoutMs);
  const onAbort = () => { cancelled = true; terminate(); };
  options.signal?.addEventListener('abort', onAbort, { once: true });
  const codeSignal = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolvePromise) => {
    child.once('error', () => { if (!settled) { settled = true; resolvePromise({ code: null, signal: null }); } });
    child.once('close', (code, signal) => { if (!settled) { settled = true; resolvePromise({ code, signal }); } });
  });
  clearTimeout(timer); options.signal?.removeEventListener('abort', onAbort);
  if (timedOut || cancelled) await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  return { pid, code: codeSignal.code, signal: codeSignal.signal, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr), truncated, timedOut, cancelled, startedAt, endedAt: new Date().toISOString() };
}

export function verseGitFactModeEffects(): Record<VerseGitFactMode, { process: boolean; stateRead: boolean; domainStateWrite: boolean; workspaceWrite: false; execute: false }> {
  return { M0: { process: false, stateRead: false, domainStateWrite: false, workspaceWrite: false, execute: false }, M1: { process: true, stateRead: true, domainStateWrite: false, workspaceWrite: false, execute: false }, M2: { process: true, stateRead: true, domainStateWrite: true, workspaceWrite: false, execute: false }, M3: { process: true, stateRead: true, domainStateWrite: true, workspaceWrite: false, execute: false } };
}

export function verseGitFactCatalog() {
  return Object.fromEntries(Object.entries(FIXED_OPERATIONS).map(([operation, spec]) => [operation, { schema: VG_FACT_OPERATION_SCHEMA, operation, minMode: spec.minMode, effects: { ...spec.effects }, fixedArgv: operation === 'sessionShow' || operation === 'observeRead' || operation === 'check' ? 'typed-input-only' : spec.argv({ repoId: 'repo', worktreeId: 'worktree', ownerId: 'owner', epoch: 1, sessionId: 'session' }, {}) }]));
}

export class VerseGitFactAdapter {
  private readonly calls: VerseGitObservation[] = [];
  private readonly now: () => number;
  readonly binaryPath: string;
  readonly workspacePath: string;
  readonly expectedBinarySha256: string;
  readonly expectedVersion: string;
  readonly expectedCapabilitiesDigest: string;
  readonly contractDigest: string;
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;

  constructor(options: VerseGitFactAdapterOptions) {
    if (!existsSync(options.binaryPath) || !statSync(options.binaryPath).isFile()) throw new Error('provider binary path is not a regular file');
    if (!isAbsolute(options.binaryPath)) throw new Error('provider binary path must be absolute and host-fixed');
    if (!existsSync(options.workspacePath) || !statSync(options.workspacePath).isDirectory()) throw new Error('provider workspace path is not a directory');
    if (!isSha256(options.expectedBinarySha256)) throw new Error('expected binary digest is invalid');
    if (!isSha256(options.expectedCapabilitiesDigest) || !isSha256(options.contractDigest)) throw new Error('expected capability/contract digest is invalid');
    this.binaryPath = options.binaryPath; this.workspacePath = options.workspacePath; this.expectedBinarySha256 = options.expectedBinarySha256; this.expectedVersion = options.expectedVersion; this.expectedCapabilitiesDigest = options.expectedCapabilitiesDigest; this.contractDigest = options.contractDigest; this.timeoutMs = Math.max(1, Math.min(options.timeoutMs ?? 30_000, 120_000)); this.maxOutputBytes = Math.max(256, Math.min(options.maxOutputBytes ?? 64 * 1024, 1024 * 1024)); this.now = options.now ?? Date.now;
  }

  get observations(): readonly VerseGitObservation[] { return this.calls; }
  get processCount(): number { return this.calls.filter((entry) => entry.process_started).length; }

  private preflight(operation: VerseGitFactOperation, identity: VerseGitFactIdentity, grant: VerseGitFactGrant, trigger: VerseGitFactTrigger): { issues: string[]; status: VerseGitFactStatus; spec: FactOperationSpec | null } {
    const spec = FIXED_OPERATIONS[operation] ?? null; const issues: string[] = [];
    if (!spec) return { spec, status: 'rejected_by_policy', issues: ['operation is not in the fixed fact catalog'] };
    if (!trigger || trigger.enabled !== true) return { spec, status: 'not_applicable', issues: ['adapter is disabled or opt-in trigger is absent'] };
    if (trigger.worktreeCount < 2 && trigger.activeSessionCount < 2) return { spec, status: 'not_applicable', issues: ['concurrent worktree/session trigger is absent'] };
    if (!grant || !grant.authorizationId?.trim()) issues.push('authorization id is missing');
    if (!grant || !(VerseGitFactAdapter.modes as readonly string[]).includes(String(grant?.mode))) issues.push('mode is invalid');
    else if (MODE_RANK[grant.mode] < MODE_RANK[spec.minMode]) issues.push(`operation ${operation} requires ${spec.minMode} or higher`);
    if (grant?.ownerId !== identity?.ownerId) issues.push('grant owner does not match host identity');
    if (grant?.epoch !== identity?.epoch) issues.push('grant epoch does not match host identity');
    if (grant?.repoId !== identity?.repoId || grant?.worktreeId !== identity?.worktreeId) issues.push('grant repository/worktree identity mismatch');
    if (grant?.revoked !== false) issues.push('grant is revoked or revocation state is unknown');
    const expiry = Date.parse(String(grant?.expiresAt));
    if (!Number.isFinite(expiry) || expiry <= this.now()) issues.push('grant is expired or has no valid expiry');
    if (!isSha256(grant?.capabilityDigest) || grant.capabilityDigest !== this.expectedCapabilitiesDigest) issues.push('grant capability digest does not match the frozen identity');
    if (!isSha256(this.contractDigest)) issues.push('contract digest is invalid');
    try { if (sha256(readFileSync(this.binaryPath)) !== this.expectedBinarySha256) issues.push('provider binary digest differs from the frozen identity'); } catch (error) { issues.push(`provider binary is unavailable: ${String((error as Error)?.message ?? error).slice(0, 160)}`); }
    return { spec, status: issues.length === 0 ? 'observed' : 'rejected_by_policy', issues };
  }

  static readonly modes = VG_FACT_MODES;

  async execute(operation: VerseGitFactOperation, identity: VerseGitFactIdentity, grant: VerseGitFactGrant, trigger: VerseGitFactTrigger, input: VerseGitFactInput = {}, signal?: AbortSignal): Promise<VerseGitFactResult> {
    const preflight = this.preflight(operation, identity, grant, trigger);
    const spec = preflight.spec; const startedAt = new Date().toISOString();
    let argv: readonly string[] = [];
    let inputIssues: string[] = [];
    try { argv = spec ? spec.argv(identity, input) : []; } catch (error) { inputIssues = [String((error as Error)?.message ?? error)]; }
    const deniedIssues = [...preflight.issues, ...inputIssues];
    if (deniedIssues.length > 0 || !spec) {
      const observation: VerseGitObservation = { schema: 'clawx.versegit.fact-observation/v1', operation, mode: grant?.mode ?? 'M0', authorizationId: grant?.authorizationId ?? null, ownerId: grant?.ownerId ?? null, epoch: grant?.epoch ?? null, binary: { role: 'provider-binary', sha256: this.expectedBinarySha256 }, argv, cwd_role: 'provider-workspace', pid: null, process_started: false, exit_code: null, signal: null, deadline_ms: this.timeoutMs, timed_out: false, cancelled: false, pid_alive_after: false, started_at: startedAt, ended_at: new Date().toISOString(), effects: NO_EFFECTS, stdout: emptySummary(), stderr: emptySummary(), host_verdict: 'unchanged' };
      this.calls.push(observation);
      return { schema: VG_FACT_SCHEMA, operation, status: preflight.status === 'not_applicable' ? 'not_applicable' : 'rejected_by_policy', reason: preflight.status === 'not_applicable' ? 'not_applicable' : 'authority_rejected', issues: deniedIssues, observation, host_verdict: 'unchanged' };
    }
    const bounded = await runBounded(this.binaryPath, argv, { cwd: this.workspacePath, timeoutMs: this.timeoutMs, maxOutputBytes: this.maxOutputBytes, signal });
    const observation: VerseGitObservation = { schema: 'clawx.versegit.fact-observation/v1', operation, mode: grant.mode, authorizationId: grant.authorizationId, ownerId: grant.ownerId, epoch: grant.epoch, binary: { role: 'provider-binary', sha256: this.expectedBinarySha256 }, argv, cwd_role: 'provider-workspace', pid: bounded.pid, process_started: true, exit_code: bounded.code, signal: bounded.signal, deadline_ms: this.timeoutMs, timed_out: bounded.timedOut, cancelled: bounded.cancelled, pid_alive_after: isAlive(bounded.pid), started_at: bounded.startedAt, ended_at: bounded.endedAt, effects: spec.effects, stdout: outputSummary(bounded.stdout, bounded.truncated), stderr: outputSummary(bounded.stderr, bounded.truncated), host_verdict: 'unchanged' };
    this.calls.push(observation);
    if (bounded.timedOut) return { schema: VG_FACT_SCHEMA, operation, status: 'degraded', reason: 'timeout', issues: ['provider fact command timed out'], observation, host_verdict: 'unchanged' };
    if (bounded.cancelled) return { schema: VG_FACT_SCHEMA, operation, status: 'degraded', reason: 'cancelled', issues: ['provider fact command was cancelled'], observation, host_verdict: 'unchanged' };
    if (bounded.code !== 0) return { schema: VG_FACT_SCHEMA, operation, status: 'degraded', reason: 'nonzero_exit', issues: [bounded.stderr.toString('utf8').slice(0, 400) || `provider fact command exited ${String(bounded.code)}`], observation, host_verdict: 'unchanged' };
    const stdoutText = bounded.stdout.toString('utf8').trim();
    if (bounded.truncated) return { schema: VG_FACT_SCHEMA, operation, status: 'partial', reason: 'output_truncated', issues: ['provider fact output exceeded the bounded capture limit'], observation, host_verdict: 'unchanged' };
    if (!stdoutText) return { schema: VG_FACT_SCHEMA, operation, status: 'unavailable', reason: 'empty_output', issues: ['provider fact command returned no output'], observation, host_verdict: 'unchanged' };
    if (spec.parse === 'text') {
      if (operation === 'version' && stdoutText !== this.expectedVersion) return { schema: VG_FACT_SCHEMA, operation, status: 'rejected_by_policy', reason: 'identity_mismatch', issues: [`provider version ${stdoutText} != ${this.expectedVersion}`], observation, host_verdict: 'unchanged' };
      return { schema: VG_FACT_SCHEMA, operation, status: 'observed', value: stdoutText, issues: [], observation, host_verdict: 'unchanged' };
    }
    let parsed: unknown;
    try { parsed = JSON.parse(stdoutText); } catch (error) { return { schema: VG_FACT_SCHEMA, operation, status: 'unavailable', reason: 'unparsable_output', issues: [String((error as Error)?.message ?? error).slice(0, 200)], observation, host_verdict: 'unchanged' }; }
    if (operation === 'capabilities') {
      const document = parsed as Record<string, unknown>; const issues: string[] = [];
      if (document.schema !== 'versegit.capabilities/v1') issues.push('capabilities schema mismatch');
      const safety = document.safety as Record<string, unknown> | undefined; const verdict = document.verdict as Record<string, unknown> | undefined;
      if (safety?.default_enable !== false) issues.push('capabilities violate default-off lock'); if (verdict?.single_green_light !== false) issues.push('capabilities violate single-green-light lock');
      if (sha256(bounded.stdout) !== this.expectedCapabilitiesDigest) issues.push('raw capabilities digest differs from host-frozen identity');
      if (issues.length > 0) return { schema: VG_FACT_SCHEMA, operation, status: 'rejected_by_policy', reason: 'schema_mismatch', issues, observation, host_verdict: 'unchanged' };
    }
    return { schema: VG_FACT_SCHEMA, operation, status: 'observed', document: parsed, issues: [], observation, host_verdict: 'unchanged' };
  }

  readVersion(identity: VerseGitFactIdentity, grant: VerseGitFactGrant, trigger: VerseGitFactTrigger, signal?: AbortSignal) { return this.execute('version', identity, grant, trigger, {}, signal); }
  readCapabilities(identity: VerseGitFactIdentity, grant: VerseGitFactGrant, trigger: VerseGitFactTrigger, signal?: AbortSignal) { return this.execute('capabilities', identity, grant, trigger, {}, signal); }
}
