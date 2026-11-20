// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceProfile } from '../../shared/types/workspace';
import { systemProjectOwnerKey } from '../../shared/types/system-portfolio';
import { projectConfigurationValues, type ProjectConfigDocument, type ProjectConfigurationApply } from '../../shared/project-configuration';
import { createProjectConfigurationOperator, type ConfigurationOperation } from '../../electron/services/project-configuration-operator';

const state = vi.hoisted(() => ({ config: {} as ProjectConfigDocument, runtime: {} as ProjectConfigDocument,
  profiles: [] as WorkspaceProfile[], operations: {} as Record<string, ConfigurationOperation>, writes: 0 }));
vi.mock('../../electron/utils/channel-config', () => ({ readOpenClawConfig: async () => structuredClone(state.config),
  writeOpenClawConfig: async (config: ProjectConfigDocument) => { state.writes++; state.config = structuredClone(config); } }));
vi.mock('../../electron/utils/config-mutex', () => ({ withConfigLock: async (execute: () => Promise<unknown>) => execute() }));
vi.mock('../../electron/gateway/generation', () => ({ getCurrentGatewayGeneration: () => 'gateway-g' }));
vi.mock('../../electron/services/workspaces-api', () => ({ getProjectCoordinatorProfiles: async () => structuredClone(state.profiles),
  readProjectConfigurationOperations: async () => structuredClone(state.operations),
  saveProjectConfigurationOperations: async (operations: Record<string, ConfigurationOperation>) => { state.operations = structuredClone(operations); },
  withProjectConfigurationOwner: async (id: string, key: string, execute: () => Promise<unknown>) => {
    if (systemProjectOwnerKey(state.profiles.find(p => p.id === id)!) !== key) throw new Error('CONFIG_PROJECT_OWNER_CHANGED');
    return execute();
  } }));

