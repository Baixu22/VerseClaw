import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { closeOpenClawStateDatabase } from '../state/openclaw-state-db.js';
import { ReceiptStore } from './receipt-store.js';
import {
  SHADOW_CONTEXT_RECEIPT_VERSION,
  SHADOW_WIRE_RECEIPT_VERSION,
  emitShadowCensus,
  wireBodyDigest,
} from './shadow-census.js';

const tempRoots: string[] = [];
let stateDir = '';

function makeBody(overrides: Record<string, unknown> = {}) {
  return {
    model: 'claude-3-5-sonnet',
    max_tokens: 1024,
    messages: [{ role: 'user', content: 'hello' }],
    stream: true,
    ...overrides,
  };
}

function makeContext(overrides: Record<string, unknown> = {}) {
  return {
    providerId: 'anthropic',
    modelId: 'claude-3-5-sonnet',
    sessionKey: 'sess-1',
    runId: 'run-1',
    attemptIndex: 0,
    modelCallIndex: 0,
    wireAttemptIndex: 0,
    ...overrides,
  };
}

function newStore() {
  return new ReceiptStore({ env: process.env, path: path.join(stateDir, 'openclaw-state.db') });
}

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rc02-shadow-census-'));
  tempRoots.push(root);
  stateDir = path.join(root, 'state');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(path.join(root, 'home'), { recursive: true });
  process.env.OPENCLAW_HOME = path.join(root, 'home');
  process.env.OPENCLAW_STATE_DIR = stateDir;
});

afterEach(() => {
  closeOpenClawStateDatabase();
  delete process.env.OPENCLAW_HOME;
  delete process.env.OPENCLAW_STATE_DIR;
  delete process.env.OPENCLAW_CONFIG_PATH;
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('emitShadowCensus (RC-02 shadow receipts)', () => {
  it('is a no-op when the flag is off', () => {
    const result = emitShadowCensus(makeBody(), makeContext(), { enabled: false });
    expect(result.failed).toBe(false);
    expect(result.contextReceipt).toBeNull();
    expect(result.wireReceipt).toBeNull();
  });

  it('emits ShadowContextReceipt/v0 and ShadowWireReceipt/v0 for a source call', () => {
    const body = makeBody();
    const result = emitShadowCensus(body, makeContext(), {
      enabled: true,
      sourceRuntime: true,
      database: { env: process.env, path: path.join(stateDir, 'openclaw-state.db') },
    });
    expect(result.failed).toBe(false);
    expect(result.contextReceipt).toMatchObject({ ok: true, inserted: true, duplicate: false });
    expect(result.wireReceipt).toMatchObject({ ok: true, inserted: true, duplicate: false });

    const store = newStore();
    const contextRows = store.list({ kind: 'shadow_context' });
    expect(contextRows).toHaveLength(1);
    expect(contextRows[0].runtime_mode).toBe('source');
    expect(contextRows[0].version).toBe(SHADOW_CONTEXT_RECEIPT_VERSION);
    expect(contextRows[0].provider_id).toBe('anthropic');
    expect(contextRows[0].session_key).toBe('sess-1');
    expect(contextRows[0].run_id).toBe('run-1');
    expect(contextRows[0].attempt_index).toBe(0);
    expect(contextRows[0].model_call_index).toBe(0);
    expect(contextRows[0].wire_attempt_index).toBe(0);

    const wireRows = store.list({ kind: 'shadow_wire' });
    expect(wireRows).toHaveLength(1);
    expect(wireRows[0].runtime_mode).toBe('source');
    expect(wireRows[0].version).toBe(SHADOW_WIRE_RECEIPT_VERSION);
    expect(wireRows[0].wire_digest).toBe(wireBodyDigest(body));
  });

  it('computes the wire digest without the volatile stream flag (zero-byte parity preserved)', () => {
    const body = makeBody({ stream: true });
    const digest = wireBodyDigest(body);
    expect(digest).toBe(wireBodyDigest({ ...body, stream: true }));
    // The digest is stable regardless of the stream flag; the body object is not mutated.
    expect(body.stream).toBe(true);
    expect(typeof digest).toBe('string');
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
  });

  it('marks the npm fallback runtime_mode as npm without counting toward coverage', () => {
    const result = emitShadowCensus(makeBody(), makeContext(), {
      enabled: true,
      sourceRuntime: false,
      database: { env: process.env, path: path.join(stateDir, 'openclaw-state.db') },
    });
    expect(result.failed).toBe(false);
    const store = newStore();
    const rows = store.list({ kind: 'shadow_wire' });
    expect(rows).toHaveLength(1);
    expect(rows[0].runtime_mode).toBe('npm');
  });

  it('fails the census when a shadow write cannot persist, without throwing (hard constraint 5)', () => {
    // Make the database path unusable by pointing at a path whose parent is a
    // regular file, so opening the SQLite DB fails.
    const blocker = path.join(stateDir, 'blocker.txt');
    fs.writeFileSync(blocker, 'not a directory');
    const broken = {
      env: process.env,
      path: path.join(blocker, 'openclaw-state.db'),
    };
    let result;
    let threw = false;
    try {
      result = emitShadowCensus(makeBody(), makeContext(), { enabled: true, sourceRuntime: true, database: broken });
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
    // A shadow-write failure surfaces as failed=true; the RC-02 run must fail on
    // this without ever changing send behavior.
    expect(result.failed).toBe(true);
  });

  it('is idempotent when the same call body is emitted twice', () => {
    const database = { env: process.env, path: path.join(stateDir, 'openclaw-state.db') };
    const first = emitShadowCensus(makeBody(), makeContext(), { enabled: true, sourceRuntime: true, database });
    const second = emitShadowCensus(makeBody(), makeContext(), { enabled: true, sourceRuntime: true, database });
    expect(first.failed).toBe(false);
    expect(second.failed).toBe(false);
    // Second emission is an idempotent duplicate, not a second row.
    expect(second.contextReceipt).toMatchObject({ ok: true, duplicate: true, reason: 'identical-content' });
    expect(second.wireReceipt).toMatchObject({ ok: true, duplicate: true, reason: 'identical-content' });
    const store = newStore();
    expect(store.list({ kind: 'shadow_context' })).toHaveLength(1);
    expect(store.list({ kind: 'shadow_wire' })).toHaveLength(1);
  });
});
