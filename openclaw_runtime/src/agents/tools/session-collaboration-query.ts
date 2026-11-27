import { callGateway } from '../../gateway/call.js';
import { loadSessionEntry } from '../../gateway/session-utils.js';
import { sessionActivityOwnerScope } from '../../gateway/server-methods/session-activity-read-model.js';
import { emptySessionCollaborationPage, parseSessionCollaborationQuery, validateSessionCollaborationPage,
  type SessionCollaborationPage, type SessionCollaborationQuery } from '../../../../shared/types/session-collaboration.js';
import { parseSessionActivityReadQuery } from '../../../../shared/types/session-activity.js';
import type { OpenClawConfig } from '../../config/types.openclaw.js';

export type SessionCollaborationToolContext = {
  agentSessionKey?: string;
  runSessionKey?: string;
  agentSessionId?: string;
  config?: OpenClawConfig;
  callGateway?: typeof callGateway;
};

/** The current run supplies requester identity; model arguments only select the target/view. */
export async function querySessionCollaborationTool(opts: SessionCollaborationToolContext | undefined,
  params: Record<string, unknown>, detail = false): Promise<SessionCollaborationPage> {
  if (params.requester !== undefined || params.owner !== undefined || params.sandboxed !== undefined)
    throw new TypeError('Requester identity is owned by the current run');
  if (detail && params.model !== undefined) throw new TypeError('readOnly status cannot change a model');
  const fields = detail ? ['readOnly', 'scope', 'sessionKey', 'fields'] : ['collaboration', 'workspace', 'search', 'limit', 'cursor', 'fields'];
  if (Object.keys(params).some(field => !fields.includes(field))) throw new TypeError('Unexpected collaboration tool parameter');
  const key = opts?.runSessionKey ?? opts?.agentSessionKey;
  if (!key || !opts?.agentSessionId) throw new TypeError('Current run session identity required');
  const loaded = loadSessionEntry(key, { readOnly: true, skipCache: true });
  const owner = sessionActivityOwnerScope(loaded.canonicalKey, loaded.entry);
  if (!owner || loaded.canonicalKey !== key || loaded.legacyKey) throw new TypeError('Current session owner unavailable');
  const query: SessionCollaborationQuery = { requester: { ...owner, sessionGeneration: opts.agentSessionId },
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
  if (owner.sessionGeneration !== opts.agentSessionId) return emptySessionCollaborationPage(request, 'stale', 'generation-changed');
  let result: { page: SessionCollaborationPage };
  try {
    result = await (opts.callGateway ?? callGateway)<{ page: SessionCollaborationPage }>({
      method: 'session.activitySnapshot', params: { query: request }, ...(opts.config ? { config: opts.config } : {}),
    });
  } catch { return emptySessionCollaborationPage(request, 'unavailable', 'owner-unavailable'); }
  return validateSessionCollaborationPage(request, result?.page);
}
