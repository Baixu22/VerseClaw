/**
 * VerseGit host module adapter (MC4).
 *
 * The adapter is the only way ClawX may talk to the VerseGit sidecar. It is a pure
 * anti-corruption layer: it never imports VG internals, never shells out through a
 * string, never runs a second verifier, and never claims authority it does not own.
 * Mode promotion is explicit. The host identity gate (WP0) must have accepted the
 * frozen binary and contract before a grant is issued.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

export const VG_MODULE_REPORT_SCHEMA = 'clawx.versegit.module-report/v1';
export const VG_COMMAND_PLAN_SCHEMA = 'clawx.versegit.command-plan/v1';
export const VG_CONSUMER_CONTRACT_VERSION = 'clawx.versegit.consumer-contract/v1';
export const VG_CAPABILITIES_SCHEMA = 'versegit.capabilities/v1';
export const VG_MODES = ['M0', 'M1', 'M2', 'M3'] as const;
export const VG_TOP_LEVEL_STATUSES = [
  'not_applicable', 'unavailable', 'partial', 'observed', 'degraded', 'rejected_by_policy',
] as const;
export const VG_REASON_STATUSES = [
  'stale', 'unknown', 'unmeasured', 'recovery_required', 'lost',
  'identity_mismatch', 'invalid_candidate', 'report_incomplete',
] as const;

export type VerseGitMode = (typeof VG_MODES)[number];
export type TopLevelStatus = (typeof VG_TOP_LEVEL_STATUSES)[number];
export type ReasonStatus = (typeof VG_REASON_STATUSES)[number];

type CommandResult = {
  stdout: string;
  stderr: string;
  code: number | null;
};

export type VerseGitModuleOptions = {
  binaryPath: string;
  cwd?: string;
  contractDigest: string;
  timeoutMs?: number;
  run?: (argv: readonly string[], timeoutMs: number) => CommandResult;
};

export type VerseGitReportInput = {
  mode: VerseGitMode;
  component: string;
  trigger: { reason: string; worktreeCount?: number; activeSessionCount?: number };
  repository: Record<string, unknown>;
  coverage: Record<string, unknown>;
  result: { status: TopLevelStatus; reasons?: ReasonStatus[] };
  verification?: Record<string, unknown>;
  candidate?: Record<string, unknown> | null;
  timings?: Record<string, number>;
  digests?: Record<string, string>;
};

export type EvidenceRead<T> = {
  status: TopLevelStatus;
  reason?: string;
  value?: T;
  document?: T;
  issues: string[];
  host_verdict: 'unchanged';
};

export type AuthorityGrant = {
  mode: VerseGitMode;
  authorizationId: string | null;
  promotedFrom?: VerseGitMode;
};

export type VerseGitFailure = {
  status: TopLevelStatus;
  reason: string;
  host_verdict: 'unchanged';
};

export function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export function contractDigestOf(contract: unknown): string {
  return sha256(JSON.stringify(contract));
}

/**
 * Pure status mapping. A missing binary or a dead sidecar is a fail-open availability
 * fact: the harness verdict is never changed by it. Authority and identity problems are
 * fail-closed and must be visible as rejected_by_policy, never flattened into "clean".
 */
export function classifyFailure(input: {
  case: 'missing_binary' | 'digest_mismatch' | 'contract_mismatch' | 'schema_mismatch' | 'capabilities_mismatch'
    | 'missing_receipt' | 'partial_coverage' | 'unknown_owner' | 'unauthorized_mode' | 'timeout' | 'nonzero_exit' | 'crash';
}): VerseGitFailure {
  const status: TopLevelStatus = (() => {
    switch (input.case) {
      case 'missing_binary':
      case 'crash':
        return 'unavailable';
      case 'digest_mismatch':
      case 'contract_mismatch':
      case 'schema_mismatch':
      case 'capabilities_mismatch':
      case 'unknown_owner':
      case 'unauthorized_mode':
        return 'rejected_by_policy';
      case 'missing_receipt':
      case 'partial_coverage':
        return 'partial';
      case 'timeout':
      case 'nonzero_exit':
        return 'degraded';
    }
  })();
  return { status, reason: input.case, host_verdict: 'unchanged' };
}

