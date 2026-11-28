import { normalizeAutonomySessionScope, normalizeRunScope, type AutonomySessionScope, type ScopedRunId, type TaskId } from './identity-scope.js';
import type { SessionActivityReadSource, SessionActivityReadReason } from './session-activity.js';
import { readObservedModelTokens, type ObservedModelTokens } from './usage.js';

export type CollaborationUsageObservation = {
  state: 'known' | 'unknown' | 'conflict';
  tokens: ObservedModelTokens | null;
  costUsd: number | null;
  priceVersion: string | null;
};

export type CollaborationUsageTotals = {
  calls: number;
  knownTokens: ObservedModelTokens | null;
  totalTokens: number | null;
  knownSubtotalUsd: number | null;
  totalUsd: number | null;
  unknownUsageCalls: number;
  unknownPriceCalls: number;
  conflicts: number;
  priceVersions: string[];
};

export function summarizeCollaborationUsage(records: readonly CollaborationUsageObservation[], orphanConflicts = 0, unresolved = 0): CollaborationUsageTotals {
  let knownTokens: ObservedModelTokens | null = null, knownSubtotalUsd: number | null = null;
  let unknownUsageCalls = orphanConflicts + unresolved, unknownPriceCalls = orphanConflicts + unresolved, conflicts = orphanConflicts;
  const priceVersions = new Set<string>();
  for (const record of records) {
    const tokens = record.state === 'known' ? record.tokens : null;
    if (tokens) {
      knownTokens ??= { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
      for (const key of ['input', 'output', 'cacheRead', 'cacheWrite', 'total'] as const) knownTokens[key] += tokens[key];
    } else unknownUsageCalls++;
    const cost = tokens ? record.costUsd : null;
    if (cost !== null) knownSubtotalUsd = (knownSubtotalUsd ?? 0) + cost;
    if (cost === null || !record.priceVersion) unknownPriceCalls++;
    else priceVersions.add(record.priceVersion);
    if (record.state === 'conflict') conflicts++;
  }
  return { calls: records.length, knownTokens, totalTokens: unknownUsageCalls === 0 ? knownTokens?.total ?? null : null,
    knownSubtotalUsd, totalUsd: unknownPriceCalls === 0 ? knownSubtotalUsd : null, unknownUsageCalls, unknownPriceCalls,
    conflicts, priceVersions: [...priceVersions].sort() };
}

export type SessionCollaborationUsageQuery = { requester: AutonomySessionScope; target: AutonomySessionScope };
export type SessionCollaborationUsageCall = CollaborationUsageObservation & {
  id: string;
  run: ScopedRunId;
  attemptIndex: number | null;
  provider: string;
  model: string;
  category: 'task' | 'coordination';
  startedAt: number;
};
type TaskTotals = { totals: CollaborationUsageTotals; coordination: CollaborationUsageTotals };
export const COLLABORATION_TASK_PHASES = ['queue', 'execution', 'verification', 'recovery'] as const;
export type CollaborationTaskPhaseDurations = Record<(typeof COLLABORATION_TASK_PHASES)[number], number | null>;
export type SessionCollaborationUsage = SessionCollaborationUsageQuery & {
  schemaVersion: 'SessionCollaborationUsage/v1';
  session: SessionActivityReadSource<CollaborationUsageTotals | null>;
  task: SessionActivityReadSource<(TaskTotals & { taskNodeId: TaskId; revision: number; digest: string; phaseDurations?: CollaborationTaskPhaseDurations }) | null>;
  run: SessionActivityReadSource<(TaskTotals & { run: ScopedRunId }) | null>;
  calls: SessionCollaborationUsageCall[];
};
export const COLLABORATION_USAGE_CALL_LIMIT = 24;

export function parseSessionCollaborationUsageQuery(value: unknown): SessionCollaborationUsageQuery {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => key !== 'requester' && key !== 'target')) throw new TypeError('Scoped usage query required');
  const { requester, target } = value as SessionCollaborationUsageQuery;
  return { requester: normalizeAutonomySessionScope(requester, requester), target: normalizeAutonomySessionScope(target, target) };
}

