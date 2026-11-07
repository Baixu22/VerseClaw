// Gateway MCP loopback JSON-RPC handlers.
// Implements initialize, tools/list, tools/call, and notification handling.
import crypto from "node:crypto";
import { runBeforeToolCallHook, type HookContext } from "../agents/agent-tools.before-tool-call.js";
import { mcpToolError, toMcpToolResult } from "../shared/mcp-tool-result.js";
import {
  MCP_LOOPBACK_SERVER_NAME,
  MCP_LOOPBACK_SERVER_VERSION,
  MCP_LOOPBACK_SUPPORTED_PROTOCOL_VERSIONS,
  jsonRpcError,
  jsonRpcResult,
  type JsonRpcRequest,
} from "./mcp-http.protocol.js";
import {
  readMcpLoopbackToolName,
  type McpLoopbackTool,
  type McpToolSchemaEntry,
} from "./mcp-http.schema.js";

/** Handles one MCP loopback JSON-RPC message and returns a response or notification null. */
export async function handleMcpJsonRpc(params: {
  message: JsonRpcRequest;
  tools: McpLoopbackTool[];
  toolSchema: McpToolSchemaEntry[];
  hookContext?: HookContext;
  signal?: AbortSignal;
  protocolVersion?: string;
}): Promise<object | null> {
  const { id, method, params: methodParams } = params.message;

  switch (method) {
    case "initialize": {
      const clientVersion = (methodParams?.protocolVersion as string) ?? "";
      // Prefer the client-requested protocol when supported, otherwise fall
      // back to the newest/first supported version advertised by this server.
      const negotiated =
        MCP_LOOPBACK_SUPPORTED_PROTOCOL_VERSIONS.find((version) => version === clientVersion) ??
        MCP_LOOPBACK_SUPPORTED_PROTOCOL_VERSIONS[0];
      return jsonRpcResult(id, {
        protocolVersion: negotiated,
        capabilities: { tools: {} },
        serverInfo: {
          name: MCP_LOOPBACK_SERVER_NAME,
          version: MCP_LOOPBACK_SERVER_VERSION,
        },
      });
    }
    case "notifications/initialized":
    case "notifications/cancelled":
      return null;
    case "tools/list":
      return jsonRpcResult(id, { tools: params.toolSchema });
    case "tools/call": {
      const toolName = typeof methodParams?.name === "string" ? methodParams.name.trim() : "";
      const toolArgs = (methodParams?.arguments ?? {}) as Record<string, unknown>;
      if (!toolName) {
        return jsonRpcResult(id, {
          content: [{ type: "text", text: "Tool not available: unknown" }],
          isError: true,
        });
      }
      if (!params.toolSchema.some((tool) => tool.name === toolName)) {
        return jsonRpcResult(id, {
          content: [{ type: "text", text: `Tool not available: ${toolName}` }],
          isError: true,
        });
      }
      const tool = params.tools.find(
        (candidate) => readMcpLoopbackToolName(candidate) === toolName,
      );
      if (!tool) {
        return jsonRpcResult(id, {
          content: [{ type: "text", text: `Tool not available: ${toolName}` }],
          isError: true,
        });
      }
      const toolCallId = `mcp-${crypto.randomUUID()}`;
      try {
        params.signal?.throwIfAborted();
        // Gateway before-tool hooks still run for loopback MCP calls so policy
        // and audit behavior matches native tool calls from normal chat runs.
        const hookResult = await runBeforeToolCallHook({
          toolName,
          params: toolArgs,
          toolCallId,
          ctx: params.hookContext,
          signal: params.signal,
        });
        if (hookResult.blocked) {
          return jsonRpcResult(
            id,
            toMcpToolResult({
              content: [{ type: "text", text: hookResult.reason }],
              isError: true,
              approvalRequired: hookResult.approvalState === "waiting",
              details: { status: hookResult.approvalState ?? "blocked" },
            }),
          );
        }
        const result = await tool.execute(toolCallId, hookResult.params, params.signal);
        return jsonRpcResult(id, toMcpToolResult(result, params.signal, params.protocolVersion));
      } catch (error) {
        return jsonRpcResult(id, mcpToolError(error, params.signal));
      }
    }
    default:
      return jsonRpcError(id, -32601, `Method not found: ${method}`);
  }
}
