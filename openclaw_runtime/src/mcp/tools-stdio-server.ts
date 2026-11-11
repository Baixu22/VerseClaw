// MCP stdio server exposes OpenClaw tools over the MCP stdio transport.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { AnyAgentTool } from "../agents/tools/common.js";
import { routeLogsToStderr } from "../logging/console.js";
import { VERSION } from "../version.js";
import { createPluginToolsMcpHandlers } from "./plugin-tools-handlers.js";
import { toMcpToolResult } from "../shared/mcp-tool-result.js";

const protocolVersions = new WeakMap<Server, string>();

export function createToolsMcpServer(params: { name: string; tools: AnyAgentTool[] }): Server {
  const handlers = createPluginToolsMcpHandlers(params.tools);
  const server = new Server(
    { name: params.name, version: VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, handlers.listTools);
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    return toMcpToolResult(
      await handlers.callTool(request.params, extra.signal),
      extra.signal,
      protocolVersions.get(server),
    );
  });

  return server;
}

export async function connectToolsMcpServerToStdio(server: Server): Promise<void> {
  // MCP stdio requires stdout to stay protocol-only.
  routeLogsToStderr();

  const transport = new StdioServerTransport();
  const send = transport.send.bind(transport);
  // Observe the SDK's initialize result rather than reimplementing its handshake.
  transport.send = async (message) => {
    if (
      !protocolVersions.has(server) &&
      "result" in message &&
      typeof message.result.protocolVersion === "string"
    ) {
      protocolVersions.set(server, message.result.protocolVersion);
    }
    await send(message);
  };
  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    process.stdin.off("end", shutdown);
    process.stdin.off("close", shutdown);
    process.off("SIGINT", shutdown);
    process.off("SIGTERM", shutdown);
    void server.close();
  };

  process.stdin.once("end", shutdown);
  process.stdin.once("close", shutdown);
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  await server.connect(transport);
}
