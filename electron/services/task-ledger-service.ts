import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  TaskLedgerEdge,
  TaskLedgerEvent,
  TaskLedgerEventInput,
  TaskLedgerNode,
  TaskLedgerSessionLink,
  TaskLedgerSnapshot,
  TaskLedgerWarning,
  TaskLedgerOperationIdentity,
  TaskLedgerOperationReceipt,
} from '../../shared/types/task-ledger';
import { getOpenClawConfigDir } from '../utils/paths';
import { withTaskLedgerJournalLock } from '../../shared/task-ledger-journal-lock';
import { parseTaskLedgerJournal as parseTaskLedgerLog, serializeTaskLedgerCommit, taskLedgerDigest as digest, type CommittedOperation } from '../../shared/task-ledger-journal';

const SCHEMA_VERSION = 1 as const;

export type TaskLedgerReadResult = {
  events: TaskLedgerEvent[];
  warnings: TaskLedgerWarning[];
};

function validation(message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code: 'VALIDATION' });
}

export function normalizeTaskLedgerWorkspaceId(workspaceId?: string | null): string {
  const raw = workspaceId?.trim() || 'default';
  const slug = raw
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 72);
  const hash = createHash('sha1').update(raw).digest('hex').slice(0, 10);
  return `${slug || 'workspace'}-${hash}`;
}

export function getTaskLedgerDir(workspaceId?: string | null): string {
  return getTaskLedgerDirForKey(normalizeTaskLedgerWorkspaceId(workspaceId));
}

function getTaskLedgerDirForKey(workspaceKey: string): string {
  return join(getOpenClawConfigDir(), 'task-ledgers', 'workspaces', workspaceKey);
}

export function getTaskLedgerEventsPath(workspaceId?: string | null): string {
  return join(getTaskLedgerDir(workspaceId), 'events.jsonl');
}

export function getTaskLedgerSnapshotPath(workspaceId?: string | null): string {
  return join(getTaskLedgerDir(workspaceId), 'snapshot.json');
}

function getTaskLedgerSnapshotPathForKey(workspaceKey: string): string {
  return join(getTaskLedgerDirForKey(workspaceKey), 'snapshot.json');
}

function nowIso(): string {
  return new Date().toISOString();
}

function clampProgress(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || Number.isNaN(value)) return undefined;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeNode(input: TaskLedgerNode, timestamp: string): TaskLedgerNode {
  const status = input.status ?? 'todo';
  return {
    ...input,
    parentId: input.parentId ?? null,
    status,
    tags: Array.isArray(input.tags) ? input.tags : [],
    progress: clampProgress(input.progress),
    createdAt: input.createdAt || timestamp,
    updatedAt: input.updatedAt || timestamp,
    completedAt: status === 'done' ? (input.completedAt ?? timestamp) : (input.completedAt ?? null),
  };
}

function normalizeEdge(input: TaskLedgerEdge, timestamp: string): TaskLedgerEdge {
  return {
    ...input,
    createdAt: input.createdAt || timestamp,
  };
}

export function createTaskLedgerEvent(
  workspaceId: string,
  input: TaskLedgerEventInput,
  batchIdempotencyKey?: string | null,
): TaskLedgerEvent {
  const createdAt = input.createdAt ?? nowIso();
  return {
    ...input,
    id: input.id ?? randomUUID(),
    workspaceId,
    createdAt,
    idempotencyKey: input.idempotencyKey ?? batchIdempotencyKey ?? null,
    taskId: input.taskId ?? input.payload.nodeId ?? input.payload.node?.id ?? null,
    sessionId: input.sessionId ?? null,
  };
}

