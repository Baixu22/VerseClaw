import type { ChatRuntimeRunState, ChatSession } from '@/stores/chat';
import type { SessionFolder, WorkspaceProfile } from '@shared/types/workspace';
import { classifyDerivation, deriveSessionLineage, type SessionDerivation } from '@shared/types/session-derivation';

function getAgentIdFromSessionKey(sessionKey: string): string {
  if (!sessionKey.startsWith('agent:')) return 'main';
  const [, agentId] = sessionKey.split(':');
  return agentId || 'main';
}

function getSessionCreatedAtMsFromKey(sessionKey: string): number | undefined {
  const match = sessionKey.match(/(?:^|:)session-(\d{11,})(?=$|:)/);
  if (!match) return undefined;

  const createdAtMs = Number(match[1]);
  return Number.isFinite(createdAtMs) && createdAtMs > 0 ? createdAtMs : undefined;
}

export function getRuntimeRunActivityMs(run: ChatRuntimeRunState): number {
  const lastEventTs = run.events.reduce((latest, event) => {
    const ts = typeof event.ts === 'number' && Number.isFinite(event.ts) ? event.ts : 0;
    return Math.max(latest, ts);
  }, 0);
  return Math.max(run.endedAt ?? 0, run.startedAt ?? 0, lastEventTs);
}

export function buildLatestRuntimeRunBySession(
  runtimeRuns: Record<string, ChatRuntimeRunState>,
): Map<string, ChatRuntimeRunState> {
  const latestBySession = new Map<string, ChatRuntimeRunState>();
  const latestActivityBySession = new Map<string, number>();

  for (const run of Object.values(runtimeRuns)) {
    if (!run.sessionKey) continue;
    const activity = getRuntimeRunActivityMs(run);
    if (activity >= (latestActivityBySession.get(run.sessionKey) ?? -1)) {
      latestBySession.set(run.sessionKey, run);
      latestActivityBySession.set(run.sessionKey, activity);
    }
  }

  return latestBySession;
}

export function getSessionActivityMs(
  session: ChatSession,
  sessionLastActivity: Record<string, number>,
): number {
  const lastActivityMs = sessionLastActivity[session.key];
  if (Number.isFinite(lastActivityMs) && lastActivityMs > 0) return lastActivityMs;

  if (typeof session.updatedAt === 'number' && Number.isFinite(session.updatedAt) && session.updatedAt > 0) {
    return session.updatedAt;
  }

  return getSessionCreatedAtMsFromKey(session.key) ?? 0;
}

export function isSessionVisibleInWorkspace(params: {
  sessionKey: string;
  currentSessionKey: string;
  workspaceSessionKeys?: Iterable<string> | null;
}): boolean {
  if (getAgentIdFromSessionKey(params.sessionKey) !== getAgentIdFromSessionKey(params.currentSessionKey)) {
    return false;
  }
  if (!params.workspaceSessionKeys) return true;
  const workspaceSessionKeys = params.workspaceSessionKeys instanceof Set
    ? params.workspaceSessionKeys
    : new Set(params.workspaceSessionKeys);
  return workspaceSessionKeys.has(params.sessionKey) || params.sessionKey === params.currentSessionKey;
}

export type SidebarSessionEntry = {
  session: ChatSession;
  activityMs: number;
  isPinned?: boolean;
  isUnread?: boolean;
  isPriority?: boolean;
};

export type SidebarSessionSort = 'newest' | 'active' | 'priority';

export type SidebarWorkspaceSessionGroup = {
  workspace: WorkspaceProfile;
  activityMs: number;
  sessions: SidebarSessionEntry[];
};

function compareActivityDesc(left: { activityMs: number }, right: { activityMs: number }): number {
  return right.activityMs - left.activityMs;
}

