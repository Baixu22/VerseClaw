import { watch, type FSWatcher } from 'node:fs';
import { basename, dirname } from 'node:path';
import { waitForSessionCollaboration, type SessionCollaborationObservation } from '../../../../shared/session-collaboration-watch.js';
import { emptySessionCollaborationPage, parseSessionCollaborationQuery } from '../../../../shared/types/session-collaboration.js';
import { parseSessionCollaborationWatch, type SessionCollaborationWatch, type SessionCollaborationWatchEvent, type SessionCollaborationWatchResult } from '../../../../shared/types/session-collaboration-watch.js';
import { normalizeAutonomySessionScope } from '../../../../shared/types/identity-scope.js';
import { loadSessionEntry } from '../session-utils.js';
import { resolveSqliteSessionStoreDatabasePath } from '../../config/sessions/store-sqlite.js';
import { onAgentEvent } from '../../infra/agent-events.js';
import { readScopedAgentRunOutcome, waitForAgentJob } from './agent-job.js';
import { readSessionCollaborationQuery } from './session-collaboration-query.js';
import { sessionActivityOwnerScope } from './session-activity-read-model.js';
import type { GatewayRequestContext } from './types.js';

type Waiting = { owner: string; request: SessionCollaborationWatch; controller: AbortController };
const waits = new WeakMap<GatewayRequestContext, Map<string, Waiting>>();
const scopeKey = (request: SessionCollaborationWatch) => JSON.stringify([request.query.requester, request.query.target]);

async function observation(request: SessionCollaborationWatch, context: GatewayRequestContext): Promise<SessionCollaborationObservation> {
  const page = await readSessionCollaborationQuery(request.query, context);
  const result: SessionCollaborationObservation = { page, receipts: [] };
  if (page.state !== 'ready') return result;
  const row = page.items[0], target = request.query.target!;
  const loaded = loadSessionEntry(target.sessionKey, { readOnly: true, skipCache: true });
  normalizeAutonomySessionScope(target, sessionActivityOwnerScope(loaded.canonicalKey, loaded.entry));
  if (request.run) {
    const terminal = readScopedAgentRunOutcome(request.run.runId, target.sessionKey, target.sessionGeneration);
    if (terminal) result.terminal = { id: `runtime:${terminal.runId}:${terminal.ts}`, owner: 'runtime', kind: 'run-terminal', status: terminal.status };
  }
  const reference = row.sources.tasks.state === 'ready' ? row.sources.tasks.value[0] : undefined;
  const root = loaded.entry?.workspaceDir ?? loaded.entry?.spawnedWorkspaceDir;
  if (reference && root && request.condition === 'task-receipt') {
    const [{ createExecutionTaskAccess }, { TaskSystemStore }] = await Promise.all([
      import('../../agents/execution-task-authority.js'), import('../../../../shared/task-system/store.js'),
    ]);
    const access = createExecutionTaskAccess(root, undefined, true);
    const store = new TaskSystemStore(access.domain, undefined, access, true);
    try {
      if (access.domain.id !== reference.authorityId) throw new Error('TASK_AUTHORITY_STALE');
      const events = store.history(reference.taskNodeId, 0, 100, 'desc');
      result.receiptFloor = events.at(-1)?.seq; result.receiptTruncated = events.length === 100;
      result.receipts = events.flatMap(event => {
        if (!['evidence', 'owner_verified', 'accepted'].includes(event.kind)) return [];
        const payload = JSON.parse(event.json) as { revision?: number; receiptId?: string };
        if (payload.revision !== reference.revision) return [];
        return [{ id: `TaskSystem:${reference.authorityId}:${reference.taskNodeId}:${event.seq}`, owner: 'TaskSystem', kind: 'task-receipt',
          sequence: event.seq, status: event.kind, taskNodeId: reference.taskNodeId, revision: payload.revision,
          ...(payload.receiptId ? { receiptId: payload.receiptId } : {}) } satisfies SessionCollaborationWatchEvent];
      });
      access.assertCurrent();
    } finally { store.close(); }
  }
  const after = loadSessionEntry(target.sessionKey, { readOnly: true, skipCache: true });
  if (after.entry?.sessionId !== loaded.entry?.sessionId || after.entry?.workspaceId !== loaded.entry?.workspaceId
    || (after.entry?.workspaceDir ?? after.entry?.spawnedWorkspaceDir) !== root)
    result.page = emptySessionCollaborationPage(request.query, 'stale', 'generation-changed');
  return result;
}

