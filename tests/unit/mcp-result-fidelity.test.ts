// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { CallToolResultSchema } from '../../openclaw_runtime/node_modules/@modelcontextprotocol/sdk/dist/esm/types.js';
import { handleMcpJsonRpc } from '../../openclaw_runtime/src/gateway/mcp-http.handlers';
import { createPluginToolsMcpHandlers } from '../../openclaw_runtime/src/mcp/plugin-tools-handlers';
import { MCP_LOOPBACK_SUPPORTED_PROTOCOL_VERSIONS } from '../../openclaw_runtime/src/gateway/mcp-http.protocol';
import { materializeBundleMcpToolsForRun } from '../../openclaw_runtime/src/agents/agent-bundle-mcp-materialize';
import { mcpToolError, toMcpToolResult } from '../../openclaw_runtime/src/shared/mcp-tool-result';
import { isToolResultError } from '../../openclaw_runtime/src/agents/embedded-agent-subscribe.tools';

vi.mock('../../openclaw_runtime/src/agents/agent-tools.before-tool-call', () => ({
  runBeforeToolCallHook: async ({ params }: { params: unknown }) => ({ blocked: false, params }),
  isToolWrappedWithBeforeToolCallHook: () => false,
  wrapToolWithBeforeToolCallHook: (tool: unknown) => tool,
  rewrapToolWithBeforeToolCallHook: (tool: unknown) => tool,
}));

function fixture(execute: () => Promise<unknown>) {
  return { name: 'fixture', label: 'Fixture', description: 'Result contract fixture',
    parameters: { type: 'object', properties: {} }, execute };
}

async function call(surface: 'loopback' | 'plugin', execute: () => Promise<unknown>, signal?: AbortSignal) {
  const tool = fixture(execute);
  if (surface === 'plugin') {
    return await createPluginToolsMcpHandlers([tool as never]).callTool({ name: 'fixture', arguments: {} }, signal);
  }
  const response = await handleMcpJsonRpc({
    message: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'fixture', arguments: {} } },
    toolSchema: [{ name: 'fixture', description: tool.description, inputSchema: tool.parameters }],
    tools: [tool as never], signal,
  });
  return (response as { result: unknown }).result;
}

describe.each(['loopback', 'plugin'] as const)('MCP %s result fidelity', (surface) => {
  it.each([
    { isError: true },
    { details: { status: 'error' } },
    { details: { status: 'denied' } },
  ])('preserves failed results: %j', async (status) => {
    const result = await call(surface, async () => ({ content: [{ type: 'text', text: 'Failed fixture' }], ...status }));
    expect(result).toMatchObject({ isError: true });
    expect(CallToolResultSchema.safeParse(result).success).toBe(true);
  });

  it.each([
    { type: 'image', data: 'AA==', mimeType: 'image/png' },
    { type: 'audio', data: 'AA==', mimeType: 'audio/wav' },
    { type: 'resource', resource: { uri: 'file:///fixture.txt', mimeType: 'text/plain', text: 'fixture' } },
    { type: 'resource_link', uri: 'file:///fixture.txt', name: 'fixture' },
  ])('preserves valid $type content through SDK validation', async (block) => {
    const result = await call(surface, async () => ({ content: [block] }));
    expect(CallToolResultSchema.safeParse(result).success).toBe(true);
    expect(result).toMatchObject({ content: [block] });
  });

  it('keeps structured content alongside its text representation', async () => {
    const result = await call(surface, async () => ({ content: [{ type: 'text', text: 'one result' }], structuredContent: { count: 1 } }));
    expect(result).toMatchObject({ structuredContent: { count: 1 } });
  });
  it('marks malformed media converted to text and preserves timeout metadata', async () => {
    const converted = await call(surface, async () => ({ content: [{ type: 'image', mimeType: 'image/png' }] }));
    expect(CallToolResultSchema.safeParse(converted).success).toBe(true);
    expect(converted).toMatchObject({ content: [{ type: 'text' }], _meta: { 'openclaw/contentLoss': ['0:image'] } });
    expect(await call(surface, async () => { throw Object.assign(new Error('fixture timeout'), { name: 'TimeoutError' }); }))
      .toMatchObject({ isError: true, _meta: { 'openclaw/resultStatus': 'timeout' } });
  });

  it('does not report success for a result arriving after cancellation', async () => {
    const abort = new AbortController();
    const result = await call(surface, async () => {
      abort.abort(new Error('fixture cancelled'));
      return { content: [{ type: 'text', text: 'late result' }] };
    }, abort.signal);
    expect(result).toMatchObject({ isError: true });
    expect(result).toMatchObject({ _meta: { 'openclaw/resultStatus': 'cancelled', 'openclaw/partial': true } });
  });

  it('keeps a normal text success and converts a thrown failure', async () => {
    const result = await call(surface, async () => ({ content: [{ type: 'text', text: 'normal' }] }));
    expect(CallToolResultSchema.safeParse(result).success).toBe(true);
    expect(result).toMatchObject({ content: [{ type: 'text', text: 'normal' }] });
    expect(await call(surface, async () => { throw new Error('fixture throw'); })).toMatchObject({ isError: true });
  });
});

