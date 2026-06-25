import { describe, expect, it, vi } from 'vitest';
import {
  isRuntimeRegistryDiagnostic,
  isRuntimeToolProviderManifest,
  isToolCallResult,
} from '../../openclaw_runtime/src/runtime-core';
import {
  MCP_CALL_TOOL_COMPAT_PROVIDER_ID,
  MCP_CALL_TOOL_COMPAT_PROVIDER_MANIFEST,
  type McpToolProviderRegistryShadowRecord,
} from '@electron/services/tool-provider-registry';

vi.mock('electron-store', () => {
  class MockStore {
    get(key: string) {
      return key === 'servers' ? [] : undefined;
    }

    set() {}
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
  createGitApi: () => ({}),
}));

describe('MCP tool provider registry pilot', () => {
  it('declares MCP callTool as a shadow-only compatibility tool provider', () => {
    expect(isRuntimeToolProviderManifest(MCP_CALL_TOOL_COMPAT_PROVIDER_MANIFEST)).toBe(true);
    expect(MCP_CALL_TOOL_COMPAT_PROVIDER_MANIFEST).toMatchObject({
      id: MCP_CALL_TOOL_COMPAT_PROVIDER_ID,
      kind: 'tool',
      source: 'mcp',
      enabledByDefault: false,
      shadowOnly: true,
      permission: {
        decision: 'ask',
        capability: 'tool.mcp.callTool',
      },
      metadata: {
        legacyResponseShape: 'McpCallToolResult',
        legacyAuthoritative: true,
        visibleCatalogUnchanged: true,
      },
      toolNames: ['mcp.callTool'],
      resultStatuses: ['success', 'error', 'denied', 'cancelled'],
    });
  });

  it('emits registry diagnostics from MCP callTool without changing successful legacy response shape', async () => {
    const { createMcpApiWithContext } = await import('@electron/services/mcp-api');
    const protocolSink = vi.fn();
    const registryShadows: McpToolProviderRegistryShadowRecord[] = [];
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
      runtime: { toolRegistry: { shadow: true }, toolProtocol: { mcpShadow: false } },
      toolProtocolShadowSink: protocolSink,
      toolProviderRegistryShadowSink: (record) => registryShadows.push(record),
    });

    const result = await api.callTool({
      serverId: 'http-local',
      toolName: 'demo',
      args: { value: 42 },
      workspaceId: 'workspace-a',
    });

    expect(result).toBe(legacy);
    expect(JSON.stringify(result)).toBe(JSON.stringify(legacy));
    expect(Object.keys(result)).toEqual(['success', 'serverId', 'toolName', 'result']);
    expect(protocolSink).not.toHaveBeenCalled();
    expect(registryShadows).toHaveLength(2);
    expect(registryShadows[0]).toMatchObject({
      kind: 'tool_provider.request',
      provider: { id: MCP_CALL_TOOL_COMPAT_PROVIDER_ID, shadowOnly: true },
      request: {
        taskId: 'workspace:workspace-a',
        toolName: 'demo',
        args: { value: 42 },
      },
      diagnostics: [{ status: 'ok', reason: 'registered' }],
    });
    expect(isRuntimeRegistryDiagnostic(registryShadows[0].diagnostics[0])).toBe(true);
    expect(registryShadows[1]).toMatchObject({
      kind: 'tool_provider.result',
      provider: { id: MCP_CALL_TOOL_COMPAT_PROVIDER_ID, shadowOnly: true },
      result: {
        status: 'success',
        structuredData: legacy.result,
      },
      shadow: {
        legacyResponseShape: 'McpCallToolResult',
        legacyAuthoritative: true,
        adapterStatus: 'success',
        adapterReason: { code: 'success' },
      },
      diagnostics: [{
        status: 'ok',
        reason: 'legacy_authoritative',
        metadata: {
          adapterStatus: 'success',
          adapterReasonCode: 'success',
          legacyResponseShape: 'McpCallToolResult',
          legacyAuthoritative: true,
        },
      }],
    });
    expect(registryShadows[1].kind === 'tool_provider.result'
      && isToolCallResult(registryShadows[1].result)).toBe(true);
    expect(isRuntimeRegistryDiagnostic(registryShadows[1].diagnostics[0])).toBe(true);
  });

  it('keeps approval waiting as adapter metadata instead of cutting over permission policy', async () => {
    const { createMcpApiWithContext } = await import('@electron/services/mcp-api');
    const registryShadows: McpToolProviderRegistryShadowRecord[] = [];
    const legacy = {
      success: false,
      serverId: 'http-local',
      toolName: 'dangerous_write',
      blocked: true,
      approvalRequired: true,
      approvalId: 'approval-1',
      reason: 'Needs permission',
    };
    const gatewayManager = {
      getStatus: vi.fn(() => ({ state: 'running' })),
      rpc: vi.fn(async () => legacy),
    };
    const api = createMcpApiWithContext({
      gatewayManager: gatewayManager as never,
      runtime: { toolRegistry: { shadow: true } },
      toolProviderRegistryShadowSink: (record) => registryShadows.push(record),
    });

    const result = await api.callTool({ serverId: 'http-local', toolName: 'dangerous_write' });

    expect(result).toBe(legacy);
    expect(Object.keys(result)).toEqual([
      'success',
      'serverId',
      'toolName',
      'blocked',
      'approvalRequired',
      'approvalId',
      'reason',
    ]);
    expect(registryShadows[1]).toMatchObject({
      kind: 'tool_provider.result',
      result: {
        status: 'error',
        error: { type: 'permission', message: 'Needs permission', retryable: true },
      },
      shadow: {
        adapterStatus: 'waiting',
        adapterReason: { code: 'permission/waiting', state: 'waiting', message: 'Needs permission' },
        approval: { required: true, state: 'waiting', approvalId: 'approval-1' },
      },
      diagnostics: [{
        status: 'fallback',
        reason: 'policy_denied',
        metadata: {
          adapterStatus: 'waiting',
          adapterReasonCode: 'permission/waiting',
          legacyBlocked: true,
        },
      }],
    });
  });

  it('does not emit registry shadows when the tool registry flag is off', async () => {
    const { createMcpApiWithContext } = await import('@electron/services/mcp-api');
    const registrySink = vi.fn();
    const legacy = {
      success: true,
      serverId: 'http-local',
      toolName: 'demo',
      result: { ok: true },
    };
    const gatewayManager = {
      getStatus: vi.fn(() => ({ state: 'running' })),
      rpc: vi.fn(async () => legacy),
    };
    const api = createMcpApiWithContext({
      gatewayManager: gatewayManager as never,
      runtime: { toolRegistry: { shadow: false } },
      toolProviderRegistryShadowSink: registrySink,
    });

    const result = await api.callTool({ serverId: 'http-local', toolName: 'demo' });

    expect(result).toBe(legacy);
    expect(registrySink).not.toHaveBeenCalled();
  });
});
