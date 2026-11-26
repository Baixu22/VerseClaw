import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { getHeapStatistics } from 'node:v8';
import { createStdioTasks, verifyStdioTasks } from '../../scripts/lib/rsi-stdio-tasks.mjs';
import { NATIVE_CHECKER_PROFILE } from '../../scripts/lib/rsi-native-checker.mjs';
import { assertCalibrationPrefix, assertUnstartedCalibrationPhase, calibrateLibraryChecker, calibrationFile, calibrationRegistryBinding, calibrationVerdict,
  loadCalibrationInputs } from '../../scripts/rsi-library-checker-calibrate.mjs';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const put = (directory: string, path: string, value: unknown) => writeFileSync(join(directory, path), JSON.stringify(value));
const temporaryRoot = process.platform === 'win32' ? 'D:/tmp' : tmpdir();
mkdirSync(temporaryRoot, { recursive: true });
const temporary = (prefix: string) => mkdtempSync(join(temporaryRoot, prefix));

function inputFixture() {
  const directory = temporary('rsi-calibration-input-fixture-');
  const sources = Object.fromEntries(['scripts/rsi-library-checker-calibrate.mjs', 'scripts/rsi-native-checker-worker.py',
    'scripts/rsi-native-checker-replay.py', 'scripts/lib/rsi-native-checker.mjs'].map(name => [name, '1'.repeat(64)]));
  const plan = { schemaVersion: 'RsiLibraryCheckerMeasurementPlan/v1', driven_by: 'agent', realHumanEvidence: false,
    modelRequests: 0, usage: 'scripted-control', selectedProblems: ['example'], minimumSystemAvailableBytes: 3221225472,
    sourceFilesSha256: sources };
  put(directory, 'plan.json', plan);
  const prepared = { schemaVersion: 'RsiLibraryCheckerMeasurementInputs/v1', modelRequests: 0, formalAdmission: false,
    planSha256: digest(JSON.stringify(plan)), cases: [{ problem: 'example', path: 'example.json.gz', sha256: '2'.repeat(64),
      packDigest: '3'.repeat(64), referenceSha256: '4'.repeat(64), vectors: 5 }] };
  put(directory, 'report.json', prepared);
  return { directory, plan, prepared };
}

