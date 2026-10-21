import { execFileSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import {
  VG_COMMAND_PLAN_SCHEMA,
  VerseGitModule,
  authorizeCommand,
  classifyFailure,
  contractDigestOf,
  validateCommandPlan,
  validateModuleReport,
  type VerseGitModuleOptions,
  type VerseGitReportInput,
} from '../../electron/services/versegit-module';

const digest = 'a'.repeat(64);
const grant = (mode: 'M0' | 'M1' | 'M2' | 'M3', authorizationId: string | null = 'grant') => ({ mode, authorizationId });
const identity = {
  repoId: 'repo-1', worktreeIds: ['worktree-1'], agentSessionIds: ['agent-session-1'],
  vgSessionIds: ['vg-session-1'], epoch: 1,
};
const correlation = { runId: 'run-1', requestId: 'request-1', traceId: 'trace-1', epoch: 1 };

function makeModule(run: VerseGitModuleOptions['run'] = vi.fn(() => ({ stdout: '', stderr: '', code: 0 })), overrides: Partial<VerseGitModuleOptions> = {}) {
  return new VerseGitModule({ binaryPath: 'D:/sidecar/vg.exe', contractDigest: digest, expectedCapabilitiesDigest: 'b'.repeat(64), run, ...overrides });
}

function attached(mode: 'M1' | 'M2' | 'M3' = 'M1') {
  const module = makeModule();
  expect(module.attach(mode, grant(mode)).ok).toBe(true);
  return module;
}

function reportInput(mode: 'M0' | 'M1' | 'M2' | 'M3', status: 'not_applicable' | 'partial' | 'observed', reasons: ('unknown' | 'unmeasured')[] = []): VerseGitReportInput {
  return {
    mode,
    component: 'versegit-module',
    trigger: { reason: 'mc4-test', worktreeCount: 2, activeSessionCount: 1 },
    repository: { repoId: identity.repoId, worktreeId: identity.worktreeIds[0] },
    identity,
    correlation,
    sessions: [{ agentSessionId: identity.agentSessionIds[0], vgSessionId: identity.vgSessionIds[0], worktreeId: identity.worktreeIds[0], epoch: 1 }],
    facts: { conflicts: [], warnings: [], unknowns: ['shell-file-effects'] },
    coverage: { declared: ['capabilities'], unobserved: ['bash', 'network', 'direct-fs'] },
    result: { status, reasons },
  };
}

function validReport(module: VerseGitModule) {
  return module.buildReport(reportInput('M1', 'partial', ['unknown']));
}

const validPlan = {
  schema: VG_COMMAND_PLAN_SCHEMA,
  runId: 'run-plan', candidateId: 'candidate-plan',
  owner: { agentId: 'agent-1', sessionId: 'session-1', worktreeId: 'worktree-1' },
  commands: [{ argv: ['pnpm', 'test'], effect: 'execute', retry: 'never' }],
};

const capabilities = {
  schema: 'versegit.capabilities/v1',
  safety: { default_enable: false },
  verdict: { single_green_light: false, read_surface: { observed_channels: ['read'], unobserved_channels: ['bash'] } },
};

describe('MC4 VerseGit host adapter', () => {
  it('keeps M0 inert: no run, no attachment, no workspace write, no verdict authority', () => {
    const run = vi.fn(() => ({ stdout: '{}', stderr: '', code: 0 }));
    const module = makeModule(run);
    expect(module.readVersion()).toMatchObject({ status: 'unavailable', reason: 'not_attached', host_verdict: 'unchanged' });
    expect(module.readCapabilities()).toMatchObject({ status: 'unavailable', reason: 'not_attached', host_verdict: 'unchanged' });
    expect(module.attach('M0', grant('M0', null))).toMatchObject({ ok: true, status: 'not_applicable', host_verdict: 'unchanged' });
    expect(module.isAttached).toBe(false);
    const report = module.buildReport(reportInput('M0', 'not_applicable'));
    expect(run).not.toHaveBeenCalled();
    expect(report).toMatchObject({
      mode: 'M0', host_verdict: 'unchanged',
      authority: { harnessVerdict: 'host', execution: 'verseshell', land: 'host-git' },
      allowed: { processes_started: 0, state_read: false, domain_state_write: false, execution: 'none', workspace_write: false },
      usage: { processes_started: 0, state_reads: 0 },
      identity,
      correlation,
    });
    expect(validateModuleReport(report).issues).toEqual([]);
  });

  it('requires an explicit matching grant and a valid contract digest to promote the mode', () => {
    const run = vi.fn(() => ({ stdout: '', stderr: '', code: 0 }));
    const module = makeModule(run);
    expect(module.attach('M1', grant('M1', null))).toMatchObject({ ok: false, status: 'rejected_by_policy' });
    expect(module.attach('M2', grant('M1'))).toMatchObject({ ok: false, status: 'rejected_by_policy' });
    expect(module.isAttached).toBe(false);
    const invalidDigest = new VerseGitModule({ binaryPath: 'vg.exe', contractDigest: 'not-a-digest', expectedCapabilitiesDigest: 'b'.repeat(64), run });
    expect(invalidDigest.attach('M1', grant('M1')).issues).toContain('contract digest is not a SHA-256 value');
    const missingCapabilitiesDigest = new VerseGitModule({ binaryPath: 'vg.exe', contractDigest: digest, expectedCapabilitiesDigest: '', run });
    expect(missingCapabilitiesDigest.attach('M1', grant('M1')).issues).toContain('expected capabilities digest is missing or invalid');
    expect(module.attach('M1', grant('M1'))).toMatchObject({ ok: true, status: 'partial', host_verdict: 'unchanged' });
    expect(module.effectiveMode).toBe('M1');
    module.detach();
    expect(module.isAttached).toBe(false);
    expect(module.effectiveMode).toBe('M0');
  });

  it('binds reports to the effective grant and records actual usage separately from permission', () => {
    const module = makeModule((argv) => {
      if (argv[0] === '--version') return { stdout: 'vg 0.1.0', stderr: '', code: 0 };
      return { stdout: JSON.stringify(capabilities), stderr: '', code: 0 };
    }, { expectedCapabilitiesDigest: contractDigestOf(capabilities) });
    expect(() => module.buildReport(reportInput('M1', 'partial'))).toThrow(/does not match effective mode M0/);
    expect(module.attach('M3', grant('M3', null)).ok).toBe(false);
    expect(() => module.buildReport(reportInput('M3', 'partial'))).toThrow(/does not match effective mode M0/);
    expect(module.attach('M1', grant('M1')).ok).toBe(true);
    expect(module.readVersion().status).toBe('observed');
    expect(module.readCapabilities().status).toBe('observed');
    const report = validReport(module);
    expect(report.usage).toEqual({ processes_started: 2, state_reads: 1 });
    expect((report.allowed as Record<string, unknown>).processes_started).toBe(1);
    expect((report.allowed as Record<string, unknown>).state_read).toBe(true);
  });

  it('rejects reason-as-status, authority claims, incomplete correlation and widened permissions', () => {
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
    expect(validateModuleReport({ ...report, correlation: undefined }).issues)
      .toContain('report correlation vector is missing or invalid');
    expect(validateModuleReport({ ...report, verification: { status: 'passed', executor: 'native' } }).issues)
      .toContain('report verification executor must remain verseshell');
    expect(validateModuleReport({
      ...report,
      sessions: [{ agentSessionId: 'agent-session-1', vgSessionId: 'vg-session-1', worktreeId: 'worktree-other', epoch: 1 }],
    }).issues).toContain('report session identity does not match the report identity vector');
    expect(() => module.buildReport({ ...reportInput('M1', 'partial'), verification: { executor: 'native' } }))
      .toThrow(/must be verseshell/);
    expect(() => module.buildReport({ ...reportInput('M1', 'partial'), facts: null as never }))
      .toThrow(/facts may not be null/);
    expect(validateModuleReport({ ...report, identity: { ...identity, worktreeIds: [] } }).issues)
      .toContain('report identity vector is missing or invalid');
    expect(validateModuleReport({
      ...report,
      allowed: { ...(report.allowed as Record<string, unknown>), workspace_write: true },
    }).issues).toContain('report allowed surface does not match M1');
  });

  it('does not let caller digests replace the host contract digest', () => {
    const module = attached();
    const report = module.buildReport({ ...reportInput('M1', 'partial'), digests: { contract: 'f'.repeat(64), artifact: 'b'.repeat(64) } });
    expect(report.digests).toEqual({ contract: digest, artifact: 'b'.repeat(64) });
    expect(validateModuleReport({ ...report, digests: { contract: 'f'.repeat(64) } }).issues)
      .toContain('report contract digest may not be overridden');
  });

  it('accepts structured argv and refuses shell strings, forbidden fields, interpreters and replay', () => {
    expect(validateCommandPlan(validPlan).issues).toEqual([]);
    expect(validateCommandPlan({ ...validPlan, owner: 'owner-1' }).issues).toEqual([]);
    expect(validateCommandPlan({ ...validPlan, shell: 'pnpm test' }).issues).toContain('plan must not carry shell');
    expect(validateCommandPlan({ ...validPlan, land: true }).issues).toContain('plan must not carry land');
    expect(validateCommandPlan({ ...validPlan, owner: '' }).issues).toContain('plan owner must be an opaque id or a structured owner');
    expect(validateCommandPlan({ ...validPlan, commands: [{ argv: ['land', 'candidate'], effect: 'execute', retry: 'never' }] }).issues)
      .toContain('plan command land is forbidden');
    expect(validateCommandPlan({ ...validPlan, commands: [{ argv: ['vg', '--json', 'land'], effect: 'execute', retry: 'never' }] }).issues)
      .toContain('plan command vg land is forbidden');
    expect(validateCommandPlan({ ...validPlan, commands: [{ argv: ['C:\\tools\\vg.exe', '--json', 'admit'], effect: 'execute', retry: 'never' }] }).issues)
      .toContain('plan command vg admit is forbidden');
    expect(validateCommandPlan({ ...validPlan, commands: [{ argv: ['vg', '--repo', 'repo', 'land'], effect: 'execute', retry: 'never' }] }).issues)
      .toContain('plan command vg land is forbidden');
    expect(validateCommandPlan({ ...validPlan, forbidden: 'land' }).issues)
      .toContain('plan forbidden field must be absent or an empty array');
    expect(validateCommandPlan({ ...validPlan, commands: [{ argv: ['env', 'bash', '-c', 'git push'], effect: 'execute', retry: 'never' }] }).issues)
      .toContain('plan command must not invoke shell or wrapper env');
    expect(validateCommandPlan({ ...validPlan, commands: [{ argv: ['powershell.exe ', '-Command', 'Write-Host ok'], effect: 'execute', retry: 'never' }] }).issues)
      .toContain('plan command must not invoke shell or wrapper powershell');
    expect(validateCommandPlan({ ...validPlan, commands: [{ argv: ['pnpm', 'test'], effect: 'execute', retry: ['once'] }] }).issues)
      .toContain('plan command retry once is undeclared');
    expect(validateCommandPlan({ ...validPlan, commands: [{ argv: ['pnpm', 'test'], effect: 'execute', retry: 'never', land: true }] }).issues)
      .toContain('plan command must not carry land');
    expect(validateCommandPlan({ ...validPlan, commands: [{ argv: ['C:\\Program Files\\Git\\cmd\\git.exe', 'push'], effect: 'execute', retry: 'never' }] }).issues)
      .toContain('plan command git is forbidden');
    expect(validateCommandPlan({ ...validPlan, commands: [{ argv: ['powershell.exe', '-Command', 'Write-Host ok'], effect: 'execute', retry: 'never' }] }).issues)
      .toContain('plan command must not invoke shell or wrapper powershell');
    expect(validateCommandPlan({ ...validPlan, commands: [{ argv: ['pnpm', 'test'], effect: 'execute', retry: 'sometimes' }] }).issues)
      .toContain('plan command retry sometimes is undeclared');
    expect(validateCommandPlan({ ...validPlan, commands: [{ argv: ['pnpm', 'test'], effect: 'execute', retry: 'always' }] }).issues)
      .toContain('effectful command must never auto-replay');
  });

  it('keeps only the verified capabilities seam reachable and fails every escalation open to authority', () => {
    expect(authorizeCommand('M1', ['capabilities', '--json'], grant('M1'))).toBeNull();
    for (const command of ['land', 'admit', 'declare_intent', 'git', 'gerrit', 'export']) {
      expect(authorizeCommand('M3', [command], grant('M3'))).toMatchObject({ status: 'rejected_by_policy', host_verdict: 'unchanged' });
    }
    for (const command of VerseGitModule.deferredCommands) {
      expect(authorizeCommand('M2', [command], grant('M2'))).toMatchObject({ status: 'rejected_by_policy', host_verdict: 'unchanged' });
    }
    expect(authorizeCommand('M0', ['capabilities'], grant('M0', null))).toMatchObject({ status: 'rejected_by_policy' });
    expect(authorizeCommand('M1', ['capabilities'], grant('M1', null))).toMatchObject({ status: 'rejected_by_policy' });
    expect(authorizeCommand('M1', [] as string[], grant('M1'))).toMatchObject({ status: 'rejected_by_policy' });
    expect([...VerseGitModule.readOnlyCommands]).toEqual(['capabilities']);
    expect([...VerseGitModule.deferredCommands]).toEqual(['doctor', 'session', 'verdict', 'conflicts', 'report']);
  });

  it('executes fixed identity seams and rejects null, drift and product-lock violations', () => {
    const expectedCapabilitiesDigest = contractDigestOf(capabilities);
    const run = vi.fn((argv: readonly string[]) => {
      if (argv[0] === '--version') return { stdout: 'vg 0.1.0', stderr: '', code: 0 };
      return { stdout: JSON.stringify(capabilities), stderr: '', code: 0 };
    });
    const module = makeModule(run, { expectedCapabilitiesDigest });
    expect(module.attach('M1', grant('M1')).ok).toBe(true);
    expect(module.readVersion()).toMatchObject({ status: 'observed', value: 'vg 0.1.0', host_verdict: 'unchanged' });
    expect(module.readCapabilities()).toMatchObject({ status: 'observed', document: capabilities, host_verdict: 'unchanged' });
    expect(run.mock.calls.map((call) => call[0])).toEqual([['--version'], ['capabilities', '--json']]);

    const nullDoc = makeModule(() => ({ stdout: 'null', stderr: '', code: 0 }), { expectedCapabilitiesDigest });
    nullDoc.attach('M1', grant('M1'));
    expect(nullDoc.readCapabilities()).toMatchObject({ status: 'unavailable', reason: 'invalid_document' });
    const singleGreen = makeModule(() => ({ stdout: JSON.stringify({ ...capabilities, verdict: { ...capabilities.verdict, single_green_light: true } }), stderr: '', code: 0 }), { expectedCapabilitiesDigest });
    singleGreen.attach('M1', grant('M1'));
    expect(singleGreen.readCapabilities()).toMatchObject({ status: 'rejected_by_policy', reason: 'schema_mismatch' });
    expect(singleGreen.buildReport(reportInput('M1', 'partial')).usage).toEqual({ processes_started: 1, state_reads: 1 });
    const defaultEnable = makeModule(() => ({ stdout: JSON.stringify({ ...capabilities, safety: { default_enable: true } }), stderr: '', code: 0 }), { expectedCapabilitiesDigest });
    defaultEnable.attach('M1', grant('M1'));
    expect(defaultEnable.readCapabilities()).toMatchObject({ status: 'rejected_by_policy', reason: 'schema_mismatch' });
    const schemaDrift = makeModule(() => ({ stdout: JSON.stringify({ ...capabilities, schema: 'versegit.capabilities/v999' }), stderr: '', code: 0 }), { expectedCapabilitiesDigest });
    schemaDrift.attach('M1', grant('M1'));
    expect(schemaDrift.readCapabilities()).toMatchObject({ status: 'rejected_by_policy', reason: 'schema_mismatch' });
    const digestDrift = makeModule(() => ({ stdout: JSON.stringify(capabilities), stderr: '', code: 0 }), { expectedCapabilitiesDigest: 'b'.repeat(64) });
    digestDrift.attach('M1', grant('M1'));
    expect(digestDrift.readCapabilities()).toMatchObject({ status: 'rejected_by_policy', reason: 'schema_mismatch' });
  });

  it('counts a process that starts and times out, then resets M0 after detach', () => {
    const module = new VerseGitModule({
      binaryPath: process.execPath,
      contractDigest: digest,
      expectedCapabilitiesDigest: 'b'.repeat(64),
      timeoutMs: 50,
      run: () => {
        execFileSync(process.execPath, ['-e', 'setTimeout(() => {}, 1000)'], { timeout: 1, stdio: 'ignore', windowsHide: true });
        return { stdout: '', stderr: '', code: 0 };
      },
    });
    expect(module.attach('M1', grant('M1')).ok).toBe(true);
    expect(module.readVersion()).toMatchObject({ status: 'degraded', reason: 'timeout' });
    const m1 = validReport(module);
    expect(m1.usage).toEqual({ processes_started: 1, state_reads: 0 });
    module.detach();
    expect(module.attach('M0', grant('M0', null)).ok).toBe(true);
    const m0 = module.buildReport(reportInput('M0', 'not_applicable'));
    expect(m0.usage).toEqual({ processes_started: 0, state_reads: 0 });
  });
  it('maps provider failures without fail-closing the host', () => {
    const degraded = makeModule(() => ({ stdout: '', stderr: 'boom', code: 7 }));
    degraded.attach('M1', grant('M1'));
    expect(degraded.readCapabilities()).toMatchObject({ status: 'degraded', reason: 'nonzero_exit', host_verdict: 'unchanged' });
    const malformed = makeModule(() => ({ stdout: '{', stderr: '', code: 0 }));
    malformed.attach('M1', grant('M1'));
    expect(malformed.readCapabilities()).toMatchObject({ status: 'unavailable', reason: 'unparsable_output' });
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
    expect(classifyFailure({ case: 'missing_receipt' })).toMatchObject({ status: 'partial', reason: 'unmeasured' });
    expect(classifyFailure({ case: 'partial_coverage' })).toMatchObject({ status: 'partial', reason: 'report_incomplete' });
  });
});