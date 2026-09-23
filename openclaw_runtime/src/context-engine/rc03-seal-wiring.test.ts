import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ReceiptStore } from '../agents/receipt-store.js';
import {
  getShadowCensusDiagnostics,
  resetShadowCensusDiagnosticsForTest,
} from '../agents/shadow-census.js';
import { closeOpenClawStateDatabase } from '../state/openclaw-state-db.js';
import { resetSealRegistryForTests } from './seal-registry.js';
import { registerRc03SealProducers } from './rc03-producers.js';
import {
  finalizeContextOrchestratorTurn,
  resetContextOrchestratorLineageForTests,
} from './context-orchestrator.js';
import { beginContextCandidateCollection, collectContextCandidate, createContextCandidate } from './context-candidate.js';
import {
  appliedProducerIdsFromLineage,
  getRc03SealPlan,
  markRc03MessageReplacement,
  recordRc03SystemPromptContribution,
  resetRc03SealPlansForTest,
  resolveRc03SealState,
  runRc03SealHook,
} from './rc03-seal-hook.js';

const tempRoots: string[] = [];
let stateDir = '';

function newStore() {
  return new ReceiptStore({ env: process.env, path: path.join(stateDir, 'openclaw-state.db') });
}

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rc03-wiring-'));
  tempRoots.push(root);
  stateDir = path.join(root, 'state');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(path.join(root, 'home'), { recursive: true });
  process.env.OPENCLAW_HOME = path.join(root, 'home');
  process.env.OPENCLAW_STATE_DIR = stateDir;
  resetSealRegistryForTests();
  registerRc03SealProducers();
  resetContextOrchestratorLineageForTests();
  resetRc03SealPlansForTest();
  resetShadowCensusDiagnosticsForTest();
});

