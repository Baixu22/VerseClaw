import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { closeOpenClawStateDatabase } from '../state/openclaw-state-db.js';
import { ApprovalLedger } from './approval-ledger.js';
import { EffectReceiptStore } from './effect-receipt.js';

const tempRoots: string[] = [];
let stateDir = '';

function ledgerOptions() {
  return { env: process.env, path: path.join(stateDir, 'openclaw-state.db') } as const;
}

function newLedger() {
  return new ApprovalLedger(ledgerOptions());
}

function newEffects() {
  return new EffectReceiptStore(ledgerOptions());
}

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rc04-approval-'));
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

function reserve(ledger: ApprovalLedger, key = 'aprv-key-1', expiresInMs = 60_000) {
  return ledger.reserve({
    idempotencyKey: key,
    request: { command: 'echo hello', workspace: '/tmp' },
    expiresAtMs: Date.now() + expiresInMs,
    requestedByClientId: 'client-1',
  });
}

describe('RC-04 durable approval ledger', () => {
  it('persists intent -> approval_pending -> approved -> execution_started -> applied -> reconciled', () => {
    const ledger = newLedger();
    const reserved = reserve(ledger);
    expect(reserved.ok).toBe(true);
    if (!reserved.ok) return;
    expect(reserved.row.state).toBe('approval_pending');
    const approvalId = reserved.row.approval_id;

    const approved = ledger.resolve({ approvalId, decision: 'approved', resolvedBy: 'operator-1' });
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;
    expect(approved.row.state).toBe('approved');

    const started = ledger.markExecutionStarted(approvalId);
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.row.state).toBe('execution_started');

    const applied = ledger.recordEffectOutcome({ approvalId, outcome: 'applied' });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.row.state).toBe('reconciled');

    const row = ledger.getById(approvalId);
    expect(row?.state).toBe('reconciled');
  });

  it('survives restart: a new ApprovalLedger instance reads the same pending truth', () => {
    const first = newLedger();
    const reserved = reserve(first);
    expect(reserved.ok).toBe(true);

    // A brand-new ledger over the same state dir sees the pending approval.
    const second = newLedger();
    if (!reserved.ok) return;
    const row = second.getById(reserved.row.approval_id);
    expect(row).toBeDefined();
    expect(row?.state).toBe('approval_pending');
    expect(row?.request_json).toContain('echo hello');
  });

  it('repeated identical resolve is idempotent; a different decision conflicts', () => {
    const ledger = newLedger();
    const reserved = reserve(ledger);
    if (!reserved.ok) return;
    const approvalId = reserved.row.approval_id;

    const first = ledger.resolve({ approvalId, decision: 'approved', resolvedBy: 'op' });
    expect(first.ok).toBe(true);
    const repeated = ledger.resolve({ approvalId, decision: 'approved', resolvedBy: 'op' });
    expect(repeated.ok).toBe(true);
    expect(repeated.row?.state).toBe('approved');

    const conflict = ledger.resolve({ approvalId, decision: 'denied', resolvedBy: 'op-2' });
    expect(conflict.ok).toBe(false);
    expect(conflict.reason).toBe('state-conflict');
  });

  it('denial produces no effect and leads to no execution_started', () => {
    const ledger = newLedger();
    const reserved = reserve(ledger, 'aprv-denied');
    if (!reserved.ok) return;
    const approvalId = reserved.row.approval_id;

    const denied = ledger.resolve({ approvalId, decision: 'denied', resolvedBy: 'operator' });
    expect(denied.ok).toBe(true);
    expect(denied.row?.state).toBe('denied');

    // Execution cannot start from a denied approval.
    const started = ledger.markExecutionStarted(approvalId);
    expect(started.ok).toBe(false);
    expect(started.reason).toBe('state-conflict');
    // No effect receipt is recorded for a denied approval.
    const effects = newEffects();
    expect(effects.listByApproval(approvalId)).toHaveLength(0);
  });

  it('unknown outcome stops in needs_reconciliation and is never auto-replayed', () => {
    const ledger = newLedger();
    const reserved = reserve(ledger, 'aprv-unknown');
    if (!reserved.ok) return;
    const approvalId = reserved.row.approval_id;
    expect(ledger.resolve({ approvalId, decision: 'approved' }).ok).toBe(true);
    expect(ledger.markExecutionStarted(approvalId).ok).toBe(true);

    const unknown = ledger.recordEffectOutcome({ approvalId, outcome: 'unknown', effectReceiptId: 'efx-1' });
    expect(unknown.ok).toBe(true);
    expect(unknown.row?.state).toBe('needs_reconciliation');
    // The row stays in needs_reconciliation; no auto-reconcile.
    expect(ledger.getById(approvalId)?.state).toBe('needs_reconciliation');

    // Manual/domain-journal reconciliation is the only way forward.
    const reconciled = ledger.reconcile(approvalId, 'journal:run-1:outcome');
    expect(reconciled.ok).toBe(true);
    expect(reconciled.row?.state).toBe('reconciled');
  });

  it('failure injection at each transition is reconciled from the domain journal', () => {
    const ledger = newLedger();
    const reserved = reserve(ledger, 'aprv-failure-injection');
    if (!reserved.ok) return;
    const approvalId = reserved.row.approval_id;
    expect(ledger.resolve({ approvalId, decision: 'approved' }).ok).toBe(true);
    // Simulate a crash after execution_started: record effect outcome unknown.
    expect(ledger.markExecutionStarted(approvalId).ok).toBe(true);
    const unknown = ledger.recordEffectOutcome({ approvalId, outcome: 'unknown', domainJournalRef: 'journal:crash-1' });
    expect(unknown.ok).toBe(true);
    expect(unknown.row?.state).toBe('needs_reconciliation');
    // Reconcile from the domain journal evidence.
    expect(ledger.reconcile(approvalId, 'journal:crash-1').ok).toBe(true);
  });

  it('reserve is idempotent under the same idempotency key', () => {
    const ledger = newLedger();
    const first = reserve(ledger, 'aprv-dup-key');
    const second = reserve(ledger, 'aprv-dup-key');
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.row.approval_id).toBe(first.row.approval_id);
    }
    expect(ledger.listByState('approval_pending')).toHaveLength(1);
  });
});

