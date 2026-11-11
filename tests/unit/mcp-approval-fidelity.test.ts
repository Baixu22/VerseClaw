// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleMcpJsonRpc } from '../../openclaw_runtime/src/gateway/mcp-http.handlers';
import { initializeGlobalHookRunner, resetGlobalHookRunner } from '../../openclaw_runtime/src/plugins/hook-runner-global';

const gateway = vi.hoisted(() => vi.fn());
vi.mock('../../openclaw_runtime/src/agents/tools/gateway', () => ({ callGatewayTool: gateway }));
afterEach(() => { resetGlobalHookRunner(); gateway.mockReset(); });

describe('MCP HTTP terminal approval outcomes', () => {
  it.each(['denied', 'timeout', 'unavailable'] as const)('preserves %s and never executes the tool', async (state) => {
    initializeGlobalHookRunner({ hooks: [], plugins: [{ id: 'approval-test', status: 'loaded' }], typedHooks: [{
      pluginId: 'approval-test', hookName: 'before_tool_call', source: 'fixture',
      handler: async (_event: { params: Record<string, unknown> }) => ({ requireApproval: { pluginId: 'approval-test', title: 'Controlled approval', description: 'Controlled approval required' } }),
    }] });
    gateway.mockImplementation(async (method: string) => method === 'plugin.approval.request'
      ? { id: 'fixture-approval', ...(state === 'unavailable' ? { decision: null } : {}) }
      : { id: 'fixture-approval', decision: state === 'denied' ? 'deny' : null });
    const execute = vi.fn(async () => ({ content: [{ type: 'text', text: 'must not execute' }] }));
    const response = await handleMcpJsonRpc({ message: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'fixture', arguments: {} } },
      tools: [{ name: 'fixture', execute } as never], toolSchema: [{ name: 'fixture', description: 'fixture', inputSchema: { type: 'object' } }],
      hookContext: { config: { plugins: { enabled: false } } } });
    expect(response).toMatchObject({ result: { isError: true, _meta: { 'openclaw/resultStatus': state } } });
    expect(execute).not.toHaveBeenCalled();
  });
});
