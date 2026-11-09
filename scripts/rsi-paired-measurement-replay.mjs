#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { isMainEntrypoint } from './lib/entrypoint.mjs';

const ARMS = ['sekb-off', 'sekb-shadow', 'sekb-confirmed'];
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const round = (value, digits = 6) => value === null ? null : Number(value.toFixed(digits));
const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
function wilson(successes, total) {
  if (!total) return null;
  const z = 1.959964, p = successes / total, divisor = 1 + z * z / total;
  const center = (p + z * z / (2 * total)) / divisor;
  const radius = z / divisor * Math.sqrt(p * (1 - p) / total + z * z / (4 * total * total));
  return [round(Math.max(0, center - radius)), round(Math.min(1, center + radius))];
}

/** Reconstruct case statistics without the frozen reliability or paired helpers. */
export function reconstructPairedStatistics(plan, records) {
  assert.equal(plan.design.k, 3, 'replay-k-drift');
  assert.equal(new Set(plan.tasks.map(task => task.id)).size, plan.tasks.length, 'replay-duplicate-task');
  const slots = new Map(plan.slots.map(slot => [slot.id, slot]));
  assert.equal(slots.size, plan.slots.length, 'replay-duplicate-slot');
  const observed = new Map();
  for (const record of records) {
    assert(slots.has(record.slot.id) && !observed.has(record.slot.id), 'replay-duplicate-or-unknown-receipt');
    assert.deepEqual(record.slot, slots.get(record.slot.id), 'replay-slot-drift');
    assert(['pass', 'fail', 'crash', 'timeout', 'missing'].includes(record.outcome), 'replay-outcome');
    observed.set(record.slot.id, record);
  }
  const arms = Object.fromEntries(ARMS.map(arm => {
    const cases = plan.tasks.map(task => {
      const scheduled = plan.slots.filter(slot => slot.caseId === task.id && slot.arm === arm).sort((a, b) => a.repeat - b.repeat);
      assert.deepEqual(scheduled.map(slot => slot.repeat), [1, 2, 3], 'replay-repeat-schedule');
      const trials = scheduled.map(slot => observed.get(slot.id)?.outcome ?? 'missing');
      const complete = trials.every(outcome => ['pass', 'fail'].includes(outcome));
      return { caseId: task.id, trials, complete, passK: complete ? trials.every(value => value === 'pass') : null,
        passAtK: complete ? trials.includes('pass') : null,
        flake: complete && trials[0] === 'fail' && trials.slice(1).includes('pass') };
    });
    const complete = cases.filter(item => item.complete), enough = complete.length >= plan.design.minimumCompleteCases;
    const ratio = count => enough ? round(count / complete.length, 4) : null;
    const safetyCases = cases.filter(item => plan.tasks.find(task => task.id === item.caseId).safetyRequired === true);
    const anchors = cases.filter(item => plan.tasks.find(task => task.id === item.caseId).anchor);
    const anchorFailures = anchors.filter(item => {
      const task = plan.tasks.find(task => task.id === item.caseId);
      const expected = task.anchor === 'negative' ? task.negativeExpectedOutcome ?? 'fail' : 'pass';
      return item.complete && !item.trials.every(value => value === expected);
    }).map(item => item.caseId);
    const safetyFlakes = safetyCases.filter(item => item.flake).map(item => item.caseId);
    const incompleteSafety = safetyCases.filter(item => !item.complete).map(item => item.caseId);
    return [arm, { cases, completeCaseCount: complete.length, incompleteCaseCount: cases.length - complete.length,
      passK: ratio(complete.filter(item => item.passK).length), passAtK: ratio(complete.filter(item => item.passAtK).length),
      confidenceInterval95: enough ? wilson(complete.filter(item => item.passK).length, complete.length) : null,
      passAtKConfidenceInterval95: enough ? wilson(complete.filter(item => item.passAtK).length, complete.length) : null,
      flakeRate: complete.length ? round(complete.filter(item => item.flake).length / complete.length, 4) : null,
      safety: { violated: safetyFlakes.length + incompleteSafety.length > 0, safetyFlakes, incompleteSafety },
      anchors: { violated: anchorFailures.length > 0, anchorFailures } }];
  }));
  const comparisons = Object.fromEntries(['sekb-shadow', 'sekb-confirmed'].map(arm => {
    const pairs = arms['sekb-off'].cases.map((baseline, index) => ({ baseline, treatment: arms[arm].cases[index] }))
      .filter(pair => pair.baseline.complete && pair.treatment.complete);
    const diffs = pairs.map(pair => Number(pair.treatment.passK) - Number(pair.baseline.passK));
    const average = mean(diffs), enough = pairs.length >= plan.design.minimumCompleteCases;
    const sd = diffs.length > 1 ? Math.sqrt(diffs.reduce((sum, diff) => sum + (diff - average) ** 2, 0) / (diffs.length - 1)) : null;
    const usable = enough && sd !== null && sd > 0;
    const detectable = usable ? (1.959964 + 0.841621) * sd / Math.sqrt(pairs.length) : null;
    return [arm, { pairCount: pairs.length, caseIds: pairs.map(pair => pair.baseline.caseId),
      descriptiveMeanDiff: average, meanDiff: enough ? average : null,
      ci95: usable ? [round(average - 1.959964 * sd / Math.sqrt(pairs.length)), round(average + 1.959964 * sd / Math.sqrt(pairs.length))] : null,
      effectSize: usable ? round(average / sd) : null, varianceStatus: sd === null ? 'not-estimable' : sd === 0 ? 'degenerate' : 'estimated',
      power: { status: detectable === null ? 'insufficient-evidence' : detectable > 0.05 ? 'underpowered' : 'design-computed',
        observedDetectableEffect: round(detectable), requiredCasesApprox: usable ? Math.ceil(((1.959964 + 0.841621) * sd / 0.05) ** 2) : null } }];
  }));
  return { arms, comparisons, missing: plan.slots.filter(slot => !observed.has(slot.id)).map(slot => slot.id),
    incomplete: records.filter(record => !['pass', 'fail'].includes(record.outcome)).map(record => record.slot.id) };
}