afterEach(() => {
  closeOpenClawStateDatabase();
  resetSealRegistryForTests();
  resetContextOrchestratorLineageForTests();
  resetRc03SealPlansForTest();
  delete process.env.OPENCLAW_RC03_SEAL;
  delete process.env.OPENCLAW_HOME;
  delete process.env.OPENCLAW_STATE_DIR;
  delete process.env.OPENCLAW_CONFIG_PATH;
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('RC-03 production wiring (seal hook at the pre-seal convergence point)', () => {
  it('is a no-op when the RC-03 flag is off (legacy path byte-identical)', () => {
    const result = runRc03SealHook(
      { messages: [], lineage: [], systemPromptAddition: undefined } as never,
      [],
      { enabled: false },
    );
    expect(result.engaged).toBe(false);
    expect(result.bundleSealed).toBe(false);
    expect(result.contextReceiptPersisted).toBe(false);
    const store = newStore();
    expect(store.list({ kind: 'context' })).toHaveLength(0);
  });

  it('runs through finalizeContextOrchestratorTurn and persists a ContextReceipt/v1 when enabled', () => {
    const turnId = 'turn-rc03-wiring';
    beginContextCandidateCollection(turnId);
    collectContextCandidate(
      turnId,
      createContextCandidate({
        authorityObjectId: 'block:knowledge:1',
        authorityVersion: '1',
        sourceId: 'dcs-knowledge',
        channel: 'knowledge',
        target: 'message',
        text: '## Knowledge\nfact',
      }),
    );
    const database = { env: process.env, path: path.join(stateDir, 'openclaw-state.db') };
    const result = finalizeContextOrchestratorTurn({
      turnId,
      messages: [],
      sessionKey: 'sess-rc03',
      runId: 'run-rc03',
      providerId: 'anthropic',
      rc03Seal: { enabled: true, database },
    });
    expect(result.messages).toHaveLength(1);
    // ContextReceipt persisted at the pre-seal convergence point.
    const store = newStore();
    const rows = store.list({ kind: 'context' });
    expect(rows).toHaveLength(1);
    expect(rows[0].provider_id).toBe('anthropic');
    expect(rows[0].session_key).toBe('sess-rc03');
    // R5-1: receipt run_id mirrors the runner-provided runId verbatim — this is
    // the hop that joins cron receipts to the canonical cron execution id.
    expect(rows[0].run_id).toBe('run-rc03');
    expect(rows[0].attempt_index).toBe(0);
    expect(rows[0].runtime_mode).toBe('source');
  });

  it('is killed (no seal, no receipt) when the enhancement kill switch is engaged', () => {
    const result = runRc03SealHook(
      { messages: [], lineage: [] } as never,
      [],
      { enabled: true, killed: true },
    );
    expect(result.engaged).toBe(false);
    expect(result.bundleSealed).toBe(false);
    const store = newStore();
    expect(store.list({ kind: 'context' })).toHaveLength(0);
  });

  it('enforces zero-bypass: all registered pre-seal producers are present', () => {
    const result = runRc03SealHook(
      { messages: [], lineage: [], systemPromptAddition: undefined } as never,
      [],
      { enabled: true, database: { env: process.env, path: path.join(stateDir, 'openclaw-state.db') } },
    );
    expect(result.engaged).toBe(true);
    expect(result.enforced).toBe(true);
    expect(result.unregisteredProducers).toEqual([]);
    expect(result.bundleSealed).toBe(true);
  });

  it('RC-03R: a normal agent turn seals from real source-runtime config without test parameters', () => {
    process.env.OPENCLAW_RC03_SEAL = '1';
    const turnId = 'turn-rc03-config';
    beginContextCandidateCollection(turnId);
    collectContextCandidate(
      turnId,
      createContextCandidate({
        authorityObjectId: 'block:knowledge:1',
        authorityVersion: '1',
        sourceId: 'dcs-knowledge',
        channel: 'knowledge',
        target: 'message',
        text: '## Knowledge\nfact',
      }),
    );
    const database = { env: process.env, path: path.join(stateDir, 'openclaw-state.db') };
    // No rc03Seal param: the switch resolves from the real config/env path.
    const result = finalizeContextOrchestratorTurn({
      turnId,
      messages: [],
      sessionKey: 'sess-rc03',
      runId: 'run-rc03',
      providerId: 'anthropic',
      cfg: { runtime: { rc03: { seal: false } } },
      rc03Seal: { database },
    });
    expect(result.messages).toHaveLength(1);
    const store = newStore();
    expect(store.list({ kind: 'context' })).toHaveLength(1);
    const rows = store.list({ kind: 'context' });
    expect(rows[0].provider_id).toBe('anthropic');
    expect(rows[0].adapter_id).toBe('dcs-context-engine');
    expect(rows[0].runtime_mode).toBe('source');
    // The sealed plan is recorded for the run so WireReceipt/v1 can correlate.
    expect(getRc03SealPlan('run-rc03')).toBeDefined();
  });

  it('RC-03R: the seal stays off when the config says off and no env override exists', () => {
    const result = finalizeContextOrchestratorTurn({
      turnId: 'turn-rc03-off',
      messages: [],
      cfg: { runtime: { rc03: { seal: false } } },
    });
    expect(result.messages).toEqual([]);
    expect(newStore().list({ kind: 'context' })).toHaveLength(0);
    expect(getRc03SealPlan('run-rc03-off')).toBeUndefined();
  });

  it('RC-03R: the enhancement kill switch restores the legacy path byte-for-byte', () => {
    process.env.OPENCLAW_RC03_SEAL = '1';
    const turnId = 'turn-rc03-killed';
    beginContextCandidateCollection(turnId);
    const before = JSON.stringify({ model: 'claude', messages: [{ role: 'user', content: 'x' }] });
    const result = finalizeContextOrchestratorTurn({
      turnId,
      messages: [{ role: 'user', content: 'x' } as never],
      runId: 'run-rc03-killed',
      cfg: { runtime: { contextEnhancement: { killSwitch: true } } },
      rc03Seal: { database: { env: process.env, path: path.join(stateDir, 'openclaw-state.db') } },
    });
    // Kill switch: no seal, no receipt, legacy messages unchanged.
    expect(result.messages).toEqual([{ role: 'user', content: 'x' }]);
    expect(JSON.stringify({ model: 'claude', messages: result.messages })).toBe(before);
    expect(newStore().list({ kind: 'context' })).toHaveLength(0);
    expect(getRc03SealPlan('run-rc03-killed')).toBeUndefined();
  });

  it('RC-03R: records real producer execution, not blanket applied', () => {
    const projection = {
      lineage: [
        {
          sourceId: 'dcs-knowledge',
          channel: 'knowledge',
          target: 'message',
          candidateId: 'cand-1',
          charsRequested: 10,
          charsApplied: 8,
        },
        {
          sourceId: 'working_memory',
          channel: 'working_memory',
          target: 'message',
          candidateId: 'cand-2',
          charsRequested: 5,
          charsApplied: 0,
        },
      ],
      systemPromptAddition: undefined,
    } as never;
    const applied = appliedProducerIdsFromLineage(projection);
    expect(applied).toContain('dcs-knowledge');
    expect(applied).not.toContain('dcs-working-memory');
    const result = runRc03SealHook(
      projection,
      [{ role: 'user', content: 'hi' }],
      {
        enabled: true,
        runId: 'run-producer-truth',
        database: { env: process.env, path: path.join(stateDir, 'openclaw-state.db') },
      },
    );
    expect(result.engaged).toBe(true);
    const plan = getRc03SealPlan('run-producer-truth');
    expect(plan).toBeDefined();
    const producer = plan?.preSealProducers.find((p) => p.producerId === 'dcs-knowledge');
    const skipped = plan?.preSealProducers.find((p) => p.producerId === 'dcs-working-memory');
    expect(producer?.applied).toBe(true);
    expect(skipped?.applied).toBe(false);
  });

  it('RC-03R/F-02: appliedProducerIdsFromLineage resolves real assembler source ids, not only shorthands', () => {
    const projection = {
      lineage: [
        // Real Assembler canonical ids: context-block:<source_system>:<block_type>.
        { sourceId: 'context-block:compass:knowledge', channel: 'knowledge', target: 'message', candidateId: 'cand-1', charsRequested: 10, charsApplied: 8 },
        { sourceId: 'context-block:working-memory:working_memory', channel: 'working_memory', target: 'message', candidateId: 'cand-2', charsRequested: 5, charsApplied: 4 },
        { sourceId: 'context-block:cvk:tool_registry', channel: 'tool_registry', target: 'message', candidateId: 'cand-3', charsRequested: 5, charsApplied: 5 },
        { sourceId: 'context-block:role-memory:knowledge', channel: 'knowledge', target: 'message', candidateId: 'cand-4', charsRequested: 3, charsApplied: 0 },
        // Context Orchestrator ids.
        { sourceId: 'vtoken-assembly', channel: 'vtoken', target: 'system_prompt', candidateId: 'cand-5', charsRequested: 7, charsApplied: 7 },
        { sourceId: 'memory-inject-pilot', channel: 'memory_pilot', target: 'system_prompt', candidateId: 'cand-6', charsRequested: 7, charsApplied: 7 },
        { sourceId: 'memory-inject-pilot:runtime-memory', channel: 'memory_pilot', target: 'system_prompt', candidateId: 'cand-7', charsRequested: 11, charsApplied: 11 },
      ],
      systemPromptAddition: undefined,
    } as never;
    const applied = appliedProducerIdsFromLineage(projection);
    expect(applied).toEqual(
      expect.arrayContaining([
        'dcs-knowledge',
        'dcs-working-memory',
        'dcs-tool-registry',
        'vtoken-packer',
        'memory-pilot-injection',
      ]),
    );
    expect(applied).not.toContain('role-memory-injection');
  });

  it('R3-1: runtime-memory provider id survives ContextReceipt selection refs', () => {
    const turnId = 'turn-runtime-memory-receipt';
    beginContextCandidateCollection(turnId);
    collectContextCandidate(
      turnId,
      createContextCandidate({
        authorityObjectId: 'memory-inject-pilot:runtime-memory',
        authorityVersion: 'v1',
        sourceId: 'memory-inject-pilot:runtime-memory',
        channel: 'memory_pilot',
        target: 'system_prompt',
        text: '## Memory Context\n\n### runtime-memory:fact\n\npersisted fact',
      }),
    );

    const database = { env: process.env, path: path.join(stateDir, 'openclaw-state.db') };
    const result = finalizeContextOrchestratorTurn({
      turnId,
      messages: [],
      sessionKey: 'agent:main:main',
      runId: 'run-runtime-memory-receipt',
      providerId: 'runtime-memory',
      cfg: { runtime: { rc03: { seal: true } } },
      rc03Seal: { database },
    });
    expect(result.projection.lineage).toEqual([
      expect.objectContaining({ sourceId: 'memory-inject-pilot:runtime-memory', charsApplied: expect.any(Number) }),
    ]);
    const row = newStore().list({ kind: 'context', runId: 'run-runtime-memory-receipt' })[0];
    expect(row).toBeDefined();
    expect(JSON.parse(row!.selected_json ?? '[]')).toEqual(
      expect.arrayContaining([expect.stringContaining('runtime-memory')]),
    );
    expect(getRc03SealPlan('run-runtime-memory-receipt')?.preSealProducers).toEqual(
      expect.arrayContaining([expect.objectContaining({ producerId: 'memory-pilot-injection', applied: true })]),
    );
  });

  it('RC-03R/F-02: the persisted ContextReceipt budget is the real char summary, not silently omitted', () => {
    const projection = {
      lineage: [
        { sourceId: 'context-block:compass:knowledge', channel: 'knowledge', target: 'message', candidateId: 'cand-1', charsRequested: 20, charsApplied: 18 },
        { sourceId: 'context-block:working-memory:working_memory', channel: 'working_memory', target: 'message', candidateId: 'cand-2', charsRequested: 12, charsApplied: 10 },
      ],
      systemPromptAddition: undefined,
    } as never;
    const result = runRc03SealHook(
      projection,
      [{ role: 'user', content: 'hi' }],
      {
        enabled: true,
        runId: 'run-chars-budget',
        sessionKey: 'sess-chars-budget',
        database: { env: process.env, path: path.join(stateDir, 'openclaw-state.db') },
      },
    );
    expect(result.engaged).toBe(true);
    const store = newStore();
    const rows = store.list({ kind: 'context', runId: 'run-chars-budget' });
    expect(rows).toHaveLength(1);
    const budget = JSON.parse(rows[0].budget_json ?? '{}') as {
      unit: string;
      charsRequested: number;
      charsApplied: number;
    };
    expect(budget).toEqual({ unit: 'chars', charsRequested: 32, charsApplied: 28 });
    // The same typed budget round-trips through the store's canonical JSON.
    expect(store.list({ kind: 'context', runId: 'run-chars-budget' })[0].budget_json).toBe(
      '{"unit":"chars","charsRequested":32,"charsApplied":28}',
    );
  });

  it('RC-03R: receipt write failure lands in the census diagnostics and fails acceptance', () => {
    process.env.OPENCLAW_RC03_SEAL = '1';
    const blocker = path.join(stateDir, 'blocker.txt');
    fs.writeFileSync(blocker, 'not a directory');
    const broken = { env: process.env, path: path.join(blocker, 'openclaw-state.db') };
    const result = runRc03SealHook(
      { messages: [], lineage: [], systemPromptAddition: undefined } as never,
      [],
      { enabled: true, runId: 'run-failed-write', database: broken },
    );
    expect(result.engaged).toBe(true);
    expect(result.contextReceiptPersisted).toBe(false);
    const diagnostics = getShadowCensusDiagnostics();
    expect(diagnostics.acceptanceReady).toBe(false);
    expect(
      diagnostics.failures.some(
        (f) => f.phase === 'context-write' && f.code === 'receipt-store-write-failed',
      ),
    ).toBe(true);
  });

  it('RC-03R: resolveRc03SealState honors env, config, and the kill switch', () => {
    expect(resolveRc03SealState({})).toEqual({ enabled: false, killed: false });
    expect(resolveRc03SealState({ runtime: { rc03: { seal: true } } })).toEqual({
      enabled: true,
      killed: false,
    });
    expect(resolveRc03SealState({ runtime: { contextEnhancement: { killSwitch: true } } })).toEqual({
      enabled: false,
      killed: true,
    });
  });

  it('RC-03R: guarded wire boundary persists WireReceipt/v1 bound to the sealed plan and final body digest', async () => {
    // Build a sealed plan the same way the production hook does, then drive the
    // guarded fetch boundary (the same shared fetch every source provider uses)
    // and assert a WireReceipt/v1 row with the final serialized body digest and
    // the registered post-seal transform ids.
    const projection = {
      lineage: [
        {
          sourceId: 'dcs-knowledge',
          channel: 'knowledge',
          target: 'message',
          candidateId: 'cand-1',
          charsRequested: 10,
          charsApplied: 8,
        },
      ],
      systemPromptAddition: undefined,
    } as never;
    const seal = runRc03SealHook(
      projection,
      [{ role: 'user', content: 'hi' }],
      {
        enabled: true,
        runId: 'run-wire-v1',
        sessionKey: 'sess-wire-v1',
        providerId: 'anthropic',
        database: { env: process.env, path: path.join(stateDir, 'openclaw-state.db') },
      },
    );
    expect(seal.engaged).toBe(true);
    const plan = getRc03SealPlan('run-wire-v1');
    expect(plan).toBeDefined();

    const { attachShadowReceiptOptions, getShadowReceiptOptions } = await import('../agents/shadow-census.js');
    const { buildGuardedModelFetch } = await import('../agents/provider-transport-fetch.js');
    const { resolveEmbeddedAgentStreamFn } = await import('../agents/embedded-agent-runner/stream-resolution.js');
    const requestBodies: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? new Request(input, init) : new Request(input, init);
      requestBodies.push(await request.clone().text());
      return new Response(
        'event: message_start\ndata: {"type":"message_start","message":{"id":"m1","role":"assistant","content":[],"usage":{"input_tokens":1}}}\n\nevent: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n',
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      );
    }) as typeof fetch;
    try {
      // R5-3: drive the real production path — the embedded stream wrapper
      // resolves the sealed plan from the registry and overwrites the wire
      // correlation with the ContextReceipt's digest. The only mocks are the
      // model boundary (inner stream records the options it receives) and the
      // network; correlationDigest/logicalDigest/rc03Plan are never injected.
      const model = {
        provider: 'anthropic',
        api: 'anthropic-messages',
        id: 'claude-wire-v1',
        name: 'claude-wire-v1',
        baseUrl: 'http://127.0.0.1:40123/v1',
        reasoning: false,
        input: ['text'],
        maxTokens: 4096,
        contextWindow: 200000,
        cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
      } as never;
      let capturedOptions: unknown;
      const wrapped = resolveEmbeddedAgentStreamFn({
        currentStreamFn: ((_m: never, _c: never, o?: never) => {
          capturedOptions = o;
          return {};
        }) as never,
        sessionId: 'sess-wire-v1',
        runId: 'run-wire-v1',
        attemptIndex: 0,
        model: model as never,
      });
      const streamOptions = attachShadowReceiptOptions({ apiKey: 'fixture-key' }, {
        enabled: true,
        sourceRuntime: true,
        database: { env: process.env, path: path.join(stateDir, 'openclaw-state.db') },
        runId: 'run-wire-v1',
        sessionKey: 'sess-wire-v1',
        providerId: 'anthropic',
        adapterId: 'anthropic-messages',
        attemptIndex: 0,
        modelCallIndex: 0,
      });
      await wrapped(model as never, {
        systemPrompt: '',
        messages: [{ role: 'user', content: 'hi' }],
      } as never, streamOptions as never);
      const shadow = getShadowReceiptOptions(capturedOptions);
      expect(shadow).toBeDefined();
      expect(shadow!.rc03Plan).toBeDefined();
      // Production stream-resolution overwrote the correlation with the
      // ContextReceipt's bundle digest (no manual injection above).
      const contextCorrelation = newStore().list({ kind: 'context', runId: 'run-wire-v1', modelCallIndex: 0 })
        .filter((row) => row.version === '1')[0]?.correlation_digest;
      expect(contextCorrelation).toBeDefined();
      expect(shadow!.correlationDigest).toBe(contextCorrelation);

      const fetch = buildGuardedModelFetch(model, 5000, undefined, shadow);
      const response = await fetch('http://127.0.0.1:40123/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'claude-wire-v1', messages: [{ role: 'user', content: 'hi' }] }),
      });
      expect(response.status).toBe(200);
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(requestBodies).toHaveLength(1);
    const store = newStore();
    const wireRows = store.list({ kind: 'wire' });
    expect(wireRows).toHaveLength(1);
    const wire = wireRows[0];
    expect(wire.version).toBe('1');
    expect(wire.provider_id).toBe('anthropic');
    expect(wire.adapter_id).toBe('anthropic-messages');
    expect(wire.runtime_mode).toBe('source');
    expect(wire.wire_digest).toMatch(/^[a-f0-9]{64}$/);
    // The persisted digest equals a re-computation over the exact sent bytes.
    const { wireBodyDigest } = await import('../agents/shadow-census.js');
    expect(wire.wire_digest).toBe(wireBodyDigest(requestBodies[0]));
    // Registered non-semantic transport transforms ride on the wire identity.
    expect(wire.transform_ids_json).toContain('transport-wire-serialization');
    // R5-3: production correlation equals the ContextReceipt's bundle digest —
    // the pair joins through the receipt store without manual digests.
    const contextRows = store.list({ kind: 'context', runId: 'run-wire-v1', modelCallIndex: 0 })
      .filter((row) => row.version === '1');
    expect(contextRows).toHaveLength(1);
    expect(wire.correlation_digest).toBe(contextRows[0].correlation_digest);
    const pairs = store.joinByCorrelation({ runId: 'run-wire-v1' });
    expect(pairs).toHaveLength(1);
    expect(pairs[0].context.receipt_id).toBe(contextRows[0].receipt_id);
    expect(pairs[0].wire.receipt_id).toBe(wire.receipt_id);
  });

  it('RC-03R: a system prompt changed after the seal is an unknown semantic mutation in the census', async () => {
    const { attachShadowReceiptOptions } = await import('../agents/shadow-census.js');
    const { resolveEmbeddedAgentStreamFn } = await import('../agents/embedded-agent-runner/stream-resolution.js');
    const model = {
      provider: 'anthropic',
      api: 'anthropic-messages',
      id: 'claude-mutation',
      name: 'claude-mutation',
      baseUrl: 'http://127.0.0.1:40123/v1',
      reasoning: false,
      input: ['text'],
      maxTokens: 4096,
      contextWindow: 200000,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    } as never;
    const drive = async (runId: string, sealed: string, sent: string) => {
      runRc03SealHook(
        { lineage: [], systemPromptAddition: undefined } as never,
        [{ role: 'user', content: 'hi' }],
        {
          enabled: true,
          runId,
          providerId: 'anthropic',
          systemPrompt: sealed,
          database: { env: process.env, path: path.join(stateDir, 'openclaw-state.db') },
        },
      );
      const wrapped = resolveEmbeddedAgentStreamFn({
        currentStreamFn: (() => ({})) as never,
        sessionId: 'sess-mutation',
        runId,
        attemptIndex: 0,
        model,
      });
      await wrapped(
        model,
        { systemPrompt: sent, messages: [{ role: 'user', content: 'hi' }] } as never,
        attachShadowReceiptOptions({ apiKey: 'fixture-key' }, {
          enabled: true,
          sourceRuntime: true,
          database: { env: process.env, path: path.join(stateDir, 'openclaw-state.db') },
          runId,
          providerId: 'anthropic',
          adapterId: 'anthropic-messages',
          attemptIndex: 0,
          modelCallIndex: 0,
        }) as never,
      );
      return getShadowCensusDiagnostics().failures.filter(
        (failure) => failure.code === 'post-seal-semantic-mutation',
      );
    };
    expect(await drive('run-unchanged', 'base prompt', 'base prompt')).toEqual([]);
    const mutated = await drive('run-mutated', 'base prompt', 'base prompt\n\ninjected after seal');
    expect(mutated).toEqual([
      { phase: 'context-write', code: 'post-seal-semantic-mutation', count: 1 },
    ]);
  });

  it('RC-03R: ContextEngine message replacement is applied only on the attempt that replaced', () => {
    const database = { env: process.env, path: path.join(stateDir, 'openclaw-state.db') };
    const seal = (runId: string, attemptIndex: number) =>
      runRc03SealHook({ lineage: [], systemPromptAddition: undefined } as never, [], {
        enabled: true,
        runId,
        attemptIndex,
        database,
      }).plan?.preSealProducers.find((p) => p.producerId === 'cvk-message-replacement')?.applied;
    markRc03MessageReplacement('run-cvk', 0, undefined, {});
    expect(seal('run-cvk', 0), 'marked while the seal is off').toBe(false);
    markRc03MessageReplacement('run-cvk', 0, undefined, { OPENCLAW_RC03_SEAL: '1' });
    expect(seal('run-cvk', 0)).toBe(true);
    expect(seal('run-cvk', 1), 'a later attempt did not replace messages').toBe(false);
  });

  it('RC-03R: system-prompt contributions are attributed only while the seal is on', () => {
    const database = { env: process.env, path: path.join(stateDir, 'openclaw-state.db') };
    recordRc03SystemPromptContribution('role-spawn-memory-pack', 'pack text rc03', undefined, {});
    const off = runRc03SealHook({ lineage: [], systemPromptAddition: undefined } as never, [], {
      enabled: true,
      runId: 'run-attr-off',
      systemPrompt: 'soul\n## Memory Context\npack text rc03',
      database,
    });
    expect(off.plan?.preSealProducers.find((p) => p.producerId === 'role-spawn-memory-pack')?.applied).toBe(false);
    recordRc03SystemPromptContribution('role-spawn-memory-pack', 'pack text rc03', undefined, {
      OPENCLAW_RC03_SEAL: '1',
    });
    const on = runRc03SealHook({ lineage: [], systemPromptAddition: undefined } as never, [], {
      enabled: true,
      runId: 'run-attr-on',
      systemPrompt: 'soul\n## Memory Context\npack text rc03',
      database,
    });
    const applied = on.plan?.preSealProducers.filter((p) => p.applied).map((p) => p.producerId);
    expect(applied).toEqual(['role-spawn-memory-pack', 'embedded-system-prompt']);
    const receipt = newStore()
      .list({ kind: 'context', runId: 'run-attr-on' })
      .filter((row) => row.version === '1')[0];
    expect(JSON.parse(receipt!.selected_json ?? '[]')).toEqual([
      'ref:context:producer:role-spawn-memory-pack',
    ]);
  });
});