describe('zero-call Library Checker calibration continuation', () => {
  it('accepts Windows registry separators without accepting path traversal', () => {
    const directory = temporary('rsi-calibration-path-fixture-');
    expect(calibrationFile(directory, 'oracles\\fixture.json')).toBe(join(directory, 'oracles', 'fixture.json'));
    expect(calibrationFile(directory, 'shim/bits/stdc++.h')).toBe(join(directory, 'shim', 'bits', 'stdc++.h'));
    for (const path of ['../fixture.json', '..\\fixture.json', 'C:\\fixture.json', '/fixture.json'])
      expect(() => calibrationFile(directory, path)).toThrow('calibration-relative-path');
  });
  it('binds the prepared plan and exact complete order', async () => {
    const { directory, prepared } = inputFixture();
    expect((await loadCalibrationInputs(directory, directory)).prepared.cases).toHaveLength(1);
    put(directory, 'report.json', { ...prepared, cases: [{ ...prepared.cases[0], problem: 'other' }] });
    await expect(loadCalibrationInputs(directory, directory)).rejects.toThrow('calibration-input-order');
  });

  it('preserves uppercase characters in official source identities', async () => {
    const { directory, plan, prepared } = inputFixture();
    plan.selectedProblems = ['convolution_F_2_64'];
    prepared.cases[0].problem = 'convolution_F_2_64'; prepared.cases[0].path = 'convolution_F_2_64.json.gz';
    put(directory, 'plan.json', plan); prepared.planSha256 = digest(JSON.stringify(plan)); put(directory, 'report.json', prepared);
    expect((await loadCalibrationInputs(directory, directory)).prepared.cases[0].problem).toBe('convolution_F_2_64');
  });

  it('binds Python serialized pack bytes to the actual Node task registry', () => {
    const reference = 'int main(){return 0;}\n', checker = 'int main(){return 1;}\n';
    const pack = { schemaVersion: 'RsiIndependentCodingCases/v2', datasetVersion: 'RsiSemanticIndependentCases/v2',
      executionKind: 'stdio-program', driven_by: 'agent', actor: 'unit/calibration-pack', usage: 'scripted-control',
      realHumanEvidence: false, cases: [{ id: 'fixture', prompt: 'Agent fixture: echo the integer.', runtime: 'cpp',
        split: 'validation', familyId: 'fixture', independenceGroup: 'fixture', declaration: 'Complete C++ program.',
        reference, cppToolchain: 'gcc-libstdc++', compilerVersion: 'agent-fixture-g++',
        vectors: [1, 2, 3, 4, 5].map(n => ({ kind: 'stdio', input: n + '\n', output: n + '\n', visibility: 'private' })),
        provenance: { fixtureOnly: true, sourceId: 'agent-fixture' }, nativeChecker: {
          schemaVersion: 'RsiStdioNativeChecker/v1', sourceRevision: 'agent-fixture', compilerVersion: 'agent-fixture-g++',
          profile: NATIVE_CHECKER_PROFILE, entryPath: 'checker.cpp', includeDirs: [], referenceIncludeDirs: [],
          referenceSha256: digest(reference), sourceFiles: { 'checker.cpp': checker }, sourceFilesSha256: { 'checker.cpp': digest(checker) } } }] };
    const encoded = execFileSync('python', ['-B', '-c', 'import json,sys;print(json.dumps(json.load(sys.stdin),ensure_ascii=False,separators=(",",":")),end="")'],
      { input: JSON.stringify(pack), encoding: 'utf8' });
    const directory = temporary('rsi-calibration-pack-fixture-');
    const decoded = JSON.parse(encoded), registry = createStdioTasks(directory, decoded);
    expect(verifyStdioTasks(registry, decoded)).toBe(true);
    expect(registry.packDigest).toBe(digest(encoded));
  });

  it('rejects missing worker bindings, boolean budgets and path drift', async () => {
    for (const change of ['worker', 'budget', 'path', 'calls']) {
      const { directory, plan, prepared } = inputFixture();
      if (change === 'worker') delete plan.sourceFilesSha256['scripts/rsi-native-checker-worker.py'];
      if (change === 'budget') Object.assign(plan, { minimumSystemAvailableBytes: true });
      if (change === 'calls') Object.assign(plan, { modelRequests: false });
      if (change === 'path') prepared.cases[0].path = '../example.json.gz';
      put(directory, 'plan.json', plan); prepared.planSha256 = digest(JSON.stringify(plan));
      put(directory, 'report.json', prepared);
      await expect(loadCalibrationInputs(directory, directory)).rejects.toThrow();
    }
  });

  it('refuses any already-started phase without a settled receipt', () => {
    for (const name of ['reference', 'reference-grade', 'reference-started.json']) {
      const directory = temporary('rsi-calibration-start-fixture-');
      expect(() => assertUnstartedCalibrationPhase(directory, 'reference')).not.toThrow();
      if (name.endsWith('.json')) put(directory, name, { driven_by: 'agent', fixtureOnly: true });
      else mkdirSync(join(directory, name));
      expect(() => assertUnstartedCalibrationPhase(directory, 'reference')).toThrow('started-phase-without-receipt');
    }
  });

  it('rejects gaps in family and phase receipt prefixes', () => {
    const directory = temporary('rsi-calibration-prefix-fixture-');
    mkdirSync(join(directory, '001-second'));
    expect(() => assertCalibrationPrefix(directory, ['first', 'second'])).toThrow('case-prefix-gap');
    mkdirSync(join(directory, '000-first'));
    put(join(directory, '000-first'), 'reference-receipt.json', { driven_by: 'agent', fixtureOnly: true });
    expect(() => assertCalibrationPrefix(directory, ['first', 'second'])).toThrow('phase-prefix-gap');
    put(join(directory, '000-first'), 'baseline-receipt.json', { driven_by: 'agent', fixtureOnly: true });
    expect(() => assertCalibrationPrefix(directory, ['first', 'second'])).toThrow('case-after-unsettled-phase');
  });

  it('separates source rejection, negative controls and infrastructure', () => {
    expect(calibrationVerdict('baseline', { passed: false, failureClass: 'target-module-absent' })).toBe('baseline-unimplemented');
    expect(calibrationVerdict('reference', { passed: true, failureClass: null })).toBe('reference-pass');
    expect(calibrationVerdict('reference', { passed: false, failureClass: 'assertion' })).toBe('reference-rejected');
    expect(calibrationVerdict('no-output', { passed: false, failureClass: 'assertion' })).toBe('negative-control-rejected');
    expect(calibrationVerdict('reference', { passed: false, failureClass: 'infrastructure' })).toBe('infrastructure');
    expect(() => calibrationVerdict('no-output', { passed: true, failureClass: null })).toThrow('no-output-control');
  });

  it('replays a zero-family prefix without creating a progress file', async () => {
    vi.stubEnv('NODE_OPTIONS', '--max-old-space-size=384');
    try {
    const { directory: inputs, plan, prepared } = inputFixture();
    const root = temporary('rsi-calibration-executor-fixture-');
    for (const name of Object.keys(plan.sourceFilesSha256)) {
      const path = join(root, name);
      mkdirSync(join(path, '..'), { recursive: true });
      writeFileSync(path, 'agent fixture; never executed');
      plan.sourceFilesSha256[name] = digest('agent fixture; never executed');
    }
    const git = (args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
    git(['init', '--quiet']); git(['add', '.']);
    git(['-c', 'user.name=RSI fixture', '-c', 'user.email=rsi-fixture@example.invalid', '-c', 'commit.gpgsign=false',
      'commit', '--quiet', '-m', 'Freeze agent-only executor fixture']);
    const sourceCommit = git(['rev-parse', 'HEAD']);
    Object.assign(plan, { sourceCommit, sourceTree: git(['rev-parse', 'HEAD^{tree}']), nodeVersion: process.version });
    put(inputs, 'plan.json', plan); prepared.planSha256 = digest(JSON.stringify(plan)); put(inputs, 'report.json', prepared);
    const output = temporary('rsi-calibration-empty-prefix-fixture-');
    put(output, 'started.json', { schemaVersion: 'RsiLibraryCheckerCalibrationBatch/v1', driven_by: 'agent',
      actor: 'codex/rsi-library-checker-calibration', realHumanEvidence: false, modelRequests: 0,
      usage: 'scripted-control', formalAdmission: false, benefit: 'NO_GO', adoption: 'hold',
      planSha256: prepared.planSha256, inputsSha256: digest(JSON.stringify(prepared)), sourceCommit,
      nodeOldSpaceMiB: 384, nodeHeapLimitBytes: getHeapStatistics().heap_size_limit });
    const report = await calibrateLibraryChecker({ root, inputs, output, verifyOnly: true });
    expect(report).toMatchObject({ status: 'resource-paused', completedFamilies: 0, qualifiedFamilies: 0 });
    expect(existsSync(join(output, 'progress.json'))).toBe(false);
    expect(() => assertUnstartedCalibrationPhase(output, 'reference')).not.toThrow();
    put(output, 'pause-after-family', { driven_by: 'agent', fixtureOnly: true });
    const paused = await calibrateLibraryChecker({ root, inputs, output });
    expect(paused).toMatchObject({ status: 'resource-paused', completedFamilies: 0 });
    expect(existsSync(join(output, 'progress.json'))).toBe(true);
    } finally { vi.unstubAllEnvs(); }
  });

  it('binds task repository metadata and rejects dirty corpus changes', async () => {
    const directory = temporary('rsi-calibration-task-binding-fixture-');
    const repository = join(directory, 'repository'); mkdirSync(repository);
    const git = (args: string[]) => execFileSync('git', args, { cwd: repository, encoding: 'utf8' }).trim();
    put(repository, 'task-corpus.json', { fixtureOnly: true, task: 'original' });
    git(['init', '--quiet']); git(['add', '.']);
    git(['-c', 'user.name=RSI fixture', '-c', 'user.email=rsi-fixture@example.invalid', '-c', 'commit.gpgsign=false',
      'commit', '--quiet', '-m', 'Bind agent fixture metadata']);
    const registry = { repository, registryCommit: git(['rev-parse', 'HEAD']),
      tasks: [{ id: 'fixture', source: { base: 'base-fixture', reference: 'ref-fixture' } }] };
    put(directory, 'registry.json', registry);
    const task = { id: 'fixture', base: 'base-fixture', ref: 'ref-fixture', input: { targetScope: ['src/fixture.cpp'] } };
    expect((await calibrationRegistryBinding(directory, registry, task)).registryCommit).toBe(registry.registryCommit);
    put(repository, 'task-corpus.json', { fixtureOnly: true, task: 'changed' });
    await expect(calibrationRegistryBinding(directory, registry, task)).rejects.toThrow('task-repository-dirty');
  });
});
