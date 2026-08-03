import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { closeOpenClawStateDatabase } from '../state/openclaw-state-db.js';
import { ApprovalLedger } from './approval-ledger.js';
import { EffectReceiptStore } from './effect-receipt.js';
import {
  projectOperatorLineage,
  recoverOperatorSlice,
  runOperatorSlice,
} from './operator-slice.js';

const tempRoots: string[] = [];
let stateDir = '';
let effectRoot = '';

function databaseOptions() {
  return { env: process.env, path: path.join(stateDir, 'openclaw-state.db') } as const;
}

function options(enabled = true) {
  return { enabled, database: databaseOptions(), effectRootDir: effectRoot } as const;
}

function identity(overrides = {}) {
  return {
    sessionKey: 'sess-op-1',
    runId: 'run-op-1',
    traceId: 'trace-op-1',
    cronJobId: 'cron-1',
    inboxItemId: 'inbox-1',
    ...overrides,
  };
}

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rc05-operator-'));
  tempRoots.push(root);
  stateDir = path.join(root, 'state');
  effectRoot = path.join(root, 'effects');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(effectRoot, { recursive: true });
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

describe('RC-05 operator governance slice', () => {
  it('runs the primary path: approval -> bounded file effect -> EffectReceipt -> delivery projection', () => {
    const result = runOperatorSlice({
      identity: identity(),
      effect: { kind: 'file', path: 'out/result.txt', content: 'cron result' },
      requestJson: { command: 'write result', source: 'cron' },
      approvalDecision: 'approved',
      resolvedBy: 'operator-1',
      options: options(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.effectReceiptId).toMatch(/^efx_/);
    expect(result.approvalId).toMatch(/^aprv_/);
    expect(result.state).toBe('reconciled');

    // The bounded file effect was applied exactly once.
    const target = path.join(effectRoot, 'out', 'result.txt');
    expect(fs.existsSync(target)).toBe(true);
    expect(fs.readFileSync(target, 'utf8')).toContain('cron result');

    // Delivery projection shows context/effect/recovery lineage.
    const projection = projectOperatorLineage({ identity: identity(), options: options() });
    expect(projection.recovery).toBe('recovered');
    expect(projection.lineage).toContain(`context:sess-op-1`);
    expect(projection.lineage.some((l) => l.startsWith('effect:'))).toBe(true);
  });

  it('duplicate effect count is zero: a repeated identical turn is idempotent', () => {
    const first = runOperatorSlice({
      identity: identity(),
      effect: { kind: 'file', path: 'out/dup.txt', content: 'x' },
      requestJson: { command: 'write x' },
      approvalDecision: 'approved',
      resolvedBy: 'operator',
      options: options(),
    });
    expect(first.ok).toBe(true);

    // Second identical turn: the approval already resolved, the effect receipt
    // already exists -> no duplicate effect application.
    const second = runOperatorSlice({
      identity: identity(),
      effect: { kind: 'file', path: 'out/dup.txt', content: 'x' },
      requestJson: { command: 'write x' },
      approvalDecision: 'approved',
      resolvedBy: 'operator',
      options: options(),
    });
    expect(second.ok).toBe(false);
    expect(second.reason).toBe('duplicate');

    const target = path.join(effectRoot, 'out', 'dup.txt');
    const content = fs.readFileSync(target, 'utf8');
    // Exactly one line: no duplicate effect.
    expect(content.trim().split('\n')).toHaveLength(1);

    const effects = new EffectReceiptStore(databaseOptions());
    expect(effects.listByApproval(first.ok ? first.approvalId : '')).toHaveLength(1);
  });

  it('denial produces zero effect', () => {
    const denied = runOperatorSlice({
      identity: identity({ runId: 'run-denied' }),
      effect: { kind: 'file', path: 'out/denied.txt', content: 'should-not-exist' },
      requestJson: { command: 'write denied' },
      approvalDecision: 'denied',
      resolvedBy: 'operator',
      options: options(),
    });
    expect(denied.ok).toBe(false);
    expect(denied.reason).toBe('denied');
    expect(fs.existsSync(path.join(effectRoot, 'out', 'denied.txt'))).toBe(false);

    const effects = new EffectReceiptStore(databaseOptions());
    expect(effects.listByApproval(denied.ok ? denied.approvalId : '')).toHaveLength(0);
  });

  it('restart preserves pending/completed truth from RC-04', () => {
    const result = runOperatorSlice({
      identity: identity({ runId: 'run-restart' }),
      effect: { kind: 'message', text: 'completed message' },
      requestJson: { command: 'send message' },
      approvalDecision: 'approved',
      resolvedBy: 'operator',
      options: options(),
    });
    expect(result.ok).toBe(true);

    // A brand-new ledger over the same state dir sees the reconciled truth.
    const ledger = new ApprovalLedger(databaseOptions());
    const row = ledger.getById(result.ok ? result.approvalId : '');
    expect(row?.state).toBe('reconciled');

    // Recovery projection works after restart.
    const recovery = recoverOperatorSlice({ identity: identity({ runId: 'run-restart' }), options: options() });
    expect(recovery.recovery).toBe('recovered');
    expect(recovery.state).toBe('reconciled');
  });

  it('is a no-op when the feature flag is off', () => {
    const result = runOperatorSlice({
      identity: identity({ runId: 'run-off' }),
      effect: { kind: 'file', path: 'out/off.txt', content: 'x' },
      requestJson: { command: 'x' },
      approvalDecision: 'approved',
      resolvedBy: 'operator',
      options: options(false),
    });
    expect(result.ok).toBe(false);
    expect(fs.existsSync(path.join(effectRoot, 'out', 'off.txt'))).toBe(false);
  });

  it('a bounded file effect cannot escape the effect root', () => {
    const result = runOperatorSlice({
      identity: identity({ runId: 'run-escape' }),
      effect: { kind: 'file', path: '../escape.txt', content: 'x' },
      requestJson: { command: 'escape' },
      approvalDecision: 'approved',
      resolvedBy: 'operator',
      options: options(),
    });
    // The effect application fails -> unknown outcome -> needs_reconciliation.
    expect(result.ok).toBe(false);
    expect(fs.existsSync(path.join(effectRoot, '..', 'escape.txt'))).toBe(false);
  });
});
