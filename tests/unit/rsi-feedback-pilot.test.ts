// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any -- Protocol mutations intentionally traverse JSON whose schema is validated by the scripts under test. */
// TF-0654: the feedback-weighting pilot may never promote on a thin or empty
// feedback store. These tests keep the protocol honest and the report offline.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import {
  PROTOCOL_PATH,
  buildFeedbackReport,
  validateFeedbackProtocol,
} from '../../scripts/rsi-feedback-pilot.mjs';

const ROOT = process.cwd();
const TEMP_ROOT = 'D:/tmp';
const created: string[] = [];
const readProtocol = () => JSON.parse(readFileSync(join(ROOT, PROTOCOL_PATH), 'utf8'));
function tempExport(records: unknown[]): string {
  mkdirSync(TEMP_ROOT, { recursive: true });
  const dir = mkdtempSync(join(TEMP_ROOT, 'rsi-feedback-pilot-'));
  created.push(dir);
  writeFileSync(join(dir, 'feedback-export.v1.json'), JSON.stringify({ records }, null, 2));
  return join(dir, 'feedback-export.v1.json').replaceAll('\\', '/');
}

afterAll(() => {
  for (const path of created) {
    if (!resolve(path).startsWith(`${resolve(TEMP_ROOT)}${sep}rsi-feedback-pilot-`)) throw new Error('unexpected temporary cleanup path');
    rmSync(path, { recursive: true, force: true });
  }
});

describe('rsi feedback pilot protocol', () => {
  it('accepts the checked-in protocol', () => {
    const result = validateFeedbackProtocol(readProtocol());
    expect(result.errors).toEqual([]);
    expect(result.passed).toBe(true);
  });

  it('rejects a changed k, floor, default flag or provider budget', () => {
    for (const mutate of [
      (p: any) => { p.design.k = 2; },
      (p: any) => { p.design.minimumCompleteCases = 5; },
      (p: any) => { p.flag.default = true; },
      (p: any) => { p.budget.providerCallsAuthorized = 3; },
      (p: any) => { p.negativeControls = p.negativeControls.slice(0, 2); },
    ]) {
      const protocol = readProtocol();
      mutate(protocol);
      expect(validateFeedbackProtocol(protocol).passed).toBe(false);
    }
  });

  it('reports insufficient-evidence when the store is empty', () => {
    const protocol = readProtocol();
    protocol.feedbackSource.exportPath = 'harness/specs/fixtures/rsi-feedback-loop/does-not-exist.v1.json';
    const report = buildFeedbackReport(ROOT, protocol);

    expect(report.status).toBe('insufficient-evidence');
    expect(report.input.rows).toBe(0);
    expect(report.claims.benefit).toBe(false);
    expect(report.claims.promotionReady).toBe(false);
    expect(report.reasons.join(' ')).toContain('no recorded feedback rows');
  });

  it('states why an above-floor export still cannot produce a decision', () => {
    const protocol = readProtocol();
    protocol.feedbackSource.exportPath = tempExport(
      Array.from({ length: 20 }, (_, index) => ({
        injectionId: `i${index}`, cardId: `c${index}`, caseId: `case-${index}`, outcome: 'helpful',
      })),
    );
    const report = buildFeedbackReport(ROOT, protocol);

    expect(report.input.completeCases).toBe(20);
    expect(report.status).toBe('insufficient-evidence');
    expect(report.reasons.join(' ')).toContain('no paired effect');
  });

  it('counts attributed rows but still refuses to claim an effect', () => {
    const protocol = readProtocol();
    protocol.feedbackSource.exportPath = tempExport([
      { injectionId: 'i1', cardId: 'c1', caseId: 'case-1', outcome: 'helpful' },
      { injectionId: 'i2', cardId: 'c2', caseId: 'case-2', outcome: 'harmful' },
      { injectionId: null, cardId: 'c3', caseId: 'case-3', outcome: 'helpful' },
    ]);
    const report = buildFeedbackReport(ROOT, protocol);

    expect(report.input.rows).toBe(3);
    expect(report.input.attributed).toBe(2);
    expect(report.input.unattributed).toBe(1);
    expect(report.status).toBe('insufficient-evidence');
    expect(report.claims.benefit).toBe(false);
  });
});
