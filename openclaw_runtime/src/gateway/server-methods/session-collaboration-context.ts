import { existsSync } from 'node:fs';
import { parseSessionCollaborationQuery } from '../../../../shared/types/session-collaboration.js';
import type { SessionCollaborationTaskContext } from '../../../../shared/types/session-collaboration-context.js';
import type { TaskEvidence } from '../../../../shared/task-system/types.js';
import { readSessionCollaborationQuery } from './session-collaboration-query.js';
import { loadSessionEntry } from '../session-utils.js';
import type { GatewayRequestContext } from './types.js';

export async function readSessionCollaborationTaskContext(value: unknown, context: GatewayRequestContext): Promise<SessionCollaborationTaskContext> {
  const query = parseSessionCollaborationQuery(value);
  if (!query.target || query.limit !== 1) throw new TypeError('One scoped context target required');
  const result: SessionCollaborationTaskContext = { schemaVersion: 'SessionCollaborationTaskContext/v1', scope: query.target,
    state: 'unknown', task: null, context: null, evidence: [], legacy: { state: 'unavailable', reason: 'association-not-verified' }, capturedAt: Date.now() };
  const visible = await readSessionCollaborationQuery(query, context);
  if (visible.state !== 'ready') return { ...result, state: visible.state === 'empty' ? 'unknown' : visible.state, reason: visible.reason };
  const entry = loadSessionEntry(query.target.sessionKey, { readOnly: true, skipCache: true }).entry;
  const root = entry?.workspaceDir ?? entry?.spawnedWorkspaceDir;
  if (!root) return { ...result, state: 'unavailable', reason: 'owner-missing' };
  try {
    const [{ createExecutionTaskAccess }, { TaskSystemStore }] = await Promise.all([
      import('../../agents/execution-task-authority.js'), import('../../../../shared/task-system/store.js'),
    ]);
    const access = createExecutionTaskAccess(root, undefined, true);
    if (!existsSync(access.domain.database)) return { ...result, state: 'unavailable', reason: 'owner-missing' };
    const store = new TaskSystemStore(access.domain, undefined, access, true);
    try {
      const task = store.sessionSnapshot(query.target.sessionKey, query.target.sessionGeneration).task;
      result.task = task; result.state = task ? 'ready' : 'empty';
      if (task) {
        result.context = store.context(query.target.sessionKey, query.target.sessionGeneration);
        result.evidence = store.history(task.contract.taskNodeId, 0, 50, 'desc').filter(event => ['evidence', 'owner_verified'].includes(event.kind))
          .map(event => JSON.parse(event.json) as TaskEvidence).filter(receipt => receipt.revision === task.contract.revision);
      }
      access.assertCurrent();
    } finally { store.close(); }
    const after = loadSessionEntry(query.target.sessionKey, { readOnly: true, skipCache: true }).entry;
    if (after?.sessionId !== query.target.sessionGeneration || after.workspaceId !== query.target.workspaceId || (after.workspaceDir ?? after.spawnedWorkspaceDir) !== root)
      return { ...result, state: 'stale', task: null, context: null, evidence: [], reason: 'generation-changed' };
    result.capturedAt = Date.now(); return result;
  } catch (error) { return { ...result, state: 'unavailable', task: null, context: null, evidence: [], reason: error instanceof Error ? error.message : 'owner-unavailable' }; }
}
