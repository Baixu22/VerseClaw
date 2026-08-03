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
  it('mirrors create into the durable ledger (pending survives restart)', () => {
    const ledger = new ApprovalLedger(ledgerOptions());
    const manager = new ExecApprovalManager({ durableLedger: ledger });
    const record = manager.create({ command: 'echo hi', description: 'run echo' } as never, 60_000, 'aprv-wire-1');
    expect(record.id).toBe('aprv-wire-1');

    // A fresh ledger over the same state dir sees the pending approval.
    const second = new ApprovalLedger(ledgerOptions());
    const row = second.getById('aprv-wire-1');
    expect(row).toBeDefined();
    expect(row?.state).toBe('approval_pending');
    expect(row?.request_json).toContain('echo hi');
  });

  it('mirrors resolve into the durable ledger', async () => {
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

  it('a ledger failure never blocks the in-memory approval path', async () => {
    // Point the ledger at an unusable path; create/resolve must still work.
    const blocker = path.join(stateDir, 'blocker.txt');
    fs.writeFileSync(blocker, 'not a dir');
    const ledger = new ApprovalLedger({ env: process.env, path: path.join(blocker, 'openclaw-state.db') });
    const manager = new ExecApprovalManager({ durableLedger: ledger });
    const record = manager.create({ command: 'echo hi', description: 'x' } as never, 60_000, 'aprv-wire-3');
    const decisionPromise = manager.register(record, 60_000);
    expect(manager.resolve('aprv-wire-3', 'allow-once', 'operator')).toBe(true);
    expect(await decisionPromise).toBe('allow-once');
  });
});
