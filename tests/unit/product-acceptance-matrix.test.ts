// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectCases, declaredCaseTimeoutMs, evaluateReport, executionBudgetMs, matrixEnvironment, matrixOutputDirectory, validateBuildStamp, validateInventory } from '../../scripts/product-acceptance-matrix.mjs';
import { assertFreshProductBuildProof, createFreshProductBuildProof, readProductCandidate } from '../e2e/fixtures/product-candidate';
import { gradeJudgeVotes, gradeReviewSample, parseJudgeResponse } from '../../scripts/product-matrix-judge.mjs';
import { redactSpaceBunny } from '../e2e/fixtures/space-bunny-responses';

const root = process.cwd();
const inventory = () => JSON.parse(readFileSync(resolve(root, 'harness/specs/fixtures/product-acceptance-matrix/inventory.json'), 'utf8'));
const report = (names = ['positive', 'negative'], discovery = false) => ({
  config: { rootDir: resolve(root, 'tests/e2e') }, errors: [],
  suites: [{ title: 'settings.spec.ts', specs: names.map((title) => ({ file: 'settings.spec.ts', title,
    tests: [{ projectName: '', repeatEachIndex: 0, expectedStatus: 'passed', status: 'expected', timeout: 90_000, results: discovery ? [] : [{ status: 'passed' }] }],
  })) }],
});

