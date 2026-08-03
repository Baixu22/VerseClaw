import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ReceiptStore } from '../agents/receipt-store.js';
import { closeOpenClawStateDatabase } from '../state/openclaw-state-db.js';
import { resetSealRegistryForTests } from './seal-registry.js';
import { registerRc03SealProducers } from './rc03-producers.js';
import {
  finalizeContextOrchestratorTurn,
  resetContextOrchestratorLineageForTests,
} from './context-orchestrator.js';
import { beginContextCandidateCollection, collectContextCandidate, createContextCandidate } from './context-candidate.js';
import { runRc03SealHook } from './rc03-seal-hook.js';

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
});

afterEach(() => {
  closeOpenClawStateDatabase();
  resetSealRegistryForTests();
  resetContextOrchestratorLineageForTests();
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
});
