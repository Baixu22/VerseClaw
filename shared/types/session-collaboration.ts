import { normalizeAutonomyObjectReference, normalizeAutonomySessionScope, type AutonomyProjectScope, type AutonomySessionScope, type SessionKey, type ScopedRunId } from './identity-scope.js';
import { parseSessionActivityReadQuery, type SessionActivityReadQuery, type SessionActivityReadReason, type SessionActivityReadSource, type SessionActivityTaskReference } from './session-activity.js';
import type { TaskAuthorityBasis } from '../task-system/identity.js';

export const SESSION_COLLABORATION_FIELDS = ['goal', 'tasks', 'run', 'actions', 'origin', 'execution'] as const;
export type SessionCollaborationField = typeof SESSION_COLLABORATION_FIELDS[number];
export type SessionCollaborationQuery = {
  requester: AutonomySessionScope;
  target?: AutonomySessionScope;
  workspace?: AutonomyProjectScope;
  search?: string;
  limit?: number;
  cursor?: string;
  fields?: SessionCollaborationField[];
};
export type SessionCollaborationAction = {
  id: string;
  kind: 'tool' | 'process';
  label: string;
  state: 'inflight' | 'running';
  run: ScopedRunId | null;
  observedAt: number;
};
export type SessionCollaborationRow = {
  sessionKey: SessionKey;
  label: string;
  status: 'running' | 'idle' | 'unknown';
  detail: SessionActivityReadQuery | null;
  sources: {
    session: SessionActivityReadSource<{ scope: AutonomySessionScope; agentId: string }>;
    goal: SessionActivityReadSource<{ text: string; truncated: boolean } | null>;
    tasks: SessionActivityReadSource<Omit<SessionActivityTaskReference, 'objective'>[]>;
    run: SessionActivityReadSource<ScopedRunId | null>;
    actions: SessionActivityReadSource<SessionCollaborationAction[]>;
    origin: SessionActivityReadSource<{ spawnedBy: string | null; parentSessionKey: string | null }>;
    execution: SessionActivityReadSource<TaskAuthorityBasis>;
  };
};
export type SessionCollaborationPage = {
  schemaVersion: 'SessionCollaborationQuery/v1';
  requester: AutonomySessionScope;
  state: 'ready' | 'empty' | 'unavailable' | 'stale' | 'unknown';
  reason?: SessionActivityReadReason;
  items: SessionCollaborationRow[];
  nextCursor: string | null;
  scanned: number;
  unknownMatches: number;
  capturedAt: number;
};

/** Query preferences never include visibility grants or a caller-supplied owner snapshot. */
export function parseSessionCollaborationQuery(value: unknown): SessionCollaborationQuery {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Session collaboration query required');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !['requester', 'target', 'workspace', 'search', 'limit', 'cursor', 'fields'].includes(key)))
    throw new TypeError('Unexpected collaboration query field');
  const requester = normalizeAutonomySessionScope(input.requester, input.requester as AutonomySessionScope);
  const target = input.target === undefined ? undefined : normalizeAutonomySessionScope(input.target, input.target as AutonomySessionScope);
  let workspace: AutonomyProjectScope | undefined;
  if (input.workspace !== undefined) {
    if (!input.workspace || typeof input.workspace !== 'object' || Array.isArray(input.workspace)
      || Object.keys(input.workspace).some(key => !['workspaceId', 'projectId'].includes(key))) throw new TypeError('Explicit project/workspace scope required');
    const scope = normalizeAutonomySessionScope({ ...input.workspace, sessionKey: requester.sessionKey, sessionGeneration: requester.sessionGeneration },
      { ...input.workspace, sessionKey: requester.sessionKey, sessionGeneration: requester.sessionGeneration } as AutonomySessionScope);
    workspace = { workspaceId: scope.workspaceId, projectId: scope.projectId };
  }
  if (input.limit !== undefined && (!Number.isSafeInteger(input.limit) || Number(input.limit) < 1 || Number(input.limit) > 50)) throw new TypeError('Collaboration limit must be 1..50');
  if (input.search !== undefined && (typeof input.search !== 'string' || input.search.length > 512)) throw new TypeError('Bounded search text required');
  if (input.cursor !== undefined && (typeof input.cursor !== 'string' || !input.cursor || input.cursor.length > 256)) throw new TypeError('Bounded cursor required');
  if (input.fields !== undefined && (!Array.isArray(input.fields) || input.fields.length > SESSION_COLLABORATION_FIELDS.length
    || input.fields.some(field => !SESSION_COLLABORATION_FIELDS.includes(field as SessionCollaborationField)))) throw new TypeError('Known collaboration fields required');
  return { requester, ...(target ? { target } : {}), ...(workspace ? { workspace } : {}),
    ...(input.search === undefined ? {} : { search: input.search as string }), limit: input.limit === undefined ? 20 : input.limit as number,
    ...(input.cursor === undefined ? {} : { cursor: input.cursor as string }),
    fields: input.fields === undefined ? ['actions', 'goal', 'origin', 'run', 'tasks'] : [...new Set(input.fields as SessionCollaborationField[])].sort() };
}