describe('TF-0582 product matrix', () => {
  it('maps all nine groups and current default dispositions to existing test files and positive/negative oracles', () => {
    expect(validateInventory(inventory())).toEqual([]);
  });

  it('rejects lost groups, unmapped current defaults, missing tests and empty negative oracles', () => {
    const missingGroup = inventory(); missingGroup.groups.pop();
    expect(validateInventory(missingGroup)).toContain('All nine groups must appear exactly once');
    const missingDefault = inventory(); missingDefault.groups.find((group: { id: string }) => group.id === 'memory').defaultComponents = [];
    expect(validateInventory(missingDefault)).toContain('Unmapped default disposition component.role-memory');
    const missingFile = inventory(); missingFile.groups[0].files = ['tests/e2e/does-not-exist.spec.ts'];
    expect(validateInventory(missingFile).join('\n')).toContain('missing or invalid test file');
    const missingOracle = inventory(); missingOracle.groups[0].negativeOracles = [];
    expect(validateInventory(missingOracle).join('\n')).toContain('positive and negative oracles are required');
  });

  it('accepts the exact collected cases only after each passes once', () => {
    const result = evaluateReport(report(undefined, true), report(), 0);
    expect(result).toMatchObject({ passed: true, counts: { planned: 2, observed: 2, passed: 2, failed: 0, skipped: 0 } });
    expect(collectCases(report())[0].file).toBe('tests/e2e/settings.spec.ts');
  });

  it('budgets a serial batch from collected case timeouts without truncating a long valid suite', () => {
    const discovery = report(['first', 'second'], true);
    discovery.suites[0].specs[0].tests[0].timeout = 2_400_000;
    discovery.suites[0].specs[1].tests[0].timeout = 1_800_000;
    const cases = collectCases(discovery);
    expect(executionBudgetMs(cases)).toBe(8_760_000);
    expect(cases.map(test => test.timeout)).toEqual([2_400_000, 1_800_000]);
    expect(executionBudgetMs(collectCases(report(undefined, true)))).toBe(720_000);
  });

  it('rejects missing, unbounded and overflowing test timeout budgets', () => {
    expect(() => executionBudgetMs([])).toThrow('positive bounded timeout');
    for (const timeout of [0, -1, NaN, Infinity, 1.5]) {
      expect(() => executionBudgetMs([{ timeout }])).toThrow('positive bounded timeout');
    }
    const discovery = report();
    Reflect.deleteProperty(discovery.suites[0].specs[0].tests[0], 'timeout');
    expect(() => executionBudgetMs(collectCases(discovery))).toThrow('positive bounded timeout');
    expect(() => executionBudgetMs([{ timeout: Number.MAX_SAFE_INTEGER }])).toThrow('too large');
  });

  it('includes timeout overrides inside test bodies that Playwright discovery has not executed', () => {
    const source = `// test.setTimeout(900_000);
      const label = 'test.setTimeout(800_000)';
      test('owner', async () => { test.setTimeout(600_000); });
      test('shorter', async ({}, testInfo) => { testInfo.setTimeout(120_000); });`;
    const cases = collectCases(report(undefined, true));
    const timeoutOverrides = { [cases[0].file]: declaredCaseTimeoutMs(source) };
    expect(timeoutOverrides[cases[0].file]).toBe(600_000);
    expect(executionBudgetMs(cases, timeoutOverrides)).toBe(2_760_000);
    expect(declaredCaseTimeoutMs('// test.setTimeout(0)')).toBe(0);
    for (const value of ['0', '-1', 'Infinity', 'process.env.TIMEOUT', '1000 * 60']) {
      expect(() => declaredCaseTimeoutMs(`test.setTimeout(${value})`)).toThrow('positive numeric literals');
    }
  });

  it('rejects missing, extra and duplicate test identities and an empty collection', () => {
    expect(evaluateReport(report(), report(['positive']), 0).passed).toBe(false);
    expect(evaluateReport(report(), report(['positive', 'negative', 'unexpected']), 0).passed).toBe(false);
    expect(evaluateReport(report(['duplicate', 'duplicate']), report(['duplicate', 'duplicate']), 0).passed).toBe(false);
    expect(evaluateReport(report([], true), report([]), 0).passed).toBe(false);
  });

  it('rejects a skipped, expected-to-fail or retried case even if the final result is green', () => {
    const skipped = report(); skipped.suites[0].specs[0].tests[0].results = [{ status: 'skipped' }];
    expect(evaluateReport(report(), skipped, 0)).toMatchObject({ passed: false, counts: { skipped: 1 } });
    const expectedFailure = report(); expectedFailure.suites[0].specs[0].tests[0].expectedStatus = 'failed';
    expect(evaluateReport(report(), expectedFailure, 0).passed).toBe(false);
    const retried = report(); retried.suites[0].specs[0].tests[0].results = [{ status: 'failed' }, { status: 'passed' }];
    expect(evaluateReport(report(), retried, 0).passed).toBe(false);
  });

  it('rejects global teardown errors, nonzero exits and invalid raw reports after all assertions pass', () => {
    const teardown = { ...report(), errors: [{ message: 'cleanup failed' }] };
    expect(evaluateReport(report(), teardown, 0).passed).toBe(false);
    expect(evaluateReport(report(), report(), 1).passed).toBe(false);
    expect(evaluateReport(report(), null, 0).passed).toBe(false);
  });

  it('does not count a planned skip or a changed project/repetition as successful execution', () => {
    const discovery = report(); discovery.suites[0].specs[0].tests[0].expectedStatus = 'skipped';
    expect(evaluateReport(discovery, report(), 0).passed).toBe(false);
    const otherProject = report(); otherProject.suites[0].specs[0].tests[0].projectName = 'different';
    expect(evaluateReport(report(), otherProject, 0).passed).toBe(false);
    const otherRepeat = report(); otherRepeat.suites[0].specs[0].tests[0].repeatEachIndex = 1;
    expect(evaluateReport(report(), otherRepeat, 0).passed).toBe(false);
  });

  it('rejects a missing/stale build stamp and a dirty candidate', () => {
    const candidate = { commit: 'a'.repeat(40), clean: true };
    expect(() => validateBuildStamp({ head: candidate.commit }, candidate)).not.toThrow();
    expect(() => validateBuildStamp(null, candidate)).toThrow('clean candidate');
    expect(() => validateBuildStamp({ head: 'b'.repeat(40) }, candidate)).toThrow('clean candidate');
    expect(() => validateBuildStamp({ head: candidate.commit }, { ...candidate, clean: false })).toThrow('clean candidate');
  });

  it('rejects changes to a frozen test file even when discovery and execution could still agree', () => {
    const changed = inventory();
    const file = 'tests/e2e/product-acceptance-moyu.spec.ts';
    changed.sourceHashes[file] = '0'.repeat(64);
    expect(validateInventory(changed)).toContain(`Frozen test source changed: ${file}`);
  });

  it('rejects in-checkout output before creating files that would dirty the candidate', () => {
    expect(() => matrixOutputDirectory(resolve(root, 'artifacts/agent-engineering-acceptance/new-run'))).toThrow('outside the candidate checkout');
  });

  it('retains live receipts in the batch and rejects diagnostic overrides', () => {
    const output = resolve(tmpdir(), 'matrix-environment');
    expect(matrixEnvironment(output, { PATHEXT: '.EXE;.CMD', SystemRoot: 'C:\\Windows' })).toMatchObject({
      PATHEXT: '.EXE;.CMD', SystemRoot: 'C:\\Windows', PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN: 'false',
      CLAWX_SPACE_BUNNY_ARTIFACT_ROOT: resolve(output, 'b1-space-bunny'), CLAWX_MOYU_ARTIFACT_ROOT: resolve(output, 'b2-moyu'),
    });
    for (const name of ['CLAWX_SPACE_BUNNY_PREFLIGHT', 'CLAWX_SPACE_BUNNY_OPERATIONAL', 'CLAWX_MOYU_PREFLIGHT']) {
      expect(() => matrixEnvironment(output, { [name]: '1' })).toThrow('cannot be used for matrix acceptance');
    }
    expect(() => matrixEnvironment(output, { CLAWX_SPACE_BUNNY_FAULTS: '401' })).toThrow('cannot narrow matrix acceptance');
  });
});

