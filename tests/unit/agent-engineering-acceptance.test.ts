import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ACCEPTANCE_SCHEMA,
  TF0009_ADAPTER_ID,
  type AcceptanceGate,
  type AcceptanceManifest,
  type AcceptanceReport,
  createAcceptancePlan,
  digestManifest,
  digestPlan,
  digestReport,
  inferCoverage,
  isCountableTestCommand,
  parseTestCounts,
  redactText,
  readAcceptanceStatus,
  repositoryIdentity,
  resolveChangedPaths,
  runAcceptance as runActualAcceptance,
  sha256,
  sha256File,
  stableJson,
  validateAcceptanceEnvironment,
  validateAcceptanceManifest,
  validateExecutorEvidence,
  validateReportEvidence,
  verifyAcceptance as verifyActualAcceptance,
} from '../../scripts/lib/agent-engineering-acceptance.mjs';
import { main as acceptanceCliMain } from '../../scripts/agent-engineering-acceptance.mjs';
import { validateRuntimeAuthorityConvergence } from '../../scripts/validate-runtime-authority-convergence.mjs';

const temporaryPaths: string[] = [];
const fixturePolicy = vi.hoisted(() => ({ steps: null as AcceptanceGate[] | null }));
const fixtureGateIds = new Set<string>();

vi.mock('../../harness/src/profiles.mjs', async (importOriginal) => {
  const actual = await importOriginal<{ selectSteps: (profiles: string[]) => AcceptanceGate[] }>();
  return {
    ...actual,
    selectSteps: (profiles: string[]) => fixturePolicy.steps ?? actual.selectSteps(profiles),
  };
});

afterEach(() => {
  vi.unstubAllEnvs();
  fixturePolicy.steps = null;
  fixtureGateIds.clear();
  for (const path of temporaryPaths.splice(0)) {
    try {
      rmSync(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code !== 'EPERM' && code !== 'EBUSY' && code !== 'ENOTEMPTY') throw error;
    }
  }
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
  writeFileSync(join(root, '.gitignore'), 'artifacts/\nnode_modules/\nresources/bin/\nopenclaw_runtime/apps/\n', 'utf8');
  writeFileSync(join(root, '.gitattributes'), '*.md text\n', 'utf8');
  writeFileSync(join(root, 'harness', 'specs', 'tasks', 'fixture.md'), '# fixture\n', 'utf8');
  mkdirSync(join(root, 'harness', 'src'), { recursive: true });
  writeFileSync(join(root, 'harness', 'src', 'profiles.mjs'), readFileSync('harness/src/profiles.mjs'));
  const fixtureFiles = {
    'resources/verseshell/manifest.json': JSON.stringify({ artifacts: { 'win32-x64': { sha256: sha256('fixture'), bytes: 7 } } }),
    'artifacts/uas-06-single-local-exec-canary/live-observations.json': '{}',
    'artifacts/unified-agent-system/TF-0011/audit-manifest.json': '{}',
    'artifacts/agent-engineering-acceptance/runtime-authority-convergence-final/changed-path-ownership.json': '{}',
    'openclaw_runtime/apps/shared/OpenClawKit/Sources/OpenClawKit/Resources/tool-display.json': '{}',
    'node_modules/.pnpm/electron@40.8.4/node_modules/electron/path.txt': 'electron.exe',
    'node_modules/.pnpm/electron@40.8.4/node_modules/electron/dist/electron.exe': 'fixture',
  };
  for (const [path, body] of Object.entries(fixtureFiles)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), body, 'utf8');
  }
  git(root, ['init', '--quiet']);
  git(root, ['config', 'user.email', 'fixture@example.invalid']);
  git(root, ['config', 'user.name', 'Acceptance Fixture']);
  git(root, ['add', '.']);
  git(root, ['commit', '--quiet', '-m', 'fixture']);
  return root;
}

function createManifest(root: string, options: { gate?: AcceptanceGate; humanEvidence?: 'required' | 'not-required' } = {}) {
  const gate = options.gate ?? {
      id: 'fixture-gate',
      name: 'Fixture gate',
      profile: 'fast',
      command: 'node',
      args: ['-e', 'process.exit(0)'],
      required: true,
      allowSkip: false,
      timeoutMs: 1_000,
      safety: { network: 'none', productionEffects: false, humanEvidence: false },
  };
  const requiredTests = gate.commandLine ? [gate.commandLine] : [];
  const adapter = gate.adapter === TF0009_ADAPTER_ID;
  const comms = gate.id === 'comms-replay';
  fixturePolicy.steps = requiredTests.length || adapter || comms ? [] : [gate];
  fixtureGateIds.clear();
  fixtureGateIds.add(gate.id);
  const data = {
    id: adapter ? 'tf0009-engineering-evidence-audit' : 'fixture-task',
    title: 'Fixture task',
    humanEvidence: options.humanEvidence ?? 'not-required',
    requiredRules: [],
    requiredProfiles: comms ? ['fast', 'comms'] : ['fast'],
    requiredTests,
  };
  const frontmatter = Object.entries(data).flatMap(([key, value]) => Array.isArray(value)
    ? [`${key}:`, ...value.map((entry) => `  - ${entry}`)]
    : [`${key}: ${value}`]).join('\n');
  writeFileSync(join(root, 'harness/specs/tasks/fixture.md'), `---\n${frontmatter}\n---\n# fixture\n`, 'utf8');
  git(root, ['add', 'harness/specs/tasks/fixture.md']);
  git(root, ['commit', '--quiet', '--allow-empty', '-m', 'fixture candidate']);
  return createAcceptancePlan({
    root,
    specPath: 'harness/specs/tasks/fixture.md',
    since: 'HEAD^',
    runId: 'fixture-run',
    createdAt: '2026-07-31T00:00:00.000Z',
  });
}

