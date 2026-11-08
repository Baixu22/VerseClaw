// @vitest-environment node
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createCampaignLedger, validateCampaignBudget, type CampaignBudget } from '../../scripts/lib/rsi-campaign-budget.mjs';
import { buildResponsesRequest, type ResponsesProviderResult } from '../../scripts/lib/rsi-responses-provider.mjs';

const directories: string[] = [];
function directory() {
  mkdirSync('D:/tmp', { recursive: true });
  const path = mkdtempSync('D:/tmp/rsi-campaign-budget-test-'); directories.push(path); return path;
}
const budget = (): CampaignBudget => ({ schemaVersion: 'RsiCampaignBudget/v1', driven_by: 'agent', actor: 'test-campaign',
  endpoint: 'http://127.0.0.1:3065/v1/responses', model: 'space-bunny',
  authorization: { approvedBy: 'owner', currency: 'CNY', maxCost: 300, maxProviderCalls: 3, maxTotalTokens: 100000, source: 'test fixture' },
  billing: { kind: 'token-tariff', currency: 'CNY', inputPerMillion: 5, outputPerMillion: 20, evidenceDigest: 'a'.repeat(64) } });
const request = buildResponsesRequest({ model: 'space-bunny', instructions: 'Return the marker.', input: 'marker', maxOutputTokens: 100 });
const result = (tokens = 10): ResponsesProviderResult => ({ request: {} as never,
  response: { id: 'provider-response', model: 'space-bunny', status: 'completed', text: 'marker', functionCalls: [], incompleteReason: null,
    usage: { inputTokens: tokens, outputTokens: tokens, totalTokens: tokens * 2 } }, rawResponse: { id: 'provider-response' } });
afterAll(() => { for (const path of directories) {
  if (!resolve(path).startsWith(resolve('D:/tmp/rsi-campaign-budget-test-'))) throw new Error('unsafe-test-cleanup');
  rmSync(path, { recursive: true, force: true });
} });

describe('whole-campaign provider resources', () => {
  it('counts preflight and continuation together and refuses a fourth dispatch', async () => {
    const ledger = createCampaignLedger({ directory: directory(), campaign: budget() });
    for (const identity of ['provider-preflight', 'slot/1', 'slot/2']) ledger.settle(await ledger.reserve(request, identity), result());
    expect(ledger.snapshot()).toMatchObject({ providerCalls: 3, knownTokens: 60, accountedTokens: 60, currency: 'CNY' });
    await expect(ledger.reserve(request, 'slot/3')).rejects.toThrow('campaign-provider-budget-exhausted');
  });
  it('reserves input and bounded output spending before a network request', async () => {
    const campaign = budget(); campaign.authorization.maxCost = 0.001;
    const ledger = createCampaignLedger({ directory: directory(), campaign });
    await expect(ledger.reserve(request, 'slot/1')).rejects.toThrow('campaign-money-budget-exhausted');
    expect(ledger.snapshot().providerCalls).toBe(0);
  });
  it('retains the full reserve for unknown usage and rejects duplicate dispatch after reopening', async () => {
    const path = directory(), campaign = budget();
    const ledger = createCampaignLedger({ directory: path, campaign });
    ledger.settle(await ledger.reserve(request, 'provider-preflight'), null);
    const reopened = createCampaignLedger({ directory: path, campaign });
    expect(reopened.snapshot()).toMatchObject({ providerCalls: 1, knownTokens: 0,
      accountedTokens: Buffer.byteLength(JSON.stringify(request)) + 100, unknownUsageRequests: ['provider-preflight'] });
    await expect(reopened.reserve(request, 'provider-preflight')).rejects.toThrow('already-reserved-no-retry');
  });
  it('keeps an interrupted reservation and reclaims only a dead ledger owner', async () => {
    const path = directory(), campaign = budget(), ledger = createCampaignLedger({ directory: path, campaign });
    await ledger.reserve(request, 'slot/1');
    writeFileSync(join(path, 'request.lock'), JSON.stringify({ pid: 2147483647, token: 'interrupted-fixture' }));
    const resumed = createCampaignLedger({ directory: path, campaign });
    const reservation = await resumed.reserve(request, 'slot/2'); resumed.settle(reservation, result());
    expect(resumed.snapshot().unknownUsageRequests).toEqual(['slot/1']);
  });
  it('enforces the token reserve and retains a reported overrun before stopping', async () => {
    const campaign = budget(); campaign.authorization.maxTotalTokens = 300;
    const ledger = createCampaignLedger({ directory: directory(), campaign });
    const reservation = await ledger.reserve(request, 'slot/1');
    expect(() => ledger.settle(reservation, result(200))).toThrow('campaign-token-budget-exhausted');
    expect(ledger.snapshot().knownTokens).toBe(400);
    await expect(ledger.reserve(request, 'slot/2')).rejects.toThrow('campaign-token-budget-exhausted');
  });
  it('requires a current Free route and records zero new spending while preserving credit units', async () => {
    const campaign = budget(); campaign.billing = { kind: 'existing-free-quota', currency: 'CNY', provider: 'workbuddy', plan: 'Free',
      newPurchaseAllowed: false, evidenceDigest: 'a'.repeat(64), creditMultiplier: 'x0.08' };
    expect(() => createCampaignLedger({ directory: directory(), campaign })).toThrow('live-free-quota-verifier-required');
    let plan = 'Free';
    const ledger = createCampaignLedger({ directory: directory(), campaign, verifyPriceBasis: () => ({ provider: 'workbuddy',
      model: 'space-bunny', plan, remainingQuota: 1000, newPurchaseAllowed: false }) });
    ledger.settle(await ledger.reserve(request, 'slot/1'), result());
    expect(ledger.snapshot().spendingUpperBound).toBe(0);
    plan = 'Paid';
    await expect(ledger.reserve(request, 'slot/2')).rejects.toThrow('campaign-free-route-unverified');
    expect(ledger.snapshot().providerCalls).toBe(1);
  });
  it('refuses model/currency drift and forged reservation accounting', async () => {
    const path = directory(), campaign = budget(), ledger = createCampaignLedger({ directory: path, campaign });
    await expect(ledger.reserve({ ...request, model: 'other' }, 'slot/1')).rejects.toThrow('campaign-model-drift');
    const reservation = await ledger.reserve(request, 'slot/1'); ledger.settle(reservation, result());
    const file = join(path, '000001.reservation.json'), forged = JSON.parse(readFileSync(file, 'utf8'));
    forged.reserved.costMicros = 0; writeFileSync(file, JSON.stringify(forged));
    expect(() => ledger.snapshot()).toThrow('campaign-cost-reservation-drift');
    const invalid = budget(); (invalid.authorization as { currency: string }).currency = 'USD';
    expect(() => validateCampaignBudget(invalid)).toThrow('campaign-owner-currency');
  });
});
