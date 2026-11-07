/**
 * E2 — Main-side resource reclamation glue.
 *
 * It asks the existing owners (TerminalSessionManager, HostAgentBrowserService,
 * ResourceTracker, worktree records, SessionAdmissionRegistry) to clean their
 * own handles, then records one receipt. It never kills agent-wide, never
 * deletes user directories and never becomes a second resource registry.
 */
import type { TerminalSessionManager } from './terminal-session-manager';
import { getDefaultAgentBrowserService } from './agent-browser-api';
import { getResourceTracker } from './resource-tracker';
import {
  reclaimLongSessionResources,
  type LongSessionResourceInventory,
  type ReclaimAction,
  type ReclaimReceipt,
  type ReclaimScope,
  type SessionOwnerInventory,
} from '@shared/long-session-resource-reclamation';
import { readProcessTreeSample } from '../../openclaw_runtime/src/process/process-tree-sampler';

/**
 * Worktree ownership is tracked in the existing runtime registry. This adapter
 * never fabricates an id from the session key and never deletes a foreign
 * worktree; unresolved ownership stays `kept` for review.
 */
function reclaimOwnedWorktrees(params: {
  sessionKey: string;
  workspaceId?: string;
  expectedSessionId?: string | null;
}): { attempted: number; reclaimed: number; failed: number; kept: number; detail: string } {
  void params;
  return {
    attempted: 0,
    reclaimed: 0,
    failed: 0,
    kept: 0,
    detail: 'runtime lifecycle owner reports worktree cleanup; Main never scans or deletes a worktree directory',
  };
}

/** Close browser sessions that belong to one session key. */async function reclaimOwnedBrowserSessions(params: {
  sessionKey: string;
  workspaceId?: string;
  service: ReturnType<typeof getDefaultAgentBrowserService>;
}): Promise<{ attempted: number; reclaimed: number }> {
  const service = params.service;
  const sessions = typeof service.list === 'function' ? service.list() : [];
  const owned = sessions.filter((session) => (
    session.sessionKey === params.sessionKey
    && (!params.workspaceId || !session.workspaceId || session.workspaceId === params.workspaceId)
  ));
  let reclaimed = 0;
  for (const session of owned) {
    try {
      await service.close(session.id);
      reclaimed += 1;
    } catch {
      // leave the failure visible through the attempted/reclaimed delta
    }
  }
  return { attempted: owned.length, reclaimed };
}

/** Stop only the managed background ports registered for this session. */
async function reclaimOwnedBackgroundPorts(params: {
  sessionKey: string;
  tracker: Pick<ReturnType<typeof getResourceTracker>, 'list' | 'stopResource'>;
}): Promise<{ attempted: number; reclaimed: number; failed: number }> {
  const tracker = params.tracker;
  const snapshot = tracker.list();
  const resources = (snapshot.resources ?? []).filter(
    (resource) => resource.sessionKey === params.sessionKey && resource.ownership === 'managed',
  );
  let reclaimed = 0;
  let failed = 0;
  for (const resource of resources) {
    const result = await tracker.stopResource(resource.id);
    if (result.success) reclaimed += 1;
    else failed += 1;
  }
  return { attempted: resources.length, reclaimed, failed };
}

export type LongSessionReclaimRequest = {
  action: ReclaimAction;
  scope: ReclaimScope;
  terminalManager?: TerminalSessionManager;
  browserService?: ReturnType<typeof getDefaultAgentBrowserService>;
  resourceTracker?: Pick<ReturnType<typeof getResourceTracker>, 'list' | 'stopResource'>;
  /** True only after the Gateway returned a committed runtime lifecycle receipt. */
  runtimeCleanupSettled?: boolean;
};

