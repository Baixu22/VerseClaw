import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { normalizeAutonomySessionScope, normalizeRunScope, type AutonomySessionScope, type SessionKey } from '../../../../shared/types/identity-scope.js';
import { emptySessionCollaborationPage, parseSessionCollaborationQuery, type SessionCollaborationAction, type SessionCollaborationPage,
  type SessionCollaborationRow } from '../../../../shared/types/session-collaboration.js';
import type { SessionActivityReadReason, SessionActivityTaskReference } from '../../../../shared/types/session-activity.js';
import type { TaskSystemStore } from '../../../../shared/task-system/store.js';
import { loadCombinedSessionStoreForGateway } from '../../config/sessions/combined-store-gateway.js';
import type { SessionEntry } from '../../config/sessions/types.js';
import { createAgentToAgentPolicy, createSessionVisibilityRowChecker, resolveEffectiveSessionToolsVisibility } from '../../plugin-sdk/session-visibility.js';
import { resolveSandboxRuntimeStatus } from '../../agents/sandbox/runtime-status.js';
import { readSessionTaskEffectRequests } from '../../agents/session-task-scope.js';
import { listRunningSessions } from '../../agents/bash-process-registry.js';
import { parseAgentSessionKey } from '../../routing/session-key.js';
import { filterArchivedSessionStore } from '../session-archive-index.js';
import { bashSessionMatches } from './session-lifecycle-owner-views.js';
import { buildSessionActivityReadProjection } from './session-activity-projection.js';
import { readSessionActivityRun, readSessionActivityTaskReferences, sessionActivityOwnerScope } from './session-activity-read-model.js';
import type { GatewayRequestContext } from './types.js';

const unread = (owner: string) => ({ owner, state: 'not_read' as const, readAt: null, value: null, reason: 'source-not-read' as const });
const unavailable = (owner: string, reason: SessionActivityReadReason = 'owner-unavailable', state: 'unavailable' | 'unknown' | 'stale' = 'unavailable') =>
  ({ owner, state, value: null, readAt: Date.now(), reason });
const signature = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const identityRows = (store: Record<string, SessionEntry>) => Object.entries(store).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
  .map(([key, entry]) => [key, entry.sessionId, entry.workspaceId, entry.workspaceDir, entry.spawnedWorkspaceDir,
    entry.updatedAt, entry.label, entry.displayName, entry.spawnedBy, entry.parentSessionKey]);
function boundedText(text: string, size: number) {
  let result = '';
  for (const character of text) { if (size-- === 0) break; result += character; }
  return result;
}

function readActions(scope: AutonomySessionScope, run: SessionCollaborationRow['sources']['run']): SessionCollaborationRow['sources']['actions'] {
  try {
    const effects = readSessionTaskEffectRequests(scope.sessionKey, scope.sessionGeneration);
    const processes = listRunningSessions().filter(process => bashSessionMatches(process, scope.sessionKey));
    const owned = processes.filter(process => process.lifecycleExpectedSessionId === scope.sessionGeneration);
    const projected = buildSessionActivityReadProjection({ sessionKey: scope.sessionKey, bashProcesses: owned }).processes;
    const actions: SessionCollaborationAction[] = [
      ...effects.map(effect => ({ id: effect.operationId ?? effect.requestId, kind: 'tool' as const, label: boundedText(effect.toolName, 160),
        state: 'inflight' as const, run: normalizeRunScope({ runId: effect.runId, scope: { workspaceId: scope.workspaceId, projectId: scope.projectId, sessionKey: scope.sessionKey } }), observedAt: Date.now() })),
      ...projected.filter(process => process.status === 'running').map(process => ({ id: process.id, kind: 'process' as const,
        label: boundedText(process.label, 160), state: 'running' as const, run: null, observedAt: process.updatedAt })),
    ].sort((a, b) => b.observedAt - a.observedAt).slice(0, 8);
    if (actions.length) return { owner: 'session-task-effects/bash-processes', state: 'ready', value: actions, readAt: Date.now() };
    if (processes.some(process => !process.lifecycleExpectedSessionId) || run.state !== 'empty')
      return unavailable('session-task-effects/bash-processes', 'run-identity-missing', 'unknown');
    return { owner: 'session-task-effects/bash-processes', state: 'empty', value: [], readAt: Date.now() };
  } catch { return unavailable('session-task-effects/bash-processes'); }
}

