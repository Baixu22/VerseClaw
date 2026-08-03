import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ReceiptStore,
  receiptContentDigest,
  type PutReceiptInput,
} from './receipt-store.js';
import { closeOpenClawStateDatabase } from '../state/openclaw-state-db.js';

const tempRoots: string[] = [];
let stateDir = '';

function makeIdentity(overrides: Partial<PutReceiptInput['identity']> = {}) {
  return {
    runtimeMode: 'source' as const,
    providerId: 'anthropic',
    ...overrides,
  };
}

function makeCallIndex(overrides: Partial<PutReceiptInput['callIndex']> = {}) {
  return { attemptIndex: 0, modelCallIndex: 0, wireAttemptIndex: 0, ...overrides };
}

let receiptCounter = 0;

function makeReceipt(overrides: Partial<PutReceiptInput> = {}): PutReceiptInput {
  receiptCounter += 1;
  const base = {
    idempotencyKey: `rc02-${receiptCounter}`,
    kind: 'shadow_context' as const,
    version: '0',
    identity: makeIdentity(),
    callIndex: makeCallIndex(),
    content: {
      correlationDigest: `corr-${receiptCounter}`,
      logicalDigest: `logical-${receiptCounter}`,
    },
  };
  const merged = { ...base, ...overrides };
  return {
    ...merged,
    content: { ...base.content, ...overrides.content },
  };
}

function newStore() {
  return new ReceiptStore({ env: process.env, path: path.join(stateDir, 'openclaw-state.db') });
}

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rc02-receipt-store-'));
  tempRoots.push(root);
  stateDir = path.join(root, 'state');
  fs.mkdirSync(stateDir, { recursive: true });
  process.env.OPENCLAW_HOME = path.join(root, 'home');
  process.env.OPENCLAW_STATE_DIR = stateDir;
  fs.mkdirSync(path.join(root, 'home'), { recursive: true });
});