async function subscriptionPaths(request: SessionCollaborationWatch) {
  const paths = new Set<string>();
  for (const scope of [request.query.requester, request.query.target!]) {
    const loaded = loadSessionEntry(scope.sessionKey, { readOnly: true, skipCache: true });
    paths.add(resolveSqliteSessionStoreDatabasePath(loaded.storePath));
    if (scope === request.query.target && ['changed', 'task-receipt', 'blocking-changed'].includes(request.condition)) {
      const root = loaded.entry?.workspaceDir ?? loaded.entry?.spawnedWorkspaceDir;
      if (root) {
        try { const { createExecutionTaskAccess } = await import('../../agents/execution-task-authority.js'); paths.add(createExecutionTaskAccess(root, undefined, true).domain.database); }
        catch { /* The next owner read returns the unavailable source. */ }
      }
    }
  }
  return paths;
}

export async function watchSessionCollaboration(input: unknown, context: GatewayRequestContext, owner: string): Promise<SessionCollaborationWatchResult> {
  const request = parseSessionCollaborationWatch(input);
  let active = waits.get(context);
  if (!active) { active = new Map(); waits.set(context, active); }
  if (active.has(request.id) || active.size >= 128) throw new Error('COLLABORATION_WATCH_CAPACITY_OR_DUPLICATE');
  const controller = new AbortController();
  active.set(request.id, { owner, request, controller });
  let prepare: (() => Promise<SessionCollaborationObservation>) | undefined;
  try {
    return await waitForSessionCollaboration(request, {
      signal: controller.signal,
      read: () => prepare ? prepare() : observation(request, context),
      subscribe: wake => {
        if (request.timeoutMs === 0) return () => {};
        const target = request.query.target!, files: FSWatcher[] = [];
        const job = new AbortController();
        let unsubscribe: (() => void) | undefined;
        prepare = async () => {
          prepare = undefined;
          const page = await readSessionCollaborationQuery(request.query, context);
          if (job.signal.aborted || page.state !== 'ready') return { page };
          const paths = await subscriptionPaths(request);
          if (job.signal.aborted) return { page };
          unsubscribe = onAgentEvent(event => {
            if (event.stream === 'lifecycle' && event.sessionKey === target.sessionKey && event.sessionId === target.sessionGeneration) wake();
          });
          for (const path of paths) {
            try {
              const file = basename(path);
              const watcher = watch(dirname(path), (_event, name) => { if (name && [file, `${file}-wal`, `${file}-shm`].includes(String(name))) wake(); });
              watcher.on('error', wake); files.push(watcher);
            } catch { /* Missing files are source facts, not successful notifications. */ }
          }
          if (request.run) void waitForAgentJob({ runId: request.run.runId, timeoutMs: request.timeoutMs!, signal: job.signal }).then(value => { if (value && !job.signal.aborted) wake(); });
          return observation(request, context);
        };
        return () => { job.abort(); unsubscribe?.(); for (const file of files) file.close(); };
      },
    });
  } finally { active.delete(request.id); }
}

export function cancelSessionCollaborationWatch(input: unknown, context: GatewayRequestContext, owner: string) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Scoped watch cancellation required');
  const value = input as { id?: unknown; query?: unknown };
  if (Object.keys(value).some(key => !['id', 'query'].includes(key))) throw new TypeError('Unexpected watch cancellation field');
  if (typeof value.id !== 'string') throw new TypeError('Watch ID required');
  const query = parseSessionCollaborationQuery(value.query);
  const entry = waits.get(context)?.get(value.id);
  if (!entry || entry.owner !== owner || scopeKey(entry.request) !== JSON.stringify([query.requester, query.target])) return { cancelled: false };
  entry.controller.abort();
  return { cancelled: true };
}
