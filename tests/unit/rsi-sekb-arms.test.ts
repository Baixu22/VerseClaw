// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any -- Protocol and run mutations intentionally traverse JSON whose schema is validated by the scripts under test. */
// TF-0598: the three-arm readout must keep shadow distinguishable from
// confirmed, reuse the single case-cluster instrument, and never promote from a
// synthetic wiring fixture.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join as joinPath, resolve as resolvePath, sep } from 'node:path';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import {
  ARMS_PROTOCOL_PATH,
  ARMS_RUNS_PATH,
  buildArmsPlan,
  buildArmsReport,
  validateArmsProtocol,
} from '../../scripts/rsi-sekb-arms.mjs';

const ROOT = process.cwd();
const readProtocol = () => JSON.parse(readFileSync(join(ROOT, ARMS_PROTOCOL_PATH), 'utf8'));
const TEMP_ROOT = 'D:/tmp';
const created: string[] = [];
function tempRootWith(mutate: (runs: any) => void): string {
  mkdirSync(TEMP_ROOT, { recursive: true });
  const dir = mkdtempSync(joinPath(TEMP_ROOT, 'rsi-sekb-arms-test-'));
  created.push(dir);
  const protocol = JSON.parse(readFileSync(joinPath(ROOT, ARMS_PROTOCOL_PATH), 'utf8'));
  const runs = JSON.parse(readFileSync(joinPath(ROOT, ARMS_RUNS_PATH), 'utf8'));
  mutate(runs);
  mkdirSync(joinPath(dir, 'harness/specs/fixtures/rsi-sekb-arms'), { recursive: true });
  writeFileSync(joinPath(dir, ARMS_PROTOCOL_PATH), JSON.stringify(protocol));
  writeFileSync(joinPath(dir, ARMS_RUNS_PATH), JSON.stringify(runs));
  return dir;
}
afterAll(() => {
  for (const path of created) {
    if (!resolvePath(path).startsWith(`${resolvePath(TEMP_ROOT)}${sep}rsi-sekb-arms-test-`)) throw new Error('unexpected cleanup path');
    rmSync(path, { recursive: true, force: true });
  }
});

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
  it('plans the 180-trial three-arm run without executing it', () => {
    const plan = buildArmsPlan(readProtocol());
    expect(plan.trials).toBe(180);
    expect(plan.status).toBe('awaiting-provider-envelope');
    expect(plan.providerCallsAuthorized).toBe(0);
  });

  it('never leaves a real run with an unexplained insufficient-evidence status', () => {
    const root = tempRootWith((runs) => {
      runs.evidenceKind = 'live-provider';
      for (const arm of Object.values(runs.arms) as any[]) for (const row of arm) row.tokens = 1000;
    });
    const report = buildArmsReport(root);

    // Above the floor and inside the cost ceiling, but this instrument has no
    // promote/hold/eliminate path; the reason must say so.
    expect(report.status).toBe('insufficient-evidence');
    expect(report.reasons.length).toBeGreaterThan(0);
    expect(report.reasons.join(' ')).toContain('promotion state is not derived');
  });

  it('treats a missing cost dimension as a promotion disqualifier', () => {
    const root = tempRootWith((runs) => {
      for (const arm of Object.values(runs.arms) as any[]) for (const row of arm) row.tokens = null;
    });
    const report = buildArmsReport(root);
    expect(report.cost.missing).toBe(true);
    expect(report.reasons.join(' ')).toContain('cost dimension missing');
  });
});
