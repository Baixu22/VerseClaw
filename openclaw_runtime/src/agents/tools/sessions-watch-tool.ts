import { randomUUID } from 'node:crypto';
import { Type } from 'typebox';
import { callGateway } from '../../gateway/call.js';
import { parseSessionCollaborationQuery } from '../../../../shared/types/session-collaboration.js';
import { SESSION_COLLABORATION_CONDITIONS, parseSessionCollaborationWatch, validateSessionCollaborationWatch } from '../../../../shared/types/session-collaboration-watch.js';
import { querySessionCollaborationTool, type SessionCollaborationToolContext } from './session-collaboration-query.js';
import { jsonResult, type AnyAgentTool } from './common.js';

export function createSessionsWatchTool(opts?: SessionCollaborationToolContext): AnyAgentTool {
  return {
    name: 'sessions_watch', label: 'Session Watch', risk: 'readonly',
    description: 'Wait for an original scoped run terminal outcome, TaskSystem receipt, idle session or owner change. Reuse the returned cursor to avoid duplicate notifications. Does not send messages or call the target model.',
    parameters: Type.Object({ scope: Type.Unknown(), condition: Type.String({ enum: [...SESSION_COLLABORATION_CONDITIONS] }),
      run: Type.Optional(Type.Unknown()), cursor: Type.Optional(Type.String()), timeoutMs: Type.Optional(Type.Integer({ minimum: 0, maximum: 25_000 })) }),
    execute: async (_id, args, signal) => {
      const params = args as Record<string, unknown>;
      if (!params || Object.keys(params).some(key => !['scope', 'condition', 'run', 'cursor', 'timeoutMs'].includes(key))) throw new TypeError('Unexpected watch tool parameter');
      // Parse target and condition before reading the runtime-owned requester.
      const shape = parseSessionCollaborationWatch({ id: randomUUID(), condition: params.condition,
        query: parseSessionCollaborationQuery({ requester: params.scope, target: params.scope, limit: 1 }),
        ...(params.run === undefined ? {} : { run: params.run }), ...(params.cursor === undefined ? {} : { cursor: params.cursor }),
        ...(params.timeoutMs === undefined ? {} : { timeoutMs: params.timeoutMs }) });
      const page = await querySessionCollaborationTool(opts, { readOnly: true, scope: params.scope }, true);
      const request = parseSessionCollaborationWatch({ ...shape, query: { ...shape.query, requester: page.requester } });
      if (page.state !== 'ready') return jsonResult({ schemaVersion: 'SessionCollaborationWatch/v1', id: request.id,
        state: page.state === 'empty' ? 'unknown' : page.state, cursor: null, page, event: null });
      const gateway = opts?.callGateway ?? callGateway;
      const cancel = () => { void gateway({ method: 'session.activitySnapshot', params: { cancelWatch: { id: request.id, query: request.query } },
        ...(opts?.config ? { config: opts.config } : {}), timeoutMs: 5_000 }).catch(() => {}); };
      signal?.addEventListener('abort', cancel, { once: true });
      try {
        signal?.throwIfAborted();
        const result = await gateway<{ watch: unknown }>({ method: 'session.activitySnapshot', params: { watch: request },
          ...(opts?.config ? { config: opts.config } : {}), timeoutMs: request.timeoutMs! + 5_000, signal });
        const watch = validateSessionCollaborationWatch(request, result?.watch);
        if (!watch) throw new Error('COLLABORATION_WATCH_PROTOCOL_UNVERIFIED');
        return jsonResult(watch);
      } finally { signal?.removeEventListener('abort', cancel); }
    },
  };
}