describe('TF-0582 shared fresh-build binding', () => {
  const binding = { commit: 'a'.repeat(40), tree: 'b'.repeat(40), dirty: false, inputDigest: 'c'.repeat(64) };
  const candidate = { commit: binding.commit, tree: binding.tree, dirty: false };
  const commands = () => ['build:vite', 'build:runtime'].map(script => ({ command: ['pnpm', 'run', script], exitCode: 0, candidate }));

  it('accepts the same clean candidate and successful actual pnpm build receipts', () => {
    const proof = createFreshProductBuildProof(binding, commands());
    expect(() => assertFreshProductBuildProof(proof, binding)).not.toThrow();
    expect(proof).toMatchObject({ schema: 'TF0580FreshBuild/v1', candidate, inputDigest: binding.inputDigest });
  });

  it('rejects stale candidates, changed inputs, missing commands and failed builds', () => {
    const proof = createFreshProductBuildProof(binding, commands());
    expect(() => assertFreshProductBuildProof(proof, { ...binding, dirty: true })).toThrow('clean candidate');
    expect(() => assertFreshProductBuildProof({ ...proof, candidate: { ...candidate, commit: 'd'.repeat(40) } }, binding)).toThrow('candidate does not match');
    expect(() => assertFreshProductBuildProof(proof, { ...binding, inputDigest: 'e'.repeat(64) })).toThrow('inputs changed');
    expect(() => createFreshProductBuildProof(binding, commands().slice(0, 1))).toThrow('commands do not match');
    expect(() => createFreshProductBuildProof(binding, commands().reverse())).toThrow('commands do not match');
    for (const exitCode of [1, null]) {
      expect(() => createFreshProductBuildProof(binding, commands().map(command => ({ ...command, exitCode })))).toThrow('command failed');
    }
    expect(() => createFreshProductBuildProof(binding, commands().map(command => ({ ...command, candidate: { ...candidate, dirty: true } })))).toThrow('command candidate does not match');
    expect(() => createFreshProductBuildProof(binding, commands().map(command => ({ ...command, command: ['node', 'vite.js', 'build'] })))).toThrow('commands do not match');
  });

  it('detects ignored build mutation even when Git and the runtime stamp still identify the clean candidate', () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'product-candidate-'));
    const write = (file: string, value: string) => { mkdirSync(dirname(join(fixtureRoot, file)), { recursive: true }); writeFileSync(join(fixtureRoot, file), value); };
    const git = (...args: string[]) => execFileSync('git', args, { cwd: fixtureRoot, encoding: 'utf8', windowsHide: true }).trim();
    try {
      write('.gitignore', 'dist/\ndist-electron/\nopenclaw_runtime/dist/\nopenclaw_runtime/dist-runtime/\nresources/bin/\n');
      for (const file of ['src/正文.ts', 'electron/main.ts', 'shared/contract.ts', 'package.json',
        'tests/e2e/product-acceptance-space-bunny.spec.ts', 'tests/e2e/fixtures/space-bunny-responses.ts',
        'harness/specs/tasks/product-acceptance-space-bunny.md', 'harness/specs/tasks/product-acceptance-closeout.md']) write(file, file);
      git('init', '-q'); git('add', '.'); git('-c', 'user.name=Matrix Fixture', '-c', 'user.email=matrix-fixture@example.invalid', 'commit', '-qm', 'fixture');
      const commit = git('rev-parse', 'HEAD');
      for (const file of ['dist/index.html', 'dist/assets/payload.js', 'dist-electron/main/index.js', 'openclaw_runtime/dist/entry.js', 'openclaw_runtime/dist-runtime/entry.js']) write(file, file);
      write('openclaw_runtime/dist/.buildstamp', JSON.stringify({ head: commit }));
      const inputs = readProductCandidate(fixtureRoot);
      expect(inputs).toMatchObject({ commit, dirty: false, sourceCount: 8, buildCount: 6 });
      expect(inputs.files.filter(file => file.path === 'tests/e2e/fixtures/space-bunny-responses.ts')).toHaveLength(1);
      expect(inputs.files.some(file => file.path === 'src/正文.ts')).toBe(true);
      const identity = { commit: inputs.commit, tree: inputs.tree, dirty: false };
      const proof = createFreshProductBuildProof(inputs, commands().map(command => ({ ...command, candidate: identity })));
      expect(readProductCandidate(fixtureRoot).inputDigest).toBe(inputs.inputDigest);
      write('dist/assets/payload.js', 'changed ignored build');
      const changed = readProductCandidate(fixtureRoot);
      expect(changed.dirty).toBe(false);
      expect(changed.runtimeBuildStamp).toEqual(inputs.runtimeBuildStamp);
      expect(() => assertFreshProductBuildProof(proof, changed)).toThrow('inputs changed');
      write('src/正文.ts', 'changed source');
      expect(readProductCandidate(fixtureRoot).dirty).toBe(true);
      write('src/正文.ts', 'src/正文.ts');
      write('resources/bin/win32-x64/ae.exe', 'fixture tool binary');
      const withBinary = readProductCandidate(fixtureRoot);
      expect(withBinary.resourceCount).toBe(1);
      expect(withBinary.dirty).toBe(false);
      write('resources/bin/win32-x64/ae.exe', 'changed tool binary');
      expect(readProductCandidate(fixtureRoot).inputDigest).not.toBe(withBinary.inputDigest);
    } finally {
      expect(resolve(fixtureRoot).startsWith(resolve(tmpdir()) + sep)).toBe(true);
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
});

