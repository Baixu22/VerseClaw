import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MCP_ENV_MASK,
  isMaskedEnvValue,
  redactMcpEnvMap,
} from '../../shared/mcp/secret-ref';
import {
  evaluateMcpNetworkPolicy,
  projectMcpSecurityFields,
} from '../../shared/mcp/runtime-projection';
import {
  filterToolsWithValidSchemas,
  isValidMcpToolInputSchema,
  validateToolArgsAgainstSchema,
} from '../../shared/mcp/tool-schema';
import {
  resetMcpEnvBrokerCryptoForTests,
  resolveMcpEnvMap,
  sealMcpEnvMap,
  setMcpEnvBrokerCryptoForTests,
} from '@electron/services/secrets/mcp-env-broker';

const storeState = vi.hoisted(() => ({
  servers: [] as unknown[],
  envSecrets: {} as Record<string, unknown>,
}));

vi.mock('electron-store', () => {
  class MockStore {
    get(key: string) {
      if (key === 'servers') return storeState.servers;
      if (key === 'envSecrets') return storeState.envSecrets;
      return undefined;
    }
    set(key: string, value: unknown) {
      if (key === 'servers') {
        storeState.servers = Array.isArray(value) ? [...value] : [];
      }
      if (key === 'envSecrets') {
        storeState.envSecrets = value && typeof value === 'object'
          ? { ...(value as Record<string, unknown>) }
          : {};
      }
    }
  }
  return { default: MockStore };
});

vi.mock('@electron/utils/agent-config', () => ({
  readAgentBootstrapTools: vi.fn(async () => ({
    defaultSkillIds: [],
    defaultMcpServerIds: [],
  })),
}));

vi.mock('@electron/services/git-api', () => ({
  createGitApi: () => ({
    status: vi.fn(async () => ({ clean: true })),
  }),
}));

vi.mock('@electron/utils/channel-config', () => ({
  readOpenClawConfig: vi.fn(async () => ({})),
  writeOpenClawConfig: vi.fn(async () => undefined),
}));

vi.mock('@electron/utils/config-mutex', () => ({
  withConfigLock: async <T>(fn: () => Promise<T>) => fn(),
}));

