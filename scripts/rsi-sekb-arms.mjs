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
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { evaluateAblation, evaluatePromotion, summarizeCondition } from './lib/paired-ablation.mjs';
import { isMainEntrypoint } from './lib/entrypoint.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const ARMS_PROTOCOL_PATH = 'harness/specs/fixtures/rsi-sekb-arms/protocol.v1.json';
export const ARMS_RUNS_PATH = 'harness/specs/fixtures/rsi-sekb-arms/runs.v1.json';
export const ARMS_REPORT_PATH = 'harness/specs/fixtures/rsi-sekb-arms/report.v1.json';
const ARM_IDS = ['sekb-off', 'sekb-shadow', 'sekb-confirmed'];
const MANIFEST_PATH = 'harness/specs/fixtures/rsi-sekb-arms/SHA256SUMS';
const BOUND_PATHS = [ARMS_PROTOCOL_PATH, ARMS_RUNS_PATH, ARMS_REPORT_PATH,
  'harness/specs/fixtures/rsi-sekb-arms/decision.v1.json',
  'scripts/rsi-sekb-arms.mjs', 'scripts/rsi-sekb-arms.d.mts',
  'scripts/lib/paired-ablation.mjs', 'scripts/lib/paired-ablation.d.mts',
  'scripts/lib/reliability-aggregation.mjs',
  'tests/unit/rsi-sekb-arms.test.ts', 'tests/unit/rsi-sekb-arms-decision.test.ts'];
const manifest = (root) => BOUND_PATHS.map((path) => `${createHash('sha256').update(readFileSync(join(root, path))).digest('hex')}  ${path}`).join('\n') + '\n';

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
  if (protocol?.design?.confidenceLevel !== 0.95 || protocol?.design?.pairUnit !== 'caseId/repeat') errors.push(error('paired-design', 'the registered pairing and 95% interval are required'));
  if (protocol?.budget?.providerCallsAuthorized !== 0) errors.push(error('provider-calls', 'this instrument authorises zero provider calls'));
  if (!Number.isFinite(protocol?.budget?.costIncreaseMaximum) || protocol.budget.costIncreaseMaximum < 0 || protocol.budget.costIncreaseMaximum > 0.1) errors.push(error('cost-ceiling', 'cost ceiling must be between 0 and 10%'));
  const comparisons = protocol?.comparisons ?? [];
  const expectedComparisons = [
    ['shadow-vs-off', 'sekb-off', 'sekb-shadow', 'diagnostic'],
    ['confirmed-vs-off', 'sekb-off', 'sekb-confirmed', 'promotion-eligible'],
    ['confirmed-vs-shadow', 'sekb-shadow', 'sekb-confirmed', 'diagnostic'],
  ];
  if (comparisons.length !== 3 || expectedComparisons.some(([id, baseline, treatment, role]) =>
    !comparisons.some((entry) => entry.id === id && entry.baseline === baseline && entry.treatment === treatment && entry.role === role))) {
    errors.push(error('comparison', 'confirmed-vs-off must be the promotion-eligible comparison'));
  }
  if (protocol?.promotionRequirements?.passKAbsoluteImprovement !== 0.05
    || protocol?.promotionRequirements?.costIncreaseMaximum !== protocol?.budget?.costIncreaseMaximum
    || protocol?.promotionRequirements?.intervalLowerBoundStrictlyPositive !== true
    || protocol?.promotionRequirements?.zeroRegressionOnNegativeControls !== true) errors.push(error('promotion-requirements', 'frozen promotion requirements must agree with the budget'));
  if ((protocol?.negativeControls ?? []).length < 5) errors.push(error('negative-controls', 'at least five negative controls are required'));
  if (!(protocol?.decisionStates ?? []).includes('synthetic-wiring-only')) errors.push(error('decision-states', 'decisionStates must include synthetic-wiring-only'));
  return { passed: errors.length === 0, errors };
}