function rawOutcome(row, parseResponse) {
  assert.equal(row.execution.providerCalls, row.providerAttempts.length, 'replay-provider-count');
  const responses = row.providerAttempts.map(attempt => {
    const parsed = attempt.rawResponse ? parseResponse(attempt.rawResponse) : null;
    assert.deepEqual(parsed, attempt.parsedResponse, 'replay-raw-response-drift');
    return parsed;
  });
  if (row.execution.status !== 'completed') return { outcome: row.execution.status, responses };
  const response = responses.at(-1);
  assert(response, 'replay-missing-completed-response');
  if (response.status === 'incomplete' && response.incompleteReason === 'max_output_tokens' && response.usage) return { outcome: 'fail', responses };
  if (response.status !== 'completed') return { outcome: 'missing', responses };
  if (['model-turn-limit', 'model-tool-limit', 'model-format', 'model-public-check'].includes(row.execution.failureCategory)) {
    assert.equal(row.grader, null, 'replay-invalid-failure-grade');
    return { outcome: 'fail', responses };
  }
  assert(row.grader?.reports?.length > 0, 'replay-independent-grade-required');
  const passed = row.grader.reports.every(item => item.exitCode === 0 && (item.kind === 'command' ? item.report.exitCode === 0
    : item.report.success === true && item.report.numTotalTests > 0 && item.report.numFailedTests === 0
      && item.report.numPendingTests === 0 && item.report.testResults.flatMap(suite => suite.assertionResults).every(test => test.status === 'passed')));
  return { outcome: passed ? 'pass' : 'fail', responses };
}

