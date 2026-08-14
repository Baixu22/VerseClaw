import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ReceiptStore } from '../agents/receipt-store.js';
import { closeOpenClawStateDatabase } from '../state/openclaw-state-db.js';
import {
  assertSealProducersRegistered,
  getRegisteredSealProducers,
  registerSealProducer,
  resetSealRegistryForTests,
} from './seal-registry.js';
import {
  createCompilePlan,
  nextAttempt,
  nextModelCall,
  nextPlanRevision,
} from './compile-plan.js';
import {
  createContextBundle,
  projectCandidateRefs,
  sealContextBundle,
} from './context-bundle.js';
import { buildContextReceiptInput, buildWireReceiptInput } from './dcs-receipts.js';
import {
  rc03PostSealTransformIds,
  rc03PreSealProducerIds,
  registerRc03SealProducers,
} from './rc03-producers.js';

const tempRoots: string[] = [];
let stateDir = '';

function newStore() {
  return new ReceiptStore({ env: process.env, path: path.join(stateDir, 'openclaw-state.db') });
}

function makePlan(overrides = {}) {
  return createCompilePlan({
    sessionKey: 'sess-rc03',
    runId: 'run-rc03',
    providerId: 'anthropic',
    policyDigest: '31135fc7f09768c027e26028eff8028f22cb91ab8a0cc3bbce32d003296f6908',
    callIndex: { attemptIndex: 0, planRevision: 0, modelCallIndex: 0, wireAttemptIndex: 0 },
    ...overrides,
  });
}

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rc03-seal-'));
  tempRoots.push(root);
  stateDir = path.join(root, 'state');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(path.join(root, 'home'), { recursive: true });
  process.env.OPENCLAW_HOME = path.join(root, 'home');
  process.env.OPENCLAW_STATE_DIR = stateDir;
  resetSealRegistryForTests();
  registerRc03SealProducers();
});

