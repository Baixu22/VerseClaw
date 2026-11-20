// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceProfile } from '../../shared/types/workspace';
import { systemProjectOwnerKey, type SystemProjectSnapshot } from '../../shared/types/system-portfolio';
import { useSystemPortfolioStore } from '../../src/stores/system-portfolio';

const api = vi.hoisted(() => ({ portfolio: vi.fn(), projectSummary: vi.fn() }));
vi.mock('@/lib/host-api', () => ({ hostApi: { workspaces: api } }));
function profile(id: string): WorkspaceProfile {
  return { id, name: id, rootPath: `/projects/${id}`, agentId: 'main', activeSessionKey: `session-${id}`,
    permissionMode: 'readOnly', createdAt: 1, updatedAt: 1, lastOpenedAt: 1, state: {} };
}
function observation(p: WorkspaceProfile, at = 1): SystemProjectSnapshot {
  return { scope: 'project', workspaceId: p.id as SystemProjectSnapshot['workspaceId'], ownerKey: systemProjectOwnerKey(p), observedAt: at,
    coordinator: { sessionKey: null, generation: null, bindingRevision: null, state: 'unbound' },
    plan: null, evidence: [], resources: { activeTaskClaims: null, pendingEffects: null, costUsd: null, observations: [] } };
}
function manifest(profiles: WorkspaceProfile[]) { return { scope: 'system', profiles: profiles.map(p => ({ id: p.id, name: p.name, ownerKey: systemProjectOwnerKey(p) })) }; }
function deferred<T>() {
  let resolve!: (value: T) => void;
  return { promise: new Promise<T>(r => { resolve = r; }), resolve: (value: T) => resolve(value) };
}
describe('system portfolio refresh', () => {
  beforeEach(() => { vi.resetAllMocks(); useSystemPortfolioStore.setState({ entries: {}, loading: false, unavailable: false }); });
  it('publishes each project independently, retains old observations on failure, and never activates a workspace', async () => {
    const a = profile('alpha'), b = profile('beta');
    const slow = deferred<SystemProjectSnapshot>();
    api.portfolio.mockResolvedValue(manifest([a, b]));
    api.projectSummary.mockImplementation(({ workspaceId }) => workspaceId === a.id ? Promise.resolve(observation(a)) : slow.promise);
    const pending = useSystemPortfolioStore.getState().refresh();
    await vi.waitFor(() => expect(useSystemPortfolioStore.getState().entries.alpha?.snapshot).toBeDefined());
    expect(useSystemPortfolioStore.getState().entries.beta.loading).toBe(true);
    slow.resolve(observation(b)); await pending;
    api.projectSummary.mockImplementation(({ workspaceId }) => workspaceId === a.id ? Promise.resolve(observation(a, 2)) : Promise.reject(new Error('disk unavailable')));
    await useSystemPortfolioStore.getState().refresh();
    expect(useSystemPortfolioStore.getState().entries.alpha.snapshot?.observedAt).toBe(2);
    expect(useSystemPortfolioStore.getState().entries.beta).toMatchObject({ unavailable: true, snapshot: { observedAt: 1 } });
  });
  it('ignores a late response from a replaced project root', async () => {
    const a = profile('alpha'), slow = deferred<SystemProjectSnapshot>();
    api.portfolio.mockResolvedValueOnce(manifest([a])); api.projectSummary.mockReturnValueOnce(slow.promise);
    const old = useSystemPortfolioStore.getState().refresh();
    await vi.waitFor(() => expect(api.projectSummary).toHaveBeenCalledOnce());
    const next = { ...a, rootPath: '/new-project' };
    api.portfolio.mockResolvedValueOnce(manifest([next])); api.projectSummary.mockResolvedValueOnce(observation(next, 2));
    await useSystemPortfolioStore.getState().refresh();
    slow.resolve(observation(a)); await old;
    expect(useSystemPortfolioStore.getState().entries.alpha.snapshot).toEqual(observation(next, 2));
  });
  it('rejects a response for another project and keeps successful entries when the list fails', async () => {
    const a = profile('alpha'), b = profile('beta');
    api.portfolio.mockResolvedValueOnce(manifest([a, b]));
    api.projectSummary.mockResolvedValue(observation(a));
    await useSystemPortfolioStore.getState().refresh();
    expect(useSystemPortfolioStore.getState().entries.beta).toMatchObject({ unavailable: true, snapshot: undefined });
    api.portfolio.mockRejectedValueOnce(new Error('unavailable'));
    await useSystemPortfolioStore.getState().refresh();
    expect(useSystemPortfolioStore.getState()).toMatchObject({ unavailable: true, entries: { alpha: { snapshot: observation(a) } } });
  });
});
