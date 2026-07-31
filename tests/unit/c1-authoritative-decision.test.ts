import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { buildC1AuthoritativeDecision } from '../../scripts/c1-authoritative-decision.mjs';

const root = process.cwd();
const tempRoots: string[] = [];
type JsonObject = Record<string, unknown>;
const sourcePaths = [
  'artifacts/coding-c1/ab-metrics.json',
  'artifacts/dcs-canary/c1/ab-metrics.json',
  'artifacts/dcs-canary/c1/decision.json',
];

function makeEvidenceRoot(): string {
  const targetRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'c1-authority-'));
  tempRoots.push(targetRoot);
  for (const relativePath of sourcePaths) {
    const target = path.join(targetRoot, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, relativePath), target);
  }
  return targetRoot;
}

function mutateJson(
  targetRoot: string,
  relativePath: string,
  mutate: (value: JsonObject) => void,
): void {
  const target = path.join(targetRoot, relativePath);
  const value = JSON.parse(fs.readFileSync(target, 'utf8'));
  mutate(value);
  fs.writeFileSync(target, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

afterEach(() => {
  for (const targetRoot of tempRoots.splice(0)) {
    fs.rmSync(targetRoot, { recursive: true, force: true });
  }
});

describe('FP-P4-05 authoritative C1 gate corpus', () => {
  it('selects real-tool execution over the larger synthetic scale corpus', () => {
    const decision = buildC1AuthoritativeDecision(root);

    expect(decision.metric).toMatchObject({ threshold: 5 });
    expect(decision.authority).toMatchObject({
      corpusId: 'coding-c1-hand-authored-real-tools',
      role: 'gate-authority',
      fixtureCount: 4,
      meanOffCalls: 4.5,
      meanOnCalls: 1,
      reductionFactor: 4.5,
      live: false,
      meetsMetricThreshold: false,
    });
    expect(decision.references).toEqual([
      expect.objectContaining({
        role: 'reference-only',
        evidenceClass: 'simulated-arm-synthetic',
        fixtureCount: 32,
        reductionFactor: 5.125,
        meetsSimulationThreshold: true,
        eligibleForGateAuthority: false,
        live: false,
      }),
    ]);
    expect(decision.decision).toMatchObject({
      meetsGate: false,
      recommendation: 'keep-off',
      defaultOn: false,
      liveReady: false,
      productApproved: false,
    });
  });

  it('fails closed when the synthetic corpus is promoted to authority', () => {
    const targetRoot = makeEvidenceRoot();
    mutateJson(targetRoot, sourcePaths[1], (value) => {
      const definition = value.reductionDefinition as JsonObject;
      definition.role = 'gate-authority';
      definition.eligibleForGateAuthority = true;
    });

    expect(() => buildC1AuthoritativeDecision(targetRoot)).toThrow(
      'C1 synthetic corpus must remain reference-only',
    );
  });

  it('fails closed when the authoritative formula, ratio, or historical value drifts', () => {
    const formulaRoot = makeEvidenceRoot();
    mutateJson(formulaRoot, sourcePaths[0], (value) => {
      const definition = value.reductionDefinition as JsonObject;
      definition.formula = 'mean(pair reductions)';
    });
    expect(() => buildC1AuthoritativeDecision(formulaRoot)).toThrow('C1 authority formula drifted');

    const ratioRoot = makeEvidenceRoot();
    mutateJson(ratioRoot, sourcePaths[0], (value) => {
      value.avgReduction = 5;
    });
    expect(() => buildC1AuthoritativeDecision(ratioRoot)).toThrow(
      'C1 authority reduction does not equal ratio of means',
    );

    const historicalValueRoot = makeEvidenceRoot();
    mutateJson(historicalValueRoot, sourcePaths[0], (value) => {
      const pairs = value.pairs as JsonObject[];
      pairs[0].offCalls = 6;
      value.avgReduction = 4.75;
      const definition = value.reductionDefinition as JsonObject;
      definition.meanOffCalls = 4.75;
    });
    expect(() => buildC1AuthoritativeDecision(historicalValueRoot)).toThrow(
      'historical real-tool reduction must remain 4.5x',
    );
  });

  it('fails closed when synthetic packaging claims live or default-on readiness', () => {
    const targetRoot = makeEvidenceRoot();
    mutateJson(targetRoot, sourcePaths[2], (value) => {
      value.recommendation = 'default-on';
      value.liveReady = true;
      value.productApproved = true;
    });

    expect(() => buildC1AuthoritativeDecision(targetRoot)).toThrow(
      'C1 synthetic decision must remain keep-off',
    );
  });
});
