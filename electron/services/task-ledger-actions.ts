import { createHash } from 'node:crypto';
import { z } from 'zod';
import { isAbsolute } from 'node:path';
import type { TaskLedgerAgentActionPayload } from '@shared/host-api/contract';
import type { TaskLedgerOperationIdentity, TaskLedgerEventInput } from '@shared/types/task-ledger';
import type { SessionActivitySnapshot } from '@shared/types/session-activity';
import { normalizeAutonomySessionScope, resolveProjectIdForWorkspace, type WorkspaceId } from '@shared/types/identity-scope';
import type { GatewayManager } from '../gateway/manager';
import { getActiveWorkspaceProfile } from './workspaces-api';
import { commitTaskLedgerOperation, replayCommittedTaskLedgerOperation } from './task-ledger-service';
import { withTaskLedgerJournalLock, taskLedgerSessionEpochPath } from '../../shared/task-ledger-journal-lock';

const text = z.string().min(1).max(2000).refine(value => Boolean(value.trim()));
const status = z.enum(['todo', 'doing', 'blocked', 'review', 'done', 'dropped']);
const patch = z.object({ title: text.optional(), description: z.string().max(20000).optional(), progress: z.number().min(0).max(100).optional(), status: status.optional() }).strict();
const node = patch.extend({
  title: text,
  kind: z.enum(['goal', 'milestone', 'task', 'check', 'decision', 'risk', 'deviation', 'review']).optional(),
  parentId: text.nullable().optional(), priority: z.enum(['low', 'normal', 'high']).optional(),
  tags: z.array(text).max(64).optional(),
  evidenceRefs: z.array(z.object({ type: z.enum(['session', 'trace', 'file', 'memory', 'manual', 'tool', 'other']), ref: text, label: text.optional() }).strict()).max(64).optional(),
}).strict();
const request = z.object({
  operationId: z.string().min(1).max(200).refine(value => Boolean(value.trim())),
  expectedRevision: z.number().int().min(0), runtimeGeneration: text,
  runtimeOwner: z.object({ childPid: z.number().int().positive(), connectedAt: z.number().finite() }).strict(),
  scope: z.object({ workspaceId: text, projectId: text, sessionKey: text, sessionGeneration: text }).strict(),
  action: z.discriminatedUnion('type', [
    z.object({ type: z.literal('create'), node }).strict(),
    z.object({ type: z.literal('update'), taskNodeId: text, patch }).strict(),
    z.object({ type: z.literal('link'), taskNodeId: text }).strict(),
  ]),
}).strict();

function denied(message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code: 'VALIDATION' });
}

type GatewayOwner = Pick<GatewayManager, 'rpc' | 'getStatus'>;

async function ownerIdentity(gateway: GatewayOwner | undefined, payload: z.infer<typeof request>): Promise<{ identity: TaskLedgerOperationIdentity; storePath: string }> {
  if (!gateway) throw denied('Automatic Task Ledger actions require the runtime owner');
  const workspace = await getActiveWorkspaceProfile();
  if (!workspace || workspace.id !== payload.scope.workspaceId || workspace.activeSessionKey !== payload.scope.sessionKey) {
    throw denied('Automatic task action is outside the current workspace/session owner');
  }
  const before = gateway.getStatus();
  if (before.state !== 'running' || before.connectedAt !== payload.runtimeOwner.connectedAt
    || (typeof before.pid === 'number' && before.pid !== payload.runtimeOwner.childPid)) {
    throw denied('Task action runtime owner stamp is stale or unavailable');
  }
  const [response, ack] = await Promise.all([
    gateway.rpc<{ snapshot?: SessionActivitySnapshot }>('session.activitySnapshot', { workspaceId: workspace.id, sessionKey: payload.scope.sessionKey }, 3000),
    gateway.rpc<{ gatewayGeneration?: string; childPid?: number }>('runtime.flags.ack', {}, 3000),
  ]);
  const after = gateway.getStatus();
  const currentWorkspace = await getActiveWorkspaceProfile();
  const scope = response.snapshot?.policy?.scope;
  const storePath = response.snapshot?.session.storePath;
  if (before.state !== 'running' || after.state !== 'running' || before.connectedAt === undefined || before.connectedAt !== after.connectedAt
    || before.connectedAt !== payload.runtimeOwner.connectedAt || ack.childPid !== payload.runtimeOwner.childPid
    || (typeof after.pid === 'number' && after.pid !== ack.childPid)
    || currentWorkspace?.id !== workspace.id || currentWorkspace?.activeSessionKey !== payload.scope.sessionKey
    || before.pid !== after.pid || !scope?.agentId || !scope.sessionId
    || typeof storePath !== 'string' || !isAbsolute(storePath)
    || scope.sessionId !== response.snapshot?.session.sessionId
    || scope.workspaceId !== workspace.id || scope.sessionKey !== payload.scope.sessionKey
    || ack.gatewayGeneration !== payload.runtimeGeneration || !ack.childPid) {
    throw denied('Task action runtime identity is unavailable, replaced or stale');
  }
  let verifiedScope: TaskLedgerOperationIdentity['scope'];
  try {
    verifiedScope = normalizeAutonomySessionScope(payload.scope, {
      workspaceId: workspace.id as WorkspaceId,
      projectId: resolveProjectIdForWorkspace(workspace.id as WorkspaceId),
      sessionKey: scope.sessionKey as TaskLedgerOperationIdentity['scope']['sessionKey'],
      sessionGeneration: scope.sessionId,
    });
  } catch (error) { throw denied(error instanceof Error ? error.message : 'Invalid task action scope'); }
  return { storePath, identity: { actor: 'assistant', agentId: scope.agentId, scope: verifiedScope, runtimeGeneration: ack.gatewayGeneration,
    runtimeOwner: { childPid: ack.childPid, connectedAt: before.connectedAt } } };
}