/** Sort conversation rows while keeping pinned conversations above every mode. */
export function compareSidebarSessionEntries(
  left: SidebarSessionEntry,
  right: SidebarSessionEntry,
  sort: SidebarSessionSort = 'newest',
): number {
  if (left.isPinned !== right.isPinned) return left.isPinned ? -1 : 1;
  if (sort === 'active') {
    const countDelta = (right.session.messageCount ?? 0) - (left.session.messageCount ?? 0);
    if (countDelta !== 0) return countDelta;
  } else if (sort === 'priority') {
    const priorityDelta = Number(Boolean(right.isPriority)) - Number(Boolean(left.isPriority));
    if (priorityDelta !== 0) return priorityDelta;
  }
  return compareActivityDesc(left, right);
}

export function sortSidebarSessionEntries(
  entries: SidebarSessionEntry[],
  sort: SidebarSessionSort = 'newest',
): SidebarSessionEntry[] {
  return entries.slice().sort((left, right) => compareSidebarSessionEntries(left, right, sort));
}

function getWorkspaceActivityMs(workspace: WorkspaceProfile, sessions: SidebarSessionEntry[]): number {
  const sessionActivityMs = sessions[0]?.activityMs ?? 0;
  return Math.max(
    sessionActivityMs,
    workspace.lastOpenedAt ?? 0,
    workspace.updatedAt ?? 0,
    workspace.createdAt ?? 0,
  );
}

function getProfileSessionKeys(workspace: WorkspaceProfile): Set<string> {
  return new Set<string>([
    ...Object.keys(workspace.sessionStates ?? {}),
    ...Object.keys(workspace.coordinatorBindings ?? {}),
    workspace.activeSessionKey,
    ...Object.values(workspace.agentBindings ?? {}).map((binding) => binding.sessionKey),
  ].filter((key): key is string => Boolean(key)));
}

export function getWorkspaceSessionKeys(workspaces: WorkspaceProfile[]): Set<string> | null {
  if (workspaces.length === 0) return null;
  const keys = new Set<string>();
  for (const workspace of workspaces) {
    for (const sessionKey of [...Object.keys(workspace.sessionStates ?? {}), ...Object.keys(workspace.coordinatorBindings ?? {})]) {
      keys.add(sessionKey);
    }
    if (workspace.activeSessionKey) {
      keys.add(workspace.activeSessionKey);
    }
    for (const binding of Object.values(workspace.agentBindings ?? {})) {
      if (binding.sessionKey) keys.add(binding.sessionKey);
    }
  }
  return keys;
}

export function buildSidebarTimeSessions(params: {
  sessions: ChatSession[];
  currentSessionKey: string;
  sessionLastActivity: Record<string, number>;
  workspaces: WorkspaceProfile[];
}): SidebarSessionEntry[] {
  const currentAgentId = getAgentIdFromSessionKey(params.currentSessionKey);
  const workspaceSessionKeys = getWorkspaceSessionKeys(params.workspaces);
  return params.sessions
    .filter((session) => getAgentIdFromSessionKey(session.key) === currentAgentId)
    .filter((session) => !workspaceSessionKeys || workspaceSessionKeys.has(session.key) || session.key === params.currentSessionKey)
    .map((session) => ({
      session,
      activityMs: getSessionActivityMs(session, params.sessionLastActivity),
    }))
    .sort(compareActivityDesc);
}

