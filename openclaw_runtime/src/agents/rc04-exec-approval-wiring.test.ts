import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { closeOpenClawStateDatabase } from '../state/openclaw-state-db.js';
import { ApprovalLedger } from './approval-ledger.js';
import { ExecApprovalManager } from '../gateway/exec-approval-manager.js';

const tempRoots: string[] = [];
let stateDir = '';

function ledgerOptions() {
  return { env: process.env, path: path.join(stateDir, 'openclaw-state.db') } as const;
}

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rc04-wiring-'));
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

describe('RC-04 ExecApprovalManager durable wiring', () => {
  it('commits create into the durable ledger (pending survives restart)', () => {
    const ledger = new ApprovalLedger(ledgerOptions());
    const manager = new ExecApprovalManager({ durableLedger: ledger });
    const record = manager.create(
      { command: 'echo hi', description: 'run echo' } as never,
      60_000,
      'aprv-wire-1',
      { connId: 'conn-7', deviceId: 'dev-9', clientId: 'client-3' },
    );
    expect(record.id).toBe('aprv-wire-1');

    // A fresh ledger over the same state dir sees the pending approval.
    const second = new ApprovalLedger(ledgerOptions());
    const row = second.getById('aprv-wire-1');
    expect(row).toBeDefined();
    expect(row?.state).toBe('approval_pending');
    // Digest-only: the raw command text never persists.
    expect(row?.request_digest).toMatch(/^[0-9a-f]{64}$/);
    expect((row as Record<string, unknown>).request_json).toBeUndefined();
    // Requester identity is persisted atomically with the reservation, so the
    // visibility bind survives Gateway restarts (the in-process record is only
    // a cache).
    expect(row?.requested_by_conn_id).toBe('conn-7');
    expect(row?.requested_by_device_id).toBe('dev-9');
    expect(row?.requested_by_client_id).toBe('client-3');
  });

  it('commits resolve into the durable ledger', async () => {
    const ledger = new ApprovalLedger(ledgerOptions());
    const manager = new ExecApprovalManager({ durableLedger: ledger });
    const record = manager.create({ command: 'echo hi', description: 'x' } as never, 60_000, 'aprv-wire-2');
    const decisionPromise = manager.register(record, 60_000);
    const resolved = manager.resolve('aprv-wire-2', 'allow-once', 'operator');
    expect(resolved).toBe(true);
    await decisionPromise;

    const fresh = new ApprovalLedger(ledgerOptions());
    const row = fresh.getById('aprv-wire-2');
    expect(row?.state).toBe('approved');
    expect(row?.decision).toBe('approved');
    expect(row?.resolved_by).toBe('operator');
  });

  it('a ledger failure is a hard failure in authority mode (no silent fallback)', () => {
    // Point the ledger at an unusable path; constructing the durable owner must
    // throw instead of falling back to the process Map as a second approval
    // authority (a Gateway startup would fail closed).
    const blocker = path.join(stateDir, 'blocker.txt');
    fs.writeFileSync(blocker, 'not a dir');
    expect(() => new ApprovalLedger({ env: process.env, path: path.join(blocker, 'openclaw-state.db') })).toThrow();
  });

  it('recovers pending approvals from the durable ledger after a restart', async () => {
    const ledger = new ApprovalLedger(ledgerOptions());
    const first = new ExecApprovalManager({ durableLedger: ledger });
    const record = first.create({ command: 'echo hi', description: 'x' } as never, 60_000, 'aprv-restart-1');
    first.register(record, 60_000);

    // Simulate a Gateway restart: a brand-new manager over the same state dir
    // re-registers pending truth from the durable owner.
    const second = new ExecApprovalManager({ durableLedger: new ApprovalLedger(ledgerOptions()) });
    const restored = second.recoverPendingFromLedger();
    expect(restored).toBeGreaterThanOrEqual(1);

    const snapshot = second.getSnapshot('aprv-restart-1');
    expect(snapshot).not.toBeNull();
    expect(snapshot?.id).toBe('aprv-restart-1');
    // The restored record carries the digest-only marker (raw never persisted).
    expect((snapshot?.request as { digestOnly?: boolean }).digestOnly).toBe(true);
    expect((snapshot?.request as { requestDigest?: string }).requestDigest).toMatch(/^[0-9a-f]{64}$/);

    // The restored approval can still be resolved through the durable owner.
    const pendingBefore = second.listPendingRecords().length;
    expect(pendingBefore).toBeGreaterThanOrEqual(1);
    expect(second.resolve('aprv-restart-1', 'deny', 'operator-after-restart')).toBe(true);
    const row = new ApprovalLedger(ledgerOptions()).getById('aprv-restart-1');
    expect(row?.state).toBe('denied');
  });

  it('does not restore expired approvals', () => {
    const ledger = new ApprovalLedger(ledgerOptions());
    const manager = new ExecApprovalManager({ durableLedger: ledger });
    // timeoutMs=1 makes the ledger row already expired by recovery time.
    manager.create({ command: 'echo hi', description: 'x' } as never, 1, 'aprv-expired-1');
    const second = new ExecApprovalManager({ durableLedger: new ApprovalLedger(ledgerOptions()) });
    expect(second.recoverPendingFromLedger()).toBe(0);
    expect(second.getSnapshot('aprv-expired-1')).toBeNull();
  });

  it('a repeated identical resolve through the durable owner is idempotent', async () => {
    const ledger = new ApprovalLedger(ledgerOptions());
    const manager = new ExecApprovalManager({ durableLedger: ledger });
    const record = manager.create({ command: 'echo hi', description: 'x' } as never, 60_000, 'aprv-wire-4');
    const decisionPromise = manager.register(record, 60_000);
    expect(manager.resolve('aprv-wire-4', 'allow-once', 'operator')).toBe(true);
    // A second resolve of the same id returns false (already resolved in memory).
    expect(manager.resolve('aprv-wire-4', 'allow-once', 'operator')).toBe(false);
    await decisionPromise;
    const row = new ApprovalLedger(ledgerOptions()).getById('aprv-wire-4');
    expect(row?.state).toBe('approved');
  });
});
