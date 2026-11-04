import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { closeOpenClawStateDatabase } from '../../state/openclaw-state-db.js';
import {
  commitExecutionPhase,
  readExecutionPhase,
  readOpenExecutionPhases,
  recordExecutionIntent,
  settleOrphanedExecutionPhases,
} from './store.js';

let dir = '';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'exec-phase-'));
});

afterEach(() => {
  closeOpenClawStateDatabase({ path: join(dir, 'state.sqlite') });
  rmSync(dir, { recursive: true, force: true });
});

function options() {
  return { path: join(dir, 'state.sqlite') };
}

describe('TF-0718 execution-phase store', () => {
  it('records the intent before dispatch and is idempotent', () => {
    const first = recordExecutionIntent({
      idempotencyKey: 'k-1', toolName: 'edit', effectClass: 'unsafe', now: 1,
    }, options());
    expect(first.duplicate).toBe(false);
    expect(first.phase).toBe('dispatched');
    const second = recordExecutionIntent({
      idempotencyKey: 'k-1', toolName: 'edit', effectClass: 'unsafe', now: 2,
    }, options());
    expect(second.duplicate).toBe(true);
    expect(readExecutionPhase('k-1', options())?.phase).toBe('dispatched');
  });

  it('walks the legal phase chain with CAS revisions', () => {
    recordExecutionIntent({ idempotencyKey: 'k-2', toolName: 'edit', effectClass: 'unsafe', now: 1 }, options());
    const pending = commitExecutionPhase({ idempotencyKey: 'k-2', from: 'dispatched', to: 'effect_pending', now: 2 }, options());
    expect(pending).toEqual({ ok: true, phase: 'effect_pending', revision: 1 });
    const committed = commitExecutionPhase({ idempotencyKey: 'k-2', from: 'effect_pending', to: 'effect_committed', now: 3 }, options());
    expect(committed).toEqual({ ok: true, phase: 'effect_committed', revision: 2 });
    expect(readExecutionPhase('k-2', options())?.phase).toBe('effect_committed');
  });

  it('rejects a stale writer and an illegal transition', () => {
    recordExecutionIntent({ idempotencyKey: 'k-3', toolName: 'edit', effectClass: 'unsafe', now: 1 }, options());
    commitExecutionPhase({ idempotencyKey: 'k-3', from: 'dispatched', to: 'effect_pending', now: 2 }, options());
    const stale = commitExecutionPhase({ idempotencyKey: 'k-3', from: 'dispatched', to: 'failed', now: 3 }, options());
    expect(stale).toEqual({ ok: false, reason: 'revision-conflict' });
    const illegal = commitExecutionPhase({ idempotencyKey: 'k-3', from: 'effect_pending', to: 'verified', now: 4 }, options());
    expect(illegal).toEqual({ ok: false, reason: 'illegal-transition' });
  });

  it('is a no-op when the target phase is already committed', () => {
    recordExecutionIntent({ idempotencyKey: 'k-4', toolName: 'edit', effectClass: 'safe', now: 1 }, options());
    commitExecutionPhase({ idempotencyKey: 'k-4', from: 'dispatched', to: 'effect_pending', now: 2 }, options());
    const again = commitExecutionPhase({ idempotencyKey: 'k-4', from: 'dispatched', to: 'effect_pending', now: 3 }, options());
    expect(again.ok).toBe(true);
  });
});

describe('TF-0719 orphan settlement', () => {
  it('settles an unstarted dispatch as lost and marks a pending effect for reconciliation', () => {
    recordExecutionIntent({ idempotencyKey: 'a', toolName: 'edit', effectClass: 'unsafe', sessionKey: 's1', now: 1 }, options());
    recordExecutionIntent({ idempotencyKey: 'b', toolName: 'edit', effectClass: 'unsafe', sessionKey: 's1', now: 1 }, options());
    commitExecutionPhase({ idempotencyKey: 'b', from: 'dispatched', to: 'effect_pending', now: 2 }, options());

    const settled = settleOrphanedExecutionPhases({ now: 10, options: options() });
    expect(settled.settled).toBe(1);
    expect(settled.needsReconciliation).toBe(1);

    expect(readExecutionPhase('a', options())?.phase).toBe('failed');
    const b = readExecutionPhase('b', options());
    expect(b?.phase).toBe('effect_pending');
    expect(b?.recovery_json).toContain('needsReconciliation');
  });

  it('lists only open phases for a session', () => {
    recordExecutionIntent({ idempotencyKey: 'c', toolName: 'edit', effectClass: 'safe', sessionKey: 's2', now: 1 }, options());
    expect(readOpenExecutionPhases('s2', options()).map((row) => row.idempotency_key)).toEqual(['c']);
  });
});

