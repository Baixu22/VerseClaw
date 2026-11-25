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
  reply?: { text: string; sha256: string; run: ScopedRunId; truncated: boolean };
  reason?: string;
  updatedAt: number;
};
export type SessionCollaborationMessageQuery = { requester: AutonomySessionScope; target: AutonomySessionScope;
  id?: string; taskNodeId?: string; cursor?: string; limit?: number };
export type SessionCollaborationMessagePage = {
  schemaVersion: 'SessionCollaborationMessages/v1'; requester: AutonomySessionScope;
  state: 'ready' | 'empty' | 'unavailable' | 'stale' | 'unknown';
  items: Array<{ sequence: number; header: Omit<SessionCollaborationMessage, 'message'> & { preview: string; truncated: boolean };
    phase: SessionCollaborationMessageReceipt['phase']; run: ScopedRunId | null; replyRef: string | null; updatedAt: number }>;
  receipt: SessionCollaborationMessageReceipt | null; nextCursor: string | null; reason?: string; capturedAt: number;
};

export function parseSessionCollaborationMessageQuery(value: unknown): SessionCollaborationMessageQuery {
  const input = object(value);
  if (Object.keys(input).some(key => !['requester', 'target', 'id', 'taskNodeId', 'cursor', 'limit'].includes(key))) throw new TypeError('Unexpected message query field');
  const requester = normalizeAutonomySessionScope(input.requester, input.requester as AutonomySessionScope);
  const target = normalizeAutonomySessionScope(input.target, input.target as AutonomySessionScope);
  if (input.id !== undefined && !text(input.id, 160)) throw new TypeError('Bounded message reference required');
  if (input.taskNodeId !== undefined && !text(input.taskNodeId, 300)) throw new TypeError('Bounded task reference required');
  if (input.cursor !== undefined && !text(input.cursor, 256)) throw new TypeError('Bounded message cursor required');
  if (input.limit !== undefined && (!Number.isSafeInteger(input.limit) || Number(input.limit) < 1 || Number(input.limit) > 50)) throw new TypeError('Message page limit must be 1..50');
  return { requester, target, ...(input.id === undefined ? {} : { id: input.id as string }),
    ...(input.taskNodeId === undefined ? {} : { taskNodeId: input.taskNodeId as string }), ...(input.cursor === undefined ? {} : { cursor: input.cursor as string }),
    limit: input.limit === undefined ? 20 : input.limit as number };
}

export function validateSessionCollaborationMessagePage(query: SessionCollaborationMessageQuery, value: unknown): SessionCollaborationMessagePage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const page = value as SessionCollaborationMessagePage;
  const key = (scope: AutonomySessionScope) => JSON.stringify(normalizeAutonomySessionScope(scope, scope));
  try {
    if (page.schemaVersion !== 'SessionCollaborationMessages/v1' || !['ready', 'empty', 'unavailable', 'stale', 'unknown'].includes(page.state)
      || !Array.isArray(page.items) || page.items.length > (query.limit ?? 20) || !Number.isFinite(page.capturedAt) || page.capturedAt < 0
      || key(page.requester) !== key(query.requester) || (page.nextCursor !== null && !text(page.nextCursor, 256))) return null;
    const selected = key(query.target), seen = new Set<string>();
    for (const item of page.items) {
      const header = item.header;
      if (!Number.isSafeInteger(item.sequence) || item.sequence < 0 || !header || seen.has(header.id)
        || !text(header.id, 160) || ![key(header.source), key(header.target)].includes(selected)
        || typeof header.preview !== 'string' || Array.from(header.preview).length > 256 || typeof header.truncated !== 'boolean'
        || !SESSION_COLLABORATION_PURPOSES.includes(header.purpose) || !/^[a-f0-9]{64}$/.test(header.payloadDigest)
        || !['accepted', 'queued', 'delivered', 'replied', 'rejected', 'expired', 'unknown'].includes(item.phase)) return null;
      seen.add(header.id);
    }
    if (page.receipt) {
      const message = parseSessionCollaborationMessage(page.receipt.message);
      if (!query.id || message.id !== query.id || ![key(message.source), key(message.target)].includes(selected)) return null;
    }
    if ((page.items.length > 0 || page.receipt !== null) !== (page.state === 'ready') || (query.id && page.items.length)) return null;
    return page;
  } catch { return null; }
}
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
