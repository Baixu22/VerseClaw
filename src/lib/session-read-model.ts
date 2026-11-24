import type { ChatSession, RawMessage } from '@shared/chat/types';
import type { TaskLedgerNode, TaskLedgerSnapshot } from '@shared/types/task-ledger';
import type { WorkspaceCoordinatorBinding } from '@shared/types/workspace';
import { parseSessionCollaborationQuery, validateSessionCollaborationPage, type SessionCollaborationQuery, type SessionCollaborationPage } from '@shared/types/session-collaboration';
import type { SessionCollaborationQueryResult } from '@shared/host-api/contract';

/** UI consumers use the same scoped payload and bounded reply as the session tools. */
export async function readSessionCollaborationPage(input: SessionCollaborationQuery,
  read: (query: SessionCollaborationQuery) => SessionCollaborationQueryResult | Promise<SessionCollaborationQueryResult>): Promise<SessionCollaborationPage> {
  const query = parseSessionCollaborationQuery(input);
  const result = await read(query);
  return validateSessionCollaborationPage(query, result.page);
}

/** Older history and summary reads cannot undo activity already observed from the runtime. */
export function mergeSessionActivity(previous: Record<string, number>, incoming: Record<string, number>): Record<string, number> {
  let next = previous;
  for (const [key, at] of Object.entries(incoming)) {
    if (!Number.isFinite(at) || at <= (previous[key] ?? 0)) continue;
    if (next === previous) next = { ...previous };
    next[key] = at;
  }
  return next;
}

export function getTranscriptEntryId(message: RawMessage): string | undefined {
  const ownerId = message.__openclaw?.id;
  if (message.__openclaw) return typeof ownerId === 'string' && ownerId.trim() ? ownerId : undefined;
  return typeof message.id === 'string' && message.id.trim() ? message.id : undefined;
}

/** Keep the owner's page size and read transcript decorations only for the first page. */
export async function readSessionListPages(read: (params: Record<string, unknown>) => Promise<Record<string, unknown>>): Promise<Record<string, unknown>> {
  const first = await read({ includeDerivedTitles: true, includeLastMessage: true });
  const sessions = Array.isArray(first.sessions) ? [...first.sessions] : [];
  let page = first;
  let offset = 0;
  while (page.hasMore === true) {
    const next = page.nextOffset;
    if (typeof next !== 'number' || !Number.isInteger(next) || next <= offset
      || typeof first.totalCount !== 'number' || !Number.isFinite(first.totalCount)) {
      throw new Error('Session list pagination is unavailable');
    }
    if (next >= first.totalCount) break;
    offset = next;
    page = await read({ offset, includeDerivedTitles: false, includeLastMessage: false });
    if (!Array.isArray(page.sessions)) throw new Error('Session list page is unavailable');
    sessions.push(...page.sessions);
  }
  return { ...first, sessions, hasMore: page.hasMore, nextOffset: page.nextOffset };
}

export type SessionTaskRead = {
  workspaceId: string;
  sessionKey: string;
  generation?: string;
  snapshot: TaskLedgerSnapshot | null;
  error?: string | null;
};
export type SessionTaskContainer = {
  status: 'ready' | 'empty' | 'unavailable' | 'stale';
  reason?: string;
  nodes: TaskLedgerNode[];
};

/** Consume one scoped Ledger response. It never creates tasks or session relations. */
export function readSessionTaskContainer(input: {
  workspaceId: string;
  session: ChatSession;
  read: SessionTaskRead | null;
  binding?: WorkspaceCoordinatorBinding | null;
}): SessionTaskContainer {
  const { read, session, binding } = input;
  if (!read || read.error || !read.snapshot) return { status: 'unavailable', reason: read?.error ?? 'not-loaded', nodes: [] };
  if (read.workspaceId !== input.workspaceId || read.sessionKey !== session.key || read.generation !== session.sessionId) {
    return { status: 'stale', reason: 'response-scope-mismatch', nodes: [] };
  }
  if (read.snapshot.sourceWorkspaceId !== input.workspaceId) return { status: 'unavailable', reason: 'ledger-owner-scope-mismatch', nodes: [] };
  if (read.snapshot.warnings.length) return { status: 'unavailable', reason: 'ledger-warnings', nodes: [] };
  const ownLinks = read.snapshot.sessionLinks.filter((link) => link.sessionKey === session.key && link.nodeId);
  const links = ownLinks.filter((link) => !link.sessionGeneration || link.sessionGeneration === session.sessionId);
  const businessLinks = ownLinks.filter((link) => read.snapshot!.nodes.some((node) => node.id === link.nodeId && node.kind === 'task'));
  const nodeIds = new Set(links.map((link) => link.nodeId));
  const nodes = read.snapshot.nodes.filter((node) => nodeIds.has(node.id) && node.kind === 'task');
  if (ownLinks.some((link) => !read.snapshot!.nodes.some((node) => node.id === link.nodeId))) {
    return { status: 'unavailable', reason: 'task-not-found', nodes };
  }
  if (businessLinks.length && !nodes.length) return { status: 'stale', reason: 'generation-mismatch', nodes: [] };
  if (binding && (binding.workspaceId !== input.workspaceId || binding.sessionKey !== session.key
    || (binding.sessionGeneration && binding.sessionGeneration !== session.sessionId) || binding.state === 'invalid')) {
    return { status: 'stale', reason: 'binding-mismatch', nodes };
  }
  return { status: nodes.length ? 'ready' : 'empty', nodes };
}