export async function reclaimLongSessionOwnerResources(
  request: LongSessionReclaimRequest,
): Promise<ReclaimReceipt> {
  const terminalManager = request.terminalManager;
  const browserService = request.browserService ?? getDefaultAgentBrowserService();
  const resourceTracker = request.resourceTracker ?? getResourceTracker();
  const receipt = await reclaimLongSessionResources({
    action: request.action,
    scope: request.scope,
    owners: {
      terminals: terminalManager
        ? {
            reclaim: (params) => terminalManager.reclaimForSession({
              sessionKey: params.sessionKey,
              workspaceId: params.workspaceId,
              expectedSessionId: params.expectedSessionId,
              honorKeepOnLeave: params.honorKeepOnLeave,
              reason: request.action === 'session-delete' ? 'session-delete' : 'user-close',
            }),
            count: (params) => terminalManager.countForSession(params),
          }
        : undefined,
      browsers: {
        reclaim: (params) => reclaimOwnedBrowserSessions({
          sessionKey: params.sessionKey,
          workspaceId: params.workspaceId,
          service: browserService,
        }),
      },
      backgroundPorts: {
        reclaim: (params) => reclaimOwnedBackgroundPorts({
          sessionKey: params.sessionKey,
          tracker: resourceTracker,
        }),
      },
      worktrees: request.runtimeCleanupSettled
        ? { reclaim: async (params) => reclaimOwnedWorktrees(params) }
        : undefined,
      admission: request.runtimeCleanupSettled
        ? {
            release: () => ({
              released: 0,
              detail: 'runtime canonical finalizer completed the admission fence/drain for this generation',
            }),
          }
        : undefined,
    },
  });
  return receipt;
}
/**
 * Main half of the owner ledger. It reads the existing desktop owners and
 * merges the runtime half; it never creates a session_resources store.
 */
