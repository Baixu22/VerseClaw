#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { isMainEntrypoint } from './lib/entrypoint.mjs';
import { adoptLiveCalibration, benefitDigest, checkBenefitRun, validateBenefitPlan, writeBenefitPlan } from './lib/rsi-benefit-eval.mjs';
import { createCampaignLedger } from './lib/rsi-campaign-budget.mjs';
import { runCodingCollector } from './rsi-coding-collector.mjs';
import { calibrateLiveTask, finalizeLiveAdmission, probeLiveResource } from './rsi-live-acceptance.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function write(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
}

export function inspectFreeQuota(database, model) {
  const db = new DatabaseSync(database, { readOnly: true });
  try {
    const rules = JSON.parse(db.prepare('SELECT value FROM kv WHERE key=?').get('modelRules')?.value ?? '{}');
    assert([rules.mappings ?? [], rules.custom ?? [], rules.disabled ?? []].every(Array.isArray), 'campaign-local-route-schema');
    assert(!(rules.disabled ?? []).includes(model)
      && !(rules.custom ?? []).some(entry => entry.id === model || entry.alias === model || entry.model === model),
    'campaign-local-model-route-drift');
    const configured = (rules.mappings ?? []).filter(entry => entry.alias === model);
    const routes = (configured.length ? configured : [{ alias: model, provider: 'workbuddy', target: model, reasoning: null }])
      .map(entry => ({ alias: model, provider: entry.provider, target: entry.target, reasoning: entry.reasoning ?? null }))
      .sort((left, right) => left.provider.localeCompare(right.provider));
    assert(routes.every(entry => ['workbuddy', 'workbuddy-intl'].includes(entry.provider) && entry.target === model
      && [null, 'low'].includes(entry.reasoning)), 'campaign-local-model-route-drift');
    const routeProviders = [...new Set(routes.map(entry => entry.provider))];
    const rows = db.prepare(`SELECT u.usage, u.remaining FROM accounts a LEFT JOIN account_usage_records u ON a.id=u.account_id WHERE a.provider IN (${routeProviders.map(() => '?').join(',')}) AND a.enabled=1`).all(...routeProviders);
    const plans = rows.map(row => JSON.parse(row.usage ?? 'null')?.subscription?.planName);
    assert(rows.length > 0 && plans.every(plan => plan === 'Free'), 'campaign-enabled-account-is-not-free');
    const remainingQuota = rows.reduce((sum, row) => sum + Math.max(0, row.remaining ?? 0), 0);
    assert(remainingQuota > 0, 'campaign-free-quota-exhausted');
    return { provider: 'workbuddy', model, plan: 'Free', newPurchaseAllowed: false,
      enabledAccounts: rows.length, remainingQuota, unit: 'provider-credits', routes, routeProviders, routesDigest: benefitDigest(routes),
      source: 'read-only Agent2API account_usage_records and modelRules', observedAt: new Date().toISOString() };
  } finally { db.close(); }
}

export function inspectCachedModel(database, model) {
  const db = new DatabaseSync(database, { readOnly: true });
  try {
    const cache = JSON.parse(db.prepare('SELECT value FROM kv WHERE key=?').get('modelCatalogCache')?.value ?? '{}');
    const candidates = ['plugin:workbuddy', 'workbuddy'].map(source => ({ source, ...cache[source] }))
      .filter(entry => entry.models?.some(item => item.id === model)).sort((left, right) => right.fetchedAt - left.fetchedAt);
    const latest = candidates[0], ageMs = Date.now() - latest?.fetchedAt;
    assert(Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= 86400000, 'campaign-model-cache-stale-or-missing');
    const metadata = latest.models.find(entry => entry.id === model);
    assert(metadata.supportsToolCall === true && Number.isSafeInteger(metadata.maxInputTokens)
      && Number.isSafeInteger(metadata.maxOutputTokens), 'campaign-model-owner-or-tools');
    return { source: latest.source, fetchedAt: latest.fetchedAt, ageMs,
      model: { id: metadata.id, provider: 'workbuddy', credits: metadata.credits,
        supportsToolCall: metadata.supportsToolCall, maxInputTokens: metadata.maxInputTokens, maxOutputTokens: metadata.maxOutputTokens } };
  } finally { db.close(); }
}

