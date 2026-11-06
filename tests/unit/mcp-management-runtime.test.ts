// @vitest-environment node
import { mkdtemp, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpenClawConfig } from '../../openclaw_runtime/src/config/types.openclaw';
import { startCodingMcpServer } from '../e2e/fixtures/coding-mcp-server';
import { mcpManagementHandlers } from '../../openclaw_runtime/src/gateway/server-methods/mcp-management';
import { invokeGatewayTool } from '../../openclaw_runtime/src/gateway/tools-invoke-shared';

const state = vi.hoisted(() => ({ cfg: {} as OpenClawConfig, root: '', generation: 'generation-1',
  beforeTool: vi.fn(async (input: { params: unknown }) => ({ blocked: false as boolean, params: input.params })) }));
const sessionKey = 'agent:main:mcp-management';

// The session fixture controls owner generations; MCP transport and SDK calls are real.
vi.mock('../../openclaw_runtime/src/gateway/session-utils', () => ({
  loadSessionEntry: () => ({ cfg: state.cfg, canonicalKey: 'agent:main:mcp-management',
    entry: { sessionId: state.generation, workspaceDir: state.root } }),
  resolveGatewaySessionStoreTargetWithStore: ({ key }: { key: string }) => ({
    agentId: 'main', canonicalKey: key, storeKeys: [key],
    store: key === 'agent:main:mcp-management' ? { [key]: { sessionId: state.generation, workspaceDir: state.root } } : {},
  }),
  resolveFreshestSessionEntryFromStoreKeys: (store: Record<string, unknown>, keys: string[]) => store[keys[0]],
  resolveSessionModelRef: () => ({ provider: 'openai', model: 'fixture' }),
}));
vi.mock('../../openclaw_runtime/src/agents/agent-tools.before-tool-call', () => ({
  runBeforeToolCallHook: (...args: Parameters<typeof state.beforeTool>) => state.beforeTool(...args),
}));

