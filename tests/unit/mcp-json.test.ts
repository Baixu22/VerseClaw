import { expect, it } from 'vitest';
import { parseMcpJsonConfigs, mcpServerToJson } from '@/lib/mcp-json';
import type { McpServerConfig } from '@shared/types/mcp';

it('preserves security fields through JSON import and edit round-trip', () => {
  const input = { url: 'https://example.invalid/mcp', transport: 'http', headers: { Authorization: 'Bearer FIXTURE' },
    exposure: { agents: ['restricted-agent'], workspaces: [], roles: ['reviewer'] }, sslVerify: false };
  const [server] = parseMcpJsonConfigs(JSON.stringify({ mcpServers: { secure: input } }), 'invalid');
  expect(server).toMatchObject(input);
  const edited = parseMcpJsonConfigs(mcpServerToJson({ ...server, id: 'secure', createdAt: 1, updatedAt: 1 } as McpServerConfig), 'invalid')[0];
  expect(edited).toMatchObject(input);
});

it.each([{ exposure: null }, { exposure: { agents: 'all' } }, { exposure: { typo: ['agent'] } }, { headers: { Authorization: {} } }, { sslVerify: 'false' }])('rejects invalid security fields: %j', (input) => {
  expect(() => parseMcpJsonConfigs(JSON.stringify({ url: 'https://example.invalid', ...input }), 'invalid')).toThrow();
});
