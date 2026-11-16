// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import {
  closeAllOwnedBrowserSessions,
  reclaimBrowserSessionsForWorkspace,
  reclaimLongSessionOwnerResources,
} from '../../electron/services/long-session-resource-reclamation';

const SCOPE = {
  workspaceId: 'workspace-e2',
  sessionKey: 'agent:e2:long',
  expectedSessionId: 'generation-e2',
  rootPath: 'D:/workspace-e2',
};

function terminalManager() {
  return {
    reclaimForSession: vi.fn((params) => ({
      attempted: params.honorKeepOnLeave ? 2 : 2,
      reclaimed: 1,
      kept: params.honorKeepOnLeave ? 1 : 1,
    })),
    countForSession: vi.fn(() => 2),
    listAll: vi.fn(() => []),
  };
}

describe('Main owner reclamation adapter', () => {
  it('closes only browser sessions for the exact session scope', async () => {
    const close = vi.fn();
    const browserService = {
      list: vi.fn(() => [
        { id: 'browser-owned', sessionKey: SCOPE.sessionKey, workspaceId: SCOPE.workspaceId },
        { id: 'browser-other-session', sessionKey: 'agent:e2:other', workspaceId: SCOPE.workspaceId },
        { id: 'browser-other-workspace', sessionKey: SCOPE.sessionKey, workspaceId: 'workspace-other' },
      ]),
      close,
    };
    const tracker = {
      list: vi.fn(() => ({ resources: [] })),
      stopResource: vi.fn(),
    };
    const receipt = await reclaimLongSessionOwnerResources({
      action: 'session-delete',
      scope: SCOPE,
      terminalManager: terminalManager() as never,
      browserService: browserService as never,
      resourceTracker: tracker as never,
      runtimeCleanupSettled: true,
    });

    expect(close).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledWith('browser-owned');
    expect(receipt.owners.find((owner) => owner.kind === 'browser')).toMatchObject({
      outcome: 'reclaimed',
      attempted: 1,
      reclaimed: 1,
      generation: SCOPE.expectedSessionId,
      authority: 'managed',
    });
  });

  it('leaves observed ports untouched and marks a remaining managed port for recovery', async () => {
    const stopResource = vi.fn(async (id: string) => (
      id === 'managed-ok'
        ? { success: true, resourceId: id }
        : { success: false, resourceId: id, error: 'still reachable' }
    ));
    const tracker = {
      list: vi.fn(() => ({
        resources: [
          { id: 'managed-ok', pid: 100, port: 4000, sessionKey: SCOPE.sessionKey, ownership: 'managed' },
          { id: 'managed-fail', pid: 101, port: 4001, sessionKey: SCOPE.sessionKey, ownership: 'managed' },
          { id: 'observed', pid: 102, port: 4002, sessionKey: SCOPE.sessionKey, ownership: 'observed' },
        ],
      })),
      stopResource,
    };
    const receipt = await reclaimLongSessionOwnerResources({
      action: 'session-delete',
      scope: SCOPE,
      terminalManager: terminalManager() as never,
      browserService: { list: vi.fn(() => []), close: vi.fn() } as never,
      resourceTracker: tracker as never,
      runtimeCleanupSettled: true,
    });

    expect(stopResource).toHaveBeenCalledTimes(2);
    expect(stopResource).not.toHaveBeenCalledWith('observed');
    expect(receipt.owners.find((owner) => owner.kind === 'background-port')).toMatchObject({
      outcome: 'failed',
      attempted: 2,
      reclaimed: 1,
      generation: SCOPE.expectedSessionId,
    });
    expect(receipt.recoveryRequired).toBe(true);
    expect(receipt.recoveryId).toBe(`recovery:session-delete:${SCOPE.sessionKey}`);
  });

  it('counts keep_on_leave terminals on archive without closing them', async () => {
    const terminals = terminalManager();
    const receipt = await reclaimLongSessionOwnerResources({
      action: 'session-archive',
      scope: SCOPE,
      terminalManager: terminals as never,
      browserService: { list: vi.fn(() => []), close: vi.fn() } as never,
      resourceTracker: { list: vi.fn(() => ({ resources: [] })), stopResource: vi.fn() } as never,
      runtimeCleanupSettled: true,
    });
    expect(terminals.reclaimForSession).not.toHaveBeenCalled();
    expect(receipt.owners.find((owner) => owner.kind === 'terminal')).toMatchObject({
      outcome: 'kept',
      attempted: 2,
      reclaimed: 0,
      kept: 2,
    });
    expect(receipt.owners.find((owner) => owner.kind === 'worktree')).toMatchObject({
      outcome: 'not-owned',
      detail: 'action preserves worktrees',
    });
  });
});
describe('desktop lifecycle helpers', () => {
  it('workspace delete closes only browser sessions in the removed workspace', async () => {
    const close = vi.fn();
    const service = {
      list: () => [
        { id: 'browser-a', workspaceId: 'workspace-e2' },
        { id: 'browser-b', workspaceId: 'workspace-other' },
      ],
      close,
    };
    expect(await reclaimBrowserSessionsForWorkspace('workspace-e2', service as never)).toEqual({
      attempted: 1,
      reclaimed: 1,
    });
    expect(close).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledWith('browser-a');
  });

  it('app quit closes every process-scoped browser session', async () => {
    const close = vi.fn();
    const service = {
      list: () => [{ id: 'browser-a' }, { id: 'browser-b' }],
      close,
    };
    expect(await closeAllOwnedBrowserSessions(service as never)).toBe(2);
    expect(close.mock.calls).toEqual([['browser-a'], ['browser-b']]);
  });
});
