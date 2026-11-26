import { normalizeAutonomySessionScope, normalizeRunScope, type ScopedRunId } from './identity-scope.js';
import { parseSessionCollaborationQuery, validateSessionCollaborationPage, type SessionCollaborationPage, type SessionCollaborationQuery } from './session-collaboration.js';
import { equalMaterialRef, MATERIAL_STATES, parseMaterialReference, type SessionCollaborationMaterialRef,
  type SessionCollaborationMaterialState } from './session-collaboration-material.js';

export const SESSION_COLLABORATION_CONDITIONS = ['changed', 'run-terminal', 'task-receipt', 'blocking-changed', 'idle', 'material-changed'] as const;
export type SessionCollaborationCondition = typeof SESSION_COLLABORATION_CONDITIONS[number];
export type SessionCollaborationWatch = {
  id: string;
  query: SessionCollaborationQuery;
  condition: SessionCollaborationCondition;
  cursor?: string;
  run?: ScopedRunId;
  materialRef?: SessionCollaborationMaterialRef;
  observedMaterialState?: SessionCollaborationMaterialState;
  timeoutMs?: number;
};
export type SessionCollaborationWatchEvent = {
  id: string;
  owner: 'runtime' | 'TaskSystem' | 'sessions';
  kind: SessionCollaborationCondition;
  sequence?: number;
  status?: string;
  taskNodeId?: string;
  revision?: number;
  receiptId?: string;
  materialRef?: SessionCollaborationMaterialRef;
  materialState?: SessionCollaborationMaterialState;
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
  if (Object.keys(input).some(key => !['id', 'query', 'condition', 'cursor', 'run', 'timeoutMs', 'materialRef', 'observedMaterialState'].includes(key))) throw new TypeError('Unexpected watch field');
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
  let material: Pick<SessionCollaborationWatch, 'materialRef' | 'observedMaterialState'> = {};
  if (input.condition === 'material-changed') {
    const materialRef = parseMaterialReference(input.materialRef);
    const observed = input.observedMaterialState as SessionCollaborationMaterialState | undefined;
    if (run || (observed !== undefined && !MATERIAL_STATES.includes(observed))) throw new TypeError('Invalid observed material state');
    material = { materialRef, ...(observed === undefined ? {} : { observedMaterialState: observed }) };
  } else if (input.materialRef !== undefined || input.observedMaterialState !== undefined) throw new TypeError('Material watch condition required');
  const fields = new Set(query.fields);
  for (const field of ['run', 'actions', 'tasks'] as const) if (!fields.has(field)) throw new TypeError('Watch requires run, actions and tasks');
  return { id: input.id, query, condition: input.condition as SessionCollaborationCondition, ...material,
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
    if (event.kind === 'material-changed') {
      if (event.owner !== 'TaskSystem' || !request.materialRef || !event.materialRef || !event.materialState ||
          !MATERIAL_STATES.includes(event.materialState)) return null;
      try { if (!equalMaterialRef(request.materialRef, parseMaterialReference(event.materialRef))) return null; }
      catch { return null; }
    }
  } else if (['satisfied', 'changed'].includes(result.state)) return null;
  return { ...result, page };
}
