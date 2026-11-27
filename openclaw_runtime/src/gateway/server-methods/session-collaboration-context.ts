import { existsSync } from 'node:fs';
import { parseSessionCollaborationQuery } from '../../../../shared/types/session-collaboration.js';
import { emptyTaskContext, type SessionCollaborationTaskContext } from '../../../../shared/types/session-collaboration-context.js';
import { readSessionCollaborationQuery } from './session-collaboration-query.js';
import { loadSessionEntry } from '../session-utils.js';
import { sessionActivityOwnerScope } from './session-activity-read-model.js';
import { normalizeAutonomySessionScope } from '../../../../shared/types/identity-scope.js';
import type { GatewayRequestContext } from './types.js';
import { mayReadCollaborationSource } from './session-collaboration-material.js';

export async function readSessionCollaborationTaskContext(value: unknown, context: GatewayRequestContext): Promise<SessionCollaborationTaskContext> {
  const query = parseSessionCollaborationQuery(value);
  if (!query.target || query.limit !== 1) throw new TypeError('One scoped context target required');
  const result = emptyTaskContext(query.target, 'unknown');
  const visible = await readSessionCollaborationQuery(query, context);
  if (visible.state !== 'ready') return { ...result, state: visible.state === 'empty' ? 'unknown' : visible.state, reason: visible.reason };
  const entry = loadSessionEntry(query.target.sessionKey, { readOnly: true, skipCache: true }).entry;
  const root = entry?.workspaceDir ?? entry?.spawnedWorkspaceDir;
  if (!root) return { ...result, state: 'unavailable', reason: 'owner-missing' };
  try {
    const [{ createExecutionTaskAccess }, { TaskSystemStore }] = await Promise.all([
      import('../../agents/execution-task-authority.js'), import('../../../../shared/task-system/store.js'),
    ]);
    const assertCurrentScopes = () => {
      for (const expected of [query.requester, query.target!]) {
        const loaded = loadSessionEntry(expected.sessionKey, { readOnly: true, skipCache: true });
        const owner = sessionActivityOwnerScope(loaded.canonicalKey, loaded.entry);
        try { normalizeAutonomySessionScope(expected, loaded.legacyKey ? null : owner); }
        catch { throw new Error('CONTEXT_SESSION_STALE'); }
      }
    };
    assertCurrentScopes();
    if (!mayReadCollaborationSource(query.requester, query.target, context)) return emptyTaskContext(query.target, 'unavailable', 'not-visible');
    const access = createExecutionTaskAccess(root, undefined, true);
    if (!existsSync(access.domain.database)) return { ...result, state: 'unavailable', reason: 'owner-missing' };
    const store = new TaskSystemStore(access.domain, undefined, access, true);
    try {
      const snapshot = store.sessionContextSnapshot(query.target.sessionKey, query.target.sessionGeneration);
      Object.assign(result, snapshot, { state: snapshot.task ? 'ready' : 'empty' });
      access.assertCurrent();
    } finally { store.close(); }
    assertCurrentScopes();
    if (!mayReadCollaborationSource(query.requester, query.target, context)) return emptyTaskContext(query.target, 'unavailable', 'not-visible');
    const after = loadSessionEntry(query.target.sessionKey, { readOnly: true, skipCache: true }).entry;
    if (after?.sessionId !== query.target.sessionGeneration || after.workspaceId !== query.target.workspaceId || (after.workspaceDir ?? after.spawnedWorkspaceDir) !== root)
      return { ...result, state: 'stale', task: null, context: null, evidence: [], reason: 'generation-changed' };
    return result;
  } catch (error) {
    return error instanceof Error && error.message === 'CONTEXT_SESSION_STALE'
      ? emptyTaskContext(query.target, 'stale', 'generation-changed')
      : emptyTaskContext(query.target, 'unavailable', 'owner-unavailable');
  }
}
