import { existsSync } from 'node:fs';
import { normalizeAutonomySessionScope } from '../../../../shared/types/identity-scope.js';
import type { AutonomySessionScope, ScopedRunId } from '../../../../shared/types/identity-scope.js';
import { projectTaskTraceCosts, projectTaskTracePhases, type TaskTraceCostRecord } from '../../../../shared/task-system/trace.js';
import {
  COLLABORATION_USAGE_CALL_LIMIT, emptyCollaborationUsage, parseSessionCollaborationUsageQuery, summarizeCollaborationUsage,
  type CollaborationUsageObservation, type SessionCollaborationUsage, type SessionCollaborationUsageCall,
} from '../../../../shared/types/session-collaboration-usage.js';
import { resolveSessionFilePath, resolveSessionFilePathOptions } from '../../config/sessions/paths.js';
import { parseAgentSessionKey } from '../../routing/session-key.js';
import { loadSessionEntry } from '../session-utils.js';
import { readSessionActivityRun, readSessionActivityTaskReferences, sessionActivityOwnerScope } from './session-activity-read-model.js';
import { readSessionCollaborationQuery } from './session-collaboration-query.js';
import type { GatewayRequestContext } from './types.js';

const ready = <T>(owner: string, value: T) => ({ owner, state: 'ready' as const, value, readAt: Date.now() });
const empty = (owner: string) => ({ owner, state: 'empty' as const, value: null, readAt: Date.now() });
function currentSession(target: AutonomySessionScope) {
  const loaded = loadSessionEntry(target.sessionKey, { readOnly: true, skipCache: true });
  if (!loaded.entry || loaded.legacyKey || loaded.canonicalKey !== target.sessionKey)
    throw new Error('COLLABORATION_SESSION_STALE');
  normalizeAutonomySessionScope(target, sessionActivityOwnerScope(loaded.canonicalKey, loaded.entry));
  return loaded as typeof loaded & { entry: NonNullable<typeof loaded.entry> };
}

function usageObservation(record: TaskTraceCostRecord): CollaborationUsageObservation {
  return { state: record.state, tokens: record.usage?.usage ?? null, costUsd: record.usage?.costUsd ?? null,
    priceVersion: record.usage?.priceVersion ?? null };
}

function summarizeTrace(records: readonly TaskTraceCostRecord[], orphanConflicts = 0, unresolved = 0) {
  return {
    totals: summarizeCollaborationUsage(records.map(usageObservation), orphanConflicts, unresolved),
    coordination: summarizeCollaborationUsage(records.filter(record => record.call.category === 'coordination').map(usageObservation)),
  };
}

function verifiedCalls(records: readonly TaskTraceCostRecord[], target: AutonomySessionScope, activeRun: ScopedRunId | null) {
  return records.flatMap(record => {
    const run = record.run ?? (activeRun?.runId === record.call.runId ? activeRun : null);
    if (!run || record.call.credential.sessionKey !== target.sessionKey ||
        record.call.credential.generation !== target.sessionGeneration) return [];
    try { normalizeAutonomySessionScope({ ...run.scope, sessionGeneration: target.sessionGeneration }, target); }
    catch { return []; }
    return [{ ...record, run }];
  }).sort((left, right) => right.call.startedAt - left.call.startedAt);
}

function callView(record: TaskTraceCostRecord & { run: ScopedRunId }): SessionCollaborationUsageCall {
  const { call, run } = record;
  return { ...usageObservation(record), id: call.callId, run, provider: call.provider, model: call.model,
    attemptIndex: call.attemptIndex ?? null, category: call.category ?? 'task', startedAt: call.startedAt };
}