export async function preparePairedMeasurement({ root = ROOT, base, authorization, quotaDatabase, evolutionFile }) {
  const baseRelative = relative(resolve('D:/tmp'), resolve(base));
  assert(baseRelative && !baseRelative.startsWith('..') && !baseRelative.includes(':'), 'campaign-workspaces-must-be-under-D-tmp');
  assert(!existsSync(base), 'new-campaign-directory-required');
  assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: root, windowsHide: true, encoding: 'utf8' }).trim(), '', 'campaign-clean-candidate-required');
  const endpoint = 'http://127.0.0.1:3065/v1/responses', model = 'space-bunny';
  const snapshot = inspectCachedModel(quotaDatabase, model), metadata = snapshot.model;
  const quota = inspectFreeQuota(quotaDatabase, model);
  const priceEvidence = { schemaVersion: 'RsiCampaignPriceBasis/v1', driven_by: 'agent', actor: 'codex/rsi-price-verifier',
    endpoint, model: metadata, modelSnapshot: snapshot, quota, currency: 'CNY', newSpendingPerRequestUpperBoundCny: 0,
    basis: 'Existing Free quota only; no quota purchase or paid fallback.',
    tokenTariff: null, upstreamCreditDebit: null, upstreamInvoice: null };
  const campaignBudget = { schemaVersion: 'RsiCampaignBudget/v1', driven_by: 'agent', actor: 'codex/rsi-campaign-budget',
    endpoint, model, authorization,
    billing: { kind: 'existing-free-quota', currency: 'CNY', provider: 'workbuddy', plan: 'Free', newPurchaseAllowed: false,
      evidenceDigest: benefitDigest(priceEvidence), creditMultiplier: metadata.credits } };
  const frozen = read(evolutionFile), candidateEvolution = frozen.plan.evolution.export;
  const plan = writeBenefitPlan(root, join(base, 'measurement'), { mode: 'measured', codingCollector: true,
    collectorVersion: 'RsiCodingCollector/v4', candidateEvolution, candidateGeneration: 2, campaignBudget,
    endpoint, model, actor: 'codex/rsi-paired-measurement-0857',
    maxProviderCalls: authorization.maxProviderCalls, maxTotalTokens: authorization.maxTotalTokens });
  assert.equal(plan.candidate.id, 'rsi-prompt-4fb74767a8b13b831edd60f3', 'paired-prompt-selection');
  assert.equal(plan.evolution.candidateVersion, 'da9adbb1b5faab2778fb048b832ea1254bc77358875e33b8e54f0330663818f9', 'paired-prompt-version');
  assert.equal(plan.evolution.heldOutDigest, '01b05ac42fa2fd57d61a6af6e88887220a65a58952dfd5f0aa0e5a241feff501', 'paired-held-out-commitment');
  write(join(base, 'price-basis.v1.json'), priceEvidence);
  write(join(base, 'authorization.v1.json'), { driven_by: 'agent', actor: 'codex/rsi-authorization-recorder', authorization });
  write(join(base, 'experiment.v1.json'), { schemaVersion: 'RsiPairedExperiment/v1', driven_by: 'agent', actor: plan.actor,
    createdAt: new Date().toISOString(), planDigest: benefitDigest(plan), sourceCandidate: plan.source.commit,
    candidateDirty: false, candidateVersion: plan.evolution.candidateVersion, heldOutDigest: plan.evolution.heldOutDigest,
    tasks: plan.tasks.length, arms: Object.keys(plan.arms).length, repeats: plan.design.k, slots: plan.slots.length,
    protocol: plan.collector.version, comparison: plan.design.primaryComparison,
    historicalComparison: 'descriptive only; public inputs and tool protocol changed together',
    priceBasisDigest: benefitDigest(priceEvidence), campaignDigest: benefitDigest(campaignBudget),
    claims: { realHuman: false, benefit: false, productDefaultsChanged: false } });
  return { base, planDigest: benefitDigest(plan), runId: plan.runId, slots: plan.slots.length, budget: plan.budget };
}

