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

function reserve(ledger: ApprovalLedger, key = 'aprv-key-1', expiresInMs = 60_000) {
  return ledger.reserve({
    idempotencyKey: key,
    request: { command: 'echo hello', workspace: '/tmp' },
    expiresAtMs: Date.now() + expiresInMs,
    requestedByClientId: 'client-1',
  });
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
    // Only the canonical digest is stored; the raw request is never persisted.
    expect(row?.request_digest).toMatch(/^[0-9a-f]{64}$/);
    expect((row as Record<string, unknown>).request_json).toBeUndefined();
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
    if (!conflict.ok) {
      expect(conflict.reason).toBe('state-conflict');
    }
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
    if (!started.ok) {
      expect(started.reason).toBe('state-conflict');
    }
    // No effect receipt is recorded for a denied approval.
    const effects = newEffects();
    expect(effects.listByApproval(approvalId)).toHaveLength(0);
  });

  it('rejects an effect outcome before execution_started (approval_pending -> applied fails)', () => {
    const ledger = newLedger();
    const reserved = reserve(ledger, 'aprv-skip-execution');
    if (!reserved.ok) return;
    const approvalId = reserved.row.approval_id;

    // approval_pending directly record applied -> state-conflict.
    const applied = ledger.recordEffectOutcome({ approvalId, outcome: 'applied' });
    expect(applied.ok).toBe(false);
    if (!applied.ok) {
      expect(applied.reason).toBe('state-conflict');
    }
    expect(ledger.getById(approvalId)?.state).toBe('approval_pending');

    // approved but not yet execution_started -> still state-conflict.
    expect(ledger.resolve({ approvalId, decision: 'approved' }).ok).toBe(true);
    const appliedEarly = ledger.recordEffectOutcome({ approvalId, outcome: 'applied' });
    expect(appliedEarly.ok).toBe(false);
    if (!appliedEarly.ok) {
      expect(appliedEarly.reason).toBe('state-conflict');
    }
    expect(ledger.getById(approvalId)?.state).toBe('approved');
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

    // A different outcome cannot be recorded while needs_reconciliation.
    const forced = ledger.recordEffectOutcome({ approvalId, outcome: 'applied' });
    expect(forced.ok).toBe(false);
    if (!forced.ok) {
      expect(forced.reason).toBe('state-conflict');
    }

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

    // Crash right after reserve: state is approval_pending (recovered as pending).
    expect(ledger.getById(approvalId)?.state).toBe('approval_pending');

    // Crash right after resolve: state is approved.
    expect(ledger.resolve({ approvalId, decision: 'approved' }).ok).toBe(true);
    expect(ledger.getById(approvalId)?.state).toBe('approved');

    // Crash after execution_started: record effect outcome unknown; the only
    // explainable terminal from the domain journal is needs_reconciliation.
    expect(ledger.markExecutionStarted(approvalId).ok).toBe(true);
    expect(ledger.getById(approvalId)?.state).toBe('execution_started');
    const unknown = ledger.recordEffectOutcome({ approvalId, outcome: 'unknown', domainJournalRef: 'journal:crash-1' });
    expect(unknown.ok).toBe(true);
    expect(unknown.row?.state).toBe('needs_reconciliation');
    // Reconcile from the domain journal evidence.
    expect(ledger.reconcile(approvalId, 'journal:crash-1').ok).toBe(true);
    expect(ledger.getById(approvalId)?.state).toBe('reconciled');
  });

  it('reserve is idempotent under the same idempotency key with identical content', () => {
    const ledger = newLedger();
    const first = reserve(ledger, 'aprv-dup-key');
    const second = reserve(ledger, 'aprv-dup-key');
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.row.approval_id).toBe(first.row.approval_id);
      // The request digest is the same for identical content.
      expect(second.row.request_digest).toBe(first.row.request_digest);
    }
    expect(ledger.listByState('approval_pending')).toHaveLength(1);
  });

  it('conflicts when the same idempotency key carries a different request (idempotency-conflict)', () => {
    const ledger = newLedger();
    const first = ledger.reserve({
      idempotencyKey: 'aprv-key-conflict',
      request: { command: 'echo hello', workspace: '/tmp' },
      expiresAtMs: Date.now() + 60_000,
    });
    expect(first.ok).toBe(true);
    // Same key but a different request payload must NOT silently reuse the
    // prior approval: a conflicting request is rejected outright.
    const conflicting = ledger.reserve({
      idempotencyKey: 'aprv-key-conflict',
      request: { command: 'rm -rf /', workspace: '/tmp' },
      expiresAtMs: Date.now() + 60_000,
    });
    expect(conflicting.ok).toBe(false);
    if (!conflicting.ok) {
      expect(conflicting.reason).toBe('idempotency-conflict');
    }
    if (first.ok) {
      expect(conflicting.row?.approval_id).toBe(first.row.approval_id);
      // The ledger still holds the original approval untouched.
      expect(ledger.getByIdempotencyKey('aprv-key-conflict')?.request_digest).toBe(first.row.request_digest);
    }
  });

  it('a stale revision writer is rejected atomically (revision CAS)', () => {
    const ledger = newLedger();
    const reserved = reserve(ledger, 'aprv-cas');
    if (!reserved.ok) return;
    const approvalId = reserved.row.approval_id;
    const revisionBefore = reserved.row.revision;
    expect(reserved.row.state).toBe('approval_pending');

    // Resolve bumps the revision.
    const approved = ledger.resolve({ approvalId, decision: 'approved' });
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;
    expect(approved.row.revision).toBeGreaterThan(revisionBefore);

    // Illegal transition from execution_started (before any effect outcome):
    // reconcile can only move needs_reconciliation -> reconciled.
    expect(ledger.markExecutionStarted(approvalId).ok).toBe(true);
    const illegalReconcile = ledger.reconcile(approvalId);
    expect(illegalReconcile.ok).toBe(false);
    if (!illegalReconcile.ok) {
      expect(illegalReconcile.reason).toBe('state-conflict');
    }

    // Recorded outcome moves to reconciled. Replaying the SAME outcome on the
    // reconciled row is idempotent (existing.outcome matches); a DIFFERENT
    // outcome conflicts (strict state machine).
    expect(ledger.recordEffectOutcome({ approvalId, outcome: 'applied' }).ok).toBe(true);
    const replay = ledger.recordEffectOutcome({ approvalId, outcome: 'applied' });
    expect(replay.ok).toBe(true);
    expect(replay.row?.outcome).toBe('applied');
    const differentOutcome = ledger.recordEffectOutcome({ approvalId, outcome: 'unknown' });
    expect(differentOutcome.ok).toBe(false);
    if (!differentOutcome.ok) {
      expect(differentOutcome.reason).toBe('state-conflict');
    }
    expect(ledger.reconcile(approvalId).ok).toBe(true);
    expect(ledger.getById(approvalId)?.revision).toBeGreaterThan(approved.row.revision);
  });

  it('migrates a legacy request_json ledger to digest-only on reopen', () => {
    // Build a legacy-shape approval_ledger by hand (raw request_json column).
    const dbPath = path.join(stateDir, 'openclaw-state.db');
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
    const raw = new DatabaseSync(dbPath);
    raw.exec(`
      CREATE TABLE IF NOT EXISTS approval_ledger (
        approval_id TEXT NOT NULL PRIMARY KEY,
        idempotency_key TEXT NOT NULL,
        state TEXT NOT NULL,
        request_json TEXT NOT NULL,
        requested_by_conn_id TEXT,
        requested_by_device_id TEXT,
        requested_by_client_id TEXT,
        expires_at_ms INTEGER NOT NULL,
        resolved_at_ms INTEGER,
        decision TEXT,
        resolved_by TEXT,
        effect_receipt_id TEXT,
        domain_journal_ref TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO approval_ledger (
        approval_id, idempotency_key, state, request_json,
        requested_by_client_id, expires_at_ms, created_at, updated_at
      ) VALUES (
        'aprv-legacy-1', 'aprv-legacy-1', 'approval_pending',
        '{"command":"echo secret","workspace":"/tmp"}',
        'client-1', ${Date.now() + 60_000}, ${Date.now()}, ${Date.now()}
      );
    `);
    raw.close();
    closeOpenClawStateDatabase();

    // Reopen through the ledger: the legacy raw column must be migrated away.
    const ledger = newLedger();
    const row = ledger.getById('aprv-legacy-1');
    expect(row).toBeDefined();
    expect(row?.request_digest).toMatch(/^[0-9a-f]{64}$/);
    expect((row as Record<string, unknown>).request_json).toBeUndefined();
    // The migrated row remains resolvable.
    expect(ledger.resolve({ approvalId: 'aprv-legacy-1', decision: 'approved' }).ok).toBe(true);

    // Raw payloads (including the secret) never survive in any table.
    const reopened = new DatabaseSync(dbPath, { readOnly: true });
    const tables = reopened
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as Array<{ name: string }>;
    let rawPayloadFound = false;
    for (const table of tables) {
      const columns = reopened.prepare(`PRAGMA table_info(${table.name})`).all() as Array<{
        name: string;
      }>;
      if (!columns.some((column) => column.name.includes('json') || column.name.includes('payload'))) {
        continue;
      }
      const rows = reopened.prepare(`SELECT * FROM ${table.name}`).all() as Array<Record<string, unknown>>;
      for (const cell of rows) {
        if (JSON.stringify(cell).includes('echo secret')) {
          rawPayloadFound = true;
        }
      }
    }
    reopened.close();
    expect(rawPayloadFound).toBe(false);

    // The table rebuild must recreate the query indexes on the live table
    // (PRIMARY KEY autoindexes are ignored).
    const indexDb = new DatabaseSync(dbPath, { readOnly: true });
    const indexes = indexDb
      .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='approval_ledger'`)
      .all() as Array<{ name: string }>;
    indexDb.close();
    expect(indexes.map((index) => index.name).filter((name) => !name.startsWith('sqlite_autoindex_')).sort()).toEqual(
      ['idx_approval_ledger_idempotency', 'idx_approval_ledger_state_created'].sort(),
    );
    // The outcome column exists after migration.
    const columnsDb = new DatabaseSync(dbPath, { readOnly: true });
    const outcomeColumns = columnsDb.prepare(`PRAGMA table_info(approval_ledger)`).all() as Array<{ name: string }>;
    columnsDb.close();
    expect(outcomeColumns.some((column) => column.name === 'outcome')).toBe(true);
  });

  it('never persists raw secrets through reserve + effect receipt', () => {
    const ledger = newLedger();
    const reserved = ledger.reserve({
      idempotencyKey: 'aprv-secret-key',
      request: { command: 'echo TOP_SECRET_VALUE_42', env: { API_KEY: 'sk-live-secret-abc' } },
      expiresAtMs: Date.now() + 60_000,
    });
    expect(reserved.ok).toBe(true);
    if (!reserved.ok) return;
    const approvalId = reserved.row.approval_id;
    expect(ledger.resolve({ approvalId, decision: 'approved' }).ok).toBe(true);
    expect(ledger.markExecutionStarted(approvalId).ok).toBe(true);

    const effects = newEffects();
    const receipt = effects.record({
      idempotencyKey: `efx:${approvalId}`,
      approvalId,
      proposal: { command: 'echo TOP_SECRET_VALUE_42', env: { API_KEY: 'sk-live-secret-abc' } },
      approvalDecision: 'approved',
      domainExecutor: 'bash',
      outcome: 'applied',
      recoverability: 'none-needed',
    });
    expect(receipt.ok).toBe(true);

    // Scan every table/column of the database: the raw secret must not appear.
    const dbPath = path.join(stateDir, 'openclaw-state.db');
    const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
    const reopened = new DatabaseSync(dbPath, { readOnly: true });
    const tables = reopened
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as Array<{ name: string }>;
    let secretFound = false;
    for (const table of tables) {
      const rows = reopened.prepare(`SELECT * FROM ${table.name}`).all() as Array<Record<string, unknown>>;
      for (const cell of rows) {
        if (JSON.stringify(cell).includes('TOP_SECRET_VALUE_42') || JSON.stringify(cell).includes('sk-live-secret-abc')) {
          secretFound = true;
        }
      }
    }
    reopened.close();
    expect(secretFound).toBe(false);

    // The digest is deterministic: the same request yields the same digest.
    const row = ledger.getById(approvalId);
    expect(row?.request_digest).toMatch(/^[0-9a-f]{64}$/);
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
    // Only the digest is stored; raw proposal is never persisted.
    expect(rows[0].proposal_digest).toMatch(/^[0-9a-f]{64}$/);
    expect((rows[0] as Record<string, unknown>).proposal_json).toBeUndefined();
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
    if (dup.ok) {
      expect(dup.duplicate).toBe(true);
      if (dup.duplicate) {
        expect(dup.reason).toBe('identical-content');
      }
    }

    const conflict = effects.record({ ...input, outcome: 'unknown' as const });
    expect(conflict.ok).toBe(false);
    if (!conflict.ok) {
      expect(conflict.reason).toBe('content-conflict');
    }
  });

  it('conflicts when any idempotency dimension differs (proposal/approval/decision/recoverability/refs)', () => {
    const effects = newEffects();
    const base = {
      idempotencyKey: 'efx-dimensions',
      approvalId: 'aprv-1',
      proposal: { command: 'x' },
      approvalDecision: 'approved' as const,
      domainExecutor: 'bash',
      outcome: 'applied' as const,
      artifactRef: 'artifact:1',
      journalRef: 'journal:1',
      recoverability: 'none',
    };
    expect(effects.record(base).ok).toBe(true);
    const variants: Array<Partial<Record<string, unknown>>> = [
      { proposal: { command: 'y' } },
      { approvalId: 'aprv-2' },
      { approvalDecision: 'denied' },
      { domainExecutor: 'node' },
      { outcome: 'not_applied' },
      { artifactRef: 'artifact:2' },
      { journalRef: 'journal:2' },
      { recoverability: 'manual' },
    ];
    for (const variant of variants) {
      const result = effects.record({ ...base, ...variant });
      expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('content-conflict');
    }
    }
  });

  it('migrates a legacy proposal_json receipt to digest-only on reopen', () => {
    const dbPath = path.join(stateDir, 'openclaw-state.db');
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
    const raw = new DatabaseSync(dbPath);
    raw.exec(`
      CREATE TABLE IF NOT EXISTS effect_receipts (
        effect_receipt_id TEXT NOT NULL PRIMARY KEY,
        idempotency_key TEXT NOT NULL,
        approval_id TEXT,
        proposal_json TEXT NOT NULL,
        approval_decision TEXT,
        domain_executor TEXT NOT NULL,
        outcome TEXT NOT NULL,
        artifact_ref TEXT,
        journal_ref TEXT,
        recoverability TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      INSERT INTO effect_receipts (
        effect_receipt_id, idempotency_key, approval_id, proposal_json,
        approval_decision, domain_executor, outcome, artifact_ref, journal_ref,
        recoverability, created_at
      ) VALUES (
        'efx-legacy-1', 'efx-legacy-1', 'aprv-legacy-1', '{"command":"legacy"}',
        'approved', 'bash', 'applied', 'artifact:legacy', 'journal:legacy',
        'none', ${Date.now()}
      );
    `);
    raw.close();
    closeOpenClawStateDatabase();

    const effects = newEffects();
    const row = effects.getById('efx-legacy-1');
    expect(row).toBeDefined();
    expect(row?.proposal_digest).toMatch(/^[0-9a-f]{64}$/);
    expect((row as Record<string, unknown>).proposal_json).toBeUndefined();
    // Idempotency still works: an identical-content replay matches the migrated row.
    const replay = effects.record({
      idempotencyKey: 'efx-legacy-1',
      approvalId: 'aprv-legacy-1',
      proposal: { command: 'legacy' },
      approvalDecision: 'approved',
      domainExecutor: 'bash',
      outcome: 'applied',
      artifactRef: 'artifact:legacy',
      journalRef: 'journal:legacy',
      recoverability: 'none',
    });
    expect(replay.ok).toBe(true);
    if (replay.ok) {
      expect(replay.duplicate).toBe(true);
      if (replay.duplicate) {
        expect(replay.reason).toBe('identical-content');
      }
    }

    // The table rebuild must recreate the query indexes on the live table
    // (PRIMARY KEY autoindexes are ignored).
    const indexDb = new DatabaseSync(dbPath, { readOnly: true });
    const indexes = indexDb
      .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='effect_receipts'`)
      .all() as Array<{ name: string }>;
    indexDb.close();
    expect(indexes.map((index) => index.name).filter((name) => !name.startsWith('sqlite_autoindex_')).sort()).toEqual(
      ['idx_effect_receipts_idempotency', 'idx_effect_receipts_approval'].sort(),
    );
  });
});