export function isTopLevelStatus(value: unknown): value is TopLevelStatus {
  return typeof value === 'string' && (VG_TOP_LEVEL_STATUSES as readonly string[]).includes(value);
}

export function isReasonStatus(value: unknown): value is ReasonStatus {
  return typeof value === 'string' && (VG_REASON_STATUSES as readonly string[]).includes(value);
}

function isMode(value: unknown): value is VerseGitMode {
  return typeof value === 'string' && (VG_MODES as readonly string[]).includes(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value);
}

type ValidationReport = Record<string, unknown> & {
  schema?: unknown;
  mode?: unknown;
  result?: { status?: unknown; reasons?: unknown } | null;
  authority?: { harnessVerdict?: unknown; execution?: unknown; land?: unknown } | null;
  host_verdict?: unknown;
  contract?: { version?: unknown; digest?: unknown } | null;
  coverage?: { declared?: unknown; unobserved?: unknown } | null;
  allowed?: {
    processes_started?: unknown;
    state_read?: unknown;
    domain_state_write?: unknown;
    execution?: unknown;
    workspace_write?: unknown;
  } | null;
};

type ValidationPlan = Record<string, unknown> & {
  schema?: unknown;
  shell?: unknown;
  command?: unknown;
  forbidden?: unknown;
  commands?: unknown;
};

type ValidationCommand = {
  argv?: unknown;
  effect?: unknown;
  retry?: unknown;
  forbidden?: unknown;
};

/**
 * A reason label is never a top-level status. This is the single most important
 * honesty rule in the layer: "stale" and "unmeasured" must not read as pass or fail.
 */
export function validateModuleReport(report: unknown): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  const value = report as ValidationReport | null;
  if (!value || typeof value !== 'object') return { ok: false, issues: ['report must be an object'] };
  if (value.schema !== VG_MODULE_REPORT_SCHEMA) issues.push('report schema mismatch');
  if (!isMode(value.mode)) issues.push('report mode is not M0-M3');
  if (!isTopLevelStatus(value?.result?.status)) {
    issues.push(isReasonStatus(value?.result?.status)
      ? 'reason label used as top-level status'
      : 'report result.status is not an allowed top-level status');
  }
  if (value?.result?.reasons !== undefined && !Array.isArray(value.result.reasons)) {
    issues.push('report result.reasons must be an array');
  }
  for (const reason of Array.isArray(value?.result?.reasons) ? value.result.reasons : []) {
    if (!isReasonStatus(reason)) issues.push(`report reason ${String(reason)} is not a declared reason`);
    if (isTopLevelStatus(reason)) issues.push(`report reason ${String(reason)} collides with a top-level status`);
  }
  for (const field of ['component', 'trigger', 'repository', 'coverage'] as const) {
    if (value[field] === undefined) issues.push(`report missing ${field}`);
  }
  for (const forbidden of ['declare_intent', 'land', 'admit', 'admitted', 'harness_verdict'] as const) {
    if (value[forbidden] !== undefined) issues.push(`report must not carry authority field ${forbidden}`);
  }
  if (value.authority?.harnessVerdict !== 'host' || value.authority?.execution !== 'verseshell' || value.authority?.land !== 'host-git') {
    issues.push('report may not claim harness verdict, execution, or Git landing');
  }
  if (value.host_verdict !== 'unchanged') issues.push('report must leave the host verdict unchanged');
  if (!value.contract || value.contract.version !== VG_CONSUMER_CONTRACT_VERSION || !isSha256(value.contract.digest)) {
    issues.push('report contract binding is missing or invalid');
  }
  if (!value.coverage || typeof value.coverage !== 'object'
    || !Array.isArray(value.coverage.declared) || !Array.isArray(value.coverage.unobserved)) {
    issues.push('report coverage must declare observed and unobserved surfaces');
  }
  if (value.mode === 'M0' && value.result?.status !== 'not_applicable') {
    issues.push('M0 report status must be not_applicable');
  }
  if (isMode(value.mode)) {
    const expected = MODE_AUTHORITY[value.mode];
    if (value.allowed?.processes_started !== expected.processes
      || value.allowed?.state_read !== expected.stateRead
      || value.allowed?.domain_state_write !== expected.domainWrite
      || value.allowed?.execution !== expected.execution
      || value.allowed?.workspace_write !== false) {
      issues.push(`report allowed surface does not match ${value.mode}`);
    }
  }
  return { ok: issues.length === 0, issues };
}