describe('P4-003 MCP runtime projection / schema / reload / secret broker', () => {
  beforeEach(async () => {
    storeState.servers = [];
    storeState.envSecrets = {};
    resetMcpEnvBrokerCryptoForTests();
    setMcpEnvBrokerCryptoForTests({
      isEncryptionAvailable: () => true,
      encryptString: (value: string) => Buffer.from(`enc:${value}`, 'utf8'),
      decryptString: (value: Buffer) => {
        const raw = value.toString('utf8');
        return raw.startsWith('enc:') ? raw.slice(4) : raw;
      },
    });
    const { writeOpenClawConfig } = await import('@electron/utils/channel-config');
    (writeOpenClawConfig as ReturnType<typeof vi.fn>).mockReset();
    (writeOpenClawConfig as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  });

  it('A1 projects permissionMode/sandbox/network/sslVerify/env into runtime config', () => {
    const projected = projectMcpSecurityFields({
      permissionMode: 'fullAccess',
      sandboxProfileId: 'profile-secure',
      networkPolicy: 'localOnly',
      sslVerify: true,
      headers: { Authorization: 'Bearer secret-token' },
      toolAllowlist: ['read_file'],
      env: { API_KEY: 'runtime-secret' },
      transport: 'http',
      url: 'http://127.0.0.1:9/mcp',
    }, { enabled: true, url: 'http://127.0.0.1:9/mcp' });

    expect(projected).toMatchObject({
      enabled: true,
      permissionMode: 'fullAccess',
      sandboxProfileId: 'profile-secure',
      networkPolicy: 'localOnly',
      sslVerify: true,
      ssl_verify: true,
      headers: { Authorization: 'Bearer secret-token' },
      env: { API_KEY: 'runtime-secret' },
      toolFilter: { include: ['read_file'] },
    });
  });

  it('A1 enforces networkPolicy matrix', () => {
    expect(evaluateMcpNetworkPolicy({
      transport: 'http',
      networkPolicy: 'disabled',
      url: 'http://127.0.0.1:1',
    }).allowed).toBe(false);

    expect(evaluateMcpNetworkPolicy({
      transport: 'http',
      networkPolicy: 'localOnly',
      url: 'https://evil.example/mcp',
    }).allowed).toBe(false);

    expect(evaluateMcpNetworkPolicy({
      transport: 'http',
      networkPolicy: 'localOnly',
      url: 'http://127.0.0.1:4000/mcp',
    }).allowed).toBe(true);

    expect(evaluateMcpNetworkPolicy({
      transport: 'http',
      networkPolicy: 'enabled',
      url: 'https://example.com/mcp',
    }).allowed).toBe(true);

    expect(evaluateMcpNetworkPolicy({
      transport: 'stdio',
      networkPolicy: 'disabled',
    }).allowed).toBe(true);
  });

  it('A2 reload fails closed when the openclaw.json mirror fails', async () => {
    const { createMcpApiWithContext } = await import('@electron/services/mcp-api');
    const { writeOpenClawConfig } = await import('@electron/utils/channel-config');
    const gatewayManager = {
      getStatus: vi.fn(() => ({ state: 'running' })),
      rpc: vi.fn(async () => {
        throw new Error('runtime method unavailable');
      }),
      debouncedReload: vi.fn(),
    };
    const api = createMcpApiWithContext({ gatewayManager: gatewayManager as never });

    (writeOpenClawConfig as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('mirror exploded'));
    const result = await api.reloadRuntime({});
    expect(result.success).toBe(false);
    expect(result.hotReloaded).toBe(false);
    expect(result.restartRequired).toBe(true);
    expect(String(result.error || result.message)).toMatch(/mirror exploded|failed/i);
    // A failed mirror never requests a gateway reload.
    expect(gatewayManager.debouncedReload).not.toHaveBeenCalled();
  });

  it('A2 create rolls back when the openclaw.json mirror rejects', async () => {
    const { createMcpApiWithContext } = await import('@electron/services/mcp-api');
    const { writeOpenClawConfig } = await import('@electron/utils/channel-config');
    const gatewayManager = {
      getStatus: vi.fn(() => ({ state: 'running' })),
      rpc: vi.fn(async () => {
        throw new Error('runtime method unavailable');
      }),
      debouncedReload: vi.fn(),
    };
    const api = createMcpApiWithContext({ gatewayManager: gatewayManager as never });

    (writeOpenClawConfig as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('no mirror'));
    await expect(api.createServer({
      name: 'Should Roll Back',
      transport: 'stdio',
      command: 'echo',
      enabled: true,
      scope: 'global',
    })).rejects.toThrow(/no mirror|rolled back|reload/i);

    const listed = await api.listServers();
    expect(listed.servers.some((server) => server.name === 'Should Roll Back')).toBe(false);
  });

  it('A2 reload mirrors security fields into openclaw.json and hot-reloads via config watcher', async () => {
    const { createMcpApiWithContext } = await import('@electron/services/mcp-api');
    const { writeOpenClawConfig } = await import('@electron/utils/channel-config');
    const gatewayManager = {
      getStatus: vi.fn(() => ({ state: 'running' })),
      rpc: vi.fn(async () => {
        throw new Error('runtime method unavailable');
      }),
      debouncedReload: vi.fn(),
    };
    const api = createMcpApiWithContext({ gatewayManager: gatewayManager as never });

    await api.createServer({
      name: 'Secure Server',
      transport: 'http',
      url: 'http://127.0.0.1:4100/mcp',
      networkPolicy: 'localOnly',
      permissionMode: 'readOnly',
      sandboxProfileId: 'sbx-1',
      sslVerify: true,
      env: { TOKEN: 'super-secret-token-value' },
      enabled: true,
      scope: 'global',
    });

    const reload = await api.reloadRuntime({});
    expect(reload.success).toBe(true);
    expect(reload.hotReloaded).toBe(true);
    // Runtime consumption is via the openclaw.json config watcher, not an RPC.
    expect(gatewayManager.rpc).not.toHaveBeenCalled();
    expect(gatewayManager.debouncedReload).toHaveBeenCalled();

    const mirrored = (writeOpenClawConfig as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as {
      mcp?: { servers?: Record<string, unknown> };
    };
    const custom = mirrored.mcp?.servers?.['secure-server'];
    expect(custom).toBeTruthy();
    expect(custom).toMatchObject({
      permissionMode: 'readOnly',
      sandboxProfileId: 'sbx-1',
      networkPolicy: 'localOnly',
      sslVerify: true,
      env: { TOKEN: 'super-secret-token-value' },
    });
    // ClawX bridge servers stay Main-local and never leak into runtime config.
    expect(Object.keys(mirrored.mcp?.servers ?? {})).not.toContain('clawx-git');
    expect(Object.keys(mirrored.mcp?.servers ?? {})).not.toContain('clawx-storage');
  });

  it('A3 never returns env plaintext to Renderer list/test surfaces', async () => {
    const { createMcpApiWithContext } = await import('@electron/services/mcp-api');
    const gatewayManager = {
      getStatus: vi.fn(() => ({ state: 'running' })),
      rpc: vi.fn(async () => ({ ok: true })),
    };
    const api = createMcpApiWithContext({ gatewayManager: gatewayManager as never });
    const canary = 'CANARY_MCP_ENV_PLAINTEXT_9f3a';

    await api.createServer({
      name: 'Secret Env Server',
      transport: 'stdio',
      command: 'npx',
      env: { API_KEY: canary, OTHER: 'visible-but-secret' },
      enabled: true,
      scope: 'global',
    });

    const listed = await api.listServers();
    const server = listed.servers.find((entry) => entry.name === 'Secret Env Server');
    expect(server?.env).toBeTruthy();
    expect(JSON.stringify(listed)).not.toContain(canary);
    expect(JSON.stringify(listed)).not.toContain('visible-but-secret');
    for (const value of Object.values(server?.env ?? {})) {
      expect(isMaskedEnvValue(String(value)) || value === MCP_ENV_MASK).toBe(true);
    }

    const tested = await api.testServer({ id: server!.id });
    expect(JSON.stringify(tested)).not.toContain(canary);

    // Vault holds sealed secret; runtime resolve recovers plaintext only in Main.
    const sealed = await sealMcpEnvMap({
      serverId: 'demo',
      env: { K: canary },
      vault: {},
    });
    const resolved = await resolveMcpEnvMap(sealed.env, sealed.vault);
    expect(resolved).toEqual({ K: canary });
    expect(redactMcpEnvMap(sealed.env)?.K).toBe(MCP_ENV_MASK);
  });

  it('A4 rejects invalid tool schemas and non-conforming args', async () => {
    expect(isValidMcpToolInputSchema({ type: 'string' }).ok).toBe(false);
    expect(isValidMcpToolInputSchema({ type: 'object', properties: {} }).ok).toBe(true);

    const filtered = filterToolsWithValidSchemas([
      { name: 'good', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
      { name: 'bad', inputSchema: { type: 'string' } },
    ]);
    expect(filtered.tools.map((tool) => tool.name)).toEqual(['good']);
    expect(filtered.rejected[0]?.name).toBe('bad');

    expect(validateToolArgsAgainstSchema(
      { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false },
      {},
    ).ok).toBe(false);

    expect(validateToolArgsAgainstSchema(
      { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false },
      { path: '/tmp/a', extra: 1 },
    ).ok).toBe(false);

    expect(validateToolArgsAgainstSchema(
      { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false },
      { path: '/tmp/a' },
    ).ok).toBe(true);

    const { createMcpApi } = await import('@electron/services/mcp-api');
    const api = createMcpApi();
    await expect(api.callTool({
      serverId: 'clawx-git',
      toolName: 'git_file_diff',
      args: { unexpected: true },
    })).resolves.toMatchObject({
      success: false,
      blocked: true,
    });
  });

  it('projects security fields through OpenClaw config sync path', async () => {
    const { syncAgentMcpExposureToOpenClawConfig, createMcpApiWithContext } = await import('@electron/services/mcp-api');
    const writeOpenClawConfig = (await import('@electron/utils/channel-config')).writeOpenClawConfig as ReturnType<typeof vi.fn>;
    writeOpenClawConfig.mockClear();

    const gatewayManager = {
      getStatus: vi.fn(() => ({ state: 'running' })),
      rpc: vi.fn(async () => ({ ok: true })),
    };
    const api = createMcpApiWithContext({ gatewayManager: gatewayManager as never });
    await api.createServer({
      name: 'Projected',
      transport: 'stdio',
      command: 'node',
      permissionMode: 'fullAccess',
      sandboxProfileId: 'p1',
      networkPolicy: 'disabled',
      env: { KEY: 'value-plain' },
      enabled: true,
      scope: 'global',
    });
    const listed = await api.listServers();
    const id = listed.servers.find((server) => server.name === 'Projected')!.id;

    await syncAgentMcpExposureToOpenClawConfig('agent-main', [id]);
    expect(writeOpenClawConfig).toHaveBeenCalled();
    const written = writeOpenClawConfig.mock.calls.at(-1)?.[0] as {
      mcp?: { servers?: Record<string, Record<string, unknown>> };
    };
    const entry = written.mcp?.servers?.[id];
    expect(entry).toMatchObject({
      permissionMode: 'fullAccess',
      sandboxProfileId: 'p1',
      networkPolicy: 'disabled',
      env: { KEY: 'value-plain' },
      enabled: true,
    });
  });
});
