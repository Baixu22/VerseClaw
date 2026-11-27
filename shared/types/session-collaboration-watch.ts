import { normalizeAutonomySessionScope, normalizeRunScope, type ScopedRunId } from './identity-scope.js';
import { parseSessionCollaborationQuery, validateSessionCollaborationPage, type SessionCollaborationPage, type SessionCollaborationQuery } from './session-collaboration.js';

export const SESSION_COLLABORATION_CONDITIONS = ['changed', 'run-terminal', 'task-receipt', 'blocking-changed', 'idle'] as const;
export type SessionCollaborationCondition = typeof SESSION_COLLABORATION_CONDITIONS[number];
export type SessionCollaborationWatch = {
  id: string;
  query: SessionCollaborationQuery;
  condition: SessionCollaborationCondition;
  cursor?: string;
  run?: ScopedRunId;
  timeoutMs?: number;
};
export type SessionCollaborationWatchEvent = {
  id: string;
  owner: 'runtime' | 'TaskSystem' | 'sessions';
  kind: 'run-terminal' | 'task-receipt' | 'blocking-changed' | 'changed' | 'idle';
  sequence?: number;
  status?: string;
  taskNodeId?: string;
  revision?: number;
  receiptId?: string;
};
export type SessionCollaborationWatchResult = {
  schemaVersion: 'SessionCollaborationWatch/v1';
  id: string;
  state: 'satisfied' | 'changed' | 'timeout' | 'cancelled' | 'stale' | 'unavailable' | 'unknown';
  cursor: string | null;
  page: SessionCollaborationPage;
  event: SessionCollaborationWatchEvent | null;
};

export function parseSessionCollaborationWatch(value: unknown): SessionCollaborationWatch {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Scoped collaboration watch required');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !['id', 'query', 'condition', 'cursor', 'run', 'timeoutMs'].includes(key))) throw new TypeError('Unexpected watch field');
  if (typeof input.id !== 'string' || !/^[A-Za-z0-9._:-]{1,160}$/.test(input.id)) throw new TypeError('Bounded watch ID required');
  const query = parseSessionCollaborationQuery(input.query);
  if (!query.target || query.limit !== 1 || query.cursor !== undefined) throw new TypeError('Watch requires one explicit target');
  if (!SESSION_COLLABORATION_CONDITIONS.includes(input.condition as SessionCollaborationCondition)) throw new TypeError('Known watch condition required');
  if (input.timeoutMs !== undefined && (!Number.isSafeInteger(input.timeoutMs) || Number(input.timeoutMs) < 0 || Number(input.timeoutMs) > 25_000)) throw new TypeError('Watch timeout must be 0..25000');
  if (input.cursor !== undefined && (typeof input.cursor !== 'string' || !input.cursor || input.cursor.length > 256)) throw new TypeError('Bounded watch cursor required');
  let run: ScopedRunId | undefined;
  if (input.run !== undefined) {
    run = normalizeRunScope(input.run);
    normalizeAutonomySessionScope({ ...run.scope, sessionGeneration: query.target.sessionGeneration }, query.target);
  }
  if (input.condition === 'run-terminal' && !run) throw new TypeError('Run-terminal requires the original ScopedRun');
  const fields = new Set(query.fields);
  for (const field of ['run', 'actions', 'tasks'] as const) if (!fields.has(field)) throw new TypeError('Watch requires run, actions and tasks');
  return { id: input.id, query, condition: input.condition as SessionCollaborationCondition,
    ...(run ? { run } : {}), ...(input.cursor === undefined ? {} : { cursor: input.cursor as string }),
    timeoutMs: input.timeoutMs === undefined ? 15_000 : input.timeoutMs as number };
}

export function validateSessionCollaborationWatch(request: SessionCollaborationWatch, value: unknown): SessionCollaborationWatchResult | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result = value as SessionCollaborationWatchResult;
  if (result.schemaVersion !== 'SessionCollaborationWatch/v1' || result.id !== request.id
    || !['satisfied', 'changed', 'timeout', 'cancelled', 'stale', 'unavailable', 'unknown'].includes(result.state)
    || (result.cursor !== null && (typeof result.cursor !== 'string' || result.cursor.length > 256))) return null;
  const page = validateSessionCollaborationPage(request.query, result.page);
  if (JSON.stringify(page) !== JSON.stringify(result.page)) return null;
  if (result.event !== null) {
    const event = result.event;
    if (!event || typeof event.id !== 'string' || !event.id || event.id.length > 512
      || !['runtime', 'TaskSystem', 'sessions'].includes(event.owner) || !SESSION_COLLABORATION_CONDITIONS.includes(event.kind)
      || !['satisfied', 'changed'].includes(result.state)
      || (event.sequence !== undefined && (!Number.isSafeInteger(event.sequence) || event.sequence < 0))) return null;
    if (event.kind !== request.condition && request.condition !== 'changed') return null;
  } else if (['satisfied', 'changed'].includes(result.state)) return null;
  return { ...result, page };
}
