#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { isMainEntrypoint } from './lib/entrypoint.mjs';
import { adoptLiveCalibration, benefitDigest, buildBenefitRequest, createBenefitPlan,
  validateBenefitPlan, validateProtocolContrastTrial, verifyCodingAdmission } from './lib/rsi-benefit-eval.mjs';
import { createCampaignLedger, validateCampaignBudget } from './lib/rsi-campaign-budget.mjs';
import { parseResponsesReply } from './lib/rsi-responses-provider.mjs';
import { sha256File } from './rsi-tf0604-baseline.mjs';
import { summarizeTf0592Trials } from './rsi-tf0592-statistical-adjudication.mjs';
import { collectCodingTrial } from './rsi-coding-collector.mjs';
import { calibrateLiveTask, finalizeLiveAdmission, probeLiveResource } from './rsi-live-acceptance.mjs';
import { inspectCachedModel, inspectFreeQuota } from './rsi-paired-measurement.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PROTOCOL_VARIANTS = Object.freeze([
  { id: 'v2-legacy-input', version: 'RsiCodingCollector/v2', callsPerSlot: 1 },
  { id: 'v3-public-input', version: 'RsiCodingCollector/v3', callsPerSlot: 1 },
  { id: 'v4-public-tools', version: 'RsiCodingCollector/v4', callsPerSlot: 4 },
]);
const SOURCES = ['scripts/rsi-protocol-contrast.mjs', 'scripts/rsi-protocol-contrast.d.mts',
  'scripts/rsi-protocol-contrast-replay.mjs', 'scripts/rsi-protocol-contrast-replay.d.mts',
  'scripts/lib/rsi-campaign-budget.mjs', 'scripts/lib/rsi-campaign-budget.d.mts',
  'scripts/rsi-paired-measurement.mjs', 'tests/unit/rsi-protocol-contrast.test.ts',
  'harness/specs/fixtures/rsi-protocol-contrast/authorization-20261109.v1.json',
  'harness/specs/tasks/rsi-protocol-contrast.md', 'harness/specs/rules/rsi-protocol-contrast-boundary.md'];
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const git = (root, args) => execFileSync('git', args, { cwd: root, windowsHide: true, encoding: 'utf8' }).trim();
function write(path, value, exclusive = true) {
  mkdirSync(dirname(path), { recursive: true });
  const bytes = JSON.stringify(value, null, 2) + '\n';
  if (exclusive) writeFileSync(path, bytes, { flag: 'wx' });
  else {
    const temp = path + '.' + randomUUID() + '.tmp';
    writeFileSync(temp, bytes, { flag: 'wx' }); renameSync(temp, path);
  }
}
function tempPath(path) {
  const full = resolve(path), rel = relative(resolve('D:/tmp'), full);
  assert(rel && !rel.startsWith('..') && !rel.includes(':'), 'protocol-scratch-must-be-under-D-tmp');
  return full;
}
export function protocolTaskIdentity(task) {
  const fields = ['id', 'taskId', 'split', 'safetyRequired', 'anchor', 'negativeExpectedOutcome',
    'prompt', 'acceptanceCriteria', 'targetScope', 'source', 'baselineSetup', 'oracleDigest', 'oracle', 'oracleTestDigests'];
  return Object.fromEntries(fields.map(key => [key, task[key]]));
}
function schedule(variants) {
  return variants[0].plan.tasks.flatMap((task, index) => [1, 2, 3].flatMap(repeat => {
    const offset = (index + repeat - 1) % 3;
    return [0, 1, 2].map(order => {
      const variant = variants[(order + offset) % 3];
      const slot = variant.plan.slots.find(slot => slot.caseId === task.id && slot.repeat === repeat && slot.arm === 'sekb-off');
      return { id: task.id + '-' + repeat + '-' + variant.id, variantId: variant.id, caseId: task.id,
        repeat, benefitSlotId: slot.id, taskIdentityDigest: benefitDigest(protocolTaskIdentity(task)) };
    });
  })).map((slot, position) => ({ ...slot, position }));
}
export function createProtocolContrastPlan(root, { campaign, runId = randomUUID(), actor = 'codex/rsi-protocol-contrast' }) {
  validateCampaignBudget(campaign);
  assert(campaign.authorization.maxProviderCalls === 433 && campaign.authorization.maxTotalTokens === 12000000
    && campaign.authorization.maxCost === 0 && campaign.billing.kind === 'existing-free-quota', 'protocol-authorized-envelope-required');
  const candidate = read(join(root, 'harness/specs/fixtures/rsi-coding-cohort/candidate.json'));
  const variants = PROTOCOL_VARIANTS.map(variant => ({ ...variant, plan: createBenefitPlan(root, {
    mode: 'measured', codingCollector: true, collectorVersion: variant.version, candidate,
    endpoint: campaign.endpoint, model: campaign.model, actor: actor + '/' + variant.id, runId: runId + '/' + variant.id,
    maxProviderCalls: campaign.authorization.maxProviderCalls, maxTotalTokens: campaign.authorization.maxTotalTokens,
  }) }));
  for (const variant of variants) assert.deepEqual(variant.plan.tasks.map(protocolTaskIdentity),
    variants[0].plan.tasks.map(protocolTaskIdentity), 'protocol-task-identity-drift');
  const paths = [...new Set([...SOURCES, ...variants.flatMap(variant => Object.keys(variant.plan.source.bindings))])].sort();
  return { schemaVersion: 'RsiProtocolContrastPlan/v1', driven_by: 'agent', actor, runId, createdAt: new Date().toISOString(),
    evidenceKind: 'live-provider', source: { commit: git(root, ['rev-parse', 'HEAD']), tree: git(root, ['rev-parse', 'HEAD^{tree}']),
      bindings: Object.fromEntries(paths.map(path => [path, sha256File(join(root, path))])) },
    campaign, variants, taskIds: variants[0].plan.tasks.map(task => task.id), slots: schedule(variants),
    design: { k: 3, minimumCompleteCases: 20, plannedSlots: 216, contextArm: 'sekb-off', order: 'rotating-version-by-case-repeat',
      inferenceUnit: 'caseId', comparisons: ['v3-minus-v2', 'v4-minus-v3'], minimumImprovement: 0.05, costIncreaseMaximum: 0.1 },
    claims: { realHuman: false, experienceBenefit: false, promotionReady: false, productDefaultsChanged: false } };
}
export function validateProtocolContrastPlan(root, plan) {
  assert.equal(plan?.schemaVersion, 'RsiProtocolContrastPlan/v1', 'protocol-plan-version');
  validateCampaignBudget(plan.campaign);
  assert(plan.driven_by === 'agent' && plan.evidenceKind === 'live-provider' && typeof plan.actor === 'string'
    && typeof plan.runId === 'string' && Number.isFinite(Date.parse(plan.createdAt)), 'protocol-plan-identity');
  assert.deepEqual(plan.campaign.authorization && [plan.campaign.authorization.maxProviderCalls,
    plan.campaign.authorization.maxTotalTokens, plan.campaign.authorization.maxCost], [433, 12000000, 0], 'protocol-resource-drift');
  assert.equal(plan.campaign.billing.kind, 'existing-free-quota', 'protocol-free-quota-required');
  assert.deepEqual(plan.variants.map(({ id, version, callsPerSlot }) => ({ id, version, callsPerSlot })), PROTOCOL_VARIANTS, 'protocol-variant-drift');
  for (const variant of plan.variants) {
    validateBenefitPlan(variant.plan, root);
    assert.equal(variant.plan.runId, plan.runId + '/' + variant.id, 'protocol-run-identity-drift');
    assert.equal(variant.plan.actor, plan.actor + '/' + variant.id, 'protocol-actor-drift');
    assert.equal(variant.plan.collector.version, variant.version, 'protocol-collector-drift');
    assert.deepEqual(variant.plan.provider, { endpoint: plan.campaign.endpoint, model: plan.campaign.model, maxOutputTokens: 16000 }, 'protocol-provider-drift');
    assert.equal(variant.plan.source.commit, plan.source.commit, 'protocol-source-candidate-drift');
    assert.deepEqual(variant.plan.tasks.map(protocolTaskIdentity), plan.variants[0].plan.tasks.map(protocolTaskIdentity), 'protocol-task-identity-drift');
  }
  assert.deepEqual(plan.taskIds, plan.variants[0].plan.tasks.map(task => task.id), 'protocol-task-set-drift');
  assert.deepEqual(plan.slots, schedule(plan.variants), 'protocol-schedule-drift');
  assert.deepEqual(plan.design, { k: 3, minimumCompleteCases: 20, plannedSlots: 216, contextArm: 'sekb-off',
    order: 'rotating-version-by-case-repeat', inferenceUnit: 'caseId', comparisons: ['v3-minus-v2', 'v4-minus-v3'],
    minimumImprovement: 0.05, costIncreaseMaximum: 0.1 }, 'protocol-design-drift');
  assert.deepEqual(plan.claims, { realHuman: false, experienceBenefit: false, promotionReady: false, productDefaultsChanged: false }, 'protocol-claim-drift');
  const paths = [...new Set([...SOURCES, ...plan.variants.flatMap(variant => Object.keys(variant.plan.source.bindings))])].sort();
  assert.deepEqual(plan.source.bindings, Object.fromEntries(paths.map(path => [path, sha256File(join(root, path))])), 'protocol-source-drift');
  assert.equal(git(root, ['rev-parse', plan.source.commit + '^{tree}']), plan.source.tree, 'protocol-source-tree-drift');
  git(root, ['merge-base', '--is-ancestor', plan.source.commit, 'HEAD']);
  return true;
}
function load(root, base) {
  const path = join(base, 'plan.json'), plan = read(path), price = read(join(base, 'price-basis.v1.json'));
  assert.equal(readFileSync(join(base, 'plan.sha256'), 'utf8').trim(), benefitDigest(readFileSync(path)), 'protocol-plan-seal-drift');
  validateProtocolContrastPlan(root, plan);
  assert.equal(plan.campaign.billing.evidenceDigest, benefitDigest(price), 'protocol-price-evidence-drift');
  assert.deepEqual(read(join(base, 'authorization.v1.json')).authorization, plan.campaign.authorization, 'protocol-authorization-drift');
  for (const variant of plan.variants) {
    const directory = join(base, 'variants', variant.id), bytes = readFileSync(join(directory, 'plan.json'));
    assert.deepEqual(JSON.parse(bytes), variant.plan, 'protocol-variant-plan-copy-drift');
    assert.equal(readFileSync(join(directory, 'plan.sha256'), 'utf8').trim(), benefitDigest(bytes), 'protocol-variant-plan-seal-drift');
  }
  return { plan, price };
}
export function prefixProtocolLedger(ledger, variantId) {
  assert(PROTOCOL_VARIANTS.some(variant => variant.id === variantId), 'unknown-protocol-variant');
  return { ...ledger, reserve: (request, identity) => ledger.reserve(request, variantId + '/' + identity) };
}
function budgetContext(plan, rows) {
  const tokens = rows.reduce((sum, row) => sum + (row.settlement?.usage?.totalTokens
    ?? row.reservation.reserved.inputTokens + row.reservation.reserved.outputTokens), 0);
  return { schemaVersion: 'RsiProtocolContrastBudgetAtStart/v1',
    remainingTokens: plan.campaign.authorization.maxTotalTokens - tokens,
    remainingProviderCalls: plan.campaign.authorization.maxProviderCalls - rows.length };
}
function checkLedgerResponse(entry, attempt) {
  assert(entry, 'protocol-unreserved-dispatch');
  assert.deepEqual(entry.reservation.request, attempt.request, 'protocol-ledger-request-drift');
  const parsed = attempt.rawResponse === null ? null : parseResponsesReply(attempt.rawResponse);
  assert.deepEqual(parsed, attempt.parsedResponse, 'protocol-raw-parsed-drift');
  assert(entry.settlement, 'protocol-dispatch-unsettled');
  assert.deepEqual(entry.settlement.usage, parsed?.usage ?? null, 'protocol-ledger-usage-drift');
  assert.equal(entry.settlement.responseId, parsed?.id ?? null, 'protocol-ledger-response-id-drift');
  assert.equal(entry.settlement.responseDigest, attempt.rawResponse === null ? null : benefitDigest(attempt.rawResponse), 'protocol-ledger-response-digest-drift');
}
function checkOracleOutputs(directory, oracle) {
  for (const [index, entry] of oracle.executions.entries()) {
    const stem = String(index + 1).padStart(2, '0');
    const stdout = join(directory, stem + '-stdout.log'), stderr = join(directory, stem + '-stderr.log');
    assert(existsSync(stdout) && existsSync(stderr), 'protocol-raw-oracle-output-missing');
    if (entry.kind === 'command') {
      assert.equal(sha256File(stdout), entry.report.stdoutDigest, 'protocol-raw-oracle-stdout-drift');
      assert.equal(sha256File(stderr), entry.report.stderrDigest, 'protocol-raw-oracle-stderr-drift');
    } else assert.deepEqual(read(join(directory, stem + '-vitest-report.json')), entry.report, 'protocol-raw-vitest-report-drift');
  }
}
function retainedTrial(scratch, scheduled, row) {
  const directory = join(scratch, scheduled.variantId, row.slot.id);
  assert.deepEqual(read(join(directory, 'receipt.json')), row, 'protocol-private-receipt-drift');
  assert.equal(read(join(directory, 'receipt-digest.json')).sha256, benefitDigest(row), 'protocol-private-receipt-seal-drift');
  if (row.execution.providerCalls > 0) {
    const marker = read(join(directory, 'dispatch.json'));
    assert.equal(marker.planDigest, row.planDigest, 'protocol-dispatch-plan-drift');
    assert.deepEqual(marker.request, row.request, 'protocol-dispatch-request-drift');
  }
  const toolLoop = scheduled.variantId === 'v4-public-tools';
  for (const [index, attempt] of row.providerAttempts.entries()) {
    if (attempt.rawResponse === null) continue;
    const provider = read(join(directory, toolLoop ? 'provider-response-' + (index + 1) + '.json' : 'provider-response.json'));
    assert.deepEqual(provider.rawResponse, attempt.rawResponse, 'protocol-provider-file-drift');
    assert.deepEqual(provider.response, attempt.parsedResponse, 'protocol-provider-parsed-file-drift');
    assert.deepEqual(provider.request.body, attempt.request, 'protocol-provider-request-file-drift');
  }
  for (const [index, event] of row.execution.toolEvents.entries()) {
    assert.deepEqual(read(join(directory, 'tool-event-' + (index + 1) + '.json')), event, 'protocol-tool-file-drift');
  }
  if (row.grader) {
    const oracle = read(join(directory, 'oracle/run-report.json'));
    assert(oracle.driven_by === 'agent' && oracle.actor === 'codex/rsi-live-grader', 'protocol-raw-oracle-actor');
    assert.equal(oracle.oracleRevision, row.grader.oracleRevision, 'protocol-raw-oracle-reference-drift');
    assert.deepEqual(oracle.baselineSetup ?? null, row.grader.baselineSetup ?? null, 'protocol-raw-oracle-baseline-drift');
    assert.deepEqual(oracle.oracleTestDigests, row.grader.oracleTestDigests, 'protocol-raw-oracle-test-drift');
    assert(oracle.oracleUnchanged === true && oracle.oracleHashBefore === oracle.oracleHashAfter, 'protocol-raw-oracle-byte-drift');
    assert.equal(oracle.failureClass, row.grader.failureClass, 'protocol-raw-oracle-failure-drift');
    assert.deepEqual(oracle.commands, row.grader.commands, 'protocol-raw-oracle-command-drift');
    const reports = oracle.executions.map(entry => ({ command: entry.command, kind: entry.kind, exitCode: entry.exitCode, report: entry.report }));
    assert.deepEqual(reports, row.grader.reports, 'protocol-raw-oracle-report-drift');
    checkOracleOutputs(join(directory, 'oracle'), oracle);
  }
}
export function readProtocolContrastRun({ root = ROOT, base, scratch }) {
  const { plan, price } = load(root, base);
  const ledger = createCampaignLedger({ directory: join(scratch, 'campaign-ledger'), campaign: plan.campaign,
    verifyPriceBasis: () => { throw Error('read-only-replay'); } });
  const accounting = ledger.snapshot(), rows = accounting.rows, records = [], ids = new Set();
  let consumed = 0, previous = null, missing = false;
  const preflightPath = join(base, 'admission/provider-preflight.json');
  if (existsSync(preflightPath)) {
    const probe = read(preflightPath);
    if (probe.rawResponse) {
      assert.equal(rows[0]?.reservation.identity, 'provider-preflight', 'protocol-preflight-sequence');
      checkLedgerResponse(rows[0], { request: probe.request.body, rawResponse: probe.rawResponse, parsedResponse: probe.response });
      ids.add(probe.response.id); consumed = 1;
    } else if (rows[0]?.reservation.identity === 'provider-preflight') {
      assert((rows[0].settlement?.usage ?? null) === null, 'protocol-failed-preflight-usage'); consumed = 1;
    }
  }
  for (const scheduled of plan.slots) {
    const path = join(base, 'trials', scheduled.id + '.json');
    if (!existsSync(path)) { missing = true; continue; }
    assert(!missing, 'protocol-trial-prefix-required');
    const envelope = read(path), variant = plan.variants.find(variant => variant.id === scheduled.variantId);
    assert.equal(envelope.schemaVersion, 'RsiProtocolContrastTrial/v1', 'protocol-envelope-version');
    assert(envelope.driven_by === 'agent' && envelope.actor === plan.actor + '/recorder', 'protocol-envelope-actor');
    assert.deepEqual(Object.keys(envelope).sort(), ['actor', 'budgetAtStart', 'driven_by', 'ledgerPrefixCount',
      'receipt', 'receiptDigest', 'scheduledSlot', 'schemaVersion', 'studyDigest'], 'protocol-envelope-fields');
    assert.equal(envelope.studyDigest, benefitDigest(plan), 'protocol-envelope-plan-drift');
    assert.deepEqual(envelope.scheduledSlot, scheduled, 'protocol-envelope-slot-drift');
    assert.equal(envelope.ledgerPrefixCount, consumed, 'protocol-ledger-prefix-count-drift');
    assert.deepEqual(envelope.budgetAtStart, budgetContext(plan, rows.slice(0, consumed)), 'protocol-budget-start-ledger-drift');
    const start = read(join(base, 'starts', scheduled.id + '.json'));
    assert.deepEqual(start, { studyDigest: envelope.studyDigest, scheduledSlot: scheduled,
      ledgerPrefixCount: consumed, budgetAtStart: envelope.budgetAtStart }, 'protocol-start-receipt-drift');
    const row = envelope.receipt;
    assert.equal(row.slot.id, scheduled.benefitSlotId, 'protocol-benefit-slot-drift');
    assert.equal(envelope.receiptDigest, benefitDigest(row), 'protocol-receipt-digest-drift');
    const validated = validateProtocolContrastTrial(root, variant.plan, row, envelope.budgetAtStart);
    retainedTrial(scratch, scheduled, row);
    assert(!previous || Date.parse(row.execution.startedAt) >= Date.parse(previous.execution.endedAt), 'protocol-overlapping-or-reordered-slots');
    previous = row;
    for (const [index, attempt] of row.providerAttempts.entries()) {
      assert.equal(rows[consumed]?.reservation.identity, scheduled.variantId + '/' + row.slot.id + '/' + (index + 1), 'protocol-ledger-identity-order-drift');
      checkLedgerResponse(rows[consumed++], attempt);
      if (attempt.parsedResponse) {
        assert(!ids.has(attempt.parsedResponse.id), 'protocol-reused-response'); ids.add(attempt.parsedResponse.id);
      }
    }
    records.push({ ...validated, scheduledSlot: scheduled, envelope });
  }
  const interruptedReservations = rows.slice(consumed).map(row => row.reservation.identity);
  if (interruptedReservations.length) {
    const next = plan.slots[records.length];
    const interruptedPreflight = records.length === 0 && interruptedReservations.length === 1
      && interruptedReservations[0] === 'provider-preflight';
    assert(interruptedPreflight || next && interruptedReservations.every(id => id.startsWith(next.variantId + '/' + next.benefitSlotId + '/')),
      'protocol-orphan-ledger-request');
    assert(interruptedPreflight || existsSync(join(base, 'starts', next.id + '.json')), 'protocol-interrupted-start-missing');
  }
  const resourceLimitViolations = [accounting.providerCalls > 433 ? 'provider-calls' : null,
    accounting.accountedTokens > 12000000 ? 'tokens' : null, accounting.spendingUpperBound > 0 ? 'new-spending' : null].filter(Boolean);
  if (records.length) {
    for (const variant of plan.variants) verifyCodingAdmission(root, join(base, 'variants', variant.id), variant.plan);
    for (const taskId of plan.taskIds) {
      const calibration = read(join(base, 'admission/calibration', taskId, 'admission.json'));
      for (const stage of ['reference', 'baseline']) {
        const directory = join(base, 'admission/calibration', taskId, stage, 'oracle'), oracle = read(join(directory, 'run-report.json'));
        const expected = calibration.stages[stage];
        for (const key of Object.keys(oracle)) assert.deepEqual(oracle[key], expected[key], 'protocol-raw-admission-stage-drift:' + key);
        checkOracleOutputs(directory, oracle);
      }
    }
  }
  return { plan, price, records, accounting, interruptedReservations, resourceLimitViolations, terminalResponses: ids.size };
}
export function summarizeProtocolContrast(plan, records) {
  const lookup = new Map(records.map(record => [record.scheduledSlot.id, record]));
  assert.equal(lookup.size, records.length, 'protocol-duplicate-result');
  const corpus = { cases: plan.variants[0].plan.tasks.map(task => ({ id: task.id, taskId: task.taskId,
    safetyRequired: task.safetyRequired, ...(task.anchor ? { anchor: task.anchor } : {}), negativeExpectedOutcome: task.negativeExpectedOutcome })) };
  const pairs = [['v3-minus-v2', 'v2-legacy-input', 'v3-public-input'], ['v4-minus-v3', 'v3-public-input', 'v4-public-tools']];
  return Object.fromEntries(pairs.map(([name, baseline, treatment]) => [name, summarizeTf0592Trials(corpus,
    { cases: corpus.cases.map(task => ({ caseId: task.id, trials: plan.slots.filter(slot => slot.caseId === task.id
      && [baseline, treatment].includes(slot.variantId)).map(slot => {
      const record = lookup.get(slot.id);
      return { arm: slot.variantId === baseline ? 'baseline' : 'treatment', repeat: slot.repeat,
        outcome: record?.outcome ?? 'missing', failureClass: record?.failureClass ?? (record ? null : 'infrastructure'),
        tokens: record?.tokens ?? null, turns: record?.turns ?? null, toolCalls: record?.toolCalls ?? null,
        wallClockMs: record?.row.execution.wallClockMs ?? null, cost: null };
    }) })) }, plan.variants[0].plan.policy)]));
}
export function sealProtocolContrastRun(options) {
  const result = readProtocolContrastRun(options), { plan, records, accounting } = result;
  const comparisons = summarizeProtocolContrast(plan, records);
  const outcomes = Object.fromEntries(['pass', 'fail', 'crash', 'timeout', 'missing'].map(outcome => [outcome, records.filter(record => record.outcome === outcome).length]));
  const report = { schemaVersion: 'RsiProtocolContrastReport/v1', driven_by: 'agent', actor: 'codex/rsi-protocol-verifier',
    runId: plan.runId, source: plan.source.commit, planDigest: benefitDigest(plan), recordedSlots: records.length,
    plannedSlots: 216, unexecutedSlots: 216 - records.length, outcomeCounts: outcomes,
    variants: Object.fromEntries(PROTOCOL_VARIANTS.map(variant => [variant.id, { recorded: records.filter(record => record.scheduledSlot.variantId === variant.id).length,
      outcomes: Object.fromEntries(Object.keys(outcomes).map(outcome => [outcome, records.filter(record => record.scheduledSlot.variantId === variant.id && record.outcome === outcome).length])) }])),
    failureCategories: records.reduce((counts, record) => { const category = record.row.execution.failureCategory ?? 'none'; counts[category] = (counts[category] ?? 0) + 1; return counts; }, {}),
    comparisons, accounting: { ...accounting, rows: undefined }, interruptedReservations: result.interruptedReservations,
    resourceLimitViolations: result.resourceLimitViolations,
    decision: { status: result.resourceLimitViolations.length === 0 && Object.values(comparisons).every(comparison => comparison.promotion.status === 'promote') ? 'protocol-gates-pass' : 'NO_GO',
      productAdoption: 'hold', retainedExperienceCampaign: 'NO_GO/eliminate' },
    claims: { realHuman: false, liveProvider: result.terminalResponses > 0, experienceBenefit: false, promotionReady: false,
      protocolEffectsMeasured: Object.values(comparisons).every(comparison => comparison.pairedDiff.pairCount >= 20), productDefaultsChanged: false } };
  write(join(options.base, 'report.json'), report, false);
  return report;
}
export function prepareProtocolContrast({ root = ROOT, base, authorization, quotaDatabase }) {
  base = tempPath(base); assert(!existsSync(base), 'new-protocol-campaign-required');
  assert.equal(git(root, ['status', '--porcelain']), '', 'protocol-clean-source-required');
  assert.deepEqual(authorization, read(join(root, 'harness/specs/fixtures/rsi-protocol-contrast/authorization-20261109.v1.json')).authorization,
    'protocol-owner-authorization-drift');
  const endpoint = 'http://127.0.0.1:3065/v1/responses', model = 'space-bunny';
  const snapshot = inspectCachedModel(quotaDatabase, model), quota = inspectFreeQuota(quotaDatabase, model);
  const price = { schemaVersion: 'RsiCampaignPriceBasis/v1', driven_by: 'agent', actor: 'codex/rsi-protocol-price-verifier',
    endpoint, model: snapshot.model, modelSnapshot: snapshot, quota, currency: 'CNY',
    newSpendingPerRequestUpperBoundCny: 0, tokenTariff: null, upstreamCreditDebit: null, upstreamInvoice: null };
  const campaign = { schemaVersion: 'RsiCampaignBudget/v1', driven_by: 'agent', actor: 'codex/rsi-protocol-budget', endpoint, model, authorization,
    billing: { kind: 'existing-free-quota', currency: 'CNY', provider: 'workbuddy', plan: 'Free', newPurchaseAllowed: false,
      evidenceDigest: benefitDigest(price), creditMultiplier: snapshot.model.credits } };
  const plan = createProtocolContrastPlan(root, { campaign });
  validateProtocolContrastPlan(root, plan);
  write(join(base, 'plan.json'), plan);
  writeFileSync(join(base, 'plan.sha256'), benefitDigest(readFileSync(join(base, 'plan.json'))) + '\n', { flag: 'wx' });
  write(join(base, 'authorization.v1.json'), { driven_by: 'agent', actor: 'codex/rsi-protocol-authorization-recorder', authorization });
  write(join(base, 'price-basis.v1.json'), price);
  for (const variant of plan.variants) {
    const directory = join(base, 'variants', variant.id);
    write(join(directory, 'plan.json'), variant.plan);
    writeFileSync(join(directory, 'plan.sha256'), benefitDigest(readFileSync(join(directory, 'plan.json'))) + '\n', { flag: 'wx' });
  }
  return { base, runId: plan.runId, source: plan.source.commit, slots: plan.slots.length, campaignDigest: benefitDigest(campaign) };
}
export async function calibrateProtocolContrast({ root = ROOT, base, supportRoot }) {
  const { plan } = load(root, base), admission = join(base, 'admission');
  assert.equal(read(join(supportRoot, 'node_modules/markdown-it/package.json')).version, '14.2.0', 'protocol-support-version-drift');
  for (const task of plan.variants[0].plan.tasks) {
    if (existsSync(join(admission, 'calibration', task.id, 'admission.json'))) continue;
    const result = await calibrateLiveTask(root, admission, task.id, { codingCohort: true, timeoutMs: 300000, supportRoot });
    console.log(JSON.stringify({ calibrated: task.id, passed: result.admission.passed, issues: result.admission.issues }));
    if (result.admission.passed) for (const stage of ['reference', 'baseline']) {
      const workspace = resolve(admission, 'calibration', task.id, stage, 'workspace');
      assert(workspace.startsWith(resolve(base) + sep), 'protocol-unsafe-calibration-cleanup');
      if (existsSync(workspace)) rmSync(workspace, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  }
  const report = finalizeLiveAdmission(root, admission, { write: false });
  return { calibrated: report.admissions.length, admitted: report.admissions.filter(task => task.passed).length,
    passed: report.admissions.every(task => task.passed), providerCalls: 0 };
}
export async function runProtocolContrast({ root = ROOT, base, scratch, supportRoot, quotaDatabase, apiKey, limit = 216 }) {
  base = tempPath(base); scratch = tempPath(scratch);
  assert(Number.isSafeInteger(limit) && limit > 0 && limit <= 216, 'protocol-slot-limit');
  const { plan, price } = load(root, base), admission = join(base, 'admission');
  assert.equal(git(root, ['status', '--porcelain', '--', ...Object.keys(plan.source.bindings)]), '', 'protocol-uncommitted-evaluator');
  for (const [path, digest] of Object.entries(plan.source.bindings)) {
    assert.equal(benefitDigest(execFileSync('git', ['show', plan.source.commit + ':' + path], { cwd: root, windowsHide: true,
      encoding: 'utf8' }).replace(/\r\n?/gu, '\n')), digest, 'protocol-source-not-in-candidate:' + path);
  }
  assert.equal(read(join(supportRoot, 'node_modules/markdown-it/package.json')).version, '14.2.0', 'protocol-support-version-drift');
  mkdirSync(scratch, { recursive: true }); const lock = join(scratch, 'study.lock');
  if (existsSync(lock)) {
    const owner = read(lock);
    try { process.kill(owner.pid, 0); assert.fail('protocol-study-in-progress'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
    unlinkSync(lock);
  }
  write(lock, { pid: process.pid, studyDigest: benefitDigest(plan) });
  const ledger = createCampaignLedger({ directory: join(scratch, 'campaign-ledger'), campaign: plan.campaign,
    verifyPriceBasis: () => {
      const snapshot = inspectCachedModel(quotaDatabase, plan.campaign.model);
      assert.deepEqual(snapshot.model, price.model, 'protocol-current-model-price-drift');
      const quota = inspectFreeQuota(quotaDatabase, plan.campaign.model);
      assert.equal(quota.routesDigest, price.quota.routesDigest, 'protocol-current-route-drift');
      return { ...quota, modelSnapshot: snapshot };
    } });
  let written = 0, stopReason = null, originalError = null;
  try {
    const localAdmission = finalizeLiveAdmission(root, admission, { write: false });
    assert(localAdmission.admissions.every(task => task.passed), 'protocol-local-admission-not-ready');
    if (!existsSync(join(admission, 'provider-preflight.json'))) {
      assert.equal(ledger.snapshot().providerCalls, 0, 'protocol-preflight-reservation-preserved-no-retry');
      await probeLiveResource({ directory: admission, endpoint: plan.campaign.endpoint, model: plan.campaign.model, apiKey, campaignLedger: ledger });
    }
    if (!existsSync(join(admission, 'admission-report.json'))) finalizeLiveAdmission(root, admission);
    for (const variant of plan.variants) adoptLiveCalibration(root, join(base, 'variants', variant.id), admission);
    readProtocolContrastRun({ root, base, scratch });
    for (const scheduled of plan.slots) {
      const destination = join(base, 'trials', scheduled.id + '.json');
      if (existsSync(destination)) continue;
      if (written >= limit) break;
      const variant = plan.variants.find(variant => variant.id === scheduled.variantId);
      const slot = variant.plan.slots.find(slot => slot.id === scheduled.benefitSlotId);
      const receiptPath = join(scratch, variant.id, slot.id, 'receipt.json'), startPath = join(base, 'starts', scheduled.id + '.json');
      let row;
      if (existsSync(receiptPath)) {
        assert(existsSync(startPath), 'protocol-retained-start-missing'); row = read(receiptPath);
      } else {
        assert(!existsSync(join(scratch, variant.id, slot.id, 'dispatch.json')), 'protocol-interrupted-attempt-preserved-no-retry');
        const state = ledger.snapshot(), budgetAtStart = budgetContext(plan, state.rows), request = buildBenefitRequest(variant.plan, slot);
        assert(!state.rows.some(entry => entry.reservation.identity.startsWith(variant.id + '/' + slot.id + '/')),
          'protocol-interrupted-reservation-preserved-no-retry');
        assert(budgetAtStart.remainingProviderCalls > 0, 'campaign-provider-budget-exhausted');
        assert(budgetAtStart.remainingTokens >= Buffer.byteLength(JSON.stringify(request)) + 16000, 'campaign-token-budget-exhausted');
        const start = { studyDigest: benefitDigest(plan), scheduledSlot: scheduled, ledgerPrefixCount: state.providerCalls, budgetAtStart };
        if (existsSync(startPath)) assert.deepEqual(read(startPath), start, 'protocol-retained-start-budget-drift');
        else write(startPath, start);
        row = await collectCodingTrial({ root, plan: variant.plan, slot, apiKey, scratch: join(scratch, variant.id), supportRoot,
          remainingTokens: budgetAtStart.remainingTokens, remainingProviderCalls: budgetAtStart.remainingProviderCalls,
          campaignLedger: prefixProtocolLedger(ledger, variant.id) });
      }
      const start = read(startPath);
      const validated = validateProtocolContrastTrial(root, variant.plan, row, start.budgetAtStart);
      write(destination, { schemaVersion: 'RsiProtocolContrastTrial/v1', driven_by: 'agent', actor: plan.actor + '/recorder',
        ...start, receiptDigest: benefitDigest(row), receipt: row });
      written++;
      console.log(JSON.stringify({ protocol: variant.id, slot: scheduled.id, position: scheduled.position, outcome: validated.outcome,
        failureCategory: row.execution.failureCategory, calls: row.execution.providerCalls, tokens: validated.tokens,
        accountedTokens: ledger.snapshot().accountedTokens }));
      if (row.execution.failureCategory === 'budget' || row.execution.failureCategory === 'oracle') {
        stopReason = row.execution.note; break;
      }
    }
  } catch (error) {
    stopReason = String(error.message).split(apiKey).join('[REDACTED]');
    originalError = error;
  } finally {
    if (stopReason) write(join(base, 'stops', new Date().toISOString().replaceAll(':', '-') + '.json'),
      { driven_by: 'agent', actor: plan.actor, reason: stopReason, written });
    try { sealProtocolContrastRun({ root, base, scratch }); }
    catch (error) { if (originalError instanceof Error) originalError.cause ??= error; else throw error; }
    finally { unlinkSync(lock); }
  }
  if (originalError) throw originalError;
  return { written, report: read(join(base, 'report.json')) };
}

if (isMainEntrypoint(import.meta.url)) {
  try {
    const { positionals, values } = parseArgs({ allowPositionals: true, options: { 'base-dir': { type: 'string' }, scratch: { type: 'string' },
      'support-root': { type: 'string' }, 'quota-db': { type: 'string' }, 'budget-file': { type: 'string' }, limit: { type: 'string' } } });
    assert(positionals.length === 1 && ['prepare', 'calibrate', 'run', 'check'].includes(positionals[0]) && values['base-dir'], 'protocol-command-required');
    const base = resolve(values['base-dir']); let result;
    if (positionals[0] === 'prepare') {
      const frozenAuthorization = read(values['budget-file']);
      result = prepareProtocolContrast({ base, authorization: frozenAuthorization.authorization ?? frozenAuthorization, quotaDatabase: values['quota-db'] });
    }
    else if (positionals[0] === 'calibrate') result = await calibrateProtocolContrast({ base, supportRoot: values['support-root'] });
    else if (positionals[0] === 'check') result = sealProtocolContrastRun({ base, scratch: values.scratch });
    else {
      let input = ''; for await (const chunk of process.stdin) input += chunk;
      const { key } = JSON.parse(input); input = ''; assert(typeof key === 'string' && key, 'stdin-credential-required');
      result = await runProtocolContrast({ base, scratch: values.scratch, supportRoot: values['support-root'],
        quotaDatabase: values['quota-db'], apiKey: key, limit: values.limit ? Number(values.limit) : 216 });
    }
    console.log(JSON.stringify({ ...result, report: result.report ? { recordedSlots: result.report.recordedSlots,
      accounting: result.report.accounting, decision: result.report.decision } : undefined }, null, 2));
    if (result.passed === false) process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