function load(base, root) {
  const plan = read(join(base, 'measurement/plan.json'));
  assert.equal(readFileSync(join(base, 'measurement/plan.sha256'), 'utf8').trim(), sha(readFileSync(join(base, 'measurement/plan.json'))), 'campaign-plan-seal');
  validateBenefitPlan(plan, root);
  const experiment = read(join(base, 'experiment.v1.json')), price = read(join(base, 'price-basis.v1.json'));
  assert.equal(experiment.planDigest, benefitDigest(plan), 'campaign-experiment-plan');
  assert.equal(plan.budget.campaign.billing.evidenceDigest, benefitDigest(price), 'campaign-price-basis-drift');
  assert.equal(experiment.campaignDigest, benefitDigest(plan.budget.campaign), 'campaign-envelope-drift');
  return { plan, experiment, price };
}

export function reconcileCampaign(base, { root = ROOT, scratch } = {}) {
  const { plan } = load(base, root);
  const ledger = createCampaignLedger({ directory: join(scratch, 'campaign-ledger'), campaign: plan.budget.campaign,
    verifyPriceBasis: () => assert.fail('replay-cannot-dispatch') });
  const observed = [];
  const measuredPreflight = join(base, 'measurement/provider-preflight.json');
  const preflightPath = existsSync(measuredPreflight) ? measuredPreflight : join(base, 'admission/provider-preflight.json');
  const resourcePath = join(base, 'resource-preflights.v1.json');
  const resources = existsSync(resourcePath) ? read(resourcePath).entries
    : [{ identity: 'provider-preflight', path: preflightPath }];
  const preflightIdentities = new Set();
  for (const resource of resources) {
    assert(typeof resource.identity === 'string' && resource.identity.startsWith('provider-preflight')
      && !preflightIdentities.has(resource.identity), 'campaign-resource-identity');
    preflightIdentities.add(resource.identity);
    if (!existsSync(resource.path)) continue;
    const receipt = read(resource.path);
    if (resource.sha256) assert.equal(resource.sha256, sha(readFileSync(resource.path)), 'campaign-resource-receipt-drift');
    if (receipt.request?.body) observed.push({ identity: resource.identity, request: receipt.request.body,
      response: receipt.rawResponse ?? null, usage: receipt.response?.usage ?? null });
    else if (ledger.snapshot().rows.some(row => row.reservation.identity === resource.identity)) {
      observed.push({ identity: resource.identity, response: null, usage: null });
    }
  }
  for (const slot of plan.slots) {
    const path = join(base, 'measurement/trials', slot.id + '.json');
    if (!existsSync(path)) continue;
    const row = read(path);
    row.providerAttempts.forEach((attempt, index) => observed.push({ identity: slot.id + '/' + (index + 1),
      request: attempt.request, response: attempt.rawResponse, usage: attempt.parsedResponse?.usage ?? null }));
  }
  const state = ledger.snapshot();
  assert.equal(new Set(observed.map(row => row.identity)).size, observed.length, 'campaign-duplicate-observed-request');
  assert.equal(state.providerCalls, observed.length, 'campaign-dispatch-receipt-count');
  for (const { reservation, settlement } of state.rows) {
    const actual = observed.find(row => row.identity === reservation.identity);
    assert(actual, 'campaign-dispatch-receipt-missing');
    if (actual.request) assert.equal(reservation.requestDigest, benefitDigest(actual.request), 'campaign-dispatched-request-drift');
    assert.equal(settlement?.responseDigest ?? null, actual.response === null ? null : benefitDigest(actual.response), 'campaign-response-drift');
    assert.deepEqual(settlement?.usage ?? null, actual.usage, 'campaign-settled-usage-drift');
  }
  const auth = plan.budget.campaign.authorization;
  assert(state.providerCalls <= auth.maxProviderCalls && state.accountedTokens <= auth.maxTotalTokens
    && state.spendingUpperBound <= auth.maxCost, 'campaign-resource-overrun');
  const { rows, ...summary } = state;
  return { schemaVersion: 'RsiCampaignAccounting/v1', driven_by: 'agent', actor: 'codex/rsi-campaign-replay',
    ...summary, plannedAuthorization: auth, preflightCalls: observed.filter(row => preflightIdentities.has(row.identity)).length,
    trialProviderCalls: observed.filter(row => !preflightIdentities.has(row.identity)).length,
    reservationCount: rows.length, receiptCount: observed.length, reconciled: true,
    spendingBasis: plan.budget.campaign.billing.kind, upstreamCreditDebit: null };
}

