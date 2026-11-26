import { verifySessionCollaborationMessage } from '../../../../shared/session-collaboration-message.js';
import type { SessionCollaborationMessage } from '../../../../shared/types/session-collaboration-message.js';
import { normalizeAutonomySessionScope } from '../../../../shared/types/identity-scope.js';
import { GATEWAY_CLIENT_CAPS, hasGatewayClientCap } from '../../../packages/gateway-protocol/src/client-info.js';
import { readIssuedCollaborationMessage } from '../../agents/tools/session-collaboration-send.js';
import { getAgentRunContext } from '../../infra/agent-events.js';
import { isEmbeddedAgentExecutionActive } from '../../agents/embedded-agent-runner/runs.js';
import { loadSessionEntry } from '../session-utils.js';
import { readSessionCollaborationQuery } from './session-collaboration-query.js';
import { sessionActivityOwnerScope } from './session-activity-read-model.js';
import { createAgentToAgentPolicy, createSessionVisibilityRowChecker, resolveEffectiveSessionToolsVisibility } from '../../plugin-sdk/session-visibility.js';
import { resolveSandboxRuntimeStatus } from '../../agents/sandbox/runtime-status.js';
import type { GatewayClient, GatewayRequestContext } from './types.js';
import { createHash } from 'node:crypto';
import { parseSessionCollaborationMessageQuery, type SessionCollaborationMessagePage, type SessionCollaborationMessageReceipt } from '../../../../shared/types/session-collaboration-message.js';
import { readMessageIntents, messageScopeKey } from '../../sessions/session-collaboration-message-store.js';
import { readScopedAgentRunOutcome } from './agent-job.js';

export function assertSessionCollaborationSource(message: SessionCollaborationMessage, context: GatewayRequestContext, client: GatewayClient | null, now = Date.now()) {
  if (message.expiresAt !== undefined && message.expiresAt <= now) throw new Error('COLLABORATION_MESSAGE_EXPIRED');
  const source = loadSessionEntry(message.source.sessionKey, { readOnly: true, skipCache: true });
  normalizeAutonomySessionScope(message.source, sessionActivityOwnerScope(source.canonicalKey, source.entry));
  if (message.actor === 'operator') {
    if (!hasGatewayClientCap(client?.connect.caps, GATEWAY_CLIENT_CAPS.SESSION_TASK_SCOPE_BRIDGE)) throw new Error('COLLABORATION_SOURCE_OWNER_UNAVAILABLE');
  } else {
    const issued = readIssuedCollaborationMessage(message.id);
    if (!issued || JSON.stringify(issued) !== JSON.stringify(message)) throw new Error('COLLABORATION_SOURCE_NOT_ISSUED');
    const runId = message.sourceRun!.runId, active = context.chatAbortControllers.get(runId), registered = getAgentRunContext(runId);
    if (!(active && !active.controller.signal.aborted && active.sessionKey === message.source.sessionKey && active.sessionId === message.source.sessionGeneration
      && (!active.workspaceId || active.workspaceId === message.source.workspaceId))
      && !(!active && registered?.sessionKey === message.source.sessionKey && registered.sessionId === message.source.sessionGeneration
        && isEmbeddedAgentExecutionActive({ runId, sessionKey: message.source.sessionKey, sessionId: message.source.sessionGeneration }))) throw new Error('COLLABORATION_SOURCE_RUN_CHANGED');
  }
}

/** Qualify source and target at the existing send boundary; body text remains inter_session. */
export async function prepareSessionCollaborationMessage(value: unknown, context: GatewayRequestContext, client: GatewayClient | null, now = Date.now()) {
  const message = verifySessionCollaborationMessage(value);
  assertSessionCollaborationSource(message, context, client, now);
  const target = loadSessionEntry(message.target.sessionKey, { readOnly: true, skipCache: true });
  normalizeAutonomySessionScope(message.target, sessionActivityOwnerScope(target.canonicalKey, target.entry));
  const cfg = context.getRuntimeConfig(), sandboxed = resolveSandboxRuntimeStatus({ cfg, sessionKey: message.source.sessionKey }).sandboxed;
  const checker = createSessionVisibilityRowChecker({ action: 'send', requesterSessionKey: message.source.sessionKey,
    visibility: resolveEffectiveSessionToolsVisibility({ cfg, sandboxed }), a2aPolicy: createAgentToAgentPolicy(cfg) });
  if (!checker.check({ key: message.target.sessionKey, spawnedBy: target.entry?.spawnedBy, parentSessionKey: target.entry?.parentSessionKey }).allowed) throw new Error('COLLABORATION_TARGET_NOT_VISIBLE');
  if (message.task) {
    const task = message.task;
    let found = false;
    for (const scope of [message.source, message.target]) {
      const page = await readSessionCollaborationQuery({ requester: message.source, target: scope, limit: 1, fields: ['tasks'] }, context);
      if (page.items[0]?.sources.tasks.value?.some(ref => ref.authorityId === task.authorityId && ref.taskNodeId === task.taskNodeId && ref.revision === task.revision && ref.digest === task.digest)) found = true;
    }
    if (!found) throw new Error('COLLABORATION_TASK_REFERENCE_STALE');
  }
  assertSessionCollaborationSource(message, context, client, now);
  const previous = context.dedupe.get(`collaboration:${message.id}`);
  if (previous && (previous.payload as { payloadDigest?: string } | undefined)?.payloadDigest !== message.payloadDigest) throw new Error('COLLABORATION_MESSAGE_ID_CONFLICT');
  context.dedupe.set(`collaboration:${message.id}`, { ts: now, ok: true, payload: { payloadDigest: message.payloadDigest } });
  return { message, provenance: sessionCollaborationProvenance(message) };
}