type FixtureSpawn = typeof passingSpawn;

function fixtureOptions(manifest: AcceptanceManifest, options: Record<string, unknown>) {
  let index = 0;
  const spawn = options.spawn as FixtureSpawn | undefined;
  return {
    ...options,
    spawn: (command: string, args: string[], spawnOptions: { cwd: string }) => {
      const gate = manifest.gates[index++];
      if (fixtureGateIds.has(gate.id)) return (spawn ?? spawnSync)(command, args, spawnOptions);
      if (gate.kind === 'provision-verseshell') {
        mkdirSync(join(spawnOptions.cwd, 'resources/bin/win32-x64'), { recursive: true });
        writeFileSync(join(spawnOptions.cwd, 'resources/bin/win32-x64/ae.exe'), 'fixture');
      }
      if (gate.id === 'comms-compare') {
        mkdirSync(join(spawnOptions.cwd, 'artifacts/comms'), { recursive: true });
        writeFileSync(join(spawnOptions.cwd, 'artifacts/comms/compare-report.json'), JSON.stringify({ schema: 'comms-compare-report/v1', candidate: manifest.candidate, fixture: true }));
      }
      return passingSpawn(command, args, spawnOptions);
    },
  };
}

// Keep every derived gate in protocol tests. Only the selected fixture gate
// uses each test's spawner; unrelated build/install steps are simulated.
function runAcceptance(manifest: AcceptanceManifest, options: Record<string, unknown>): AcceptanceReport {
  return runActualAcceptance(manifest, fixtureOptions(manifest, options));
}

