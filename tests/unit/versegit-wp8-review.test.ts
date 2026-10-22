import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateWp8Report } from '../../scripts/verify-versegit-wp8.mjs';

function stored(): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(process.cwd(), 'harness/specs/fixtures/versegit-planning-correction/wp8-evidence/review-report.json'), 'utf8')) as Record<string, unknown>;
}

describe('WP8 independent review', () => {
  it('keeps the independent verdict and reports exact historical input drift', () => {
    const report = stored();
    expect(validateWp8Report(report).issues).toEqual([
      'input digest mismatch: scripts/versegit-wp7-host-vertical.mts',
      'input digest mismatch: tests/unit/versegit-wp7-host-vertical.test.ts',
      'input digest mismatch: tests/unit/versegit-receipt-authority.test.ts',
    ]);
    expect(report.p0).toEqual([]);
    expect(report.p1).toEqual([]);
    expect((report.p2 as unknown[]).length).toBeGreaterThan(0);
    expect(report.historicalReview).toMatchObject({ originalVerdict: 'FAIL', finalReviewCompleted: true, historyRewritten: false });
    expect(report.authority).toMatchObject({ humanEvidence: false, ga: false, releaseEligible: false, m4Authorized: false });
  });

  it('rejects a reopened P1, rewritten history or real-human claim', () => {
    const report = structuredClone(stored());
    (report.p1 as unknown[]).push({ id: 'latent-gap' });
    (report.historicalReview as Record<string, unknown>).historyRewritten = true;
    (report.authority as Record<string, unknown>).humanEvidence = true;
    const issues = validateWp8Report(report).issues;
    expect(issues).toEqual(expect.arrayContaining([
      'P1 findings must be zero',
      'historical review may not be rewritten',
      'real-human evidence may not be claimed',
    ]));
  });
});
