import { describe, expect, it, vi } from 'vitest';
import {
  VG_COMMAND_PLAN_SCHEMA,
  VG_CONSUMER_CONTRACT_VERSION,
  VG_MODULE_REPORT_SCHEMA,
  VerseGitModule,
  authorizeCommand,
  classifyFailure,
  contractDigestOf,
  validateCommandPlan,
  validateModuleReport,
  type VerseGitModuleOptions,
} from '../../electron/services/versegit-module';

const digest = 'a'.repeat(64);
const grant = (mode: 'M0' | 'M1' | 'M2' | 'M3', authorizationId: string | null = 'grant') => ({ mode, authorizationId });

function makeModule(run: VerseGitModuleOptions['run'] = vi.fn(() => ({ stdout: '', stderr: '', code: 0 }))) {
  return new VerseGitModule({ binaryPath: 'D:/sidecar/vg.exe', contractDigest: digest, run });
}

function attached(mode: 'M1' | 'M2' | 'M3' = 'M1') {
  const module = makeModule();
  expect(module.attach(mode, grant(mode)).ok).toBe(true);
  return module;
}

function validReport(module: VerseGitModule) {
  return module.buildReport({
    mode: 'M1',
    component: 'versegit-module',
    trigger: { reason: 'two-worktrees', worktreeCount: 2, activeSessionCount: 1 },
    repository: { repoId: 'repo-1', worktreeId: 'wt-1' },
    coverage: { declared: ['capabilities'], unobserved: ['bash', 'network', 'direct-fs'] },
    result: { status: 'partial', reasons: ['unknown'] },
  });
}

