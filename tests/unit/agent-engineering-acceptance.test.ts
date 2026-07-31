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
  inferCoverage,
  redactText,
  readAcceptanceStatus,
  repositoryIdentity,
  runAcceptance,
  sha256File,
  validateAcceptanceEnvironment,
  validateAcceptanceManifest,
  validateExecutorEvidence,
  verifyAcceptance,
} from '../../scripts/lib/agent-engineering-acceptance.mjs';
import { main as acceptanceCliMain } from '../../scripts/agent-engineering-acceptance.mjs';

const temporaryPaths: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  for (const path of temporaryPaths.splice(0)) rmSync(path, { recursive: true, force: true });
});

function git(root: string, args: string[]) {
  execFileSync('git', args, { cwd: root, stdio: 'pipe' });
}

function createFixtureRepository() {
  const root = mkdtempSync(join(tmpdir(), 'agent-acceptance-fixture-'));
  temporaryPaths.push(root);
  mkdirSync(join(root, 'harness', 'specs', 'tasks'), { recursive: true });
  writeFileSync(join(root, 'package.json'), '{"name":"fixture","version":"1.0.0"}\n', 'utf8');
  writeFileSync(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n', 'utf8');
  writeFileSync(join(root, '.npmrc'), 'strict-peer-dependencies=false\n', 'utf8');
  writeFileSync(join(root, '.gitignore'), 'artifacts/\n', 'utf8');
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
    source: { files: sourceFiles, missing: [], lockFiles: sourceFiles.slice(0, 3) },
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
  manifest.planDigest = digestManifest(manifest);
  manifest.manifestDigest = digestManifest(manifest);
  return manifest;
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
    unsafe.manifestDigest = digestManifest(unsafe);
    expect(validateAcceptanceManifest(unsafe).errors).toEqual(expect.arrayContaining([
      'fixture-gate: allowSkip must be false',
      'fixture-gate: forbidden argument --fix',
    ]));

    writeFileSync(join(root, 'package.json'), '{"name":"changed"}\n', 'utf8');
    expect(validateAcceptanceManifest(manifest, { root, requireClean: false }).errors).toContain(
      'source input digest mismatch: package.json',
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
    timeoutManifest.planDigest = digestManifest(timeoutManifest);
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
    hiddenManifest.planDigest = digestManifest(hiddenManifest);
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
    stale.planDigest = digestManifest(stale);
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
    twoGateManifest.planDigest = digestManifest(twoGateManifest);
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

  it('CLI plan/status succeed and a failed full run persists a NO-GO final report', () => {
    const specPath = 'harness/specs/tasks/agent-engineering-acceptance-orchestrator.md';
    const outputDir = mkdtempSync(join(tmpdir(), 'agent-acceptance-cli-'));
    temporaryPaths.push(outputDir);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const planExit = acceptanceCliMain(['plan', '--spec', specPath, '--output-dir', outputDir]);
      expect(planExit).toBe(0);
      expect(existsSync(join(outputDir, 'manifest.json'))).toBe(true);

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
});