if (isMainEntrypoint(import.meta.url)) {
  try {
    const { values, positionals } = parseArgs({ allowPositionals: true, options: {
      'base-dir': { type: 'string' }, 'budget-file': { type: 'string' }, 'quota-db': { type: 'string' },
      'evolution-file': { type: 'string' }, scratch: { type: 'string' }, 'support-root': { type: 'string' }, limit: { type: 'string' },
    } });
    assert(positionals.length === 1 && ['prepare', 'calibrate', 'run', 'check'].includes(positionals[0]) && values['base-dir'],
      'Usage: rsi-paired-measurement <prepare|calibrate|run|check> --base-dir <new/retained campaign>');
    const base = resolve(values['base-dir']);
    assert(base.toLowerCase().startsWith('d:'), 'campaign-artifacts-stay-on-D');
    let result;
    if (positionals[0] === 'prepare') {
      assert(values['budget-file'] && values['quota-db'] && values['evolution-file'], 'authorization, quota-db and evolution-file required');
      result = await preparePairedMeasurement({ base, authorization: read(values['budget-file']),
        quotaDatabase: values['quota-db'], evolutionFile: values['evolution-file'] });
    } else {
      const { plan, price } = load(base, ROOT), admission = join(base, 'admission');
      if (positionals[0] === 'calibrate') {
        assert(values['support-root'], 'support-root required');
        for (const task of plan.tasks) {
          if (existsSync(join(admission, 'calibration', task.id, 'admission.json'))) continue;
          const calibrated = await calibrateLiveTask(ROOT, admission, task.id, { codingCohort: true,
            timeoutMs: plan.collector.oracleTimeoutMs, supportRoot: values['support-root'] });
          console.log(JSON.stringify({ taskId: task.id, passed: calibrated.admission.passed, issues: calibrated.admission.issues }));
        }
        const outcomes = plan.tasks.map(task => read(join(admission, 'calibration', task.id, 'admission.json')).admission);
        result = { calibrated: outcomes.length, admitted: outcomes.filter(item => item.passed).length,
          rejected: outcomes.filter(item => !item.passed).length, providerCalls: 0, passed: outcomes.every(item => item.passed) };
      } else {
        assert(values.scratch, 'scratch required');
        if (positionals[0] === 'run') {
          assert(values['support-root'] && values['quota-db'], 'support-root and quota-db required');
          let input = ''; for await (const chunk of process.stdin) input += chunk;
          const { key } = JSON.parse(input); input = '';
          assert(typeof key === 'string' && key, 'stdin credential required');
          const campaignLedger = createCampaignLedger({ directory: join(values.scratch, 'campaign-ledger'), campaign: plan.budget.campaign,
            verifyPriceBasis: async () => {
              const modelSnapshot = inspectCachedModel(values['quota-db'], plan.provider.model);
              assert.deepEqual(modelSnapshot.model, price.model, 'campaign-model-price-drift');
              const observation = inspectFreeQuota(values['quota-db'], plan.provider.model);
              assert.equal(observation.routesDigest, price.quota.routesDigest, 'campaign-provider-route-drift');
              return { ...observation, modelSnapshot };
            } });
          if (!existsSync(join(admission, 'provider-preflight.json'))) {
            // All local oracle admissions precede the first resource-consuming probe.
            const offlineAdmission = finalizeLiveAdmission(ROOT, admission, { write: false });
            assert(offlineAdmission.admissions.every(task => task.passed), 'campaign-task-admission-not-ready');
            await probeLiveResource({ directory: admission, ...plan.provider, apiKey: key, campaignLedger });
          }
          if (!existsSync(join(admission, 'admission-report.json'))) finalizeLiveAdmission(ROOT, admission);
          adoptLiveCalibration(ROOT, join(base, 'measurement'), admission);
          result = await runCodingCollector({ directory: join(base, 'measurement'), scratch: values.scratch,
            supportRoot: values['support-root'], apiKey: key, limit: values.limit ? Number(values.limit) : 216, campaignLedger });
          const accounting = reconcileCampaign(base, { scratch: values.scratch });
          console.log(JSON.stringify({ campaignAccounting: accounting }));
        } else {
          const measurement = checkBenefitRun(ROOT, join(base, 'measurement'));
          result = { passed: measurement.passed, measurement, accounting: reconcileCampaign(base, { scratch: values.scratch }) };
        }
      }
    }
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.passed === false ? 1 : 0;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