/** One bounded owner join serves both typed Host clients and built-in session tools. */
export async function readSessionCollaborationQuery(input: unknown, context: GatewayRequestContext): Promise<SessionCollaborationPage> {
  const query = parseSessionCollaborationQuery(input);
  const cfg = context.getRuntimeConfig();
  const fail = (state: SessionCollaborationPage['state'], reason: SessionActivityReadReason) => emptySessionCollaborationPage(query, state, reason);
  let store: Record<string, SessionEntry>;
  try { store = await filterArchivedSessionStore(cfg, loadCombinedSessionStoreForGateway(cfg, { readOnly: true }).store); }
  catch { return fail('unavailable', 'owner-unavailable'); }
  const requester = sessionActivityOwnerScope(query.requester.sessionKey, store[query.requester.sessionKey]);
  if (!requester) return fail('unavailable', 'owner-missing');
  try { normalizeAutonomySessionScope(query.requester, requester); }
  catch { return fail('stale', query.requester.sessionGeneration === requester.sessionGeneration ? 'scope-mismatch' : 'generation-changed'); }
  const sandboxed = resolveSandboxRuntimeStatus({ cfg, sessionKey: requester.sessionKey }).sandboxed;
  const checker = createSessionVisibilityRowChecker({ action: query.target ? 'status' : 'list', requesterSessionKey: requester.sessionKey,
    visibility: resolveEffectiveSessionToolsVisibility({ cfg, sandboxed }), a2aPolicy: createAgentToAgentPolicy(cfg) });
  const candidates = Object.entries(store).filter(([key, entry]) => parseAgentSessionKey(key)
    && checker.check({ key, spawnedBy: entry.spawnedBy, parentSessionKey: entry.parentSessionKey }).allowed
    && (!query.workspace || entry.workspaceId === query.workspace.workspaceId)
    && (!query.target || key === query.target.sessionKey)).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  if (query.target && candidates.length === 0) return fail('unavailable', 'not-visible');
  const before = signature(identityRows(store));
  const basis = signature([before, candidates.map(([key]) => key), { ...query, cursor: undefined }]);
  let offset = 0;
  if (query.cursor) {
    try {
      const cursor = JSON.parse(Buffer.from(query.cursor, 'base64url').toString());
      if (!Array.isArray(cursor) || cursor.length !== 2 || cursor[0] !== basis || !Number.isSafeInteger(cursor[1]) || cursor[1] < 0 || cursor[1] > candidates.length) return fail('stale', 'scope-mismatch');
      offset = cursor[1];
    } catch { return fail('stale', 'scope-mismatch'); }
  }
  type TaskAccess = Awaited<ReturnType<typeof import('../../agents/execution-task-authority.js')['createExecutionTaskAccess']>>;
  const connections = new Map<string, { access: TaskAccess; store: TaskSystemStore | null } | { error: unknown }>();
  const page = emptySessionCollaborationPage(query, 'ready');
  const fields = new Set(query.fields);
  const search = query.search?.trim().toLocaleLowerCase();
  let index = offset;
  try {
    while (index < candidates.length && page.items.length < (query.limit ?? 20) && page.scanned < 100) {
      const [key, entry] = candidates[index++]; page.scanned++;
      const scope = sessionActivityOwnerScope(key, entry);
      let references: SessionActivityTaskReference[] | null = null;
      const row: SessionCollaborationRow = { sessionKey: key as SessionKey, label: boundedText(entry.label ?? entry.displayName ?? key, 160), status: 'unknown', detail: null,
        sources: { session: unread('sessions'), goal: unread('TaskSystem'), tasks: unread('TaskSystem'), run: unread('runtime'),
          actions: unread('session-task-effects/bash-processes'), origin: unread('sessions'), execution: unread('execution-domain') } };
      if (!scope) row.sources.session = unavailable('sessions', 'owner-missing', 'unknown');
      else {
        if (query.target) { try { normalizeAutonomySessionScope(query.target, scope); }
          catch { return fail('stale', query.target.sessionGeneration === scope.sessionGeneration ? 'scope-mismatch' : 'generation-changed'); } }
        if (query.workspace && scope.projectId !== query.workspace.projectId) return fail('unavailable', 'scope-mismatch');
        row.sources.session = { owner: 'sessions', state: 'ready', readAt: Date.now(), value: { scope, agentId: parseAgentSessionKey(key)!.agentId } };
        row.detail = { scope };
        if (fields.has('origin')) row.sources.origin = { owner: 'sessions', state: 'ready', value: { spawnedBy: entry.spawnedBy ?? null, parentSessionKey: entry.parentSessionKey ?? null }, readAt: Date.now() };
        const run = fields.has('run') || fields.has('actions') ? (await readSessionActivityRun(scope, entry, context)).source : row.sources.run;
        if (fields.has('run')) row.sources.run = run;
        if (fields.has('actions')) row.sources.actions = readActions(scope, run);
        if (fields.has('goal') || fields.has('tasks') || fields.has('execution') || search) {
          const root = entry.workspaceDir ?? entry.spawnedWorkspaceDir;
          try {
            if (!root) throw new Error('TASK_OWNER_MISSING');
            let connection = connections.get(root);
            if (!connection) {
              try {
                const [{ createExecutionTaskAccess }, { TaskSystemStore }] = await Promise.all([
                  import('../../agents/execution-task-authority.js'), import('../../../../shared/task-system/store.js'),
                ]);
                const access = createExecutionTaskAccess(root, undefined, true);
                connection = { access, store: existsSync(access.domain.database) ? new TaskSystemStore(access.domain, undefined, access, true) : null };
              } catch (error) { connection = { error }; }
              // A failed root is one unavailable source for this query, not a retry per row.
              connections.set(root, connection);
            }
            if ('error' in connection) throw connection.error;
            if (fields.has('execution')) row.sources.execution = { owner: 'execution-domain', state: 'ready', value: structuredClone(connection.access.basis), readAt: Date.now() };
            if (!connection.store) throw new Error('TASK_OWNER_MISSING');
            references = readSessionActivityTaskReferences(connection.store, scope).references;
            if (fields.has('tasks')) row.sources.tasks = { owner: 'TaskSystem', state: references.length ? 'ready' : 'empty', readAt: Date.now(),
              value: references.map(({ objective: _objective, ...reference }) => reference) };
            if (fields.has('goal')) {
              const text = references.length ? boundedText(references[0].objective, 512) : null;
              row.sources.goal = { owner: 'TaskSystem', state: text === null ? 'empty' : 'ready', readAt: Date.now(),
                value: text === null ? null : { text, truncated: text.length < references[0].objective.length } };
            }
          } catch (error) {
            const stale = error instanceof Error && /STALE|REPLACED/.test(error.message);
            const state = stale ? 'stale' : 'unavailable';
            if (fields.has('goal')) row.sources.goal = unavailable('TaskSystem', stale ? 'generation-changed' : 'owner-unavailable', state);
            if (fields.has('tasks')) row.sources.tasks = unavailable('TaskSystem', stale ? 'generation-changed' : 'owner-unavailable', state);
            if (fields.has('execution') && row.sources.execution.state !== 'ready') row.sources.execution = unavailable('execution-domain');
          }
        }
        if (row.sources.run.state === 'ready' || (row.sources.actions.state === 'ready' && row.sources.actions.value.length)) row.status = 'running';
        else if (row.sources.run.state === 'empty' && row.sources.actions.state === 'empty') row.status = 'idle';
      }
      if (search && ![row.label, key, ...references?.map(reference => reference.objective) ?? []].some(text => text.toLocaleLowerCase().includes(search))) {
        if (!references) page.unknownMatches++;
        continue;
      }
      page.items.push(row);
    }
    const after = await filterArchivedSessionStore(cfg, loadCombinedSessionStoreForGateway(cfg, { readOnly: true }).store);
    if (signature(identityRows(after)) !== before) return fail('stale', 'generation-changed');
    for (const connection of connections.values()) if ('access' in connection) connection.access.assertCurrent();
  } catch (error) {
    if (error instanceof Error && /STALE|REPLACED/.test(error.message)) return fail('stale', 'execution-changed');
    return fail('unavailable', 'owner-unavailable');
  } finally { for (const connection of connections.values()) if ('store' in connection) connection.store?.close(); }
  page.nextCursor = index < candidates.length ? Buffer.from(JSON.stringify([basis, index])).toString('base64url') : null;
  page.state = page.items.length ? 'ready' : page.unknownMatches ? 'unknown' : 'empty';
  page.capturedAt = Date.now();
  return page;
}
