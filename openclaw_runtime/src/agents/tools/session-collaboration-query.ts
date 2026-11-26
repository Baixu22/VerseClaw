import { callGateway } from '../../gateway/call.js';
import { loadSessionEntry } from '../../gateway/session-utils.js';
import { sessionActivityOwnerScope } from '../../gateway/server-methods/session-activity-read-model.js';
import { emptySessionCollaborationPage, parseSessionCollaborationQuery, validateSessionCollaborationPage,
  type SessionCollaborationPage, type SessionCollaborationQuery } from '../../../../shared/types/session-collaboration.js';
import { parseSessionActivityReadQuery } from '../../../../shared/types/session-activity.js';
import { emptyMaterialPage, parseSessionCollaborationMaterialQuery, validateMaterialPage } from '../../../../shared/types/session-collaboration-material.js';
import type { OpenClawConfig } from '../../config/types.openclaw.js';

export type SessionCollaborationToolContext = {
  agentSessionKey?: string;
  runSessionKey?: string;
  agentSessionId?: string;
  runId?: string;
  config?: OpenClawConfig;
  callGateway?: typeof callGateway;
};

export function readSessionCollaborationToolOwner(opts: SessionCollaborationToolContext | undefined) {
  const key = opts?.runSessionKey ?? opts?.agentSessionKey;
  const generation = opts?.agentSessionId;
  if (!key || !generation) throw new TypeError('Current run session identity required');
  const loaded = loadSessionEntry(key, { readOnly: true, skipCache: true });
  const owner = sessionActivityOwnerScope(loaded.canonicalKey, loaded.entry);
  if (!owner || loaded.canonicalKey !== key || loaded.legacyKey) throw new TypeError('Current session owner unavailable');
  return { owner, generation, root: loaded.entry?.workspaceDir ?? loaded.entry?.spawnedWorkspaceDir };
}

export async function querySessionCollaborationMaterialsTool(opts: SessionCollaborationToolContext | undefined, value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.hasOwn(value, 'requester'))
    throw new TypeError('Material search expects filters and the current run identity');
  const { owner, generation } = readSessionCollaborationToolOwner(opts);
  const query = parseSessionCollaborationMaterialQuery({ ...value, requester: { ...owner, sessionGeneration: generation } });
  if (owner.sessionGeneration !== generation) return emptyMaterialPage(query, 'stale', 'generation-changed');
  try {
    const result = await (opts?.callGateway ?? callGateway)<{ materials: unknown }>({
      method: 'session.activitySnapshot', params: { materials: query }, ...(opts?.config ? { config: opts.config } : {}),
    });
    return validateMaterialPage(query, result?.materials);
  } catch { return emptyMaterialPage(query, 'unavailable', 'owner-unavailable'); }
}

/** The current run supplies requester identity; model arguments only select the target/view. */
export async function querySessionCollaborationTool(opts: SessionCollaborationToolContext | undefined,
  params: Record<string, unknown>, detail = false): Promise<SessionCollaborationPage> {
  if (params.requester !== undefined || params.owner !== undefined || params.sandboxed !== undefined)
    throw new TypeError('Requester identity is owned by the current run');
  if (detail && params.model !== undefined) throw new TypeError('readOnly status cannot change a model');
  const fields = detail ? ['readOnly', 'scope', 'sessionKey', 'fields'] : ['collaboration', 'workspace', 'search', 'limit', 'cursor', 'fields'];
  if (Object.keys(params).some(field => !fields.includes(field))) throw new TypeError('Unexpected collaboration tool parameter');
  const { owner, generation } = readSessionCollaborationToolOwner(opts);
  const query: SessionCollaborationQuery = { requester: { ...owner, sessionGeneration: generation },
    ...(params.workspace === undefined ? {} : { workspace: params.workspace as SessionCollaborationQuery['workspace'] }),
    ...(params.search === undefined ? {} : { search: params.search as string }),
    ...(params.limit === undefined ? {} : { limit: params.limit as number }),
    ...(params.cursor === undefined ? {} : { cursor: params.cursor as string }),
    ...(params.fields === undefined ? {} : { fields: params.fields as SessionCollaborationQuery['fields'] }) };
  if (detail) {
    const target = params.scope === undefined ? owner : parseSessionActivityReadQuery({ scope: params.scope }).scope;
    if (params.sessionKey !== undefined && params.sessionKey !== 'current' && params.sessionKey !== target.sessionKey)
      throw new TypeError('Scoped target must match sessionKey');
    query.target = target;
    query.limit = 1;
  }
  const request = parseSessionCollaborationQuery(query);
  if (owner.sessionGeneration !== generation) return emptySessionCollaborationPage(request, 'stale', 'generation-changed');
  let result: { page: SessionCollaborationPage };
  try {
    result = await (opts?.callGateway ?? callGateway)<{ page: SessionCollaborationPage }>({
      method: 'session.activitySnapshot', params: { query: request }, ...(opts?.config ? { config: opts.config } : {}),
    });
  } catch { return emptySessionCollaborationPage(request, 'unavailable', 'owner-unavailable'); }
  return validateSessionCollaborationPage(request, result?.page);
}
