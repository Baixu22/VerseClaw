import type { ElectronApplication } from '@playwright/test';
import type { WorkspaceProfile, WorkspaceUiState } from '../../../shared/types/workspace';

/** Keep a mocked workspace owner synchronized with the UI's actual save requests. */
export async function installWorkspaceOwnerMocks(
  app: ElectronApplication,
  profile: WorkspaceProfile,
  sessionKeys: string[],
): Promise<void> {
  await app.evaluate(({ ipcMain }, seed) => {
    const original = (ipcMain as unknown as {
      _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>>;
    })._invokeHandlers?.get('host:invoke');
    const owner = { profile: seed.profile, saveCalls: [] as Record<string, unknown>[],
      readCalls: [] as Array<{ action: string; payload: unknown; activeSessionKey: string }> };
    const allowed = new Set(seed.sessionKeys);
    (globalThis as typeof globalThis & { __workspaceOwnerMock?: typeof owner }).__workspaceOwnerMock = owner;
    ipcMain.removeHandler('host:invoke');
    ipcMain.handle('host:invoke', async (event: unknown, request: {
      id?: string; module?: string; action?: string; payload?: Record<string, unknown>;
    }) => {
      if (request.module !== 'workspaces' || !['list', 'getActive', 'saveState'].includes(request.action ?? '')) {
        return original?.(event, request);
      }
      const payload = request.payload ?? {};
      (globalThis as typeof globalThis & { __verseClawE2eHostCalls?: unknown[] })
        .__verseClawE2eHostCalls?.push({ module: request.module, action: request.action, payload });
      const respond = (data: unknown) => ({ id: request.id, ok: true, data });
      if (request.action === 'saveState') {
        owner.saveCalls.push(payload);
        const target = typeof payload.sessionKey === 'string' ? payload.sessionKey : owner.profile.activeSessionKey;
        const active = typeof payload.activeSessionKey === 'string' ? payload.activeSessionKey : owner.profile.activeSessionKey;
        if (payload.id !== owner.profile.id || !allowed.has(target) || !allowed.has(active)
          || (payload.sessionKey !== undefined && typeof payload.sessionKey !== 'string')
          || (payload.activeSessionKey !== undefined && typeof payload.activeSessionKey !== 'string')
          || (payload.state !== undefined && (!payload.state || typeof payload.state !== 'object' || Array.isArray(payload.state)))) {
          return { id: request.id, ok: false,
            error: { code: 'INVALID_ARGUMENT', message: 'Workspace fixture requires its declared workspace and session identities.' } };
        }
        const sessionStates = { ...owner.profile.sessionStates, [target]: {
          ...owner.profile.sessionStates?.[target], ...(payload.state as WorkspaceUiState | undefined),
        } };
        const agentId = active.split(':')[1] || owner.profile.agentId;
        owner.profile = { ...owner.profile, activeSessionKey: active, agentId, selectedAgentId: agentId,
          state: sessionStates[active] ?? {}, sessionStates,
          agentBindings: { ...owner.profile.agentBindings,
            [agentId]: { workspaceId: owner.profile.id, agentId, sessionKey: active } },
          updatedAt: Date.now() };
        return respond({ success: true });
      }
      // These endpoints have no payload; their distinct result shapes come from the same owner.
      owner.readCalls.push({ action: request.action!, payload: request.payload ?? null, activeSessionKey: owner.profile.activeSessionKey });
      if (Object.keys(payload).length > 0 || (request.payload != null && (typeof request.payload !== 'object' || Array.isArray(request.payload)))) {
        return { id: request.id, ok: false,
          error: { code: 'INVALID_ARGUMENT', message: 'Workspace read endpoints accept no parameters.' } };
      }
      if (request.action === 'getActive') {
        return respond({ success: true, activeWorkspaceId: owner.profile.id, activeWorkspace: owner.profile });
      }
      return respond({ success: true, profiles: [owner.profile], activeWorkspaceId: owner.profile.id, activeWorkspace: owner.profile });
    });
  }, { profile, sessionKeys });
}

export async function readWorkspaceOwnerMocks(app: ElectronApplication): Promise<{
  profile: WorkspaceProfile; saveCalls: Record<string, unknown>[];
  readCalls: Array<{ action: string; payload: unknown; activeSessionKey: string }>;
}> {
  return app.evaluate(() => {
    const owner = (globalThis as typeof globalThis & {
      __workspaceOwnerMock?: { profile: WorkspaceProfile; saveCalls: Record<string, unknown>[];
        readCalls: Array<{ action: string; payload: unknown; activeSessionKey: string }> };
    }).__workspaceOwnerMock;
    if (!owner) throw new Error('Workspace owner fixture is not installed.');
    return owner;
  });
}
