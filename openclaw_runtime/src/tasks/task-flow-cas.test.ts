import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { closeOpenClawStateDatabase } from '../state/openclaw-state-db.js';
import {
  CAS_CREATE_SENTINEL,
  isLegalTransition,
  isTerminalFlowStatus,
  TaskFlowCasStore,
} from './task-flow-cas.js';

const tempRoots: string[] = [];
let stateDir = '';

function options() {
  // Match the env-default path used by registry store functions (which take
  // no options parameter): resolveOpenClawStateSqlitePath = OPENCLAW_STATE_DIR
  // + '/state/openclaw.sqlite', so the CAS/registry round-trip hits one file.
  return { env: process.env, path: path.join(stateDir, 'state', 'openclaw.sqlite') } as const;
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
    expect(isLegalTransition('queued', 'failed')).toBe(false);
    expect(isTerminalFlowStatus('succeeded')).toBe(true);
    expect(isTerminalFlowStatus('queued')).toBe(false);
  });

  it('creates a new flow only with the explicit create sentinel (expectedRevision=-1)', () => {
    const store = new TaskFlowCasStore(options());
    const result = store.casUpsert({
      flowId: 'flow-1',
      expectedRevision: CAS_CREATE_SENTINEL,
      status: 'queued',
      ownerKey: 'owner-1',
      deliveryState: 'pending',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.revision).toBe(0);
    expect(result.row.status).toBe('queued');
    // Delivery state persisted on the same row (never declared-but-dropped).
    expect(result.row.delivery_state).toBe('pending');
  });

  it('rejects creation with any non-sentinel revision (audit counter-example)', () => {
    const store = new TaskFlowCasStore(options());
    // The audit counter-example: expectedRevision=999 + initial succeeded +
    // delivered must fail on BOTH dimensions.
    const bogus = store.casUpsert({
      flowId: 'flow-bogus',
      expectedRevision: 999,
      status: 'succeeded',
      deliveryState: 'delivered',
    });
    expect(bogus.ok).toBe(false);
    if (!bogus.ok) {
      expect(bogus.reason).toBe('revision-conflict');
    }

    // A plain arbitrary revision (0) also cannot create a flow.
    const arbitrary = store.casUpsert({ flowId: 'flow-arbitrary', expectedRevision: 0, status: 'queued' });
    expect(arbitrary.ok).toBe(false);
    if (!arbitrary.ok) {
      expect(arbitrary.reason).toBe('revision-conflict');
    }

    // A terminal initial status with the correct sentinel is also rejected.
    const terminalInitial = store.casUpsert({
      flowId: 'flow-terminal-initial',
      expectedRevision: CAS_CREATE_SENTINEL,
      status: 'succeeded',
    });
    expect(terminalInitial.ok).toBe(false);
    if (!terminalInitial.ok) {
      expect(terminalInitial.reason).toBe('illegal-transition');
    }

    // No partial rows were produced.
    expect(store.getById('flow-bogus')).toBeUndefined();
    expect(store.getById('flow-arbitrary')).toBeUndefined();
    expect(store.getById('flow-terminal-initial')).toBeUndefined();
  });

  it('a stale revision writer is rejected atomically (SQL-level revision CAS)', () => {
    const store = new TaskFlowCasStore(options());
    const first = store.casUpsert({ flowId: 'flow-cas', expectedRevision: CAS_CREATE_SENTINEL, status: 'queued' });
    expect(first.ok).toBe(true);

    // Writer A advances to running with the current revision 0 -> 1.
    const advanceA = store.casUpsert({ flowId: 'flow-cas', expectedRevision: 0, status: 'running' });
    expect(advanceA.ok).toBe(true);
    if (!advanceA.ok) return;
    expect(advanceA.revision).toBe(1);

    // Writer B still holds the old revision 0 -> SQL WHERE revision=? guard rejects.
    const staleB = store.casUpsert({ flowId: 'flow-cas', expectedRevision: 0, status: 'running' });
    expect(staleB.ok).toBe(false);
    if (!staleB.ok) {
      expect(staleB.reason).toBe('revision-conflict');
    }
    // The row was NOT modified by the stale write.
    expect(store.getById('flow-cas')?.revision).toBe(1);
  });

  it('rejects an illegal transition even with the correct revision', () => {
    const store = new TaskFlowCasStore(options());
    expect(
      store.casUpsert({ flowId: 'flow-illegal', expectedRevision: CAS_CREATE_SENTINEL, status: 'queued' }).ok,
    ).toBe(true);
    // queued -> succeeded is illegal.
    const illegal = store.casUpsert({ flowId: 'flow-illegal', expectedRevision: 0, status: 'succeeded' });
    expect(illegal.ok).toBe(false);
    if (!illegal.ok) {
      expect(illegal.reason).toBe('illegal-transition');
    }
    expect(store.getById('flow-illegal')?.status).toBe('queued');
  });

  it('terminal resurrection is rejected: a terminal flow cannot restart', () => {
    const store = new TaskFlowCasStore(options());
    expect(
      store.casUpsert({ flowId: 'flow-terminal', expectedRevision: CAS_CREATE_SENTINEL, status: 'running' }).ok,
    ).toBe(true);
    expect(store.casUpsert({ flowId: 'flow-terminal', expectedRevision: 0, status: 'succeeded' }).ok).toBe(true);
    // succeeded -> running is illegal (absorbing terminal).
    const resurrection = store.casUpsert({ flowId: 'flow-terminal', expectedRevision: 1, status: 'running' });
    expect(resurrection.ok).toBe(false);
    if (!resurrection.ok) {
      expect(resurrection.reason).toBe('illegal-transition');
    }
    expect(store.getById('flow-terminal')?.status).toBe('succeeded');
  });

  it('flow state, revision, wait, terminal, and delivery state survive restart', () => {
    const first = new TaskFlowCasStore(options());
    const created = first.casUpsert({
      flowId: 'flow-restart',
      expectedRevision: CAS_CREATE_SENTINEL,
      status: 'queued',
      waitJson: JSON.stringify({ kind: 'waiting-for-operator' }),
      deliveryState: 'pending',
    });
    expect(created.ok).toBe(true);
    expect(first.casUpsert({ flowId: 'flow-restart', expectedRevision: 0, status: 'running' }).ok).toBe(true);
    expect(first.casUpsert({ flowId: 'flow-restart', expectedRevision: 1, status: 'waiting' }).ok).toBe(true);
    expect(first.casUpsert({ flowId: 'flow-restart', expectedRevision: 2, status: 'running' }).ok).toBe(true);

    // A REAL restart: close every cached connection, then reopen from disk.
    closeOpenClawStateDatabase();
    const second = new TaskFlowCasStore(options());
    const row = second.getById('flow-restart');
    expect(row?.status).toBe('running');
    expect(row?.revision).toBe(3);
    expect(row?.wait_json).toContain('waiting-for-operator');
    expect(row?.delivery_state).toBe('pending');

    // Advance to terminal with the current revision; terminal survives restart.
    expect(second.casUpsert({ flowId: 'flow-restart', expectedRevision: 3, status: 'succeeded' }).ok).toBe(true);
    closeOpenClawStateDatabase();
    const third = new TaskFlowCasStore(options());
    expect(third.getById('flow-restart')?.status).toBe('succeeded');
    expect(third.getById('flow-restart')?.ended_at).not.toBeNull();
  });

  it('two REAL independent connections competing for the same flow: only one writer wins', () => {
    // Create the flow through the store (schema ensured), then close all
    // cached handles so the competition below runs on genuine connections.
    const store = new TaskFlowCasStore(options());
    expect(
      store.casUpsert({ flowId: 'flow-race', expectedRevision: CAS_CREATE_SENTINEL, status: 'queued' }).ok,
    ).toBe(true);
    closeOpenClawStateDatabase();

    // Two completely separate DatabaseSync connections to the same file,
    // bypassing the process-wide connection cache. Each runs the exact same
    // CAS UPDATE (WHERE flow_id = ? AND revision = ?); SQLite serializes them
    // and exactly one sees 1 changed row.
    const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
    const dbPath = options().path;
    const connA = new DatabaseSync(dbPath);
    const connB = new DatabaseSync(dbPath);
    connA.exec('PRAGMA busy_timeout = 5000;');
    connB.exec('PRAGMA busy_timeout = 5000;');
    const now = Date.now();
    const updateA = connA.prepare(
      `UPDATE flow_runs SET status = 'running', revision = revision + 1, updated_at = ? WHERE flow_id = 'flow-race' AND revision = 0`,
    );
    const updateB = connB.prepare(
      `UPDATE flow_runs SET status = 'running', revision = revision + 1, updated_at = ? WHERE flow_id = 'flow-race' AND revision = 0`,
    );
    const changesA = updateA.run(now).changes;
    const changesB = updateB.run(now).changes;
    connA.close();
    connB.close();

    // Exactly one writer wins; the loser is rejected atomically (0 rows).
    expect([changesA, changesB].sort()).toEqual([0, 1]);

    // The row reflects the single winning transition exactly once.
    closeOpenClawStateDatabase();
    const reopened = new TaskFlowCasStore(options());
    expect(reopened.getById('flow-race')?.revision).toBe(1);
    expect(reopened.getById('flow-race')?.status).toBe('running');
  });

  it('registry reads project delivery_state back (CAS write -> registry read round-trip)', async () => {
    const store = new TaskFlowCasStore(options());
    expect(
      store.casUpsert({
        flowId: 'flow-registry-proj',
        expectedRevision: CAS_CREATE_SENTINEL,
        status: 'queued',
        deliveryState: 'pending',
      }).ok,
    ).toBe(true);

    // The registry store reads the same flow_runs row and MUST project the
    // delivery_state field (never drop it). Reopen from disk to prove the
    // round-trip is durable, not just cached.
    closeOpenClawStateDatabase();
    const { loadTaskFlowRegistryStateFromSqlite } = await import(
      './task-flow-registry.store.sqlite.js'
    );
    const snapshot = loadTaskFlowRegistryStateFromSqlite();
    const record = snapshot.flows.get('flow-registry-proj');
    expect(record).toBeDefined();
    expect(record?.status).toBe('queued');
    expect(record?.deliveryState).toBe('pending');

    // Registry writes also round-trip delivery_state.
    const { upsertTaskFlowRegistryRecordToSqlite } = await import(
      './task-flow-registry.store.sqlite.js'
    );
    upsertTaskFlowRegistryRecordToSqlite({
      ...record!,
      deliveryState: 'delivered',
    });
    const reloaded = loadTaskFlowRegistryStateFromSqlite();
    expect(reloaded.flows.get('flow-registry-proj')?.deliveryState).toBe('delivered');
  });

  it('delivery/lifecycle cannot split: delivery state persists with every transition and never leaves a partial row', () => {
    const store = new TaskFlowCasStore(options());
    expect(
      store.casUpsert({
        flowId: 'flow-delivery',
        expectedRevision: CAS_CREATE_SENTINEL,
        status: 'queued',
        deliveryState: 'pending',
      }).ok,
    ).toBe(true);
    // A rejected transition must not alter lifecycle OR delivery state.
    const rejected = store.casUpsert({ flowId: 'flow-delivery', expectedRevision: 0, status: 'succeeded' });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.reason).toBe('illegal-transition');
    }
    const afterReject = store.getById('flow-delivery');
    expect(afterReject?.status).toBe('queued');
    expect(afterReject?.delivery_state).toBe('pending');

    // A valid transition carries the new delivery state atomically.
    expect(
      store.casUpsert({
        flowId: 'flow-delivery',
        expectedRevision: 0,
        status: 'running',
        deliveryState: 'delivering',
      }).ok,
    ).toBe(true);
    const afterAdvance = store.getById('flow-delivery');
    expect(afterAdvance?.status).toBe('running');
    expect(afterAdvance?.delivery_state).toBe('delivering');
  });

  it('explicit null clears state/wait/delivery fields consistently (documented contract)', () => {
    const store = new TaskFlowCasStore(options());
    expect(
      store.casUpsert({
        flowId: 'flow-clear',
        expectedRevision: CAS_CREATE_SENTINEL,
        status: 'queued',
        stateJson: '{"phase":"intake"}',
        waitJson: '{"waitMode":"manual_review"}',
        deliveryState: 'pending',
      }).ok,
    ).toBe(true);

    // Advance with explicit null for all three fields: each must be cleared,
    // not retained from the previous row (matches the documented
    // "explicit null clears" contract).
    expect(
      store.casUpsert({
        flowId: 'flow-clear',
        expectedRevision: 0,
        status: 'running',
        stateJson: null,
        waitJson: null,
        deliveryState: null,
      }).ok,
    ).toBe(true);
    const row = store.getById('flow-clear');
    expect(row?.state_json).toBeNull();
    expect(row?.wait_json).toBeNull();
    expect(row?.delivery_state).toBeNull();
  });
});
