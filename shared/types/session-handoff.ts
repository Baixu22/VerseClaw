import type { ScopedRunId } from './identity-scope.js';

/** Operation metadata in Workspace; runtime remains the session/lineage owner. */
export type SessionHandoffOperation = {
  id: string;
  workspaceId: string;
  agentId: string;
  sourceSessionKey: string;
  sourceGeneration: string;
  sessionKey: string;
  sessionGeneration: string | null;
  draftInput: string;
  draftDigest: string;
  firstSendIdempotencyKey: string;
  firstSendRequestDigest?: string;
  phase: 'creating' | 'ready' | 'sending' | 'accepted' | 'sent' | 'failed' | 'unknown';
  error?: string | null;
  receipt?: { source: 'gateway-ack' | 'transcript'; run: ScopedRunId };
  handoffDepth: number;
  handoffRootSessionKey: string;
  parentHandoffId?: string;
  rootHandoffId: string;
  createdAt: string;
  updatedAt: string;
};

export function handoffFirstSendKey(operationId: string): string {
  return `handoff-first:${operationId}`;
}
