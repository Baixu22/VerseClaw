// RC-05 inbox.operator.* security gates: verified-device actor binding and
// operator-intent-only resolution (security review should-fix coverage).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { closeOpenClawStateDatabase } from '../../state/openclaw-state-db.js';
import { ApprovalLedger } from '../../agents/approval-ledger.js';
import {
  createOperatorSliceIntent,
  OPERATOR_SLICE_ACTOR,
} from '../../agents/operator-slice.js';
import { createInboxHandlers } from './inbox.js';
import type { GatewayRequestHandlerOptions } from './types.js';

const tempRoots: string[] = [];
let stateDir = '';

function databaseOptions() {
  return { env: process.env, path: path.join(stateDir, 'openclaw-state.db') } as const;
}

function deviceTokenClient(deviceId: string) {
  return {
    connId: 'conn-1',
    isDeviceTokenAuth: true,
    connect: { device: { id: deviceId }, client: { id: 'client-1', displayName: 'spoofed-name' } },
  };
}

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rc05-inbox-gate-'));
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

describe('RC-05 inbox.operator security gates', () => {
  it('decide requires a device-token-authenticated identity (anonymous rejected)', async () => {
    const handlers = createInboxHandlers(databaseOptions());
    const decide = handlers['inbox.operator.decide'];
    let result: { ok?: boolean; error?: { code?: string } } = {};
    await decide({
      params: { approvalId: 'aprv-any', decision: 'approved' },
      client: undefined,
      respond: (ok: boolean, _payload?: unknown, error?: { code?: string }) => {
        result = { ok, error };
      },
    } as unknown as GatewayRequestHandlerOptions);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('NOT_LINKED');
  });

  it('decide rejects non-device-token clients even with a device id present', async () => {
    const handlers = createInboxHandlers(databaseOptions());
    const decide = handlers['inbox.operator.decide'];
    let result: { ok?: boolean; error?: { code?: string } } = {};
    // Token/password or local no-auth client that presents a device id:
    // without isDeviceTokenAuth the actor must NOT be recorded.
    await decide({
      params: { approvalId: 'aprv-any', decision: 'approved' },
      client: {
        connId: 'conn-x',
        isDeviceTokenAuth: false,
        connect: { device: { id: 'self-asserted-device' }, client: { id: 'client-x' } },
      },
      respond: (ok: boolean, _payload?: unknown, error?: { code?: string }) => {
        result = { ok, error };
      },
    } as unknown as GatewayRequestHandlerOptions);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('NOT_LINKED');
  });

  it('decide records the device id (not the spoofable display name) as actor', async () => {
    const ledger = new ApprovalLedger(databaseOptions());
    const intent = createOperatorSliceIntent({
      identity: { sessionKey: 'sess-gate-1', runId: 'run-gate-1' },
      requestJson: { command: 'announce' },
      options: { enabled: true, database: databaseOptions() },
    });
    expect(intent.ok).toBe(true);
    if (!intent.ok) return;

    const handlers = createInboxHandlers(databaseOptions());
    const decide = handlers['inbox.operator.decide'];
    let result: { ok?: boolean; payload?: { actor?: string } } = {};
    await decide({
      params: { approvalId: intent.approvalId, decision: 'approved' },
      client: deviceTokenClient('device-verified-1'),
      respond: (ok: boolean, payload?: { actor?: string }) => {
        result = { ok, payload };
      },
    } as unknown as GatewayRequestHandlerOptions);
    expect(result.ok).toBe(true);
    // Actor is the verified device id — never the spoofable display name.
    expect(result.payload?.actor).toBe('device-verified-1');
    expect(ledger.getById(intent.approvalId)?.resolved_by).toBe('device-verified-1');
  });

  it('decide falls back to client.id under device-token auth when no device id', async () => {
    const ledger = new ApprovalLedger(databaseOptions());
    const intent = createOperatorSliceIntent({
      identity: { sessionKey: 'sess-gate-2', runId: 'run-gate-2' },
      requestJson: { command: 'announce' },
      options: { enabled: true, database: databaseOptions() },
    });
    expect(intent.ok).toBe(true);
    if (!intent.ok) return;

    const handlers = createInboxHandlers(databaseOptions());
    const decide = handlers['inbox.operator.decide'];
    let result: { ok?: boolean; payload?: { actor?: string } } = {};
    await decide({
      params: { approvalId: intent.approvalId, decision: 'approved' },
      client: {
        connId: 'conn-2',
        isDeviceTokenAuth: true,
        connect: { device: { id: '' }, client: { id: 'client-token-auth' } },
      },
      respond: (ok: boolean, payload?: { actor?: string }) => {
        result = { ok, payload };
      },
    } as unknown as GatewayRequestHandlerOptions);
    expect(result.ok).toBe(true);
    expect(result.payload?.actor).toBe('client-token-auth');
    expect(ledger.getById(intent.approvalId)?.resolved_by).toBe('client-token-auth');
  });

  it('decide rejects non-operator intents with APPROVAL_NOT_FOUND', async () => {    // A ledger row created OUTSIDE the operator slice (no cron-ingress owner).
    const ledger = new ApprovalLedger(databaseOptions());
    const reserved = ledger.reserve({
      idempotencyKey: 'aprv-not-operator',
      approvalId: 'aprv-not-operator',
      request: { command: 'x' },
      expiresAtMs: Date.now() + 60_000,
    });
    expect(reserved.ok).toBe(true);
    expect(reserved.row?.requested_by_client_id).not.toBe(OPERATOR_SLICE_ACTOR);

    const handlers = createInboxHandlers(databaseOptions());
    const decide = handlers['inbox.operator.decide'];
    let result: { ok?: boolean; error?: { code?: string } } = {};
    await decide({
      params: { approvalId: 'aprv-not-operator', decision: 'approved' },
      client: deviceTokenClient('device-verified-1'),
      respond: (ok: boolean, _payload?: unknown, error?: { code?: string }) => {
        result = { ok, error };
      },
    } as unknown as GatewayRequestHandlerOptions);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('APPROVAL_NOT_FOUND');
    // The ledger row must be untouched.
    expect(ledger.getById('aprv-not-operator')?.state).toBe('approval_pending');
  });

  it('lineage requires a device-token-authenticated identity (anonymous rejected)', async () => {
    const handlers = createInboxHandlers(databaseOptions());
    const lineage = handlers['inbox.operator.lineage'];
    let result: { ok?: boolean; error?: { code?: string } } = {};
    await lineage({
      params: { runId: 'run-x', sessionKey: 'sess-x' },
      client: undefined,
      respond: (ok: boolean, _payload?: unknown, error?: { code?: string }) => {
        result = { ok, error };
      },
    } as unknown as GatewayRequestHandlerOptions);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('NOT_LINKED');
  });

  it('lineage rejects non-device-token clients even with a device id present', async () => {
    const handlers = createInboxHandlers(databaseOptions());
    const lineage = handlers['inbox.operator.lineage'];
    let result: { ok?: boolean; error?: { code?: string } } = {};
    await lineage({
      params: { runId: 'run-x', sessionKey: 'sess-x' },
      client: { ...deviceTokenClient('device-verified-1'), isDeviceTokenAuth: false },
      respond: (ok: boolean, _payload?: unknown, error?: { code?: string }) => {
        result = { ok, error };
      },
    } as unknown as GatewayRequestHandlerOptions);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('NOT_LINKED');
  });

  it('lineage serves a verified device-token client (no spoofable displayName path)', async () => {
    const ledger = new ApprovalLedger(databaseOptions());
    // Create an operator intent and resolve it so lineage has real receipts.
    const intent = createOperatorSliceIntent({
      identity: { sessionKey: 'sess-x', runId: 'run-x', traceId: 'trace-x', cronJobId: 'cron-x', inboxItemId: 'inbox-x' },
      requestJson: { command: 'announce' },
      options: { enabled: true, database: databaseOptions() },
    });
    expect(intent.ok).toBe(true);
    if (!intent.ok) return;
    expect(
      ledger.resolve({
        approvalId: intent.approvalId,
        decision: 'approved',
        resolvedBy: 'inbox-operator-device-verified-1',
      }).ok,
    ).toBe(true);

    const handlers = createInboxHandlers(databaseOptions());
    const lineage = handlers['inbox.operator.lineage'];
    let result: { ok?: boolean; lineage?: unknown; error?: { code?: string } } = {};
    await lineage({
      params: { runId: 'run-x', sessionKey: 'sess-x' },
      client: deviceTokenClient('device-verified-1'),
      respond: (ok: boolean, payload?: unknown, error?: { code?: string }) => {
        result = { ok, lineage: payload, error };
      },
    } as unknown as GatewayRequestHandlerOptions);
    expect(result.ok).toBe(true);
    expect(result.lineage).toBeDefined();
  });
});
