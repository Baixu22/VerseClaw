// @vitest-environment node
// TF-0598: the three-arm readout must keep shadow distinguishable from
// confirmed, reuse the single case-cluster instrument, and never promote from a
// synthetic wiring fixture.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  ARMS_PROTOCOL_PATH,
  buildArmsReport,
  validateArmsProtocol,
} from '../../scripts/rsi-sekb-arms.mjs';

const ROOT = process.cwd();
const readProtocol = () => JSON.parse(readFileSync(join(ROOT, ARMS_PROTOCOL_PATH), 'utf8'));
const codes = (result: { errors: Array<{ code: string }> }) => result.errors.map((entry) => entry.code);

describe('rsi sekb three-arm readout', () => {
  it('accepts the checked-in protocol', () => {
    const result = validateArmsProtocol(readProtocol());
    expect(result.errors).toEqual([]);
    expect(result.passed).toBe(true);
  });

  it('keeps the shadow arm behaviourally identical to off', () => {
    const report = buildArmsReport(ROOT);
    const shadow = report.comparisons.find((entry) => entry.id === 'shadow-vs-off');

    expect(shadow?.meanDiff).toBe(0);
    expect(report.arms['sekb-shadow'].passK).toBe(report.arms['sekb-off'].passK);
  });

  it('never promotes from the synthetic fixture and reports the cost ceiling', () => {
    const report = buildArmsReport(ROOT);

    expect(report.status).toBe('synthetic-wiring-only');
    expect(report.claims.benefit).toBe(false);
    expect(report.claims.promotionReady).toBe(false);
    expect(report.cost.withinCeiling).toBe(false);
    expect(report.reasons.join(' ')).toContain('cost increase');
  });

  it('treats confirmed-vs-off as the promotion-eligible comparison', () => {
    const report = buildArmsReport(ROOT);
    const eligible = report.comparisons.filter((entry) => entry.role === 'promotion-eligible');

    expect(eligible).toHaveLength(1);
    expect(eligible[0].id).toBe('confirmed-vs-off');
  });

  it('rejects a changed k, provider budget or missing promotion comparison', () => {
    for (const mutate of [
      (p: any) => { p.design.k = 5; },
      (p: any) => { p.budget.providerCallsAuthorized = 2; },
      (p: any) => { p.comparisons = p.comparisons.filter((entry: any) => entry.role !== 'promotion-eligible'); },
    ]) {
      const protocol = readProtocol();
      mutate(protocol);
      expect(validateArmsProtocol(protocol).passed).toBe(false);
    }
  });
});