describe('typed project configuration operator', () => {
  const rpc = vi.fn(), restart = vi.fn();
  const api = () => createProjectConfigurationOperator({ rpc, restart });
  const input = () => ({ workspaceId: 'project', ownerKey: systemProjectOwnerKey(state.profiles[0]),
    patch: { modelRef: 'known/cheaper', denyTools: ['browser', 'exec'], contextTokens: 4096 } });
  async function prepared(requestId = 'operation-1'): Promise<ProjectConfigurationApply> {
    const request = input(), preview = await api().preview(request);
    return { ...request, requestId, configRevision: preview.configRevision, digest: preview.digest };
  }
  beforeEach(() => {
    vi.clearAllMocks(); state.writes = 0; state.operations = {};
    const key = 'agent:dedicated:main';
    state.profiles = [{ id: 'project', name: 'Project', rootPath: 'D:/project', agentId: 'dedicated', activeSessionKey: key,
      projectCoordinatorSessionKey: key, permissionMode: 'fullAccess', createdAt: 1, updatedAt: 1, lastOpenedAt: 1, state: {},
      coordinatorBindings: { [key]: { schemaVersion: 1, workspaceId: 'project', agentId: 'dedicated', sessionKey: key,
        sessionGeneration: 'g', bindingRevision: 1, state: 'active', invalidationReason: null, taskLedgerReferences: [],
        archiveRestorePolicy: 'restore', createdAt: '', updatedAt: '', environment: { kind: 'local', canonicalRoot: 'D:/project',
          backend: 'local-workspace', branch: null, detachedHead: false, setupProfile: null } } } }];
    state.config = { agents: { list: [{ id: 'dedicated', model: { primary: 'known/current' }, tools: { deny: ['browser'] }, contextTokens: 8192 }] },
      models: { providers: { known: { models: ['current', 'cheaper', 'expensive'].map((id, index) => ({ id,
        cost: { input: [2, 1, 3][index], output: [4, 2, 6][index], cacheRead: 1, cacheWrite: 1 } })) } } },
      channels: { fixture: { apiKey: 'private-do-not-export' } } };
    state.runtime = structuredClone(state.config);
    rpc.mockImplementation(async (method: string, payload: { projectAgentId?: string }) => {
      if (method === 'sessions.describe') return { session: { sessionId: 'g', hasActiveRun: false } };
      if (method === 'runtime.flags.ack') return { gatewayGeneration: 'gateway-g', projectConfiguration: {
        agentId: payload.projectAgentId, values: projectConfigurationValues(state.runtime, payload.projectAgentId!) } };
      throw new Error(method);
    });
    restart.mockImplementation(async () => { state.runtime = structuredClone(state.config); });
  });
  it('previews without writes and applies only after loaded Runtime readback', async () => {
    const request = await prepared();
    expect(state.writes).toBe(0); expect(state.operations).toEqual({}); expect(restart).not.toHaveBeenCalled();
    const result = await api().apply(request);
    expect(result).toMatchObject({ phase: 'applied', desired: { modelRef: 'known/cheaper', contextTokens: 4096 }, runtimeGeneration: 'gateway-g' });
    expect(result.configured).toEqual(result.effective);
    expect(JSON.stringify(state.operations)).not.toContain('private-do-not-export');
    expect(await api().apply(request)).toEqual(result); expect(restart).toHaveBeenCalledOnce();
  });
  it.each([{ apiKey: 'forbidden' }, { evaluator: false }, { permissionMode: 'fullAccess' }, { contextTokens: 16384 },
    { denyTools: [] }, { modelRef: 'known/expensive' }, { modelRef: 'unknown/model' }])('rejects schema or scope expansion %j before writing', async patch => {
    await expect(api().preview({ ...input(), patch } as never)).rejects.toThrow(/CONFIG_/);
    expect(state.writes).toBe(0); expect(state.operations).toEqual({});
  });
  it('rejects stale revision, shared agent ownership and same request id with different intent', async () => {
    const request = await prepared(); state.config.other = true;
    await expect(api().apply(request)).rejects.toThrow('CONFIG_PREVIEW_STALE');
    const valid = await prepared(); await api().apply(valid);
    await expect(api().apply({ ...valid, patch: { contextTokens: 1024 } })).rejects.toThrow('CONFIG_REQUEST_CONFLICT');
    state.profiles.push({ ...state.profiles[0], id: 'other-project' });
    await expect(api().preview(input())).rejects.toThrow('CONFIG_AGENT_SHARED_SCOPE');
  });
  it('restores previous fields and verifies rollback when Runtime reload fails', async () => {
    const before = structuredClone(state.config), request = await prepared();
    restart.mockRejectedValueOnce(new Error('injected reload failure'));
    const result = await api().apply(request);
    expect(result.phase).toBe('rolled-back'); expect(state.config).toEqual(before);
    expect(result.effective).toEqual(result.configured); expect(restart).toHaveBeenCalledTimes(2);
  });
  it('preserves a concurrent field edit and blocks later writes when rollback ownership is lost', async () => {
    const request = await prepared();
    restart.mockImplementationOnce(async () => { state.config.agents!.list![0].contextTokens = 2048; throw new Error('reload failed after another owner edit'); });
    expect((await api().apply(request)).phase).toBe('degraded');
    expect(state.config.agents!.list![0].contextTokens).toBe(2048);
    await expect(api().apply({ ...request, requestId: 'new-operation' })).rejects.toThrow('CONFIG_RECOVERY_REQUIRED');
    expect((await api().reconcile({ workspaceId: 'project', ownerKey: input().ownerKey, requestId: request.requestId })).phase).toBe('superseded');
    expect(state.config.agents!.list![0].contextTokens).toBe(2048);
    const next = { ...input(), patch: { contextTokens: 1024 } }, preview = await api().preview(next);
    expect((await api().apply({ ...next, requestId: 'after-reconcile', configRevision: preview.configRevision, digest: preview.digest })).phase).toBe('applied');
  });
  it('rolls back its context field while preserving another owner tool change', async () => {
    const base = { ...input(), patch: { contextTokens: 4096 } }, preview = await api().preview(base);
    const request = { ...base, requestId: 'quota-only', configRevision: preview.configRevision, digest: preview.digest };
    restart.mockImplementationOnce(async () => { state.config.agents!.list![0].tools!.deny = ['browser', 'write']; throw new Error('reload failed'); });
    expect((await api().apply(request)).phase).toBe('rolled-back');
    expect(state.config.agents!.list![0]).toMatchObject({ contextTokens: 8192, tools: { deny: ['browser', 'write'] } });
  });
  it('reconciles a persisted pending operation through the same request instead of writing twice', async () => {
    const request = await prepared(); await api().apply(request);
    state.operations[request.requestId].result.phase = 'pending'; const writes = state.writes;
    expect((await api().apply(request)).phase).toBe('applied'); expect(state.writes).toBe(writes);
  });
  it('detects retained assistant bindings on another workspace', async () => {
    state.profiles.push({ ...state.profiles[0], id: 'other', agentId: 'other-agent', coordinatorBindings: {},
      agentBindings: { dedicated: { workspaceId: 'other', agentId: 'dedicated', sessionKey: 'agent:dedicated:old' } } } as WorkspaceProfile);
    await expect(api().preview(input())).rejects.toThrow('CONFIG_AGENT_SHARED_SCOPE'); expect(state.writes).toBe(0);
  });
  it('preserves configured model fallbacks when changing the primary', async () => {
    state.config.agents!.list![0].model = { primary: 'known/current', fallbacks: ['known/cheaper'] };
    expect((await api().apply(await prepared())).phase).toBe('applied');
    expect(state.config.agents!.list![0].model).toEqual({ primary: 'known/cheaper', fallbacks: ['known/cheaper'] });
  });
  it('preserves inherited fallbacks when the agent had no model override', async () => {
    state.config.agents!.defaults = { model: { primary: 'known/current', fallbacks: ['known/backup'] } };
    delete state.config.agents!.list![0].model;
    expect((await api().apply(await prepared())).phase).toBe('applied');
    expect(state.config.agents!.list![0].model).toEqual({ primary: 'known/cheaper', fallbacks: ['known/backup'] });
  });
  it('restarts an offline Gateway before validating live recovery identity', async () => {
    const request = await prepared(); await api().apply(request); state.operations[request.requestId].result.phase = 'degraded';
    let connected = false;
    rpc.mockImplementation(async (method: string, payload: { projectAgentId?: string }) => {
      if (!connected) throw new Error('Gateway disconnected');
      if (method === 'sessions.describe') return { session: { sessionId: 'g', hasActiveRun: false } };
      return { gatewayGeneration: 'gateway-g', projectConfiguration: { agentId: payload.projectAgentId, values: projectConfigurationValues(state.config, 'dedicated') } };
    });
    restart.mockImplementation(async () => { connected = true; });
    expect((await api().reconcile({ workspaceId: 'project', ownerKey: input().ownerKey, requestId: request.requestId })).phase).toBe('applied');
  });
  it('refuses stale-owner replay then lets the current owner reconcile after a renderer restart', async () => {
    const request = await prepared(); await api().apply(request);
    state.operations[request.requestId].result.phase = 'pending'; restart.mockClear();
    state.profiles[0].coordinatorBindings!['agent:dedicated:main'].bindingRevision++;
    expect((await api().apply(request)).phase).toBe('degraded'); expect(restart).not.toHaveBeenCalled();
    expect((await api().reconcile({ workspaceId: 'project', ownerKey: systemProjectOwnerKey(state.profiles[0]), requestId: request.requestId })).phase).toBe('applied');
    expect(restart).toHaveBeenCalledOnce();
  });
});
