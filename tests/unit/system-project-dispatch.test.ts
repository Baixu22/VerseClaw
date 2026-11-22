// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSystemProjectDispatch } from '../../electron/services/system-project-dispatch';
import { ResourceFabric } from '../../electron/services/resource-fabric';
import type { WorkspaceProfile } from '../../shared/types/workspace';
import type { ProjectPlanDispatchPayload, SystemProjectDispatchPayload } from '../../shared/host-api/contract';

const owner = vi.hoisted(() => ({ profiles: [] as WorkspaceProfile[], paused: false, revision: 0, activeId: 'gamma' }));
vi.mock('../../electron/services/workspaces-api', () => ({ getProjectCoordinatorProfiles: async () => owner.profiles,
  getActiveWorkspaceProfile: async () => owner.profiles.find(p => p.id === owner.activeId),
  readSystemControl: async () => ({ paused: owner.paused, revision: owner.revision }) }));
const input = (id: string): SystemProjectDispatchPayload => ({ workspaceId: id, sessionKey: `agent:main:${id}`,
  expectedSessionGeneration: `g-${id}`, planId: `plan-${id}`, expectedRevision: 1, expectedChildId: `child-${id}`, expectedPolicyRevision: 0 });
function profiles(): WorkspaceProfile[] {
  return ['alpha', 'beta', 'gamma'].map(id => ({ id, name: id, rootPath: `D:/${id}`, permissionMode: 'fullAccess',
    agentId: 'main', activeSessionKey: `agent:main:${id}`, projectCoordinatorSessionKey: `agent:main:${id}`,
    createdAt: 1, updatedAt: 1, lastOpenedAt: 1, state: {}, coordinatorBindings: { [`agent:main:${id}`]: {
      schemaVersion: 1, workspaceId: id, sessionKey: `agent:main:${id}`, sessionGeneration: `g-${id}`, agentId: 'main',
      bindingRevision: 1, state: 'active', invalidationReason: null, taskLedgerReferences: [], archiveRestorePolicy: 'restore',
      createdAt: '', updatedAt: '', environment: { kind: 'local', canonicalRoot: `D:/${id}`, backend: 'local-workspace', branch: null, detachedHead: false, setupProfile: null },
    } } }));
}
describe('system dispatch admission', () => {
  beforeEach(() => { owner.profiles = profiles(); owner.paused = false; owner.revision = 0; });
  it('admits three projects in order and isolates one rejected project without duplicate concurrent calls', async () => {
    const order: string[] = []; let release!: () => void;
    const barrier = new Promise<void>(done => { release = done; });
    const dispatch = vi.fn(async (p: ProjectPlanDispatchPayload) => {
      order.push(p.workspaceId);
      if (p.workspaceId === 'alpha') await barrier;
      return { success: p.workspaceId !== 'beta', status: p.workspaceId === 'beta' ? 'rejected' as const : 'accepted' as const };
    });
    const fabric = new ResourceFabric();
    const run = createSystemProjectDispatch(dispatch, fabric);
    const earlyFailures: string[] = [];
    const observe = (id: string) => run(input(id)).then(result => { if (result.error) earlyFailures.push(result.error); return result; });
    const a = observe('alpha'), duplicate = observe('alpha'), b = observe('beta'), c = observe('gamma');
    await vi.waitFor(() => expect(JSON.stringify({ order, earlyFailures })).toBe(JSON.stringify({ order: ['alpha'], earlyFailures: [] })));
    expect(fabric.getDiagnostics().accounts.projectDispatch).toMatchObject({ active: 1, queued: 2 });
    release();
    expect((await Promise.all([a, duplicate, b, c])).map(r => r.success)).toEqual([true, true, false, true]);
    expect(order).toEqual(['alpha', 'beta', 'gamma']);
    expect(fabric.getDiagnostics().accounts.projectDispatch).toMatchObject({ active: 0, queued: 0 });
    fabric.resetForTest();
  });
  it('rechecks global pause after a queued lease is granted', async () => {
    const fabric = new ResourceFabric(); const lease = await fabric.acquire('projectDispatch', 'system');
    const dispatch = vi.fn(); const run = createSystemProjectDispatch(dispatch, fabric);
    const queued = run(input('alpha'));
    await vi.waitFor(() => expect(fabric.getDiagnostics().accounts.projectDispatch.queued).toBe(1));
    owner.paused = true; owner.revision++;
    lease.release();
    expect(await queued).toMatchObject({ success: false, status: 'rejected', error: 'SYSTEM_DISPATCH_PAUSED_OR_CHANGED' });
    expect(dispatch).not.toHaveBeenCalled(); fabric.resetForTest();
  });
  it('refuses foreign coordinator identity and stale policy before reserving', async () => {
    const dispatch = vi.fn(); const fabric = new ResourceFabric(); const run = createSystemProjectDispatch(dispatch, fabric);
    expect(await run({ ...input('alpha'), sessionKey: 'agent:main:beta' })).toMatchObject({ success: false });
    expect(await run({ ...input('alpha'), expectedPolicyRevision: 9 })).toMatchObject({ success: false });
    expect(dispatch).not.toHaveBeenCalled(); expect(fabric.getDiagnostics().accounts).toEqual({});
  });
});