export async function collectLongSessionResourceInventory(params: {
  scope: ReclaimScope;
  terminalManager?: TerminalSessionManager;
  runtimeInventory?: LongSessionResourceInventory | null;
}): Promise<LongSessionResourceInventory> {
  const terminalInventory =
    typeof params.terminalManager?.listAll === 'function'
      ? params.terminalManager.listAll()
      : (params.terminalManager?.list({
          workspaceId: params.scope.workspaceId || undefined,
          sessionKey: params.scope.sessionKey,
        }) ?? []).map((terminal) => ({
          sessionId: terminal.sessionId ?? '',
          workspaceId: terminal.workspaceId ?? params.scope.workspaceId,
          sessionKey: terminal.sessionKey ?? params.scope.sessionKey,
          expectedSessionId: terminal.expectedSessionId ?? null,
          pid: terminal.pid,
          keepOnLeave: terminal.keepOnLeave !== false,
        })).filter((terminal) => Boolean(terminal.sessionId));
  const terminalEntries = terminalInventory.filter((terminal) => (
    terminal.sessionKey === params.scope.sessionKey
    && (!params.scope.workspaceId || terminal.workspaceId === params.scope.workspaceId)
    && (!params.scope.expectedSessionId || terminal.expectedSessionId === params.scope.expectedSessionId)
  ));
  const browserSessions = getDefaultAgentBrowserService().list().filter((session) => (
    session.sessionKey === params.scope.sessionKey
    && (!params.scope.workspaceId || !session.workspaceId || session.workspaceId === params.scope.workspaceId)
  ));
  const tracked = (getResourceTracker().list().resources ?? []).filter((resource) => (
    resource.sessionKey === params.scope.sessionKey
    && (!params.scope.workspaceId || !resource.workspaceId || resource.workspaceId === params.scope.workspaceId)
  ));
  const terminalPids = terminalEntries
    .map((terminal) => terminal.pid)
    .filter((pid): pid is number => typeof pid === 'number' && pid > 0);
  const portPids = tracked
    .filter((resource) => resource.ownership === 'managed')
    .map((resource) => resource.pid)
    .filter((pid): pid is number => Number.isInteger(pid) && pid > 0);
  const [terminalSample, portSample] = await Promise.all([
    terminalPids.length > 0
      ? readProcessTreeSample({ rootPids: terminalPids })
      : Promise.resolve({ status: 'empty' as const, processCount: 0, treeRssBytes: 0, treeCpuPercent: 0 }),
    portPids.length > 0
      ? readProcessTreeSample({ rootPids: portPids })
      : Promise.resolve({ status: 'empty' as const, processCount: 0, treeRssBytes: 0, treeCpuPercent: 0 }),
  ]);
  const generation = params.scope.expectedSessionId ?? null;
  const desktopOwners: SessionOwnerInventory[] = [
    {
      kind: 'terminal',
      owner: 'TerminalSessionManager',
      authority: 'managed',
      generation,
      state: terminalSample.status === 'unknown' ? 'unknown' : 'known',
      count: terminalEntries.length,
      pids: terminalPids,
      processTreePids: terminalSample.status === 'ok' ? terminalPids : null,
      rssKb: terminalSample.treeRssBytes === null ? null : Math.ceil(terminalSample.treeRssBytes / 1024),
      cpuPercent: terminalSample.treeCpuPercent,
      activePermits: null,
      waiters: null,
      helperRefs: null,
      worktreeIds: null,
      sessionIds: terminalEntries.map((terminal) => terminal.sessionId),
      ...(terminalEntries.some((terminal) => terminal.keepOnLeave)
        ? { detail: 'includes keep_on_leave terminals counted separately' }
        : {}),
    },
    {
      kind: 'browser',
      owner: 'HostAgentBrowserService',
      authority: 'managed',
      generation,
      state: 'known',
      count: browserSessions.length,
      pids: null,
      processTreePids: null,
      rssKb: null,
      cpuPercent: null,
      activePermits: null,
      waiters: null,
      helperRefs: null,
      worktreeIds: null,
      sessionIds: browserSessions.map((session) => session.id),
    },
  ];
  const managedPorts = tracked.filter((resource) => resource.ownership === 'managed');
  if (managedPorts.length > 0) {
    desktopOwners.push({
      kind: 'background-port',
      owner: 'ResourceTracker',
      authority: 'managed',
      generation,
      state: portSample.status === 'unknown' ? 'unknown' : 'known',
      count: managedPorts.length,
      pids: portPids,
      processTreePids: portSample.status === 'ok' ? portPids : null,
      rssKb: portSample.treeRssBytes === null ? null : Math.ceil(portSample.treeRssBytes / 1024),
      cpuPercent: portSample.treeCpuPercent,
      activePermits: null,
      waiters: null,
      helperRefs: null,
      worktreeIds: null,
      sessionIds: null,
    });
  }
  const observedPorts = tracked.filter((resource) => resource.ownership === 'observed');
  if (observedPorts.length > 0) {
    desktopOwners.push({
      kind: 'background-port',
      owner: 'ResourceTracker',
      authority: 'observed',
      generation,
      state: 'known',
      count: observedPorts.length,
      pids: observedPorts.map((resource) => resource.pid),
      processTreePids: null,
      rssKb: null,
      cpuPercent: null,
      activePermits: null,
      waiters: null,
      helperRefs: null,
      worktreeIds: null,
      sessionIds: null,
      detail: 'observed ports are display-only and never targeted by cleanup',
    });
  }
  return {
    schema: 'LongSessionResourceInventory/v1',
    scope: params.scope,
    capturedAt: new Date().toISOString(),
    owners: [
      ...(params.runtimeInventory?.owners ?? []),
      ...desktopOwners,
    ],
  };
}
export async function reclaimBrowserSessionsForWorkspace(
  workspaceId: string,
  service: ReturnType<typeof getDefaultAgentBrowserService> = getDefaultAgentBrowserService(),
): Promise<{ attempted: number; reclaimed: number }> {
  let attempted = 0;
  let reclaimed = 0;
  for (const session of service.list()) {
    if (session.workspaceId !== workspaceId) continue;
    attempted += 1;
    try {
      await service.close(session.id);
      reclaimed += 1;
    } catch {
      // The attempted/reclaimed delta remains an explicit failure.
    }
  }
  return { attempted, reclaimed };
}

export async function reclaimManagedPortsForWorkspace(
  workspaceId: string,
): Promise<{ attempted: number; reclaimed: number; failed: number }> {
  const tracker = getResourceTracker();
  const resources = tracker.list().resources.filter((resource) => (
    resource.workspaceId === workspaceId && resource.ownership === 'managed'
  ));
  let reclaimed = 0;
  let failed = 0;
  for (const resource of resources) {
    const result = await tracker.stopResource(resource.id);
    if (result.success) reclaimed += 1;
    else failed += 1;
  }
  return { attempted: resources.length, reclaimed, failed };
}

export async function closeAllOwnedBrowserSessions(
  service: ReturnType<typeof getDefaultAgentBrowserService> = getDefaultAgentBrowserService(),
): Promise<number> {
  let closed = 0;
  for (const session of service.list()) {
    try {
      await service.close(session.id);
      closed += 1;
    } catch {
      // App quit remains best-effort; remaining process lifetime ends with Main.
    }
  }
  return closed;
}