describe('MC4 VerseGit host adapter', () => {
  it('keeps M0 inert: no run, no attachment, no workspace write, no verdict authority', () => {
    const run = vi.fn(() => ({ stdout: '{}', stderr: '', code: 0 }));
    const module = makeModule(run);
    expect(module.readVersion()).toMatchObject({ status: 'unavailable', reason: 'not_attached', host_verdict: 'unchanged' });
    expect(module.readCapabilities()).toMatchObject({ status: 'unavailable', reason: 'not_attached', host_verdict: 'unchanged' });
    expect(module.attach('M0', grant('M0', null))).toMatchObject({ ok: true, status: 'not_applicable', host_verdict: 'unchanged' });
    expect(module.isAttached).toBe(false);
    const report = module.buildReport({
      mode: 'M0', component: 'versegit-module', trigger: { reason: 'single-worktree-single-session' },
      repository: { repoId: 'repo' }, coverage: { declared: [], unobserved: ['all'] },
      result: { status: 'not_applicable', reasons: [] },
    });
    expect(run).not.toHaveBeenCalled();
    expect(report).toMatchObject({
      mode: 'M0', host_verdict: 'unchanged',
      authority: { harnessVerdict: 'host', execution: 'verseshell', land: 'host-git' },
      allowed: { processes_started: 0, state_read: false, domain_state_write: false, execution: 'none', workspace_write: false },
    });
    expect(validateModuleReport(report).issues).toEqual([]);
  });

  it('requires an explicit matching grant and a valid contract digest to promote the mode', () => {
    const run = vi.fn(() => ({ stdout: '', stderr: '', code: 0 }));
    const module = makeModule(run);
    expect(module.attach('M1', grant('M1', null))).toMatchObject({ ok: false, status: 'rejected_by_policy' });
    expect(module.attach('M2', grant('M1'))).toMatchObject({ ok: false, status: 'rejected_by_policy' });
    expect(module.isAttached).toBe(false);
    const invalidDigest = new VerseGitModule({ binaryPath: 'vg.exe', contractDigest: 'not-a-digest', run });
    expect(invalidDigest.attach('M1', grant('M1')).issues).toContain('contract digest is not a SHA-256 value');
    expect(module.attach('M1', grant('M1'))).toMatchObject({ ok: true, status: 'partial', host_verdict: 'unchanged' });
    expect(module.isAttached).toBe(true);
    module.detach();
    expect(module.isAttached).toBe(false);
  });

  it('rejects reason-as-status, authority claims, incomplete coverage and widened permissions', () => {
    const module = attached();
    const report = validReport(module);
    expect(validateModuleReport(report).issues).toEqual([]);
    expect(validateModuleReport({ ...report, result: { status: 'stale', reasons: [] } }).issues)
      .toContain('reason label used as top-level status');
    expect(validateModuleReport({ ...report, admitted: true }).issues)
      .toContain('report must not carry authority field admitted');
    expect(validateModuleReport({ ...report, host_verdict: 'passed' }).issues)
      .toContain('report must leave the host verdict unchanged');
    expect(validateModuleReport({ ...report, coverage: { declared: [] } }).issues)
      .toContain('report coverage must declare observed and unobserved surfaces');
    expect(validateModuleReport({
      ...report,
      allowed: { ...(report.allowed as Record<string, unknown>), workspace_write: true },
    }).issues).toContain('report allowed surface does not match M1');
  });

  it('accepts structured argv but refuses shell strings, forbidden heads and effectful replay', () => {
    const valid = {
      schema: VG_COMMAND_PLAN_SCHEMA,
      runId: 'run-1', candidateId: 'candidate-1', owner: 'owner-1',
      commands: [{ argv: ['pnpm', 'test'], effect: 'execute', retry: 'never' }],
    };
    expect(validateCommandPlan(valid).issues).toEqual([]);
    expect(validateCommandPlan({ ...valid, shell: 'pnpm test' }).issues).toContain('plan must not carry a shell string');
    expect(validateCommandPlan({ ...valid, commands: [{ argv: ['land', 'candidate'], effect: 'execute' }] }).issues)
      .toContain('plan command land is forbidden');
    expect(validateCommandPlan({ ...valid, commands: [{ argv: ['pnpm', 'test'], effect: 'execute', retry: 'always' }] }).issues)
      .toContain('effectful command must never auto-replay');
    expect(validateCommandPlan({ ...valid, commands: [{ argv: ['pnpm', 'test'] }] }).issues)
      .toContain('plan command effect undefined is undeclared');
  });

  it('keeps only the verified capabilities seam reachable and fails every escalation open to authority', () => {
    expect(authorizeCommand('M1', ['capabilities', '--json'], grant('M1'))).toBeNull();
    for (const command of ['land', 'admit', 'declare_intent', 'git', 'gerrit', 'export']) {
      expect(authorizeCommand('M3', [command], grant('M3'))).toMatchObject({
        status: 'rejected_by_policy', host_verdict: 'unchanged',
      });
    }
    for (const command of VerseGitModule.deferredCommands) {
      expect(authorizeCommand('M2', [command], grant('M2'))).toMatchObject({
        status: 'rejected_by_policy', host_verdict: 'unchanged',
      });
    }
    expect(authorizeCommand('M0', ['capabilities'], grant('M0', null))).toMatchObject({ status: 'rejected_by_policy' });
    expect(authorizeCommand('M1', ['capabilities'], grant('M1', null))).toMatchObject({ status: 'rejected_by_policy' });
    expect(authorizeCommand('M1', [] as string[], grant('M1'))).toMatchObject({ status: 'rejected_by_policy' });
    expect([...VerseGitModule.readOnlyCommands]).toEqual(['capabilities']);
    expect([...VerseGitModule.deferredCommands]).toEqual(['doctor', 'session', 'verdict', 'conflicts', 'report']);
  });

  it('executes only fixed identity seams and maps provider failures without fail-closing the host', () => {
    const capabilities = {
      schema: 'versegit.capabilities/v1', safety: { default_enable: false },
      verdict: { single_green_light: false, read_surface: { observed_channels: ['status'], unobserved_channels: ['bash'] } },
    };
    const run = vi.fn((argv: readonly string[]) => {
      if (argv[0] === '--version') return { stdout: 'vg 0.1.0', stderr: '', code: 0 };
      return { stdout: JSON.stringify(capabilities), stderr: '', code: 0 };
    });
    const module = makeModule(run);
    expect(module.attach('M1', grant('M1')).ok).toBe(true);
    expect(module.readVersion()).toMatchObject({ status: 'observed', value: 'vg 0.1.0', host_verdict: 'unchanged' });
    expect(module.readCapabilities()).toMatchObject({ status: 'observed', document: capabilities, host_verdict: 'unchanged' });
    expect(run.mock.calls.map((call) => call[0])).toEqual([['--version'], ['capabilities', '--json']]);

    const degraded = makeModule(() => ({ stdout: '', stderr: 'boom', code: 7 }));
    degraded.attach('M1', grant('M1'));
    expect(degraded.readCapabilities()).toMatchObject({ status: 'degraded', reason: 'nonzero_exit', host_verdict: 'unchanged' });
    const malformed = makeModule(() => ({ stdout: '{', stderr: '', code: 0 }));
    malformed.attach('M1', grant('M1'));
    expect(malformed.readCapabilities()).toMatchObject({ status: 'unavailable', reason: 'unparsable_output' });
    const widened = makeModule(() => ({ stdout: JSON.stringify({ ...capabilities, safety: { default_enable: true } }), stderr: '', code: 0 }));
    widened.attach('M1', grant('M1'));
    expect(widened.readCapabilities()).toMatchObject({ status: 'rejected_by_policy', reason: 'schema_mismatch' });
  });

  it('turns spawn exceptions into availability outcomes and always leaves host verdict unchanged', () => {
    const missing = makeModule(() => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); });
    missing.attach('M1', grant('M1'));
    expect(missing.readVersion()).toMatchObject({ status: 'unavailable', reason: 'missing_binary', host_verdict: 'unchanged' });
    const timeout = makeModule(() => { throw Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }); });
    timeout.attach('M1', grant('M1'));
    expect(timeout.readCapabilities()).toMatchObject({ status: 'degraded', reason: 'timeout', host_verdict: 'unchanged' });
    for (const failureCase of [
      'missing_binary', 'digest_mismatch', 'contract_mismatch', 'schema_mismatch', 'capabilities_mismatch',
      'missing_receipt', 'partial_coverage', 'unknown_owner', 'unauthorized_mode', 'timeout', 'nonzero_exit', 'crash',
    ] as const) {
      expect(classifyFailure({ case: failureCase })).toMatchObject({ host_verdict: 'unchanged' });
    }
  });

  it('computes deterministic contract and report digests', () => {
    const contract = { schema: VG_CONSUMER_CONTRACT_VERSION, modes: ['M0', 'M1', 'M2', 'M3'] };
    expect(contractDigestOf(contract)).toBe(contractDigestOf({ ...contract }));
    const module = attached();
    const report = validReport(module);
    expect(report.schema).toBe(VG_MODULE_REPORT_SCHEMA);
    expect(report.contract).toEqual({ version: VG_CONSUMER_CONTRACT_VERSION, digest });
    expect(report.digests).toEqual({ contract: digest });
  });
});