/** Admission of facts only; this does not authorize tools or accept task completion. */
export async function applyTaskLedgerAgentAction(gateway: GatewayOwner | undefined, input: TaskLedgerAgentActionPayload) {
  const parsed = request.safeParse(input);
  if (!parsed.success) throw denied('Invalid automatic task action; actor and undeclared authority fields are forbidden');
  const payload = parsed.data;
  const replay = await replayCommittedTaskLedgerOperation({ workspaceId: payload.scope.workspaceId, operationId: payload.operationId,
    expectedRevision: payload.expectedRevision, request: payload });
  if (replay) return { success: true as const, ...replay };
  const admitted = await ownerIdentity(gateway, payload);
  return withTaskLedgerJournalLock(taskLedgerSessionEpochPath(admitted.storePath), async () => {
    // The runtime's existing session-store writer holds the same outer fence
    // through reset/delete/replace. Re-read after acquiring it; Gateway reads
    // remain available because waiting session writers use the async fence.
    const fenced = await ownerIdentity(gateway, payload);
    if (fenced.storePath !== admitted.storePath) throw denied('Task action session store owner changed');
    const identity = fenced.identity;
    const action = payload.action;
    const id = (kind: string) => `agent-${kind}-${createHash('sha256').update(`${identity.scope.workspaceId}\0${payload.operationId}\0${kind}`).digest('hex').slice(0,32)}`;
    const now = new Date().toISOString();
    let event: TaskLedgerEventInput;
    if (action.type === 'create') {
      const taskNodeId = id('node');
      event = { id: id('event'), type: 'node_created', actor: 'assistant', taskId: taskNodeId,
        payload: { node: { ...action.node, id: taskNodeId, kind: action.node.kind ?? 'task', status: action.node.status ?? 'todo', owner: 'agent', createdAt: now, updatedAt: now } } };
    } else if (action.type === 'update') {
      event = { id: id('event'), type: 'node_updated', actor: 'assistant', taskId: action.taskNodeId,
        payload: { nodeId: action.taskNodeId, patch: action.patch } };
    } else {
      event = { id: id('event'), type: 'session_linked', actor: 'assistant', taskId: action.taskNodeId,
        payload: { sessionLink: { id: id('link'), nodeId: action.taskNodeId, sessionKey: identity.scope.sessionKey, agentId: identity.agentId, createdAt: now } } };
    }
    const result = await commitTaskLedgerOperation({
      workspaceId: identity.scope.workspaceId, operationId: payload.operationId,
      expectedRevision: payload.expectedRevision, identity, request: payload, events: [event],
      validateState: snapshot => {
        // Dedupe precedes target validation: a committed update/link must remain
        // replayable even if a later manual action deleted its target.
        if (action.type !== 'create' && !snapshot.nodes.some(node => node.id === action.taskNodeId)) throw denied('Task node does not exist in this workspace');
        if (action.type === 'create' && action.node.parentId && !snapshot.nodes.some(node => node.id === action.node.parentId)) throw denied('Parent task does not exist in this workspace');
      },
      validateIdentity: async () => {
        // RPC admission runs before acquiring a ticket, and is refreshed if
        // contention carried this request across another journal writer.
        const current = await ownerIdentity(gateway, payload);
        if (current.storePath !== fenced.storePath || JSON.stringify(current.identity) !== JSON.stringify(identity)) throw denied('Task action owner changed before commit');
      },
      validateCurrentOwner: async () => {
        // Main-owned state only: an RPC here would deadlock a synchronous
        // Gateway checkpoint waiting for this same journal's write ticket.
        const workspace = await getActiveWorkspaceProfile();
        const current = gateway?.getStatus();
        if (workspace?.id !== identity.scope.workspaceId || workspace.activeSessionKey !== identity.scope.sessionKey
          || current?.state !== 'running' || current.connectedAt !== identity.runtimeOwner.connectedAt
          || (typeof current.pid === 'number' && current.pid !== identity.runtimeOwner.childPid)) {
          throw denied('Task action owner changed before journal append');
        }
      },
    });
    return { success: true as const, ...result };
  });
}
