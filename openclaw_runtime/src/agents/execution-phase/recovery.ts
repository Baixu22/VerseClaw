/**
 * TF-0719: recovery reads the committed execution phase.
 *
 * A turn with an open `effect_pending`/`effect_committed` row may already have
 * applied an external effect. Resuming it blindly would duplicate the effect,
 * so the only safe outcome is reconciliation. A turn with only `dispatched`
 * rows never started its effect and may be resumed.
 */
import { readOpenExecutionPhases, type ExecutionPhaseRow, type ExecutionPhaseOptions } from './store.js';
import { isExecutionPhaseWriterEnabled } from './tool-boundary.js';

export type ExecutionPhaseRecoveryAction = 'none' | 'resume' | 'reconcile';

export type ExecutionPhaseRecovery = {
  action: ExecutionPhaseRecoveryAction;
  phases: string[];
  reason: string;
};

export function resolveExecutionPhaseRecovery(
  sessionKey: string,
  env: NodeJS.ProcessEnv = process.env,
  options: ExecutionPhaseOptions = {},
): ExecutionPhaseRecovery {
  if (!isExecutionPhaseWriterEnabled(env)) {
    return { action: 'none', phases: [], reason: 'execution-phase writer disabled' };
  }
  let rows: ExecutionPhaseRow[];
  try {
    rows = readOpenExecutionPhases(sessionKey, options);
  } catch {
    return { action: 'none', phases: [], reason: 'execution-phase store unavailable' };
  }
  if (rows.length === 0) {
    return { action: 'none', phases: [], reason: 'no open execution phases' };
  }
  const phases = rows.map((row) => String(row.phase));
  if (phases.some((phase) => phase === 'effect_pending' || phase === 'effect_committed')) {
    return {
      action: 'reconcile',
      phases,
      reason: 'an effect may already be applied; reconcile before resuming',
    };
  }
  return { action: 'resume', phases, reason: 'only unstarted dispatches are open' };
}

