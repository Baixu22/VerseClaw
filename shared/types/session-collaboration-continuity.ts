import type { AutonomySessionScope, ScopedRunId } from './identity-scope.js';
import type { SessionCollaborationMaterialRef } from './session-collaboration-material.js';
import type { CoordinationTaskRef } from './session-collaboration-hints.js';

/** Immutable references at the original task transition; no copied body or authority. */
export type TaskCollaborationContinuity = {
  kind: 'fork' | 'handoff' | 'migration';
  sourceSessionKey: string;
  sourceGeneration: string;
  sessionKey: string;
  generation: string;
  task: CoordinationTaskRef;
  capturedAt: number;
  truncated: boolean;
  materials: Array<{ source: AutonomySessionScope; ref: SessionCollaborationMaterialRef }>;
};

/** Projection of existing desktop operation owners; recovery uses their original ID. */
export type CollaborationContinuityOperation = {
  kind: 'handoff' | 'migration';
  id: string;
  phase: string;
  sourceWorkspaceId: string;
  targetWorkspaceId: string;
  sourceSessionKey: string;
  sourceGeneration: string;
  sessionKey: string;
  generation: string | null;
  draftRetained: boolean;
  firstSendIdempotencyKey?: string;
  run?: ScopedRunId;
  sourceCheckout?: string;
  targetCheckout?: string;
};