export function emptySessionCollaborationPage(query: SessionCollaborationQuery, state: SessionCollaborationPage['state'], reason?: SessionActivityReadReason): SessionCollaborationPage {
  return { schemaVersion: 'SessionCollaborationQuery/v1', requester: query.requester, state, ...(reason ? { reason } : {}),
    items: [], nextCursor: null, scanned: 0, unknownMatches: 0, capturedAt: Date.now() };
}

/** Validate the returned join before UI or tool consumers use any scoped field. */
export function validateSessionCollaborationPage(query: SessionCollaborationQuery, value: unknown): SessionCollaborationPage {
  const invalid = () => emptySessionCollaborationPage(query, 'unknown', 'protocol-unverified');
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const page = value as SessionCollaborationPage;
  const fields = new Set(query.fields ?? ['actions', 'goal', 'origin', 'run', 'tasks']);
  const owners = { session: 'sessions', goal: 'TaskSystem', tasks: 'TaskSystem', run: 'runtime',
    actions: 'session-task-effects/bash-processes', origin: 'sessions', execution: 'execution-domain' } as const;
  const text = (input: unknown, size?: number): input is string => typeof input === 'string' && input.trim().length > 0
    && (size === undefined || (input.length <= size * 2 && Array.from(input).length <= size));
  const at = (input: unknown) => typeof input === 'number' && Number.isFinite(input) && input >= 0;
  if (page.schemaVersion !== 'SessionCollaborationQuery/v1' || !Array.isArray(page.items) || page.items.length > (query.limit ?? 20)
    || !Number.isSafeInteger(page.scanned) || page.scanned < page.items.length || page.scanned > 100
    || !Number.isSafeInteger(page.unknownMatches) || page.unknownMatches < 0 || page.unknownMatches > page.scanned || !at(page.capturedAt)
    || !['ready', 'empty', 'unavailable', 'stale', 'unknown'].includes(page.state)
    || (page.items.length > 0) !== (page.state === 'ready')
    || (page.nextCursor !== null && (!text(page.nextCursor) || page.nextCursor.length > 256))) return invalid();
  try {
    for (const row of page.items) {
      if (!text(row.sessionKey) || !text(row.label, 160) || !['running', 'idle', 'unknown'].includes(row.status)) return invalid();
      for (const name of Object.keys(owners) as Array<keyof typeof owners>) {
        const source = row.sources[name];
        if (!source || source.owner !== owners[name] || !['ready', 'empty', 'not_read', 'unavailable', 'stale', 'unknown'].includes(source.state)
          || (name !== 'session' && !fields.has(name) && source.state !== 'not_read')) return invalid();
        if (source.state === 'ready' || source.state === 'empty') {
          if (!at(source.readAt)) return invalid();
        } else if (source.value !== null || !text(source.reason) || (source.readAt !== null && !at(source.readAt))) return invalid();
      }
      const { session, goal, tasks, run, actions, origin, execution } = row.sources;
      if (session.state !== 'ready') {
        if (session.state === 'empty' || row.detail !== null || row.status !== 'unknown'
          || SESSION_COLLABORATION_FIELDS.some(field => row.sources[field].state !== 'not_read')) return invalid();
        continue;
      }
      if (!text(session.value.agentId)) return invalid();
      normalizeAutonomySessionScope(session.value.scope, session.value.scope);
      if (!row.detail) return invalid();
      parseSessionActivityReadQuery(row.detail);
      if (goal.state === 'ready' && (!text(goal.value?.text, 512) || typeof goal.value?.truncated !== 'boolean')) return invalid();
      if (goal.state === 'empty' && goal.value !== null) return invalid();
      if ((run.state === 'ready' && !run.value) || (run.state === 'empty' && run.value !== null)) return invalid();
      if (tasks.state === 'ready' || tasks.state === 'empty') {
        if (!Array.isArray(tasks.value) || (tasks.value.length > 0) !== (tasks.state === 'ready') || tasks.value.length > 1) return invalid();
        for (const task of tasks.value) {
          if (!text(task.authorityId) || !text(task.taskNodeId) || !Number.isSafeInteger(task.revision) || task.revision < 1
            || !text(task.digest) || typeof task.referenceOnly !== 'boolean') return invalid();
          if (task.claim && (!text(task.claim.sessionKey) || !text(task.claim.generation) || !Number.isSafeInteger(task.claim.epoch) || task.claim.epoch < 1)) return invalid();
        }
      }
      if (actions.state === 'ready' || actions.state === 'empty') {
        if (!Array.isArray(actions.value) || (actions.value.length > 0) !== (actions.state === 'ready') || actions.value.length > 8) return invalid();
        for (const action of actions.value) if (!text(action.id) || !text(action.label, 160) || !at(action.observedAt) || action.run === undefined
          || (action.kind === 'tool' ? action.state !== 'inflight' : action.kind !== 'process' || action.state !== 'running')) return invalid();
      }
      if (origin.state === 'ready' && (!origin.value || [origin.value.spawnedBy, origin.value.parentSessionKey].some(key => key !== null && !text(key)))) return invalid();
      if (execution.state === 'ready') parseSessionActivityReadQuery({ scope: session.value.scope, expectedExecution: execution.value });
      const status = run.state === 'ready' || actions.state === 'ready' ? 'running'
        : run.state === 'empty' && actions.state === 'empty' ? 'idle' : 'unknown';
      if (row.status !== status) return invalid();
    }
  } catch { return invalid(); }
  try {
    normalizeAutonomySessionScope(page.requester, query.requester);
    for (const row of page.items) {
      if (row.sources.session.state !== 'ready') continue;
      const scope = row.sources.session.value.scope;
      if (scope.sessionKey !== row.sessionKey) throw new TypeError('Mismatched row identity');
      if (query.target) normalizeAutonomySessionScope(scope, query.target);
      if (query.workspace && (scope.workspaceId !== query.workspace.workspaceId || scope.projectId !== query.workspace.projectId)) throw new TypeError('Mismatched workspace');
      if (row.detail) normalizeAutonomySessionScope(row.detail.scope, scope);
      const checkRun = (run: ScopedRunId) => normalizeAutonomyObjectReference({ kind: 'run', owner: 'runtime', scope, run }, scope);
      if (row.sources.run.state === 'ready' && row.sources.run.value) checkRun(row.sources.run.value);
      if (row.sources.actions.state === 'ready') for (const action of row.sources.actions.value) {
        if (action.run) checkRun(action.run);
      }
    }
  } catch { return emptySessionCollaborationPage(query, 'stale', 'scope-mismatch'); }
  return page;
}
