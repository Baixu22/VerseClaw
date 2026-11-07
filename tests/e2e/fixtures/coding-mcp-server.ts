import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { Server } from '../../../openclaw_runtime/node_modules/@modelcontextprotocol/sdk/dist/esm/server/index.js';
import { StreamableHTTPServerTransport } from '../../../openclaw_runtime/node_modules/@modelcontextprotocol/sdk/dist/esm/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema, PingRequestSchema } from '../../../openclaw_runtime/node_modules/@modelcontextprotocol/sdk/dist/esm/types.js';

/** Real SDK endpoint shared by management integration and Electron acceptance. */
export async function startCodingMcpServer(options: {
  empty?: boolean;
  delayMs?: number;
  onCall?: (args: Record<string, unknown> | undefined) => void | Promise<void>;
} = {}) {
  const requests: Array<{ method: string; params?: unknown }> = [];
  const active = new Set<Server>();
  const stop = new AbortController();
  const http = createServer(async (request, response) => {
    const rpc = new Server({ name: 'coding-management-fixture', version: '1.0.0' }, { capabilities: { tools: {} } });
    rpc.setRequestHandler(ListToolsRequestSchema, async () => {
      if (options.delayMs) await delay(options.delayMs, undefined, { signal: stop.signal }).catch(() => undefined);
      return { tools: options.empty ? [] : [
        { name: 'echo', description: 'Echo one message', inputSchema: { type: 'object' as const,
          properties: { message: { type: 'string' } }, required: ['message'], additionalProperties: false } },
        { name: 'fail', description: 'Return a tool failure', inputSchema: { type: 'object' as const, properties: {}, additionalProperties: false } },
      ] };
    });
    rpc.setRequestHandler(CallToolRequestSchema, async (input) => {
      const result = {
        content: [{ type: 'text' as const, text: input.params.name === 'fail' ? 'Fixture tool failure' : String(input.params.arguments?.message ?? '') }],
        isError: input.params.name === 'fail',
      };
      await options.onCall?.(input.params.arguments);
      return result;
    });
    rpc.setRequestHandler(PingRequestSchema, async () => ({}));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    active.add(rpc);
    response.once('close', () => { active.delete(rpc); void rpc.close(); });
    try {
      let body = '';
      for await (const chunk of request) body += String(chunk);
      const parsed = body ? JSON.parse(body) : undefined;
      if (parsed?.method) requests.push({ method: parsed.method, params: parsed.params });
      await rpc.connect(transport);
      await transport.handleRequest(request, response, parsed);
    } catch (error) {
      if (!response.headersSent) response.writeHead(500, { 'content-type': 'application/json' });
      if (!response.writableEnded) response.end(JSON.stringify({ error: String(error) }));
      await rpc.close();
      active.delete(rpc);
    }
  });
  await new Promise<void>((resolve, reject) => { http.once('error', reject); http.listen(0, '127.0.0.1', resolve); });
  const address = http.address();
  if (!address || typeof address === 'string') throw new Error('MCP endpoint has no TCP address');
  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    requests,
    async close() {
      stop.abort();
      await Promise.allSettled([...active].map((rpc) => rpc.close()));
      http.closeAllConnections();
      await new Promise<void>((resolve) => http.close(() => resolve()));
      const connections = await new Promise<number>((resolve, reject) => http.getConnections((error, count) => error ? reject(error) : resolve(count)));
      return { listening: http.listening, sessions: active.size, connections };
    },
  };
}
