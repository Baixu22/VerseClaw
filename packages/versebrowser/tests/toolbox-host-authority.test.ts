import { expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer, type McpServerDeps } from '../src/mcp/server.ts';
import { AgentBrowserFacade } from '../src/engine/facade.ts';
import { resolveMcpPolicy } from '../src/mcp/capability-policy.ts';
import type { AgentBrowserHostApi } from '../src/types/host-api.ts';
import type { PermissionDecisionEvent } from '../src/types/product-semantics.ts';

async function connect(options: McpServerDeps) {
  const client = new Client({ name: 'host-authority', version: '1' });
  const server = createMcpServer(options);
  const [c, s] = InMemoryTransport.createLinkedPair();
  await server.connect(s); await client.connect(c);
  return { client, server };
}
const policy = (allow: boolean) => resolveMcpPolicy({ groups: 'core', caps: allow ? 'browser.act' : '', env: {} });

it('host policy revocation changes advertised tools and denies before browser execution', async () => {
  let allowed = true;
  const click = vi.fn(async () => ({ success: true, session: { id: 's' } }));
  const events: PermissionDecisionEvent[] = [];
  const facade = new AgentBrowserFacade({ api: { click, waitForSelector: async () => ({ success: true }) } as unknown as AgentBrowserHostApi });
  const { client, server } = await connect({ facade, getPolicy: () => policy(allowed), permissionRecorder: async e => { events.push(e); return e; }, requireAudit: true });
  try {
    const ok = await client.callTool({ name: 'vb_click', arguments: { sessionId: 's', selector: '#button' } });
    expect(ok.isError).not.toBe(true);
    expect(ok._meta?.['versebrowser/audit']).toBe('recorded');
    allowed = false;
    expect((await client.listTools()).tools.some(t => t.name === 'vb_click')).toBe(false);
    const denied = await client.callTool({ name: 'vb_click', arguments: { sessionId: 's', selector: '#button' } });
    expect(denied.isError).toBe(true);
    expect(click).toHaveBeenCalledTimes(1);
    expect(events.map(e => e.decision)).toEqual(['allow', 'deny']);
    expect(events.every(e => !!e.requestId)).toBe(true);
    expect(JSON.stringify(events)).not.toContain('#button');
  } finally { await client.close(); await server.close(); }
});

it('missing and failed audit are explicit, and required audit fails before acting', async () => {
  for (const mode of ['optional', 'missing', 'broken'] as const) {
    const click = vi.fn(async () => ({ success: true, session: { id: 's' } }));
    const facade = new AgentBrowserFacade({ api: { click, waitForSelector: async () => ({ success: true }) } as unknown as AgentBrowserHostApi });
    const { client, server } = await connect({ facade, policy: policy(true), requireAudit: mode !== 'optional', ...(mode === 'broken' ? { permissionRecorder: async () => { throw new Error('sink down'); } } : {}) });
    try {
      const result = await client.callTool({ name: 'vb_click', arguments: { sessionId: 's', selector: '#button' } });
      expect(result._meta?.['versebrowser/audit']).toBe(mode === 'broken' ? 'failed' : 'unavailable');
      expect(click).toHaveBeenCalledTimes(mode === 'optional' ? 1 : 0);
      if (mode !== 'optional') expect(result.isError).toBe(true);
    } finally { await client.close(); await server.close(); }
  }
});
