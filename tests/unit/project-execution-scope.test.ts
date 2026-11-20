// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceProfile } from '../../shared/types/workspace';
import { getExecutionWorkspaceProfile, runWithProjectExecutionScope } from '../../electron/services/project-execution-scope';
import { normalizeSystemControl } from '../../shared/types/system-control';

const owner = vi.hoisted(() => ({ profiles: [] as WorkspaceProfile[], activeId: 'beta', paused: false, revision: 0 }));
vi.mock('../../electron/services/workspaces-api', () => ({
  getProjectCoordinatorProfiles: async () => owner.profiles,
  getActiveWorkspaceProfile: async () => owner.profiles.find(p => p.id === owner.activeId),
  readSystemControl: async () => ({ paused: owner.paused, revision: owner.revision }),
}));
export function scopedProject(id: string): WorkspaceProfile {
  const sessionKey = `agent:main:${id}`;
  return { id, name: id, rootPath: `D:/${id}`, permissionMode: 'readOnly', agentId: 'main', activeSessionKey: sessionKey,
    projectCoordinatorSessionKey: sessionKey, createdAt: 1, updatedAt: 1, lastOpenedAt: 1, state: {},
    coordinatorBindings: { [sessionKey]: { schemaVersion: 1, workspaceId: id, sessionKey, sessionGeneration: `g-${id}`,
      agentId: 'main', bindingRevision: 1, state: 'active', invalidationReason: null, taskLedgerReferences: [],
      archiveRestorePolicy: 'restore', createdAt: '', updatedAt: '', environment: { kind: 'local', canonicalRoot: `D:/${id}`,
        backend: 'local-workspace', branch: null, detachedHead: false, setupProfile: null } } } };
}
describe('trusted project execution scope', () => {
  beforeEach(() => { owner.profiles = [scopedProject('alpha'), scopedProject('beta')]; owner.activeId = 'beta'; owner.paused = false; owner.revision = 0; });
  it('pins an inactive project policy without changing UI workspace or leaking concurrent contexts', async () => {
    const seen = await Promise.all(owner.profiles.map(p => runWithProjectExecutionScope(p, p.activeSessionKey, `g-${p.id}`, 0, async () => {
      await Promise.resolve(); return (await getExecutionWorkspaceProfile())?.id;
    })));
    expect(seen).toEqual(['alpha', 'beta']);
    expect((await getExecutionWorkspaceProfile())?.id).toBe('beta');
    expect(owner.activeId).toBe('beta');
  });
  it.each(['permission', 'root', 'generation', 'duplicate', 'pause', 'revision'])('rejects a changed %s before consuming its scope', async change => {
    const p = owner.profiles[0];
    await runWithProjectExecutionScope(p, p.activeSessionKey, 'g-alpha', 0, async () => {
      if (change === 'permission') p.permissionMode = 'fullAccess';
      if (change === 'root') p.rootPath = 'D:/different';
      if (change === 'generation') p.coordinatorBindings![p.activeSessionKey].sessionGeneration = 'replacement';
      if (change === 'duplicate') owner.profiles[1].projectCoordinatorSessionKey = p.activeSessionKey;
      if (change === 'pause') owner.paused = true;
      if (change === 'revision') owner.revision++;
      await expect(getExecutionWorkspaceProfile()).rejects.toThrow(/SYSTEM_/);
    });
  });
  it('rejects corrupt policy values instead of normalizing them to unpaused', () => {
    expect(normalizeSystemControl(undefined).paused).toBe(false);
    expect(() => normalizeSystemControl({ paused: 'false' })).toThrow('SYSTEM_CONTROL_UNAVAILABLE');
  });
});
