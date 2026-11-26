import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getHeapStatistics } from 'node:v8';
import { gzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { createStdioTasks } from '../../scripts/lib/rsi-stdio-tasks.mjs';
import { NATIVE_CHECKER_PROFILE } from '../../scripts/lib/rsi-native-checker.mjs';
import { prepareStdioGradeWorkspace, resolveHistoricalTask, runLiveTaskOracles } from '../../scripts/lib/rsi-live-grader.mjs';
import { calibrateLibraryChecker, calibrationRegistryBinding, loadCalibrationInputs } from '../../scripts/rsi-library-checker-calibrate.mjs';
import { verifyStdioOracleReport } from '../../scripts/lib/rsi-semantic-study.mjs';

const ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const put = (directory: string, name: string, value: unknown) => writeFileSync(join(directory, name), JSON.stringify(value));
const base = process.platform === 'win32' ? 'D:/tmp' : tmpdir();
mkdirSync(base, { recursive: true });
const temporary = () => mkdtempSync(join(base, 'rsi-supplemental-calibration-'));
const sourceNames = ['scripts/rsi-library-checker-calibrate.mjs', 'scripts/lib/rsi-native-checker.mjs',
  'scripts/lib/rsi-isolated-python.mjs', 'scripts/rsi-isolated-python-worker.py', 'scripts/rsi-native-checker-worker.py',
  'scripts/rsi-native-checker-replay.py', 'scripts/rsi-isolated-python-replay.py'];

function inputsFixture() {
  const inputs = temporary(), selected = { familyId: 'prospective-agent-fixture', sourceKey: 'supplemental:agent-fixture',
    caseId: 'supplemental-0123456789abcdef', familyOrder: 0, sourceOrder: 0 };
  const plan = { schemaVersion: 'RsiSupplementalMeasurementPlan/v1', driven_by: 'agent', realHumanEvidence: false,
    modelRequests: 0, usage: 'scripted-control', pythonVersion: 'Python 3.10.12',
    calibrationSchemaVersion: 'RsiSupplementalCalibrationBatch/v1', minimumSystemAvailableBytes: 3221225472,
    sourceFilesSha256: Object.fromEntries(sourceNames.map(name => [name, '1'.repeat(64)])), selectedSources: [selected] };
  const prepared = { schemaVersion: 'RsiSupplementalMeasurementInputs/v1', modelRequests: 0, formalAdmission: false,
    planSha256: '', cases: [{ ...selected, problem: selected.caseId, path: selected.caseId + '.json.gz',
      sha256: '2'.repeat(64), packDigest: '3'.repeat(64), referenceSha256: '4'.repeat(64), vectors: 5 }] };
  put(inputs, 'plan.json', plan); prepared.planSha256 = digest(readFileSync(join(inputs, 'plan.json')));
  put(inputs, 'report.json', prepared);
  return { inputs, plan, prepared };
}

function freezeFixtureExecutor(plan: ReturnType<typeof inputsFixture>['plan']) {
  const root = temporary();
  for (const name of sourceNames) {
    const content = name.endsWith('replay.py') || name.endsWith('worker.py') ? readFileSync(join(ROOT, name))
      : Buffer.from('Agent fixture source; never executed.');
    mkdirSync(join(root, name, '..'), { recursive: true }); writeFileSync(join(root, name), content);
    plan.sourceFilesSha256[name] = digest(content);
  }
  const git = (args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git(['init', '--quiet']); git(['config', 'core.autocrlf', 'false']); git(['add', '.']);
  git(['-c', 'core.autocrlf=false', '-c', 'user.name=RSI fixture', '-c', 'user.email=rsi-fixture@example.invalid',
    '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'Freeze agent-authored offline calibration fixture']);
  Object.assign(plan, { sourceCommit: git(['rev-parse', 'HEAD']), sourceTree: git(['rev-parse', 'HEAD^{tree}']), nodeVersion: process.version });
  return root;
}

const batchMarker = (context: Record<string, any>) => ({ schemaVersion: 'RsiSupplementalCalibrationBatch/v1', driven_by: 'agent',
  actor: 'codex/rsi-library-checker-calibration', realHumanEvidence: false, modelRequests: 0,
  usage: 'scripted-control', formalAdmission: false, benefit: 'NO_GO', adoption: 'hold',
  planSha256: context.planSha256, inputsSha256: context.inputsSha256, sourceCommit: context.plan.sourceCommit,
  nodeOldSpaceMiB: 384, nodeHeapLimitBytes: getHeapStatistics().heap_size_limit });

async function settledFixture(compileFailure = false, pendingAlternative = false) {
  const { inputs, plan, prepared } = inputsFixture(), root = freezeFixtureExecutor(plan);
  if (pendingAlternative) {
    const selected = { ...plan.selectedSources[0], caseId: 'supplemental-fedcba9876543210', sourceKey: 'supplemental:pending-fixture', sourceOrder: 1 };
    plan.selectedSources.push(selected);
    prepared.cases.push({ ...prepared.cases[0], ...selected, problem: selected.caseId, path: selected.caseId + '.json.gz' });
  }
  const selected = plan.selectedSources[0], reference = 'import sys\nprint(sys.stdin.read().strip())\n';
  const item = { id: selected.caseId, name: selected.caseId, runtime: 'python3', split: 'validation',
    familyId: selected.familyId, independenceGroup: selected.familyId, reference,
    prompt: 'Agent fixture: read the input and print the same value as a complete Python program.',
    declaration: 'Write a complete Python 3 program.\n', provenance: { sourceId: selected.sourceKey, sourceKey: selected.sourceKey, fixtureOnly: true },
    privatePython: { schemaVersion: 'RsiStdioIsolatedPython/v1', pythonVersion: plan.pythonVersion,
      referenceSha256: digest(reference), profile: NATIVE_CHECKER_PROFILE },
    vectors: [1, 2, 3, 4, 5].map((n, index) => ({ kind: 'stdio', visibility: 'private', input: n + '\n', output: n + '\n', testId: 'v' + index })) };
  const pack = { schemaVersion: 'RsiIndependentCodingCases/v2', datasetVersion: 'RsiSemanticIndependentCases/v2',
    executionKind: 'stdio-program', usage: 'scripted-control', driven_by: 'agent', actor: 'unit/supplemental-calibration',
    realHumanEvidence: false, cases: [item] };
  const encodedPack = JSON.stringify(pack), compressed = gzipSync(encodedPack);
  writeFileSync(join(inputs, prepared.cases[0].path), compressed);
  Object.assign(prepared.cases[0], { sha256: digest(compressed), packDigest: digest(encodedPack), referenceSha256: digest(reference) });
  put(inputs, 'plan.json', plan); prepared.planSha256 = digest(readFileSync(join(inputs, 'plan.json')));
  put(inputs, 'report.json', prepared);
  const output = temporary(), context = await loadCalibrationInputs(root, inputs);
  put(output, 'started.json', batchMarker(context));
  const directory = join(output, '000-' + selected.caseId); mkdirSync(directory);
  const registry = createStdioTasks(directory, pack); put(directory, 'registry.json', registry);
  put(directory, 'started.json', { problem: selected.caseId, packSha256: prepared.cases[0].sha256,
    planSha256: context.planSha256, registrySha256: digest(readFileSync(join(directory, 'registry.json'))), registryCommit: registry.registryCommit });
  const task = resolveHistoricalTask(registry.repository, selected.caseId, { codingCohort: true });
  const binding = await calibrationRegistryBinding(directory, registry, task);
  for (const phase of ['baseline', 'reference', 'no-output'] as const) {
    const workspace = join(directory, phase), outDir = join(directory, phase + '-grade');
    await prepareStdioGradeWorkspace({ root: registry.repository, task, workspace,
      revision: phase === 'baseline' ? task.base : task.ref,
      edits: phase === 'no-output' ? [{ path: task.input.targetScope[0], content: 'pass\n' }] : [] });
    let supportRoot = ROOT;
    if (phase !== 'baseline') {
      // These launch/output records are authored fixtures; no submitted program is executed.
      const code = 'import json,runpy,sys;from pathlib import Path;'
        + 'f=runpy.run_path(sys.argv[1]);r=Path(sys.argv[2]);'
        + 'w,s=f["fixture"](r,compile_failure=sys.argv[3]=="yes",empty_output=sys.argv[4]=="yes");'
        + 'print(json.dumps(f["R"]["replay"](r,w,s)))';
      const report = JSON.parse(execFileSync('python', ['-B', '-c', code, join(ROOT, 'scripts/rsi-isolated-python-test.py'), workspace,
        phase === 'reference' && compileFailure ? 'yes' : 'no', phase === 'no-output' ? 'yes' : 'no'],
      { encoding: 'utf8', env: { ...process.env, TEMP: base, TMP: base, PYTHONIOENCODING: 'utf-8' } }));
      supportRoot = temporary(); mkdirSync(join(supportRoot, 'scripts/lib'), { recursive: true });
      writeFileSync(join(supportRoot, 'scripts/lib/rsi-stdio-oracle.mjs'),
        'import {writeFileSync} from "node:fs";const r=' + JSON.stringify(report)
        + ';writeFileSync("stdio-report.json",JSON.stringify(r));console.log(JSON.stringify(r));process.exitCode=r.passed?0:1;');
    }
    put(directory, phase + '-started.json', { phase, problem: selected.caseId, planSha256: context.planSha256 });
    const grade = await runLiveTaskOracles({ root: ROOT, supportRoot, task, workspace, outDir, timeoutMs: 10000 });
    expect(() => verifyStdioOracleReport({ tasks: [registry.tasks[0]] }, pack, phase,
      { cwd: workspace, exitCode: grade.executions[0].exitCode, signal: null, error: null }, grade.executions[0].report,
      { allowReferenceFailure: compileFailure })).not.toThrow();
    put(outDir, 'grade.json', grade);
    const evidence = join(workspace, 'stdio-python-evidence');
    const evidenceFilesSha256 = !existsSync(evidence) ? {} : Object.fromEntries(readdirSync(evidence, { recursive: true })
      .map(name => String(name).replaceAll('\\', '/')).filter(name => statSync(join(evidence, name)).isFile())
      .map(name => [name, digest(readFileSync(join(evidence, name)))]));
    put(directory, phase + '-receipt.json', { schemaVersion: 'RsiSupplementalCalibrationPhase/v1', driven_by: 'agent',
      actor: 'unit/supplemental-calibration', realHumanEvidence: false, modelRequests: 0, ...binding,
      phase, problem: selected.caseId, planSha256: context.planSha256, packSha256: prepared.cases[0].sha256,
      verdict: phase === 'baseline' ? 'baseline-unimplemented' : phase === 'no-output' ? 'negative-control-rejected'
        : compileFailure ? 'reference-rejected' : 'reference-pass',
      startedSha256: digest(readFileSync(join(directory, phase + '-started.json'))), gradeSha256: digest(readFileSync(join(outDir, 'grade.json'))),
      reportSha256: digest(readFileSync(join(workspace, 'stdio-report.json'))), evidenceFilesSha256,
      logsSha256: [{ stdout: digest(readFileSync(join(outDir, '01-stdout.log'))), stderr: digest(readFileSync(join(outDir, '01-stderr.log'))) }] });
  }
  return { root, inputs, output, directory };
}

describe('supplemental isolated Python calibration', () => {
  it('counts two source alternatives in one whole family without dispatching either', async () => {
    vi.stubEnv('NODE_OPTIONS', '--max-old-space-size=384');
    try {
      const { inputs, plan, prepared } = inputsFixture();
      const selected = { ...plan.selectedSources[0], caseId: 'supplemental-fedcba9876543210', sourceKey: 'supplemental:second-agent-fixture', sourceOrder: 1 };
      plan.selectedSources.push(selected);
      prepared.cases.push({ ...prepared.cases[0], ...selected, problem: selected.caseId, path: selected.caseId + '.json.gz' });
      const root = freezeFixtureExecutor(plan);
      put(inputs, 'plan.json', plan); prepared.planSha256 = digest(readFileSync(join(inputs, 'plan.json'))); put(inputs, 'report.json', prepared);
      const context = await loadCalibrationInputs(root, inputs), output = temporary();
      put(output, 'started.json', batchMarker(context));
      const report = await calibrateLibraryChecker({ root, inputs, output, verifyOnly: true });
      expect(report).toMatchObject({ status: 'resource-paused', plannedFamilies: 1, plannedSources: 2,
        completedFamilies: 0, completedSources: 0, qualifiedFamilies: 0 });
    } finally { vi.unstubAllEnvs(); }
  });

  it('loads the frozen source order and selects the Python batch, phase and evidence protocols', async () => {
    const { inputs } = inputsFixture(), context = await loadCalibrationInputs(inputs, inputs);
    expect(context).toMatchObject({ supplemental: true, selection: ['supplemental-0123456789abcdef'],
      batchVersion: 'RsiSupplementalCalibrationBatch/v1', phaseVersion: 'RsiSupplementalCalibrationPhase/v1',
      evidenceDirectory: 'stdio-python-evidence' });
  });

  it('rejects legacy inputs, missing Python source bindings, interpreter and whole-family order drift', async () => {
    for (const mutation of ['legacy', 'source', 'version', 'family', 'order', 'memory']) {
      const { inputs, plan, prepared } = inputsFixture();
      if (mutation === 'legacy') delete (plan as Record<string, unknown>).pythonVersion;
      if (mutation === 'source') delete plan.sourceFilesSha256['scripts/rsi-isolated-python-replay.py'];
      if (mutation === 'version') Object.assign(plan, { pythonVersion: true });
      if (mutation === 'family') prepared.cases[0].familyId = 'another-family';
      if (mutation === 'order') Object.assign(plan.selectedSources[0], { sourceOrder: true });
      if (mutation === 'memory') plan.minimumSystemAvailableBytes = 1610612736;
      put(inputs, 'plan.json', plan); prepared.planSha256 = digest(readFileSync(join(inputs, 'plan.json'))); put(inputs, 'report.json', prepared);
      await expect(loadCalibrationInputs(inputs, inputs), mutation).rejects.toThrow();
    }
  });

  it('independently replays a complete settled three-phase prefix and binds every Python evidence file', async () => {
    vi.stubEnv('NODE_OPTIONS', '--max-old-space-size=384');
    try {
      const fixture = await settledFixture();
      const report = await calibrateLibraryChecker({ ...fixture, verifyOnly: true });
      expect(report).toMatchObject({ status: 'complete', plannedFamilies: 1, completedFamilies: 1, qualifiedFamilies: 1,
        plannedSources: 1, completedSources: 1, modelRequests: 0 });
      expect(existsSync(join(fixture.output, 'progress.json'))).toBe(false);
      writeFileSync(join(fixture.directory, 'reference/stdio-python-evidence/unbound.log'), 'unexpected file');
      await expect(calibrateLibraryChecker({ ...fixture, verifyOnly: true })).rejects.toThrow('evidence-drift');
    } finally { vi.unstubAllEnvs(); }
  });

  it('keeps a completed compilation rejection distinct from infrastructure', async () => {
    vi.stubEnv('NODE_OPTIONS', '--max-old-space-size=384');
    try {
      const fixture = await settledFixture(true);
      const grade = JSON.parse(readFileSync(join(fixture.directory, 'reference-grade/grade.json'), 'utf8'));
      expect(grade).toMatchObject({ passed: false, failureClass: 'assertion' });
      const report = await calibrateLibraryChecker({ ...fixture, verifyOnly: true });
      expect(report).toMatchObject({ status: 'complete', completedFamilies: 1, qualifiedFamilies: 0 });
    } finally { vi.unstubAllEnvs(); }
  });

  it('does not count a partially settled family as completely calibrated', async () => {
    vi.stubEnv('NODE_OPTIONS', '--max-old-space-size=384');
    try {
      const fixture = await settledFixture(false, true);
      const report = await calibrateLibraryChecker({ ...fixture, verifyOnly: true });
      expect(report).toMatchObject({ status: 'resource-paused', plannedFamilies: 1, completedFamilies: 0,
        qualifiedFamilies: 1, plannedSources: 2, completedSources: 1, qualifiedSources: 1 });
    } finally { vi.unstubAllEnvs(); }
  });

  it('refuses an interrupted started phase during offline prefix verification', async () => {
    vi.stubEnv('NODE_OPTIONS', '--max-old-space-size=384');
    try {
      const fixture = await settledFixture();
      renameSync(join(fixture.directory, 'no-output-receipt.json'), join(fixture.directory, 'hidden-fixture-receipt.json'));
      await expect(calibrateLibraryChecker({ ...fixture, verifyOnly: true })).rejects.toThrow('started-phase-without-receipt:no-output');
      expect(existsSync(join(fixture.output, 'progress.json'))).toBe(false);
    } finally { vi.unstubAllEnvs(); }
  });
});
