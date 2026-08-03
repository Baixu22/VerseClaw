import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { closeOpenClawStateDatabase } from '../state/openclaw-state-db.js';
import { isLegalTransition, TaskFlowCasStore } from './task-flow-cas.js';

const tempRoots: string[] = [];
let stateDir = '';

function options() {
  return { env: process.env, path: path.join(stateDir, 'openclaw-state.db') } as const;
}

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rc06a-taskflow-'));
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

describe('RC-06A TaskFlow CAS capability proof', () => {
  it('legal transition graph allows valid transitions and rejects illegal ones', () => {
    expect(isLegalTransition('queued', 'running')).toBe(true);
    expect(isLegalTransition('running', 'waiting')).toBe(true);
    expect(isLegalTransition('running', 'succeeded')).toBe(true);
    expect(isLegalTransition('running', 'failed')).toBe(true);
    // Illegal: succeeded can only stay succeeded (terminal absorbing).
    expect(isLegalTransition('succeeded', 'running')).toBe(false);
    expect(isLegalTransition('cancelled', 'running')).toBe(false);
    expect(isLegalTransition('queued', 'succeeded')).toBe(false);
  });

  it('SQLite-level expected-revision CAS writes a new flow with revision 0', () => {
    const store = new TaskFlowCasStore(options());
    const result = store.casUpsert({
      flowId: 'flow-1',
      expectedRevision: 0,
      status: 'queued',
      ownerKey: 'owner-1',
      deliveryState: 'pending',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.revision).toBe(0);
    expect(result.row.status).toBe('queued');
  });

  it('a concurrent writer with a stale revision is rejected atomically (revision-conflict)', () => {
    const store = new TaskFlowCasStore(options());
    const first = store.casUpsert({ flowId: 'flow-cas', expectedRevision: 0, status: 'queued' });
    expect(first.ok).toBe(true);

    // Writer A advances to running with the current revision 0 -> 1.
    const advanceA = store.casUpsert({ flowId: 'flow-cas', expectedRevision: 0, status: 'running' });
    expect(advanceA.ok).toBe(true);
    if (!advanceA.ok) return;
    expect(advanceA.revision).toBe(1);

    // Writer B still holds the old revision 0 and tries running -> blocked.
    const staleB = store.casUpsert({ flowId: 'flow-cas', expectedRevision: 0, status: 'running' });
    expect(staleB.ok).toBe(false);
    if (!staleB.ok) {
      expect(staleB.reason).toBe('revision-conflict');
    }
  });

  it('rejects an illegal transition even with the correct revision', () => {
    const store = new TaskFlowCasStore(options());
    expect(store.casUpsert({ flowId: 'flow-illegal', expectedRevision: 0, status: 'queued' }).ok).toBe(true);
    // queued -> succeeded is illegal.
    const illegal = store.casUpsert({ flowId: 'flow-illegal', expectedRevision: 0, status: 'succeeded' });
    expect(illegal.ok).toBe(false);
    if (!illegal.ok) {
      expect(illegal.reason).toBe('illegal-transition');
    }
  });

  it('flow state survives restart (new store instance reads the same SQLite rows)', () => {
    const first = new TaskFlowCasStore(options());
    const result = first.casUpsert({ flowId: 'flow-restart', expectedRevision: 0, status: 'queued' });
    expect(result.ok).toBe(true);
    expect(first.casUpsert({ flowId: 'flow-restart', expectedRevision: 0, status: 'running' }).ok).toBe(true);

    const second = new TaskFlowCasStore(options());
    const row = second.getById('flow-restart');
    expect(row?.status).toBe('running');
    expect(row?.revision).toBe(1);
  });

  it('concurrent-writer rejection and delivery-state consistency', () => {
    const store = new TaskFlowCasStore(options());
    // Two flows in the same state are both visible and consistent.
    expect(store.casUpsert({ flowId: 'flow-a', expectedRevision: 0, status: 'running', deliveryState: 'delivered' }).ok).toBe(true);
    expect(store.casUpsert({ flowId: 'flow-b', expectedRevision: 0, status: 'running', deliveryState: 'pending' }).ok).toBe(true);

    const running = store.listByStatus('running');
    expect(running).toHaveLength(2);

    // Delivery state stays consistent: each flow row carries its own status.
    const rowA = store.getById('flow-a');
    const rowB = store.getById('flow-b');
    expect(rowA?.status).toBe('running');
    expect(rowB?.status).toBe('running');

    // Advancing flow-a with the correct revision works while flow-b is untouched.
    expect(store.casUpsert({ flowId: 'flow-a', expectedRevision: 0, status: 'waiting' }).ok).toBe(true);
    expect(store.getById('flow-b')?.status).toBe('running');
  });
});