it('preserves model media with structured content and forwards the call signal', async () => {
  const abort = new AbortController();
  const callTool = vi.fn(async () => ({ content: [{ type: 'image', data: 'AA==', mimeType: 'image/png' }, { type: 'audio', data: 'AA==', mimeType: 'audio/wav' }], structuredContent: { count: 1 } }));
  const catalog = { version: 1, generatedAt: 1, servers: { fixture: { serverName: 'fixture', launchSummary: 'fixture', toolCount: 1 } }, tools: [{ serverName: 'fixture', safeServerName: 'fixture', toolName: 'echo', inputSchema: { type: 'object' }, fallbackDescription: 'fixture' }] };
  const runtime = { getCatalog: async () => catalog, markUsed: () => {}, callTool };
  const materialized = await materializeBundleMcpToolsForRun({ runtime: runtime as never });
  try {
    const result = await materialized.tools[0].execute('fixture-call', {}, abort.signal);
    expect(callTool).toHaveBeenCalledWith('fixture', 'echo', {}, abort.signal);
    expect(result).toMatchObject({ content: expect.arrayContaining([{ type: 'image', data: 'AA==', mimeType: 'image/png' }]), details: { structuredContent: { count: 1 }, contentLoss: { convertedToText: ['audio'] } } });
  } finally { await materialized.dispose(); }
});

it('preserves cancellation and partial metadata when a model result is adapted back to MCP', () => {
  const result = toMcpToolResult({ content: [{ type: 'text', text: 'partial' }], details: {
    status: 'cancelled', mcpMeta: { 'openclaw/resultStatus': 'cancelled', 'openclaw/partial': true },
  } });
  expect(result).toMatchObject({ isError: true, _meta: { 'openclaw/resultStatus': 'cancelled', 'openclaw/partial': true } });
});

it('classifies explicit caller cancellation before the SDK generic timeout code', () => {
  const controller = new AbortController(); controller.abort();
  expect(mcpToolError(Object.assign(new Error('Request cancelled'), { code: -32001 }), controller.signal))
    .toMatchObject({ _meta: { 'openclaw/resultStatus': 'cancelled' } });
});

it.each(['cancelled', 'timeout', 'waiting', 'unavailable'])('keeps %s visible to the model failure classifier', async (status) => {
  const runtime = { markUsed: () => {},
    getCatalog: async () => ({ version: 1, generatedAt: 1, servers: { fixture: { serverName: 'fixture', launchSummary: 'fixture', toolCount: 1 } },
      tools: [{ serverName: 'fixture', safeServerName: 'fixture', toolName: 'echo', inputSchema: { type: 'object' }, fallbackDescription: 'fixture' }] }),
    callTool: async () => ({ isError: true, content: [{ type: 'text', text: 'stopped' }], _meta: { 'openclaw/resultStatus': status } }),
  };
  const tools = await materializeBundleMcpToolsForRun({ runtime: runtime as never });
  try {
    const result = await tools.tools[0].execute('call', {});
    expect(isToolResultError(result)).toBe(true);
    expect(toMcpToolResult(result)).toMatchObject({ isError: true, _meta: { 'openclaw/resultStatus': status } });
  } finally { await tools.dispose(); }
});

it('negotiates a supported version when the initialize request offers an unknown version', async () => {
  expect(await handleMcpJsonRpc({ message: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 'unsupported-fixture' } }, tools: [], toolSchema: [] }))
    .toMatchObject({ result: { protocolVersion: MCP_LOOPBACK_SUPPORTED_PROTOCOL_VERSIONS[0] } });
});

it.each(['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25'])('projects media to the %s result contract', (version) => {
  const result = toMcpToolResult({ content: [
    { type: 'image', data: 'AA==', mimeType: 'image/png' },
    { type: 'audio', data: 'AA==', mimeType: 'audio/wav' },
    { type: 'resource_link', uri: 'file:///fixture.txt', name: 'fixture' },
  ], structuredContent: { count: 1 } }, undefined, version);
  expect(CallToolResultSchema.safeParse(result).success).toBe(true);
  expect(result.content[0].type).toBe('image');
  expect(result.content[1].type).toBe(version < '2025-03-26' ? 'text' : 'audio');
  expect(result.content[2].type).toBe(version < '2025-06-18' ? 'text' : 'resource_link');
  expect(result.structuredContent).toEqual(version < '2025-06-18' ? undefined : { count: 1 });
  if (version < '2025-06-18') expect(result._meta?.['openclaw/contentLoss']).toBeTruthy();
});