describe('TF-0582 qualitative judge', () => {
  const response = (verdict = 'pass', id = 'response-1') => ({ id, model: 'space-bunny', status: 'completed',
    output: [{ content: [{ type: 'output_text', text: JSON.stringify({ verdict, reason: 'Observed fixture result' }) }] }] });
  const votes = (verdicts = ['pass', 'pass', 'fail']) => verdicts.map((verdict, index) => ({ httpStatus: 200, response: response(verdict, `response-${index}`), error: null }));

  it('preserves task artifact paths while redacting token-shaped and configured secrets', () => {
    const previous = process.env.CLAWX_SPACE_BUNNY_API_KEY;
    try {
      process.env.CLAWX_SPACE_BUNNY_API_KEY = 'fixture-private-credential';
      expect(redactSpaceBunny('agent-first-task-corpus/task-forest.json sk-fixture-token fixture-private-credential'))
        .toBe('agent-first-task-corpus/task-forest.json [REDACTED] [REDACTED]');
    } finally {
      if (previous === undefined) delete process.env.CLAWX_SPACE_BUNNY_API_KEY;
      else process.env.CLAWX_SPACE_BUNNY_API_KEY = previous;
    }
  });

  it('keeps a valid unknown distinct from a malformed or incomplete response', () => {
    expect(parseJudgeResponse(response('unknown'))).toMatchObject({ verdict: 'unknown', valid: true });
    for (const value of [null, { ...response(), status: 'incomplete' }, { ...response(), id: 1 }, { ...response(), output: {} },
      { ...response(), output: [{ content: [{ type: 'output_text', text: 'Looks good' }] }] }]) {
      expect(parseJudgeResponse(value)).toMatchObject({ verdict: 'unknown', valid: false });
    }
  });

  it('requires three distinct successful votes from the same returned model', () => {
    expect(gradeJudgeVotes(votes())).toMatchObject({ valid: true, verdict: 'pass' });
    expect(gradeJudgeVotes(votes(['pass', 'fail', 'unknown']))).toMatchObject({ valid: true, verdict: 'unknown' });
    expect(gradeJudgeVotes(votes().slice(0, 2))).toMatchObject({ valid: false, verdict: 'unknown' });
    const duplicate = votes(); duplicate[1].response.id = duplicate[0].response.id;
    expect(gradeJudgeVotes(duplicate)).toMatchObject({ valid: false, verdict: 'unknown' });
    const drift = votes(); drift[1].response.model = 'another-model';
    expect(gradeJudgeVotes(drift)).toMatchObject({ valid: false, verdict: 'unknown' });
    expect(gradeJudgeVotes(votes().map(vote => ({ ...vote, response: { ...vote.response, model: 'another-model' } })))).toMatchObject({ valid: false, verdict: 'unknown' });
    const failed = votes(); failed[1].httpStatus = 429;
    expect(gradeJudgeVotes(failed)).toMatchObject({ valid: false, verdict: 'unknown' });
  });

  it('withholds a review with missing evidence even when all model votes pass', () => {
    const unanimous = votes(['pass', 'pass', 'pass']);
    for (const sample of [{ id: 'empty' }, { facts: {}, explanation: 'All passed' }, { facts: { passed: 1 }, explanation: null }]) {
      expect(gradeReviewSample(sample, unanimous)).toMatchObject({ valid: false, evidenceAvailable: false, verdict: 'unknown', modelVerdict: 'pass' });
    }
    expect(gradeReviewSample({ facts: { passed: 1 }, explanation: 'One case passed.' }, unanimous)).toMatchObject({ valid: true, evidenceAvailable: true, verdict: 'pass' });
  });
});