export function buildArmsPlan(protocol) {
  const cases = protocol.design.minimumCompleteCases;
  const k = protocol.design.k;
  return {
    schemaVersion: 'RsiSekbArmsPlan/v1',
    driven_by: 'agent',
    actor: 'codex/rsi-sekb-arms',
    status: 'awaiting-provider-envelope',
    arms: ARM_IDS,
    cases,
    k,
    trials: cases * k * ARM_IDS.length,
    providerCallsAuthorized: protocol.budget.providerCallsAuthorized,
    required: ['live provider endpoint + credential', 'token/turn/tool-call capture per trial', 'budget ceiling for the whole run'],
    rule: 'This plan executes nothing. A real three-arm run must be launched with a declared provider envelope.',
  };
}

export function buildArmsReport(root = ROOT) {
  const protocol = readJson(join(root, ARMS_PROTOCOL_PATH));
  const validation = validateArmsProtocol(protocol);
  if (!validation.passed) throw new Error(`invalid-arms-protocol: ${validation.errors.map((entry) => entry.code).join(', ')}`);
  const runs = readJson(join(root, ARMS_RUNS_PATH));
  if (runs.driven_by !== 'agent' || typeof runs.actor !== 'string' || !runs.actor.trim()
    || runs.k !== protocol.design.k || !runs.arms || ARM_IDS.some((id) => !Array.isArray(runs.arms[id]))
    || Object.keys(runs.arms).length !== ARM_IDS.length) throw new Error('invalid-arms-run');
  if (runs.claims?.realHuman === true || runs.claims?.productLocksChanged === true || runs.claims?.promotionReady === true) throw new Error('invalid-arms-claim');
  const k = protocol.design.k;
  const minCases = protocol.design.minimumCompleteCases;
  const arms = {};
  for (const id of ARM_IDS) arms[id] = summarizeCondition(runs.arms[id] ?? [], { k, minCases });
  const offTokens = arms['sekb-off'].meanTokens;
  const confirmedTokens = arms['sekb-confirmed'].meanTokens;
  // Use complete measurements and unrounded arithmetic for the ceiling.
  const costIncrease = offTokens !== null && confirmedTokens !== null
    ? offTokens > 0 ? (confirmedTokens - offTokens) / offTokens : confirmedTokens === 0 ? 0 : Infinity
    : null;
  const costWithinCeiling = costIncrease === null ? null : costIncrease <= protocol.budget.costIncreaseMaximum;
  const results = protocol.comparisons.map((entry) => {
    const result = evaluateAblation({
      baselineRuns: runs.arms[entry.baseline] ?? [],
      treatmentRuns: runs.arms[entry.treatment] ?? [],
      preRegistered: { primaryMetric: 'success', k, minCases, degradationBudget: 0, safetyMustHold: true,
        minimumImprovement: protocol.promotionRequirements.passKAbsoluteImprovement,
        costIncreaseMaximum: protocol.budget.costIncreaseMaximum, costIncrease },
    });
    return { entry, result };
  });
  const comparisons = results.map(({ entry, result }) => ({
      id: entry.id, role: entry.role,
      baseline: result.baseline.passK, treatment: result.treatment.passK,
      meanDiff: result.effect.meanDiff, ci95: result.effect.ci95,
      varianceStatus: result.effect.varianceStatus ?? (result.effect.sd === 0 ? 'degenerate' : 'estimated'),
      verdict: result.verdict, reasons: result.reasons,
    }));
  const synthetic = runs.evidenceKind === 'synthetic-wiring-fixture';
  const live = runs.evidenceKind === 'live-provider' && Number.isInteger(runs.claims?.providerCalls) && runs.claims.providerCalls > 0;
  const eligible = results.find(({ entry }) => entry.role === 'promotion-eligible').result;
  const offByKey = new Map(runs.arms['sekb-off'].map((run) => [`${run.caseId}::${run.repeat}`, run]));
  const shadowChanged = runs.arms['sekb-shadow'].some((run) => {
    const off = offByKey.get(`${run.caseId}::${run.repeat}`);
    return off && (Number(run.success) !== Number(off.success)
      || (run.outcome ?? (run.success ? 'pass' : 'fail')) !== (off.outcome ?? (off.success ? 'pass' : 'fail')));
  });
  const costMissing = costIncrease === null;
  const promotion = evaluatePromotion({
    minimumImprovement: protocol.promotionRequirements?.passKAbsoluteImprovement ?? 0.05,
    costIncreaseMaximum: protocol.promotionRequirements?.costIncreaseMaximum ?? protocol.budget.costIncreaseMaximum,
    costIncrease,
    meanDiff: eligible.effect.meanDiff,
    ci95: eligible.effect.ci95,
    integrityViolated: shadowChanged || comparisons.some((entry) => entry.verdict === 'safety-regression'),
    sampleSufficient: live && results.every(({ result }) => result.promotion.status !== 'insufficient-evidence'),
    unstable: Object.values(arms).some((arm) => arm.gate === 'fail'),
  });
  if (shadowChanged) promotion.reasons.push('shadow/off outcomes differ; shadow must not change behaviour');
  if (!live) promotion.reasons.push('no declared live-provider execution; statistical wiring cannot authorize promotion');
  const reasons = [];
  let status;
  if (synthetic) {
    // A deterministic wiring fixture can never be a promotion, whatever the numbers say.
    status = 'synthetic-wiring-only';
    reasons.push('deterministic wiring fixture; not a model run and never a benefit claim');
  } else {
    status = promotion.status;
    reasons.push(...promotion.reasons);
    if (status === 'insufficient-evidence' && Object.values(arms).some((arm) => arm.gate === 'insufficient-sample')) {
      reasons.push('below the complete-case floor');
    }
  }
  if (costWithinCeiling === false) reasons.push(`cost increase ${costIncrease} exceeds ${protocol.budget.costIncreaseMaximum}`);
  if (costMissing) reasons.push('cost dimension missing (null tokens); promotion is disqualified');

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
    promotion,
    claimBoundary: 'Numerical threshold readout only; independent execution and sealed candidate acceptance are required before promotion.',
    reasons,
    arms: Object.fromEntries(Object.entries(arms).map(([id, arm]) => [id, {
      completeCaseCount: arm.completeCaseCount, passK: arm.passK, passAtK: arm.passAtK,
      flakeRate: arm.flakeRate, meanTokens: arm.meanTokens, gate: arm.gate,
    }])),
    comparisons,
    cost: { offMeanTokens: offTokens, confirmedMeanTokens: confirmedTokens, relativeIncrease: costIncrease, ceiling: protocol.budget.costIncreaseMaximum, withinCeiling: costWithinCeiling, missing: costMissing },
    claims: {
      benefit: false,
      promotionReady: false,
      productLocksChanged: false, realHuman: false,
      providerCalls: runs.claims?.providerCalls ?? 0,
    },
  };
}

