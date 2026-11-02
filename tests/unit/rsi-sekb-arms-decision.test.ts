// @vitest-environment node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  ARMS_PROTOCOL_PATH,
  ARMS_RUNS_PATH,
  buildArmsPlan,
  buildArmsReport,
  validateArmsProtocol,
} from '../../scripts/rsi-sekb-arms.mjs';

const ROOT = process.cwd();
const DECISION_PATH = 'harness/specs/fixtures/rsi-sekb-arms/decision.v1.json';
const MANIFEST_PATH = 'harness/specs/fixtures/rsi-sekb-arms/SHA256SUMS';
const readJson = (path: string) => JSON.parse(readFileSync(join(ROOT, path), 'utf8'));

describe('RSI SEKB three-arm decision boundary', () => {
  it('records insufficient evidence when no provider envelope or budget exists', () => {
    const protocol = readJson(ARMS_PROTOCOL_PATH);
    const runs = readJson(ARMS_RUNS_PATH);
    const report = buildArmsReport(ROOT);
    const decision = readJson(DECISION_PATH);
    const plan = buildArmsPlan(protocol);

    expect(validateArmsProtocol(protocol).passed).toBe(true);
    expect(runs.evidenceKind).toBe('synthetic-wiring-fixture');
    expect(report.status).toBe('synthetic-wiring-only');
    expect(report.claims).toMatchObject({ benefit: false, promotionReady: false, providerCalls: 0 });
    expect(plan).toMatchObject({ status: 'awaiting-provider-envelope', trials: 180, providerCallsAuthorized: 0 });
    expect(decision).toMatchObject({
      status: 'insufficient-evidence',
      providerEnvelope: {
        status: 'not-provided',
        endpointDeclared: false,
        credentialDeclared: false,
        wholeRunBudgetDeclared: false,
        providerCallsAuthorized: 0,
      },
      execution: { plannedTrials: 180, executedModelTrials: 0 },
      verdict: {
        observedBenefit: false,
        promotionReady: false,
        syntheticFixtureMayPromote: false,
        productLocksChanged: false,
        realHuman: false,
      },
    });
  });

  it('keeps every frozen contract/baseline file hash-readable', () => {
    const lines = readFileSync(join(ROOT, MANIFEST_PATH), 'utf8').trim().split(/\r?\n/u);
    expect(lines.length).toBeGreaterThanOrEqual(6);
    for (const line of lines) {
      const match = line.match(/^([0-9a-f]{64}) {2}(.+)$/u);
      expect(match).not.toBeNull();
      const [, expected, path] = match!;
      const actual = createHash('sha256').update(readFileSync(join(ROOT, path))).digest('hex');
      expect(actual, path).toBe(expected);
    }
  });
});
