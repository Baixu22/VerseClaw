// @vitest-environment node
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reserveProviderSpend, markProviderSpendSent, cancelUnsentProviderSpend, reconcileProviderSpend,
  providerSpendSnapshot, wrapProviderSpendStream, type ProviderSpendScope } from '../../openclaw_runtime/src/agents/provider-spend-budget';
import { closeOpenClawStateDatabase, openOpenClawStateDatabase } from '../../openclaw_runtime/src/state/openclaw-state-db';
import { normalizeRunScope } from '../../shared/types/identity-scope';
import type { AssistantMessage, Model, StreamFn } from '../../openclaw_runtime/packages/llm-core/src/types';
import { createAssistantMessageEventStream } from '../../openclaw_runtime/packages/llm-core/src/utils/event-stream';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { buildGuardedModelFetch } from '../../openclaw_runtime/src/agents/provider-transport-fetch';
import { attachModelProviderRequestTransport, resolveProviderRequestPolicyConfig } from '../../openclaw_runtime/src/agents/provider-request-config';
import { configureProviderOutboundBudget, resetProviderOutboundBudget, acquireProviderOutboundSlot, resolveProviderOutboundQuotaGroup, providerOutboundBudgetStats } from '../../openclaw_runtime/src/agents/provider-outbound-budget';
import { resolveEmbeddedAgentStreamFn } from '../../openclaw_runtime/src/agents/embedded-agent-runner/stream-resolution';
import { readRuntimeSessionResourceInventory } from '../../openclaw_runtime/src/gateway/session-resource-inventory';
import * as runtimeConfig from '../../openclaw_runtime/src/config/config';
import { resetResourceEnvelopeLedgerForTest } from '../../openclaw_runtime/src/resources/resource-envelope';
import { loadSessionStore, updateSessionStore } from '../../openclaw_runtime/src/config/sessions/store';
import { normalizeSessionEntrySlotKey } from '../../openclaw_runtime/src/plugins/session-entry-slot-keys';

const scope = (project = 'project-a', session = 'session-a'): ProviderSpendScope => {
  const value = normalizeRunScope({ runId: 'fixture', scope: { workspaceId: project, projectId: project, sessionKey: session } }).scope;
  if (!value.sessionKey) throw new Error('Fixture session missing');
  return { ...value, sessionKey: value.sessionKey, sessionGeneration: 'generation-one' };
};
const model: Model = { id: 'fixture', name: 'fixture', provider: 'fixture', api: 'openai-completions',
  baseUrl: 'http://127.0.0.1:1', input: ['text'], reasoning: false, contextWindow: 80, maxTokens: 20,
  cost: { input: 1, output: 2, cacheRead: 1, cacheWrite: 1 } };
const message = (tokens: number): AssistantMessage => ({ role: 'assistant', content: [], provider: model.provider,
  model: model.id, api: model.api, timestamp: Date.now(), stopReason: 'stop',
  usage: { input: tokens, output: 0, totalTokens: tokens, cacheRead: 0, cacheWrite: 0,
    cost: { input: tokens / 1e6, output: 0, cacheRead: 0, cacheWrite: 0, total: tokens / 1e6 } } });

