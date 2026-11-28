// @vitest-environment node
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createRetrievalSpend } from '../../openclaw_runtime/src/knowledge/retrieval/spend';
import { closeOpenClawStateDatabase } from '../../openclaw_runtime/src/state/openclaw-state-db';
import { providerSpendSnapshot } from '../../openclaw_runtime/src/agents/provider-spend-budget';
import { normalizeRunScope } from '../../shared/types/identity-scope';

beforeEach(() => vi.stubEnv('OPENCLAW_STATE_DIR', mkdtempSync(path.join(tmpdir(), 'rag-retrieval-spend-'))));
afterEach(() => { closeOpenClawStateDatabase(); vi.unstubAllEnvs(); });
const config = { models: { providers: { fixture: { baseUrl: 'https://example.test/v1', models: [{ id: 'embed', name: 'embed',
  input: ['text' as const], reasoning: false, contextWindow: 8000, maxTokens: 1,
  cost: { input: 1, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } } };
const setup = (overrides: Partial<Parameters<typeof createRetrievalSpend>[0]> = {}) => createRetrievalSpend({
  config, budget: { requestId: 'research-spend-fixture', maxTokens: 2000, maxCostUsd: 0.002 },
  workspaceId: 'owner', sessionKey: 'agent:main:owner', sessionGeneration: 'gen1', assertScope() {}, ...overrides,
});
const request = () => ({ providerRef: 'fixture', model: 'embed', texts: ['Hello'], signal: new AbortController().signal });

it('reserves before dispatch, settles actual tokens, and shares the ceiling across recreated query wrappers', async () => {
  const spend = setup();
  await spend.call(request(), async report => {
    expect(await spend.snapshot()).toMatchObject({ calls: 1, reservedTokens: 517, actualTokens: null });
    report(5); return [1, 2];
  });
  expect(await setup().snapshot()).toMatchObject({ calls: 1, actualTokens: 5, actualCostUsd: 0.000005 });
  for (let count = 0; count < 2; count++) await setup().call(request(), async report => { report(5); });
  const dispatch = vi.fn();
  await expect(setup().call(request(), dispatch)).rejects.toThrow(/tokens/);
  expect(dispatch).not.toHaveBeenCalled();
  expect((await spend.snapshot()).calls).toBe(3);
});

it('holds unknown usage and prevents another billed call in the same request', async () => {
  const spend = setup(); await spend.call(request(), async () => [1]);
  expect(await spend.snapshot()).toMatchObject({ calls: 1, actualTokens: null, actualCostUsd: null, reservedCostUsd: 0.000517 });
  await expect(spend.call(request(), async () => [2])).rejects.toThrow(/unknown-cost/);
});

it.each([undefined, 0, -1, NaN])('does not dispatch without an explicit positive input tariff (%s)', async price => {
  const unpriced = structuredClone(config); unpriced.models.providers.fixture.models[0].cost.input = price as number;
  const dispatch = vi.fn(); await expect(setup({ config: unpriced }).call(request(), dispatch)).rejects.toThrow(/cost-unquoted/);
  expect(dispatch).not.toHaveBeenCalled();
});

it('uses the host/project/session owner limits in addition to the Research ceiling', async () => {
  const spend = setup({ config: { ...config, runtime: { providerBudget: { host: { maxTokens: 500 } } } } });
  await expect(spend.call(request(), async () => [1])).rejects.toThrow(/tokens \(host\)/);
  expect(await spend.snapshot()).toMatchObject({ calls: 0, actualTokens: 0, actualCostUsd: 0 });
});

it('keeps over-reservation consumption visible even when the result is rejected', async () => {
  const spend = setup(); await expect(spend.call(request(), async report => { report(600); return [1]; })).rejects.toThrow(/exceeds-reservation/);
  expect(await spend.snapshot()).toMatchObject({ calls: 1, actualTokens: 600, actualCostUsd: 0.0006 });
});

it('cancels an unsent reservation on an owner change and leaves no charge', async () => {
  let checks = 0;
  const spend = setup({ assertScope() { if (++checks === 3) throw new Error('owner changed'); } });
  const dispatch = vi.fn(); await expect(spend.call(request(), dispatch)).rejects.toThrow('owner changed');
  expect(dispatch).not.toHaveBeenCalled(); expect((await spend.snapshot()).calls).toBe(0);
});

it('isolates request ledgers by scope while retaining the owner session accounting', async () => {
  const spend = setup(); await spend.call(request(), async report => { report(5); });
  expect((await setup({ sessionGeneration: 'gen2' }).snapshot()).calls).toBe(0);
  const scope = normalizeRunScope({ runId: 'fixture', scope: { workspaceId: 'owner', sessionKey: 'agent:main:owner' } }).scope;
  expect(providerSpendSnapshot({ ...scope, sessionKey: scope.sessionKey!, sessionGeneration: 'gen1' })[2].spentTokens).toBe(5);
});
