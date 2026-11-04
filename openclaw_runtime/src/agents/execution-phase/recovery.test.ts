import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { closeOpenClawStateDatabase } from '../../state/openclaw-state-db.js';
import { commitExecutionPhase, recordExecutionIntent } from './store.js';
import { resolveExecutionPhaseRecovery } from './recovery.js';

let dir = '';
function options() { return { path: join(dir, 'state.sqlite') }; }
const env = { OPENCLAW_EXECUTION_PHASE_WRITER: 'taskflow' };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'exec-rec-'));
  process.env.OPENCLAW_EXECUTION_PHASE_WRITER = 'taskflow';
});
afterEach(() => {
  delete process.env.OPENCLAW_EXECUTION_PHASE_WRITER;
  closeOpenClawStateDatabase(options());
  rmSync(dir, { recursive: true, force: true });
});

describe('TF-0719 execution-phase recovery', () => {
  it('does nothing when the writer is disabled', () => {
    expect(resolveExecutionPhaseRecovery('s', {}, options()).action).toBe('none');
  });

  it('resumes when only unstarted dispatches are open', () => {
    recordExecutionIntent({ idempotencyKey: 'a', toolName: 'edit', effectClass: 'unsafe', sessionKey: 's', now: 1 }, options());
    expect(resolveExecutionPhaseRecovery('s', env, options()).action).toBe('resume');
  });

  it('requires reconciliation when an effect may already be applied', () => {
    recordExecutionIntent({ idempotencyKey: 'b', toolName: 'edit', effectClass: 'unsafe', sessionKey: 's', now: 1 }, options());
    commitExecutionPhase({ idempotencyKey: 'b', from: 'dispatched', to: 'effect_pending', now: 2 }, options());
    const result = resolveExecutionPhaseRecovery('s', env, options());
    expect(result.action).toBe('reconcile');
    expect(result.phases).toContain('effect_pending');
  });

  it('returns none when no rows are open', () => {
    recordExecutionIntent({ idempotencyKey: 'c', toolName: 'read', effectClass: 'safe', sessionKey: 's', now: 1 }, options());
    commitExecutionPhase({ idempotencyKey: 'c', from: 'dispatched', to: 'effect_pending', now: 2 }, options());
    commitExecutionPhase({ idempotencyKey: 'c', from: 'effect_pending', to: 'effect_committed', now: 3 }, options());
    commitExecutionPhase({ idempotencyKey: 'c', from: 'effect_committed', to: 'verified', now: 4 }, options());
    commitExecutionPhase({ idempotencyKey: 'c', from: 'verified', to: 'terminal', now: 5 }, options());
    expect(resolveExecutionPhaseRecovery('s', env, options()).action).toBe('none');
  });
});



