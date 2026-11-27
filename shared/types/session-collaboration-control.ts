import { normalizeAutonomySessionScope, normalizeRunScope, type AutonomySessionScope, type ScopedRunId } from './identity-scope.js';

export const SESSION_COLLABORATION_CONTROLS = {
  message: { owner: 'sessions.send', effect: 'message', requiresRun: false },
  guide: { owner: 'chat.send:guide', effect: 'same-run-input', requiresRun: true },
  interruptSend: { owner: 'sessions.steer', effect: 'interrupt-then-send', requiresRun: true },
  stop: { owner: 'sessions.stop', effect: 'stop-session', requiresRun: false },
  compact: { owner: 'sessions.compact', effect: 'compact-context', requiresRun: false },
  truncate: { owner: 'sessions.truncate', effect: 'open-original-controls', requiresRun: false },
  fork: { owner: 'sessions.fork', effect: 'open-original-controls', requiresRun: false },
  handoff: { owner: 'sessions.prepareHandoff', effect: 'open-original-controls', requiresRun: false },
  migrate: { owner: 'workspaces.migrateExecution', effect: 'open-original-controls', requiresRun: false },
} as const;
export type SessionCollaborationControl = keyof typeof SESSION_COLLABORATION_CONTROLS;
export function qualifySessionCollaborationControl(action: SessionCollaborationControl, target: AutonomySessionScope,
  current: AutonomySessionScope, run: ScopedRunId | null, currentRun: ScopedRunId | null) {
  if (!Object.hasOwn(SESSION_COLLABORATION_CONTROLS, action)) throw new TypeError('Unknown collaboration control');
  normalizeAutonomySessionScope(target, current);
  if (SESSION_COLLABORATION_CONTROLS[action].requiresRun) {
    if (!run || !currentRun) throw new TypeError('CONTROL_RUN_OWNER_MISSING');
    normalizeRunScope(run); normalizeRunScope(currentRun);
    if (run.runId !== currentRun.runId) throw new TypeError('CONTROL_RUN_CHANGED');
    normalizeAutonomySessionScope({ ...run.scope, sessionGeneration: target.sessionGeneration }, current);
  }
  return SESSION_COLLABORATION_CONTROLS[action];
}