export const sessionCollaborationProvenance = (message: SessionCollaborationMessage) => ({
  kind: 'inter_session' as const, sourceSessionKey: message.source.sessionKey, originSessionId: message.source.sessionGeneration,
  sourceTool: 'sessions_send', collaboration: { id: message.id, purpose: message.purpose, sourceGeneration: message.source.sessionGeneration,
    targetGeneration: message.target.sessionGeneration, payloadDigest: message.payloadDigest, ...(message.replyTo ? { replyTo: message.replyTo } : {}) },
});

export function projectSessionMessageReceipt(receipt: SessionCollaborationMessageReceipt, context: GatewayRequestContext): SessionCollaborationMessageReceipt {
  if (!receipt.run || receipt.phase === 'rejected' || receipt.phase === 'expired' || receipt.phase === 'replied') return receipt;
  const target = receipt.message.target, active = context.chatAbortControllers.get(receipt.run.runId);
  const known = active?.sessionKey === target.sessionKey && active.sessionId === target.sessionGeneration && !active.controller.signal.aborted;
  const terminal = readScopedAgentRunOutcome(receipt.run.runId, target.sessionKey, target.sessionGeneration);
  return known || terminal ? { ...receipt, phase: 'delivered', reason: receipt.replyRef ? undefined : 'reply-not-read' } : receipt;
}

export async function readSessionCollaborationMessages(value: unknown, context: GatewayRequestContext): Promise<SessionCollaborationMessagePage> {
  const query = parseSessionCollaborationMessageQuery(value);
  const page: SessionCollaborationMessagePage = { schemaVersion: 'SessionCollaborationMessages/v1', requester: query.requester,
    state: 'empty', items: [], receipt: null, nextCursor: null, capturedAt: Date.now() };
  const visibility = await readSessionCollaborationQuery({ requester: query.requester, target: query.target, fields: [], limit: 1 }, context);
  if (visibility.state !== 'ready') return { ...page, state: visibility.state === 'empty' ? 'unknown' : visibility.state, reason: visibility.reason };
  const basis = createHash('sha256').update(JSON.stringify({ ...query, cursor: undefined })).digest('hex');
  let sequence = 0;
  if (query.cursor) {
    try {
      const cursor = JSON.parse(Buffer.from(query.cursor, 'base64url').toString());
      if (!Array.isArray(cursor) || cursor.length !== 2 || cursor[0] !== basis || !Number.isSafeInteger(cursor[1]) || cursor[1] < 0) throw new Error('CURSOR');
      sequence = cursor[1];
    } catch { return { ...page, state: 'stale', reason: 'scope-mismatch' }; }
  }
  try {
    readMessageIntents(store => {
      if (query.id) {
        const row = store.get(query.id);
        if (row && [row.source_scope, row.target_scope].includes(messageScopeKey(query.target))) page.receipt = projectSessionMessageReceipt(store.receipt(row), context);
      } else {
        page.items = store.summaries(query.target, sequence, query.limit!, query.taskNodeId);
        if (page.items.length === query.limit) page.nextCursor = Buffer.from(JSON.stringify([basis, page.items.at(-1)!.sequence])).toString('base64url');
      }
    });
  } catch { return { ...page, state: 'unavailable', reason: 'message-owner-unavailable' }; }
  const after = await readSessionCollaborationQuery({ requester: query.requester, target: query.target, fields: [], limit: 1 }, context);
  if (after.state !== 'ready') return { ...page, state: 'stale', reason: after.reason, items: [], receipt: null, nextCursor: null };
  page.state = page.receipt || page.items.length ? 'ready' : 'empty';
  return page;
}
