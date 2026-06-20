#!/usr/bin/env node
/**
 * MCP test-echo server (stdio JSON-RPC).
 *
 * A minimal Model Context Protocol (MCP) server used by
 * `team/trae_cn/p5-3-mcp-smoke.mjs` to validate that the ClawX MCP
 * stack can launch, heartbeat, list tools, and invoke a tool.
 *
 * Implements only the MCP method surface exercised by the smoke:
 *   - initialize               (returns server info + capabilities)
 *   - ping                     (returns empty object)
 *   - tools/list               (returns the `echo` tool descriptor)
 *   - tools/call               (returns { content: [{ type: "text", text: <echoed payload> }] })
 *
 * Uses Content-Length framed JSON-RPC 2.0 over stdio, matching the
 * MCP 2024-11-05 spec. Exits cleanly on `shutdown` method or EOF.
 *
 * Usage (stdio):
 *   node tests/fixtures/mcp-test-echo.mjs
 */

let buffer = Buffer.alloc(0);

function sendMessage(message) {
  const body = JSON.stringify(message);
  const header = `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n`;
  process.stdout.write(header + body, 'utf8');
}

function handleMessage(message) {
  const { id, method, params } = message;
  if (method === 'initialize') {
    sendMessage({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        serverInfo: { name: 'test-echo', version: '1.0.0' },
        capabilities: { tools: { listChanged: false } },
      },
    });
    return;
  }
  if (method === 'notifications/initialized') {
    // Notification — no response required.
    return;
  }
  if (method === 'ping') {
    sendMessage({ jsonrpc: '2.0', id, result: {} });
    return;
  }
  if (method === 'tools/list') {
    sendMessage({
      jsonrpc: '2.0',
      id,
      result: {
        tools: [
          {
            name: 'echo',
            description: 'Echoes back its argument as a text content block.',
            inputSchema: {
              type: 'object',
              properties: {
                message: { type: 'string', description: 'Text to echo.' },
              },
              required: ['message'],
              additionalProperties: false,
            },
          },
        ],
      },
    });
    return;
  }
  if (method === 'tools/call') {
    const name = params && params.name;
    const args = (params && params.arguments) || {};
    if (name !== 'echo') {
      sendMessage({
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Unknown tool: ${name}` },
      });
      return;
    }
    const message = typeof args.message === 'string' ? args.message : '';
    sendMessage({
      jsonrpc: '2.0',
      id,
      result: {
        content: [{ type: 'text', text: message }],
        isError: false,
      },
    });
    return;
  }
  if (method === 'shutdown') {
    sendMessage({ jsonrpc: '2.0', id, result: {} });
    setTimeout(() => process.exit(0), 10);
    return;
  }
  sendMessage({
    jsonrpc: '2.0',
    id,
    error: { code: -32601, message: `Method not implemented: ${method}` },
  });
}

function processBuffer() {
  while (true) {
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd === -1) return;
    const header = buffer.subarray(0, headerEnd).toString('ascii');
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    if (!match) {
      // Malformed header — drop the frame and resync.
      buffer = buffer.subarray(headerEnd + 4);
      continue;
    }
    const contentLength = Number.parseInt(match[1], 10);
    const bodyStart = headerEnd + 4;
    if (buffer.length < bodyStart + contentLength) return;
    const body = buffer.subarray(bodyStart, bodyStart + contentLength).toString('utf8');
    buffer = buffer.subarray(bodyStart + contentLength);
    let message;
    try {
      message = JSON.parse(body);
    } catch {
      continue;
    }
    handleMessage(message);
  }
}

process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  processBuffer();
});

process.stdin.on('end', () => {
  process.exit(0);
});

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
