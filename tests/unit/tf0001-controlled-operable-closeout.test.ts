import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(process.cwd());

describe('TF-0001 controlled operable close-out (non-GA)', () => {
  it('evidence.json asserts accept-with-residuals and false graduation gates', () => {
    const path = resolve(ROOT, 'artifacts/tf0001-closeout/evidence.json');
    expect(existsSync(path)).toBe(true);
    const evidence = JSON.parse(readFileSync(path, 'utf8')) as {
      verdict: Record<string, unknown>;
      acceptance: Record<string, { met: boolean }>;
      children: Record<string, string>;
      allEvidencePresent: boolean;
    };

    expect(evidence.verdict.controlledOperableNonGa).toBe(true);
    expect(evidence.verdict.liveReady).toBe(false);
    expect(evidence.verdict.productApproved).toBe(false);
    expect(evidence.verdict.readyForDefaultFlagGraduation).toBe(false);
    expect(evidence.verdict.jointSystemGa).toBe('NO-GO');
    expect(evidence.verdict.decision).toBe('accept-with-residuals');

    for (const key of Object.keys(evidence.acceptance)) {
      expect(evidence.acceptance[key].met, key).toBe(true);
    }

    expect(evidence.children['TF-0002']).toBe('done');
    expect(evidence.children['TF-0003']).toBe('done');
    expect(evidence.children['TF-0004']).toBe('done');
    expect(evidence.children['TF-0005']).toBe('done');
    expect(evidence.children['TF-0006']).toBe('blocked');
    expect(evidence.allEvidencePresent).toBe(true);
  });

  it('close-out doc exists and forbids claiming GA', () => {
    const doc = readFileSync(resolve(ROOT, 'docs/dev/tf0001-controlled-operable-closeout.md'), 'utf8');
    expect(doc).toMatch(/accept-with-residuals/i);
    expect(doc).toMatch(/liveReady/);
    expect(doc).toMatch(/NO-GO/);
    expect(
      doc.includes('joint-system GA')
      || doc.includes('non-GA')
      || doc.includes('NOT joint'),
    ).toBe(true);
  });
});
