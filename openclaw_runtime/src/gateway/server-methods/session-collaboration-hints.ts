import { existsSync } from 'node:fs';
import { emptyCollaborationHints, parseCollaborationHintsQuery } from '../../../../shared/types/session-collaboration-hints.js';
import { parseAgentSessionKey } from '../../routing/session-key.js';
import { sessionAdmissionRegistry } from '../../sessions/session-admission-registry.js';
import { loadSessionEntry } from '../session-utils.js';
import { mayReadCollaborationSource } from './session-collaboration-material.js';
import { readSessionCollaborationQuery } from './session-collaboration-query.js';
import type { GatewayRequestContext } from './types.js';

export async function readSessionCollaborationHints(value: unknown, context: GatewayRequestContext) {
  const query = parseCollaborationHintsQuery(value);
  const visible = await readSessionCollaborationQuery({ ...query, fields: [] }, context);
  if (visible.state !== 'ready') return emptyCollaborationHints(query, visible.state, visible.reason);
  try {
    const [{ createExecutionTaskAccess }, { TaskSystemStore }] = await Promise.all([
      import('../../agents/execution-task-authority.js'), import('../../../../shared/task-system/store.js'),
    ]);
    if (!mayReadCollaborationSource(query.requester, query.target, context)) return emptyCollaborationHints(query, 'unavailable', 'not-visible');
    const entry = loadSessionEntry(query.target.sessionKey, { readOnly: true, skipCache: true }).entry;
    const root = entry?.workspaceDir ?? entry?.spawnedWorkspaceDir;
    if (!root) return emptyCollaborationHints(query, 'unavailable', 'owner-missing');
    const access = createExecutionTaskAccess(root, undefined, true);
    const page = emptyCollaborationHints(query, 'ready');
    const reader = loadSessionEntry(query.requester.sessionKey, { readOnly: true, skipCache: true }).entry;
    const readerRoot = reader?.workspaceDir ?? reader?.spawnedWorkspaceDir;
    const sameWorkspace = query.requester.workspaceId === query.target.workspaceId && query.requester.projectId === query.target.projectId;
    const readerAccess = sameWorkspace && readerRoot ? createExecutionTaskAccess(readerRoot, undefined, true) : null;
    if (existsSync(access.domain.database)) {
      const store = new TaskSystemStore(access.domain, undefined, access, true);
      try {
        page.task = store.sessionCoordinationSnapshot(query.target.sessionKey, query.target.sessionGeneration,
          readerAccess?.domain.id === access.domain.id && readerAccess.domain.database === access.domain.database
            ? { sessionKey: query.requester.sessionKey, generation: query.requester.sessionGeneration } : undefined);
        page.taskReadState = page.task ? 'ready' : 'empty';
      } finally { store.close(); }
    } else page.reason = 'task-owner-missing';
    const agentId = parseAgentSessionKey(query.target.sessionKey)?.agentId;
    if (agentId) {
      const admission = sessionAdmissionRegistry.snapshot({ agentId, canonicalSessionKey: query.target.sessionKey,
        expectedSessionId: query.target.sessionGeneration });
      page.admission = { owner: 'SessionAdmissionRegistry', active: admission?.active ?? 0,
        waiters: admission?.waiters ?? 0, fenced: admission?.fenced ?? false };
    }
    access.assertCurrent();
    readerAccess?.assertCurrent();
    if (!mayReadCollaborationSource(query.requester, query.target, context)) return emptyCollaborationHints(query, 'unavailable', 'not-visible');
    const after = loadSessionEntry(query.target.sessionKey, { readOnly: true, skipCache: true }).entry;
    if ((after?.workspaceDir ?? after?.spawnedWorkspaceDir) !== root) return emptyCollaborationHints(query, 'stale', 'execution-changed');
    const readerAfter = loadSessionEntry(query.requester.sessionKey, { readOnly: true, skipCache: true }).entry;
    if ((readerAfter?.workspaceDir ?? readerAfter?.spawnedWorkspaceDir) !== readerRoot) return emptyCollaborationHints(query, 'stale', 'execution-changed');
    page.state = page.task || page.admission ? 'ready' : page.reason ? 'unknown' : 'empty';
    return page;
  } catch (error) {
    return emptyCollaborationHints(query, error instanceof Error && /STALE|REPLACED/.test(error.message) ? 'stale' : 'unavailable', 'owner-unavailable');
  }
}