/**
 * The command plan is the only way VG can ask for work: structured argv, never a shell
 * string, never `vg land` / `vg admit`, and never a retry of an effectful request whose
 * delivery is unknown.
 */
export function validateCommandPlan(plan: unknown): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  const value = plan as ValidationPlan | null;
  if (!value || typeof value !== 'object') return { ok: false, issues: ['plan must be an object'] };
  if (value.schema !== VG_COMMAND_PLAN_SCHEMA) issues.push('plan schema mismatch');
  for (const field of ['runId', 'candidateId', 'owner'] as const) if (value[field] === undefined) issues.push(`plan missing ${field}`);
  if (typeof value.shell === 'string' || value.command !== undefined) issues.push('plan must not carry a shell string');
  if (Array.isArray(value.forbidden) && value.forbidden.length > 0) issues.push('plan must not declare extra authority');
  const commands: unknown[] | null = Array.isArray(value.commands) ? value.commands as unknown[] : null;
  if (!commands) { issues.push('plan commands must be an array'); return { ok: false, issues }; }
  for (const rawCommand of commands) {
    const command = (rawCommand && typeof rawCommand === 'object' ? rawCommand : {}) as ValidationCommand;
    if (!Array.isArray(command.argv) || command.argv.length === 0
      || command.argv.some((arg: unknown) => typeof arg !== 'string')) {
      issues.push('plan command argv must be a non-empty string array');
      continue;
    }
    const head = command.argv[0] as string;
    if ((FORBIDDEN_COMMANDS as readonly string[]).includes(head)) issues.push(`plan command ${head} is forbidden`);
    const effect = typeof command.effect === 'string' ? command.effect : null;
    if (!effect || !['none', 'read', 'write', 'process', 'network', 'execute'].includes(effect)) {
      issues.push(`plan command effect ${String(command.effect)} is undeclared`);
    }
    if (command.retry === 'always' && effect !== 'none' && effect !== 'read') {
      issues.push('effectful command must never auto-replay');
    }
    if (command.forbidden !== undefined) issues.push('plan command must not declare extra authority');
  }
  return { ok: issues.length === 0, issues };
}

export function planDigestOf(plan: unknown): string {
  return sha256(JSON.stringify(plan));
}

const MODE_AUTHORITY: Record<VerseGitMode, { processes: number; stateRead: boolean; domainWrite: boolean; execution: 'none' | 'via_verseshell_only' }> = {
  M0: { processes: 0, stateRead: false, domainWrite: false, execution: 'none' },
  M1: { processes: 1, stateRead: true, domainWrite: false, execution: 'none' },
  M2: { processes: 1, stateRead: true, domainWrite: true, execution: 'none' },
  M3: { processes: 1, stateRead: true, domainWrite: true, execution: 'via_verseshell_only' },
};

// MC4 proves exactly one provider command. The remaining historical CLI names are
// deferred until WP2 verifies that each seam is actually read-only.
const READ_ONLY_COMMANDS = ['capabilities'] as const;
const DEFERRED_COMMANDS = ['doctor', 'session', 'verdict', 'conflicts', 'report'] as const;
const FORBIDDEN_COMMANDS = ['land', 'admit', 'declare_intent', 'git', 'gerrit', 'export'] as const;

function readFailure(error: unknown): Pick<EvidenceRead<never>, 'status' | 'reason' | 'issues' | 'host_verdict'> {
  const code = (error as { code?: string } | null)?.code;
  if (code === 'ENOENT') {
    return { status: 'unavailable', reason: 'missing_binary', issues: ['sidecar binary is missing'], host_verdict: 'unchanged' };
  }
  if (code === 'ETIMEDOUT') {
    return { status: 'degraded', reason: 'timeout', issues: ['sidecar command timed out'], host_verdict: 'unchanged' };
  }
  return {
    status: 'unavailable',
    reason: 'crash',
    issues: [String((error as Error | null)?.message ?? error).slice(0, 200)],
    host_verdict: 'unchanged',
  };
}

export class VerseGitModule {
  private readonly run: NonNullable<VerseGitModuleOptions['run']>;
  private attached = false;