export function buildSidebarWorkspaceSessionGroups(params: {
  sessions: ChatSession[];
  currentSessionKey: string;
  sessionLastActivity: Record<string, number>;
  workspaces: WorkspaceProfile[];
  includeSyntheticCurrent?: boolean;
}): SidebarWorkspaceSessionGroup[] {
  const sessionsByKey = new Map(params.sessions.map((session) => [session.key, session]));
  /* A malformed/legacy profile can claim the same transcript in more than one
     project. Pick one owner before rendering so project-local grouping cannot
     leak a session (or its folder) into a sibling project. */
  const ownerBySessionKey = new Map<string, string>();
  for (const workspace of params.workspaces) {
    for (const sessionKey of getProfileSessionKeys(workspace)) {
      if (!ownerBySessionKey.has(sessionKey)) ownerBySessionKey.set(sessionKey, workspace.id);
    }
  }

  return params.workspaces
    .map((workspace) => {
      const sessionKeys = getProfileSessionKeys(workspace);
      if (workspace.id === params.workspaces.find((candidate) => (
        candidate.sessionStates?.[params.currentSessionKey]
        || candidate.activeSessionKey === params.currentSessionKey
        || Object.values(candidate.agentBindings ?? {}).some((binding) => binding.sessionKey === params.currentSessionKey)
      ))?.id) {
        sessionKeys.add(params.currentSessionKey);
      }
      const sessions = Array.from(sessionKeys)
        .filter((sessionKey) => ownerBySessionKey.get(sessionKey) === workspace.id)
        .map((sessionKey) => sessionsByKey.get(sessionKey) ?? (
          params.includeSyntheticCurrent !== false && sessionKey === params.currentSessionKey
          ? { key: sessionKey, displayName: sessionKey }
          : null
        ))
        .filter((session): session is ChatSession => Boolean(session))
        .map((session) => ({
          session,
          activityMs: getSessionActivityMs(session, params.sessionLastActivity),
        }))
        .sort(compareActivityDesc);
      return {
        workspace,
        sessions,
        activityMs: getWorkspaceActivityMs(workspace, sessions),
      };
    })
    .filter((group) => group.sessions.length > 0)
    .sort(compareActivityDesc);
}

export type SidebarFolderNode = {
  folder: SessionFolder;
  depth: number;
  sessions: SidebarSessionEntry[];
  children: SidebarFolderNode[];
};

export type SidebarWorkspaceFolderGroups = {
  rootSessions: SidebarSessionEntry[];
  folders: SidebarFolderNode[];
};

/**
 * Build the folder view for one workspace. A workgroup is intentionally a
 * single root-level bucket: legacy `parentId` values are ignored at the
 * boundary so old persisted data cannot recreate a second nesting level.
 * Sessions without a valid assignment stay in the activity-sorted root list.
 * Empty folders are preserved so the sidebar can render the folder shell even
 * when it has no sessions yet.
 */
export function buildSidebarWorkspaceFolderGroups(params: {
  sessions: SidebarSessionEntry[];
  folders: SessionFolder[];
  assignments: Record<string, string>;
  sort?: SidebarSessionSort;
}): SidebarWorkspaceFolderGroups {
  const { sessions, folders, assignments, sort = 'newest' } = params;
  const foldersById = new Map(folders.map((folder) => [folder.id, folder]));
  const sessionsByFolder = new Map<string, SidebarSessionEntry[]>();
  const rootSessions: SidebarSessionEntry[] = [];

  for (const entry of sessions) {
    const assignedFolderId = assignments[entry.session.key];
    if (typeof assignedFolderId === 'string' && foldersById.has(assignedFolderId)) {
      const list = sessionsByFolder.get(assignedFolderId) ?? [];
      list.push(entry);
      sessionsByFolder.set(assignedFolderId, list);
    } else {
      rootSessions.push(entry);
    }
  }

  const sortedFolders = [...folders].sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    return a.createdAt - b.createdAt;
  });

  return {
    rootSessions: sortSidebarSessionEntries(rootSessions, sort),
    folders: sortedFolders.map((folder) => ({
      // Normalize the persisted shape as well as the rendered shape. This
      // keeps all callers on the same one-level contract, including mock data
      // and older workspace snapshots that still carry a parentId.
      folder: { ...folder, parentId: null },
      depth: 0,
      sessions: sortSidebarSessionEntries(sessionsByFolder.get(folder.id) ?? [], sort),
      children: [],
    })),
  };
}

