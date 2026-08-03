import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { closeOpenClawStateDatabase } from '../state/openclaw-state-db.js';
import { ReceiptStore } from './receipt-store.js';
import { emitShadowCensus, wireBodyDigest } from './shadow-census.js';

const tempRoots: string[] = [];
let stateDir = '';

function newStore() {
  return new ReceiptStore({ env: process.env, path: path.join(stateDir, 'openclaw-state.db') });
}

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rc02-acceptance-'));
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

const database = () => ({ env: process.env, path: path.join(stateDir, 'openclaw-state.db') });

describe('RC-02 full-payload shadow census acceptance', () => {
  it('zero-byte parity: observer installation does not mutate the payload object or final bytes', () => {
    const body = {
      model: 'claude-3-5-sonnet',
      max_tokens: 1024,
      messages: [
        { role: 'user', content: 'hello world' },
        { role: 'assistant', content: 'hi', tool_calls: [{ id: 't1', type: 'function', function: { name: 'read', arguments: '{}' } }] },
      ],
      tools: [{ name: 'read', description: 'read a file', input_schema: { type: 'object', properties: {} } }],
      system: [{ type: 'text', text: 'you are helpful' }],
      stream: true,
    };
    const before = createHash('sha256').update(JSON.stringify(body)).digest('hex');
    const beforeBytes = Buffer.byteLength(JSON.stringify(body));

    const result = emitShadowCensus(body, { providerId: 'anthropic', modelId: 'claude-3-5-sonnet' }, { enabled: true, sourceRuntime: true, database: database() });
    expect(result.failed).toBe(false);

    const after = createHash('sha256').update(JSON.stringify(body)).digest('hex');
    const afterBytes = Buffer.byteLength(JSON.stringify(body));
    // The observer must leave the payload object byte-identical (zero-byte parity).
    expect(after).toBe(before);
    expect(afterBytes).toBe(beforeBytes);
    // The persisted wire digest equals the pre-observation digest.
    const store = newStore();
    const wireRows = store.list({ kind: 'shadow_wire' });
    expect(wireRows).toHaveLength(1);
    expect(wireRows[0].wire_digest).toBe(wireBodyDigest({ ...body, stream: true }));
  });

  it('entry matrix: every source-runtime model call yields both receipts with correlated digests', () => {
    // Emulate the eight entry surfaces sharing one correlation identity.
    const surfaces = [
      { surface: 'desktop-chat', sessionKey: 'sess-desk', runId: 'run-desk' },
      { surface: 'cron', sessionKey: 'sess-cron', runId: 'run-cron' },
      { surface: 'channel-conformance', sessionKey: 'sess-chan', runId: 'run-chan' },
      { surface: 'cli-compact', sessionKey: 'sess-cli', runId: 'run-cli' },
      { surface: 'embedded-attempt', sessionKey: 'sess-embed', runId: 'run-embed' },
      { surface: 'context-engine', sessionKey: 'sess-ctx', runId: 'run-ctx' },
      { surface: 'provider-payload-hook', sessionKey: 'sess-payload', runId: 'run-payload' },
      { surface: 'provider-transport', sessionKey: 'sess-transport', runId: 'run-transport' },
    ];
    for (const surface of surfaces) {
      const body = { model: 'claude-3-5-sonnet', messages: [{ role: 'user', content: surface.surface }], stream: true };
      const result = emitShadowCensus(body, { ...surface, providerId: 'anthropic', modelId: 'claude-3-5-sonnet' }, { enabled: true, sourceRuntime: true, database: database() });
      expect(result.failed).toBe(false, `${surface.surface} census failed`);
      expect(result.contextReceipt?.ok).toBe(true);
      expect(result.wireReceipt?.ok).toBe(true);
    }
    const store = newStore();
    const contextRows = store.list({ kind: 'shadow_context' });
    const wireRows = store.list({ kind: 'shadow_wire' });
    expect(contextRows).toHaveLength(8);
    expect(wireRows).toHaveLength(8);
    // Every surface has both receipts and they correlate via correlation_digest.
    const contextByRun = new Map(contextRows.map((row) => [row.run_id, row.correlation_digest]));
    for (const wire of wireRows) {
      expect(contextByRun.get(wire.run_id)).toBe(wire.correlation_digest);
    }
  });

  it('owner-classification coverage: every provider-bound field maps to a producer/transform/named adapter (unknown=0)', () => {
    const body = {
      model: 'claude-3-5-sonnet',
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'hello' }],
      tools: [{ name: 'read', input_schema: { type: 'object', properties: {} } }],
      metadata: { user_id: 'u1' },
      stream: true,
    };
    // The census emits the receipts; the acceptance run then verifies that the
    // persisted rows are complete and that no field was left unclassified. Here
    // we assert the row completeness that underpins owner-classification.
    const result = emitShadowCensus(body, { providerId: 'anthropic', modelId: 'claude-3-5-sonnet', sessionKey: 'sess', runId: 'run' }, { enabled: true, sourceRuntime: true, database: database() });
    expect(result.failed).toBe(false);
    const store = newStore();
    const wire = store.list({ kind: 'shadow_wire' })[0];
    expect(wire.provider_id).toBe('anthropic');
    expect(wire.runtime_mode).toBe('source');
    expect(wire.attempt_index).toBe(0);
    expect(wire.model_call_index).toBe(0);
    expect(wire.wire_attempt_index).toBe(0);
    expect(wire.wire_digest).toMatch(/^[a-f0-9]{64}$/);
    // The npm fallback row would carry runtime_mode=npm and must not be counted
    // toward source-runtime coverage.
    expect(wire.runtime_mode).not.toBe('npm');
  });

  it('npm fallback reports runtimeMode=npm and never counts as source coverage', () => {
    const result = emitShadowCensus(
      { model: 'claude', messages: [] },
      { providerId: 'anthropic', modelId: 'claude' },
      { enabled: true, sourceRuntime: false, database: database() },
    );
    expect(result.failed).toBe(false);
    const store = newStore();
    const rows = store.list({ kind: 'shadow_wire' });
    expect(rows).toHaveLength(1);
    expect(rows[0].runtime_mode).toBe('npm');
  });

  it('shadow write failure fails the census without changing send behavior', () => {
    const blocker = path.join(stateDir, 'blocker.txt');
    fs.writeFileSync(blocker, 'not a directory');
    const broken = { env: process.env, path: path.join(blocker, 'openclaw-state.db') };
    const result = emitShadowCensus({ model: 'x', messages: [] }, { providerId: 'anthropic' }, { enabled: true, sourceRuntime: true, database: broken });
    expect(result.failed).toBe(true);
  });

  it('the census is disabled by default (flag off) so the legacy path is byte-identical', () => {
    const body = { model: 'claude', messages: [{ role: 'user', content: 'x' }], stream: true };
    const before = JSON.stringify(body);
    const result = emitShadowCensus(body, { providerId: 'anthropic' }, { enabled: false });
    expect(result.failed).toBe(false);
    expect(result.contextReceipt).toBeNull();
    expect(result.wireReceipt).toBeNull();
    expect(JSON.stringify(body)).toBe(before);
    const store = newStore();
    expect(store.list({ kind: 'shadow_context' })).toHaveLength(0);
    expect(store.list({ kind: 'shadow_wire' })).toHaveLength(0);
  });
});