async function readLogText(workspaceId?: string | null): Promise<string> {
  try {
    return await readFile(getTaskLedgerEventsPath(workspaceId), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw error;
  }
}

export async function readTaskLedgerEvents(workspaceId?: string | null): Promise<TaskLedgerReadResult> {
  return withTaskLedgerJournalLock(getTaskLedgerEventsPath(workspaceId), async () => parseTaskLedgerEventLog(await readLogText(workspaceId)));
}

export function parseTaskLedgerEventLog(raw: string): TaskLedgerReadResult {
  const { events, warnings } = parseTaskLedgerLog(raw);
  return { events, warnings };
}

function sortByUpdatedDesc(left: TaskLedgerNode, right: TaskLedgerNode): number {
  return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
}

export function projectTaskLedgerSnapshot(
  workspaceId: string,
  events: TaskLedgerEvent[],
  readWarnings: TaskLedgerWarning[] = [],
): TaskLedgerSnapshot {
  const nodes = new Map<string, TaskLedgerNode>();
  const edges = new Map<string, TaskLedgerEdge>();
  const sessionLinks = new Map<string, TaskLedgerSessionLink>();
  const warnings: TaskLedgerWarning[] = [...readWarnings];

  for (const event of events) {
    try {
      const timestamp = event.createdAt || nowIso();
      const nodeId = event.payload.nodeId ?? event.taskId ?? event.payload.node?.id;
      switch (event.type) {
        case 'node_created':
        case 'decision_recorded':
        case 'deviation_logged': {
          const node = event.payload.node;
          if (!node) break;
          nodes.set(node.id, normalizeNode(node, timestamp));
          break;
        }
        case 'node_updated': {
          if (!nodeId) break;
          const existing = nodes.get(nodeId);
          if (!existing) break;
          const patch = event.payload.patch ?? {};
          const status = patch.status ?? existing.status;
          nodes.set(nodeId, {
            ...existing,
            ...patch,
            id: existing.id,
            createdAt: existing.createdAt,
            status,
            progress: clampProgress(patch.progress ?? existing.progress),
            updatedAt: patch.updatedAt ?? timestamp,
            completedAt: status === 'done' ? (patch.completedAt ?? existing.completedAt ?? timestamp) : (patch.completedAt ?? existing.completedAt ?? null),
          });
          break;
        }
        case 'node_deleted': {
          if (!nodeId) break;
          nodes.delete(nodeId);
          for (const [edgeId, edge] of edges) {
            if (edge.from === nodeId || edge.to === nodeId) edges.delete(edgeId);
          }
          for (const [linkId, link] of sessionLinks) {
            if (link.nodeId === nodeId) sessionLinks.delete(linkId);
          }
          break;
        }
        case 'status_changed':
        case 'review_requested':
        case 'review_cleared': {
          if (!nodeId) break;
          const existing = nodes.get(nodeId);
          if (!existing) break;
          const status = event.type === 'review_requested'
            ? 'review'
            : event.type === 'review_cleared'
              ? (event.payload.status ?? 'todo')
              : event.payload.status;
          if (!status) break;
          nodes.set(nodeId, {
            ...existing,
            status,
            updatedAt: timestamp,
            completedAt: status === 'done' ? (existing.completedAt ?? timestamp) : existing.completedAt ?? null,
            metadata: event.payload.reviewReason
              ? { ...(existing.metadata ?? {}), reviewReason: event.payload.reviewReason }
              : existing.metadata,
          });
          break;
        }
        case 'progress_changed': {
          if (!nodeId) break;
          const existing = nodes.get(nodeId);
          if (!existing) break;
          nodes.set(nodeId, {
            ...existing,
            progress: clampProgress(event.payload.progress),
            updatedAt: timestamp,
          });
          break;
        }
        case 'edge_added':
        case 'dependency_added': {
          const edge = event.payload.edge;
          if (edge) edges.set(edge.id, normalizeEdge(edge, timestamp));
          break;
        }
        case 'edge_removed': {
          if (event.payload.edgeId) edges.delete(event.payload.edgeId);
          break;
        }
        case 'session_linked': {
          const link = event.payload.sessionLink;
          if (link) sessionLinks.set(link.id, { ...link, createdAt: link.createdAt || timestamp });
          break;
        }
        default:
          break;
      }
    } catch (error) {
      warnings.push({
        type: 'projection',
        eventId: event.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const allNodes = [...nodes.values()].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const existingNodeIds = new Set(allNodes.map((node) => node.id));
  const allEdges = [...edges.values()].filter((edge) => existingNodeIds.has(edge.from) && existingNodeIds.has(edge.to));
  const reviewEdgeNodeIds = allEdges
    .filter((edge) => edge.type === 'needs_review')
    .flatMap((edge) => [edge.from, edge.to]);
  const reviewNodeIds = [...new Set([
    ...allNodes.filter((node) => node.status === 'review' || node.kind === 'review').map((node) => node.id),
    ...reviewEdgeNodeIds,
  ])].filter((id) => existingNodeIds.has(id));
  const rootNodeIds = allNodes.filter((node) => !node.parentId || !existingNodeIds.has(node.parentId)).map((node) => node.id);
  const currentGoal = [...allNodes]
    .filter((node) => node.kind === 'goal' && node.status !== 'done' && node.status !== 'dropped')
    .sort((a, b) => {
      const rank = (status: TaskLedgerNode['status']) => (status === 'doing' ? 0 : status === 'review' ? 1 : status === 'blocked' ? 2 : 3);
      return rank(a.status) - rank(b.status) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
    })[0] ?? null;

  return {
    schemaVersion: SCHEMA_VERSION,
    workspaceId,
    generatedAt: nowIso(),
    nodes: allNodes,
    edges: allEdges,
    sessionLinks: [...sessionLinks.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
    rootNodeIds,
    reviewNodeIds,
    activeNodeIds: allNodes.filter((node) => node.status === 'doing').map((node) => node.id),
    blockedNodeIds: allNodes.filter((node) => node.status === 'blocked').map((node) => node.id),
    currentGoalId: currentGoal?.id ?? null,
    recentDecisions: allNodes.filter((node) => node.kind === 'decision').sort(sortByUpdatedDesc).slice(0, 5),
    eventsCount: events.length,
    warnings,
  };
}

export async function writeTaskLedgerSnapshot(snapshot: TaskLedgerSnapshot): Promise<void> {
  const dir = getTaskLedgerDirForKey(snapshot.workspaceId);
  await mkdir(dir, { recursive: true });
  await writeFile(getTaskLedgerSnapshotPathForKey(snapshot.workspaceId), JSON.stringify(snapshot, null, 2), 'utf8');
}

export async function loadTaskLedgerSnapshot(workspaceId?: string | null): Promise<TaskLedgerSnapshot> {
  return withTaskLedgerJournalLock(getTaskLedgerEventsPath(workspaceId), () => loadSnapshotUnlocked(workspaceId));
}

async function loadSnapshotUnlocked(workspaceId?: string | null): Promise<TaskLedgerSnapshot> {
  const normalizedWorkspaceId = normalizeTaskLedgerWorkspaceId(workspaceId);
  const { events, warnings } = parseTaskLedgerLog(await readLogText(workspaceId));
  const snapshot = projectTaskLedgerSnapshot(normalizedWorkspaceId, events, warnings);
  await writeTaskLedgerSnapshot(snapshot);
  return snapshot;
}

export async function appendTaskLedgerEvents(
  workspaceId: string | undefined | null,
  inputs: TaskLedgerEventInput[],
  batchIdempotencyKey?: string | null,
): Promise<TaskLedgerSnapshot> {
  // Manual, runtime lifecycle and automatic operation writers share this owner
  // lock; projection rebuilds cannot overwrite a newer committed revision.
  return withTaskLedgerJournalLock(getTaskLedgerEventsPath(workspaceId), async () => {
    const normalizedWorkspaceId = normalizeTaskLedgerWorkspaceId(workspaceId);
    const dir = getTaskLedgerDirForKey(normalizedWorkspaceId);
    await mkdir(dir, { recursive: true });

    const raw = await readLogText(workspaceId);
    const { events } = parseTaskLedgerLog(raw);
    const existingEventIds = new Set(events.map((event) => event.id));
    const existingIdempotencyKeys = new Set(
      events.map((event) => event.idempotencyKey).filter((key): key is string => typeof key === 'string' && key.length > 0),
    );
    if (batchIdempotencyKey && existingIdempotencyKeys.has(batchIdempotencyKey)) {
      return loadSnapshotUnlocked(workspaceId);
    }

    const nextEvents = inputs
      .map((input) => createTaskLedgerEvent(normalizedWorkspaceId, input, batchIdempotencyKey))
      .filter((event) => !existingEventIds.has(event.id) && !(event.idempotencyKey && existingIdempotencyKeys.has(event.idempotencyKey)));
    if (nextEvents.length > 0) {
      await appendCommitFrame(workspaceId, raw, nextEvents, null);
    }
    return loadSnapshotUnlocked(workspaceId);
  });
}

async function appendCommitFrame(
  workspaceId: string | null | undefined,
  priorRaw: string,
  events: TaskLedgerEvent[],
  operation: CommittedOperation | null,
): Promise<void> {
  const frame = serializeTaskLedgerCommit(events, operation);
  // A single checksummed record is the commit boundary. Torn records have no
  // projected effects; preserve their bytes and separate the next retry line.
  const handle = await open(getTaskLedgerEventsPath(workspaceId), 'a');
  try {
    await handle.writeFile(`${priorRaw && !priorRaw.endsWith('\n') ? '\n' : ''}${frame}\n`, 'utf8');
    await handle.sync();
  } finally { await handle.close(); }
}

export async function commitTaskLedgerOperation(input: {
  workspaceId: string;
  operationId: string;
  expectedRevision: number;
  request: unknown;
  identity: TaskLedgerOperationIdentity;
  events: TaskLedgerEventInput[];
  validateIdentity?: () => Promise<void>;
  validateCurrentOwner?: () => Promise<void>;
  validateState?: (snapshot: TaskLedgerSnapshot) => void;
}): Promise<{ snapshot: TaskLedgerSnapshot; receipt: TaskLedgerOperationReceipt }> {
  if (!input.operationId.trim() || input.operationId.length > 200
    || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0
    || input.identity.actor !== 'assistant' || input.workspaceId !== input.identity.scope.workspaceId
    || !input.events.length || input.events.length > 64) throw validation('Invalid Task Ledger operation identity, revision or batch');
  const requestSha256 = digest({ request: input.request, identity: input.identity, expectedRevision: input.expectedRevision });
  const deadline = Date.now() + 10_000;
  for (;;) {
    // Gateway's synchronous writer may be waiting on this journal. Never wait
    // for Gateway RPC while owning a ticket in the journal's critical section.
    await input.validateIdentity?.();
    const result = await withTaskLedgerJournalLock(getTaskLedgerEventsPath(input.workspaceId), async ({ waited }) => {
      const raw = await readLogText(input.workspaceId);
      const log = parseTaskLedgerLog(raw);
      const prior = log.operations.get(input.operationId);
      if (prior) {
        if (prior.requestSha256 !== requestSha256) throw validation('Operation ID was already used with a different request');
        return { snapshot: await loadSnapshotUnlocked(input.workspaceId), receipt: { ...prior, replayed: true } };
      }
      if (waited && input.validateIdentity) return null;
      if (log.events.length !== input.expectedRevision) throw validation('Task Ledger revision conflict');
      await input.validateCurrentOwner?.();
      const workspaceKey = normalizeTaskLedgerWorkspaceId(input.workspaceId);
      input.validateState?.(projectTaskLedgerSnapshot(workspaceKey, log.events, log.warnings));
      // Automatic operation receipts own dedupe. A model-chosen operation ID
      // must never poison manual/lifecycle batch keys such as mission:<id>.
      const events = input.events.map(event => createTaskLedgerEvent(workspaceKey, { ...event, actor: 'assistant', idempotencyKey: null }));
      if (new Set(events.map(event => event.id)).size !== events.length
        || events.some(event => log.events.some(existing => existing.id === event.id))) throw validation('Operation event IDs must be unique');
      const operation: CommittedOperation = {
        operationId: input.operationId, requestSha256, identity: input.identity,
        revision: log.events.length + events.length, eventIds: events.map(event => event.id),
      };
      await appendCommitFrame(input.workspaceId, raw, events, operation);
      // Failure after the durable append is recovered from this same log on retry;
      // snapshot.json is a cache and never decides whether the operation committed.
      return { snapshot: await loadSnapshotUnlocked(input.workspaceId), receipt: { ...operation, replayed: false } };
    }, { timeoutMs: Math.max(0, deadline - Date.now()) });
    if (result) return result;
    if (Date.now() >= deadline) throw Object.assign(new Error('Task Ledger admission contention timed out'), { code: 'LOCK_TIMEOUT', retryable: true });
    // Release before refreshing identity; a queued request must not carry an
    // earlier session epoch through contention, or deadlock the Gateway writer.
  }
}

export async function replayCommittedTaskLedgerOperation(input: {
  workspaceId: string; operationId: string; expectedRevision: number; request: unknown;
}): Promise<{ snapshot: TaskLedgerSnapshot; receipt: TaskLedgerOperationReceipt } | null> {
  return withTaskLedgerJournalLock(getTaskLedgerEventsPath(input.workspaceId), async () => {
    const log = parseTaskLedgerLog(await readLogText(input.workspaceId));
    const prior = log.operations.get(input.operationId);
    if (!prior) return null;
    const requestSha256 = digest({ request: input.request, identity: prior.identity, expectedRevision: input.expectedRevision });
    if (requestSha256 !== prior.requestSha256) throw validation('Operation ID was already used with a different request');
    // This is only a historical receipt read, never a new admission. A dead or
    // replaced Gateway must not prevent recovery of a commit already fsynced.
    return { snapshot: await loadSnapshotUnlocked(input.workspaceId), receipt: { ...prior, replayed: true } };
  });
}