export function collectFolderSessionKeys(node: SidebarFolderNode): string[] {
  const keys = node.sessions.map((entry) => entry.session.key);
  for (const child of node.children) {
    keys.push(...collectFolderSessionKeys(child));
  }
  return keys;
}

/* ─── Workstream view (flat streams + lineage threads + time slices) ────────
 *
 * The sidebar renders folders as ONE flat level of "workstreams". These pure
 * helpers carry the whole restructuring so it stays unit-testable:
 *   - flattenFolderNodes: legacy nested folders → flat list with a path prefix
 *   - threadSessionsByLineage: fork/handoff children attach under their origin
 *   - sliceSessionsByTime: unfiled sessions fall into today / week / earlier
 */

export type FlatWorkstream = {
  node: SidebarFolderNode;
  /** Ancestor names for legacy nested folders, e.g. ['审计回归'] — [] for roots. */
  pathPrefix: string[];
};

/** Depth-first flatten so a legacy child stream stays adjacent to its parent. */
export function flattenFolderNodes(nodes: SidebarFolderNode[]): FlatWorkstream[] {
  const out: FlatWorkstream[] = [];
  const walk = (node: SidebarFolderNode, prefix: string[]) => {
    out.push({ node, pathPrefix: prefix });
    for (const child of node.children) walk(child, [...prefix, node.folder.name]);
  };
  for (const node of nodes) walk(node, []);
  return out;
}

/** Stable 8-way palette index for a workstream accent, keyed by folder id. */
export function workstreamColorIndex(folderId: string): number {
  let hashed = 0;
  for (let index = 0; index < folderId.length; index += 1) {
    hashed = (Math.imul(hashed, 31) + folderId.charCodeAt(index)) >>> 0;
  }
  return hashed % 8;
}

/**
 * Workstream accent palette — 8 hues picked to sit quietly on both themes
 * (mid lightness, restrained chroma). Index comes from workstreamColorIndex,
 * so a stream keeps its color across sessions and machines.
 */
const WS_PALETTE = [
  '#8B7CF6', // violet
  '#2FB8A6', // teal
  '#D9A03F', // amber
  '#E0688C', // rose
  '#4FA8E0', // sky
  '#4CB782', // emerald
  '#98A1B3', // slate
  '#E07856', // coral
] as const;

export function workstreamAccent(folderId: string): string {
  return WS_PALETTE[workstreamColorIndex(folderId)];
}

export type LineageRow = {
  entry: SidebarSessionEntry;
  /** 0 = top-level row; 1 = fork/handoff descendant attached under its origin. */
  lineageDepth: 0 | 1;
  /** Set on depth-1 rows: the session key of the origin row it attaches to. */
  originKey?: string;
  relation?: ReturnType<typeof classifyDerivation>;
  sourceStatus?: 'root' | 'resolved' | 'outside-group' | 'parent-unloaded' | 'parent-missing' | 'cycle' | 'bound-exceeded' | 'source-unavailable';
};

/**
 * Attach fork/handoff descendants beneath their origin session WITHIN one
 * list. Chains (A→B→C) collapse onto the topmost ancestor present in the
 * list, so attachment depth never exceeds one visual level; parent pointers
 * that loop or point outside the list degrade to plain rows. Order: top-level
 * rows keep the incoming (activity) order, descendants keep it within their
 * origin's block.
 */
