/**
 * RC-05 operator fixture channel conformance tests. These tests PROVE the
 * channel contract (sendText/receiveText, connection-drop handling, rate
 * limiting, idempotent duplicate suppression, restart recovery, denial zero
 * effect, unknown-outcome journal recovery) by executing the real fixture
 * adapter and the real RC-04/RC-05 state machines — no regex, no mocks.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { closeOpenClawStateDatabase } from '../../../../src/state/openclaw-state-db.js';
import { createOperatorSliceIntent, executeOperatorSliceEffect, resolveOperatorGovernancePolicy, resolveOperatorSliceApproval } from '../../../../src/agents/operator-slice.js';
import {
  createOperatorFixtureAdapter,
  receiveText,
  sendText,
} from '../adapter.js';

const tempRoots: string[] = [];
let stateDir = '';

function databaseOptions() {
  return { env: process.env, path: path.join(stateDir, 'openclaw-state.db') } as const;
}

function sliceOptions() {
  return { enabled: true, database: databaseOptions() } as const;
}

function identity(overrides = {}) {
  return {
    sessionKey: 'sess-conformance-1',
    runId: 'run-conformance-1',
    cronJobId: 'cron-conformance-1',
    ...overrides,
  };
}

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rc05-conformance-'));
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

describe('rc05-operator-fixture conformance', () => {
  it('sendText delivers outbound text and returns a receipt ref', () => {
    const result = sendText({ text: 'operator announcement', channel: 'fixture', to: 'inbox' });
    expect(result.ok).toBe(true);
    expect(result.receiptRef).toContain('fixture:out');
  });

  it('receiveText accepts inbound text', () => {
    const result = receiveText({ text: 'approval requested' });
    expect(result.ok).toBe(true);
    expect(result.received).toBe(true);
  });

  it('rejects an empty outbound text (required validation)', () => {
    const result = sendText({ text: '' });
    expect(result.ok).toBe(false);
  });

  it('handles a connection drop: sends fail until the connection is restored', () => {
    const adapter = createOperatorFixtureAdapter();
    adapter.dropConnection();
    const dropped = adapter.sendText({ text: 'should-not-send' }, 'drop-1');
    expect(dropped.ok).toBe(false);
    expect(dropped.error).toBe('connection-drop');
    expect(adapter.deliveredCount()).toBe(0);

    adapter.restoreConnection();
    const restored = adapter.sendText({ text: 'after-restore' }, 'drop-2');
    expect(restored.ok).toBe(true);
    expect(adapter.deliveredCount()).toBe(1);
  });

  it('enforces rate limiting: budget exhaustion rejects sends', () => {
    const adapter = createOperatorFixtureAdapter();
    adapter.setRateLimit(1);
    expect(adapter.sendText({ text: 'first' }, 'rate-1').ok).toBe(true);
    const limited = adapter.sendText({ text: 'second' }, 'rate-2');
    expect(limited.ok).toBe(false);
    expect(limited.error).toBe('rate-limit');
    expect(adapter.deliveredCount()).toBe(1);
  });

  it('suppresses duplicate delivery under the same idempotency key', () => {
    const adapter = createOperatorFixtureAdapter();
    const first = adapter.sendText({ text: 'once' }, 'dup-key-1');
    expect(first.ok).toBe(true);
    const second = adapter.sendText({ text: 'once' }, 'dup-key-1');
    expect(second.ok).toBe(true);
    expect(second.duplicate).toBe(true);
    expect(second.receiptRef).toBe(first.receiptRef);
    // Duplicate effect count is zero: only one delivery happened.
    expect(adapter.deliveredCount()).toBe(1);
  });

  it('restart recovery preserves delivered ids so duplicates stay suppressed', () => {
    const adapter = createOperatorFixtureAdapter();
    adapter.sendText({ text: 'persist me' }, 'restart-key-1');
    const snapshot = adapter.exportState();

    // A brand-new adapter (fresh process) restores the domain-journal truth.
    const restarted = createOperatorFixtureAdapter();
    restarted.restoreState(snapshot);
    const replay = restarted.sendText({ text: 'persist me' }, 'restart-key-1');
    expect(replay.duplicate).toBe(true);
    expect(restarted.deliveredCount()).toBe(1);
  });

  it('a denial produces zero effect end-to-end (ledger + adapter)', async () => {
    const intent = createOperatorSliceIntent({
      identity: identity(),
      requestJson: { command: 'announce', source: 'cron' },
      options: sliceOptions(),
    });
    expect(intent.ok).toBe(true);
    if (!intent.ok) return;

    const governance = resolveOperatorGovernancePolicy({ policyRule: 'deny-all', decision: 'denied', actor: 'operator-1' });
    const resolved = resolveOperatorSliceApproval({ approvalId: intent.approvalId, governance, options: sliceOptions() });
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) {
      expect(resolved.reason).toBe('denied');
    }

    // Execution cannot start from a denied approval; the adapter never ran.
    const adapter = createOperatorFixtureAdapter();
    const executed = await executeOperatorSliceEffect({
      identity: identity(),
      approvalId: intent.approvalId,
      effect: { kind: 'message', text: 'must not send' },
      governance,
      options: sliceOptions(),
      executor: async (effect) => {
        const result = adapter.sendText({ text: effect.kind === 'message' ? effect.text : '' }, 'denial-key');
        return result.ok ? { outcome: 'applied', journalRef: result.receiptRef } : { outcome: 'not_applied', error: result.error };
      },
    });
    expect(executed.ok).toBe(false);
    if (!executed.ok) {
      expect(executed.reason).toBe('not-approved');
    }
    expect(adapter.deliveredCount()).toBe(0);
  });

  it('an unknown outcome stops in needs_reconciliation and never auto-replays', async () => {
    const intent = createOperatorSliceIntent({
      identity: identity({ runId: 'run-unknown-1' }),
      requestJson: { command: 'announce', source: 'cron' },
      options: sliceOptions(),
    });
    expect(intent.ok).toBe(true);
    if (!intent.ok) return;

    const governance = resolveOperatorGovernancePolicy({ policyRule: 'approve-all', decision: 'approved', actor: 'cron-policy' });
    expect(resolveOperatorSliceApproval({ approvalId: intent.approvalId, governance, options: sliceOptions() }).ok).toBe(true);

    // The adapter crashes mid-send without an ack: unknown outcome.
    const adapter = createOperatorFixtureAdapter();
    const executed = await executeOperatorSliceEffect({
      identity: identity({ runId: 'run-unknown-1' }),
      approvalId: intent.approvalId,
      effect: { kind: 'message', text: 'crashy send' },
      governance,
      options: sliceOptions(),
      executor: async () => {
        throw new Error('connection lost before ack');
      },
    });
    expect(executed.ok).toBe(false);
    if (!executed.ok) {
      expect(executed.reason).toBe('unknown');
    }

    // The ledger row is needs_reconciliation; the adapter never delivered.
    const { recoverOperatorSlice } = await import('../../../../src/agents/operator-slice.js');
    const recovery = recoverOperatorSlice({ identity: identity({ runId: 'run-unknown-1' }), options: sliceOptions() });
    expect(recovery.state).toBe('needs_reconciliation');
    expect(adapter.deliveredCount()).toBe(0);
  });
});