describe('TF-0772 session MCP management', () => {
  const endpoints: Array<Awaited<ReturnType<typeof startCodingMcpServer>>> = [];
  beforeEach(async () => {
    state.root = await mkdtemp(join(tmpdir(), 'mcp-management-'));
    state.generation = 'generation-1';
    state.cfg = { agents: { defaults: { workspace: state.root } }, tools: { profile: 'full' }, plugins: { enabled: false } };
    state.beforeTool.mockReset().mockImplementation(async (input) => ({ blocked: false, params: input.params }));
  });
  afterEach(async () => {
    const { disposeAllSessionMcpRuntimes } = await import('../../openclaw_runtime/src/agents/agent-bundle-mcp-runtime');
    await disposeAllSessionMcpRuntimes();
    await Promise.all(endpoints.splice(0).map((endpoint) => endpoint.close()));
  });
  async function endpoint(options: Parameters<typeof startCodingMcpServer>[0] = {}) {
    const server = await startCodingMcpServer(options);
    endpoints.push(server);
    state.cfg.mcp = { servers: { fixture: { url: server.url, transport: 'streamable-http', networkPolicy: 'localOnly', requestTimeoutMs: 400 } } };
    return server;
  }
  async function invoke(method: 'mcp.listTools' | 'mcp.callTool' | 'mcp.heartbeat', params: Record<string, unknown> = {}) {
    let result: Record<string, unknown> | undefined;
    await mcpManagementHandlers[method]({
      params: { serverId: 'fixture', sessionKey, ...params },
      context: { getRuntimeConfig: () => state.cfg },
      respond: (ok: boolean, payload: Record<string, unknown>) => { expect(ok).toBe(true); result = payload; },
    } as never);
    expect(result).toBeDefined();
    return result!;
  }
  it('uses one real SDK catalog for list, call and ping, with a separate tool failure', async () => {
    const server = await endpoint();
    const list = await invoke('mcp.listTools');
    expect(list).toMatchObject({ success: true, status: 'connected', sessionGeneration: state.generation,
      tools: expect.arrayContaining([expect.objectContaining({ name: 'echo' })]) });
    const call = await invoke('mcp.callTool', { toolName: 'echo', args: { message: 'real-sdk-round-trip' }, catalogRevision: list.catalogRevision });
    expect(call).toMatchObject({ success: true, result: { content: [{ type: 'text', text: 'real-sdk-round-trip' }] } });
    expect(await invoke('mcp.heartbeat')).toMatchObject({ success: true, status: 'connected' });
    expect(await invoke('mcp.callTool', { toolName: 'fail' })).toMatchObject({ success: false, result: { isError: true } });
    expect(server.requests.filter((request) => request.method === 'initialize')).toHaveLength(1);
    expect(server.requests.map((request) => request.method)).toEqual(expect.arrayContaining(['tools/list', 'tools/call', 'ping']));
    expect(state.beforeTool).toHaveBeenCalledWith(expect.objectContaining({ ctx: expect.objectContaining({ agentId: 'main', sessionId: state.generation, sessionKey }) }));
  });
  it('accepts a connected empty catalog and rejects a missing service', async () => {
    await endpoint({ empty: true });
    expect(await invoke('mcp.listTools')).toMatchObject({ success: true, status: 'connected', tools: [] });
    expect(await invoke('mcp.listTools', { serverId: 'missing' })).toMatchObject({ success: false, errorCode: 'VALIDATION', status: 'error' });
  });
  it.each([
    ['unknown-session', { sessionKey: 'agent:main:missing' }],
    ['wrong-agent', { agentId: 'other' }],
    ['old-generation', { expectedSessionGeneration: 'old' }],
  ])('rejects %s before any MCP connection', async (_name, params) => {
    const server = await endpoint();
    expect(await invoke('mcp.listTools', params as Record<string, unknown>)).toMatchObject({ success: false, errorCode: 'VALIDATION' });
    expect(server.requests).toHaveLength(0);
  });
  it('rejects invalid schema arguments, policy denial and pending approval without a tools/call effect', async () => {
    const server = await endpoint();
    expect(await invoke('mcp.callTool', { toolName: 'echo', args: { message: 42 } })).toMatchObject({ success: false, errorCode: 'VALIDATION' });
    state.cfg.tools = { deny: ['fixture__echo'] };
    expect(await invoke('mcp.callTool', { toolName: 'echo', args: { message: 'denied' } })).toMatchObject({ success: false, blocked: true });
    state.cfg.tools = { profile: 'full' };
    state.beforeTool.mockResolvedValueOnce({ blocked: true, reason: 'Pending approval', deniedReason: 'plugin-approval' } as never);
    expect(await invoke('mcp.callTool', { toolName: 'echo', args: { message: 'waiting' } })).toMatchObject({ success: false, approvalRequired: true });
    expect(server.requests.filter((request) => request.method === 'tools/call')).toHaveLength(0);
  });
  it('rejects exposure and network denial, and classifies an SDK timeout', async () => {
    const server = await endpoint({ delayMs: 700 });
    state.cfg.mcp!.servers!.fixture.exposure = { agents: ['other'] };
    expect(await invoke('mcp.listTools')).toMatchObject({ success: false, errorCode: 'VALIDATION' });
    expect(server.requests).toHaveLength(0);
    state.cfg.mcp!.servers!.fixture.exposure = undefined;
    state.cfg.mcp!.servers!.fixture.networkPolicy = 'disabled';
    expect(await invoke('mcp.listTools')).toMatchObject({ success: false, status: 'error' });
    expect(server.requests).toHaveLength(0);
    state.cfg.mcp!.servers!.fixture.networkPolicy = 'localOnly';
    expect(await invoke('mcp.listTools')).toMatchObject({ success: false, errorCode: 'TIMEOUT' });
    expect(server.requests.some((request) => request.method === 'tools/list')).toBe(true);
  });
  it('rejects an old catalog after reload and a generation change at the approval hook', async () => {
    const server = await endpoint();
    const list = await invoke('mcp.listTools');
    state.cfg.mcp!.servers!.fixture.toolFilter = { exclude: ['echo'] };
    expect(await invoke('mcp.callTool', { toolName: 'echo', args: { message: 'old' }, catalogRevision: list.catalogRevision }))
      .toMatchObject({ success: false, errorCode: 'VALIDATION' });
    state.cfg.mcp!.servers!.fixture.toolFilter = undefined;
    state.beforeTool.mockImplementationOnce(async (input) => { state.generation = 'generation-2'; return { blocked: false, params: input.params }; });
    expect(await invoke('mcp.callTool', { toolName: 'echo', args: { message: 'late' } })).toMatchObject({ success: false, errorCode: 'VALIDATION' });
    expect(server.requests.filter((request) => request.method === 'tools/call')).toHaveLength(0);
  });
  it('rejects a warm runtime after the parent workspace changes without a new generation', async () => {
    const server = await endpoint();
    await invoke('mcp.listTools');
    state.root = await mkdtemp(join(tmpdir(), 'mcp-management-moved-'));
    expect(await invoke('mcp.callTool', { toolName: 'echo', args: { message: 'old-workspace' } }))
      .toMatchObject({ success: false, errorCode: 'VALIDATION', error: expect.stringContaining('workspace differs') });
    expect(server.requests.filter((request) => request.method === 'tools/call')).toHaveLength(0);
  });
  it.each(['generation', 'workspace'] as const)('binds a catalog revision to its %s even when catalog timestamps collide', async (changed) => {
    const server = await endpoint();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now());
    try {
      const list = await invoke('mcp.listTools');
      if (changed === 'generation') state.generation = 'generation-2';
      else {
        const { disposeAllSessionMcpRuntimes } = await import('../../openclaw_runtime/src/agents/agent-bundle-mcp-runtime');
        await disposeAllSessionMcpRuntimes();
        state.root = await mkdtemp(join(tmpdir(), 'mcp-management-catalog-root-'));
      }
      expect(await invoke('mcp.callTool', { toolName: 'echo', args: { message: 'old-owner' }, catalogRevision: list.catalogRevision }))
        .toMatchObject({ success: false, errorCode: 'VALIDATION' });
      expect(server.requests.filter((request) => request.method === 'tools/call')).toHaveLength(0);
    } finally { clock.mockRestore(); }
  });
  it('rejects a tool policy reload while the before-tool-call hook is pending', async () => {
    const server = await endpoint();
    state.beforeTool.mockImplementationOnce(async (input) => {
      state.cfg.tools = { deny: ['fixture__echo'] };
      return { blocked: false, params: input.params };
    });
    expect(await invoke('mcp.callTool', { toolName: 'echo', args: { message: 'policy-changed' } }))
      .toMatchObject({ success: false, errorCode: 'VALIDATION' });
    expect(server.requests.filter((request) => request.method === 'tools/call')).toHaveLength(0);
  });
  it('reuses a warm runtime whose workspace alias resolves to the parent root', async () => {
    const server = await endpoint();
    const alias = join(await mkdtemp(join(tmpdir(), 'mcp-management-alias-')), 'workspace');
    await symlink(state.root, alias, 'junction');
    const { getOrCreateSessionMcpRuntime } = await import('../../openclaw_runtime/src/agents/agent-bundle-mcp-runtime');
    const runtime = await getOrCreateSessionMcpRuntime({ sessionId: state.generation, sessionKey,
      workspaceDir: alias, workspaceId: alias, agentId: 'main', cfg: state.cfg });
    await runtime.getCatalog();
    expect(await invoke('mcp.listTools')).toMatchObject({ success: true, status: 'connected' });
    expect(server.requests.filter((request) => request.method === 'initialize')).toHaveLength(1);
  });
  it.each(['policy', 'schema', 'workspace'] as const)('tools.invoke preserves MCP %s admission after the catalog is warm', async (changed) => {
    const server = await endpoint();
    await invoke('mcp.listTools');
    if (changed === 'policy') state.cfg.tools = { deny: ['fixture__echo'] };
    const otherRoot = changed === 'workspace' ? await mkdtemp(join(tmpdir(), 'mcp-invoke-other-root-')) : undefined;
    const outcome = await invokeGatewayTool({ cfg: state.cfg, input: {
      name: 'fixture__echo', sessionKey, args: { message: changed === 'schema' ? 42 : 'must-not-run' },
      ...(otherRoot ? { workspaceDir: otherRoot } : {}),
    } as never, toolCallIdPrefix: 'p2-warm', approvalMode: 'report' });
    expect(outcome.ok).toBe(false);
    expect(server.requests.filter((request) => request.method === 'tools/call')).toHaveLength(0);
  });
});
