#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { isMainEntrypoint } from './lib/entrypoint.mjs';

const OPERATOR_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const digest = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
const git = (root, args) => execFileSync('git', args, { cwd: root, windowsHide: true, encoding: 'utf8' }).trim();
function write(path, value, exclusive = true) {
  mkdirSync(dirname(path), { recursive: true }); const bytes = JSON.stringify(value, null, 2) + '\n';
  if (exclusive) writeFileSync(path, bytes, { flag: 'wx' });
  else { const temp = path + '.' + randomUUID() + '.tmp'; writeFileSync(temp, bytes, { flag: 'wx' }); renameSync(temp, path); }
}
function emptyOracle(row) {
  return row.execution.status === 'completed' && row.execution.failureCategory === 'model'
    && row.execution.failureClass === null && row.grader?.reports.some(entry => entry.kind === 'vitest' && entry.exitCode !== 0
      && entry.report?.success === false && entry.report.numTotalTests === 0 && entry.report.testResults?.length === 0);
}
export function isUndispatchedSpaceFailure(row) {
  return row.execution?.failureClass === 'infrastructure' && row.execution?.providerCalls === 0
    && row.providerAttempts?.length === 0 && row.rawResponse === null && row.grader === null
    && /git archive extraction failed/u.test(row.execution.note ?? '') && /No space left on device|ENOSPC/u.test(row.execution.note ?? '');
}
/** The projection is validation data. The original response and executed receipt stay immutable. */
export function projectEmptyOracleReceipt(row) {
  assert(emptyOracle(row), 'recovery-empty-unsuccessful-oracle-required');
  const projection = structuredClone(row);
  Object.assign(projection.execution, { status: 'crash', failureClass: 'infrastructure', failureCategory: 'grader-empty-report',
    note: 'Validation projection only: original response and zero-suite oracle retained; observed outcome is incomplete.' });
  projection.rawResponse = null; projection.grader = null;
  return projection;
}
async function context(root, base) {
  const load = path => import(pathToFileURL(join(root, path)).href);
  const [benefit, protocol, provider, budget, quota, collector, statistics] = await Promise.all([
    load('scripts/lib/rsi-benefit-eval.mjs'), load('scripts/rsi-protocol-contrast.mjs'), load('scripts/lib/rsi-responses-provider.mjs'),
    load('scripts/lib/rsi-campaign-budget.mjs'), load('scripts/rsi-paired-measurement.mjs'), load('scripts/rsi-coding-collector.mjs'),
    load('scripts/rsi-protocol-contrast-replay.mjs'),
  ]);
  const plan = read(join(base, 'plan.json')), price = read(join(base, 'price-basis.v1.json'));
  protocol.validateProtocolContrastPlan(root, plan);
  assert.equal(readFileSync(join(base, 'plan.sha256'), 'utf8').trim(), digest(readFileSync(join(base, 'plan.json'))), 'recovery-plan-seal');
  assert.equal(plan.campaign.billing.evidenceDigest, digest(price), 'recovery-price-seal');
  assert.deepEqual(read(join(base, 'authorization.v1.json')).authorization, plan.campaign.authorization, 'recovery-authorization');
  return { root, base, plan, price, benefit, protocol, provider, budget, quota, collector, statistics };
}
function budgetAtStart(plan, rows) {
  const consumed = rows.reduce((sum, entry) => sum + (entry.settlement?.usage?.totalTokens
    ?? entry.reservation.reserved.inputTokens + entry.reservation.reserved.outputTokens), 0);
  return { schemaVersion: 'RsiProtocolContrastBudgetAtStart/v1', remainingTokens: plan.campaign.authorization.maxTotalTokens - consumed,
    remainingProviderCalls: plan.campaign.authorization.maxProviderCalls - rows.length };
}
function rawOracle(directory, row) {
  if (!row.grader) return [];
  const path = join(directory, 'oracle/run-report.json'), oracle = read(path);
  assert(oracle.driven_by === 'agent' && oracle.actor === 'codex/rsi-live-grader' && oracle.oracleUnchanged
    && oracle.oracleHashBefore === oracle.oracleHashAfter, 'recovery-oracle-integrity');
  assert.equal(oracle.oracleRevision, row.grader.oracleRevision, 'recovery-oracle-reference');
  assert.deepEqual(oracle.oracleTestDigests, row.grader.oracleTestDigests, 'recovery-oracle-test-bytes');
  assert.deepEqual(oracle.executions.map(entry => ({ command: entry.command, kind: entry.kind, exitCode: entry.exitCode, report: entry.report })),
    row.grader.reports, 'recovery-raw-oracle-binding');
  const files = [{ path, sha256: digest(readFileSync(path)) }];
  for (const [index, entry] of oracle.executions.entries()) {
    const stem = String(index + 1).padStart(2, '0');
    for (const suffix of ['-stdout.log', '-stderr.log', ...(entry.kind === 'vitest' ? ['-vitest-report.json'] : [])]) {
      const file = join(directory, 'oracle', stem + suffix); assert(existsSync(file), 'recovery-raw-oracle-file-missing');
      files.push({ path: file, sha256: digest(readFileSync(file)) });
      if (suffix === '-vitest-report.json') assert.deepEqual(read(file), entry.report, 'recovery-raw-report-drift');
    }
  }
  return files;
}
function verifyAdmissionFiles(ctx) {
  for (const taskId of ctx.plan.taskIds) {
    const calibration = read(join(ctx.base, 'admission/calibration', taskId, 'admission.json'));
    for (const stage of ['reference', 'baseline']) {
      const directory = join(ctx.base, 'admission/calibration', taskId, stage, 'oracle'), oracle = read(join(directory, 'run-report.json'));
      const expected = calibration.stages[stage];
      for (const key of Object.keys(oracle)) assert.deepEqual(oracle[key], expected[key], 'recovery-admission-raw-stage:' + key);
      for (const [index, execution] of oracle.executions.entries()) {
        const stem = String(index + 1).padStart(2, '0');
        if (execution.kind === 'vitest') assert.deepEqual(read(join(directory, stem + '-vitest-report.json')), execution.report, 'recovery-admission-raw-vitest');
        for (const suffix of ['-stdout.log', '-stderr.log']) assert(existsSync(join(directory, stem + suffix)), 'recovery-admission-log-missing');
      }
    }
  }
}
function validateOne(ctx, scratch, scheduled, row, start, recovery) {
  const variant = ctx.plan.variants.find(variant => variant.id === scheduled.variantId), directory = join(scratch, variant.id, scheduled.benefitSlotId);
  assert.equal(row.slot.id, scheduled.benefitSlotId, 'recovery-slot-identity');
  assert.deepEqual(read(join(directory, 'receipt.json')), row, 'recovery-original-receipt-drift');
  assert.equal(read(join(directory, 'receipt-digest.json')).sha256, digest(row), 'recovery-original-seal-drift');
  for (const [index, attempt] of row.providerAttempts.entries()) if (attempt.rawResponse) {
    const file = variant.id === 'v4-public-tools' ? 'provider-response-' + (index + 1) + '.json' : 'provider-response.json';
    const result = read(join(directory, file));
    assert.deepEqual(result.rawResponse, attempt.rawResponse, 'recovery-provider-file-drift');
    assert.deepEqual(result.request.body, attempt.request, 'recovery-provider-request-file-drift');
  }
  for (const [index, event] of row.execution.toolEvents.entries()) assert.deepEqual(read(join(directory, 'tool-event-' + (index + 1) + '.json')), event, 'recovery-tool-file-drift');
  const oracleFiles = rawOracle(directory, row);
  if (!recovery) return ctx.benefit.validateProtocolContrastTrial(ctx.root, variant.plan, row, start.budgetAtStart);
  assert(recovery.schemaVersion === 'RsiProtocolContrastRecovery/v1' && recovery.driven_by === 'agent'
    && recovery.actor === 'codex/rsi-protocol-grader-recovery' && recovery.providerCallsDuringRecovery === 0
    && recovery.originalReceiptUnchanged === true, 'recovery-envelope-authority');
  assert.equal(recovery.studyDigest, digest(ctx.plan), 'recovery-study-drift');
  assert(recovery.outcome === 'missing' && recovery.failureClass === 'grader' && recovery.originalStrictValidationError === 'grader-suite-error-missing',
    'recovery-outcome-drift');
  assert.deepEqual(recovery.scheduledSlot, scheduled, 'recovery-schedule-drift');
  assert.equal(recovery.originalReceiptDigest, digest(row), 'recovery-original-binding-drift');
  assert.deepEqual(recovery.rawOracleFiles, oracleFiles, 'recovery-original-oracle-file-drift');
  const projection = projectEmptyOracleReceipt(row); assert.equal(recovery.projectionDigest, digest(projection), 'recovery-projection-drift');
  assert.throws(() => ctx.benefit.validateProtocolContrastTrial(ctx.root, variant.plan, row, start.budgetAtStart), /grader-suite-error-missing/u);
  const result = ctx.benefit.validateProtocolContrastTrial(ctx.root, variant.plan, projection, start.budgetAtStart);
  return { ...result, row, outcome: 'missing', failureClass: 'grader' };
}
function makeRecovery(ctx, scratch, scheduled, row) {
  return { schemaVersion: 'RsiProtocolContrastRecovery/v1', driven_by: 'agent', actor: 'codex/rsi-protocol-grader-recovery',
    studyDigest: digest(ctx.plan), scheduledSlot: scheduled, createdAt: new Date().toISOString(), originalReceiptDigest: digest(row),
    projectionDigest: digest(projectEmptyOracleReceipt(row)), rawOracleFiles: rawOracle(join(scratch, scheduled.variantId, scheduled.benefitSlotId), row),
    reason: 'Zero unsuccessful test suites provide no oracle verdict.', originalStrictValidationError: 'grader-suite-error-missing',
    outcome: 'missing', failureClass: 'grader', providerCallsDuringRecovery: 0, originalReceiptUnchanged: true,
    recoverySource: git(OPERATOR_ROOT, ['rev-parse', 'HEAD']) };
}
function readRun(ctx, scratch, ledger) {
  const state = ledger.snapshot(), records = [], ids = new Set(); let consumed = 0, missing = false, previous = null;
  const attemptCheck = (entry, attempt) => {
    assert(entry, 'recovery-unreserved-request'); assert.deepEqual(entry.reservation.request, attempt.request, 'recovery-ledger-request-drift');
    const parsed = attempt.rawResponse ? ctx.provider.parseResponsesReply(attempt.rawResponse) : null;
    assert.deepEqual(parsed, attempt.parsedResponse, 'recovery-provider-parsed-drift');
    assert.deepEqual(entry.settlement?.usage ?? null, parsed?.usage ?? null, 'recovery-ledger-usage-drift');
    assert.equal(entry.settlement?.responseDigest ?? null, attempt.rawResponse ? digest(attempt.rawResponse) : null, 'recovery-ledger-response-drift');
    if (parsed) { assert(!ids.has(parsed.id), 'recovery-reused-response'); ids.add(parsed.id); }
  };
  const probe = read(join(ctx.base, 'admission/provider-preflight.json'));
  assert(probe.passed && state.rows[0]?.reservation.identity === 'provider-preflight', 'recovery-preflight-required');
  attemptCheck(state.rows[consumed++], { request: probe.request.body, rawResponse: probe.rawResponse, parsedResponse: probe.response });
  for (const scheduled of ctx.plan.slots) {
    const path = join(ctx.base, 'trials', scheduled.id + '.json'); if (!existsSync(path)) { missing = true; continue; }
    assert(!missing, 'recovery-schedule-prefix');
    const envelope = read(path), start = read(join(ctx.base, 'starts', scheduled.id + '.json'));
    assert(envelope.schemaVersion === 'RsiProtocolContrastTrial/v1' && envelope.driven_by === 'agent'
      && envelope.actor === ctx.plan.actor + '/recorder', 'recovery-trial-identity');
    assert.equal(envelope.studyDigest, digest(ctx.plan), 'recovery-trial-study'); assert.deepEqual(envelope.scheduledSlot, scheduled, 'recovery-trial-schedule');
    assert.equal(envelope.ledgerPrefixCount, consumed, 'recovery-ledger-prefix');
    assert.deepEqual(envelope.budgetAtStart, budgetAtStart(ctx.plan, state.rows.slice(0, consumed)), 'recovery-budget-at-start');
    assert.deepEqual(start, { studyDigest: digest(ctx.plan), scheduledSlot: scheduled, ledgerPrefixCount: consumed, budgetAtStart: envelope.budgetAtStart }, 'recovery-start-receipt');
    assert.equal(envelope.receiptDigest, digest(envelope.receipt), 'recovery-trial-receipt-digest');
    const validated = validateOne(ctx, scratch, scheduled, envelope.receipt, start, envelope.recovery);
    assert(!previous || Date.parse(envelope.receipt.execution.startedAt) >= Date.parse(previous.execution.endedAt), 'recovery-overlapping-slots'); previous = envelope.receipt;
    for (const [index, attempt] of envelope.receipt.providerAttempts.entries()) {
      assert.equal(state.rows[consumed]?.reservation.identity, scheduled.variantId + '/' + scheduled.benefitSlotId + '/' + (index + 1), 'recovery-ledger-identity');
      attemptCheck(state.rows[consumed++], attempt);
    }
    records.push({ ...validated, scheduledSlot: scheduled, envelope });
  }
  const next = ctx.plan.slots[records.length];
  assert(state.rows.slice(consumed).every(entry => records.length === 216
    ? entry.reservation.identity.startsWith('undispatched-recovery/')
    : next && entry.reservation.identity.startsWith(next.variantId + '/' + next.benefitSlotId + '/')), 'recovery-orphan-request');
  return { records, accounting: state, unimportedReservations: state.rows.length - consumed };
}
function createLedger(ctx, scratch, quotaDatabase) {
  return ctx.budget.createCampaignLedger({ directory: join(scratch, 'campaign-ledger'), campaign: ctx.plan.campaign, verifyPriceBasis: () => {
    assert(quotaDatabase, 'read-only-recovery'); const model = ctx.quota.inspectCachedModel(quotaDatabase, ctx.plan.campaign.model);
    assert.deepEqual(model.model, ctx.price.model, 'recovery-model-price-drift'); const quota = ctx.quota.inspectFreeQuota(quotaDatabase, ctx.plan.campaign.model);
    assert.equal(quota.routesDigest, ctx.price.quota.routesDigest, 'recovery-free-route-drift'); return { ...quota, modelSnapshot: model };
  } });
}
async function undispatchedAttempts(ctx, scratch, ledger, state, run, supportRoot, apiKey) {
  const selected = state.records.filter(record => isUndispatchedSpaceFailure(record.row)).sort((a, b) => a.scheduledSlot.position - b.scheduledSlot.position);
  const fullLedger = ledger.snapshot();
  const consumed = state.records.reduce((sum, record) => sum + record.row.execution.providerCalls, 1);
  let cursor = consumed, previous = state.records.at(-1)?.row.execution.endedAt;
  const replacements = new Map(), recoveries = [];
  for (const original of selected) {
    const scheduled = original.scheduledSlot, variant = ctx.plan.variants.find(variant => variant.id === scheduled.variantId);
    const slot = variant.plan.slots.find(slot => slot.id === scheduled.benefitSlotId);
    const baseDirectory = join(ctx.base, 'undispatched-attempts', scheduled.id), startPath = join(baseDirectory, 'start.json');
    const resultPath = join(baseDirectory, 'attempt.json');
    const scratchBase = join(scratch, 'undispatched-attempts', variant.id);
    const directory = join(scratchBase, slot.id), rowPath = join(directory, 'receipt.json');
    assert(!fullLedger.rows.some(entry => entry.reservation.identity.startsWith(variant.id + '/' + slot.id + '/')),
      'undispatched-recovery-original-provider-call-exists');
    if (!existsSync(resultPath) && !run) continue;
    let envelope;
    if (existsSync(resultPath)) envelope = read(resultPath);
    else {
      const snapshot = ledger.snapshot(), budget = budgetAtStart(ctx.plan, snapshot.rows);
      assert(snapshot.providerCalls === cursor, 'undispatched-recovery-order');
      const request = ctx.benefit.buildBenefitRequest(variant.plan, slot);
      assert(budget.remainingProviderCalls > 0 && budget.remainingTokens >= Buffer.byteLength(JSON.stringify(request)) + 16000,
        'undispatched-recovery-budget');
      const start = { schemaVersion: 'RsiUndispatchedAttemptStart/v1', driven_by: 'agent', actor: 'codex/rsi-no-dispatch-space-recovery',
        studyDigest: digest(ctx.plan), scheduledSlot: scheduled, originalReceiptDigest: digest(original.row),
        ledgerPrefixCount: cursor, budgetAtStart: budget, attemptScratchBase: scratchBase };
      if (existsSync(startPath)) assert.deepEqual(read(startPath), start, 'undispatched-existing-start-drift'); else write(startPath, start);
      let row;
      if (existsSync(rowPath)) row = read(rowPath);
      else {
        assert(!existsSync(join(directory, 'dispatch.json')), 'undispatched-recovery-interrupted-no-retry');
        const prefixed = { ...ledger, reserve: (request, identity) => ledger.reserve(request, 'undispatched-recovery/' + variant.id + '/' + identity) };
        row = await ctx.collector.collectCodingTrial({ root: ctx.root, plan: variant.plan, slot, apiKey, scratch: scratchBase, supportRoot,
          remainingTokens: budget.remainingTokens, remainingProviderCalls: budget.remainingProviderCalls, campaignLedger: prefixed });
      }
      envelope = { ...start, schemaVersion: 'RsiUndispatchedSpaceAttempt/v1', receiptDigest: digest(row), receipt: row, originalSpaceFailurePreserved: true,
        order: 'post-campaign-original-slot-order', operatorSource: git(OPERATOR_ROOT, ['rev-parse', 'HEAD']) };
      write(resultPath, envelope);
      console.log(JSON.stringify({ undispatchedRecovery: scheduled.id, calls: row.execution.providerCalls,
        failureCategory: row.execution.failureCategory, originalProviderCalls: original.row.execution.providerCalls }));
    }
    assert(envelope.schemaVersion === 'RsiUndispatchedSpaceAttempt/v1' && envelope.driven_by === 'agent'
      && envelope.originalSpaceFailurePreserved === true, 'undispatched-attempt-authority');
    assert.equal(envelope.originalReceiptDigest, digest(original.row), 'undispatched-original-receipt-drift');
    assert.deepEqual(envelope.scheduledSlot, scheduled, 'undispatched-slot-drift');
    assert.equal(envelope.studyDigest, digest(ctx.plan), 'undispatched-study-drift');
    assert.equal(envelope.ledgerPrefixCount, cursor, 'undispatched-prefix-drift');
    const rows = ledger.snapshot().rows;
    assert.deepEqual(envelope.budgetAtStart, budgetAtStart(ctx.plan, rows.slice(0, cursor)), 'undispatched-budget-drift');
    assert.equal(envelope.receiptDigest, digest(envelope.receipt), 'undispatched-receipt-digest');
    assert.deepEqual(read(rowPath), envelope.receipt, 'undispatched-private-receipt-drift');
    assert.equal(read(join(directory, 'receipt-digest.json')).sha256, digest(envelope.receipt), 'undispatched-private-seal-drift');
    const row = envelope.receipt, validated = ctx.benefit.validateProtocolContrastTrial(ctx.root, variant.plan, row, envelope.budgetAtStart);
    assert(!previous || Date.parse(row.execution.startedAt) >= Date.parse(previous), 'undispatched-attempt-overlap'); previous = row.execution.endedAt;
    const responseIds = new Set(state.records.flatMap(record => record.row.providerAttempts.map(attempt => attempt.parsedResponse?.id).filter(Boolean)));
    for (const [index, attempt] of row.providerAttempts.entries()) {
      const entry = rows[cursor++]; assert.equal(entry?.reservation.identity, 'undispatched-recovery/' + variant.id + '/' + slot.id + '/' + (index + 1), 'undispatched-ledger-identity');
      assert.deepEqual(entry.reservation.request, attempt.request, 'undispatched-ledger-request');
      const parsed = attempt.rawResponse ? ctx.provider.parseResponsesReply(attempt.rawResponse) : null;
      assert.deepEqual(parsed, attempt.parsedResponse, 'undispatched-parsed-response');
      assert.deepEqual(entry.settlement?.usage ?? null, parsed?.usage ?? null, 'undispatched-real-usage');
      assert.equal(entry.settlement?.responseDigest ?? null, attempt.rawResponse ? digest(attempt.rawResponse) : null, 'undispatched-raw-response');
      if (parsed) { assert(!responseIds.has(parsed.id), 'undispatched-reused-provider-response'); responseIds.add(parsed.id); }
      if (attempt.rawResponse) {
        const saved = read(join(directory, 'provider-response-' + (index + 1) + '.json'));
        assert.deepEqual(saved.rawResponse, attempt.rawResponse, 'undispatched-provider-file');
      }
    }
    rawOracle(directory, row);
    for (const [index, event] of row.execution.toolEvents.entries()) assert.deepEqual(read(join(directory, 'tool-event-' + (index + 1) + '.json')), event, 'undispatched-tool-file');
    replacements.set(scheduled.id, { ...validated, scheduledSlot: scheduled, envelope });
    recoveries.push({ slot: scheduled.id, originalOutcome: original.outcome, originalReceiptDigest: digest(original.row),
      recoveredOutcome: validated.outcome, receiptDigest: digest(row), providerCalls: row.execution.providerCalls,
      order: envelope.order });
  }
  assert(ledger.snapshot().rows.slice(cursor).every(entry => entry.reservation.identity.startsWith('undispatched-recovery/')),
    'undispatched-orphan-ledger');
  return { ...state, originalRecords: state.records, records: state.records.map(record => replacements.get(record.scheduledSlot.id) ?? record),
    accounting: ledger.snapshot(), undispatchedRecoveries: recoveries };
}
function report(ctx, state) {
  return { schemaVersion: 'RsiProtocolContrastRecoveredReport/v1', driven_by: 'agent', actor: 'codex/rsi-protocol-recovery-verifier',
    runId: ctx.plan.runId, source: ctx.plan.source.commit, planDigest: digest(ctx.plan), operatorSource: git(OPERATOR_ROOT, ['rev-parse', 'HEAD']),
    recordedSlots: state.records.length, plannedSlots: 216, unexecutedSlots: 216 - state.records.length,
    outcomeCounts: Object.fromEntries(['pass', 'fail', 'crash', 'timeout', 'missing'].map(outcome => [outcome, state.records.filter(record => record.outcome === outcome).length])),
    comparisons: ctx.protocol.summarizeProtocolContrast(ctx.plan, state.records), accounting: { ...state.accounting, rows: undefined },
    unimportedReservations: state.unimportedReservations, recoveries: state.records.filter(record => record.envelope.recovery).map(record => record.envelope.recovery),
    undispatchedRecoveries: state.undispatchedRecoveries ?? [],
    originalCampaignOutcomeCounts: state.originalRecords ? Object.fromEntries(['pass', 'fail', 'crash', 'timeout', 'missing']
      .map(outcome => [outcome, state.originalRecords.filter(record => record.outcome === outcome).length])) : null,
    decision: { status: 'NO_GO', productAdoption: 'hold', retainedExperienceCampaign: 'NO_GO/eliminate' },
    claims: { realHuman: false, experienceBenefit: false, promotionReady: false, productDefaultsChanged: false } };
}
export async function recoverProtocolContrast({ root, base, scratch, quotaDatabase, supportRoot, apiKey, run = false, out, limit = 216, recoverUndispatched = false }) {
  const ctx = await context(root, base), ledger = createLedger(ctx, scratch, run ? quotaDatabase : null);
  assert(Number.isSafeInteger(limit) && limit > 0 && limit <= 216, 'recovery-slot-limit');
  if (run) {
    assert.equal(git(OPERATOR_ROOT, ['status', '--porcelain']), '', 'recovery-clean-operator-required');
    assert.equal(read(join(supportRoot, 'node_modules/markdown-it/package.json')).version, '14.2.0', 'recovery-support-version-drift');
    assert.equal(git(root, ['status', '--porcelain', '--', ...Object.keys(ctx.plan.source.bindings)]), '', 'recovery-frozen-source-uncommitted');
  }
  for (const variant of ctx.plan.variants) ctx.benefit.verifyCodingAdmission(root, join(base, 'variants', variant.id), variant.plan);
  verifyAdmissionFiles(ctx);
  const lock = join(scratch, 'study.lock'); assert(!existsSync(lock), 'recovery-other-study-owner');
  let state = readRun(ctx, scratch, ledger), error = null, written = 0;
  if (run) write(lock, { pid: process.pid, studyDigest: digest(ctx.plan), operator: git(OPERATOR_ROOT, ['rev-parse', 'HEAD']) });
  try {
    for (const scheduled of ctx.plan.slots.slice(state.records.length)) {
      if (!run || written >= limit) break;
      const variant = ctx.plan.variants.find(variant => variant.id === scheduled.variantId), slot = variant.plan.slots.find(slot => slot.id === scheduled.benefitSlotId);
      const directory = join(scratch, variant.id, slot.id), startPath = join(base, 'starts', scheduled.id + '.json'), receiptPath = join(directory, 'receipt.json');
      let row;
      if (existsSync(receiptPath)) row = read(receiptPath);
      else {
        assert(!existsSync(join(directory, 'dispatch.json')), 'recovery-dispatched-slot-no-retry');
        const snapshot = ledger.snapshot(), budget = budgetAtStart(ctx.plan, snapshot.rows), request = ctx.benefit.buildBenefitRequest(variant.plan, slot);
        assert(!snapshot.rows.some(entry => entry.reservation.identity.startsWith(variant.id + '/' + slot.id + '/')),
          'recovery-interrupted-reservation-no-retry');
        assert(budget.remainingProviderCalls > 0 && budget.remainingTokens >= Buffer.byteLength(JSON.stringify(request)) + 16000, 'recovery-budget-exhausted');
        const start = { studyDigest: digest(ctx.plan), scheduledSlot: scheduled, ledgerPrefixCount: snapshot.providerCalls, budgetAtStart: budget };
        if (existsSync(startPath)) assert.deepEqual(read(startPath), start, 'recovery-existing-start-drift'); else write(startPath, start);
        row = await ctx.collector.collectCodingTrial({ root, plan: variant.plan, slot, apiKey, scratch: join(scratch, variant.id), supportRoot,
          remainingTokens: budget.remainingTokens, remainingProviderCalls: budget.remainingProviderCalls, campaignLedger: ctx.protocol.prefixProtocolLedger(ledger, variant.id) });
      }
      const start = read(startPath), recovery = emptyOracle(row) ? makeRecovery(ctx, scratch, scheduled, row) : null;
      const validated = validateOne(ctx, scratch, scheduled, row, start, recovery);
      const envelope = { schemaVersion: 'RsiProtocolContrastTrial/v1', driven_by: 'agent', actor: ctx.plan.actor + '/recorder',
        ...start, receiptDigest: digest(row), receipt: row, ...(recovery ? { recovery } : {}) };
      write(join(base, 'trials', scheduled.id + '.json'), envelope); state.records.push({ ...validated, scheduledSlot: scheduled, envelope });
      written++;
      console.log(JSON.stringify({ protocol: scheduled.variantId, slot: scheduled.id, position: scheduled.position, outcome: validated.outcome,
        failureCategory: recovery ? 'grader-empty-report' : row.execution.failureCategory, calls: row.execution.providerCalls,
        tokens: validated.tokens, accountedTokens: ledger.snapshot().accountedTokens, retainedRecovery: Boolean(recovery) }));
      if (row.execution.failureCategory === 'budget' || row.execution.failureCategory === 'oracle') break;
    }
    if (recoverUndispatched) {
      assert(state.records.length === 216, 'undispatched-recovery-requires-complete-campaign');
      state = await undispatchedAttempts(ctx, scratch, ledger, state, run, supportRoot, apiKey);
    }
  } catch (caught) { error = caught; }
  finally { try {
      const originalState = readRun(ctx, scratch, ledger);
      state = recoverUndispatched ? await undispatchedAttempts(ctx, scratch, ledger, originalState, false, supportRoot) : originalState;
      write(join(base, recoverUndispatched ? 'undispatched-recovery-report.json' : 'recovery-report.json'), report(ctx, state), false);
    }
    catch (caught) { if (error instanceof Error) error.cause ??= caught; else error = caught; }
    finally { if (run) unlinkSync(lock); } }
  if (error) throw error;
  const result = report(ctx, state);
  if (!run) {
    const statistics = ctx.statistics.reconstructProtocolStatistics(ctx.plan, state.records);
    for (const [name, independent] of Object.entries(statistics.comparisons)) {
      const current = result.comparisons[name]; assert.equal(current.pairedDiff.pairCount, independent.pairCount, 'recovery-independent-pair-count');
      assert.equal(current.pairedDiff.meanDiff, independent.meanDiff, 'recovery-independent-effect');
      assert.deepEqual(current.pairedDiff.ci95, independent.ci95, 'recovery-independent-ci');
      assert.equal(current.power.requiredCasesApprox, independent.power.requiredCasesApprox, 'recovery-independent-power');
    }
    result.independentReplay = { statistics, providerCallsDuringReplay: 0, passed: true };
    const accounting = { providerCalls: 0, knownTokens: 0, accountedTokens: 0, unknownUsageRequests: [], currency: 'CNY', spendingUpperBound: 0 };
    for (const entry of ledger.snapshot().rows) {
      const usage = entry.settlement?.usage ?? null, input = Buffer.byteLength(JSON.stringify(entry.reservation.request)), output = entry.reservation.request.max_output_tokens;
      assert.equal(entry.reservation.reserved.inputTokens, input, 'recovery-independent-reserve-input');
      assert.equal(entry.reservation.reserved.outputTokens, output, 'recovery-independent-reserve-output');
      assert.equal(entry.reservation.reserved.costMicros, 0, 'recovery-independent-free-spending');
      accounting.providerCalls++;
      if (usage) accounting.knownTokens += usage.inputTokens + usage.outputTokens;
      else accounting.unknownUsageRequests.push(entry.reservation.identity);
      accounting.accountedTokens += usage ? usage.inputTokens + usage.outputTokens : input + output;
    }
    for (const [key, value] of Object.entries(accounting)) assert.deepEqual(result.accounting[key], value, 'recovery-independent-accounting:' + key);
    result.independentReplay.accounting = accounting;
    result.independentReplay.costBoundaries = Object.fromEntries(Object.entries(result.comparisons).map(([name, comparison]) => [name,
      Object.fromEntries([['tokens', comparison.budget.observedRelativeTokenIncrease], ['toolCalls', comparison.budget.observedRelativeToolCallIncrease]].map(([metric, value]) => [metric,
        { status: value === Infinity ? 'unbounded-from-zero-baseline' : value === null ? 'unknown' : 'measured',
          relativeIncrease: Number.isFinite(value) ? value : null, exceedsFrozenCeiling: value === null ? null : value > 0.1 }]))]));
    if (out) write(out, result);
  }
  return { written, recordedSlots: result.recordedSlots, outcomeCounts: result.outcomeCounts, accounting: result.accounting,
      recoveries: result.recoveries.length, undispatchedRecoveries: result.undispatchedRecoveries.length,
      independentReplay: result.independentReplay?.passed ?? null };
}
export async function verifyProtocolArtifactManifest({ root, base, scratch, out }) {
  const result = await recoverProtocolContrast({ root, base, scratch, run: false, recoverUndispatched: true });
  const files = [], walk = (directory, prefix) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name), name = prefix + '/' + entry.name;
      if (entry.isDirectory()) { if (['workspace', 'home', 'node_modules', '.git'].includes(entry.name)) continue; walk(path, name); }
      else if (!entry.isSymbolicLink() && !entry.name.endsWith('.tmp') && !entry.name.endsWith('.lock')) files.push({ path: name, bytes: readFileSync(path).length, sha256: digest(readFileSync(path)) });
    }
  };
  walk(base, 'experiment'); walk(scratch, 'receipts');
  const manifest = { schemaVersion: 'RsiProtocolRawArtifactManifest/v1', driven_by: 'agent', actor: 'codex/rsi-protocol-artifact-readback',
    roots: { experiment: base, receipts: scratch }, files: files.sort((a, b) => a.path.localeCompare(b.path)), count: files.length, validatedRun: result,
    providerCallsDuringVerification: 0, passed: true };
  if (out) write(out, manifest);
  return manifest;
}
if (isMainEntrypoint(import.meta.url)) {
  try {
    const { positionals, values } = parseArgs({ allowPositionals: true, options: { root: { type: 'string' }, 'base-dir': { type: 'string' },
      scratch: { type: 'string' }, 'quota-db': { type: 'string' }, 'support-root': { type: 'string' }, out: { type: 'string' }, limit: { type: 'string' },
      'recover-undispatched': { type: 'boolean' } } });
    assert(['run', 'check'].includes(positionals[0]) && values.root && values['base-dir'] && values.scratch, 'recovery-paths-required');
    const run = positionals[0] === 'run'; let apiKey;
    if (run) { let input = ''; for await (const bytes of process.stdin) input += bytes; apiKey = JSON.parse(input).key; input = ''; assert(apiKey, 'stdin-key-required'); }
    console.log(JSON.stringify(await recoverProtocolContrast({ root: values.root, base: values['base-dir'], scratch: values.scratch,
      quotaDatabase: values['quota-db'], supportRoot: values['support-root'], apiKey, run, out: values.out,
      limit: values.limit ? Number(values.limit) : 216, recoverUndispatched: values['recover-undispatched'] === true }), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
