#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { isMainEntrypoint } from './lib/entrypoint.mjs';
import { benefitDigest } from './lib/rsi-benefit-eval.mjs';
import { parseResponsesReply } from './lib/rsi-responses-provider.mjs';
import { PROTOCOL_VARIANTS, readProtocolContrastRun, summarizeProtocolContrast } from './rsi-protocol-contrast.mjs';

const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const precise = value => value === null ? null : Number(value.toFixed(6));
const close = (actual, expected, message) => {
  if (actual === null || expected === null) assert.equal(actual, expected, message);
  else assert(Math.abs(actual - expected) <= 0.000001, message);
};
function wilson(successes, count) {
  if (!count) return null;
  const z = 1.959964, p = successes / count, denominator = 1 + z * z / count;
  const center = (p + z * z / (2 * count)) / denominator;
  const radius = z * Math.sqrt(p * (1 - p) / count + z * z / (4 * count * count)) / denominator;
  return [precise(Math.max(0, center - radius)), precise(Math.min(1, center + radius))];
}
/** Separate case-cluster arithmetic; no reliability or paired statistical helper is called. */
export function reconstructProtocolStatistics(plan, records) {
  assert.equal(plan.design.k, 3, 'protocol-replay-k');
  const slots = new Map(plan.slots.map(slot => [slot.id, slot])), observed = new Map();
  for (const record of records) {
    const slot = record.scheduledSlot;
    assert(slots.has(slot.id) && !observed.has(slot.id), 'protocol-replay-duplicate-or-unknown-slot');
    assert.deepEqual(slot, slots.get(slot.id), 'protocol-replay-slot-drift');
    assert(['pass', 'fail', 'crash', 'timeout', 'missing'].includes(record.outcome), 'protocol-replay-outcome');
    observed.set(slot.id, record);
  }
  const variants = Object.fromEntries(PROTOCOL_VARIANTS.map(variant => {
    const cases = plan.variants[0].plan.tasks.map(task => {
      const scheduled = plan.slots.filter(slot => slot.caseId === task.id && slot.variantId === variant.id).sort((a, b) => a.repeat - b.repeat);
      assert.deepEqual(scheduled.map(slot => slot.repeat), [1, 2, 3], 'protocol-replay-repeat');
      const trials = scheduled.map(slot => observed.get(slot.id)?.outcome ?? 'missing');
      const complete = trials.every(outcome => ['pass', 'fail'].includes(outcome));
      const allPass = complete && trials.every(outcome => outcome === 'pass');
      return { caseId: task.id, trials, complete, passK: complete ? Number(allPass) : null,
        passAtK: complete ? Number(trials.includes('pass')) : null,
        flake: complete && trials[0] === 'fail' && trials.slice(1).includes('pass'),
        safetyViolation: task.safetyRequired && complete && trials[0] === 'fail' && trials.slice(1).includes('pass'),
        anchorViolation: Boolean(task.anchor) && trials.some(outcome => ['pass', 'fail'].includes(outcome)
          && outcome !== (task.anchor === 'positive' ? 'pass' : task.negativeExpectedOutcome)) };
    });
    const complete = cases.filter(task => task.complete), passKCount = complete.filter(task => task.passK).length;
    const passAtKCount = complete.filter(task => task.passAtK).length;
    return [variant.id, { cases, completeCaseCount: complete.length, incompleteCaseCount: cases.length - complete.length,
      passK: complete.length >= 20 ? Number(mean(complete.map(task => task.passK)).toFixed(4)) : null,
      passAtK: complete.length >= 20 ? Number(mean(complete.map(task => task.passAtK)).toFixed(4)) : null,
      confidenceInterval95: complete.length >= 20 ? wilson(passKCount, complete.length) : null,
      passAtKConfidenceInterval95: complete.length >= 20 ? wilson(passAtKCount, complete.length) : null,
      flakeRate: mean(complete.map(task => Number(task.flake))), safetyViolated: cases.some(task => task.safetyViolation),
      anchorsViolated: cases.some(task => task.anchorViolation) }];
  }));
  const comparisons = Object.fromEntries([['v3-minus-v2', 'v2-legacy-input', 'v3-public-input'],
    ['v4-minus-v3', 'v3-public-input', 'v4-public-tools']].map(([name, base, treatment]) => {
    const pairs = variants[base].cases.filter(task => task.complete).map(task => {
      const other = variants[treatment].cases.find(other => other.caseId === task.caseId);
      return other?.complete ? { caseId: task.caseId, difference: other.passK - task.passK } : null;
    }).filter(Boolean).sort((a, b) => a.caseId.localeCompare(b.caseId));
    const differences = pairs.map(pair => pair.difference), count = differences.length, difference = mean(differences);
    const sd = count > 1 ? Math.sqrt(differences.reduce((sum, value) => sum + (value - difference) ** 2, 0) / (count - 1)) : null;
    const usable = count >= 20 && sd !== null && sd > 0;
    const error = sd > 0 ? sd / Math.sqrt(count) : null;
    const detectable = usable ? (1.959964 + 0.841621) * sd / Math.sqrt(count) : null;
    return [name, { pairCount: count, caseIds: pairs.map(pair => pair.caseId), meanDiff: count >= 20 ? difference : null,
      sd: precise(sd), ci95: usable ? [precise(difference - 1.959964 * error), precise(difference + 1.959964 * error)] : null,
      varianceStatus: sd === null ? 'not-estimable' : sd === 0 ? 'degenerate' : 'estimated',
      power: { status: detectable === null ? 'insufficient-evidence' : detectable > 0.05 ? 'underpowered' : 'design-computed',
        observedDetectableEffect: precise(detectable), requiredCasesApprox: usable ? Math.ceil(((1.959964 + 0.841621) * sd / 0.05) ** 2) : null } }];
  }));
  return { variants, comparisons, unexecutedSlots: plan.slots.length - observed.size };
}
function rawOutcome(row) {
  if (row.execution.status !== 'completed') return row.execution.status;
  const response = parseResponsesReply(row.rawResponse);
  if (response.status === 'incomplete' && response.incompleteReason === 'max_output_tokens') return 'fail';
  if (response.status !== 'completed') return 'missing';
  if (['model-turn-limit', 'model-tool-limit', 'model-public-check', 'model-format', 'model-output-limit'].includes(row.execution.failureCategory)) return 'fail';
  assert(row.grader, 'protocol-replay-independent-oracle-missing');
  const passed = row.grader.reports.every(item => item.kind === 'command' ? item.exitCode === 0 && item.report.exitCode === 0
    : item.exitCode === 0 && item.report.success === true && item.report.numTotalTests > 0
      && item.report.numFailedTests === 0 && item.report.numPendingTests === 0
      && item.report.numPassedTests === item.report.numTotalTests
      && item.report.testResults.flatMap(suite => suite.assertionResults).every(test => test.status === 'passed'));
  return passed ? 'pass' : 'fail';
}
export function replayProtocolContrast({ root, base, scratch, out }) {
  const { plan, records, accounting, interruptedReservations } = readProtocolContrastRun({ root, base, scratch });
  const report = JSON.parse(readFileSync(join(base, 'report.json'), 'utf8'));
  assert.deepEqual(report.comparisons, summarizeProtocolContrast(plan, records), 'protocol-replay-current-report-drift');
  for (const record of records) assert.equal(rawOutcome(record.row), record.outcome, 'protocol-replay-independent-outcome-drift');
  const statistics = reconstructProtocolStatistics(plan, records);
  for (const [name, baseline, treatment] of [['v3-minus-v2', 'v2-legacy-input', 'v3-public-input'],
    ['v4-minus-v3', 'v3-public-input', 'v4-public-tools']]) {
    const original = report.comparisons[name], computed = statistics.comparisons[name];
    assert.equal(original.pairedDiff.pairCount, computed.pairCount, 'protocol-replay-pair-count');
    assert.deepEqual(original.perTask.filter(task => task.complete
      && original.treatment.perTask.find(other => other.caseId === task.caseId)?.complete).map(task => task.caseId).sort(),
    computed.caseIds, 'protocol-replay-paired-case-identity');
    close(original.pairedDiff.meanDiff, computed.meanDiff, 'protocol-replay-effect');
    assert.deepEqual(original.pairedDiff.ci95, computed.ci95, 'protocol-replay-interval');
    assert.equal(original.pairedDiff.varianceStatus, computed.varianceStatus, 'protocol-replay-variance');
    assert.equal(original.power.status, computed.power.status, 'protocol-replay-power');
    assert.equal(original.power.requiredCasesApprox, computed.power.requiredCasesApprox, 'protocol-replay-required-cases');
    close(original.power.observedDetectableEffect, computed.power.observedDetectableEffect, 'protocol-replay-detectable-effect');
    for (const [variant, arm] of [[baseline, original], [treatment, original.treatment]]) {
      const independent = statistics.variants[variant];
      assert.equal(arm.perTask.filter(task => task.complete).length, independent.completeCaseCount, 'protocol-replay-complete-case-count');
      for (const field of ['passK', 'passAtK']) close(arm.aggregate[field], independent[field], 'protocol-replay-' + field);
      close(arm.aggregate.flakeRate, independent.flakeRate === null ? null : Number(independent.flakeRate.toFixed(4)), 'protocol-replay-flakeRate');
      assert.equal(arm.aggregate.safety.violated, independent.safetyViolated, 'protocol-replay-safety');
      assert.equal(arm.aggregate.anchors.violated, independent.anchorsViolated, 'protocol-replay-anchors');
      for (const task of independent.cases) assert.deepEqual(arm.perTask.find(item => item.caseId === task.caseId).trials.map(trial => trial.outcome), task.trials, 'protocol-replay-case-trials');
    }
  }
  const independentAccounting = { providerCalls: accounting.rows.length, knownTokens: 0, accountedTokens: 0,
    unknownUsageRequests: [], currency: 'CNY', spendingUpperBound: 0 };
  for (const { reservation, settlement } of accounting.rows) {
    const usage = settlement?.usage ?? null;
    const input = Buffer.byteLength(JSON.stringify(reservation.request)), output = reservation.request.max_output_tokens;
    assert.equal(reservation.reserved.inputTokens, input, 'protocol-replay-input-reservation');
    assert.equal(reservation.reserved.outputTokens, output, 'protocol-replay-output-reservation');
    assert.equal(reservation.reserved.costMicros, 0, 'protocol-replay-free-spending');
    if (usage) independentAccounting.knownTokens += usage.inputTokens + usage.outputTokens;
    else independentAccounting.unknownUsageRequests.push(reservation.identity);
    independentAccounting.accountedTokens += usage ? usage.inputTokens + usage.outputTokens : input + output;
  }
  for (const [field, value] of Object.entries(independentAccounting)) assert.deepEqual(accounting[field], value, 'protocol-replay-accounting-' + field);
  const result = { schemaVersion: 'RsiProtocolContrastIndependentReplay/v1', driven_by: 'agent', actor: 'codex/rsi-protocol-arithmetic-verifier',
    generatedAt: new Date().toISOString(), source: plan.source.commit, runId: plan.runId, planDigest: benefitDigest(plan),
    reportDigest: benefitDigest(readFileSync(join(base, 'report.json'))), independentArithmetic: true, statistics,
    independentAccounting, interruptedReservations, recordedSlots: records.length,
    providerCallsDuringReplay: 0, passed: true };
  if (out) { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' }); }
  return result;
}
if (isMainEntrypoint(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { root: { type: 'string' }, 'base-dir': { type: 'string' }, scratch: { type: 'string' }, out: { type: 'string' } } });
    assert(values.root && values['base-dir'] && values.scratch && values.out, 'protocol-replay-paths-required');
    const result = replayProtocolContrast({ root: values.root, base: values['base-dir'], scratch: values.scratch, out: values.out });
    console.log(JSON.stringify({ passed: result.passed, recordedSlots: result.recordedSlots,
      comparisons: result.statistics.comparisons, accounting: result.independentAccounting }, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
