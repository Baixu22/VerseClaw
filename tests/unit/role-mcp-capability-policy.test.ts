// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { buildBundleMcpToolsFromCatalog } from '../../openclaw_runtime/src/agents/agent-bundle-mcp-materialize';
import { filterBundledToolsForRoleCapabilities } from '../../openclaw_runtime/src/agents/embedded-agent-runner/effective-tool-policy';
import { normalizeRoleContract } from '../../openclaw_runtime/src/agents/role-contract';
import {
  buildRolePermissionDenyList,
  ROLE_MCP_NETWORK_CAPABILITY_DENY,
  ROLE_MCP_WRITE_CAPABILITY_DENY,
} from '../../openclaw_runtime/src/agents/role-permissions-policy';
import { getPluginToolMeta, setPluginToolMeta } from '../../openclaw_runtime/src/plugins/tools';

function tool(name: string) {
  return { name, label: name, description: name, parameters: { type: 'object', properties: {} }, execute: vi.fn() };
}

function mcpTool(name: string, trustedReadOnly?: boolean) {
  const value = tool(name);
  setPluginToolMeta(value as never, {
    pluginId: 'bundle-mcp',
    optional: false,
    mcp: {
      serverName: 'fixture',
      safeServerName: 'fixture',
      toolName: name,
      operation: 'tool',
      ...(trustedReadOnly === true ? { trustedReadOnly: true } : {}),
    },
  });
  return value;
}

describe('role MCP capability boundary (#107)', () => {
  it('emits capability sentinels for read-only filesystem and network-none roles', () => {
    const readRole = normalizeRoleContract({
      name: 'reader',
      rolePrompt: 'Read only.',
      tools: ['fixture__read', 'fixture__write'],
      permissions: { filesystem: 'read', network: 'none' },
    });
    const deny = buildRolePermissionDenyList(readRole);
    expect(deny).toContain(ROLE_MCP_WRITE_CAPABILITY_DENY);
    expect(deny).toContain(ROLE_MCP_NETWORK_CAPABILITY_DENY);
  });

  it('keeps only trusted read-only MCP tools in a read-only role', () => {
    const core = tool('read');
    const safe = mcpTool('fixture__read', true);
    const writer = mcpTool('fixture__write');
    const unknown = mcpTool('fixture__unknown');
    const filtered = filterBundledToolsForRoleCapabilities(
      [core, safe, writer, unknown],
      new Set([ROLE_MCP_WRITE_CAPABILITY_DENY]),
    );
    expect(filtered).toEqual([core, safe]);
  });

  it('drops dynamic MCP tools under network=none regardless of annotations', () => {
    const core = tool('read');
    const safe = mcpTool('fixture__read', true);
    const filtered = filterBundledToolsForRoleCapabilities(
      [core, safe],
      new Set([ROLE_MCP_NETWORK_CAPABILITY_DENY]),
    );
    expect(filtered).toEqual([core]);
  });

  it('carries app-owned trustedReadOnly through catalog materialization', () => {
    const [materialized] = buildBundleMcpToolsFromCatalog({
      catalog: {
        version: 1,
        generatedAt: 0,
        servers: {},
        tools: [{
          serverName: 'fixture',
          safeServerName: 'fixture',
          toolName: 'read_file',
          description: 'Read a file.',
          inputSchema: { type: 'object', properties: {} } as never,
          fallbackDescription: 'Read a file.',
          trustedReadOnly: true,
        }],
      },
    });
    expect(getPluginToolMeta(materialized)?.mcp?.trustedReadOnly).toBe(true);
  });
});