describe('provider owner layered spend reservation', () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(path.join(tmpdir(), 'r1-spend-')); vi.stubEnv('OPENCLAW_STATE_DIR', root); });
  afterEach(() => { closeOpenClawStateDatabase(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
  const reserve = (id: string, overrides: Partial<Parameters<typeof reserveProviderSpend>[0]> = {}) => reserveProviderSpend({
    callId: id, runId: 'run-' + id, provider: 'fixture', model: 'fixture', requestDigest: id,
    scope: scope(), reservedTokens: 60, reservedCostUsd: 0.006,
    config: { host: { maxTokens: 100 }, project: { maxTokens: 100 }, session: { maxTokens: 100 } }, ...overrides,
  });

  it('rejects a plugin slot that would overwrite the owner workspace budget identity', () => {
    expect(normalizeSessionEntrySlotKey('workspaceId')).toMatchObject({ ok: false, error: expect.stringContaining('reserved') });
    expect(normalizeSessionEntrySlotKey('fixtureWorkspaceNotes')).toEqual({ ok: true, key: 'fixtureWorkspaceNotes' });
  });

  it('reserves every scope atomically, denies overspend across sessions, and reconciles once', () => {
    const first = reserve('one');
    expect(() => reserve('two', { scope: scope('project-a', 'session-b') })).toThrow(/tokens \(host\)/);
    expect(providerSpendSnapshot(scope()).map(row => row.heldTokens)).toEqual([60, 60, 60]);
    const db = openOpenClawStateDatabase().db;
    expect(db.prepare('SELECT count(*) AS count FROM provider_spend_calls').get()!.count).toBe(1);
    markProviderSpendSent(first);
    const usage = { tokens: 20, costUsd: 0.002, evidenceRef: 'provider-result-one' };
    reconcileProviderSpend(first, usage); reconcileProviderSpend(first, usage);
    expect(providerSpendSnapshot(scope()).map(row => row.spentTokens)).toEqual([20, 20, 20]);
    reserve('two', { scope: scope('project-a', 'session-b') });
    expect(providerSpendSnapshot(scope())[0]).toMatchObject({ spentTokens: 20, heldTokens: 60 });
    expect(() => reconcileProviderSpend(first, { ...usage, tokens: 0 })).toThrow(/conflict/);
  });

  it.each(['project', 'session'] as const)('enforces %s even with a larger host quota and preserves rollback', dimension => {
    const config = { host: { maxTokens: 1000 }, [dimension]: { maxTokens: 100 } };
    reserve('one', { config });
    expect(() => reserve('two', { config })).toThrow(`tokens (${dimension})`);
    expect(providerSpendSnapshot(scope())[0].heldTokens).toBe(60);
  });

  it('reserves known USD across projects without charging the same reconciliation twice', () => {
    const config = { host: { maxCostUsd: 0.01 }, project: { maxCostUsd: 1 }, session: { maxCostUsd: 1 } };
    const first = reserve('known-usd', { config });
    expect(() => reserve('other-project', { config, scope: scope('project-b', 'session-b') })).toThrow(/cost \(host\)/);
    markProviderSpendSent(first);
    const usage = { tokens: 20, costUsd: 0.002, evidenceRef: 'known-invoice-units' };
    reconcileProviderSpend(first, usage); reconcileProviderSpend(first, usage);
    reserve('other-project', { config, scope: scope('project-b', 'session-b') });
    expect(providerSpendSnapshot(scope())[0]).toMatchObject({ spentCostMicros: 2000, heldCostMicros: 6000 });
    expect(providerSpendSnapshot(scope('project-b', 'session-b'))[1]).toMatchObject({ spentCostMicros: 0, heldCostMicros: 6000 });
  });

  it('keeps project ceilings shared by sessions and isolated between owner-supplied projects', () => {
    const config = { host: { maxTokens: 1000 }, project: { maxTokens: 100 } };
    reserve('same-project-first', { config });
    expect(() => reserve('same-project-second', { config, scope: scope('project-a', 'session-b') })).toThrow(/tokens \(project\)/);
    reserve('different-project', { config, scope: scope('project-b', 'session-b') });
    expect(providerSpendSnapshot(scope())[0].heldTokens).toBe(120);
    expect(providerSpendSnapshot(scope())[1].heldTokens).toBe(60);
  });

  it('session budget cannot be reset by changing the project coordinate', () => {
    const config = { session: { maxTokens: 100 } };
    reserve('project-one', { config });
    expect(() => reserve('project-two', { config, scope: scope('project-b', 'session-a') })).toThrow(/tokens \(session\)/);
  });

  it('rebuilds the runtime provider projection after caches and DB handles are cleared', async () => {
    const sessionStorePath = path.join(root, 'sessions.json');
    await updateSessionStore(sessionStorePath, store => { store['session-a'] = { sessionId: 'generation-one', updatedAt: Date.now(), workspaceId: 'project-a' }; }, { skipMaintenance: true });
    vi.spyOn(runtimeConfig, 'getRuntimeConfig').mockReturnValue({ session: { store: sessionStorePath }, runtime: { providerBudget: { host: { maxTokens: 100 } } } });
    reserve('projection');
    const read = () => readRuntimeSessionResourceInventory({ agentId: 'main', sessionKey: 'session-a', expectedSessionId: 'generation-one',
      workspaceId: 'project-a', rootPath: root });
    const before = await read();
    resetResourceEnvelopeLedgerForTest(); closeOpenClawStateDatabase();
    const after = await read();
    const provider = (inventory: typeof before) => inventory.owners.find(owner => owner.kind === 'provider');
    expect(provider(after)).toEqual(provider(before));
    expect(provider(after)).toMatchObject({ state: 'known', authority: 'managed', count: 1,
      spend: expect.arrayContaining([expect.objectContaining({ scope: 'host', heldTokens: 60 })]) });
    const mismatch = await readRuntimeSessionResourceInventory({ agentId: 'main', sessionKey: 'session-a', expectedSessionId: 'generation-one', workspaceId: 'project-b', rootPath: root });
    expect(provider(mismatch)).toMatchObject({ state: 'unknown', count: null });
    expect(() => reserve('still-held')).toThrow(/tokens/);
  });

  it('unknown usage survives SQLite reopen and cannot be freed by TTL or forged owner', () => {
    const first = reserve('unknown'); markProviderSpendSent(first);
    reconcileProviderSpend(first, { tokens: null, costUsd: null, evidenceRef: 'cancelled-without-usage' });
    closeOpenClawStateDatabase();
    expect(providerSpendSnapshot(scope())[0]).toMatchObject({ heldTokens: 60, heldCostMicros: 6000, unknownTokenCalls: 1, unknownCostCalls: 1 });
    expect(() => reserve('second', { config: { host: { maxCostUsd: 1 } } })).toThrow(/unknown-cost/);
    expect(() => cancelUnsentProviderSpend(first)).toThrow(/after dispatch/);
    expect(() => reconcileProviderSpend({ ...first, ownerToken: 'forged' }, { tokens: 0, costUsd: 0, evidenceRef: 'fake' })).toThrow(/owner mismatch/);
    reconcileProviderSpend(first, { tokens: 25, costUsd: 0.0025, evidenceRef: 'late-provider-usage' });
    expect(providerSpendSnapshot(scope())[0]).toMatchObject({ spentTokens: 25, heldTokens: 0, unknownCostCalls: 0 });
    expect(openOpenClawStateDatabase().db.prepare('SELECT * FROM provider_spend_reconciliations').all()).toHaveLength(2);
  });

  it('rejects unknown scope and cost before reserving, and compensates only unsent reservations', () => {
    expect(() => reserve('missing', { scope: { sessionKey: scope().sessionKey, sessionGeneration: 'g' } })).toThrow(/scope/);
    expect(() => reserve('unpriced', { reservedCostUsd: null, config: { host: { maxCostUsd: 2 } } })).toThrow(/unknown-cost/);
    const first = reserve('unused'); cancelUnsentProviderSpend(first);
    expect(providerSpendSnapshot(scope())[0].heldTokens).toBe(0);
    expect(() => reserve('unused')).toThrow(/duplicate/);
  });

  it('rejects invalid estimates instead of allowing NaN or negative cost to mint capacity', () => {
    for (const reservedTokens of [NaN, Infinity, -1, 0.5]) expect(() => reserve('bad', { reservedTokens })).toThrow();
    for (const reservedCostUsd of [NaN, Infinity, -1]) expect(() => reserve('bad', { reservedCostUsd })).toThrow();
  });

  it('never rounds a fractional microdollar ceiling upward or lets actual overruns create credit', () => {
    expect(() => reserve('fraction', { reservedCostUsd: 0.000001, config: { host: { maxCostUsd: 0.0000005 } } })).toThrow(/cost/);
    const first = reserve('overrun'); markProviderSpendSent(first);
    reconcileProviderSpend(first, { tokens: 110, costUsd: 0.02, evidenceRef: 'provider-reported-overrun' });
    expect(providerSpendSnapshot(scope())[0]).toMatchObject({ spentTokens: 110, heldTokens: 0, spentCostMicros: 20000 });
    expect(() => reserve('blocked-after-overrun')).toThrow(/tokens/);
  });

  it('gates the real stream boundary and settles from final usage before returning its result', async () => {
    const stream = createAssistantMessageEventStream();
    let calls = 0;
    const inner: StreamFn = () => { calls++; return stream; };
    const run = { config: { host: { maxTokens: 100 } }, workspaceId: 'project-a', sessionKey: 'session-a', sessionGeneration: 'generation-one' };
    const first = await wrapProviderSpendStream(inner, { ...run, runId: 'one' })(model, { messages: [] });
    await expect(wrapProviderSpendStream(inner, { ...run, runId: 'two', sessionKey: 'session-b' })(model, { messages: [] })).rejects.toThrow(/tokens/);
    expect(calls).toBe(1);
    stream.push({ type: 'done', reason: 'stop', message: message(10) });
    await first.result();
    expect(providerSpendSnapshot(scope())[0]).toMatchObject({ spentTokens: 10, heldTokens: 0, activeCalls: 0 });
    const evidence = path.join(process.cwd(), 'artifacts/runs/autonomy-resource-admission', 'spend-' + path.basename(root));
    mkdirSync(evidence, { recursive: true });
    writeFileSync(path.join(evidence, 'owner.json'), JSON.stringify({ driven_by: 'agent', actor: 'codex-r1-spend-test',
      scope: scope(), calls, snapshot: providerSpendSnapshot(scope()), databasePath: openOpenClawStateDatabase().path,
      raw: openOpenClawStateDatabase().db.prepare('SELECT call_id, state, actual_tokens, actual_cost_micros FROM provider_spend_calls').all() }, null, 2) + '\n');
  });

  it('keeps the disabled stream unchanged and never treats unpriced usage as zero USD', async () => {
    const inner: StreamFn = () => { const stream = createAssistantMessageEventStream(); stream.push({ type: 'done', reason: 'stop', message: message(10) }); return stream; };
    const run = { workspaceId: 'project-a', sessionKey: 'session-a', sessionGeneration: 'generation-one', runId: 'unpriced' };
    expect(wrapProviderSpendStream(inner, run)).toBe(inner);
    const unknownModel = { ...model, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
    const stream = await wrapProviderSpendStream(inner, { ...run, config: { host: { maxTokens: 100 } } })(unknownModel, { messages: [] });
    await stream.result();
    expect(providerSpendSnapshot(scope())[0]).toMatchObject({ spentTokens: 10, spentCostMicros: 0, unknownCostCalls: 1 });
    expect(() => reserve('priced-later', { config: { host: { maxCostUsd: 100 } } })).toThrow(/unknown-cost/);
  });

  it('pins the run identity before mutable caller metadata changes', async () => {
    const inner: StreamFn = () => { const stream = createAssistantMessageEventStream(); stream.push({ type: 'done', reason: 'stop', message: message(10) }); return stream; };
    const run = { config: { host: { maxTokens: 1000 } }, workspaceId: 'project-a', sessionKey: 'session-a', sessionGeneration: 'generation-one', runId: 'pinned' };
    const wrapped = resolveEmbeddedAgentStreamFn({ currentStreamFn: inner, providerStreamFn: inner, model,
      sessionId: run.sessionGeneration, runId: run.runId, spend: run });
    Object.assign(run, { workspaceId: 'project-b', sessionKey: 'session-b', sessionGeneration: 'generation-two', runId: 'changed' });
    await (await wrapped(model, { messages: [] })).result();
    expect(providerSpendSnapshot(scope()).find(row => row.scope === 'session')).toMatchObject({ spentTokens: 10 });
    expect(providerSpendSnapshot(scope('project-b', 'session-b')).find(row => row.scope === 'project')).toMatchObject({ spentTokens: 0 });
  });

  it('reads the session owner project and rejects missing, stale or conflicting identities before sending', async () => {
    const sessionStorePath = path.join(root, 'sessions.json');
    await updateSessionStore(sessionStorePath, store => { store['session-a'] = { sessionId: 'generation-one', updatedAt: Date.now(), workspaceId: 'project-a' }; }, { skipMaintenance: true });
    const inner = vi.fn<StreamFn>(() => { const stream = createAssistantMessageEventStream(); stream.push({ type: 'done', reason: 'stop', message: message(10) }); return stream; });
    const run = { config: { project: { maxTokens: 200 } }, sessionStorePath, sessionKey: 'session-a', sessionGeneration: 'generation-one', runId: 'owner-project' };
    await (await wrapProviderSpendStream(inner, run)(model, { messages: [] })).result();
    expect(providerSpendSnapshot(scope())[1]).toMatchObject({ spentTokens: 10 });
    for (const changed of [{ workspaceId: 'project-b' }, { sessionGeneration: 'generation-two' }, { sessionKey: 'missing-session' }]) {
      await expect(wrapProviderSpendStream(inner, { ...run, ...changed, runId: 'reject-' + JSON.stringify(changed) })(model, { messages: [] })).rejects.toThrow(/scope/);
    }
    expect(inner).toHaveBeenCalledTimes(1);
    expect(openOpenClawStateDatabase().db.prepare('SELECT call_id FROM provider_spend_calls').all()).toHaveLength(1);
  });

  it('persists the trusted initial workspace and recovers it after the owner DB is reopened', async () => {
    const sessionStorePath = path.join(root, 'sessions.json');
    await updateSessionStore(sessionStorePath, store => { store['session-a'] = { sessionId: 'generation-one', updatedAt: Date.now() }; }, { skipMaintenance: true });
    const inner: StreamFn = () => { const stream = createAssistantMessageEventStream(); stream.push({ type: 'done', reason: 'stop', message: message(10) }); return stream; };
    const run = { config: { project: { maxTokens: 200 } }, sessionStorePath, sessionKey: 'session-a', sessionGeneration: 'generation-one' };
    await (await wrapProviderSpendStream(inner, { ...run, workspaceId: 'project-a', runId: 'initial' })(model, { messages: [] })).result();
    expect(loadSessionStore(sessionStorePath, { skipCache: true })['session-a'].workspaceId).toBe('project-a');
    closeOpenClawStateDatabase();
    await (await wrapProviderSpendStream(inner, { ...run, runId: 'resumed' })(model, { messages: [] })).result();
    expect(providerSpendSnapshot(scope())[1]).toMatchObject({ spentTokens: 20, heldTokens: 0 });
  });

  it('the production stream resolver and guarded HTTP boundary refuse a physical retry before a second send', async () => {
    let arrivals = 0;
    const server = createServer((request, response) => { request.resume(); arrivals++; response.writeHead(500, { 'content-type': 'application/json' }); response.end('{"error":"fixture retry"}'); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address(); if (!addr || typeof addr === 'string') throw new Error('No fixture port');
    const httpModel = attachModelProviderRequestTransport({ ...model, baseUrl: `http://127.0.0.1:${addr.port}/v1` }, { allowPrivateNetwork: true });
    const guarded = buildGuardedModelFetch(httpModel, 30000, { sanitizeSse: false });
    const transport: StreamFn = async () => {
      for (let attempt = 0; attempt < 2; attempt++) { const response = await guarded(httpModel.baseUrl + '/chat/completions', { method: 'POST', body: '{}' }); await response.text(); }
      throw new Error('Unexpected second send');
    };
    const wrapper = resolveEmbeddedAgentStreamFn({ currentStreamFn: transport, providerStreamFn: transport, sessionId: 'generation-one', runId: 'http-retry', model: httpModel,
      spend: { config: { host: { maxTokens: 100 } }, sessionKey: 'session-a', sessionGeneration: 'generation-one', workspaceId: 'project-a', runId: 'http-retry' } });
    try {
      await expect(wrapper(httpModel, { messages: [] })).rejects.toThrow(/tokens/);
      expect(arrivals).toBe(1);
      expect(providerSpendSnapshot(scope())[0]).toMatchObject({ heldTokens: 100, unknownTokenCalls: 1 });
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });

  it('settles priced usage from the captured rate and preserves the raw normalized message', async () => {
    const pricedModel = { ...model, cost: { ...model.cost } };
    const raw = message(10); raw.usage.cost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
    const inner: StreamFn = () => {
      pricedModel.cost.input = 0.1;
      const stream = createAssistantMessageEventStream(); stream.push({ type: 'done', reason: 'stop', message: raw }); return stream;
    };
    const result = await (await wrapProviderSpendStream(inner, { workspaceId: 'project-a', sessionKey: 'session-a', sessionGeneration: 'generation-one',
      runId: 'normalized-zero-cost', config: { host: { maxCostUsd: 1 } } })(pricedModel, { messages: [] })).result();
    expect(providerSpendSnapshot(scope())[0]).toMatchObject({ spentTokens: 10, spentCostMicros: 10, unknownCostCalls: 0 });
    expect(result.usage.cost.total).toBe(0);
  });

  it('does not price an incomplete usage breakdown as a free request', async () => {
    const raw = message(10); raw.usage.input = NaN; raw.usage.cost.total = 0;
    const inner: StreamFn = () => { const stream = createAssistantMessageEventStream(); stream.push({ type: 'done', reason: 'stop', message: raw }); return stream; };
    await (await wrapProviderSpendStream(inner, { workspaceId: 'project-a', sessionKey: 'session-a', sessionGeneration: 'generation-one', runId: 'invalid-cost-breakdown',
      config: { host: { maxTokens: 100 } } })(model, { messages: [] })).result();
    expect(providerSpendSnapshot(scope())[0]).toMatchObject({ spentTokens: 10, unknownCostCalls: 1, heldCostMicros: 200 });
  });

  it('rejects a zero model bound before reserving or invoking the provider', async () => {
    const inner = vi.fn<StreamFn>();
    await expect(wrapProviderSpendStream(inner, { sessionKey: 'session-a', sessionGeneration: 'generation-one', runId: 'unmeasured-input-bound',
      config: { host: { maxTokens: 100 } } })({ ...model, contextWindow: 0 }, { messages: [] })).rejects.toThrow(/bound/);
    expect(inner).not.toHaveBeenCalled();
  });

  it.each(['overloaded', 'cancelled'] as const)('compensates the spend reservation when the transport confirms %s before wire dispatch', async mode => {
    let requests = 0;
    const server = createServer((request, response) => { request.resume(); requests++; response.end('fixture'); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('No fixture port');
    const httpModel = attachModelProviderRequestTransport({ ...model, baseUrl: `http://127.0.0.1:${address.port}/v1` }, { allowPrivateNetwork: true });
    const requestConfig = resolveProviderRequestPolicyConfig({ provider: model.provider, api: model.api, baseUrl: httpModel.baseUrl, allowPrivateNetwork: true });
    const group = resolveProviderOutboundQuotaGroup({ model: httpModel, requestConfig });
    configureProviderOutboundBudget({ limits: { maxConcurrent: 1, maxQueue: mode === 'cancelled' ? 1 : 0, queueTimeoutMs: 30000 } });
    const held = await acquireProviderOutboundSlot({ group }); if (!held.ok) throw new Error('Fixture slot refused');
    const controller = new AbortController();
    const guarded = buildGuardedModelFetch(httpModel, 30000, { sanitizeSse: false });
    const inner: StreamFn = async (_model, _context, options) => {
      await guarded(httpModel.baseUrl + '/chat/completions', { method: 'POST', body: '{}', signal: options?.signal });
      throw new Error('The refused request must not reach the provider');
    };
    const pending = wrapProviderSpendStream(inner, { workspaceId: 'project-a', sessionKey: 'session-a', sessionGeneration: 'generation-one',
      runId: 'no-wire-' + mode, config: { host: { maxTokens: 100 } } })(httpModel, { messages: [] }, { signal: controller.signal });
    void Promise.resolve(pending).catch(() => undefined);
    try {
      if (mode === 'cancelled') {
        await expect.poll(() => providerOutboundBudgetStats()[0].queued).toBe(1); controller.abort();
      }
      await expect(pending).rejects.toThrow();
      expect(requests).toBe(0);
      expect(providerSpendSnapshot(scope())[0]).toMatchObject({ heldTokens: 0, unknownTokenCalls: 0, activeCalls: 0 });
      expect(openOpenClawStateDatabase().db.prepare('SELECT state FROM provider_spend_calls').all()).toMatchObject([{ state: 'cancelled' }]);
    } finally {
      held.slot.release(); controller.abort(); resetProviderOutboundBudget();
      server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  it.each([
    ['host', 'tokens'], ['project', 'tokens'], ['session', 'tokens'],
    ['host', 'cost'], ['project', 'cost'], ['session', 'cost'],
  ] as const)('prevents two real processes from double spending %s %s capacity', async (limiter, resource) => {
    // Initialize the shared owner schema before the two independent processes contend.
    openOpenClawStateDatabase();
    const budgetConfig = Object.fromEntries(['host', 'project', 'session'].map(name => [name,
      resource === 'tokens' ? { maxTokens: name === limiter ? 100 : 1000 } : { maxCostUsd: name === limiter ? 0.01 : 1 }]));
    const startOwner = (id: string) => {
      const child = spawn(process.execPath, ['--import', 'tsx', path.join(process.cwd(), 'tests/unit/fixtures/autonomy-provider-spend-worker.mts'),
        Buffer.from(JSON.stringify({ id, sessionKey: 'native-shared-session', config: budgetConfig })).toString('base64')], { cwd: path.join(process.cwd(), 'openclaw_runtime'),
        env: { ...process.env, OPENCLAW_STATE_DIR: root }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      const rows: Array<{ ready?: boolean; admitted?: boolean; error?: string }> = [];
      let output = '', stderr = '';
      child.stderr.on('data', chunk => { stderr += String(chunk); });
      const exited = new Promise<number | null>((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
      const ready = new Promise<void>((resolve, reject) => {
        child.stdout.on('data', chunk => { output += String(chunk); let index: number;
          while ((index = output.indexOf('\n')) >= 0) { rows.push(JSON.parse(output.slice(0, index))); output = output.slice(index + 1); if (rows[0]?.ready) resolve(); } });
        child.once('error', reject); child.once('exit', () => reject(new Error(stderr || 'owner exited before ready')));
      });
      return { child, rows, ready, exited };
    };
    const processes: Array<ReturnType<typeof startOwner>> = [];
    try {
      // Bootstrap serially to bound transformer memory; both owners are ready
      // and alive before the same reservation barrier is released.
      for (const id of ['native-a', 'native-b']) { const owner = startOwner(id); processes.push(owner); await owner.ready; }
      processes.forEach(process => process.child.stdin.end('reserve\n'));
      expect(await Promise.all(processes.map(process => process.exited))).toEqual([0, 0]);
      expect(processes.filter(process => process.rows[1]?.admitted)).toHaveLength(1);
      expect(processes.find(process => !process.rows[1]?.admitted)!.rows[1]?.error).toContain(`${resource} (${limiter})`);
      const db = openOpenClawStateDatabase();
      const saved = db.db.prepare('SELECT * FROM provider_spend_calls').all();
      expect(saved).toHaveLength(1);
      expect(db.db.prepare('SELECT * FROM provider_spend_allocations').all()).toHaveLength(3);
      const nativeScope = JSON.parse(String(saved[0]!.scope_json)) as Parameters<typeof providerSpendSnapshot>[0];
      const snapshot = providerSpendSnapshot(nativeScope);
      expect(snapshot).toHaveLength(3);
      expect(snapshot.every(row => row.heldTokens === 60 && row.heldCostMicros === 6000 && row.activeCalls === 1)).toBe(true);
      const dir = path.join(process.cwd(), 'artifacts/runs/autonomy-resource-admission', 'spend-native-' + path.basename(root));
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, 'owner.json'), JSON.stringify({ driven_by: 'agent', actor: 'codex-r1-spend-native',
        processes: processes.map(process => ({ pid: process.child.pid, rows: process.rows, exit: process.child.exitCode })),
        limiter, resource, budgetConfig, saved, snapshot, databasePath: db.path }, null, 2) + '\n');
    } finally { for (const p of processes) if (p.child.exitCode === null && p.child.signalCode === null) p.child.kill(); await Promise.allSettled(processes.map(p => p.exited)); }
  }, 60_000);
});
