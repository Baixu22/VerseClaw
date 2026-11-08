import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const integer = value => Number.isSafeInteger(value) && value >= 0;
function write(path, value) {
  const temporary = path + '.' + randomUUID() + '.tmp';
  writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  renameSync(temporary, path);
}

export function validateCampaignBudget(campaign) {
  assert.equal(campaign?.schemaVersion, 'RsiCampaignBudget/v1', 'campaign-budget-version');
  assert(campaign.driven_by === 'agent' && typeof campaign.actor === 'string' && campaign.actor, 'campaign-actor');
  const { authorization, billing } = campaign;
  assert(authorization?.approvedBy === 'owner' && authorization.currency === 'CNY', 'campaign-owner-currency');
  assert(integer(authorization.maxProviderCalls) && authorization.maxProviderCalls > 0
    && integer(authorization.maxTotalTokens) && authorization.maxTotalTokens > 0
    && Number.isFinite(authorization.maxCost) && authorization.maxCost >= 0
    && integer(authorization.maxCost * 1000000), 'campaign-resource-limits');
  assert(typeof campaign.endpoint === 'string' && typeof campaign.model === 'string', 'campaign-provider');
  assert(billing?.currency === authorization.currency && /^[a-f0-9]{64}$/u.test(billing.evidenceDigest ?? ''), 'campaign-price-evidence');
  if (billing.kind === 'existing-free-quota') {
    assert(billing.plan === 'Free' && billing.newPurchaseAllowed === false && billing.provider,
      'campaign-free-quota-basis');
  } else {
    assert.equal(billing.kind, 'token-tariff', 'campaign-price-kind');
    assert([billing.inputPerMillion, billing.outputPerMillion].every(value => Number.isFinite(value) && value >= 0),
      'campaign-token-tariff');
  }
  return true;
}

function costMicros(campaign, inputTokens, outputTokens) {
  return campaign.billing.kind === 'existing-free-quota' ? 0
    : Math.ceil(inputTokens * campaign.billing.inputPerMillion + outputTokens * campaign.billing.outputPerMillion);
}