export async function replayPairedMeasurement({ root, base, scratch, out }) {
  root = resolve(root); base = resolve(base); scratch = resolve(scratch); out = resolve(out);
  assert(!existsSync(out), 'replay-output-already-exists');
  const directory = join(base, 'measurement'), plan = read(join(directory, 'plan.json'));
  assert.equal(plan.collector.version, 'RsiCodingCollector/v4', 'replay-v4-required');
  for (const [path, digest] of Object.entries(plan.source.bindings)) {
    assert.equal(hash(readFileSync(join(root, path), 'utf8').replace(/\r\n?/gu, '\n')), digest, 'replay-source-drift:' + path);
  }
  const fromRoot = path => import(pathToFileURL(join(root, path)).href);
  const { parseResponsesReply } = await fromRoot('scripts/lib/rsi-responses-provider.mjs');
  const { checkBenefitRun } = await fromRoot('scripts/lib/rsi-benefit-eval.mjs');
  const { reconcileCampaign } = await fromRoot('scripts/rsi-paired-measurement.mjs');
  const originalCheck = checkBenefitRun(root, directory);
  assert(originalCheck.errors.every(error => ['unexecuted-slots', 'incomplete-slots'].includes(error)), originalCheck.errors.join(', '));
  const records = [], rawIds = new Set(), outcomeCounts = { pass: 0, fail: 0, crash: 0, timeout: 0, missing: 0 };
  let knownTrialTokens = 0, unknownTrialRequests = 0, trialProviderCalls = 0, toolCalls = 0;
  for (const slot of plan.slots) {
    const path = join(directory, 'trials', slot.id + '.json');
    if (!existsSync(path)) continue;
    const row = read(path);
    assert.deepEqual(row, read(join(scratch, slot.id, 'receipt.json')), 'replay-private-receipt-drift');
    const { outcome, responses } = rawOutcome(row, parseResponsesReply);
    outcomeCounts[outcome]++; records.push({ slot, outcome });
    trialProviderCalls += row.execution.providerCalls; toolCalls += row.execution.toolEvents.length;
    for (const response of responses) {
      if (response) { assert(!rawIds.has(response.id), 'replay-reused-provider-response'); rawIds.add(response.id); }
      if (response?.usage) knownTrialTokens += response.usage.totalTokens; else unknownTrialRequests++;
    }
  }
  const statistics = reconstructPairedStatistics(plan, records), report = read(join(directory, 'report.json'));
  assert.deepEqual(statistics.missing, report.coverage.missing, 'replay-missing-projection');
  assert.deepEqual(statistics.incomplete, report.coverage.incomplete, 'replay-incomplete-projection');
  for (const [arm, key] of [['sekb-shadow', 'shadowVsOff'], ['sekb-confirmed', 'confirmedVsOff']]) {
    const comparison = report.comparisons[key], computed = statistics.comparisons[arm];
    assert.equal(comparison.pairedDiff.pairCount, computed.pairCount, 'replay-paired-case-count');
    assert.equal(comparison.pairedDiff.meanDiff, computed.meanDiff, 'replay-paired-difference');
    assert.deepEqual(comparison.pairedDiff.ci95, computed.ci95, 'replay-paired-interval');
    assert.deepEqual(comparison.power.status, computed.power.status, 'replay-power-status');
    assert.deepEqual(comparison.power.requiredCasesApprox, computed.power.requiredCasesApprox, 'replay-sample-planning');
    for (const [currentArm, original] of [['sekb-off', comparison], [arm, comparison.treatment]]) {
      const computedArm = statistics.arms[currentArm];
      assert.equal(original.completeCaseCount, computedArm.completeCaseCount, 'replay-complete-case-count');
      for (const field of ['passK', 'passAtK', 'flakeRate', 'confidenceInterval95', 'passAtKConfidenceInterval95']) {
        assert.deepEqual(original.aggregate[field], computedArm[field], 'replay-arm-' + field);
      }
      assert.equal(original.aggregate.safety.violated, computedArm.safety.violated, 'replay-safety');
      assert.equal(original.aggregate.anchors.violated, computedArm.anchors.violated, 'replay-anchors');
      for (const item of computedArm.cases) {
        assert.deepEqual(original.perTask.find(task => task.caseId === item.caseId).trials.map(trial => trial.outcome), item.trials, 'replay-case-outcomes');
      }
    }
  }
  assert.equal(report.cost.providerCalls, trialProviderCalls, 'replay-trial-calls');
  assert.equal(report.cost.totalTokens, unknownTrialRequests ? null : knownTrialTokens, 'replay-trial-tokens');
  const manifest = readFileSync(join(directory, 'SHA256SUMS'), 'utf8').trim().split(/\r?\n/u);
  for (const line of manifest) {
    const match = line.match(/^([a-f0-9]{64}) {2}(.+)$/u); assert(match, 'replay-manifest-line');
    const path = resolve(directory, match[2]); assert(path.startsWith(resolve(directory) + sep), 'replay-manifest-path');
    assert.equal(hash(readFileSync(path)), match[1], 'replay-manifest-drift:' + match[2]);
  }
  const accounting = reconcileCampaign(base, { root, scratch });
  assert.equal(accounting.trialProviderCalls, trialProviderCalls, 'replay-ledger-trial-count');
  const ledger = join(scratch, 'campaign-ledger');
  const reservations = readdirSync(ledger).filter(name => name.endsWith('.reservation.json')).sort();
  const independentAccounting = { providerCalls: reservations.length, knownTokens: 0, accountedTokens: 0,
    unknownUsageRequests: [], currency: plan.budget.campaign.authorization.currency, spendingUpperBound: 0 };
  assert.equal(plan.budget.campaign.billing.kind, 'existing-free-quota', 'replay-quota-only-price-basis');
  for (const name of reservations) {
    const reservation = read(join(ledger, name)), settlementPath = join(ledger, name.replace('.reservation.', '.settlement.'));
    const usage = existsSync(settlementPath) ? read(settlementPath).usage : null;
    if (usage) independentAccounting.knownTokens += usage.totalTokens;
    else independentAccounting.unknownUsageRequests.push(reservation.identity);
    independentAccounting.accountedTokens += usage?.totalTokens ?? reservation.reserved.inputTokens + reservation.reserved.outputTokens;
    assert.equal(reservation.reserved.costMicros, 0, 'replay-free-spending-reservation');
  }
  for (const [field, value] of Object.entries(independentAccounting)) assert.deepEqual(accounting[field], value, 'replay-independent-accounting-' + field);
  const integrityViolated = Object.values(statistics.arms).some(arm => arm.safety.violated || arm.anchors.violated);
  if (integrityViolated) assert.equal(report.status, 'eliminate', 'replay-safety-decision');
  const result = { schemaVersion: 'RsiPairedIndependentReplay/v1', driven_by: 'agent', actor: 'codex/rsi-v4-arithmetic-verifier',
    generatedAt: new Date().toISOString(), runId: plan.runId, frozenSource: plan.source.commit,
    verifierSource: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: resolve(dirname(fileURLToPath(import.meta.url)), '..'), encoding: 'utf8', windowsHide: true }).trim(),
    independentArithmetic: true, verifierKind: 'separate-computational-role', plannedSlots: plan.slots.length,
    recordedSlots: records.length, unexecutedSlots: statistics.missing.length, outcomeCounts,
    trialProviderCalls, terminalResponses: rawIds.size, knownTrialTokens, unknownTrialRequests, toolCalls,
    statistics, accounting, independentAccounting, originalCompletionCheck: originalCheck, manifestEntries: manifest.length,
    originalReportDigest: hash(readFileSync(join(directory, 'report.json'))),
    decision: { status: report.status, benefit: report.claims.benefit, safetyOrAnchorViolation: integrityViolated,
      minimumImprovement: plan.design.minimumImprovement, requiredCi95LowerPositive: true,
      costIncreaseMaximum: plan.design.costIncreaseMaximum, productAdoption: 'hold' },
    providerCallsDuringReplay: 0, passed: true };
  mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  return result;
}

if (isMainEntrypoint(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { root: { type: 'string' }, 'base-dir': { type: 'string' }, scratch: { type: 'string' }, out: { type: 'string' } } });
    assert(values.root && values['base-dir'] && values.scratch && values.out, 'root, base-dir, scratch and new out path required');
    const result = await replayPairedMeasurement({ root: values.root, base: values['base-dir'], scratch: values.scratch, out: values.out });
    console.log(JSON.stringify({ passed: result.passed, outcomeCounts: result.outcomeCounts, recordedSlots: result.recordedSlots,
      unexecutedSlots: result.unexecutedSlots, accounting: result.accounting, decision: result.decision }, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