export function emptyCollaborationUsage(query: SessionCollaborationUsageQuery, state: 'unknown' | 'stale' | 'unavailable', reason: SessionActivityReadReason): SessionCollaborationUsage {
  const unavailable = (owner: string) => ({ owner, state, value: null, readAt: Date.now(), reason });
  return { schemaVersion: 'SessionCollaborationUsage/v1', ...query, session: unavailable('session-transcript'),
    task: unavailable('TaskSystem'), run: unavailable('TaskSystem'), calls: [] };
}

export function validateCollaborationUsage(query: SessionCollaborationUsageQuery, value: unknown): SessionCollaborationUsage {
  const invalid = () => emptyCollaborationUsage(query, 'unknown', 'protocol-unverified');
  if (!value || typeof value !== 'object') return invalid();
  const result = value as SessionCollaborationUsage;
  const count = (input: unknown): input is number => typeof input === 'number' && Number.isSafeInteger(input) && input >= 0;
  const amount = (input: unknown) => input === null || (typeof input === 'number' && Number.isFinite(input) && input >= 0);
  const totals = (data: CollaborationUsageTotals) => data && count(data.calls) &&
    (data.knownTokens === null || readObservedModelTokens(data.knownTokens)) && (data.totalTokens === null || count(data.totalTokens)) &&
    amount(data.knownSubtotalUsd) && amount(data.totalUsd) && count(data.unknownUsageCalls) && count(data.unknownPriceCalls) &&
    count(data.conflicts) && Array.isArray(data.priceVersions) && data.priceVersions.every(version => typeof version === 'string' && version.length <= 160);
  try {
    normalizeAutonomySessionScope(result.requester, query.requester);
    normalizeAutonomySessionScope(result.target, query.target);
    if (result.schemaVersion !== 'SessionCollaborationUsage/v1' || !Array.isArray(result.calls) ||
        result.calls.length > COLLABORATION_USAGE_CALL_LIMIT) return invalid();
    for (const [name, owner] of [['session', 'session-transcript'], ['task', 'TaskSystem'], ['run', 'TaskSystem']] as const) {
      const source = result[name];
      if (!source || source.owner !== owner || !['ready', 'empty', 'unknown', 'stale', 'unavailable'].includes(source.state) ||
          (source.state === 'ready' ? source.value === null : source.value !== null)) return invalid();
    }
    if (result.session.state === 'ready' && !totals(result.session.value!)) return invalid();
    if (result.task.state === 'ready') {
      const task = result.task.value!;
      if (typeof task.taskNodeId !== 'string' || !task.taskNodeId || !count(task.revision) ||
          !/^[a-f0-9]{64}$/.test(task.digest) || !totals(task.totals) || !totals(task.coordination)) return invalid();
      if (task.phaseDurations && COLLABORATION_TASK_PHASES.some(phase =>
        task.phaseDurations![phase] !== null && !count(task.phaseDurations![phase]))) return invalid();
    } else if (result.calls.length) return invalid();
    if (result.run.state === 'ready') {
      const run = result.run.value!;
      normalizeAutonomySessionScope({ ...normalizeRunScope(run.run).scope, sessionGeneration: query.target.sessionGeneration }, query.target);
      if (!totals(run.totals) || !totals(run.coordination)) return invalid();
    }
    const seen = new Set<string>();
    for (const call of result.calls) {
      normalizeAutonomySessionScope({ ...normalizeRunScope(call.run).scope, sessionGeneration: query.target.sessionGeneration }, query.target);
      if (typeof call.id !== 'string' || !call.id || seen.has(call.id) ||
          !['known', 'unknown', 'conflict'].includes(call.state) || !['task', 'coordination'].includes(call.category) ||
          (call.attemptIndex !== null && !count(call.attemptIndex)) ||
          (call.tokens !== null && !readObservedModelTokens(call.tokens)) || !amount(call.costUsd) ||
          typeof call.provider !== 'string' || typeof call.model !== 'string' || !count(call.startedAt)) return invalid();
      seen.add(call.id);
    }
  } catch { return invalid(); }
  return result;
}