/** Reservations survive unknown usage and process interruption. One ledger is serial. */
export function createCampaignLedger({ directory, campaign, verifyPriceBasis }) {
  validateCampaignBudget(campaign);
  if (campaign.billing.kind === 'existing-free-quota') assert(typeof verifyPriceBasis === 'function', 'live-free-quota-verifier-required');
  directory = resolve(directory);
  mkdirSync(directory, { recursive: true });
  const campaignDigest = digest(campaign), lock = join(directory, 'request.lock');
  let heldToken = null;
  const release = () => {
    if (heldToken && existsSync(lock) && read(lock).token === heldToken) unlinkSync(lock);
    heldToken = null;
  };
  const entries = () => {
    const names = readdirSync(directory);
    assert(names.every(name => /^(?:[0-9]{6}\.(?:reservation|settlement)\.json|request\.lock)$/u.test(name)), 'campaign-ledger-extra-file');
    const reservations = names.filter(name => name.endsWith('.reservation.json')).sort();
    const rows = reservations.map((name, index) => {
      const reservation = read(join(directory, name));
      assert.equal(reservation.sequence, index + 1, 'campaign-reservation-sequence');
      assert.equal(name, String(reservation.sequence).padStart(6, '0') + '.reservation.json', 'campaign-reservation-filename');
      assert.equal(reservation.campaignDigest, campaignDigest, 'campaign-reservation-drift');
      assert.equal(reservation.endpoint, campaign.endpoint, 'campaign-reservation-endpoint');
      assert.equal(reservation.request.model, campaign.model, 'campaign-reservation-model');
      assert.equal(reservation.reserved.providerCalls, 1, 'campaign-call-reservation-drift');
      assert.equal(reservation.requestDigest, digest(reservation.request), 'campaign-request-drift');
      const inputUpper = Buffer.byteLength(JSON.stringify(reservation.request));
      assert.equal(reservation.reserved.inputTokens, inputUpper, 'campaign-input-reservation-drift');
      assert.equal(reservation.reserved.outputTokens, reservation.request.max_output_tokens, 'campaign-output-reservation-drift');
      assert.equal(reservation.reserved.costMicros, costMicros(campaign, inputUpper, reservation.request.max_output_tokens), 'campaign-cost-reservation-drift');
      if (campaign.billing.kind === 'existing-free-quota') assert(reservation.priceObservation?.provider === campaign.billing.provider
        && reservation.priceObservation.model === campaign.model && reservation.priceObservation.plan === 'Free'
        && reservation.priceObservation.newPurchaseAllowed === false && reservation.priceObservation.remainingQuota > 0,
      'campaign-retained-price-observation-drift');
      const path = join(directory, name.replace('.reservation.', '.settlement.'));
      const settlement = existsSync(path) ? read(path) : null;
      if (settlement) {
        assert.equal(settlement.reservationDigest, digest(reservation), 'campaign-settlement-drift');
        const usage = settlement.usage;
        if (usage !== null) assert(integer(usage.inputTokens) && integer(usage.outputTokens)
          && usage.totalTokens === usage.inputTokens + usage.outputTokens, 'campaign-usage-invalid');
      }
      return { reservation, settlement };
    });
    assert.equal(names.filter(name => name.endsWith('.settlement.json')).length, rows.filter(row => row.settlement).length,
      'campaign-orphan-settlement');
    assert.equal(new Set(rows.map(row => row.reservation.identity)).size, rows.length, 'campaign-duplicate-request');
    return rows;
  };
  const snapshot = () => {
    const rows = entries();
    const totalTokens = rows.reduce((sum, row) => sum + (row.settlement?.usage?.totalTokens
      ?? row.reservation.reserved.inputTokens + row.reservation.reserved.outputTokens), 0);
    const spendingMicros = rows.reduce((sum, row) => sum + (row.settlement?.usage
      ? costMicros(campaign, row.settlement.usage.inputTokens, row.settlement.usage.outputTokens) : row.reservation.reserved.costMicros), 0);
    return { campaignDigest, providerCalls: rows.length, accountedTokens: totalTokens,
      knownTokens: rows.reduce((sum, row) => sum + (row.settlement?.usage?.totalTokens ?? 0), 0),
      unknownUsageRequests: rows.filter(row => !row.settlement?.usage).map(row => row.reservation.identity),
      currency: campaign.authorization.currency, spendingUpperBound: spendingMicros / 1000000,
      billedCost: null, rows };
  };
  const withinLimits = state => {
    assert(state.providerCalls <= campaign.authorization.maxProviderCalls, 'campaign-provider-budget-exhausted');
    assert(state.accountedTokens <= campaign.authorization.maxTotalTokens, 'campaign-token-budget-exhausted');
    assert(state.spendingUpperBound <= campaign.authorization.maxCost, 'campaign-money-budget-exhausted');
  };
  return {
    directory, campaignDigest, snapshot,
    async reserve(request, identity) {
      assert.equal(request.model, campaign.model, 'campaign-model-drift');
      assert(integer(request.max_output_tokens) && request.max_output_tokens > 0, 'campaign-output-bound');
      assert(typeof identity === 'string' && identity, 'campaign-request-identity');
      const token = randomUUID();
      if (existsSync(lock)) {
        const owner = read(lock);
        assert(integer(owner.pid) && owner.pid > 0, 'campaign-malformed-lock');
        try { process.kill(owner.pid, 0); assert.fail('campaign-request-in-progress'); }
        catch (error) { if (error.code !== 'ESRCH') throw error; }
        unlinkSync(lock);
      }
      writeFileSync(lock, JSON.stringify({ pid: process.pid, token }) + '\n', { flag: 'wx' });
      heldToken = token;
      try {
        const state = snapshot();
        withinLimits(state);
        assert(!state.rows.some(row => row.reservation.identity === identity), 'campaign-request-already-reserved-no-retry');
        const priceObservation = verifyPriceBasis ? await verifyPriceBasis() : null;
        if (campaign.billing.kind === 'existing-free-quota') {
          assert(priceObservation?.provider === campaign.billing.provider && priceObservation.model === campaign.model
            && priceObservation.plan === 'Free' && priceObservation.newPurchaseAllowed === false
            && priceObservation.remainingQuota > 0, 'campaign-free-route-unverified');
        }
        const inputTokens = Buffer.byteLength(JSON.stringify(request)), outputTokens = request.max_output_tokens;
        const reservedCost = costMicros(campaign, inputTokens, outputTokens);
        withinLimits({ providerCalls: state.providerCalls + 1, accountedTokens: state.accountedTokens + inputTokens + outputTokens,
          spendingUpperBound: (Math.round(state.spendingUpperBound * 1000000) + reservedCost) / 1000000 });
        const reservation = { schemaVersion: 'RsiCampaignReservation/v1', driven_by: 'agent', actor: campaign.actor,
          campaignDigest, sequence: state.providerCalls + 1, identity, endpoint: campaign.endpoint, model: campaign.model,
          createdAt: new Date().toISOString(), request, requestDigest: digest(request), priceObservation,
          reserved: { providerCalls: 1, inputTokens, outputTokens, costMicros: reservedCost } };
        write(join(directory, String(reservation.sequence).padStart(6, '0') + '.reservation.json'), reservation);
        return reservation;
      } catch (error) { release(); throw error; }
    },
    settle(reservation, result) {
      assert(heldToken && read(lock).token === heldToken, 'campaign-settlement-owner');
      const path = join(directory, String(reservation.sequence).padStart(6, '0') + '.settlement.json');
      try {
        assert(!existsSync(path), 'campaign-settlement-already-exists');
        write(path, { schemaVersion: 'RsiCampaignSettlement/v1', driven_by: 'agent', actor: campaign.actor,
          reservationDigest: digest(reservation), endedAt: new Date().toISOString(),
          responseId: result?.response?.id ?? null, responseDigest: result ? digest(result.rawResponse) : null,
          usage: result?.response?.usage ?? null, billedCost: null });
        withinLimits(snapshot());
      } finally { release(); }
    },
  };
}
