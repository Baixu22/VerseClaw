// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { benefitDigest, buildBenefitRequest, createBenefitPlan, validateCollectedBenefitTrial,
  validateProtocolContrastTrial, type ProtocolContrastBudgetAtStart } from '../../scripts/lib/rsi-benefit-eval.mjs';
import { createCampaignLedger, type CampaignBudget } from '../../scripts/lib/rsi-campaign-budget.mjs';
import { createResponsesProvider } from '../../scripts/lib/rsi-responses-provider.mjs';
import { collectCodingTrial } from '../../scripts/rsi-coding-collector.mjs';
import { createProtocolContrastPlan, prefixProtocolLedger, summarizeProtocolContrast, validateProtocolContrastPlan,
  type ProtocolRecord } from '../../scripts/rsi-protocol-contrast.mjs';
import { reconstructProtocolStatistics } from '../../scripts/rsi-protocol-contrast-replay.mjs';

const root = process.cwd(), created: string[] = [];
function scratch() { mkdirSync('D:/tmp', { recursive: true }); const path = mkdtempSync('D:/tmp/rsi-protocol-test-'); created.push(path); return path; }
afterAll(() => { for (const path of created) {
  if (!resolve(path).startsWith(resolve('D:/tmp') + sep + 'rsi-protocol-test-')) throw Error('unsafe-test-cleanup');
  rmSync(path, { recursive: true, force: true });
} });
const campaign = (): CampaignBudget => ({ schemaVersion: 'RsiCampaignBudget/v1', driven_by: 'agent', actor: 'scripted-protocol-test',
  endpoint: 'http://127.0.0.1:3065/v1/responses', model: 'space-bunny',
  authorization: { approvedBy: 'owner', currency: 'CNY', maxCost: 0, maxProviderCalls: 433, maxTotalTokens: 12000000, source: 'scripted authorization fixture' },
  billing: { kind: 'existing-free-quota', currency: 'CNY', provider: 'workbuddy', plan: 'Free', newPurchaseAllowed: false, evidenceDigest: 'a'.repeat(64), creditMultiplier: 'x0.08' } });
const study = createProtocolContrastPlan(root, { campaign: campaign(), runId: 'scripted-contrast' });
const budget: ProtocolContrastBudgetAtStart = { schemaVersion: 'RsiProtocolContrastBudgetAtStart/v1', remainingTokens: 12000000, remainingProviderCalls: 433 };
const price = () => ({ provider: 'workbuddy', model: 'space-bunny', plan: 'Free', remainingQuota: 1000, newPurchaseAllowed: false });