afterEach(() => {
  closeOpenClawStateDatabase();
  resetSealRegistryForTests();
  delete process.env.OPENCLAW_HOME;
  delete process.env.OPENCLAW_STATE_DIR;
  delete process.env.OPENCLAW_CONFIG_PATH;
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('RC-03 CompilePlan', () => {
  it('creates one stable plan per attempt with explicit attempt/model-call/wire-attempt identity', () => {
    const plan = makePlan();
    expect(plan.schema).toBe('CompilePlan/v1');
    expect(plan.callIndex).toEqual({ attemptIndex: 0, planRevision: 0, modelCallIndex: 0, wireAttemptIndex: 0 });
    expect(plan.planDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it('increments planRevision on a policy-only change within the same attempt', () => {
    const plan = makePlan();
    const revised = nextPlanRevision(plan);
    expect(revised.callIndex).toEqual({ attemptIndex: 0, planRevision: 1, modelCallIndex: 0, wireAttemptIndex: 0 });
    expect(revised.planId).not.toBe(plan.planId);
  });

  it('increments modelCallIndex on the next model call inside the same attempt', () => {
    const plan = makePlan();
    const next = nextModelCall(plan);
    expect(next.callIndex).toEqual({ attemptIndex: 0, planRevision: 0, modelCallIndex: 1, wireAttemptIndex: 0 });
  });

  it('resets attempt-scoped indexes on provider fallback (new attempt)', () => {
    const plan = nextModelCall(nextPlanRevision(makePlan()));
    expect(plan.callIndex).toEqual({ attemptIndex: 0, planRevision: 1, modelCallIndex: 1, wireAttemptIndex: 0 });
    const fallback = nextAttempt(plan, { providerId: 'openai' });
    expect(fallback.callIndex).toEqual({ attemptIndex: 1, planRevision: 0, modelCallIndex: 0, wireAttemptIndex: 0 });
    expect(fallback.providerId).toBe('openai');
  });
});

describe('RC-03 seal registry', () => {
  it('registers every RC-03 pre-seal producer and post-seal transform', () => {
    const producers = getRegisteredSealProducers();
    const ids = producers.map((p) => p.id);
    for (const id of rc03PreSealProducerIds()) expect(ids).toContain(id);
    for (const id of rc03PostSealTransformIds()) expect(ids).toContain(id);
  });

  it('rejects a semantic producer that mutates transport and a non-semantic producer that mutates messages', () => {
    expect(() =>
      registerSealProducer({ id: 'bad-1', mutates: 'transport', kind: 'semantic', purpose: 'x', version: '1' }),
    ).toThrow(/semantic seal producer cannot mutate transport/);
    expect(() =>
      registerSealProducer({ id: 'bad-2', mutates: 'messages', kind: 'non-semantic', purpose: 'x', version: '1' }),
    ).toThrow(/non-semantic seal producer must mutate only transport/);
  });

  it('assertSealProducersRegistered reports unregistered ids (unknown semantic mutation = 0 enforced)', () => {
    const unregistered = assertSealProducersRegistered(['compass-ssp', 'some-bypass']);
    expect(unregistered).toEqual(['some-bypass']);
    expect(assertSealProducersRegistered(['compass-ssp', 'dcs-knowledge'])).toEqual([]);
  });

  it('keeps post-seal transforms to non-semantic transport only', () => {
    const ids = rc03PostSealTransformIds();
    for (const id of ids) {
      const registration = getRegisteredSealProducers().find((p) => p.id === id);
      expect(registration?.kind).toBe('non-semantic');
      expect(registration?.mutates).toBe('transport');
    }
  });
});

describe('RC-03 ContextBundle', () => {
  it('creates an immutable, sealed bundle with a stable content digest', () => {
    const plan = makePlan();
    const bundle = createContextBundle({
      plan,
      systemPrompt: 'system',
      messages: [{ role: 'user', content: 'hi' }],
      appliedProducerIds: ['compass-ssp'],
      selectedRefs: ['ref:1'],
      omittedRefs: ['ref:2'],
    });
    expect(bundle.schema).toBe('ContextBundle/v1');
    expect(bundle.sealed).toBe(false);
    expect(bundle.bundleDigest).toMatch(/^[a-f0-9]{64}$/);

    const sealed = sealContextBundle(bundle);
    expect(sealed.sealed).toBe(true);
    // The digest changes only because the sealed flag flips once.
    expect(sealContextBundle(sealed).bundleDigest).toBe(sealed.bundleDigest);
    // Messages are frozen.
    expect(Object.isFrozen(sealed.messages)).toBe(true);
  });

  it('projects candidate refs into selected/omitted', () => {
    const candidates = [
      { candidateId: 'ref:applied', text: 'a' },
      { candidateId: 'ref:dropped', text: 'b' },
    ];
    const { selectedRefs, omittedRefs } = projectCandidateRefs(candidates as never, (c) => c.candidateId === 'ref:applied');
    expect(selectedRefs).toEqual(['ref:applied']);
    expect(omittedRefs).toEqual(['ref:dropped']);
  });
});

describe('RC-03 receipts through ReceiptStore', () => {
  it('persists a correlated ContextReceipt/v1 and WireReceipt/v1', () => {
    const plan = makePlan();
    const bundle = sealContextBundle(createContextBundle({
      plan,
      systemPrompt: 'system',
      messages: [{ role: 'user', content: 'hi' }],
      appliedProducerIds: ['compass-ssp'],
      selectedRefs: ['ref:context:applied'],
      omittedRefs: ['ref:context:dropped'],
    }));
    const identity = { runtimeMode: 'source' as const, providerId: 'anthropic', adapterId: 'anthropic-messages', sessionKey: 'sess-rc03', runId: 'run-rc03' };
    const correlationDigest = 'a55b6948bdb31a5bf58e0d286fc1cff987c310e7f5ef2e7a6580d4f5b1ea7676';

    const store = newStore();
    const ctxInput = buildContextReceiptInput({ plan, bundle, identity, correlationDigest });
    expect(ctxInput.kind).toBe('context');
    expect(ctxInput.version).toBe('1');
    const ctxResult = store.put(ctxInput);
    expect(ctxResult.ok).toBe(true);

    const wireInput = buildWireReceiptInput({
      plan,
      wireDigest: '9cb06a8c1329ecefbc08037434974e36277e14db2444175858bc062d5c850496',
      logicalDigest: bundle.bundleDigest,
      identity,
      correlationDigest,
      transformIds: ['transport-wire-serialization'],
    });
    expect(wireInput.kind).toBe('wire');
    const wireResult = store.put(wireInput);
    expect(wireResult.ok).toBe(true);

    const contextRows = store.list({ kind: 'context' });
    const wireRows = store.list({ kind: 'wire' });
    expect(contextRows).toHaveLength(1);
    expect(wireRows).toHaveLength(1);
    expect(contextRows[0].correlation_digest).toBe(correlationDigest);
    expect(wireRows[0].correlation_digest).toBe(correlationDigest);
    expect(wireRows[0].wire_digest).toBe('9cb06a8c1329ecefbc08037434974e36277e14db2444175858bc062d5c850496');
    // Post-seal transform ids recorded on the wire receipt.
    expect(wireRows[0].transform_ids_json).toContain('transport-wire-serialization');
    // The receipt stores canonical refs, never raw content.
    expect(contextRows[0].selected_json).toContain('ref:context:applied');
    expect(JSON.stringify(contextRows[0])).not.toContain('hi');
  });

  it('remains idempotent for identical correlated receipts (content-sensitive)', () => {
    const plan = makePlan();
    const bundle = sealContextBundle(createContextBundle({ plan, systemPrompt: 's', messages: [] }));
    const identity = { runtimeMode: 'source' as const, providerId: 'anthropic', adapterId: 'anthropic-messages' };
    const store = newStore();
    const first = store.put(buildContextReceiptInput({ plan, bundle, identity, correlationDigest: '84bae4db933bb6e48e3de43849eab73c13689d2a657963e0da364e0a62361e25' }));
    const second = store.put(buildContextReceiptInput({ plan, bundle, identity, correlationDigest: '84bae4db933bb6e48e3de43849eab73c13689d2a657963e0da364e0a62361e25' }));
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.duplicate).toBe(true);
      if (second.duplicate) {
        expect(second.reason).toBe('identical-content');
      }
    }
    expect(store.list({ kind: 'context' })).toHaveLength(1);
  });

  it('supports tool-loop and compact correlation through distinct plans', () => {
    const identity = { runtimeMode: 'source' as const, providerId: 'anthropic', adapterId: 'anthropic-messages' };
    const store = newStore();
    // Model call 0 and 1 in the same attempt (tool loop).
    const plan0 = makePlan();
    const plan1 = nextModelCall(plan0);
    const bundle0 = sealContextBundle(createContextBundle({ plan: plan0, systemPrompt: 's0', messages: [] }));
    const bundle1 = sealContextBundle(createContextBundle({ plan: plan1, systemPrompt: 's1', messages: [] }));
    expect(store.put(buildContextReceiptInput({ plan: plan0, bundle: bundle0, identity, correlationDigest: '35258d769af52ac6cfdfcb50acc4422b83b25a50cd48a491576653015f3a0ba6' })).ok).toBe(true);
    expect(store.put(buildContextReceiptInput({ plan: plan1, bundle: bundle1, identity, correlationDigest: '12423b976fe4078b3c8b6b4c279cd86ed6bb9835c9ea9c294049acefbc5171a5' })).ok).toBe(true);
    // Compact is a new attempt.
    const compactPlan = nextAttempt(plan1, { providerId: 'anthropic' });
    const compactBundle = sealContextBundle(createContextBundle({ plan: compactPlan, systemPrompt: 's2', messages: [] }));
    expect(store.put(buildContextReceiptInput({ plan: compactPlan, bundle: compactBundle, identity, correlationDigest: '7f4e1a13f6e91c1a28310506df9a6ccba47c3ab386183ec0db6c740fece5f4f4' })).ok).toBe(true);

    const rows = store.list({ kind: 'context' });
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.attempt_index).sort()).toEqual([0, 0, 1]);
  });

  it('R5-3: joinByCorrelation pairs v1 context+wire receipts sharing one correlation digest', () => {
    const plan = makePlan();
    const bundle = sealContextBundle(createContextBundle({ plan, systemPrompt: 's', messages: [{ role: 'user', content: 'hi' }] }));
    const identity = { runtimeMode: 'source' as const, providerId: 'anthropic', adapterId: 'anthropic-messages', sessionKey: 'sess-rc03', runId: 'run-rc03' };
    const correlation = 'ab'.repeat(32);
    const store = newStore();
    expect(store.put(buildContextReceiptInput({ plan, bundle, identity, correlationDigest: correlation })).ok).toBe(true);
    expect(store.put(buildWireReceiptInput({
      plan,
      wireDigest: '9cb06a8c1329ecefbc08037434974e36277e14db2444175858bc062d5c850496',
      logicalDigest: bundle.bundleDigest,
      identity,
      correlationDigest: correlation,
      transformIds: ['transport-wire-serialization'],
    })).ok).toBe(true);

    // 同 correlation 的 context+wire 配对成功。
    const pairs = store.joinByCorrelation({ runId: 'run-rc03' });
    expect(pairs).toHaveLength(1);
    expect(pairs[0].correlationDigest).toBe(correlation);
    expect(pairs[0].context.kind).toBe('context');
    expect(pairs[0].wire.kind).toBe('wire');
    expect(pairs[0].wire.wire_digest).toBe('9cb06a8c1329ecefbc08037434974e36277e14db2444175858bc062d5c850496');

    // list() 的 correlationDigest/modelCallIndex 过滤。
    expect(store.list({ kind: 'wire', correlationDigest: correlation, modelCallIndex: 0 })).toHaveLength(1);
    expect(store.list({ kind: 'wire', correlationDigest: correlation, modelCallIndex: 1 })).toHaveLength(0);
    expect(store.list({ kind: 'context', correlationDigest: 'a'.repeat(64) })).toHaveLength(0);

    // 只有单侧收据(缺 wire)不产生配对。
    const orphanPlan = nextModelCall(plan);
    const orphanBundle = sealContextBundle(createContextBundle({ plan: orphanPlan, systemPrompt: 's2', messages: [] }));
    expect(store.put(buildContextReceiptInput({ plan: orphanPlan, bundle: orphanBundle, identity, correlationDigest: 'b'.repeat(64) })).ok).toBe(true);
    expect(store.joinByCorrelation({ runId: 'run-rc03', correlationDigest: 'b'.repeat(64) })).toHaveLength(0);
  });
});