export function validateArmsPack(root = ROOT) {
  const errors = [];
  let report;
  try {
    report = buildArmsReport(root);
    const saved = readJson(join(root, ARMS_REPORT_PATH));
    if (JSON.stringify({ ...saved, generatedAt: null }) !== JSON.stringify({ ...report, generatedAt: null })) errors.push('report-recomputation');
    if (readFileSync(join(root, MANIFEST_PATH), 'utf8').replaceAll('\r\n', '\n') !== manifest(root)) errors.push('manifest-drift');
  } catch (caught) { errors.push(caught.message); }
  return { passed: errors.length === 0, errors, status: report?.status ?? 'invalid', reasons: report?.reasons ?? [] };
}

if (isMainEntrypoint(import.meta.url)) {
  const { values } = parseArgs({ options: { check: { type: 'boolean' }, write: { type: 'boolean' }, plan: { type: 'boolean' }, json: { type: 'boolean' } } });
  try {
    const protocol = readJson(join(ROOT, ARMS_PROTOCOL_PATH));
    const validation = validateArmsProtocol(protocol);
    if (values.plan) {
      console.log(JSON.stringify(buildArmsPlan(protocol), null, 2));
      process.exitCode = validation.passed ? 0 : 1;
    } else {
    const report = buildArmsReport(ROOT);
    if (values.write) {
      const target = join(ROOT, ARMS_REPORT_PATH);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
      writeFileSync(join(ROOT, MANIFEST_PATH), manifest(ROOT), 'utf8');
    }
    const result = values.check ? validateArmsPack(ROOT) : { passed: validation.passed, protocolValidation: validation, status: report.status, reasons: report.reasons };
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.passed ? 0 : 1;
    }
  } catch (caught) {
    console.error(caught.message);
    process.exitCode = 1;
  }
}
