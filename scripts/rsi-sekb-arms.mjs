#!/usr/bin/env node
/**
 * TF-0598 three-arm readout: SEKB off / shadow / confirmed.
 *
 * The two-arm RSI instrument cannot answer "does the experience loop change
 * outcomes" because it has no no-loop baseline. This adds the third arm and the
 * pairwise comparisons, reusing the shared paired instrument for the statistics
 * so there is still exactly one inference unit (the case cluster).
 *
 * It never promotes from a synthetic fixture: a deterministic wiring fixture
 * can only produce `synthetic-wiring-only`.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { evaluateAblation, summarizeCondition } from './lib/paired-ablation.mjs';
import { isMainEntrypoint } from './lib/entrypoint.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const ARMS_PROTOCOL_PATH = 'harness/specs/fixtures/rsi-sekb-arms/protocol.v1.json';
export const ARMS_RUNS_PATH = 'harness/specs/fixtures/rsi-sekb-arms/runs.v1.json';
export const ARMS_REPORT_PATH = 'harness/specs/fixtures/rsi-sekb-arms/report.v1.json';
const ARM_IDS = ['sekb-off', 'sekb-shadow', 'sekb-confirmed'];

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const error = (code, message) => ({ code, message });

export function validateArmsProtocol(protocol) {
  const errors = [];
  if (protocol?.schemaVersion !== 'RsiSekbArmsProtocol/v1') errors.push(error('schema-version', 'unexpected protocol schema'));
  if (protocol?.driven_by !== 'agent' || !protocol?.actor) errors.push(error('agent-label', 'protocol needs an agent actor'));
  const ids = (protocol?.arms ?? []).map((arm) => arm.id);
  if (ids.length !== 3 || ARM_IDS.some((id) => !ids.includes(id))) errors.push(error('arms', `arms must be exactly ${ARM_IDS.join(', ')}`));
  if (protocol?.design?.k !== 3) errors.push(error('k', 'k must be 3'));
  if (protocol?.design?.minimumCompleteCases !== 20) errors.push(error('floor', 'minimumCompleteCases must be 20'));
  if (protocol?.design?.inferenceUnit !== 'caseId') errors.push(error('inference-unit', 'inference unit must be the case cluster'));
  if (protocol?.budget?.providerCallsAuthorized !== 0) errors.push(error('provider-calls', 'this instrument authorises zero provider calls'));
  if (!(protocol?.budget?.costIncreaseMaximum <= 0.1)) errors.push(error('cost-ceiling', 'cost ceiling must be <= 10%'));
  if (!(protocol?.comparisons ?? []).some((entry) => entry.role === 'promotion-eligible' && entry.treatment === 'sekb-confirmed')) {
    errors.push(error('comparison', 'confirmed-vs-off must be the promotion-eligible comparison'));
  }
  if ((protocol?.negativeControls ?? []).length < 5) errors.push(error('negative-controls', 'at least five negative controls are required'));
  if (!(protocol?.decisionStates ?? []).includes('synthetic-wiring-only')) errors.push(error('decision-states', 'decisionStates must include synthetic-wiring-only'));
  return { passed: errors.length === 0, errors };
}

export function buildArmsReport(root = ROOT) {
  const protocol = readJson(join(root, ARMS_PROTOCOL_PATH));
  const runs = readJson(join(root, ARMS_RUNS_PATH));
  const k = protocol.design.k;
  const minCases = protocol.design.minimumCompleteCases;
  const arms = {};
  for (const id of ARM_IDS) arms[id] = summarizeCondition(runs.arms[id] ?? [], { k, minCases });
  const comparisons = protocol.comparisons.map((entry) => {
    const result = evaluateAblation({
      baselineRuns: runs.arms[entry.baseline] ?? [],
      treatmentRuns: runs.arms[entry.treatment] ?? [],
      preRegistered: { primaryMetric: 'success', k, minCases, degradationBudget: 0 },
    });
    return {
      id: entry.id, role: entry.role,
      baseline: result.baseline.passK, treatment: result.treatment.passK,
      meanDiff: result.effect.meanDiff, ci95: result.effect.ci95,
      varianceStatus: result.effect.varianceStatus ?? (result.effect.sd === 0 ? 'degenerate' : 'estimated'),
      verdict: result.verdict, reasons: result.reasons,
    };
  });
  const offTokens = arms['sekb-off'].meanTokens;
  const confirmedTokens = arms['sekb-confirmed'].meanTokens;
  const costIncrease = offTokens && confirmedTokens !== null ? Number((confirmedTokens / offTokens - 1).toFixed(4)) : null;
  const costWithinCeiling = costIncrease === null ? null : costIncrease <= protocol.budget.costIncreaseMaximum;
  const synthetic = runs.evidenceKind === 'synthetic-wiring-fixture';
  const reasons = [];
  let status = 'insufficient-evidence';
  if (synthetic) {
    status = 'synthetic-wiring-only';
    reasons.push('deterministic wiring fixture; not a model run and never a benefit claim');
  } else if (Object.values(arms).some((arm) => arm.gate === 'insufficient-sample')) {
    reasons.push('below the complete-case floor');
  }
  if (costWithinCeiling === false) reasons.push(`cost increase ${costIncrease} exceeds ${protocol.budget.costIncreaseMaximum}`);
  if (runs.claims?.promotionReady === true) reasons.push('fixture/run claims promotion; refused');

  return {
    schemaVersion: 'RsiSekbArmsReport/v1',
    generatedAt: new Date().toISOString(),
    driven_by: 'agent',
    actor: 'codex/rsi-sekb-arms',
    taskForestNode: 'TF-0598',
    protocolPath: ARMS_PROTOCOL_PATH,
    runsPath: ARMS_RUNS_PATH,
    evidenceKind: runs.evidenceKind ?? 'unknown',
    status,
    reasons,
    arms: Object.fromEntries(Object.entries(arms).map(([id, arm]) => [id, {
      completeCaseCount: arm.completeCaseCount, passK: arm.passK, passAtK: arm.passAtK,
      flakeRate: arm.flakeRate, meanTokens: arm.meanTokens, gate: arm.gate,
    }])),
    comparisons,
    cost: { offMeanTokens: offTokens, confirmedMeanTokens: confirmedTokens, relativeIncrease: costIncrease, ceiling: protocol.budget.costIncreaseMaximum, withinCeiling: costWithinCeiling },
    claims: { benefit: false, promotionReady: false, productLocksChanged: false, realHuman: false, providerCalls: 0 },
  };
}

if (isMainEntrypoint(import.meta.url)) {
  const { values } = parseArgs({ options: { check: { type: 'boolean' }, write: { type: 'boolean' }, json: { type: 'boolean' } } });
  try {
    const protocol = readJson(join(ROOT, ARMS_PROTOCOL_PATH));
    const validation = validateArmsProtocol(protocol);
    const report = buildArmsReport(ROOT);
    if (values.write) {
      const target = join(ROOT, ARMS_REPORT_PATH);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    }
    const result = { passed: validation.passed, protocolValidation: validation, status: report.status, reasons: report.reasons };
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = validation.passed ? 0 : 1;
  } catch (caught) {
    console.error(caught.message);
    process.exitCode = 1;
  }
}