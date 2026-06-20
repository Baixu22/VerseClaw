import { beforeEach, describe, expect, it, vi } from 'vitest';

const { readAgentBootstrapToolsMock } = vi.hoisted(() => ({
  readAgentBootstrapToolsMock: vi.fn(),
}));

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

describe('mcp api registry', () => {
  beforeEach(() => {
    storeState.servers = [];
    readAgentBootstrapToolsMock.mockResolvedValue({
      defaultSkillIds: [],
      defaultMcpServerIds: [],
    });
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
      message: 'ClawX Git tools are available through the host Git service.',
    });

    const updated = await api.updateServer({ id: 'filesystem', enabled: false });
    expect(updated.servers).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'filesystem', enabled: false }),
    ]));

    await expect(api.resolveForContext({ agentId: 'main' })).resolves.toMatchObject({
      success: true,
      servers: [{ id: 'clawx-git' }],
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
      servers: [{ id: 'clawx-git' }],
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
      'global',
      'agent-default',
      'agent-owned',
      'workspace',
    ]);
    expect(resolved.servers.map((server) => server.localAddress)).toEqual([
      'clawx://mcp/clawx-git',
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

  it('exposes the built-in ClawX Git MCP tool catalog', async () => {
    const { createMcpApi } = await import('@electron/services/mcp-api');
    const api = createMcpApi();

    await expect(api.listTools({ serverId: 'clawx-git' })).resolves.toMatchObject({
      success: true,
      serverId: 'clawx-git',
      status: 'connected',
      tools: expect.arrayContaining([
        expect.objectContaining({ name: 'git_status' }),
        expect.objectContaining({ name: 'git_commit' }),
        expect.objectContaining({ name: 'github_pr_create' }),
      ]),
    });
  });

});