  readonly contractDigest: string;
  readonly timeoutMs: number;

  constructor(options: VerseGitModuleOptions) {
    this.contractDigest = options.contractDigest;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.run = options.run ?? ((argv, timeout) => {
      try {
        const stdout = execFileSync(options.binaryPath, argv, {
          cwd: options.cwd,
          encoding: 'utf8',
          timeout,
          windowsHide: true,
          maxBuffer: 16 * 1024 * 1024,
        });
        return { stdout: String(stdout).trim(), stderr: '', code: 0 };
      } catch (error) {
        const failure = error as { status?: number | null; stdout?: unknown; stderr?: unknown };
        if (typeof failure.status === 'number') {
          return {
            stdout: String(failure.stdout ?? '').trim(),
            stderr: String(failure.stderr ?? '').trim(),
            code: failure.status,
          };
        }
        throw error;
      }
    });
  }

  get isAttached(): boolean {
    return this.attached;
  }

  /**
   * Attaching is the only state transition, and it requires an explicit grant for the
   * requested mode. M0 never starts a process and never claims an attachment.
   */
  attach(mode: VerseGitMode, grant: AuthorityGrant): { ok: boolean; status: TopLevelStatus; issues: string[]; host_verdict: 'unchanged' } {
    if (!isMode(mode)) {
      return { ok: false, status: 'rejected_by_policy', issues: ['unknown mode'], host_verdict: 'unchanged' };
    }
    if (mode === 'M0') {
      this.attached = false;
      return { ok: true, status: 'not_applicable', issues: [], host_verdict: 'unchanged' };
    }
    const issues: string[] = [];
    if (!isSha256(this.contractDigest)) issues.push('contract digest is not a SHA-256 value');
    if (!grant || typeof grant.authorizationId !== 'string' || grant.authorizationId.trim() === '') {
      issues.push('missing authorization for mode promotion');
    }
    if (!grant || grant.mode !== mode) issues.push('grant mode does not match the requested mode');
    if (issues.length > 0) {
      return { ok: false, status: 'rejected_by_policy', issues, host_verdict: 'unchanged' };
    }
    this.attached = true;
    return { ok: true, status: 'partial', issues: [], host_verdict: 'unchanged' };
  }

  detach(): void {
    this.attached = false;
  }

  /**
   * The version identity seam. This is the narrowest executable path and is useful for
   * proving that the adapter, not only the harness, carries the provider output.
   */
  readVersion(): EvidenceRead<string> {
    if (!this.attached) {
      return { status: 'unavailable', reason: 'not_attached', issues: ['module is not attached'], host_verdict: 'unchanged' };
    }
    let result: CommandResult;
    try {
      result = this.run(['--version'], this.timeoutMs);
    } catch (error) {
      return readFailure(error);
    }
    if (result.code !== 0) {
      return {
        status: 'degraded',
        reason: result.code === null ? 'timeout' : 'nonzero_exit',
        issues: [result.stderr.slice(0, 200)],
        host_verdict: 'unchanged',
      };
    }
    const version = result.stdout.trim();
    if (!version) {
      return { status: 'unavailable', reason: 'empty_output', issues: ['--version returned no value'], host_verdict: 'unchanged' };
    }
    return { status: 'observed', value: version, issues: [], host_verdict: 'unchanged' };
  }

  /**
   * One provider seam: the versioned capability read. The command is fixed, and any
   * contract or product-lock mismatch is rejected before its document can be consumed.
   */
  readCapabilities(expectedSchema: string = VG_CAPABILITIES_SCHEMA): EvidenceRead<Record<string, unknown>> {
    if (!this.attached) {
      return { status: 'unavailable', reason: 'not_attached', issues: ['module is not attached'], host_verdict: 'unchanged' };
    }
    let result: CommandResult;
    try {
      result = this.run(['capabilities', '--json'], this.timeoutMs);
    } catch (error) {
      return readFailure(error);
    }
    if (result.code !== 0) {
      return {
        status: 'degraded',
        reason: result.code === null ? 'timeout' : 'nonzero_exit',
        issues: [result.stderr.slice(0, 200)],
        host_verdict: 'unchanged',
      };
    }
    let document: Record<string, unknown>;
    try {
      document = JSON.parse(result.stdout) as Record<string, unknown>;
    } catch (error) {
      return {
        status: 'unavailable',
        reason: 'unparsable_output',
        issues: [String((error as Error)?.message ?? error)],
        host_verdict: 'unchanged',
      };
    }
    const issues: string[] = [];
    if (document.schema !== expectedSchema) issues.push(`capabilities schema ${String(document.schema)} != ${expectedSchema}`);
    if ((document as { safety?: { default_enable?: boolean } }).safety?.default_enable !== false) {
      issues.push('capabilities claim default-enable, which the product lock forbids');
    }
    if (issues.length > 0) {
      return { status: 'rejected_by_policy', reason: 'schema_mismatch', issues, host_verdict: 'unchanged' };
    }
    return { status: 'observed', document, issues, host_verdict: 'unchanged' };
  }