export function threadSessionsByLineage(entries: SidebarSessionEntry[], options: {
  knownSessions?: readonly ChatSession[];
  derivations?: ReadonlyMap<string, SessionDerivation>;
  maxDepth?: number;
} = {}): LineageRow[] {
  const byKey = new Map(entries.map((entry) => [entry.session.key, entry]));
  const known = new Set((options.knownSessions ?? entries.map((entry) => entry.session)).map((session) => session.key));
  const projections = new Map<string, Omit<LineageRow, 'entry' | 'lineageDepth'>>();
  const childrenByOrigin = new Map<string, SidebarSessionEntry[]>();
  const topLevel: SidebarSessionEntry[] = [];
  for (const entry of entries) {
    const relation = classifyDerivation(entry.session);
    const lineage = deriveSessionLineage({ rootSessionKey: entry.session.key, maxDepth: options.maxDepth ?? 32,
      readEntry: (key) => byKey.get(key)?.session ?? null });
    const owner = options.derivations?.get(entry.session.key);
    const failedHop = lineage.hops.find((hop) => hop.status !== 'resolved');
    const ownerFailure = owner?.hops.find((hop) => hop.status !== 'resolved');
    let sourceStatus: LineageRow['sourceStatus'] = relation.parentSessionKey ? 'resolved'
      : relation.kind === 'unknown' && !relation.diagnostics?.length ? 'root' : 'source-unavailable';
    if (failedHop?.status === 'cycle' || failedHop?.status === 'bound-exceeded') sourceStatus = failedHop.status;
    else if (failedHop?.status === 'parent-missing') sourceStatus = known.has(failedHop.parentSessionKey!) ? 'outside-group' : 'parent-unloaded';
    if (ownerFailure) sourceStatus = ownerFailure.status;
    const last = lineage.chain.at(-1)?.sessionKey;
    const origin = sourceStatus !== 'cycle' && sourceStatus !== 'bound-exceeded' && last !== entry.session.key ? last : undefined;
    projections.set(entry.session.key, { relation, sourceStatus, ...(origin ? { originKey: origin } : {}) });
    if (origin) {
      const list = childrenByOrigin.get(origin) ?? [];
      list.push(entry);
      childrenByOrigin.set(origin, list);
    } else {
      topLevel.push(entry);
    }
  }

  const rows: LineageRow[] = [];
  const emitted = new Set<string>();
  for (const entry of topLevel) {
    rows.push({ entry, lineageDepth: 0, ...projections.get(entry.session.key) });
    emitted.add(entry.session.key);
    for (const child of childrenByOrigin.get(entry.session.key) ?? []) {
      rows.push({ entry: child, lineageDepth: 1, ...projections.get(child.session.key), originKey: entry.session.key });
      emitted.add(child.session.key);
    }
  }
  // Lost-and-found: a cyclic parent chain can classify every member as a
  // child, leaving no top-level host — those rows MUST NOT vanish. Emit them
  // as plain rows in incoming order.
  for (const entry of entries) {
    if (!emitted.has(entry.session.key)) {
      rows.push({ entry, lineageDepth: 0, ...projections.get(entry.session.key) });
      emitted.add(entry.session.key);
    }
  }
  return rows;
}

export type SessionTimeSliceKey = 'today' | 'week' | 'earlier';

export type SessionTimeSlice = {
  key: SessionTimeSliceKey;
  entries: SidebarSessionEntry[];
};

/**
 * Split unfiled sessions into "today / this week / earlier" by activity.
 * "today" is the local calendar day; "week" is the trailing 7 days beyond it;
 * unknown activity (0) sinks to "earlier". Empty slices are dropped.
 */
export function sliceSessionsByTime(entries: SidebarSessionEntry[], nowMs: number): SessionTimeSlice[] {
  const dayStart = new Date(nowMs);
  dayStart.setHours(0, 0, 0, 0);
  const todayStartMs = dayStart.getTime();
  const weekStartMs = nowMs - 7 * 24 * 60 * 60 * 1000;

  const buckets: Record<SessionTimeSliceKey, SidebarSessionEntry[]> = { today: [], week: [], earlier: [] };
  for (const entry of entries) {
    const activity = entry.activityMs;
    if (activity >= todayStartMs) buckets.today.push(entry);
    else if (activity >= weekStartMs && activity > 0) buckets.week.push(entry);
    else buckets.earlier.push(entry);
  }

  return (['today', 'week', 'earlier'] as const)
    .map((key) => ({ key, entries: buckets[key] }))
    .filter((slice) => slice.entries.length > 0);
}
