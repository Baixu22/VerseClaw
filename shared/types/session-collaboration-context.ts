import type { AutonomySessionScope } from './identity-scope.js';
import type { SessionCollaborationQuery } from './session-collaboration.js';
import type { TaskView, TaskEvidence } from '../task-system/types.js';
export type SessionCollaborationTaskContextQuery = SessionCollaborationQuery;
export type SessionCollaborationTaskContext = { schemaVersion: 'SessionCollaborationTaskContext/v1'; scope: AutonomySessionScope;
  state: 'ready' | 'empty' | 'unavailable' | 'stale' | 'unknown'; task: TaskView | null; context: string | null;
  evidence: TaskEvidence[]; legacy: { state: 'unavailable'; reason: 'association-not-verified' }; reason?: string; capturedAt: number };

export function emptyTaskContext(scope: AutonomySessionScope, state: SessionCollaborationTaskContext['state'],
  reason?: string): SessionCollaborationTaskContext {
  return { schemaVersion: 'SessionCollaborationTaskContext/v1', scope, state, task: null, context: null, evidence: [],
    legacy: { state: 'unavailable', reason: 'association-not-verified' }, ...(reason ? { reason } : {}), capturedAt: Date.now() };
}