function verifyAcceptance(manifest: AcceptanceManifest, options: Record<string, unknown>): AcceptanceReport {
  return verifyActualAcceptance(manifest, fixtureOptions(manifest, options));
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
  // RC-09: the validator derives the required owner set from the final spec's
  // cumulativeOwnership.requiredSpecs instead of trusting the matrix.
  const finalSpecRelative = 'harness/specs/tasks/runtime-authority-convergence-final-acceptance.md';
  writeFileSync(join(root, ...finalSpecRelative.split('/')), [
    '---',
    'id: runtime-authority-convergence-final-acceptance',
    'title: RC-09 Final Engineering Acceptance',
    'cumulativeOwnership:',
    '  requiredSpecs:',
    '    - harness/specs/tasks/rc00-agent-engineering-acceptance-bootstrap.md',
    '---',
    '# RC-09 fixture',
    '',
  ].join('\n'), 'utf8');
  git(root, ['add', '--force', baselineRelative, finalSpecRelative]);
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
  it('derives full runtime, UI, comms, and release coverage from changed paths (release does not imply maturity)', () => {
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

    expect(manifest.coverage).toMatchObject({ runtime: true, ui: true, comms: true, release: true });
    expect(manifest.coverage).not.toHaveProperty('maturity');
    expect(manifest.requiredProfiles).toEqual(expect.arrayContaining(['fast', 'runtime', 'e2e', 'comms', 'release', 'full']));
    expect(manifest.requiredProfiles).not.toContain('maturity');
    expect(manifest.gates.map((gate) => gate.id)).toEqual(expect.arrayContaining([
      'runtime-unit',
      'runtime-static-check',
      'electron-e2e',
      'comms-replay',
      'release-baseline-validate',
    ]));
    expect(manifest.gates.map((gate) => gate.id)).not.toContain('maturity-validate');
    const commands = manifest.gates.map((gate) => gate.args.join(' '));
    expect(commands).toEqual(expect.arrayContaining([
      expect.stringContaining('lint:check'),
      expect.stringContaining('typecheck'),
      expect.stringContaining(' test'),
    ]));
    expect(validateAcceptanceManifest(manifest)).toEqual({ ok: true, errors: [] });
  });

  it('defers coverage-triggered suites to a named owner node without deleting them', () => {
    const changedPaths = ['src/components/Settings.tsx', 'scripts/release-baseline-manifest.mjs'];
    const specData = {
      id: 'fixture-deferral',
      title: 'Fixture deferral',
      diffBase: undefined,
      requiredRules: [],
      requiredTests: [],
      deferredProfiles: {
        e2e: 'TF-0041 :: full UI suite owned by the release-freeze node',
        release: 'TF-0041 :: release packaging owned by TF-0041',
      },
    };
    const base = createAcceptancePlan({
      spec: { path: 'harness/specs/tasks/agent-engineering-acceptance-orchestrator.md', data: { ...specData, deferredProfiles: undefined }, body: '' },
      specPath: 'harness/specs/tasks/agent-engineering-acceptance-orchestrator.md',
      changedPaths,
      runId: 'defer-base',
      createdAt: '2026-09-21T00:00:00.000Z',
    });
    // Baseline (no deferral): UI + release coverage pulls in those gates.
    expect(base.requiredProfiles).toEqual(expect.arrayContaining(['e2e', 'release']));
    expect(base.gates.map((g) => g.id)).toEqual(expect.arrayContaining(['electron-e2e', 'release-baseline-validate']));

    const deferred = createAcceptancePlan({
      spec: { path: 'harness/specs/tasks/agent-engineering-acceptance-orchestrator.md', data: specData, body: '' },
      specPath: 'harness/specs/tasks/agent-engineering-acceptance-orchestrator.md',
      changedPaths,
      runId: 'defer-applied',
      createdAt: '2026-09-21T00:00:00.000Z',
    });
    // Deferred: profiles stripped from THIS node, recorded with owner+reason.
    expect(deferred.requiredProfiles).not.toContain('e2e');
    expect(deferred.requiredProfiles).not.toContain('release');
    expect(deferred.gates.map((g) => g.id)).not.toContain('electron-e2e');
    expect(deferred.gates.map((g) => g.id)).not.toContain('release-baseline-validate');
    expect(deferred.deferredProfiles).toEqual([
      { profile: 'e2e', owner: 'TF-0041', reason: 'full UI suite owned by the release-freeze node' },
      { profile: 'release', owner: 'TF-0041', reason: 'release packaging owned by TF-0041' },
    ]);
    expect(validateAcceptanceManifest(deferred)).toEqual({ ok: true, errors: [] });
  });

  it('rejects a deferred profile with no owner, a core profile deferral, or a lingering deferred gate', () => {
    const changedPaths = ['src/components/Settings.tsx'];
    const manifest = createAcceptancePlan({
      spec: {
        path: 'harness/specs/tasks/agent-engineering-acceptance-orchestrator.md',
        data: {
          id: 'fixture-deferral-2', title: 'x', requiredRules: [], requiredTests: [],
          deferredProfiles: { e2e: 'TF-0041 :: reason' },
        },
        body: '',
      },
      specPath: 'harness/specs/tasks/agent-engineering-acceptance-orchestrator.md',
      changedPaths,
      runId: 'defer-bad',
      createdAt: '2026-09-21T00:00:00.000Z',
    });
    // Ownerless deferral is rejected.
    const noOwner = { ...manifest, deferredProfiles: [{ profile: 'e2e', owner: '', reason: 'x' }] };
    expect(validateAcceptanceManifest(noOwner).errors).toEqual(
      expect.arrayContaining([expect.stringContaining('must name an owner node')]),
    );
    // Core profile cannot be deferred.
    const coreDefer = { ...manifest, deferredProfiles: [{ profile: 'fast', owner: 'TF-0041', reason: 'x' }] };
    expect(validateAcceptanceManifest(coreDefer).errors).toEqual(
      expect.arrayContaining([expect.stringContaining('core profile and cannot be deferred')]),
    );
    // A gate belonging to a deferred profile must not linger in the manifest.
    const lingering = {
      ...manifest,
      deferredProfiles: [{ profile: 'e2e', owner: 'TF-0041', reason: 'x' }],
      gates: [...manifest.gates, { id: 'electron-e2e', profile: 'e2e', required: true, allowSkip: false, command: 'pnpm', args: ['run', 'test:e2e'], safety: { network: 'none', productionEffects: false, humanEvidence: false } }],
    };
    expect(validateAcceptanceManifest(lingering).errors).toEqual(
      expect.arrayContaining([expect.stringContaining('belongs to deferred profile e2e')]),
    );
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
    const unsafeGate = unsafe.gates.find((gate) => gate.id === 'fixture-gate')!;
    unsafeGate.allowSkip = true;
    unsafeGate.args = ['--fix'];
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
    for (const checkout of [lfCheckout, crlfCheckout]) {
      for (const input of manifest.source.provisionCopies ?? []) {
        mkdirSync(join(checkout, input.path!, '..'), { recursive: true });
        writeFileSync(join(checkout, input.path!), readFileSync(join(root, input.path!)));
      }
    }

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

  it('rejects rehashed reports whose persisted logs contradict their test counts', () => {
    const root = createFixtureRepository();
    const outputDir = mkdtempSync(join(tmpdir(), 'agent-acceptance-output-'));
    temporaryPaths.push(outputDir);
    const manifest = createManifest(root);
    const env = { PATH: process.env.PATH ?? '' };
    const executor = runAcceptance(manifest, { sourceRoot: root, outputDir, actor: 'executor', env, spawn: passingSpawn });
    expect(validateExecutorEvidence(manifest, executor, outputDir)).toEqual([]);
    const originalGate = executor.gates.find(({ id }) => id === 'integration')!;
    const originalLogs = originalGate.logs as Record<string, string>;
    const stdout = readFileSync(join(outputDir, originalLogs.stdout), 'utf8');

    for (const changedLogs of [
      { stdout: 'Tests 1 passed | 1 skipped (2)\n', stderr: '', source: 'parsed' },
      { stdout, stderr: 'Tests 1 failed (1)\n', source: 'parsed' },
      { stdout: 'completed without a test summary\n', stderr: '', source: 'parsed' },
      { stdout: '{"result":"pass"}\n', stderr: '', source: 'adapter-report' },
    ]) {
      const forged = structuredClone(executor);
      const gate = forged.gates.find(({ id }) => id === 'integration')!;
      (gate.testCounts as Record<string, unknown>).source = changedLogs.source;
      const logs = gate.logs as Record<string, string>;
      for (const stream of ['stdout', 'stderr'] as const) {
        writeFileSync(join(outputDir, logs[stream]), changedLogs[stream], 'utf8');
        logs[`${stream}Sha256`] = sha256(changedLogs[stream]);
        gate[`${stream}Sha256`] = logs[`${stream}Sha256`];
        gate[`${stream}Bytes`] = Buffer.byteLength(changedLogs[stream]);
      }
      // Re-sign every documented contract field: the rejection must come
      // from the log/count mismatch, not a stale hash left by the test.
      const contractFields = [
        'id', 'profile', 'name', 'command', 'args', 'status', 'exitCode', 'timedOut',
        'required', 'allowSkip', 'timeoutMs', 'safety', 'testExpectation', 'testCounts', 'logs',
      ];
      Object.assign(forged, {
        gateContractDigest: sha256(stableJson(forged.gates.map((result) =>
          Object.fromEntries(contractFields.map((key) => [key, result[key]]))))),
      });
      forged.reportDigest = digestReport(forged);
      expect(validateExecutorEvidence(manifest, forged, outputDir)).toEqual([
        'integration: persisted log test counts do not match the report',
      ]);

      const spawn = vi.fn(passingSpawn);
      const verifier = verifyAcceptance(manifest, {
        sourceRoot: root, outputDir, actor: 'verifier', env, executorReport: forged, spawn,
      });
      expect(verifier).toMatchObject({ result: 'NO-GO', engineeringAcceptedByAgent: false });
      expect(verifier.gates).toEqual([]);
      expect(spawn).not.toHaveBeenCalled();
    }
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
    expect(skipped.gates.find((gate) => gate.id === 'fixture-test-gate')?.testCounts).toMatchObject({ passed: 1, skipped: 1, total: 2 });
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
    expect(validateExecutorEvidence(manifest, result, outputDir)).toEqual([]);
    const verifier = verifyAcceptance(manifest, {
      sourceRoot: root, outputDir, actor: 'verifier', env: { PATH: process.env.PATH ?? '' },
      executorReport: result, spawn: adapterSpawn,
    });
    expect(verifier).toMatchObject({ result: 'pass', engineeringAcceptedByAgent: true });

    const missing = structuredClone(result);
    missing.controlledArtifacts = missing.controlledArtifacts?.filter((artifact) => artifact.kind !== 'adapter-evidence');
    missing.reportDigest = digestReport(missing);
    expect(validateExecutorEvidence(manifest, missing, outputDir).join('\n')).toContain('required adapter evidence');

    const changed = structuredClone(result);
    const artifact = changed.controlledArtifacts!.find((entry) => entry.kind === 'adapter-evidence')!;
    const payload = tf0009Report();
    payload.runs[0].result = 'fail';
    writeFileSync(join(outputDir, String(artifact.path)), JSON.stringify(payload));
    artifact.sha256 = sha256File(join(outputDir, String(artifact.path)));
    const adapter = changed.gates.find(({ id }) => id === 'tf0009-agent-surrogate')!.adapterEvidence as Record<string, unknown>;
    adapter.reportSha256 = artifact.sha256;
    changed.reportDigest = digestReport(changed);
    expect(validateExecutorEvidence(manifest, changed, outputDir).join('\n')).toContain('adapter report invalid');
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
    missingArtifactRecord.controlledArtifacts = (missingArtifactRecord.controlledArtifacts ?? []).filter(
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

  // Required-test gates declare a commandLine; spawnGate records the resolved
  // command as commandLine ?? command. Evidence validation must compare against
  // that effective command, not the manifest's raw null command field, or a
  // legitimately recorded commandLine gate is rejected as a contract mismatch.
  it('accepts commandLine required-test gates and still rejects a tampered command', () => {
    const root = createFixtureRepository();
    const outputDir = mkdtempSync(join(tmpdir(), 'agent-acceptance-commandline-'));
    temporaryPaths.push(outputDir);
    const gate = {
      id: 'required-test-1',
      name: 'Required test 1 (spec requiredTests)',
      profile: 'required-tests',
      commandLine: 'node scripts/fixture-required-test.mjs --flag value',
      command: null,
      args: [],
      required: true,
      allowSkip: false,
      timeoutMs: 1_000,
      safety: { network: 'none', productionEffects: false, humanEvidence: false },
    };
    const manifest = createManifest(root, { gate });
    const passing = runAcceptance(manifest, {
      sourceRoot: root,
      outputDir,
      actor: 'executor',
      env: { PATH: process.env.PATH ?? '' },
      spawn: passingSpawn,
    });
    expect(passing).toMatchObject({ result: 'pass', engineeringAcceptedByAgent: false });
    const requiredResult = passing.gates.find((gate) => gate.id === 'required-test-1')!;
    expect(requiredResult.command).toBe('node scripts/fixture-required-test.mjs --flag value');
    expect(requiredResult.args).toEqual([]);
    expect(validateReportEvidence(manifest, passing, outputDir, {
      expectedRole: 'executor',
      label: 'executor report',
    })).toEqual([]);
    const tampered = structuredClone(passing);
    tampered.gates.find((gate) => gate.id === 'required-test-1')!.command = 'node scripts/other.mjs';
    tampered.reportDigest = digestReport(tampered);
    expect(validateReportEvidence(manifest, tampered, outputDir, {
      expectedRole: 'executor',
      label: 'executor report',
    })).toContain('executor report gate command mismatch: required-test-1');
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

    const inOrderGates = { ...baseReport, gates: twoGateManifest.gates.map(({ id }) => ({ id, result: 'pass' })) };
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
    if (!harnessGate) throw new Error('Expected harness gate');
    expect(harnessGate.args).toContain('--since');
    expect(harnessGate.args[harnessGate.args.indexOf('--since') + 1]).toBe(repositoryIdentity(root).commit);
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
    const withDigest = (report: Record<string, unknown>) => {
      const copy: Record<string, unknown> = { ...report, reportDigest: undefined };
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
    const withDigest = (report: Record<string, unknown>) => {
      const copy: Record<string, unknown> = { ...report, reportDigest: undefined };
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
      expect(manifest.baseRef).toBe(gitText(process.cwd(), ['rev-parse', 'HEAD^']));

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

  it('reproduces a real fixture gate in separate worktrees with simulated baseline steps', () => {
    // The selected Node gate executes for real; fixtureOptions simulates the
    // unrelated install/build gates. This proves the protocol, not RC-00 acceptance.
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
    expect(executor.gates.find((gate) => gate.id === 'fixture-real-gate')?.testCounts).toMatchObject({ passed: 1, failed: 0, skipped: 0, total: 1 });
    // Logs are redacted: the fixture output dir must not leak into the log.
    const logText = readFileSync(join(outputDir, 'logs', 'fixture-real-gate.stdout.log'), 'utf8');
    expect(logText).not.toContain(tmpdir());

    // The Verifier role reruns the same fixture manifest in a second worktree.
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

    // A second fixture reproduction: a fresh output dir, same manifest, same
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

  it('rejects the standalone abbreviated RC-00 bootstrap before any command runs', () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'rc00-bootstrap-test-'));
    temporaryPaths.push(outputDir);

    execFileSync(
      process.execPath,
      ['scripts/rc00-acceptance-bootstrap.mjs', outputDir],
      { cwd: process.cwd(), encoding: 'utf8' },
    );

    const finalReport = JSON.parse(readFileSync(join(outputDir, 'verifier-report.json'), 'utf8'));
    expect(finalReport).toMatchObject({
      result: 'NO-GO',
      engineeringAcceptedByAgent: false,
      role: 'verifier',
      executorActor: 'rc00-executor',
      verifierActor: 'rc00-verifier',
    });
    expect(finalReport.failures).toContain('manifest gates must match the candidate-derived gate contracts');
    expect(finalReport.gates).toEqual([]);
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
    mkdirSync(outputDir, { recursive: true });
    const manifestPath = join(outputDir, 'manifest.json');

    // RC-09: the validator requires the changed-path ownership matrix in the
    // final evidence bundle; the fixture writes a valid v2 partition for its paths.
    const finalEvidenceDir = join(root, 'artifacts', 'agent-engineering-acceptance', 'runtime-authority-convergence-final');
    mkdirSync(finalEvidenceDir, { recursive: true });
    const fixtureChangedPaths = resolveChangedPaths(root, { since: base });
    writeFileSync(join(finalEvidenceDir, 'changed-path-ownership.json'), `${JSON.stringify({
      schema: 'runtime-authority-convergence-rc09-ownership/v2',
      baseSha: base,
      headSha: repositoryIdentity(root).commit,
      requiredOwners: ['RC-00'],
      requiredSpecs: ['harness/specs/tasks/rc00-agent-engineering-acceptance-bootstrap.md'],
      totalPaths: fixtureChangedPaths.length,
      rcOwnedPaths: fixtureChangedPaths.length,
      excludedPaths: 0,
      byRc: { 'RC-00': fixtureChangedPaths.length },
      byExclusionWorkstream: {},
      entries: fixtureChangedPaths.map((pathValue) => ({ path: pathValue, rc: 'RC-00', commit: null, declaredBySpec: true })),
    }, null, 2)}\n`, 'utf8');
    // The ownership report is a locked ignored input. Freeze it before planning.
    Object.assign(manifest, createAcceptancePlan({ root, specPath: manifest.task.specPath, since: base, runId: manifest.runId, createdAt: manifest.createdAt }));
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
    tamperedReport.gates.find((gate) => gate.id === 'fixture-validator-gate')!.command = 'echo';
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
    sourceTamper.source.files.find(({ path }) => path === 'package.json')!.gitBlob = '0'.repeat(40);
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

    // RC-09: a missing ownership matrix must fail closed.
    const matrixPath = join(root, 'artifacts', 'agent-engineering-acceptance', 'runtime-authority-convergence-final', 'changed-path-ownership.json');
    const movedMatrix = join(root, 'artifacts', 'agent-engineering-acceptance', 'runtime-authority-convergence-final', 'changed-path-ownership.moved.json');
    writeFileSync(movedMatrix, readFileSync(matrixPath, 'utf8'));
    rmSync(matrixPath, { force: true });
    const missingMatrix = validateRuntimeAuthorityConvergence({
      root,
      phase: 'engineering',
      manifestPath,
      engineeringReportPath: reportPath,
      baselinePath: baselineRelative,
    });
    expect(missingMatrix.errors).toContain('changed-path-ownership.json is missing from the final evidence bundle');
    writeFileSync(matrixPath, readFileSync(movedMatrix, 'utf8'));

    const tamperMatrix = (mutate: (matrix: Record<string, unknown>) => void) => {
      const tampered = structuredClone(JSON.parse(readFileSync(matrixPath, 'utf8')));
      mutate(tampered);
      writeFileSync(matrixPath, `${JSON.stringify(tampered, null, 2)}\n`, 'utf8');
      const result = validateRuntimeAuthorityConvergence({
        root,
        phase: 'engineering',
        manifestPath,
        engineeringReportPath: reportPath,
        baselinePath: baselineRelative,
      });
      writeFileSync(matrixPath, readFileSync(movedMatrix, 'utf8'));
      return result;
    };

    // RC-09: an ownership matrix that drops a manifest changed path must fail closed.
    const tamperedOwner = tamperMatrix((matrix) => {
      matrix.entries = [];
    });
    expect(tamperedOwner.errors.some((error) => error.startsWith('changed path is missing from changed-path-ownership.json'))).toBe(true);

    // RC-09: a matrix that claims the old schema version must fail closed.
    expect(tamperMatrix((matrix) => {
      matrix.schema = 'runtime-authority-convergence-rc09-ownership/v1';
    }).errors).toContain('changed-path-ownership.json schema mismatch');

    // RC-09: the matrix must be bound to the manifest base commit.
    expect(tamperMatrix((matrix) => {
      matrix.baseSha = '0'.repeat(40);
    }).errors).toContain('changed-path-ownership.json is not bound to the manifest base commit');

    // RC-09: a malformed headSha must fail closed.
    expect(tamperMatrix((matrix) => {
      matrix.headSha = 'not-a-sha';
    }).errors).toContain('changed-path-ownership.json headSha is missing or malformed');

    // RC-09: a headSha outside the candidate's ancestry must fail closed. The
    // matrix is generated from diff(base..headSha) and committed inside the
    // candidate, so headSha may only be the candidate or one of its ancestors.
    expect(tamperMatrix((matrix) => {
      matrix.headSha = '1'.repeat(40);
    }).errors).toContain('changed-path-ownership.json headSha is not an ancestor of the candidate commit');

    // RC-09: an owner outside the required owner set must fail closed.
    expect(tamperMatrix((matrix) => {
      const entries = matrix.entries as Array<Record<string, unknown>>;
      entries[0].rc = 'RC-10';
      matrix.byRc = { 'RC-00': entries.length - 1, 'RC-10': 1 };
    }).errors.some((error) => error.startsWith('changed path owned by a package outside the required owner set'))).toBe(true);

    // RC-09: an excluded path with no introducing commit must fail closed.
    expect(tamperMatrix((matrix) => {
      const entries = matrix.entries as Array<Record<string, unknown>>;
      entries[0].rc = null;
      entries[0].excluded = { workstream: 'chore(assets)' };
      matrix.rcOwnedPaths = entries.length - 1;
      matrix.excludedPaths = 1;
      matrix.byRc = { 'RC-00': entries.length - 1 };
      matrix.byExclusionWorkstream = { 'chore(assets)': 1 };
    }).errors.some((error) => error.startsWith('changed-path-ownership.json has an unattributed entry'))).toBe(true);

    // RC-09: a valid exclusion that names its introducing commit is accepted.
    // The manifest is sealed against the original matrix bytes, so the run may
    // still report the provision-copy digest drift — but never an ownership error.
    const excludedMatrix = tamperMatrix((matrix) => {
      const entries = matrix.entries as Array<Record<string, unknown>>;
      entries[0].rc = null;
      entries[0].excluded = { commit: base, subject: 'chore(assets): fixture', workstream: 'chore(assets)' };
      matrix.rcOwnedPaths = entries.length - 1;
      matrix.excludedPaths = 1;
      matrix.byRc = { 'RC-00': entries.length - 1 };
      matrix.byExclusionWorkstream = { 'chore(assets)': 1 };
    });
    expect(excludedMatrix.errors.some((error) => /outside the required owner set|unattributed entry|missing from changed-path-ownership/u.test(error))).toBe(false);

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
  }, 60_000);

  it('sums every Tests summary segment instead of taking the largest single count', () => {
    const stdout = [
      ' Test Files  823 passed | 3 skipped (826)',
      '      Tests  7309 passed | 53 skipped (7362)',
      ' Test Files  3 passed (3)',
      '      Tests  12 passed (12)',
      ' Test Files  40 passed (40)',
      '      Tests  452 passed | 1 skipped (453)',
    ].join('\n');
    expect(parseTestCounts(stdout)).toEqual({
      passed: 7773,
      failed: 0,
      skipped: 54,
      total: 7827,
      source: 'parsed',
      segments: 3,
    });
  });

  it.each([
    ['pnpm exec eslint tests/unit/example.test.ts', false],
    ['git diff --check -- tests/unit/example.test.ts', false],
    ['pnpm exec eslint vitest.config.ts', false],
    ['pnpm exec eslint scripts/run-vitest.mjs', false],
    ['pnpm exec eslint node_modules/vitest/vitest.mjs', false],
    ['pnpm --dir resources/verseshell-mcp test', true],
    ['pnpm -C "resources/with spaces" test', true],
    ['pnpm --filter @scope/package run test', true],
    ['pnpm --dir=resources/verseshell-mcp test', true],
    ['npm --prefix resources/verseshell-mcp test', true],
    ['pnpm -w test', true],
    ['node --test scripts/example.test.mjs', true],
    ['node node_modules/vitest/vitest.mjs run tests/unit/example.test.ts', true],
    ['pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.agents.config.ts', true],
    ['pnpm exec playwright test tests/e2e/example.spec.ts', true],
    ['tests/unit/example.test.ts', true],
  ])('classifies actual test execution: %s', (commandLine, expected) => {
    expect(isCountableTestCommand(null, [], commandLine)).toBe(expected);
  });

  it.each([
    ['Tests 2 passed (2)\nTests 1 failed (1)', { passed: 2, failed: 1, skipped: 0, total: 3 }],
    ['Tests 2 passed (2)\nTests 3 skipped (3)', { passed: 2, failed: 0, skipped: 3, total: 5 }],
    ['Tests 2 passed | 1 todo (3)', { passed: 2, failed: 0, skipped: 1, total: 3 }],
    ['  1 failed\n  2 skipped\n  4 passed (12.3s)\n', { passed: 4, failed: 1, skipped: 2, total: 7 }],
    ['# tests 4\n# pass 2\n# fail 1\n# skipped 1\n# todo 0\n', { passed: 2, failed: 1, skipped: 1, total: 4 }],
  ])('counts every outcome in the runner summary: %s', (stdout, expected) => {
    expect(parseTestCounts(stdout)).toMatchObject(expected);
  });

  it('rejects a malformed summary instead of silently discarding its missing tests', () => {
    expect(parseTestCounts('Tests 2 passed (2)\nTests 1 passed | 1 skipped (4)')).toBeNull();
  });

  it.each(['"--fix"', '--fix=true', "'--no-diff'", '--fix&&true'])('rejects executable forbidden argument spellings: %s', (argument) => {
    const root = createFixtureRepository();
    const manifest = createManifest(root);
    const gate = manifest.gates.find(({ id }) => id === 'fixture-gate')!;
    gate.commandLine = `pnpm exec eslint . ${argument}`;
    resealManifest(manifest);
    expect(validateAcceptanceManifest(manifest).ok).toBe(false);
  });

  it('rejects requiredTests that drift from the candidate spec or hide --fix in commandLine', () => {
    const root = createFixtureRepository();
    const comparisonBase = repositoryIdentity(root).commit;
    writeFileSync(join(root, 'harness', 'specs', 'tasks', 'fixture.md'), `---
id: fixture-task
title: Fixture task
diffBase: ${comparisonBase}
requiredTests:
  - pnpm exec vitest run tests/unit/example.test.ts
  - pnpm exec eslint tests/unit/example.test.ts
  - pnpm --dir resources/verseshell-mcp test
  - node node_modules/vitest/vitest.mjs run tests/unit/example.test.ts
---
# fixture
`, 'utf8');
    const copyFiles = [
      'artifacts/uas-06-single-local-exec-canary/live-observations.json',
      'artifacts/unified-agent-system/TF-0011/audit-manifest.json',
      'artifacts/agent-engineering-acceptance/runtime-authority-convergence-final/changed-path-ownership.json',
      'openclaw_runtime/apps/shared/OpenClawKit/Sources/OpenClawKit/Resources/tool-display.json',
    ];
    for (const relative of copyFiles) {
      const full = join(root, ...relative.split('/'));
      mkdirSync(join(full, '..'), { recursive: true });
      writeFileSync(full, '{"fixture":true}\n', 'utf8');
    }
    git(root, ['add', 'harness/specs/tasks/fixture.md', '.gitignore']);
    git(root, ['commit', '--quiet', '-m', 'spec requiredTests']);
    const plan = createAcceptancePlan({
      root,
      specPath: 'harness/specs/tasks/fixture.md',
      since: 'HEAD^',
      runId: 'fixture-required-bind',
      createdAt: '2026-07-31T00:00:00.000Z',
    });
    expect(plan.gates.find((gate) => gate.id === 'required-test-1')?.testExpectation).toEqual({
      requireCounts: true,
      expectedSkips: 0,
    });
    expect(plan.gates.find((gate) => gate.id === 'required-test-2')?.testExpectation).toBeUndefined();
    expect(plan.gates.find((gate) => gate.id === 'required-test-3')?.testExpectation).toEqual({
      requireCounts: true, expectedSkips: 0,
    });
    expect(plan.gates.find((gate) => gate.id === 'required-test-4')?.testExpectation).toEqual({
      requireCounts: true, expectedSkips: 0,
    });
    expect(plan.gates.find((gate) => gate.id === 'provision-verseshell-resources')?.copyInputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'artifacts/uas-06-single-local-exec-canary/live-observations.json',
          exists: true,
          bytes: expect.any(Number),
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        }),
      ]),
    );
    expect(validateAcceptanceManifest(plan, { root, requireClean: true, requireFull: true })).toEqual({ ok: true, errors: [] });
    expect(() => createAcceptancePlan({
      root,
      specPath: plan.task.specPath,
      since: plan.candidate.commit,
    })).toThrow('comparison base must match the candidate task spec diffBase');
    const rebased = structuredClone(plan);
    rebased.baseRef = plan.candidate.commit;
    rebased.changedPaths = [];
    const harnessGate = rebased.gates.find(({ id }) => id === 'harness-validate')!;
    harnessGate.args[harnessGate.args.indexOf('--since') + 1] = plan.candidate.commit;
    resealManifest(rebased);
    expect(validateAcceptanceManifest(rebased, { root, requireClean: true, requireFull: true }).errors.join('\n')).toContain(
      'comparison base must match the candidate task spec diffBase',
    );

    const omitted = structuredClone(plan);
    omitted.gates = omitted.gates.filter((gate) => gate.id !== 'fast-unit-tests');
    resealManifest(omitted);
    expect(validateAcceptanceManifest(omitted, { root, requireClean: true, requireFull: true }).errors).toContain(
      'manifest gates must match the candidate-derived gate contracts',
    );
    const withoutBase = structuredClone(plan);
    withoutBase.baseRef = null;
    resealManifest(withoutBase);
    expect(validateAcceptanceManifest(withoutBase, { root, requireClean: true, requireFull: true }).errors).toContain(
      'formal acceptance requires a comparison base, not only explicit changed paths',
    );
    for (const mutate of [
      (value: AcceptanceManifest) => { value.gates.reverse(); },
      (value: AcceptanceManifest) => { value.gates.find(({ id }) => id === 'fast-unit-tests')!.commandLine = 'node -e "process.exit(0)"'; },
      (value: AcceptanceManifest) => { value.gates.find(({ id }) => id === 'fast-unit-tests')!.testExpectation = { requireCounts: true, expectedSkips: 54 }; },
      (value: AcceptanceManifest) => { value.gates.find(({ id }) => id === 'required-test-1')!.timeoutMs = 1; },
      (value: AcceptanceManifest) => { value.source.files = value.source.files.filter(({ path }) => path !== 'harness/src/profiles.mjs'); },
      (value: AcceptanceManifest) => { value.source.lockFiles = []; },
      (value: AcceptanceManifest) => { value.changedPaths = []; },
      (value: AcceptanceManifest) => { value.requiredProfiles = []; },
    ]) {
      const changed = structuredClone(plan);
      mutate(changed);
      resealManifest(changed);
      expect(validateAcceptanceManifest(changed, { root, requireClean: true, requireFull: true }).ok).toBe(false);
    }

    const drifted = structuredClone(plan);
    drifted.task.requiredTests[0] = 'pnpm exec eslint . --fix';
    const requiredGate = drifted.gates.find((gate) => gate.id === 'required-test-1');
    if (!requiredGate) throw new Error('expected required-test-1');
    requiredGate.commandLine = drifted.task.requiredTests[0];
    delete requiredGate.testExpectation;
    drifted.planDigest = digestPlan(drifted);
    drifted.manifestDigest = digestManifest(drifted);
    expect(validateAcceptanceManifest(drifted, { root, requireClean: true, requireFull: true }).errors).toEqual(
      expect.arrayContaining([
        'manifest requiredTests must match the candidate task spec requiredTests',
        'required-test-1: forbidden argument --fix',
      ]),
    );

    writeFileSync(join(root, ...copyFiles[0].split('/')), '{"tampered":true}\n', 'utf8');
    expect(validateAcceptanceManifest(plan, { root, requireClean: true, requireFull: true }).errors).toEqual(
      expect.arrayContaining([
        'provision-verseshell-resources: provision copy digest mismatch: artifacts/uas-06-single-local-exec-canary/live-observations.json',
      ]),
    );
  });

  it('runs required-test gates in the detached worktree rather than the source root', () => {
    const root = createFixtureRepository();
    const outputDir = mkdtempSync(join(tmpdir(), 'agent-acceptance-required-cwd-'));
    temporaryPaths.push(outputDir);
    const commandLine = 'node scripts/fixture-required-test.mjs --flag value';
    writeFileSync(join(root, 'harness', 'specs', 'tasks', 'fixture.md'), `---
id: fixture-task
requiredTests:
  - ${commandLine}
---
# fixture
`, 'utf8');
    git(root, ['add', 'harness/specs/tasks/fixture.md']);
    git(root, ['commit', '--quiet', '-m', 'required-test spec']);
    const gate = {
      id: 'required-test-1',
      name: 'Required test 1 (spec requiredTests)',
      profile: 'required-tests',
      commandLine,
      command: null,
      args: [],
      required: true,
      allowSkip: false,
      timeoutMs: 1_000,
      kind: 'required-test',
      safety: { network: 'none', productionEffects: false, humanEvidence: false },
    };
    const manifest = createManifest(root, { gate });
    manifest.task.requiredTests = [commandLine];
    resealManifest(manifest);
    const cwds: string[] = [];
    const result = runAcceptance(manifest, {
      sourceRoot: root,
      outputDir,
      actor: 'executor',
      env: { PATH: process.env.PATH ?? '' },
      spawn: (_command: string, _args: string[], options: { cwd?: string } = {}) => {
        cwds.push(String(options.cwd ?? ''));
        return { status: 0, signal: null, stdout: 'Tests 1 passed (1)\n', stderr: '' };
      },
    });
    expect({ result: result.result, failures: result.failures }).toEqual({ result: 'pass', failures: [] });
    expect(cwds).toHaveLength(1);
    expect(cwds[0]).not.toBe(root);
    expect(cwds[0].replaceAll('\\', '/')).toMatch(/clawx-agent-acceptance-[^/]+\/checkout$/u);
  });

  it('points the Electron E2E evidence root outside the detached worktree', () => {
    const root = createFixtureRepository();
    const outputDir = mkdtempSync(join(tmpdir(), 'agent-acceptance-e2e-evidence-'));
    temporaryPaths.push(outputDir);
    const gate = {
      id: 'electron-e2e',
      name: 'Electron end-to-end tests',
      profile: 'e2e',
      command: 'node',
      args: ['-e', 'process.exit(0)'],
      required: true,
      allowSkip: false,
      timeoutMs: 1_000,
      safety: { network: 'isolated', productionEffects: false, humanEvidence: false },
    };
    const manifest = createManifest(root, { gate });
    const seen: { cwd: string; evidenceRoot: string }[] = [];
    const result = runAcceptance(manifest, {
      sourceRoot: root,
      outputDir,
      actor: 'executor',
      env: { PATH: process.env.PATH ?? '' },
      spawn: (
        _command: string,
        _args: string[],
        options: { cwd?: string; env?: Record<string, string | undefined> } = {},
      ) => {
        seen.push({
          cwd: String(options.cwd ?? ''),
          evidenceRoot: String(options.env?.CLAWX_E2E_EVIDENCE_ROOT ?? ''),
        });
        return { status: 0, signal: null, stdout: 'Tests 1 passed (1)\n', stderr: '' };
      },
    });
    expect({ result: result.result, failures: result.failures }).toEqual({ result: 'pass', failures: [] });
    expect(seen).toHaveLength(1);
    // The suite publishes reviewable PNG/evidence artifacts; the acceptance
    // requires the detached worktree to stay byte-clean, so the redirected root
    // must exist and must not live inside the candidate checkout.
    const evidenceRoot = seen[0].evidenceRoot.replaceAll('\\', '/');
    const cwd = seen[0].cwd.replaceAll('\\', '/');
    expect(evidenceRoot).toMatch(/clawx-e2e-evidence\/fixture-run$/u);
    expect(evidenceRoot.startsWith(cwd)).toBe(false);
  });

});
