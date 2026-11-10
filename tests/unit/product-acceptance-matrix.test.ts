// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectCases, evaluateReport, matrixOutputDirectory, validateBuildStamp, validateInventory } from '../../scripts/product-acceptance-matrix.mjs';

const root = process.cwd();
const inventory = () => JSON.parse(readFileSync(resolve(root, 'harness/specs/fixtures/product-acceptance-matrix/inventory.json'), 'utf8'));
const report = (names = ['positive', 'negative'], discovery = false) => ({
  config: { rootDir: resolve(root, 'tests/e2e') }, errors: [],
  suites: [{ title: 'settings.spec.ts', specs: names.map((title) => ({ file: 'settings.spec.ts', title,
    tests: [{ projectName: '', repeatEachIndex: 0, expectedStatus: 'passed', status: 'expected', results: discovery ? [] : [{ status: 'passed' }] }],
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
});
