import { normalizeAutonomySessionScope, normalizeRunScope, type AutonomySessionScope, type ScopedRunId } from './identity-scope.js';

export const SESSION_COLLABORATION_PURPOSES = ['finding', 'status', 'request', 'handoff', 'result'] as const;
export type SessionCollaborationPurpose = typeof SESSION_COLLABORATION_PURPOSES[number];
export type SessionCollaborationTaskRef = { authorityId: string; taskNodeId: string; revision: number; digest: string };
export type SessionCollaborationMessageInput = {
  id: string;
  target: AutonomySessionScope;
  purpose: SessionCollaborationPurpose;
  message: string;
  replyTo?: string;
  task?: SessionCollaborationTaskRef;
  evidenceRefs?: string[];
  expiresAt?: number;
};
export type SessionCollaborationMessage = SessionCollaborationMessageInput & {
  schemaVersion: 'SessionCollaborationMessage/v1';
  source: AutonomySessionScope;
  sourceRun: ScopedRunId | null;
  actor: 'agent' | 'operator';
  createdAt: number;
  payloadDigest: string;
};
export type SessionCollaborationMessageReceipt = {
  schemaVersion: 'SessionCollaborationReceipt/v1';
  message: SessionCollaborationMessage;
  phase: 'accepted' | 'queued' | 'delivered' | 'replied' | 'rejected' | 'expired' | 'unknown';
  run: ScopedRunId | null;
  replyRef: string | null;
  reason?: string;
  updatedAt: number;
};
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new TypeError('Plain message record required');
  return value as Record<string, unknown>;
};
const text = (value: unknown, max: number) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;

export function parseSessionCollaborationMessageInput(value: unknown): SessionCollaborationMessageInput {
  const input = object(value);
  if (Object.keys(input).some(key => !['id', 'target', 'purpose', 'message', 'replyTo', 'task', 'evidenceRefs', 'expiresAt'].includes(key))) throw new TypeError('Message source is owned by the caller runtime');
  if (!text(input.id, 160) || !/^[A-Za-z0-9._:-]+$/.test(String(input.id))) throw new TypeError('Stable message ID required');
  if (!SESSION_COLLABORATION_PURPOSES.includes(input.purpose as SessionCollaborationPurpose) || !text(input.message, 16_384)) throw new TypeError('Bounded message and purpose required');
  const target = normalizeAutonomySessionScope(input.target, input.target as AutonomySessionScope);
  if (input.replyTo !== undefined && !text(input.replyTo, 160)) throw new TypeError('Stable reply reference required');
  if (input.evidenceRefs !== undefined && (!Array.isArray(input.evidenceRefs) || input.evidenceRefs.length > 16 || input.evidenceRefs.some(ref => !text(ref, 2048)))) throw new TypeError('Bounded evidence references required');
  if (input.expiresAt !== undefined && (!Number.isSafeInteger(input.expiresAt) || Number(input.expiresAt) < 0)) throw new TypeError('Known expiration time required');
  let task: SessionCollaborationTaskRef | undefined;
  if (input.task !== undefined) {
    const ref = object(input.task);
    if (Object.keys(ref).some(key => !['authorityId', 'taskNodeId', 'revision', 'digest'].includes(key))
      || !text(ref.authorityId, 4096) || !text(ref.taskNodeId, 300) || !text(ref.digest, 256) || !Number.isSafeInteger(ref.revision) || Number(ref.revision) < 1) throw new TypeError('Original TaskSystem reference required');
    task = { authorityId: ref.authorityId as string, taskNodeId: ref.taskNodeId as string, revision: ref.revision as number, digest: ref.digest as string };
  }
  return { id: input.id as string, target, purpose: input.purpose as SessionCollaborationPurpose, message: input.message as string,
    ...(input.replyTo === undefined ? {} : { replyTo: input.replyTo as string }), ...(task ? { task } : {}),
    ...(input.evidenceRefs === undefined ? {} : { evidenceRefs: [...input.evidenceRefs as string[]] }),
    ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt as number }) };
}

export function parseSessionCollaborationMessage(value: unknown): SessionCollaborationMessage {
  const input = object(value);
  const own = ['schemaVersion', 'source', 'sourceRun', 'actor', 'createdAt', 'payloadDigest'];
  const intent = parseSessionCollaborationMessageInput(Object.fromEntries(Object.entries(input).filter(([key]) => !own.includes(key))));
  if (input.schemaVersion !== 'SessionCollaborationMessage/v1' || !['agent', 'operator'].includes(String(input.actor))
    || !Number.isSafeInteger(input.createdAt) || Number(input.createdAt) < 0 || !/^[a-f0-9]{64}$/.test(String(input.payloadDigest))) throw new TypeError('Original message envelope required');
  const source = normalizeAutonomySessionScope(input.source, input.source as AutonomySessionScope);
  const sourceRun = input.sourceRun === null ? null : normalizeRunScope(input.sourceRun);
  if (sourceRun) normalizeAutonomySessionScope({ ...sourceRun.scope, sessionGeneration: source.sessionGeneration }, source);
  if (input.actor === 'agent' && !sourceRun) throw new TypeError('Agent message requires its original run');
  return { ...intent, schemaVersion: 'SessionCollaborationMessage/v1', source, sourceRun, actor: input.actor as 'agent' | 'operator',
    createdAt: input.createdAt as number, payloadDigest: input.payloadDigest as string };
}
