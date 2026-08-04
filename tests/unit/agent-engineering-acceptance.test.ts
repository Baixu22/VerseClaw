import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ACCEPTANCE_SCHEMA,
  TF0009_ADAPTER_ID,
  createAcceptancePlan,
  digestManifest,
  digestPlan,
  digestReport,
  inferCoverage,
  redactText,
  readAcceptanceStatus,
  repositoryIdentity,
  resolveChangedPaths,
  runAcceptance,
  sha256File,
  validateAcceptanceEnvironment,
  validateAcceptanceManifest,
  validateExecutorEvidence,
  validateReportEvidence,
  verifyAcceptance,
} from '../../scripts/lib/agent-engineering-acceptance.mjs';
import { main as acceptanceCliMain } from '../../scripts/agent-engineering-acceptance.mjs';
import { validateRuntimeAuthorityConvergence } from '../../scripts/validate-runtime-authority-convergence.mjs';

const temporaryPaths: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  for (const path of temporaryPaths.splice(0)) rmSync(path, { recursive: true, force: true });
});

function git(root: string, args: string[]) {
  execFileSync('git', args, { cwd: root, stdio: 'pipe' });
}

function gitText(root: string, args: string[]) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function createFixtureRepository() {
  const root = mkdtempSync(join(tmpdir(), 'agent-acceptance-fixture-'));
  temporaryPaths.push(root);
  mkdirSync(join(root, 'harness', 'specs', 'tasks'), { recursive: true });
  writeFileSync(join(root, 'package.json'), '{"name":"fixture","version":"1.0.0"}\n', 'utf8');
  writeFileSync(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n', 'utf8');
  writeFileSync(join(root, '.npmrc'), 'strict-peer-dependencies=false\n', 'utf8');
  writeFileSync(join(root, '.gitignore'), 'artifacts/\n', 'utf8');
  writeFileSync(join(root, '.gitattributes'), '*.md text\n', 'utf8');
  writeFileSync(join(root, 'harness', 'specs', 'tasks', 'fixture.md'), '# fixture\n', 'utf8');
  git(root, ['init', '--quiet']);
  git(root, ['config', 'user.email', 'fixture@example.invalid']);
  git(root, ['config', 'user.name', 'Acceptance Fixture']);
  git(root, ['add', '.']);
  git(root, ['commit', '--quiet', '-m', 'fixture']);
  return root;
}

function createManifest(root: string, options: { gate?: Record<string, unknown>; humanEvidence?: 'required' | 'not-required' } = {}) {
  const identity = repositoryIdentity(root);
  const sourceFiles = ['package.json', 'pnpm-lock.yaml', '.npmrc', 'harness/specs/tasks/fixture.md'].map((path) => ({
    path,
    exists: true,
    sha256: sha256File(join(root, path)),
    gitBlob: gitText(root, ['rev-parse', '--verify', `HEAD:${path}`]),
  }));
  const manifest: { [key: string]: unknown; gates: Array<Record<string, unknown>> } = {
    schema: ACCEPTANCE_SCHEMA,
    manifestVersion: 1,
    runId: 'fixture-run',
    createdAt: '2026-07-31T00:00:00.000Z',
    task: {
      id: 'fixture-task',
      title: 'Fixture task',
      specPath: 'harness/specs/tasks/fixture.md',
      humanEvidence: options.humanEvidence ?? 'not-required',
      requiredRules: [],
    },
    executionMode: 'full',
    candidate: { commit: identity.commit, tree: identity.tree, ref: identity.ref, cleanAtPlan: true },
    baseRef: 'HEAD^',
    changedPaths: ['src/example.ts'],
    coverage: { runtime: false, ui: true, comms: false, release: false },
    requiredProfiles: ['fast'],
    source: {
      files: sourceFiles,
      missing: [],
      lockFiles: sourceFiles.slice(0, 3),
      identityPolicy: 'git-blob-v1',
      eolPolicy: 'git-blob',
    },
    gates: [options.gate ?? {
      id: 'fixture-gate',
      name: 'Fixture gate',
      profile: 'fast',
      command: 'node',
      args: ['-e', 'process.exit(0)'],
      required: true,
      allowSkip: false,
      timeoutMs: 1_000,
      safety: { network: 'none', productionEffects: false, humanEvidence: false },
    }],
    safety: {
      scope: 'engineering-only',
      networkPolicy: 'none-or-isolated',
      productionEffects: false,
      realProvider: false,
      humanEvidence: options.humanEvidence ?? 'not-required',
      productLocksMutable: false,
      allowedPromotion: false,
      prohibitedClaims: ['liveReady', 'productApproved', 'defaultOn'],
    },
    eligibility: { cleanWorktreeRequired: true, fullModeRequired: true, sourceComplete: true, cleanAtPlan: true },
    residuals: [],
  };
  manifest.planDigest = digestPlan(manifest);
  manifest.manifestDigest = digestManifest(manifest);
  return manifest;
}

function resealManifest(manifest: Record<string, unknown>) {
  manifest.planDigest = digestPlan(manifest);
  manifest.manifestDigest = digestManifest(manifest);
  return manifest;
}

function createConvergenceFixture() {
  const root = createFixtureRepository();
  const base = repositoryIdentity(root).commit;
  const baselineRelative = 'artifacts/runtime-authority-convergence/rc-01/baseline.json';
  const baselinePath = join(root, ...baselineRelative.split('/'));
  mkdirSync(join(root, 'artifacts', 'runtime-authority-convergence', 'rc-01'), { recursive: true });
  writeFileSync(baselinePath, `${JSON.stringify({
    schema: 'runtime-authority-convergence-baseline/v1',
    acceptedBaseSha: base,
    productLocks: { liveReady: false, productApproved: false, defaultOn: false },
  }, null, 2)}\n`, 'utf8');
  git(root, ['add', '--force', baselineRelative]);
  git(root, ['commit', '--quiet', '-m', 'add convergence baseline']);
  return { root, base, baselineRelative };
}

function passingSpawn(_command: string, _args: string[], options: { cwd?: string } = {}) {
  return {
    status: 0,
    signal: null,
    stdout: `Tests 1 passed (1)\nfixture ran in ${options.cwd}\n`,
    stderr: '',
  };
}

function tf0009Report() {
  const profiles = ['dcs-coding', 'sekb-assisted', 'browser-supervised'];
  const runs = profiles.flatMap((profile) => Array.from({ length: 10 }, (_, index) => ({
    profile,
    actor: { kind: 'agent', id: 'fixture-agent' },
    humanEquivalent: false,
    liveEvidence: false,
    result: 'pass',
    lineage: { componentEntrypoint: `${profile}.${index + 1}` },
  })));
  return {
    schema: 'tf0009-agent-surrogate-report/v1',
    authority: 'engineering-agent-surrogate-only',
    result: 'degraded-engineering-complete',
    humanEquivalent: false,
    liveEvidence: false,
    taskForest: { recommendedStatus: 'review_needed', canMarkDone: false, canReleaseTF0011: false },
    humanQualifyingRuns: { 'dcs-coding': 0, 'sekb-assisted': 0, 'browser-supervised': 0 },
    agentSurrogateRuns: { 'dcs-coding': 10, 'sekb-assisted': 10, 'browser-supervised': 10 },
    runs,
    killRollbackDrill: { actor: { kind: 'agent' }, humanEquivalent: false, result: 'pass' },
    decision: { value: 'deferred-human-validation', productApproval: false },
    frozenBoundaries: {
      liveReady: false,
      productApproved: false,
      defaultOn: false,
      c1ReductionFactor: 4.5,
      c1MeetsGate: false,
      c1Recommendation: 'keep-off',
      tf0006: 'blocked',
    },
  };
}

describe('Agent Engineering Acceptance', () => {
  it('derives full runtime, UI, comms, maturity, and release coverage from changed paths', () => {
    const manifest = createAcceptancePlan({
      specPath: 'harness/specs/tasks/agent-engineering-acceptance-orchestrator.md',
      changedPaths: [
        'openclaw_runtime/src/agents/tool.ts',
        'src/components/Settings.tsx',
        'scripts/release-baseline-manifest.mjs',
      ],
      runId: 'coverage-test',
      createdAt: '2026-07-31T00:00:00.000Z',
    });

    expect(manifest.coverage).toMatchObject({ runtime: true, ui: true, comms: true, maturity: true, release: true });
    expect(manifest.requiredProfiles).toEqual(expect.arrayContaining(['fast', 'runtime', 'e2e', 'comms', 'maturity', 'release', 'full']));
    expect(manifest.gates.map((gate) => gate.id)).toEqual(expect.arrayContaining([
      'runtime-unit',
      'runtime-static-check',
      'electron-e2e',
      'comms-replay',
      'maturity-validate',
      'release-baseline-validate',
    ]));
    const commands = manifest.gates.map((gate) => gate.args.join(' '));
    expect(commands).toEqual(expect.arrayContaining([
      expect.stringContaining('lint:check'),
      expect.stringContaining('typecheck'),
      expect.stringContaining(' test'),
    ]));
    expect(validateAcceptanceManifest(manifest)).toEqual({ ok: true, errors: [] });
  });

  it('has no blind coverage gap for runtime changes', () => {
    expect(inferCoverage(['openclaw_runtime/src/agents/tool.ts'])).toMatchObject({ runtime: true, comms: true });
  });

  it('rejects TLS and real-provider credentials and redacts sensitive local values', () => {
    expect(validateAcceptanceEnvironment({ NODE_TLS_REJECT_UNAUTHORIZED: '0' }).errors).toContain(
      'NODE_TLS_REJECT_UNAUTHORIZED must be unset for formal acceptance',
    );
    expect(validateAcceptanceEnvironment({ OPENAI_API_KEY: 'secret-value' }).errors.join('\n')).toContain('OPENAI_API_KEY');
    expect(redactText('C:\\work token=secret-value', {
      sourceRoot: 'C:\\work',
      secrets: ['secret-value'],
    })).toBe('<repo> token=<secret>');
  });

  it('fails closed for skipped gates, forbidden mutation arguments, and source drift', () => {
    const root = createFixtureRepository();
    const manifest = createManifest(root);
    const unsafe = structuredClone(manifest);
    unsafe.gates[0].allowSkip = true;
    unsafe.gates[0].args = ['--fix'];
    unsafe.planDigest = digestPlan(unsafe);
    unsafe.manifestDigest = digestManifest(unsafe);
    expect(validateAcceptanceManifest(unsafe).errors).toEqual(expect.arrayContaining([
      'fixture-gate: allowSkip must be false',
      'fixture-gate: forbidden argument --fix',
    ]));

    writeFileSync(join(root, 'package.json'), '{"name":"changed"}\n', 'utf8');
    expect(validateAcceptanceManifest(manifest, { root, requireClean: false }).errors).toContain(
      'source input differs from candidate Git blob: package.json',
    );
  });

  it('uses Git blob source identity across LF and CRLF clean checkouts', () => {
    const root = createFixtureRepository();
    const manifest = createManifest(root);
    const lfCheckout = mkdtempSync(join(tmpdir(), 'agent-acceptance-lf-'));
    const crlfCheckout = mkdtempSync(join(tmpdir(), 'agent-acceptance-crlf-'));
    temporaryPaths.push(lfCheckout, crlfCheckout);
    git(root, ['clone', '--quiet', root, lfCheckout]);
    git(root, ['clone', '--quiet', root, crlfCheckout]);
    git(lfCheckout, ['config', 'core.autocrlf', 'false']);
    git(lfCheckout, ['config', 'core.eol', 'lf']);
    git(lfCheckout, ['reset', '--hard', '--quiet']);
    git(crlfCheckout, ['config', 'core.autocrlf', 'false']);
    git(crlfCheckout, ['config', 'core.eol', 'crlf']);
    git(crlfCheckout, ['reset', '--hard', '--quiet']);

    expect(gitText(lfCheckout, ['config', '--get', 'core.eol'])).toBe('lf');
    expect(gitText(crlfCheckout, ['config', '--get', 'core.eol'])).toBe('crlf');
    expect(validateAcceptanceManifest(manifest, { root: lfCheckout, requireClean: true })).toEqual({ ok: true, errors: [] });
    expect(validateAcceptanceManifest(manifest, { root: crlfCheckout, requireClean: true })).toEqual({ ok: true, errors: [] });
    expect(manifest.source.files.find((entry) => entry.path.endsWith('fixture.md'))?.gitBlob).toBe(
      gitText(crlfCheckout, ['rev-parse', '--verify', 'HEAD:harness/specs/tasks/fixture.md']),
    );
  });

  it('requires a separate verifier before engineering acceptance and retains human residuals', () => {
    const root = createFixtureRepository();
    const outputDir = mkdtempSync(join(tmpdir(), 'agent-acceptance-output-'));
    temporaryPaths.push(outputDir);
    const manifest = createManifest(root, { humanEvidence: 'required' });
    const env = { PATH: process.env.PATH ?? '' };

    const executor = runAcceptance(manifest, {
      sourceRoot: root,
      outputDir,
      actor: 'executor-agent-a',
      env,
      spawn: passingSpawn,
    });
    expect(executor).toMatchObject({ result: 'pass', engineeringAcceptedByAgent: false });
    expect(executor.controlledArtifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'manifest-snapshot', path: 'manifest.snapshot.json', sha256: expect.any(String) }),
    ]));
    expect(readFileSync(join(outputDir, 'logs', 'fixture-gate.stdout.log'), 'utf8')).toContain('<worktree>');

    const sameActor = verifyAcceptance(manifest, {
      sourceRoot: root,
      outputDir,
      actor: 'executor-agent-a',
      env,
      executorReport: executor,
      spawn: passingSpawn,
    });
    expect(sameActor).toMatchObject({ result: 'NO-GO', engineeringAcceptedByAgent: false });

    const verifier = verifyAcceptance(manifest, {
      sourceRoot: root,
      outputDir,
      actor: 'verifier-agent-b',
      env,
      executorReport: executor,
      spawn: passingSpawn,
    });
    expect(verifier).toMatchObject({
      schema: ACCEPTANCE_SCHEMA,
      result: 'pass',
      engineeringAcceptedByAgent: true,
      taskStatusRecommendation: 'review_needed',
      humanEvidenceRequired: true,
    });
    expect(existsSync(join(outputDir, 'final-report.json'))).toBe(true);
  });

  it('rejects tampered executor logs before rerunning a verifier gate', () => {
    const root = createFixtureRepository();
    const outputDir = mkdtempSync(join(tmpdir(), 'agent-acceptance-output-'));
    temporaryPaths.push(outputDir);
    const manifest = createManifest(root);
    const env = { PATH: process.env.PATH ?? '' };
    const executor = runAcceptance(manifest, { sourceRoot: root, outputDir, actor: 'executor', env, spawn: passingSpawn });
    writeFileSync(join(outputDir, 'logs', 'fixture-gate.stdout.log'), 'tampered\n', 'utf8');

    const verifier = verifyAcceptance(manifest, {
      sourceRoot: root,
      outputDir,
      actor: 'verifier',
      env,
      executorReport: executor,
      spawn: passingSpawn,
    });
    expect(verifier).toMatchObject({ result: 'NO-GO', engineeringAcceptedByAgent: false });
    expect(verifier.failures.join('\n')).toContain('stdout log digest mismatch');
  });

  it('replays historical non-zero and timeout evidence as NO-GO', () => {
    const root = createFixtureRepository();
    const outputDir = mkdtempSync(join(tmpdir(), 'agent-acceptance-output-'));
    temporaryPaths.push(outputDir);
    const manifest = createManifest(root);
    const env = { PATH: process.env.PATH ?? '' };
    const nonZero = runAcceptance(manifest, {
      sourceRoot: root,
      outputDir,
      actor: 'executor',
      env,
      spawn: () => ({ status: 1, signal: null, stdout: '', stderr: 'historical gate failure' }),
    });
    expect(nonZero).toMatchObject({ result: 'NO-GO', engineeringAcceptedByAgent: false });
    expect(nonZero.failures).toContain('fixture-gate: fail');

    const timeoutManifest = structuredClone(manifest);
    timeoutManifest.runId = 'fixture-timeout';
    timeoutManifest.planDigest = digestPlan(timeoutManifest);
    timeoutManifest.manifestDigest = digestManifest(timeoutManifest);
    const timeout = runAcceptance(timeoutManifest, {
      sourceRoot: root,
      outputDir: join(outputDir, 'timeout'),
      actor: 'executor',
      env,
      spawn: () => ({
        status: null,
        signal: 'SIGTERM',
        error: Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }),
        stdout: '',
        stderr: '',
      }),
    });
    expect(timeout).toMatchObject({ result: 'NO-GO', engineeringAcceptedByAgent: false });
    expect(timeout.failures).toContain('fixture-gate: timeout');
  });

  it('fails closed when a test gate exceeds its fixed skip budget or hides test counts', () => {
    const root = createFixtureRepository();
    const outputDir = mkdtempSync(join(tmpdir(), 'agent-acceptance-output-'));
    temporaryPaths.push(outputDir);
    const gate = {
      id: 'fixture-test-gate',
      name: 'Fixture test gate',
      profile: 'fast',
      command: 'node',
      args: ['-e', 'process.exit(0)'],
      required: true,
      allowSkip: false,
      timeoutMs: 1_000,
      safety: { network: 'none', productionEffects: false, humanEvidence: false },
      testExpectation: { requireCounts: true, expectedSkips: 0 },
    };
    const manifest = createManifest(root, { gate });
    const env = { PATH: process.env.PATH ?? '' };
    const skipped = runAcceptance(manifest, {
      sourceRoot: root,
      outputDir,
      actor: 'executor',
      env,
      spawn: () => ({ status: 0, signal: null, stdout: 'Tests 1 passed | 1 skipped (2)\n', stderr: '' }),
    });
    expect(skipped).toMatchObject({ result: 'NO-GO', engineeringAcceptedByAgent: false });
    expect(skipped.testCounts).toMatchObject({ passed: 1, skipped: 1, total: 2 });
    expect(skipped.failures).toContain('fixture-test-gate: skip budget mismatch expected=0 actual=1');

    const hiddenManifest = structuredClone(manifest);
    hiddenManifest.runId = 'fixture-hidden-test-counts';
    hiddenManifest.planDigest = digestPlan(hiddenManifest);
    hiddenManifest.manifestDigest = digestManifest(hiddenManifest);
    const hidden = runAcceptance(hiddenManifest, {
      sourceRoot: root,
      outputDir: join(outputDir, 'hidden'),
      actor: 'executor',
      env,
      spawn: () => ({ status: 0, signal: null, stdout: 'completed without a test summary\n', stderr: '' }),
    });
    expect(hidden).toMatchObject({ result: 'NO-GO', engineeringAcceptedByAgent: false });
    expect(hidden.failures).toContain('fixture-test-gate: test counts were not parsed');

    const noOpManifest = structuredClone(manifest);
    noOpManifest.runId = 'fixture-no-op-test-counts';
    resealManifest(noOpManifest);
    const noOp = runAcceptance(noOpManifest, {
      sourceRoot: root,
      outputDir: join(outputDir, 'no-op'),
      actor: 'executor',
      env,
      spawn: () => ({ status: 0, signal: null, stdout: 'Tests 0 passed (0)\n', stderr: '' }),
    });
    expect(noOp).toMatchObject({ result: 'NO-GO', engineeringAcceptedByAgent: false });
    expect(noOp.failures).toContain('fixture-test-gate: parsed test counts are inconsistent or empty');
  });

  it('fails closed when a gate mutates its detached source worktree', () => {
    const root = createFixtureRepository();
    const outputDir = mkdtempSync(join(tmpdir(), 'agent-acceptance-output-'));
    temporaryPaths.push(outputDir);
    const manifest = createManifest(root);
    const result = runAcceptance(manifest, {
      sourceRoot: root,
      outputDir,
      actor: 'executor',
      env: { PATH: process.env.PATH ?? '' },
      spawn: (_command: string, _args: string[], options: { cwd?: string } = {}) => {
        writeFileSync(join(options.cwd!, 'unexpected-source-mutation.txt'), 'mutation\n', 'utf8');
        return { status: 0, signal: null, stdout: 'Tests 1 passed (1)\n', stderr: '' };
      },
    });
    expect(result).toMatchObject({ result: 'NO-GO', engineeringAcceptedByAgent: false });
    expect(result.mutationCheck).toMatchObject({ detachedWorktreeCleanAfter: false, sourceCleanAfter: true });
    expect(result.failures).toContain('detached worktree changed tracked or unexpected source files during acceptance');
  });

  it('exports TF-0009 evidence from the disposable worktree into the run directory', () => {
    const root = createFixtureRepository();
    const outputDir = mkdtempSync(join(tmpdir(), 'agent-acceptance-output-'));
    temporaryPaths.push(outputDir);
    const manifest = createManifest(root, {
      gate: {
        id: 'tf0009-agent-surrogate',
        name: 'TF-0009 isolated adapter',
        profile: 'tf0009',
        command: 'pnpm',
        args: ['--dir', 'openclaw_runtime', 'exec', 'node', '--import', 'tsx', 'scripts/tf0009-agent-surrogate.mts'],
        required: true,
        allowSkip: false,
        timeoutMs: 1_000,
        kind: 'adapter',
        adapter: TF0009_ADAPTER_ID,
        safety: { network: 'isolated', productionEffects: false, humanEvidence: false },
      },
    });
    const adapterSpawn = (_command: string, _args: string[], options: { cwd?: string } = {}) => {
      const reportPath = join(options.cwd!, 'artifacts', 'first-product-preview', 'TF-0009', 'agent-surrogate-report.json');
      mkdirSync(join(options.cwd!, 'artifacts', 'first-product-preview', 'TF-0009'), { recursive: true });
      writeFileSync(reportPath, `${JSON.stringify(tf0009Report(), null, 2)}\n`, 'utf8');
      return { status: 0, signal: null, stdout: `adapter in ${options.cwd}`, stderr: '' };
    };

    const result = runAcceptance(manifest, {
      sourceRoot: root,
      outputDir,
      actor: 'executor',
      env: { PATH: process.env.PATH ?? '' },
      spawn: adapterSpawn,
    });
    expect(result).toMatchObject({ result: 'pass', engineeringAcceptedByAgent: false });
    expect(existsSync(join(outputDir, 'adapters', 'tf0009', 'agent-surrogate-report.json'))).toBe(true);
    expect(existsSync(join(root, 'artifacts', 'first-product-preview', 'TF-0009', 'agent-surrogate-report.json'))).toBe(false);
  });

  it('requires non-empty candidate-bound comms artifacts in acceptance evidence', () => {
    const root = createFixtureRepository();
    const outputDir = mkdtempSync(join(tmpdir(), 'agent-acceptance-comms-'));
    temporaryPaths.push(outputDir);
    const gate = {
      id: 'comms-replay',
      name: 'Communication replay',
      profile: 'comms',
      command: 'node',
      args: ['scripts/comms/replay.mjs'],
      required: true,
      allowSkip: false,
      timeoutMs: 1_000,
      safety: { network: 'none', productionEffects: false, humanEvidence: false },
    };
    const manifest = createManifest(root, { gate });
    const empty = runAcceptance(manifest, {
      sourceRoot: root,
      outputDir: join(outputDir, 'empty'),
      actor: 'executor',
      env: { PATH: process.env.PATH ?? '' },
      spawn: (_command: string, _args: string[], options: { cwd?: string } = {}) => {
        const artifact = join(options.cwd!, 'artifacts', 'comms', 'current-metrics.json');
        mkdirSync(join(options.cwd!, 'artifacts', 'comms'), { recursive: true });
        writeFileSync(artifact, '', 'utf8');
        return { status: 0, signal: null, stdout: 'replay command executed\n', stderr: '' };
      },
    });
    expect(empty).toMatchObject({ result: 'NO-GO', engineeringAcceptedByAgent: false });
    expect(empty.failures.join('\n')).toContain('required candidate-bound artifact is empty');

    const passing = runAcceptance(manifest, {
      sourceRoot: root,
      outputDir,
      actor: 'executor',
      env: { PATH: process.env.PATH ?? '' },
      spawn: (_command: string, _args: string[], options: { cwd?: string } = {}) => {
        const artifact = join(options.cwd!, 'artifacts', 'comms', 'current-metrics.json');
        mkdirSync(join(options.cwd!, 'artifacts', 'comms'), { recursive: true });
        writeFileSync(artifact, `${JSON.stringify({
          schema: 'comms-replay-metrics/v1',
          candidate: { commit: manifest.candidate.commit, tree: manifest.candidate.tree },
          scenario: 'fixture',
          scenarios: { fixture: {} },
          aggregate: {},
        })}\n`, 'utf8');
        return { status: 0, signal: null, stdout: 'replay command executed\n', stderr: '' };
      },
    });
    expect(passing).toMatchObject({ result: 'pass', engineeringAcceptedByAgent: false });
    expect(passing.controlledArtifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'comms-replay-metrics', path: 'evidence/comms-replay/current-metrics.json' }),
    ]));
    const missingArtifactRecord = structuredClone(passing);
    missingArtifactRecord.controlledArtifacts = missingArtifactRecord.controlledArtifacts.filter(
      (artifact) => artifact.kind !== 'comms-replay-metrics',
    );
    missingArtifactRecord.reportDigest = digestReport(missingArtifactRecord);
    expect(validateExecutorEvidence(manifest, missingArtifactRecord, outputDir)).toContain(
      'executor report is missing required candidate-bound artifact: comms-replay/comms-replay-metrics',
    );
    const verifier = verifyAcceptance(manifest, {
      sourceRoot: root,
      outputDir,
      actor: 'verifier',
      env: { PATH: process.env.PATH ?? '' },
      executorReport: passing,
      spawn: (_command: string, _args: string[], options: { cwd?: string } = {}) => {
        const artifact = join(options.cwd!, 'artifacts', 'comms', 'current-metrics.json');
        mkdirSync(join(options.cwd!, 'artifacts', 'comms'), { recursive: true });
        writeFileSync(artifact, `${JSON.stringify({
          schema: 'comms-replay-metrics/v1',
          candidate: { commit: manifest.candidate.commit, tree: manifest.candidate.tree },
          scenario: 'fixture',
          scenarios: { fixture: {} },
          aggregate: {},
        })}\n`, 'utf8');
        return { status: 0, signal: null, stdout: 'replay command executed\n', stderr: '' };
      },
    });
    expect(verifier).toMatchObject({ result: 'pass', engineeringAcceptedByAgent: true });
    expect(validateReportEvidence(manifest, verifier, outputDir, {
      expectedRole: 'verifier',
      label: 'verifier report',
    })).toEqual([]);
    const copiedArtifact = join(outputDir, 'evidence', 'comms-replay', 'current-metrics.json');
    writeFileSync(copiedArtifact, '{"tampered":true}\n', 'utf8');
    expect(validateExecutorEvidence(manifest, passing, outputDir).join('\n')).toContain('controlled artifact digest mismatch');
  });

  it('rejects a dirty source worktree end-to-end before running any gate', () => {
    const root = createFixtureRepository();
    const outputDir = mkdtempSync(join(tmpdir(), 'agent-acceptance-output-'));
    temporaryPaths.push(outputDir);
    const manifest = createManifest(root);
    writeFileSync(join(root, 'uncommitted.txt'), 'dirty\n', 'utf8');

    const result = runAcceptance(manifest, {
      sourceRoot: root,
      outputDir,
      actor: 'executor',
      env: { PATH: process.env.PATH ?? '' },
      spawn: passingSpawn,
    });
    expect(result).toMatchObject({ result: 'NO-GO', engineeringAcceptedByAgent: false });
    expect(result.failures).toContain('source worktree is dirty');
    expect(result.gates).toEqual([]);
  });

  it('rejects a stale candidate SHA that does not match source HEAD', () => {
    const root = createFixtureRepository();
    const outputDir = mkdtempSync(join(tmpdir(), 'agent-acceptance-output-'));
    temporaryPaths.push(outputDir);
    const manifest = createManifest(root);
    const stale = structuredClone(manifest);
    stale.runId = 'fixture-stale-sha';
    stale.candidate = { ...stale.candidate, commit: '0'.repeat(40), tree: '0'.repeat(40) };
    stale.planDigest = digestPlan(stale);
    stale.manifestDigest = digestManifest(stale);

    const result = runAcceptance(stale, {
      sourceRoot: root,
      outputDir,
      actor: 'executor',
      env: { PATH: process.env.PATH ?? '' },
      spawn: passingSpawn,
    });
    expect(result).toMatchObject({ result: 'NO-GO', engineeringAcceptedByAgent: false });
    expect(result.failures).toEqual(expect.arrayContaining([
      'candidate commit does not match source HEAD',
      'candidate tree does not match source HEAD',
    ]));
  });

  it('rejects executor reports with a missing, duplicated, or reordered gate set', () => {
    const root = createFixtureRepository();
    const outputDir = mkdtempSync(join(tmpdir(), 'agent-acceptance-output-'));
    temporaryPaths.push(outputDir);
    const manifest = createManifest(root);
    const secondGate = {
      id: 'second-gate',
      name: 'Second fixture gate',
      profile: 'fast',
      command: 'node',
      args: ['-e', 'process.exit(0)'],
      required: true,
      allowSkip: false,
      timeoutMs: 1_000,
      safety: { network: 'none', productionEffects: false, humanEvidence: false },
    };
    const twoGateManifest = structuredClone(manifest);
    twoGateManifest.gates = [...manifest.gates, secondGate];
    twoGateManifest.planDigest = digestPlan(twoGateManifest);
    twoGateManifest.manifestDigest = digestManifest(twoGateManifest);
    const baseReport = {
      schema: ACCEPTANCE_SCHEMA,
      role: 'executor',
      runId: twoGateManifest.runId,
      source: { manifestDigest: twoGateManifest.manifestDigest },
      candidate: twoGateManifest.candidate,
      result: 'pass',
      engineeringAcceptedByAgent: false,
      controlledArtifacts: [],
    };

    const missingGate = { ...baseReport, gates: [{ id: 'another-gate', result: 'pass' }] };
    expect(validateExecutorEvidence(twoGateManifest, missingGate, outputDir)).toContain('executor report gate set/order mismatch');

    const duplicatedGate = { ...baseReport, gates: [{ id: 'fixture-gate', result: 'pass' }, { id: 'fixture-gate', result: 'pass' }] };
    expect(validateExecutorEvidence(twoGateManifest, duplicatedGate, outputDir)).toContain('executor report gate set/order mismatch');

    const reorderedGate = { ...baseReport, gates: [{ id: 'second-gate', result: 'pass' }, { id: 'fixture-gate', result: 'pass' }] };
    expect(validateExecutorEvidence(twoGateManifest, reorderedGate, outputDir)).toContain('executor report gate set/order mismatch');

    const inOrderGates = { ...baseReport, gates: [{ id: 'fixture-gate', result: 'pass' }, { id: 'second-gate', result: 'pass' }] };
    expect(validateExecutorEvidence(twoGateManifest, inOrderGates, outputDir)).not.toContain('executor report gate set/order mismatch');
  });

  it('resolveChangedPaths fails closed for missing, blank, or invalid base refs without any fallback', () => {
    const root = createFixtureRepository();
    // A real changed path must be detectable through an explicit ref only.
    expect(() => resolveChangedPaths(root, {})).toThrow(/--since/);
    expect(() => resolveChangedPaths(root, { since: undefined })).toThrow(/--since/);
    expect(() => resolveChangedPaths(root, { since: '' })).toThrow(/--since/);
    expect(() => resolveChangedPaths(root, { since: '   ' })).toThrow(/--since/);
    expect(() => resolveChangedPaths(root, { since: 'no-such-ref' })).toThrow(/invalid or missing base ref/);
    // An explicit changedPaths list never touches the base ref machinery.
    expect(resolveChangedPaths(root, { changedPaths: ['src/a.ts', 'src/b.ts'] })).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('createAcceptancePlan fails closed without an explicit since or changed paths', () => {
    const root = createFixtureRepository();
    const spec = {
      path: 'harness/specs/tasks/fixture.md',
      data: { id: 'fixture-task', title: 'Fixture task', humanEvidence: 'not-required', requiredRules: [] },
      body: '# fixture\n',
    };
    expect(() => createAcceptancePlan({
      root,
      spec,
      changedPaths: undefined,
      since: undefined,
      runId: 'fixture-no-since',
      createdAt: '2026-07-31T00:00:00.000Z',
    })).toThrow(/--since/);
    // Explicit changedPaths never requires a base ref.
    const plan = createAcceptancePlan({
      root,
      spec,
      changedPaths: ['src/a.ts'],
      since: undefined,
      runId: 'fixture-changed-paths',
      createdAt: '2026-07-31T00:00:00.000Z',
    });
    expect(plan.changedPaths).toEqual(['src/a.ts']);
    expect(plan.baseRef).toBeNull();
  });

  // RC-00R regression: dropping --no-diff was not sufficient. harness/src/cli.mjs
  // only enables changed-path diff review when --since is present, so a gate
  // invoked with --spec alone could never fail on unowned paths.
  it('builds the Harness gate with a real --since diff and never with --no-diff', () => {
    const root = createFixtureRepository();
    const spec = {
      path: 'harness/specs/tasks/fixture.md',
      data: { id: 'fixture-task', title: 'Fixture task', humanEvidence: 'not-required', requiredRules: [] },
      body: '# fixture\n',
    };
    const plan = createAcceptancePlan({
      root,
      spec,
      since: 'HEAD',
      runId: 'fixture-harness-diff',
      createdAt: '2026-07-31T00:00:00.000Z',
    });
    const harnessGate = plan.gates.find((gate) => gate.id === 'harness-validate');
    expect(harnessGate).toBeDefined();
    expect(harnessGate.args).toContain('--since');
    expect(harnessGate.args[harnessGate.args.indexOf('--since') + 1]).toBe('HEAD');
    for (const gate of plan.gates) {
      expect(gate.args ?? []).not.toContain('--no-diff');
    }
  });

  // The validator compares report changed-path evidence against the manifest,
  // but no test forced that path to fail. An implementation without a reversed
  // assertion is exactly the "code exists, nothing proves it" shape RC-00R
  // exists to remove. Each mutation below recomputes reportDigest, so the
  // report is internally consistent and only the manifest cross-check can
  // reject it.
  it('rejects executor reports whose changed-path or source-input evidence drifts from the manifest', () => {
    const root = createFixtureRepository();
    const outputDir = mkdtempSync(join(tmpdir(), 'agent-acceptance-output-'));
    temporaryPaths.push(outputDir);
    const manifest = createManifest(root);
    const withDigest = (report) => {
      const copy = { ...report, reportDigest: undefined };
      copy.reportDigest = digestReport(copy);
      return copy;
    };
    const baseReport = {
      schema: ACCEPTANCE_SCHEMA,
      role: 'executor',
      runId: manifest.runId,
      actor: 'executor-a',
      source: {
        manifestDigest: manifest.manifestDigest,
        planDigest: manifest.planDigest,
        changedPaths: manifest.changedPaths,
        sourceFiles: manifest.source.files,
      },
      candidate: manifest.candidate,
      result: 'pass',
      engineeringAcceptedByAgent: false,
      controlledArtifacts: [],
      gates: [{ id: 'fixture-gate', result: 'pass' }],
    };

    // Control: faithful evidence must not trip either drift check.
    const faithful = validateExecutorEvidence(manifest, withDigest(baseReport), outputDir);
    expect(faithful).not.toContain('executor report changed-path evidence mismatch');
    expect(faithful).not.toContain('executor report source-input evidence mismatch');

    // Hiding a reviewed path is the payload that matters: it is how a run
    // claims to have reviewed less than the candidate actually changed.
    const droppedPath = withDigest({
      ...baseReport,
      source: { ...baseReport.source, changedPaths: [] },
    });
    expect(validateExecutorEvidence(manifest, droppedPath, outputDir)).toContain(
      'executor report changed-path evidence mismatch',
    );

    const extraPath = withDigest({
      ...baseReport,
      source: { ...baseReport.source, changedPaths: [...manifest.changedPaths, 'src/never-touched.ts'] },
    });
    expect(validateExecutorEvidence(manifest, extraPath, outputDir)).toContain(
      'executor report changed-path evidence mismatch',
    );

    // Same set, different order: the comparison must be order-sensitive
    // because the manifest list is normalized and sorted.
    const manifestWithTwoPaths = { ...manifest, changedPaths: ['src/a.ts', 'src/b.ts'] };
    const reorderedPaths = withDigest({
      ...baseReport,
      source: { ...baseReport.source, changedPaths: ['src/b.ts', 'src/a.ts'] },
    });
    expect(validateExecutorEvidence(manifestWithTwoPaths, reorderedPaths, outputDir)).toContain(
      'executor report changed-path evidence mismatch',
    );

    // Source-input drift: a mutated blob identity must not pass either.
    const driftedSource = withDigest({
      ...baseReport,
      source: {
        ...baseReport.source,
        sourceFiles: manifest.source.files.map((file, index) =>
          index === 0 ? { ...file, gitBlob: 'f'.repeat(40) } : file,
        ),
      },
    });
    expect(validateExecutorEvidence(manifest, driftedSource, outputDir)).toContain(
      'executor report source-input evidence mismatch',
    );
  });

  it('rejects executor reports with missing, blank, non-string, or mismatched actors and bad report digests', () => {
    const root = createFixtureRepository();
    const outputDir = mkdtempSync(join(tmpdir(), 'agent-acceptance-output-'));
    temporaryPaths.push(outputDir);
    const manifest = createManifest(root);
    const baseReport = {
      schema: ACCEPTANCE_SCHEMA,
      role: 'executor',
      runId: manifest.runId,
      source: { manifestDigest: manifest.manifestDigest },
      candidate: manifest.candidate,
      result: 'pass',
      engineeringAcceptedByAgent: false,
      controlledArtifacts: [],
      gates: [{ id: 'fixture-gate', result: 'pass' }],
    };
    const withDigest = (report) => {
      const copy = { ...report, reportDigest: undefined };
      copy.reportDigest = digestReport(copy);
      return copy;
    };

    const missingActor = withDigest(baseReport);
    delete missingActor.actor;
    expect(validateExecutorEvidence(manifest, missingActor, outputDir)).toContain('executor report actor is missing, blank, or not a string');

    const blankActor = withDigest({ ...baseReport, actor: '   ' });
    expect(validateExecutorEvidence(manifest, blankActor, outputDir)).toContain('executor report actor is missing, blank, or not a string');

    const nonStringActor = withDigest({ ...baseReport, actor: { id: 7 } });
    expect(validateExecutorEvidence(manifest, nonStringActor, outputDir)).toContain('executor report actor is missing, blank, or not a string');

    const mismatchedField = withDigest({ ...baseReport, actor: 'executor-a', executorActor: 'executor-b' });
    expect(validateExecutorEvidence(manifest, mismatchedField, outputDir)).toContain('executor report actor and executorActor fields differ');

    const tamperedDigest = { ...withDigest({ ...baseReport, actor: 'executor-a' }), reportDigest: 'f'.repeat(64) };
    expect(validateExecutorEvidence(manifest, tamperedDigest, outputDir)).toContain('executor report semantic reportDigest mismatch');

    const missingDigest = { ...baseReport, actor: 'executor-a' };
    expect(validateExecutorEvidence(manifest, missingDigest, outputDir)).toContain('executor report semantic reportDigest is missing or malformed');

    const valid = withDigest({ ...baseReport, actor: 'executor-a', executorActor: 'executor-a' });
    expect(validateExecutorEvidence(manifest, valid, outputDir)).not.toContain('executor report actor is missing, blank, or not a string');
    expect(validateExecutorEvidence(manifest, valid, outputDir)).not.toContain('executor report actor and executorActor fields differ');
    expect(validateExecutorEvidence(manifest, valid, outputDir)).not.toContain('executor report semantic reportDigest mismatch');
    expect(validateExecutorEvidence(manifest, valid, outputDir)).not.toContain('executor report semantic reportDigest is missing or malformed');
  });

  it('rejects an executor report with an identical verifier identity even when other evidence is valid', () => {
    const root = createFixtureRepository();
    const outputDir = mkdtempSync(join(tmpdir(), 'agent-acceptance-output-'));
    temporaryPaths.push(outputDir);
    const manifest = createManifest(root);
    const executor = runAcceptance(manifest, { sourceRoot: root, outputDir, actor: 'shared-identity', env: { PATH: process.env.PATH ?? '' }, spawn: passingSpawn });
    expect(executor.result).toBe('pass');

    const verifier = verifyAcceptance(manifest, {
      sourceRoot: root,
      outputDir,
      actor: 'shared-identity',
      env: { PATH: process.env.PATH ?? '' },
      executorReport: executor,
      spawn: passingSpawn,
    });
    expect(verifier).toMatchObject({ result: 'NO-GO', engineeringAcceptedByAgent: false });
    expect(verifier.failures.join('\n')).toContain('executor and verifier identities must differ');
  });

  it('refuses engineering acceptance when verifier rerun contradicts executor result contracts', () => {
    const root = createFixtureRepository();
    const outputDir = mkdtempSync(join(tmpdir(), 'agent-acceptance-output-'));
    temporaryPaths.push(outputDir);
    const manifest = createManifest(root);
    const env = { PATH: process.env.PATH ?? '' };
    const executor = runAcceptance(manifest, { sourceRoot: root, outputDir, actor: 'executor', env, spawn: passingSpawn });
    expect(executor.result).toBe('pass');

    const verifier = verifyAcceptance(manifest, {
      sourceRoot: root,
      outputDir,
      actor: 'verifier',
      env,
      executorReport: executor,
      spawn: () => ({ status: 1, signal: null, stdout: '', stderr: 'verifier gate failed' }),
    });
    expect(verifier).toMatchObject({ result: 'NO-GO', engineeringAcceptedByAgent: false });
    expect(verifier.failures.join('\n')).toContain('executor/verifier result contract differs');
  });

  it('fails closed for a missing --since ref and never falls back to the HEAD file list', () => {
    const specPath = 'harness/specs/tasks/agent-engineering-acceptance-orchestrator.md';
    const outputDir = mkdtempSync(join(tmpdir(), 'agent-acceptance-cli-'));
    temporaryPaths.push(outputDir);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      // Missing --since (and no --changed): the plan must fail closed, not fall
      // back to an implicit HEAD^/HEAD file list.
      const missingSinceExit = acceptanceCliMain(['plan', '--spec', specPath, '--output-dir', outputDir]);
      expect(missingSinceExit).toBe(1);
      expect(error.mock.calls.some((call) => String(call[0] ?? '').includes('--since'))).toBe(true);

      // Invalid --since ref: must fail closed, never reuse the last HEAD diff.
      const invalidExit = acceptanceCliMain(['plan', '--spec', specPath, '--since', 'this-ref-does-not-exist', '--output-dir', outputDir]);
      expect(invalidExit).toBe(1);
      expect(existsSync(join(outputDir, 'manifest.json'))).toBe(false);

      // Invalid --since on the full path also fails closed before any gate runs.
      vi.stubEnv('NODE_TLS_REJECT_UNAUTHORIZED', '0');
      const invalidFullExit = acceptanceCliMain(['full', '--spec', specPath, '--output-dir', outputDir, '--since', 'this-ref-does-not-exist']);
      expect(invalidFullExit).toBe(1);
      expect(existsSync(join(outputDir, 'final-report.json'))).toBe(false);
    } finally {
      log.mockRestore();
      error.mockRestore();
    }
  });

  it('CLI plan with an explicit since succeeds and a TLS-poisoned full run persists a NO-GO final report', () => {
    const specPath = 'harness/specs/tasks/agent-engineering-acceptance-orchestrator.md';
    const outputDir = mkdtempSync(join(tmpdir(), 'agent-acceptance-cli-'));
    temporaryPaths.push(outputDir);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const planExit = acceptanceCliMain(['plan', '--spec', specPath, '--since', 'HEAD^', '--output-dir', outputDir]);
      expect(planExit).toBe(0);
      expect(existsSync(join(outputDir, 'manifest.json'))).toBe(true);
      const manifest = JSON.parse(readFileSync(join(outputDir, 'manifest.json'), 'utf8'));
      expect(manifest.baseRef).toBe('HEAD^');

      const statusExit = acceptanceCliMain(['status', '--output-dir', outputDir]);
      expect(statusExit).toBe(0);

      vi.stubEnv('NODE_TLS_REJECT_UNAUTHORIZED', '0');
      const fullExit = acceptanceCliMain(['full', '--spec', specPath, '--output-dir', outputDir, '--since', 'HEAD^']);
      expect(fullExit).toBe(1);
      const finalReportPath = join(outputDir, 'final-report.json');
      expect(existsSync(finalReportPath)).toBe(true);
      const finalReport = JSON.parse(readFileSync(finalReportPath, 'utf8'));
      expect(finalReport).toMatchObject({ result: 'NO-GO', engineeringAcceptedByAgent: false, conclusion: { allowedPromotion: false } });
      expect(finalReport.failures.join('\n')).toContain('NODE_TLS_REJECT_UNAUTHORIZED must be unset');
      expect(finalReport.reportDigest).toMatch(/^[a-f0-9]{64}$/);

      const statusAfterFull = acceptanceCliMain(['status', '--output-dir', outputDir]);
      expect(statusAfterFull).toBe(0);
      const statusCalls = log.mock.calls
        .map((call) => call[0])
        .filter((value) => typeof value === 'string' && value.includes('"runs"'));
      const statusJson = statusCalls[statusCalls.length - 1];
      expect(statusJson).toBeTruthy();
      expect(statusJson).toContain('"result": "NO-GO"');
      expect(statusJson).toContain('final-report.json');
    } finally {
      log.mockRestore();
    }
  });

  it('status sees nested default-layout runs and ignores internal verifier subdirectories', () => {
    const root = createFixtureRepository();
    const outputDir = mkdtempSync(join(tmpdir(), 'agent-acceptance-status-'));
    temporaryPaths.push(outputDir);
    const manifest = createManifest(root);
    // Default layout: <statusRoot>/runs/<runId>/final-report.json
    const runDir = join(outputDir, 'runs', manifest.runId);
    mkdirSync(join(runDir, 'verifier'), { recursive: true });
    writeFileSync(join(runDir, 'final-report.json'), `${JSON.stringify({ ...manifest, schema: ACCEPTANCE_SCHEMA, role: 'executor', runId: manifest.runId, result: 'NO-GO', engineeringAcceptedByAgent: false, generatedAt: '2026-07-31T00:00:00.000Z' }, null, 2)}\n`, 'utf8');
    // Internal verifier subdirectory must not be counted as a second run.
    writeFileSync(join(runDir, 'verifier', 'verifier-report.json'), `${JSON.stringify({ schema: ACCEPTANCE_SCHEMA, role: 'verifier', runId: manifest.runId, result: 'pass', engineeringAcceptedByAgent: true, generatedAt: '2026-07-31T00:00:01.000Z' }, null, 2)}\n`, 'utf8');

    const status = readAcceptanceStatus(outputDir);
    expect(status.runs).toHaveLength(1);
    expect(status.runs[0]).toMatchObject({ runId: manifest.runId, result: 'NO-GO', engineeringAcceptedByAgent: false });
    expect(status.runs[0].path).toBe(`runs/${manifest.runId}/final-report.json`);

    // Flat layout: a verifier/ subdirectory next to final-report.json must not
    // double-count when the caller points --output-dir at the run directory.
    const flatDir = join(outputDir, 'flat-run');
    mkdirSync(join(flatDir, 'verifier'), { recursive: true });
    writeFileSync(join(flatDir, 'final-report.json'), `${JSON.stringify({ schema: ACCEPTANCE_SCHEMA, role: 'executor', runId: 'flat-run', result: 'NO-GO', engineeringAcceptedByAgent: false, generatedAt: '2026-07-31T00:00:02.000Z' }, null, 2)}\n`, 'utf8');
    writeFileSync(join(flatDir, 'verifier', 'verifier-report.json'), `${JSON.stringify({ schema: ACCEPTANCE_SCHEMA, role: 'verifier', runId: 'flat-run', result: 'pass', engineeringAcceptedByAgent: true, generatedAt: '2026-07-31T00:00:03.000Z' }, null, 2)}\n`, 'utf8');
    const flatStatus = readAcceptanceStatus(flatDir);
    expect(flatStatus.runs).toHaveLength(1);
    expect(flatStatus.runs[0]).toMatchObject({ runId: 'flat-run', result: 'NO-GO', engineeringAcceptedByAgent: false });
    expect(flatStatus.runs[0].path).toBe('final-report.json');
  });

  it('proves RC-00 end-to-end on a real isolated fixture with real gate execution', () => {
    // This is the RC-00 exit proof: a clean fixture repo, a real (unmocked)
    // detached-worktree gate run, a separately identified Executor and Verifier,
    // explicit output-dir, redacted logs, and green verifier/final reports.
    const root = createFixtureRepository();
    const outputDir = mkdtempSync(join(tmpdir(), 'agent-acceptance-real-'));
    temporaryPaths.push(outputDir);
    const manifest = createManifest(root, {
      gate: {
        id: 'fixture-real-gate',
        name: 'Fixture real gate',
        profile: 'fast',
        command: 'node',
        args: ['-e', 'console.log("Tests 1 passed (1)")'],
        required: true,
        allowSkip: false,
        timeoutMs: 30_000,
        safety: { network: 'none', productionEffects: false, humanEvidence: false },
        testExpectation: { requireCounts: true, expectedSkips: 0 },
      },
    });
    const env = { PATH: process.env.PATH ?? '' };

    // Executor (real gate run in a detached worktree).
    const executor = runAcceptance(manifest, { sourceRoot: root, outputDir, actor: 'rc00-executor', env });
    expect(executor).toMatchObject({ result: 'pass', engineeringAcceptedByAgent: false });
    expect(executor.role).toBe('executor');
    expect(executor.reportDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(existsSync(join(outputDir, 'executor-report.json'))).toBe(true);
    expect(existsSync(join(outputDir, 'logs', 'fixture-real-gate.stdout.log'))).toBe(true);
    expect(executor.testCounts).toMatchObject({ passed: 1, failed: 0, skipped: 0, total: 1 });
    // Logs are redacted: the fixture output dir must not leak into the log.
    const logText = readFileSync(join(outputDir, 'logs', 'fixture-real-gate.stdout.log'), 'utf8');
    expect(logText).not.toContain(tmpdir());

    // Independent Verifier reruns the same manifest in a second worktree.
    const verifier = verifyAcceptance(manifest, {
      sourceRoot: root,
      outputDir,
      actor: 'rc00-verifier',
      env,
      executorReport: executor,
    });
    expect(verifier).toMatchObject({ result: 'pass', engineeringAcceptedByAgent: true, role: 'verifier' });
    expect(verifier.executorActor).toBe('rc00-executor');
    expect(verifier.verifierActor).toBe('rc00-verifier');
    expect(verifier.reportDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(verifier.consistency).toMatchObject({ identicalGateContracts: true });
    expect(existsSync(join(outputDir, 'verifier-report.json'))).toBe(true);
    expect(existsSync(join(outputDir, 'final-report.json'))).toBe(true);

    const finalReport = JSON.parse(readFileSync(join(outputDir, 'final-report.json'), 'utf8'));
    expect(finalReport).toMatchObject({
      result: 'pass',
      engineeringAcceptedByAgent: true,
      role: 'verifier',
      executorActor: 'rc00-executor',
      verifierActor: 'rc00-verifier',
      conclusion: { verifierRequired: true, allowedPromotion: false },
    });
    expect(finalReport.safety).toMatchObject({ liveReady: false, productApproved: false, defaultOn: false, promotionAuthorized: false });

    // A second Agent reproduction: a fresh output dir, same manifest, same
    // identities, must independently produce a green final report.
    const secondOutput = mkdtempSync(join(tmpdir(), 'agent-acceptance-real2-'));
    temporaryPaths.push(secondOutput);
    const executor2 = runAcceptance(manifest, { sourceRoot: root, outputDir: secondOutput, actor: 'rc00-executor', env });
    const verifier2 = verifyAcceptance(manifest, {
      sourceRoot: root,
      outputDir: secondOutput,
      actor: 'rc00-verifier',
      env,
      executorReport: executor2,
    });
    expect(verifier2).toMatchObject({ result: 'pass', engineeringAcceptedByAgent: true });
    const finalReport2 = JSON.parse(readFileSync(join(secondOutput, 'final-report.json'), 'utf8'));
    expect(finalReport2).toMatchObject({ result: 'pass', engineeringAcceptedByAgent: true });
  });

  it('keeps the standalone RC-00 bootstrap manifest digests canonical', () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'rc00-bootstrap-test-'));
    temporaryPaths.push(outputDir);

    execFileSync(
      process.execPath,
      ['scripts/rc00-acceptance-bootstrap.mjs', outputDir],
      { cwd: process.cwd(), encoding: 'utf8' },
    );

    const finalReport = JSON.parse(readFileSync(join(outputDir, 'final-report.json'), 'utf8'));
    expect(finalReport).toMatchObject({
      result: 'pass',
      engineeringAcceptedByAgent: true,
      role: 'verifier',
      executorActor: 'rc00-executor',
      verifierActor: 'rc00-verifier',
    });
    expect(finalReport.reportDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it('validates engineering and human convergence evidence and rejects semantic tampering', () => {
    const { root, base, baselineRelative } = createConvergenceFixture();
    const outputDir = join(root, 'artifacts', 'agent-engineering-acceptance', 'fixture-convergence');
    const manifest = createManifest(root, {
      humanEvidence: 'required',
      gate: {
        id: 'fixture-validator-gate',
        name: 'Fixture validator gate',
        profile: 'fast',
        command: 'node',
        args: ['-e', 'console.log("Tests 1 passed (1)")'],
        required: true,
        allowSkip: false,
        timeoutMs: 30_000,
        safety: { network: 'none', productionEffects: false, humanEvidence: false },
        testExpectation: { requireCounts: true, expectedSkips: 0 },
      },
    });
    manifest.baseRef = base;
    manifest.changedPaths = [baselineRelative];
    resealManifest(manifest);
    mkdirSync(outputDir, { recursive: true });
    const manifestPath = join(outputDir, 'manifest.json');
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

    const executor = runAcceptance(manifest, {
      sourceRoot: root,
      outputDir,
      actor: 'validator-executor',
      env: { PATH: process.env.PATH ?? '' },
    });
    expect(executor.result).toBe('pass');
    const verifier = verifyAcceptance(manifest, {
      sourceRoot: root,
      outputDir,
      actor: 'validator-verifier',
      env: { PATH: process.env.PATH ?? '' },
      executorReport: executor,
    });
    expect(verifier).toMatchObject({ result: 'pass', engineeringAcceptedByAgent: true });
    const reportPath = join(outputDir, 'final-report.json');
    const engineering = validateRuntimeAuthorityConvergence({
      root,
      phase: 'engineering',
      manifestPath,
      engineeringReportPath: reportPath,
      baselinePath: baselineRelative,
    });
    expect(engineering).toEqual(expect.objectContaining({ ok: true, errors: [] }));

    const humanVerdictPath = join(outputDir, 'human-verdict.yaml');
    writeFileSync(humanVerdictPath, [
      'schema: runtime-authority-convergence-human-verdict/v1',
      `candidate_sha: ${manifest.candidate.commit}`,
      `manifest_sha256: ${sha256File(manifestPath)}`,
      `engineering_report_sha256: ${sha256File(reportPath)}`,
      'verdict: accepted',
      'accepted_scenarios: [H-01, H-02, H-03, H-04, H-05, H-06]',
      'failed_scenarios: []',
      'notes: fixture proof',
      'decided_at: 2026-08-03T00:00:00.000Z',
      '',
    ].join('\n'), 'utf8');
    const human = validateRuntimeAuthorityConvergence({
      root,
      phase: 'human',
      manifestPath,
      engineeringReportPath: reportPath,
      humanVerdictPath,
      baselinePath: baselineRelative,
    });
    expect(human).toEqual(expect.objectContaining({ ok: true, errors: [] }));

    const changedPathTamper = structuredClone(manifest);
    changedPathTamper.changedPaths = [];
    resealManifest(changedPathTamper);
    const changedPathTamperPath = join(outputDir, 'tampered-paths-manifest.json');
    writeFileSync(changedPathTamperPath, `${JSON.stringify(changedPathTamper, null, 2)}\n`, 'utf8');
    const changedPathResult = validateRuntimeAuthorityConvergence({
      root,
      phase: 'engineering',
      manifestPath: changedPathTamperPath,
      engineeringReportPath: reportPath,
      baselinePath: baselineRelative,
    });
    expect(changedPathResult.errors.some((error) => error.startsWith('manifest changedPaths mismatch'))).toBe(true);

    const badPhase = validateRuntimeAuthorityConvergence({
      root,
      phase: 'final',
      manifestPath,
      engineeringReportPath: reportPath,
      baselinePath: baselineRelative,
    });
    expect(badPhase.errors).toContain('phase must be one of: engineering, human');

    const tamperedReport = structuredClone(verifier);
    tamperedReport.gates[0].command = 'echo';
    tamperedReport.reportDigest = digestReport(tamperedReport);
    const tamperedReportPath = join(outputDir, 'tampered-report.json');
    writeFileSync(tamperedReportPath, `${JSON.stringify(tamperedReport, null, 2)}\n`, 'utf8');
    const commandTamper = validateRuntimeAuthorityConvergence({
      root,
      phase: 'engineering',
      manifestPath,
      engineeringReportPath: tamperedReportPath,
      baselinePath: baselineRelative,
    });
    expect(commandTamper.ok).toBe(false);
    expect(commandTamper.errors).toContain('final report gate command mismatch: fixture-validator-gate');

    const sameActor = structuredClone(verifier);
    sameActor.executorActor = sameActor.verifierActor;
    sameActor.reportDigest = digestReport(sameActor);
    const sameActorPath = join(outputDir, 'same-actor-report.json');
    writeFileSync(sameActorPath, `${JSON.stringify(sameActor, null, 2)}\n`, 'utf8');
    const actorTamper = validateRuntimeAuthorityConvergence({
      root,
      phase: 'engineering',
      manifestPath,
      engineeringReportPath: sameActorPath,
      baselinePath: baselineRelative,
    });
    expect(actorTamper.errors).toContain('Executor/Verifier identity separation failed');

    const sourceTamper = structuredClone(manifest);
    sourceTamper.source.files[0].gitBlob = '0'.repeat(40);
    resealManifest(sourceTamper);
    const sourceTamperPath = join(outputDir, 'tampered-source-manifest.json');
    writeFileSync(sourceTamperPath, `${JSON.stringify(sourceTamper, null, 2)}\n`, 'utf8');
    const sourceResult = validateRuntimeAuthorityConvergence({
      root,
      phase: 'engineering',
      manifestPath: sourceTamperPath,
      engineeringReportPath: reportPath,
      baselinePath: baselineRelative,
    });
    expect(sourceResult.errors).toContain('source Git blob mismatch: package.json');

    const badVerdictPath = join(outputDir, 'bad-human-verdict.yaml');
    writeFileSync(badVerdictPath, readFileSync(humanVerdictPath, 'utf8').replace('H-06', 'H-99'), 'utf8');
    const verdictTamper = validateRuntimeAuthorityConvergence({
      root,
      phase: 'human',
      manifestPath,
      engineeringReportPath: reportPath,
      humanVerdictPath: badVerdictPath,
      baselinePath: baselineRelative,
    });
    expect(verdictTamper.errors).toContain('human verdict accepted_scenarios must be exactly H-01 through H-06');

    const hashTamperPath = join(outputDir, 'bad-hash-verdict.yaml');
    writeFileSync(hashTamperPath, readFileSync(humanVerdictPath, 'utf8').replace(/manifest_sha256: .+/u, `manifest_sha256: ${'0'.repeat(64)}`), 'utf8');
    const hashTamper = validateRuntimeAuthorityConvergence({
      root,
      phase: 'human',
      manifestPath,
      engineeringReportPath: reportPath,
      humanVerdictPath: hashTamperPath,
      baselinePath: baselineRelative,
    });
    expect(hashTamper.errors).toContain('human verdict manifest_sha256 mismatch');
  });
});
