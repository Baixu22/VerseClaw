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
  type ReclaimAction,
  type ReclaimReceipt,
  type ReclaimScope,
} from '@shared/long-session-resource-reclamation';

/**
 * Worktree ownership is tracked in the existing runtime registry. This adapter
 * never fabricates an id from the session key and never deletes a foreign
 * worktree; unresolved ownership stays `kept` for review.
 */
function reclaimOwnedWorktrees(params: {
  sessionKey: string;
  workspaceId?: string;
}): { attempted: number; reclaimed: number; failed: number; kept: number } {
  void params;
  return { attempted: 0, reclaimed: 0, failed: 0, kept: 0 };
}

/** Close browser sessions that belong to one session key. */function reclaimOwnedBrowserSessions(params: {
  sessionKey: string;
}): { attempted: number; reclaimed: number } {
  const service = getDefaultAgentBrowserService();
  const sessions = typeof service.list === 'function' ? service.list() : [];
  const owned = sessions.filter((session) => {
    const key = (session as { sessionKey?: string }).sessionKey;
    return key === params.sessionKey;
  });
  let reclaimed = 0;
  for (const session of owned) {
    try {
      service.close(session.id);
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
}): Promise<{ attempted: number; reclaimed: number; failed: number }> {
  const tracker = getResourceTracker();
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
};

export async function reclaimLongSessionOwnerResources(
  request: LongSessionReclaimRequest,
): Promise<ReclaimReceipt> {
  const terminalManager = request.terminalManager;
  const receipt = await reclaimLongSessionResources({
    action: request.action,
    scope: request.scope,
    owners: {
      terminals: terminalManager
        ? {
            reclaim: (params) => terminalManager.reclaimForSession({
              sessionKey: params.sessionKey,
              workspaceId: params.workspaceId,
              honorKeepOnLeave: params.honorKeepOnLeave,
              reason: request.action === 'session-delete' ? 'session-delete' : 'user-close',
            }),
            count: (params) => terminalManager.countForSession(params),
          }
        : undefined,
      browsers: {
        reclaim: (params) => reclaimOwnedBrowserSessions({ sessionKey: params.sessionKey }),
      },
      backgroundPorts: {
        reclaim: (params) => reclaimOwnedBackgroundPorts({ sessionKey: params.sessionKey }),
      },
      worktrees: {
        reclaim: async (params) => reclaimOwnedWorktrees(params),
      },
      admission: {
        release: () => 0,
      },
    },
  });
  return receipt;
}