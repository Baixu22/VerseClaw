// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any -- Protocol and run mutations intentionally traverse JSON whose schema is validated by the scripts under test. */
// TF-0598: the three-arm readout must keep shadow distinguishable from
// confirmed, reuse the single case-cluster instrument, and never promote from a
// synthetic wiring fixture.
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join as joinPath, resolve as resolvePath, sep } from 'node:path';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import {
  ARMS_PROTOCOL_PATH,
  ARMS_RUNS_PATH,
  buildArmsPlan,
  buildArmsReport,
  validateArmsProtocol,
  validateArmsPack,
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

function improvingRun(runs: any): void {
  runs.evidenceKind = 'live-provider';
  runs.claims = { benefit: false, promotionReady: false, productLocksChanged: false, realHuman: false, providerCalls: 180 };
  runs.arms = Object.fromEntries(['sekb-off', 'sekb-shadow', 'sekb-confirmed'].map((arm) => [arm,
    Array.from({ length: 20 }, (_, index) => Array.from({ length: 3 }, (_, repeat) => ({
      caseId: `case-${index}`, repeat: repeat + 1, success: arm === 'sekb-confirmed' && index < 6, tokens: 1000,
    }))).flat(),
  ]));
}
afterAll(() => {
  for (const path of created) {
    if (!resolvePath(path).startsWith(`${resolvePath(TEMP_ROOT)}${sep}rsi-sekb-arms-test-`)) throw new Error('unexpected cleanup path');
    rmSync(path, { recursive: true, force: true });
  }
});

describe('rsi sekb three-arm readout', () => {
  it('verifies the retained report and rejects rehashed statistics', () => {
    expect(validateArmsPack(ROOT).passed).toBe(true);
    const root = tempRootWith(() => {});
    const manifest = 'harness/specs/fixtures/rsi-sekb-arms/SHA256SUMS';
    const lines = readFileSync(join(ROOT, manifest), 'utf8').trim().split(/\r?\n/u);
    for (const line of lines) {
      const path = line.slice(66);
      mkdirSync(dirname(join(root, path)), { recursive: true });
      copyFileSync(join(ROOT, path), join(root, path));
    }
    copyFileSync(join(ROOT, manifest), join(root, manifest));
    const path = join(root, 'harness/specs/fixtures/rsi-sekb-arms/report.v1.json');
    const report = JSON.parse(readFileSync(path, 'utf8'));
    report.claims.promotionReady = true;
    writeFileSync(path, JSON.stringify(report));
    writeFileSync(join(root, manifest), lines.map((line) => {
      const input = line.slice(66);
      return `${createHash('sha256').update(readFileSync(join(root, input))).digest('hex')}  ${input}`;
    }).join('\n') + '\n');
    expect(validateArmsPack(root).errors).toEqual(['report-recomputation']);
  });

  it.each(['partial-pair', 'shadow-drift', 'safety-violation', 'unknown-evidence', 'partial-cost'])(
    'review regression: refuses promotion for %s', (mutation) => {
      const root = tempRootWith((runs) => {
        improvingRun(runs);
        if (mutation === 'partial-pair') runs.arms['sekb-confirmed'].push({ caseId: 'partial', repeat: 1, success: false, tokens: 1000 });
        if (mutation === 'shadow-drift') runs.arms['sekb-shadow'][0].success = true;
        if (mutation === 'safety-violation') runs.arms['sekb-confirmed'][0].safetyViolation = true;
        if (mutation === 'unknown-evidence') delete runs.evidenceKind;
        if (mutation === 'partial-cost') delete runs.arms['sekb-confirmed'][0].tokens;
      });
      const report = buildArmsReport(root);
      expect(report.status).not.toBe('promote');
      expect(report.promotion.status).not.toBe('promote');
      expect(report.claims.promotionReady).toBe(false);
    });

  it('review regression: rejects an eligible comparison with the wrong baseline', () => {
    const protocol = readProtocol();
    protocol.comparisons.find((entry: any) => entry.role === 'promotion-eligible').baseline = 'sekb-shadow';
    expect(validateArmsProtocol(protocol).passed).toBe(false);
  });

  it('review regression: reports pass@k instead of silently omitting it', () => {
    expect(buildArmsReport(ROOT).arms['sekb-off'].passAtK).toEqual(expect.any(Number));
  });

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

  it('derives a promotion state for a real run instead of a bare insufficient-evidence', () => {
    const root = tempRootWith((runs) => {
      runs.evidenceKind = 'live-provider';
      runs.claims.providerCalls = 180;
      for (const arm of Object.values(runs.arms) as any[]) for (const row of arm) row.tokens = 1000;
    });
    const report = buildArmsReport(root);

    // The fixture improvement (0.1) does not clear a zero-containing interval,
    // so the promotion gate must hold rather than silently pass.
    expect(report.promotion.status).toBe('hold');
    expect(report.status).toBe('hold');
    expect(report.reasons.length).toBeGreaterThan(0);
    expect(report.claims.promotionReady).toBe(false);
  });

  it('reports numerical eligibility without authorizing promotion from an unverified run', () => {
    const root = tempRootWith((runs) => {
      runs.evidenceKind = 'live-provider';
      const off: any[] = [];
      const shadow: any[] = [];
      const confirmed: any[] = [];
      for (let index = 0; index < 20; index += 1) {
        for (let repeat = 1; repeat <= 3; repeat += 1) {
          off.push({ caseId: `case-${index}`, repeat, success: false, tokens: 1000 });
          shadow.push({ caseId: `case-${index}`, repeat, success: false, tokens: 1000 });
          confirmed.push({ caseId: `case-${index}`, repeat, success: index < 6, tokens: 1000 });
        }
      }
      runs.arms = { 'sekb-off': off, 'sekb-shadow': shadow, 'sekb-confirmed': confirmed };
      runs.claims = { benefit: false, promotionReady: false, productLocksChanged: false, realHuman: false, providerCalls: 180 };
    });
    const report = buildArmsReport(root);

    expect(report.promotion.status).toBe('promote');
    expect(report.status).toBe('promote');
    expect(report.claims.promotionReady).toBe(false);
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