afterEach(() => {
  closeOpenClawStateDatabase();
  delete process.env.OPENCLAW_HOME;
  delete process.env.OPENCLAW_STATE_DIR;
  delete process.env.OPENCLAW_CONFIG_PATH;
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('ReceiptStore (runtime_receipts via openclaw-state SQLite)', () => {
  it('appends a shadow receipt and reads it back by idempotency key', () => {
    const store = newStore();
    const input = makeReceipt({ kind: 'shadow_context' });
    const result = store.put(input);
    expect(result.ok).toBe(true);
    expect(result.duplicate).toBe(false);
    expect(result.inserted).toBe(true);
    expect(result.receiptId).toMatch(/^rcpt_/);

    const row = store.getByIdempotencyKey(input.idempotencyKey);
    expect(row).toBeDefined();
    expect(row!.kind).toBe('shadow_context');
    expect(row!.runtime_mode).toBe('source');
    expect(row!.provider_id).toBe('anthropic');
    expect(row!.attempt_index).toBe(0);
    expect(row!.model_call_index).toBe(0);
    expect(row!.wire_attempt_index).toBe(0);
    expect(row!.logical_digest).toBe('logical-1');
    expect(row!.content_digest).toBe(receiptContentDigest(input.identity, input.callIndex, input.content));
  });

  it('is idempotent when the same idempotency key has identical content', () => {
    const store = newStore();
    const input = makeReceipt({ idempotencyKey: 'same-key', kind: 'shadow_wire' });
    const first = store.put(input);
    expect(first.ok).toBe(true);
    expect(first.inserted).toBe(true);
    const second = store.put(input);
    expect(second.ok).toBe(true);
    expect(second.duplicate).toBe(true);
    expect(second.inserted).toBe(false);
    expect(second.reason).toBe('identical-content');
    // Only one row exists.
    expect(store.list({ kind: 'shadow_wire' })).toHaveLength(1);
  });

  it('conflict-fails when the same idempotency key has different content (hard constraint 2)', () => {
    const store = newStore();
    const input = makeReceipt({ idempotencyKey: 'conflict-key', kind: 'shadow_wire' });
    expect(store.put(input).ok).toBe(true);
    const conflicting = makeReceipt({
      idempotencyKey: 'conflict-key',
      kind: 'shadow_wire',
      content: { correlationDigest: 'corr-1', wireDigest: 'different-wire-digest' },
    });
    const result = store.put(conflicting);
    expect(result.ok).toBe(false);
    expect(result.duplicate).toBe(true);
    expect(result.reason).toBe('content-conflict');
    expect(result.existing).toBe(receiptContentDigest(input.identity, input.callIndex, input.content));
    // The conflicting content was NOT written.
    expect(store.list({ kind: 'shadow_wire' })).toHaveLength(1);
  });

  it('uses explicit attempt/model-call/wire-attempt identity, not max(sequence)+1 (hard constraint 3)', () => {
    const store = newStore();
    const storeInputs: PutReceiptInput[] = [];
    for (const [attemptIndex, modelCallIndex, wireAttemptIndex] of [
      [0, 0, 0],
      [0, 1, 0],
      [1, 0, 0],
      [1, 0, 1],
    ] as const) {
      const input = makeReceipt({
        kind: 'shadow_wire',
        callIndex: makeCallIndex({ attemptIndex, modelCallIndex, wireAttemptIndex }),
      });
      expect(store.put(input).ok).toBe(true);
      storeInputs.push(input);
    }
    const rows = store.list({ kind: 'shadow_wire' });
    expect(rows).toHaveLength(4);
    const indexes = rows.map((row) => [row.attempt_index, row.model_call_index, row.wire_attempt_index]);
    for (const [a, m, w] of indexes) {
      expect(storeInputs.some((i) => i.callIndex.attemptIndex === a && i.callIndex.modelCallIndex === m && i.callIndex.wireAttemptIndex === w)).toBe(true);
    }
    // Each row carries its explicit identity; there is no sequence column.
    for (const row of rows) {
      expect(row.attempt_index).toBeGreaterThanOrEqual(0);
      expect(row.model_call_index).toBeGreaterThanOrEqual(0);
      expect(row.wire_attempt_index).toBeGreaterThanOrEqual(0);
    }
  });

  it('refuses unbounded deletion and deletes only under an explicit lifecycle policy (hard constraint 4)', () => {
    const store = newStore();
    const old = makeReceipt({ kind: 'shadow_context', createdAt: Date.now() - 60_000 });
    const fresh = makeReceipt({ kind: 'shadow_context', createdAt: Date.now() });
    expect(store.put(old).ok).toBe(true);
    expect(store.put(fresh).ok).toBe(true);

    expect(() => store.deleteByPolicy({ kinds: [], maxAgeMs: 1_000 })).toThrow(/at least one receipt kind/);
    expect(() => store.deleteByPolicy({ kinds: ['shadow_context'], maxAgeMs: 0 })).toThrow(/positive maxAgeMs/);

    const result = store.deleteByPolicy({ kinds: ['shadow_context'], maxAgeMs: 30_000, now: Date.now() });
    expect(result.deleted).toBe(1);
    // The fresh receipt survives; only the old one was pruned under policy.
    expect(store.list({ kind: 'shadow_context' })).toHaveLength(1);
  });

  it('records only digests/refs/indexes, never raw prompt or tool output (hard constraint 1)', () => {
    const store = newStore();
    const input = makeReceipt({
      idempotencyKey: 'no-raw',
      kind: 'shadow_wire',
      content: {
        correlationDigest: 'corr-no-raw',
        wireDigest: 'wire-digest',
        selected: ['ref:file:src/a.ts:1'],
        omitted: ['ref:memory:card-abc123'],
        budget: '{"input":8000,"output":2000}',
        policyDigest: 'policy-1',
      },
    });
    expect(store.put(input).ok).toBe(true);
    const row = store.getByIdempotencyKey('no-raw')!;
    const rowText = JSON.stringify(row);
    // Refs may name a card id, but the raw prompt / tool output / credential
    // content itself is never persisted — only digests and refs.
    expect(rowText).not.toContain('raw-prompt-body');
    expect(rowText).not.toContain('tool-output-body');
    expect(rowText).not.toContain('Bearer sk-');
    expect(row.wire_digest).toBe('wire-digest');
    expect(row.selected_json).toBe(JSON.stringify(['ref:file:src/a.ts:1']));
    expect(row.omitted_json).toBe(JSON.stringify(['ref:memory:card-abc123']));
    expect(row.policy_digest).toBe('policy-1');
    expect(row.created_at).toBeTypeOf('number');
  });

  it('survives restart by reading the same SQLite rows from a new store instance', () => {
    const input = makeReceipt({ idempotencyKey: 'restart-key', kind: 'shadow_context' });
    const first = newStore();
    expect(first.put(input).ok).toBe(true);
    // A brand-new ReceiptStore against the same state dir sees the row.
    const second = newStore();
    const row = second.getByIdempotencyKey('restart-key');
    expect(row).toBeDefined();
    expect(row!.content_digest).toBe(receiptContentDigest(input.identity, input.callIndex, input.content));
  });

  it('does not throw into the send path on a store-level failure (hard constraint 5)', () => {
    // A closed/missing state DB must not crash the caller; put surfaces a
    // result object. Here we simulate an unusable database path.
    const broken = new ReceiptStore({ env: process.env, path: path.join(stateDir, 'does-not-exist', 'openclaw-state.db') });
    let result;
    let threw = false;
    try {
      result = broken.put(makeReceipt({ idempotencyKey: 'broken-db' }));
    } catch {
      threw = true;
      result = undefined;
    }
    // The narrow store contract is that put resolves to a result and never
    // throws synchronously into the shadow path; callers must fail RC-02
    // acceptance on a non-ok result without changing send behavior.
    expect(threw).toBe(false);
    expect(result).toBeDefined();
  });
});