async function readTaskUsage(result: SessionCollaborationUsage, root: string | undefined, activeRun: ScopedRunId | null, idle: boolean) {
  if (!root) return;
  const [{ createExecutionTaskAccess }, { TaskSystemStore }] = await Promise.all([
    import('../../agents/execution-task-authority.js'), import('../../../../shared/task-system/store.js'),
  ]);
  const access = createExecutionTaskAccess(root, undefined, true);
  if (!existsSync(access.domain.database)) return;
  const store = new TaskSystemStore(access.domain, undefined, access, true);
  try {
    const { target } = result;
    const reference = readSessionActivityTaskReferences(store, target).references[0];
    if (!reference) {
      result.task = empty('TaskSystem');
      if (idle) result.run = empty('TaskSystem');
      return;
    }
    const trace = store.traceSnapshot(reference.taskNodeId);
    const current = readSessionActivityTaskReferences(store, target).references[0];
    if (trace.task.contract.revision !== reference.revision || trace.task.contract.digest !== reference.digest ||
        JSON.stringify(current) !== JSON.stringify(reference)) {
      result.task = { owner: 'TaskSystem', state: 'stale', readAt: Date.now(), value: null, reason: 'binding-changed' };
      return;
    }
    access.assertCurrent();
    const costs = projectTaskTraceCosts(trace);
    const phases = projectTaskTracePhases(trace.events);
    result.task = ready('TaskSystem', { ...summarizeTrace(costs.records, costs.orphanObservations),
      taskNodeId: reference.taskNodeId, revision: reference.revision, digest: reference.digest,
      phaseDurations: { queue: phases.queue.durationMs, execution: phases.execution.durationMs,
        verification: phases.verification.durationMs, recovery: phases.recovery.durationMs } });
    const calls = verifiedCalls(costs.records, target, activeRun);
    result.calls = calls.slice(0, COLLABORATION_USAGE_CALL_LIMIT).map(callView);
    const run = activeRun ?? (idle ? calls[0]?.run : null);
    if (run) {
      const matches = calls.filter(record => record.run.runId === run.runId);
      const reported = costs.records.filter(record => record.call.runId === run.runId &&
        record.call.credential.sessionKey === target.sessionKey && record.call.credential.generation === target.sessionGeneration);
      if (matches.length) result.run = ready('TaskSystem', { run, ...summarizeTrace(matches, 0, reported.length - matches.length) });
      else result.run = { owner: 'TaskSystem', state: 'unknown', readAt: Date.now(), value: null, reason: 'run-identity-missing' };
    } else {
      const observed = costs.records.some(record => record.call.credential.sessionKey === target.sessionKey &&
        record.call.credential.generation === target.sessionGeneration);
      result.run = idle && !observed ? empty('TaskSystem')
        : { owner: 'TaskSystem', state: 'unknown', readAt: Date.now(), value: null, reason: 'run-identity-missing' };
    }
    return access.assertCurrent;
  } finally { store.close(); }
}

export async function readSessionCollaborationUsage(input: unknown, context: GatewayRequestContext): Promise<SessionCollaborationUsage> {
  const query = parseSessionCollaborationUsageQuery(input);
  const { target } = query;
  const visibility = { ...query, limit: 1, fields: [] };
  const visible = await readSessionCollaborationQuery(visibility, context);
  if (visible.state !== 'ready') return emptyCollaborationUsage(query, visible.state === 'empty' ? 'unavailable' : visible.state, visible.reason ?? 'not-visible');
  const result = emptyCollaborationUsage(query, 'unavailable', 'owner-missing');
  try {
    const before = currentSession(target);
    const { entry } = before;
    const root = entry.workspaceDir ?? entry.spawnedWorkspaceDir;
    const agentId = parseAgentSessionKey(target.sessionKey)?.agentId;
    if (!agentId) return emptyCollaborationUsage(query, 'unavailable', 'scope-mismatch');
    const run = await readSessionActivityRun(target, entry, context);
    if (run.source.state === 'unavailable' && run.source.reason === 'scope-mismatch')
      return emptyCollaborationUsage(query, 'unavailable', 'scope-mismatch');
    const [, assertTaskOwner] = await Promise.all([
      (async () => {
        try {
          const { readCollaborationTranscriptUsage } = await import('../../infra/session-cost-usage.js');
          const filePath = resolveSessionFilePath(entry.sessionId, entry, resolveSessionFilePathOptions({ agentId, storePath: before.storePath }));
          const usage = await readCollaborationTranscriptUsage({ filePath, sessionGeneration: entry.sessionId,
            forkedFromLeafId: entry.forkedFromLeafId });
          result.session = usage.calls || usage.unknownUsageCalls ? ready('session-transcript', usage) : empty('session-transcript');
        } catch (error) {
          if (error instanceof Error && error.message === 'COLLABORATION_TRANSCRIPT_STALE')
            result.session = { owner: 'session-transcript', state: 'stale', readAt: Date.now(), value: null, reason: 'generation-changed' };
          else if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
            result.session = { owner: 'session-transcript', state: 'unavailable', readAt: Date.now(), value: null, reason: 'owner-unavailable' };
        }
      })(),
      readTaskUsage(result, root, run.source.value, run.source.state === 'empty').catch(() => {
        const failed = { owner: 'TaskSystem', state: 'unavailable' as const, readAt: Date.now(), value: null, reason: 'owner-unavailable' as const };
        result.task = failed;
        result.run = failed;
        result.calls = [];
      }),
    ]);
    const finalVisibility = await readSessionCollaborationQuery(visibility, context);
    if (finalVisibility.state !== 'ready') return emptyCollaborationUsage(query,
      finalVisibility.state === 'empty' ? 'unavailable' : finalVisibility.state, finalVisibility.reason ?? 'not-visible');
    const after = currentSession(target);
    if (after.storePath !== before.storePath || after.entry.sessionFile !== entry.sessionFile ||
        after.entry.forkedFromLeafId !== entry.forkedFromLeafId || (after.entry.workspaceDir ?? after.entry.spawnedWorkspaceDir) !== root)
      return emptyCollaborationUsage(query, 'stale', 'execution-changed');
    try { assertTaskOwner?.(); }
    catch {
      const stale = { owner: 'TaskSystem', state: 'stale' as const, readAt: Date.now(), value: null, reason: 'execution-changed' as const };
      result.task = stale;
      result.run = stale;
      result.calls = [];
    }
    return result;
  } catch { return emptyCollaborationUsage(query, 'stale', 'generation-changed'); }
}