  /**
   * Emit the host-shaped report. The adapter always pins verdict/land authority back to
   * the host and always carries the contract digest and its own unobserved surface, so a
   * green VG fact can never be read as a harness pass.
   */
  buildReport(input: VerseGitReportInput): Record<string, unknown> {
    const authority = MODE_AUTHORITY[input.mode];
    const report = {
      schema: VG_MODULE_REPORT_SCHEMA,
      mode: input.mode,
      component: input.component,
      trigger: input.trigger,
      repository: input.repository,
      coverage: input.coverage,
      facts: input.mode === 'M0' ? { conflicts: [], warnings: [], unknowns: [] } : undefined,
      candidate: input.candidate ?? null,
      verification: input.verification ?? { status: 'not_run', executor: 'verseshell' },
      result: { status: input.result.status, reasons: input.result.reasons ?? [] },
      authority: { harnessVerdict: 'host', execution: 'verseshell', land: 'host-git' },
      host_verdict: 'unchanged',
      contract: { version: VG_CONSUMER_CONTRACT_VERSION, digest: this.contractDigest },
      allowed: {
        processes_started: authority.processes,
        state_read: authority.stateRead,
        domain_state_write: authority.domainWrite,
        execution: authority.execution,
        workspace_write: false,
      },
      timings: input.timings ?? {},
      digests: { contract: this.contractDigest, ...(input.digests ?? {}) },
    };
    const validation = validateModuleReport(report);
    if (!validation.ok) throw new Error(`invalid module report: ${validation.issues.join('; ')}`);
    return report;
  }

  static refusalForMode(mode: VerseGitMode, grant: AuthorityGrant): VerseGitFailure | null {
    if (!isMode(mode)) return classifyFailure({ case: 'unauthorized_mode' });
    if (mode === 'M0') return null;
    if (!grant || typeof grant.authorizationId !== 'string' || grant.authorizationId.trim() === '' || grant.mode !== mode) {
      return classifyFailure({ case: 'unauthorized_mode' });
    }
    return null;
  }

  static get forbiddenCommands(): readonly string[] {
    return FORBIDDEN_COMMANDS;
  }

  static get readOnlyCommands(): readonly string[] {
    return READ_ONLY_COMMANDS;
  }

  static get deferredCommands(): readonly string[] {
    return DEFERRED_COMMANDS;
  }
}

/**
 * A command request is refused before any process exists if it is not on the verified
 * read-only surface for the granted mode. Land/admit and the publish commands are never
 * reachable. Existing CLI names that have not passed the read-only probe stay deferred.
 */
export function authorizeCommand(mode: VerseGitMode, command: readonly string[], grant: AuthorityGrant): VerseGitFailure | null {
  const unauthorized = VerseGitModule.refusalForMode(mode, grant);
  if (unauthorized) return unauthorized;
  if (mode === 'M0') return classifyFailure({ case: 'unauthorized_mode' });
  if (!Array.isArray(command) || command.length === 0 || command.some((entry) => typeof entry !== 'string')) {
    return classifyFailure({ case: 'unauthorized_mode' });
  }
  const head = command[0];
  if ((FORBIDDEN_COMMANDS as readonly string[]).includes(head)) return classifyFailure({ case: 'unauthorized_mode' });
  if (!(READ_ONLY_COMMANDS as readonly string[]).includes(head)) return classifyFailure({ case: 'unauthorized_mode' });
  return null;
}