describe('protocol contrasts with scripted providers', () => {
  it('freezes 24 matched tasks, rotating 216 off-only slots and 432 task-call capacity', () => {
    expect(validateProtocolContrastPlan(root, study)).toBe(true);
    expect(study.taskIds).toHaveLength(24); expect(study.slots).toHaveLength(216);
    expect(study.variants.reduce((sum, variant) => sum + variant.callsPerSlot * 72, 0)).toBe(432);
    for (const variant of study.variants) {
      expect(study.slots.filter(slot => slot.variantId === variant.id)).toHaveLength(72);
      expect(variant.plan.budget.campaign).toBeUndefined();
      for (const scheduled of study.slots.filter(slot => slot.variantId === variant.id)) {
        const slot = variant.plan.slots.find(slot => slot.id === scheduled.benefitSlotId)!;
        expect(slot.arm).toBe('sekb-off');
        expect(buildBenefitRequest(variant.plan, slot).instructions).not.toContain(variant.plan.candidate.context);
      }
    }
    expect(study.slots.slice(0, 3).map(slot => slot.variantId)).toEqual(study.variants.map(variant => variant.id));
    expect(study.slots.slice(3, 6).map(slot => slot.variantId)).toEqual(['v3-public-input', 'v4-public-tools', 'v2-legacy-input']);
  });
  it('keeps legacy JSON, public JSON and bounded tool policies explicit', () => {
    const inputs = study.variants.map(variant => buildBenefitRequest(variant.plan, variant.plan.slots.find(slot => slot.arm === 'sekb-off')!));
    expect(JSON.parse(inputs[0].input as string).publicContract).toBeUndefined();
    expect(study.variants[1].plan.tasks[0].publicInputDigest).toBe(benefitDigest(study.variants[1].plan.tasks[0].publicInput));
    expect(inputs[0].tools).toBeUndefined(); expect(inputs[1].tools).toBeUndefined(); expect(inputs[2].tools).toHaveLength(3);
    expect(inputs[0].text!.format.schema.required).toEqual(['edits']);
    expect(inputs[2].text!.format.schema.required).toEqual(['finish']);
  });
  it('rejects altered baselines, version order, flags and resource limits', () => {
    for (const change of [
      (plan: typeof study) => { plan.slots.reverse(); },
      (plan: typeof study) => { plan.variants[1].plan.tasks[0].source.base = 'a'.repeat(40); },
      (plan: typeof study) => { plan.variants[0].plan.arms['sekb-off'].injection = true; },
      (plan: typeof study) => { plan.campaign.authorization.maxProviderCalls = 434; },
    ]) { const altered = structuredClone(study); change(altered); expect(() => validateProtocolContrastPlan(root, altered)).toThrow(); }
  });
  it('shares call limits across prefixed versions without identity collision', async () => {
    const bounded = campaign(); bounded.authorization.maxProviderCalls = 2;
    const ledger = createCampaignLedger({ directory: scratch(), campaign: bounded, verifyPriceBasis: price });
    const request = buildBenefitRequest(study.variants[0].plan, study.variants[0].plan.slots[0]);
    const v2 = prefixProtocolLedger(ledger, 'v2-legacy-input'), v3 = prefixProtocolLedger(ledger, 'v3-public-input');
    v2.settle(await v2.reserve(request, 'same-off-slot/1'), null);
    v3.settle(await v3.reserve(request, 'same-off-slot/1'), null);
    expect(ledger.snapshot().unknownUsageRequests).toEqual(['v2-legacy-input/same-off-slot/1', 'v3-public-input/same-off-slot/1']);
    await expect(prefixProtocolLedger(ledger, 'v4-public-tools').reserve(request, 'same-off-slot/1')).rejects.toThrow('campaign-provider-budget-exhausted');
  });
  it.each(['RsiCodingCollector/v2', 'RsiCodingCollector/v3'])('records zero requests when %s cannot reserve', async version => {
    const plan = createBenefitPlan(root, { codingCollector: true, collectorVersion: version });
    const dir = scratch(), send = vi.fn(), bounded = campaign(); bounded.authorization.maxTotalTokens = 1;
    const ledger = createCampaignLedger({ directory: join(dir, 'ledger'), campaign: bounded, verifyPriceBasis: price });
    const row = await collectCodingTrial({ root, plan, slot: plan.slots[0], apiKey: 'scripted-key', scratch: dir, supportRoot: root, provider: send, campaignLedger: ledger });
    expect(row.execution).toMatchObject({ providerCalls: 0, failureCategory: 'budget', status: 'crash' });
    expect(row.providerAttempts).toEqual([]); expect(ledger.snapshot().providerCalls).toBe(0);
    expect(existsSync(join(dir, row.slot.id, 'dispatch.json'))).toBe(false); expect(send).not.toHaveBeenCalled();
  });
  it('settles a single dispatch and validates off-only data while retaining ordinary prefix checks', async () => {
    const variant = study.variants[1], slot = variant.plan.slots.find(slot => slot.arm === 'sekb-off' && slot.position > 8)!;
    const dir = scratch(), ledger = createCampaignLedger({ directory: join(dir, 'ledger'), campaign: campaign(), verifyPriceBasis: price });
    const transport = vi.fn(async () => new Response(JSON.stringify({ id: 'scripted-v3-result', model: variant.plan.provider.model,
      status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'malformed' }] }],
      usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 } }), { status: 200 }));
    const provider = createResponsesProvider({ ...variant.plan.provider, apiKey: 'scripted-key', reasoningEffort: 'low',
      timeoutMs: 1000, jsonSchema: variant.plan.collector!.responseSchema, transport });
    const row = await collectCodingTrial({ root, plan: variant.plan, slot, scratch: dir, supportRoot: root, apiKey: 'scripted-key', provider,
      campaignLedger: prefixProtocolLedger(ledger, variant.id) });
    expect(ledger.snapshot()).toMatchObject({ providerCalls: 1, knownTokens: 30, accountedTokens: 30, unknownUsageRequests: [] });
    expect(validateProtocolContrastTrial(root, variant.plan, row, budget).outcome).toBe('fail');
    expect(() => validateCollectedBenefitTrial(root, variant.plan, row)).toThrow('trial-prefix-required');
    expect(() => validateProtocolContrastTrial(root, variant.plan, row, { ...budget, remainingTokens: -1 })).toThrow('protocol-budget-context-invalid');
    const injected = { ...row, slot: variant.plan.slots.find(slot => slot.arm === 'sekb-confirmed')! };
    expect(() => validateProtocolContrastTrial(root, variant.plan, injected, budget)).toThrow('protocol-contrast-off-only');
    await expect(collectCodingTrial({ root, plan: variant.plan, slot, scratch: dir, supportRoot: root, apiKey: 'scripted-key', provider })).rejects.toThrow('no-retry');
    expect(transport).toHaveBeenCalledTimes(1);
    expect(readFileSync(join(dir, slot.id, 'receipt.json'), 'utf8')).not.toContain('scripted-key');
  });
  it('retains a dispatched single-request transport failure as one unknown-use reserve', async () => {
    const variant = study.variants[0], slot = variant.plan.slots.find(slot => slot.arm === 'sekb-off')!, dir = scratch();
    const ledger = createCampaignLedger({ directory: join(dir, 'ledger'), campaign: campaign(), verifyPriceBasis: price });
    const provider = vi.fn(async () => { throw Error('scripted HTTP 429'); });
    const row = await collectCodingTrial({ root, plan: variant.plan, slot, scratch: dir, supportRoot: root, apiKey: 'scripted-key', provider,
      campaignLedger: prefixProtocolLedger(ledger, variant.id) });
    expect(row.execution).toMatchObject({ providerCalls: 1, failureCategory: 'provider', status: 'crash' });
    expect(ledger.snapshot().unknownUsageRequests).toEqual([variant.id + '/' + slot.id + '/1']);
    expect(validateProtocolContrastTrial(root, variant.plan, row, budget).outcome).toBe('crash');
  });
  it('independently reconstructs two case-cluster effects and preserves correlated repeats and incomplete cases', () => {
    const records = study.slots.map(scheduledSlot => {
      const index = study.taskIds.indexOf(scheduledSlot.caseId);
      const pass = scheduledSlot.variantId === 'v3-public-input' ? index < 8 : scheduledSlot.variantId === 'v4-public-tools' && index < 4;
      return { scheduledSlot, outcome: pass ? 'pass' : 'fail', failureClass: pass ? null : 'agent', tokens: 30, turns: 1, toolCalls: 0,
        row: { execution: { wallClockMs: 1 } } } as ProtocolRecord;
    });
    const independent = reconstructProtocolStatistics(study, records), actual = summarizeProtocolContrast(study, records);
    expect(independent.comparisons['v3-minus-v2'].pairCount).toBe(24);
    expect(independent.comparisons['v4-minus-v3'].meanDiff).toBe(-4 / 24);
    for (const name of ['v3-minus-v2', 'v4-minus-v3']) {
      expect(actual[name].pairedDiff.meanDiff).toBe(independent.comparisons[name].meanDiff);
      expect(actual[name].pairedDiff.ci95).toEqual(independent.comparisons[name].ci95);
      expect(actual[name].power.requiredCasesApprox).toBe(independent.comparisons[name].power.requiredCasesApprox);
    }
    const toolsFromZero = summarizeProtocolContrast(study, records.map(record => ({ ...record,
      toolCalls: record.scheduledSlot.variantId === 'v4-public-tools' ? 1 : 0 })));
    expect(toolsFromZero['v4-minus-v3'].budget.observedRelativeToolCallIncrease).toBe(Infinity);
    expect(JSON.parse(JSON.stringify(toolsFromZero))['v4-minus-v3'].budget.observedRelativeToolCallIncrease).toBeNull();
    const partial = reconstructProtocolStatistics(study, records.filter(record => record.scheduledSlot.position !== 1));
    expect(partial.comparisons['v3-minus-v2'].pairCount).toBe(23); expect(partial.unexecutedSlots).toBe(1);
    expect(() => reconstructProtocolStatistics(study, [...records, records[0]])).toThrow('duplicate-or-unknown-slot');
    const zero = reconstructProtocolStatistics(study, records.map(record => ({ ...record, outcome: 'fail' })));
    expect(zero.comparisons['v3-minus-v2']).toMatchObject({ meanDiff: 0, ci95: null, varianceStatus: 'degenerate', power: { requiredCasesApprox: null } });
  });
});
