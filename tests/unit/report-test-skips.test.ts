import { describe, expect, it } from 'vitest';
import { discoverConditionalSuites, summarizeVitestJson } from '../../scripts/report-test-skips.mjs';

describe('conditional test skip reporting (#76)', () => {
  it('discovers suites that gate on hasDeepSeekKey', () => {
    const suites = discoverConditionalSuites(process.cwd());
    expect(suites.length).toBeGreaterThanOrEqual(10);
    expect(suites).toContain('tests/unit/runtime-memory-adversarial-holdout.test.ts');
  });

  it('summarizes passed and skipped assertions from Vitest JSON', () => {
    const summary = summarizeVitestJson(JSON.stringify({
      testResults: [
        { name: `${process.cwd()}/tests/unit/a.test.ts`, assertionResults: [{ status: 'passed' }, { status: 'skipped' }] },
        { name: `${process.cwd()}/tests/unit/b.test.ts`, assertionResults: [{ status: 'skipped' }] },
      ],
    }));
    expect(summary).toMatchObject({ passed: 1, skipped: 2 });
    expect(summary.files.map((entry) => entry.skipped)).toEqual([1, 1]);
  });
});
