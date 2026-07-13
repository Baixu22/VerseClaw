import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  TaskLedgerEdge,
  TaskLedgerEvent,
  TaskLedgerEventInput,
  TaskLedgerNode,
  TaskLedgerSessionLink,
  TaskLedgerSnapshot,
  TaskLedgerWarning,
} from '../../shared/types/task-ledger';
import { getOpenClawConfigDir } from '../utils/paths';

const SCHEMA_VERSION = 1 as const;

export type TaskLedgerReadResult = {
  events: TaskLedgerEvent[];
  warnings: TaskLedgerWarning[];
};

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

function getTaskLedgerEventsPathForKey(workspaceKey: string): string {
  return join(getTaskLedgerDirForKey(workspaceKey), 'events.jsonl');
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function hasValidEventShape(value: unknown): value is TaskLedgerEvent {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string'
    && typeof value.workspaceId === 'string'
    && typeof value.type === 'string'
    && typeof value.actor === 'string'
    && typeof value.createdAt === 'string'
    && isRecord(value.payload);
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

export async function readTaskLedgerEvents(workspaceId?: string | null): Promise<TaskLedgerReadResult> {
  const eventsPath = getTaskLedgerEventsPathForKey(normalizeTaskLedgerWorkspaceId(workspaceId));
  let raw;
  try {
    raw = await readFile(eventsPath, 'utf8');
  } catch {
    return { events: [], warnings: [] };
  }
  return parseTaskLedgerEventLog(raw);
}

export function parseTaskLedgerEventLog(raw: string): TaskLedgerReadResult {
  const events: TaskLedgerEvent[] = [];
  const warnings: TaskLedgerWarning[] = [];
  raw.split(/\r?\n/u).forEach((line, index) => {
    if (!line.trim()) return;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (!hasValidEventShape(parsed)) {
        warnings.push({ type: 'invalid_event', line: index + 1, message: 'Task ledger event is missing required fields.' });
        return;
      }
      events.push(parsed);
    } catch (error) {
      warnings.push({
        type: 'invalid_jsonl',
        line: index + 1,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });
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
  const normalizedWorkspaceId = normalizeTaskLedgerWorkspaceId(workspaceId);
  const { events, warnings } = await readTaskLedgerEvents(workspaceId);
  const snapshot = projectTaskLedgerSnapshot(normalizedWorkspaceId, events, warnings);
  await writeTaskLedgerSnapshot(snapshot);
  return snapshot;
}

export async function appendTaskLedgerEvents(
  workspaceId: string | undefined | null,
  inputs: TaskLedgerEventInput[],
  batchIdempotencyKey?: string | null,
): Promise<TaskLedgerSnapshot> {
  const normalizedWorkspaceId = normalizeTaskLedgerWorkspaceId(workspaceId);
  const dir = getTaskLedgerDirForKey(normalizedWorkspaceId);
  await mkdir(dir, { recursive: true });

  const { events } = await readTaskLedgerEvents(workspaceId);
  const existingEventIds = new Set(events.map((event) => event.id));
  const existingIdempotencyKeys = new Set(
    events.map((event) => event.idempotencyKey).filter((key): key is string => typeof key === 'string' && key.length > 0),
  );
  if (batchIdempotencyKey && existingIdempotencyKeys.has(batchIdempotencyKey)) {
    return loadTaskLedgerSnapshot(workspaceId);
  }

  const nextEvents = inputs
    .map((input) => createTaskLedgerEvent(normalizedWorkspaceId, input, batchIdempotencyKey))
    .filter((event) => !existingEventIds.has(event.id) && !(event.idempotencyKey && existingIdempotencyKeys.has(event.idempotencyKey)));
  if (nextEvents.length > 0) {
    const lines = nextEvents.map((event) => JSON.stringify(event)).join('\n');
    await writeFile(getTaskLedgerEventsPathForKey(normalizedWorkspaceId), `${lines}\n`, { encoding: 'utf8', flag: 'a' });
  }
  return loadTaskLedgerSnapshot(workspaceId);
}