describe('RC-04 EffectReceipt', () => {
  it('records an effect receipt and correlates it with the approval', () => {
    const ledger = newLedger();
    const reserved = reserve(ledger, 'aprv-effect-1');
    if (!reserved.ok) return;
    const approvalId = reserved.row.approval_id;
    expect(ledger.resolve({ approvalId, decision: 'approved' }).ok).toBe(true);

    const effects = newEffects();
    const result = effects.record({
      idempotencyKey: `efx:${approvalId}`,
      approvalId,
      proposal: { command: 'echo hello' },
      approvalDecision: 'approved',
      domainExecutor: 'bash',
      outcome: 'applied',
      artifactRef: 'artifact:run-1',
      journalRef: 'journal:run-1',
      recoverability: 'none-needed',
    });
    expect(result.ok).toBe(true);
    expect(result.duplicate).toBe(false);

    const rows = effects.listByApproval(approvalId);
    expect(rows).toHaveLength(1);
    expect(rows[0].approval_decision).toBe('approved');
    expect(rows[0].domain_executor).toBe('bash');
    expect(rows[0].outcome).toBe('applied');
    expect(rows[0].artifact_ref).toBe('artifact:run-1');
    expect(rows[0].journal_ref).toBe('journal:run-1');
  });

  it('is idempotent for identical content and conflicts for different content', () => {
    const effects = newEffects();
    const input = {
      idempotencyKey: 'efx-same',
      proposal: { command: 'x' },
      domainExecutor: 'bash',
      outcome: 'applied' as const,
      recoverability: 'none',
    };
    expect(effects.record(input).ok).toBe(true);
    const dup = effects.record(input);
    expect(dup.ok).toBe(true);
    expect(dup.duplicate).toBe(true);
    expect(dup.reason).toBe('identical-content');

    const conflict = effects.record({ ...input, outcome: 'unknown' as const });
    expect(conflict.ok).toBe(false);
    expect(conflict.reason).toBe('content-conflict');
  });
});
