import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isToolCallRequest, isToolCallResult } from '../../openclaw_runtime/src/runtime-core';
import type { McpToolProviderRegistryShadowRecord } from '@electron/services/tool-provider-registry';
import type { McpToolCallShadowRecord } from '@electron/services/tool-protocol-shadow';

const { readAgentBootstrapToolsMock } = vi.hoisted(() => ({
  readAgentBootstrapToolsMock: vi.fn(),
}));

const { createGitApiMock, gitApiMock } = vi.hoisted(() => {
  const gitApi = {
    status: vi.fn(),
    diff: vi.fn(),
    fileDiff: vi.fn(),
    stage: vi.fn(),
    unstage: vi.fn(),
    revertFile: vi.fn(),
    commit: vi.fn(),
    branches: vi.fn(),
    checkoutBranch: vi.fn(),
    createBranch: vi.fn(),
    stashList: vi.fn(),
    stashPush: vi.fn(),
    stashApply: vi.fn(),
    stashPop: vi.fn(),
    worktrees: vi.fn(),
    worktreeAdd: vi.fn(),
    worktreeRemove: vi.fn(),
    worktreePrune: vi.fn(),
    fetch: vi.fn(),
    pull: vi.fn(),
    push: vi.fn(),
    githubAuthStatus: vi.fn(),
    githubRepo: vi.fn(),
    prList: vi.fn(),
    prView: vi.fn(),
    prCreate: vi.fn(),
    openPr: vi.fn(),
  };
  return {
    createGitApiMock: vi.fn(() => gitApi),
    gitApiMock: gitApi,
  };
});

const storeState = vi.hoisted(() => ({
  servers: [] as unknown[],
}));

vi.mock('electron-store', () => {
  class MockStore {
    constructor(options?: { defaults?: { servers?: unknown[] } }) {
      if (storeState.servers.length === 0 && options?.defaults?.servers) {
        storeState.servers = [...options.defaults.servers];
      }
    }

    get(key: string) {
      return key === 'servers' ? storeState.servers : undefined;
    }

    set(key: string, value: unknown) {
      if (key === 'servers') {
        storeState.servers = Array.isArray(value) ? [...value] : [];
      }
    }
  }

  return { default: MockStore };
});

vi.mock('@electron/utils/agent-config', () => ({
  readAgentBootstrapTools: (...args: unknown[]) => readAgentBootstrapToolsMock(...args),
}));

vi.mock('@electron/services/git-api', () => ({
  createGitApi: () => createGitApiMock(),
}));

