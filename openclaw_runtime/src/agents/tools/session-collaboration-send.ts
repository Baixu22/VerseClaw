import { createSessionCollaborationMessage, validateSessionCollaborationReceipt } from '../../../../shared/session-collaboration-message.js';
import type { SessionCollaborationMessage } from '../../../../shared/types/session-collaboration-message.js';
import { parseSessionCollaborationMessageInput } from '../../../../shared/types/session-collaboration-message.js';
import { normalizeAutonomySessionScope, normalizeRunScope } from '../../../../shared/types/identity-scope.js';
import { querySessionCollaborationTool, type SessionCollaborationToolContext } from './session-collaboration-query.js';
import { readSessionTaskEffectRequests } from '../session-task-scope.js';
import { callGateway } from '../../gateway/call.js';

// Lifetime is the existing tool call. This proves source issuance, not delivery or task completion.
const issued = new Map<string, { message: SessionCollaborationMessage; users: number }>();
export function readIssuedCollaborationMessage(id: string) { const value = issued.get(id); return value ? structuredClone(value.message) : null; }

export async function sendSessionCollaboration(opts: (SessionCollaborationToolContext & { runId?: string }) | undefined, input: unknown, signal?: AbortSignal) {
  const intent = parseSessionCollaborationMessageInput(input);
  if (!opts?.runId) throw new TypeError('Current source run required');
  const page = await querySessionCollaborationTool(opts, { readOnly: true }, true);
  if (page.state !== 'ready') throw new Error(`COLLABORATION_SOURCE_${page.reason ?? page.state}`);
  const source = page.requester;
  const effect = readSessionTaskEffectRequests(source.sessionKey, source.sessionGeneration).find(value => value.toolName === 'sessions_send' && value.run?.runId === opts.runId);
  const run = effect?.run ?? (process.env.CLAWX_TASK_SCOPE_BRIDGE === '1' ? null : normalizeRunScope({ runId: opts.runId,
    scope: { workspaceId: source.workspaceId, projectId: source.projectId, sessionKey: source.sessionKey } }));
  if (!run) throw new Error('COLLABORATION_SOURCE_RUN_UNAVAILABLE');
  normalizeAutonomySessionScope({ ...run.scope, sessionGeneration: source.sessionGeneration }, source);
  const message = createSessionCollaborationMessage(intent, { scope: source, run, actor: 'agent' });
  let entry = issued.get(message.id);
  if (entry && entry.message.payloadDigest !== message.payloadDigest) throw new Error('COLLABORATION_MESSAGE_ID_CONFLICT');
  if (!entry) { if (issued.size >= 128) throw new Error('COLLABORATION_MESSAGE_CAPACITY'); entry = { message: structuredClone(message), users: 0 }; issued.set(message.id, entry); }
  entry.users++;
  try {
    signal?.throwIfAborted();
    const result = await (opts.callGateway ?? callGateway)<{ receipt: unknown }>({ method: 'sessions.send', params: { key: intent.target.sessionKey,
      expectedSessionId: intent.target.sessionGeneration, message: intent.message, idempotencyKey: intent.id, collaboration: structuredClone(entry.message) },
      ...(opts.config ? { config: opts.config } : {}), signal });
    return { receipt: validateSessionCollaborationReceipt(entry.message, result?.receipt) };
  } finally { if (--entry.users === 0) issued.delete(message.id); }
}
