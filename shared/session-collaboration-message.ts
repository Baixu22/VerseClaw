import { createHash } from 'node:crypto';
import { normalizeAutonomyObjectReference, normalizeAutonomySessionScope, type AutonomySessionScope, type ScopedRunId } from './types/identity-scope.js';
import { parseSessionCollaborationMessage, parseSessionCollaborationMessageInput, type SessionCollaborationMessage, type SessionCollaborationMessageReceipt } from './types/session-collaboration-message.js';

/** Runtime attempt and capture time belong to the first owner receipt, not the idempotent intent. */
export function sessionCollaborationMessageDigest(message: Omit<SessionCollaborationMessage, 'payloadDigest'> | SessionCollaborationMessage) {
  return createHash('sha256').update(JSON.stringify([message.id, message.source, message.target, message.purpose, message.message,
    message.replyTo ?? null, message.task ?? null, message.evidenceRefs ?? [], message.expiresAt ?? null])).digest('hex');
}
export function createSessionCollaborationMessage(input: unknown, owner: { scope: AutonomySessionScope; run: ScopedRunId | null; actor: 'agent' | 'operator' }, now = Date.now()) {
  const intent = parseSessionCollaborationMessageInput(input);
  const scope = normalizeAutonomySessionScope(owner.scope, owner.scope);
  const envelope = { ...intent, schemaVersion: 'SessionCollaborationMessage/v1' as const, source: scope,
    sourceRun: owner.run, actor: owner.actor, createdAt: now };
  return parseSessionCollaborationMessage({ ...envelope, payloadDigest: sessionCollaborationMessageDigest(envelope) });
}
export function verifySessionCollaborationMessage(value: unknown) {
  const message = parseSessionCollaborationMessage(value);
  if (message.payloadDigest !== sessionCollaborationMessageDigest(message)) throw new TypeError('COLLABORATION_MESSAGE_DIGEST_MISMATCH');
  return message;
}

export function validateSessionCollaborationReceipt(expected: SessionCollaborationMessage, value: unknown): SessionCollaborationMessageReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('COLLABORATION_RECEIPT_MISSING');
  const receipt = value as SessionCollaborationMessageReceipt;
  const message = verifySessionCollaborationMessage(receipt.message);
  if (receipt.schemaVersion !== 'SessionCollaborationReceipt/v1' || message.id !== expected.id || message.payloadDigest !== expected.payloadDigest
    || !['accepted', 'queued', 'delivered', 'replied', 'rejected', 'expired', 'unknown'].includes(receipt.phase)
    || !Number.isFinite(receipt.updatedAt) || receipt.updatedAt < 0
    || (receipt.replyRef !== null && (typeof receipt.replyRef !== 'string' || !receipt.replyRef || receipt.replyRef.length > 2048))
    || (receipt.phase === 'replied' && !receipt.replyRef)) throw new TypeError('COLLABORATION_RECEIPT_INVALID');
  normalizeAutonomySessionScope(message.source, expected.source); normalizeAutonomySessionScope(message.target, expected.target);
  if (receipt.run) normalizeAutonomyObjectReference({ kind: 'run', owner: 'runtime', scope: message.target, run: receipt.run }, message.target);
  return { ...receipt, message };
}
