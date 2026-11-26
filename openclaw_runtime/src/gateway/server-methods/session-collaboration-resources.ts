import { normalizeAutonomySessionScope } from '../../../../shared/types/identity-scope.js';
import {
  emptyCollaborationResources, parseSessionCollaborationResourceQuery, type SessionCollaborationResources,
} from '../../../../shared/types/session-collaboration-resources.js';
import { parseAgentSessionKey } from '../../routing/session-key.js';
import { loadSessionEntry } from '../session-utils.js';
import { readRuntimeSessionResourceInventory } from '../session-resource-inventory.js';
import { sessionActivityOwnerScope } from './session-activity-read-model.js';
import { readSessionCollaborationQuery } from './session-collaboration-query.js';
import type { GatewayRequestContext } from './types.js';

export async function readSessionCollaborationResources(input: unknown, context: GatewayRequestContext): Promise<SessionCollaborationResources> {
  const query = parseSessionCollaborationResourceQuery(input);
  const { target } = query;
  const visibility = { ...query, fields: [], limit: 1 };
  const visible = await readSessionCollaborationQuery(visibility, context);
  if (visible.state !== 'ready') return emptyCollaborationResources(query, visible.state === 'empty' ? 'unavailable' : visible.state, visible.reason ?? 'not-visible');
  const readSession = () => {
    const loaded = loadSessionEntry(target.sessionKey, { skipCache: true, readOnly: true });
    if (!loaded.entry || loaded.legacyKey || loaded.canonicalKey !== target.sessionKey) throw new Error('RESOURCE_SESSION_STALE');
    normalizeAutonomySessionScope(target, sessionActivityOwnerScope(loaded.canonicalKey, loaded.entry));
    return loaded.entry;
  };
  try {
    const before = readSession();
    const rootPath = before.workspaceDir ?? before.spawnedWorkspaceDir ?? null;
    const agentId = parseAgentSessionKey(target.sessionKey)?.agentId;
    if (!agentId) return emptyCollaborationResources(query, 'unavailable', 'scope-mismatch');
    let inventory;
    try {
      inventory = await readRuntimeSessionResourceInventory({ scopedRead: true, rootPath, agentId,
        sessionKey: target.sessionKey, workspaceId: target.workspaceId, expectedSessionId: target.sessionGeneration });
    } catch { return emptyCollaborationResources(query, 'unavailable', 'owner-unavailable'); }
    const after = readSession();
    if ((after.workspaceDir ?? after.spawnedWorkspaceDir ?? null) !== rootPath)
      return emptyCollaborationResources(query, 'stale', 'execution-changed');
    return { ...query, schemaVersion: 'SessionCollaborationResources/v1', state: 'ready',
      inventory: { ...inventory, owners: inventory.owners.map(owner => ({ ...owner, observationScope: 'session',
        sampledAt: owner.sampledAt ?? Date.parse(inventory.capturedAt) })) } };
  } catch { return emptyCollaborationResources(query, 'stale', 'generation-changed'); }
}