describe('mcp api registry', () => {
  beforeEach(() => {
    storeState.servers = [];
    readAgentBootstrapToolsMock.mockResolvedValue({
      defaultSkillIds: [],
      defaultMcpServerIds: [],
    });
    createGitApiMock.mockClear();
    Object.values(gitApiMock).forEach((mock) => mock.mockReset());
  });

  it('creates, validates, updates, resolves, and deletes MCP servers', async () => {
    const { createMcpApi } = await import('@electron/services/mcp-api');
    const api = createMcpApi();

    const created = await api.createServer({
      name: 'Filesystem',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem'],
      enabled: true,
      scope: 'agent',
      ownerId: 'main',
    });
    expect(created.success).toBe(true);
    expect(created.servers).toEqual(expect.arrayContaining([expect.objectContaining({
        id: 'filesystem',
        localAddress: 'clawx://mcp/filesystem',
        transport: 'stdio',
        scope: 'agent',
        ownerId: 'main',
      })]));

    await expect(api.createServer({
      name: 'Broken',
      transport: 'stdio',
    })).rejects.toThrow('stdio MCP 服务必须配置命令');

    await expect(api.testServer({ id: 'filesystem' })).resolves.toMatchObject({
      success: true,
      server: {
        id: 'filesystem',
        localAddress: 'clawx://mcp/filesystem',
      },
    });

    await expect(api.testServer({ id: 'clawx-git' })).resolves.toMatchObject({
      success: true,
      server: {
        id: 'clawx-git',
        localAddress: 'clawx://mcp/clawx-git',
      },
      message: 'Verse Claw Git tools are available through the host Git service.',
    });

    const updated = await api.updateServer({ id: 'filesystem', enabled: false });
    expect(updated.servers).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'filesystem', enabled: false }),
    ]));

    await expect(api.resolveForContext({ agentId: 'main' })).resolves.toMatchObject({
      success: true,
      servers: [{ id: 'clawx-git' }, { id: 'clawx-storage' }],
      agentId: 'main',
    });

    await api.updateServer({ id: 'filesystem', enabled: true });
    const resolvedWithFilesystem = await api.resolveForContext({ agentId: 'main' });
    expect(resolvedWithFilesystem).toMatchObject({ success: true, agentId: 'main' });
    expect(resolvedWithFilesystem.servers).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'filesystem', localAddress: 'clawx://mcp/filesystem' }),
    ]));

    await expect(api.deleteServer({ id: 'filesystem' })).resolves.toMatchObject({
      success: true,
      servers: [{ id: 'clawx-git' }, { id: 'clawx-storage' }],
    });
  });

  it('resolves global, agent default, agent, and workspace servers in stable order', async () => {
    const { createMcpApi } = await import('@electron/services/mcp-api');
    const api = createMcpApi();

    await api.createServer({
      name: 'Workspace',
      transport: 'http',
      url: 'http://127.0.0.1:4000/mcp',
      scope: 'workspace',
      ownerId: 'workspace-a',
    });
    await api.createServer({
      name: 'Global',
      transport: 'stdio',
      command: 'global-mcp',
      scope: 'global',
    });
    await api.createServer({
      name: 'Agent Owned',
      transport: 'stdio',
      command: 'agent-owned',
      scope: 'agent',
      ownerId: 'main',
    });
    await api.createServer({
      name: 'Agent Default',
      transport: 'stdio',
      command: 'agent-default',
      scope: 'agent',
      ownerId: 'other',
    });
    readAgentBootstrapToolsMock.mockResolvedValue({
      defaultSkillIds: [],
      defaultMcpServerIds: ['agent-default'],
    });

    const resolved = await api.resolveForContext({ workspaceId: 'workspace-a', agentId: 'main' });

    expect(resolved.servers.map((server) => server.id)).toEqual([
      'clawx-git',
      'clawx-storage',
      'global',
      'agent-default',
      'agent-owned',
      'workspace',
    ]);
    expect(resolved.servers.map((server) => server.localAddress)).toEqual([
      'clawx://mcp/clawx-git',
      'clawx://mcp/clawx-storage',
      'clawx://mcp/global',
      'clawx://mcp/agent-default',
      'clawx://mcp/agent-owned',
      'clawx://mcp/workspace',
    ]);
  });

  it('hydrates persisted servers without local addresses', async () => {
    storeState.servers = [{
      id: 'legacy',
      name: 'Legacy',
      transport: 'stdio',
      command: 'legacy-mcp',
      enabled: true,
      scope: 'global',
      createdAt: 1,
      updatedAt: 1,
    }];

    const { createMcpApi } = await import('@electron/services/mcp-api');
    const api = createMcpApi();

    const listed = await api.listServers();
    expect(listed.success).toBe(true);
    expect(listed.servers).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'legacy', localAddress: 'clawx://mcp/legacy' }),
    ]));
    expect(storeState.servers).toMatchObject([
      { id: 'legacy', localAddress: 'clawx://mcp/legacy' },
    ]);
  });

  it('resolves MCP config and exposes runtime fallbacks without restarting Gateway', async () => {
    const { createMcpApiWithContext } = await import('@electron/services/mcp-api');
    const gatewayManager = {
      getStatus: vi.fn(() => ({ state: 'running' })),
      rpc: vi.fn(async () => {
        throw new Error('runtime method unavailable');
      }),
      debouncedReload: vi.fn(),
    };
    const api = createMcpApiWithContext({ gatewayManager: gatewayManager as never });

    await api.createServer({
      name: 'Http Local',
      transport: 'http',
      url: 'http://127.0.0.1:4000/mcp',
      networkPolicy: 'localOnly',
      scope: 'global',
    });

    expect(gatewayManager.debouncedReload).not.toHaveBeenCalled();
    expect(gatewayManager.rpc).toHaveBeenCalledWith(
      'mcp.reload',
      expect.objectContaining({
        servers: expect.any(Array),
      }),
      4000,
    );
    const reloadPayload = gatewayManager.rpc.mock.calls.find((call) => call[0] === 'mcp.reload')?.[1] as Record<string, unknown>;
    expect(reloadPayload.openclawServers).toBeUndefined();

    const listed = await api.listServers();
    expect(listed.servers.find((server) => server.id === 'http-local')).toMatchObject({
      transport: 'http',
      canonicalTransport: 'streamable-http',
      networkPolicy: 'localOnly',
    });

    await expect(api.listTools({ serverId: 'http-local' })).resolves.toMatchObject({
      success: true,
      serverId: 'http-local',
      tools: [],
      status: 'registered',
    });
    await expect(api.callTool({ serverId: 'http-local', toolName: 'demo' })).resolves.toMatchObject({
      success: false,
      blocked: true,
      serverId: 'http-local',
      toolName: 'demo',
    });
  });

  it('emits MCP tool-call shadows for successful runtime calls without changing the legacy response shape', async () => {
    const { createMcpApiWithContext } = await import('@electron/services/mcp-api');
    const shadows: McpToolCallShadowRecord[] = [];
    const legacy = {
      success: true,
      serverId: 'http-local',
      toolName: 'demo',
      result: { content: [{ type: 'text', text: 'ok' }] },
    };
    const gatewayManager = {
      getStatus: vi.fn(() => ({ state: 'running' })),
      rpc: vi.fn(async () => legacy),
    };
    const api = createMcpApiWithContext({
      gatewayManager: gatewayManager as never,
      runtime: { toolProtocol: { mcpShadow: true } },
      toolProtocolShadowSink: (record) => shadows.push(record),
    });

    const result = await api.callTool({
      serverId: 'http-local',
      toolName: 'demo',
      args: { value: 42 },
      workspaceId: 'workspace-a',
      agentId: 'main',
    });

    expect(result).toBe(legacy);
    expect(JSON.stringify(result)).toBe(JSON.stringify(legacy));
    expect(Object.keys(result)).toEqual(['success', 'serverId', 'toolName', 'result']);
    expect(shadows).toHaveLength(2);
    expect(shadows[0]).toMatchObject({
      kind: 'tool_call.request',
      schemaVersion: 1,
      protocol: 'mcp',
      operation: 'mcp.callTool',
      target: { serverId: 'http-local', toolName: 'demo' },
      request: {
        callId: expect.any(String),
        taskId: 'workspace:workspace-a',
        toolName: 'demo',
        args: { value: 42 },
        permissionContext: {
          protocol: 'mcp',
          operation: 'mcp.callTool',
          serverId: 'http-local',
          toolName: 'demo',
          workspaceId: 'workspace-a',
          agentId: 'main',
        },
      },
    });
    expect(shadows[0].kind === 'tool_call.request' && isToolCallRequest(shadows[0].request)).toBe(true);
    expect(shadows[1]).toMatchObject({
      kind: 'tool_call.result',
      schemaVersion: 1,
      protocol: 'mcp',
      operation: 'mcp.callTool',
      target: { serverId: 'http-local', toolName: 'demo' },
      result: {
        callId: shadows[0].kind === 'tool_call.request' ? shadows[0].request.callId : expect.any(String),
        status: 'success',
        structuredData: legacy.result,
      },
      shadow: {
        status: 'success',
        reason: { code: 'success' },
      },
    });
    expect(shadows[1].kind === 'tool_call.result' && isToolCallResult(shadows[1].result)).toBe(true);
  });

  it('does not emit MCP tool-call shadows when the feature flag is off', async () => {
    const { createMcpApiWithContext } = await import('@electron/services/mcp-api');
    const legacy = {
      success: true,
      serverId: 'http-local',
      toolName: 'demo',
      result: { content: [{ type: 'text', text: 'ok' }] },
    };
    const sink = vi.fn();
    const gatewayManager = {
      getStatus: vi.fn(() => ({ state: 'running' })),
      rpc: vi.fn(async () => legacy),
    };
    const api = createMcpApiWithContext({
      gatewayManager: gatewayManager as never,
      runtime: { toolProtocol: { mcpShadow: false } },
      toolProtocolShadowSink: sink,
    });

    const result = await api.callTool({ serverId: 'http-local', toolName: 'demo' });

    expect(result).toBe(legacy);
    expect(JSON.stringify(result)).toBe(JSON.stringify(legacy));
    expect(Object.keys(result)).toEqual(['success', 'serverId', 'toolName', 'result']);
    expect(sink).not.toHaveBeenCalled();
  });

  it('maps MCP failure and thrown errors to ToolCallResult shadows', async () => {
    const {
      createMcpToolCallRequestShadow,
      createMcpToolCallResultShadow,
      createMcpToolCallThrownErrorShadow,
    } = await import('@electron/services/tool-protocol-shadow');
    const request = createMcpToolCallRequestShadow({
      serverId: 'http-local',
      toolName: 'demo',
      args: {},
    });

    const failureShadow = createMcpToolCallResultShadow(request, {
      success: false,
      serverId: 'http-local',
      toolName: 'demo',
      error: 'tool exploded',
    });
    expect(failureShadow).toMatchObject({
      kind: 'tool_call.result',
      result: {
        callId: request.request.callId,
        status: 'error',
        error: { type: 'tool', message: 'tool exploded' },
      },
      shadow: {
        status: 'error',
        reason: { code: 'tool/error', message: 'tool exploded' },
      },
    });
    expect(isToolCallResult(failureShadow.result)).toBe(true);

    const thrownShadow = createMcpToolCallThrownErrorShadow(request, new Error('transport exploded'));
    expect(thrownShadow).toMatchObject({
      kind: 'tool_call.result',
      result: {
        callId: request.request.callId,
        status: 'error',
        error: { type: 'runtime', message: 'transport exploded' },
      },
      shadow: {
        status: 'error',
        reason: { code: 'exception', message: 'transport exploded' },
      },
    });
    expect(isToolCallResult(thrownShadow.result)).toBe(true);
  });

  it('maps approval-required MCP results as permission waiting shadows', async () => {
    const {
      createMcpToolCallRequestShadow,
      createMcpToolCallResultShadow,
    } = await import('@electron/services/tool-protocol-shadow');
    const request = createMcpToolCallRequestShadow({
      serverId: 'clawx-git',
      toolName: 'git_push',
      args: {},
    });

    const waitingShadow = createMcpToolCallResultShadow(request, {
      success: false,
      serverId: 'clawx-git',
      toolName: 'git_push',
      blocked: true,
      approvalRequired: true,
      approvalId: 'approval-push',
      reason: 'Needs permission',
    });
    expect(waitingShadow).toMatchObject({
      result: {
        callId: request.request.callId,
        status: 'error',
        structuredData: {
          shadowState: 'waiting',
          reasonCode: 'permission/waiting',
          approval: { required: true, state: 'waiting', approvalId: 'approval-push' },
        },
        error: { type: 'permission', message: 'Needs permission', retryable: true },
      },
      shadow: {
        status: 'waiting',
        reason: { code: 'permission/waiting', state: 'waiting', message: 'Needs permission' },
        approval: { required: true, state: 'waiting', approvalId: 'approval-push' },
      },
    });
    expect(isToolCallResult(waitingShadow.result)).toBe(true);
  });

  it('maps gateway unavailable MCP fallback to a blocked shadow without changing the legacy fallback shape', async () => {
    const { createMcpApiWithContext } = await import('@electron/services/mcp-api');
    const shadows: McpToolCallShadowRecord[] = [];
    const api = createMcpApiWithContext({
      runtime: { toolProtocol: { mcpShadow: true } },
      toolProtocolShadowSink: (record) => shadows.push(record),
    });

    const result = await api.callTool({ serverId: 'http-local', toolName: 'demo' });

    expect(result).toMatchObject({
      success: false,
      blocked: true,
      serverId: 'http-local',
      toolName: 'demo',
    });
    expect(JSON.stringify(result)).toBe(
      `{"success":false,"serverId":"http-local","toolName":"demo","blocked":true,"reason":${JSON.stringify(result.reason)}}`,
    );
    expect(Object.keys(result)).toEqual(['success', 'serverId', 'toolName', 'blocked', 'reason']);
    expect(shadows[1]).toMatchObject({
      kind: 'tool_call.result',
      target: { serverId: 'http-local', toolName: 'demo' },
      result: {
        status: 'error',
        error: { type: 'runtime' },
        structuredData: { shadowState: 'blocked', reasonCode: 'gateway/unavailable' },
      },
      shadow: {
        status: 'blocked',
        reason: { code: 'gateway/unavailable' },
      },
    });
    expect(shadows[1].kind === 'tool_call.result' && isToolCallResult(shadows[1].result)).toBe(true);

    const blockedShadows: McpToolCallShadowRecord[] = [];
    const gatewayManager = {
      getStatus: vi.fn(() => ({ state: 'running' })),
      rpc: vi.fn(async () => {
        throw new Error('runtime method unavailable');
      }),
    };
    const blockedApi = createMcpApiWithContext({
      gatewayManager: gatewayManager as never,
      runtime: { toolProtocol: { mcpShadow: true } },
      toolProtocolShadowSink: (record) => blockedShadows.push(record),
    });

    await expect(blockedApi.callTool({ serverId: 'http-local', toolName: 'demo' })).resolves.toMatchObject({
      success: false,
      blocked: true,
      serverId: 'http-local',
      toolName: 'demo',
    });
    expect(blockedShadows[1]).toMatchObject({
      kind: 'tool_call.result',
      target: { serverId: 'http-local', toolName: 'demo' },
      result: {
        status: 'error',
        error: { type: 'tool' },
        structuredData: { shadowState: 'blocked', reasonCode: 'tool/blocked' },
      },
      shadow: {
        status: 'blocked',
        reason: { code: 'tool/blocked' },
      },
    });
    expect(blockedShadows[1].kind === 'tool_call.result' && isToolCallResult(blockedShadows[1].result)).toBe(true);
  });

  it('exposes the built-in Verse Claw Git MCP tool catalog', async () => {
    const { createMcpApi } = await import('@electron/services/mcp-api');
    const api = createMcpApi();

    await expect(api.listTools({ serverId: 'clawx-git' })).resolves.toMatchObject({
      success: true,
      serverId: 'clawx-git',
      status: 'connected',
      tools: expect.arrayContaining([
        expect.objectContaining({ name: 'git_status' }),
        expect.objectContaining({ name: 'git_diff' }),
        expect.objectContaining({ name: 'git_commit' }),
        expect.objectContaining({ name: 'git_branch_list' }),
        expect.objectContaining({ name: 'git_worktree_add' }),
        expect.objectContaining({ name: 'git_worktree_remove' }),
        expect.objectContaining({ name: 'git_push' }),
        expect.objectContaining({ name: 'github_auth_status' }),
        expect.objectContaining({ name: 'github_pr_view' }),
        expect.objectContaining({ name: 'github_pr_create' }),
      ]),
    });
  });

  it('routes built-in Git MCP calls through the host Git service', async () => {
    gitApiMock.branches.mockResolvedValue({ success: true, branches: [{ name: 'main', current: true }] });
    gitApiMock.unstage.mockResolvedValue({ success: true });
    gitApiMock.revertFile.mockResolvedValue({
      success: false,
      blocked: true,
      approvalRequired: true,
      approval: { id: 'approval-revert' },
    });
    gitApiMock.worktreeAdd.mockResolvedValue({ success: true });
    gitApiMock.worktreeRemove.mockResolvedValue({ success: true });
    gitApiMock.push.mockResolvedValue({ success: false, blocked: true, approvalRequired: true });
    gitApiMock.prView.mockResolvedValue({ success: true, pullRequest: { number: 12, title: 'Ship it', state: 'OPEN' } });
    gitApiMock.prCreate.mockResolvedValue({ success: true, pullRequest: { number: 13, title: 'Ship Git panel', state: 'OPEN' } });

    const { createMcpApi } = await import('@electron/services/mcp-api');
    const api = createMcpApi();

    await expect(api.callTool({ serverId: 'clawx-git', toolName: 'git_branch_list' })).resolves.toMatchObject({
      success: true,
      result: { branches: [expect.objectContaining({ name: 'main' })] },
    });
    expect(gitApiMock.branches).toHaveBeenCalledTimes(1);

    await expect(api.callTool({
      serverId: 'clawx-git',
      toolName: 'git_unstage',
      args: { paths: ['src/app.ts'] },
    })).resolves.toMatchObject({ success: true, result: { success: true } });
    expect(gitApiMock.unstage).toHaveBeenCalledWith({ paths: ['src/app.ts'], approvalId: undefined });

    await expect(api.callTool({
      serverId: 'clawx-git',
      toolName: 'git_revert_file',
      args: { path: 'src/app.ts' },
      approvalId: 'approval-revert',
    })).resolves.toMatchObject({ success: true, result: { approvalRequired: true } });
    expect(gitApiMock.revertFile).toHaveBeenCalledWith({ path: 'src/app.ts', approvalId: 'approval-revert' });

    await expect(api.callTool({
      serverId: 'clawx-git',
      toolName: 'git_worktree_add',
      args: { branch: 'feature/worktree', checkoutNewBranch: true, startPoint: 'main' },
    })).resolves.toMatchObject({ success: true, result: { success: true } });
    expect(gitApiMock.worktreeAdd).toHaveBeenCalledWith({
      branch: 'feature/worktree',
      path: undefined,
      startPoint: 'main',
      checkoutNewBranch: true,
      approvalId: undefined,
    });

    await expect(api.callTool({
      serverId: 'clawx-git',
      toolName: 'git_worktree_remove',
      args: { path: '/workspace/demo-feature' },
      approvalId: 'approval-remove',
    })).resolves.toMatchObject({ success: true, result: { success: true } });
    expect(gitApiMock.worktreeRemove).toHaveBeenCalledWith({ path: '/workspace/demo-feature', approvalId: 'approval-remove' });

    await expect(api.callTool({
      serverId: 'clawx-git',
      toolName: 'git_push',
      args: { remote: 'origin', branch: 'feature/worktree', setUpstream: true },
      approvalId: 'approval-push',
    })).resolves.toMatchObject({ success: true, result: { approvalRequired: true } });
    expect(gitApiMock.push).toHaveBeenCalledWith({
      remote: 'origin',
      branch: 'feature/worktree',
      setUpstream: true,
      approvalId: 'approval-push',
    });

    await expect(api.callTool({
      serverId: 'clawx-git',
      toolName: 'github_pr_view',
      args: { number: 12 },
    })).resolves.toMatchObject({
      success: true,
      result: { pullRequest: expect.objectContaining({ number: 12 }) },
    });
    expect(gitApiMock.prView).toHaveBeenCalledWith({ number: 12 });

    await expect(api.callTool({
      serverId: 'clawx-git',
      toolName: 'github_pr_create',
      args: {
        title: 'Ship Git panel',
        body: 'Ready for review',
        base: 'main',
        head: 'feature/git-panel',
        draft: true,
      },
      approvalId: 'approval-pr-create',
    })).resolves.toMatchObject({
      success: true,
      result: { pullRequest: expect.objectContaining({ number: 13 }) },
    });
    expect(gitApiMock.prCreate).toHaveBeenCalledWith({
      title: 'Ship Git panel',
      body: 'Ready for review',
      base: 'main',
      head: 'feature/git-panel',
      draft: true,
      approvalId: 'approval-pr-create',
    });
  });

  it('emits built-in Git tool registry diagnostics through the existing MCP adapter seam', async () => {
    gitApiMock.status.mockResolvedValue({
      success: true,
      status: { isRepository: true, branch: 'main' },
    });
    const registryShadows: McpToolProviderRegistryShadowRecord[] = [];
    const { createMcpApiWithContext } = await import('@electron/services/mcp-api');
    const api = createMcpApiWithContext({
      runtime: { toolRegistry: { shadow: true } },
      toolProviderRegistryShadowSink: (record) => registryShadows.push(record),
    });

    const result = await api.callTool({ serverId: 'clawx-git', toolName: 'git_status' });

    expect(result).toMatchObject({
      success: true,
      serverId: 'clawx-git',
      toolName: 'git_status',
      result: { status: expect.objectContaining({ branch: 'main' }) },
    });
    expect(registryShadows[1]).toMatchObject({
      kind: 'tool_provider.result',
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          providerId: 'builtin-host-tool-compat',
          metadata: expect.objectContaining({
            builtInToolDiagnosticShape: true,
            noNewTransport: true,
            toolName: 'git_status',
          }),
        }),
      ]),
    });
  });

  it('smokes active workspace Git tools through the built-in MCP context', async () => {
    gitApiMock.status.mockResolvedValue({
      success: true,
      status: {
        isRepository: true,
        workspaceRoot: '/workspace/demo',
        repoRoot: '/workspace/demo',
        branch: 'feature/git',
        ahead: 1,
        behind: 0,
        clean: false,
        hasConflicts: false,
        stagedCount: 0,
        unstagedCount: 1,
        untrackedCount: 0,
        conflictedCount: 0,
        changes: [{
          path: 'src/demo.ts',
          absolutePath: '/workspace/demo/src/demo.ts',
          status: 'M',
          staged: false,
          unstaged: true,
          untracked: false,
          conflicted: false,
          bucket: 'unstaged',
          additions: 2,
          deletions: 1,
        }],
      },
    });
    gitApiMock.worktrees.mockResolvedValue({
      success: true,
      worktrees: [
        { path: '/workspace/demo', branch: 'feature/git', head: 'abc123' },
        { path: '/workspace/demo-feature-a', branch: 'feature/a', head: 'def456' },
      ],
    });
    gitApiMock.push.mockResolvedValue({
      success: false,
      blocked: true,
      approvalRequired: true,
      approval: { id: 'approval-push' },
    });

    const { createMcpApi } = await import('@electron/services/mcp-api');
    const api = createMcpApi();

    await expect(api.resolveForContext({ workspaceId: 'workspace-a', agentId: 'main' })).resolves.toMatchObject({
      success: true,
      workspaceId: 'workspace-a',
      agentId: 'main',
      servers: [
        expect.objectContaining({
          id: 'clawx-git',
          scope: 'workspace',
          localAddress: 'clawx://mcp/clawx-git',
        }),
        expect.objectContaining({
          id: 'clawx-storage',
          scope: 'workspace',
          localAddress: 'clawx://mcp/clawx-storage',
        }),
      ],
    });

    await expect(api.listTools({ serverId: 'clawx-git' })).resolves.toMatchObject({
      success: true,
      tools: expect.arrayContaining([
        expect.objectContaining({ name: 'git_status' }),
        expect.objectContaining({ name: 'git_worktree_list' }),
        expect.objectContaining({ name: 'git_push' }),
      ]),
    });

    await expect(api.callTool({ serverId: 'clawx-git', toolName: 'git_status' })).resolves.toMatchObject({
      success: true,
      result: { status: expect.objectContaining({ branch: 'feature/git' }) },
    });
    await expect(api.callTool({ serverId: 'clawx-git', toolName: 'git_worktree_list' })).resolves.toMatchObject({
      success: true,
      result: { worktrees: expect.arrayContaining([expect.objectContaining({ branch: 'feature/git' })]) },
    });
    await expect(api.callTool({
      serverId: 'clawx-git',
      toolName: 'git_push',
      args: { remote: 'origin', branch: 'feature/git' },
      approvalId: 'approval-push',
    })).resolves.toMatchObject({
      success: true,
      result: { approvalRequired: true },
    });
    expect(gitApiMock.push).toHaveBeenCalledWith({
      remote: 'origin',
      branch: 'feature/git',
      setUpstream: false,
      approvalId: 'approval-push',
    });
  });

});
