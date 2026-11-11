// MCP loopback HTTP server.
// Exposes Gateway-scoped tools to local MCP clients over bearer-auth loopback.
import crypto from "node:crypto";
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { isRecord } from "@openclaw/normalization-core/record-coerce";
import { getRuntimeConfig } from "../config/io.js";
import { isTruthyEnvValue } from "../infra/env.js";
import { formatErrorMessage } from "../infra/errors.js";
import { logDebug, logWarn } from "../logger.js";
import { handleMcpJsonRpc } from "./mcp-http.handlers.js";
import {
  clearActiveMcpLoopbackRuntimeByOwnerToken,
  setActiveMcpLoopbackRuntime,
} from "./mcp-http.loopback-runtime.js";
import {
  jsonRpcError,
  MCP_LOOPBACK_SUPPORTED_PROTOCOL_VERSIONS,
  type JsonRpcRequest,
} from "./mcp-http.protocol.js";
import {
  isMcpHttpBodyTooLargeError,
  isMcpHttpBodyTimeoutError,
  readMcpHttpBody,
  resolveMcpHttpBodyTimeoutMs,
  resolveMcpRequestContext,
  validateMcpLoopbackRequest,
} from "./mcp-http.request.js";
import { McpLoopbackToolCache } from "./mcp-http.runtime.js";

// Loopback MCP server exposes gateway-scoped tools to local MCP clients over a
// bearer-token HTTP endpoint bound to 127.0.0.1. Only one active server/runtime
// is registered per process.
export {
  createMcpLoopbackServerConfig,
  getActiveMcpLoopbackRuntime,
  resolveMcpLoopbackBearerToken,
} from "./mcp-http.loopback-runtime.js";

type McpLoopbackServer = {
  port: number;
  close: () => Promise<void>;
};

let activeMcpLoopbackServer: McpLoopbackServer | undefined;
let activeMcpLoopbackServerPromise: Promise<McpLoopbackServer> | null = null;

function createMcpJsonParseError(error: unknown): Error & { code: "mcp_json_parse_error" } {
  return Object.assign(new Error("MCP JSON parse error"), {
    cause: error,
    code: "mcp_json_parse_error" as const,
  });
}

function isMcpJsonParseError(error: unknown): error is Error & { code: "mcp_json_parse_error" } {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "mcp_json_parse_error"
  );
}

function parseMcpJsonBody(body: string): JsonRpcRequest | JsonRpcRequest[] {
  try {
    return JSON.parse(body) as JsonRpcRequest | JsonRpcRequest[];
  } catch (error) {
    throw createMcpJsonParseError(error);
  }
}

function readJsonRpcRequestId(message: unknown) {
  if (!isRecord(message)) {
    return null;
  }
  const id = message.id;
  return typeof id === "string" || typeof id === "number" || id === null ? id : undefined;
}

function isJsonRpcRequest(message: unknown): message is JsonRpcRequest {
  return isRecord(message) && message.jsonrpc === "2.0" && typeof message.method === "string";
}

function jsonRpcInternalError(parsed: JsonRpcRequest | JsonRpcRequest[] | undefined) {
  if (Array.isArray(parsed)) {
    return parsed.map((message) =>
      jsonRpcError(readJsonRpcRequestId(message), -32603, "Internal error"),
    );
  }
  return jsonRpcError(readJsonRpcRequestId(parsed), -32603, "Internal error");
}

function shouldLogMcpLoopbackTraffic(): boolean {
  return (
    isTruthyEnvValue(process.env.OPENCLAW_CLI_BACKEND_LOG_OUTPUT) ||
    isTruthyEnvValue(process.env.OPENCLAW_LIVE_CLI_BACKEND_DEBUG)
  );
}

function logMcpLoopbackTraffic(step: string, details: Record<string, unknown>): void {
  if (!shouldLogMcpLoopbackTraffic()) {
    return;
  }
  console.error(`[mcp-loopback] ${step} ${JSON.stringify(details)}`);
}

// Abort tool calls when the request disconnects before completion, but keep
// completed responses alive through normal response close notifications.
function createRequestAbortSignal(req: IncomingMessage, res: ServerResponse) {
  const controller = new AbortController();
  const abort = () => {
    if (!controller.signal.aborted) {
      controller.abort();
    }
  };
  const abortIfRequestIncomplete = () => {
    if (!req.complete) {
      abort();
    }
  };
  const abortIfResponseStillOpen = () => {
    if (!res.writableEnded) {
      abort();
    }
  };
  req.once("close", abortIfRequestIncomplete);
  res.once("close", abortIfResponseStillOpen);
  if (req.destroyed && !req.complete) {
    abort();
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      req.off("close", abortIfRequestIncomplete);
      res.off("close", abortIfResponseStillOpen);
    },
  };
}

/** Starts a new MCP loopback HTTP server and registers its bearer tokens. */
export async function startMcpLoopbackServer(port = 0): Promise<{
  port: number;
  close: () => Promise<void>;
}> {
  const ownerToken = crypto.randomBytes(32).toString("hex");
  const nonOwnerToken = crypto.randomBytes(32).toString("hex");
  const toolCache = new McpLoopbackToolCache();
  const calls = new Set<AbortController>();
  // MCP transport sessions distinguish clients that share an agent session and
  // begin their JSON-RPC ids at the same value. Never evict an active session.
  const clients = new Map<
    string,
    {
      sessionKey: string;
      owner: boolean;
      version: string;
      lastUsed: number;
      calls: Map<string, AbortController>;
      usedIds: Set<string>;
    }
  >();

  const httpServer = createHttpServer((req, res) => {
    const auth = validateMcpLoopbackRequest({ req, res, ownerToken, nonOwnerToken });
    if (!auth) {
      return;
    }

    const requestAbort = createRequestAbortSignal(req, res);
    void (async () => {
      let parsed: JsonRpcRequest | JsonRpcRequest[] | undefined;
      const cleanupCalls: Array<() => void> = [];
      try {
        if (req.method !== "DELETE") {
          const body = await readMcpHttpBody(req, { timeoutMs: resolveMcpHttpBodyTimeoutMs() });
          parsed = parseMcpJsonBody(body);
        }
        const cfg = getRuntimeConfig();
        const requestContext = resolveMcpRequestContext(req, cfg, auth);
        const header = req.headers["mcp-session-id"];
        const clientId = typeof header === "string" ? header : undefined;
        const now = Date.now();
        for (const [id, client] of clients) {
          if (client.calls.size === 0 && now - client.lastUsed > 10 * 60_000) clients.delete(id);
        }
        let client = clientId ? clients.get(clientId) : undefined;
        if (
          clientId &&
          (!client ||
            client.sessionKey !== requestContext.sessionKey ||
            client.owner !== auth.senderIsOwner)
        ) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "unknown_mcp_session" }));
          return;
        }
        if (req.method === "DELETE") {
          if (!clientId || !client) {
            res.writeHead(400);
            res.end();
            return;
          }
          for (const controller of client.calls.values())
            controller.abort(new Error("MCP session terminated"));
          clients.delete(clientId);
          res.writeHead(200);
          res.end();
          return;
        }
        if (parsed === undefined) {
          res.writeHead(400);
          res.end();
          return;
        }
        if (isJsonRpcRequest(parsed) && parsed.method === "initialize") {
          if (client || clients.size >= 256) {
            res.writeHead(client ? 400 : 503, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                error: client ? "mcp_session_already_initialized" : "mcp_session_capacity",
              }),
            );
            return;
          }
          const offered = parsed.params?.protocolVersion;
          client = {
            sessionKey: requestContext.sessionKey,
            owner: auth.senderIsOwner,
            version:
              MCP_LOOPBACK_SUPPORTED_PROTOCOL_VERSIONS.find((version) => version === offered) ??
              MCP_LOOPBACK_SUPPORTED_PROTOCOL_VERSIONS[0],
            lastUsed: now,
            calls: new Map(),
            usedIds: new Set(),
          };
          const id = crypto.randomUUID();
          clients.set(id, client);
          res.setHeader("Mcp-Session-Id", id);
        }
        const protocolHeader = req.headers["mcp-protocol-version"];
        if (client && protocolHeader !== undefined && protocolHeader !== client.version) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "mcp_protocol_version_changed" }));
          return;
        }
        if (client) client.lastUsed = now;
        const callKey = (id: unknown) =>
          typeof id === "string" || typeof id === "number"
            ? crypto.createHash("sha256").update(JSON.stringify(id)).digest("hex")
            : undefined;
        const messages = Array.isArray(parsed) ? parsed : [parsed];
        const pendingCalls = new Map<JsonRpcRequest, AbortController>();
        const invalidCalls = new Set<JsonRpcRequest>();
        // Register the whole batch before awaiting its first call so cancellation
        // and DELETE also cover queued effects.
        for (const message of messages) {
          if (!isJsonRpcRequest(message) || message.method !== "tools/call") continue;
          const key = callKey(message.id);
          if (!key || (client && (client.usedIds.has(key) || client.usedIds.size >= 4096))) {
            invalidCalls.add(message);
            continue;
          }
          const controller = new AbortController();
          const disconnected = () => controller.abort(requestAbort.signal.reason);
          pendingCalls.set(message, controller);
          calls.add(controller);
          client?.calls.set(key, controller);
          client?.usedIds.add(key);
          requestAbort.signal.addEventListener("abort", disconnected, { once: true });
          if (requestAbort.signal.aborted) disconnected();
          cleanupCalls.push(() => {
            requestAbort.signal.removeEventListener("abort", disconnected);
            calls.delete(controller);
            if (client && client.calls.get(key) === controller) {
              client.calls.delete(key);
              client.lastUsed = Date.now();
            }
          });
        }
        // SDK cancellation is a separate POST and must reach the original call's signal.
        const notifications = Array.isArray(parsed) ? parsed : [parsed];
        for (const message of notifications) {
          if (isJsonRpcRequest(message) && message.method === "notifications/cancelled") {
            const key = callKey(message.params?.requestId);
            if (key) client?.calls.get(key)?.abort(new Error("MCP request cancelled"));
          }
        }
        const scopedTools = toolCache.resolve({
          cfg,
          sessionKey: requestContext.sessionKey,
          messageProvider: requestContext.messageProvider,
          currentChannelId: requestContext.currentChannelId,
          currentThreadTs: requestContext.currentThreadTs,
          currentMessageId: requestContext.currentMessageId,
          currentInboundAudio: requestContext.currentInboundAudio,
          accountId: requestContext.accountId,
          inboundEventKind: requestContext.inboundEventKind,
          sourceReplyDeliveryMode: requestContext.sourceReplyDeliveryMode,
          senderIsOwner: requestContext.senderIsOwner,
        });

        logMcpLoopbackTraffic("request", {
          batchSize: messages.length,
          methods: messages.map((message) =>
            isJsonRpcRequest(message) ? message.method : undefined,
          ),
          sessionKey: requestContext.sessionKey,
          inboundEventKind: requestContext.inboundEventKind,
          senderIsOwner: requestContext.senderIsOwner === true,
          toolCount: scopedTools.toolSchema.length,
          cronVisible: scopedTools.toolSchema.some((tool) => tool.name === "cron"),
        });
        const responses: object[] = [];
        for (const message of messages) {
          if (!isJsonRpcRequest(message)) {
            responses.push(jsonRpcError(readJsonRpcRequestId(message), -32600, "Invalid Request"));
            continue;
          }
          if (invalidCalls.has(message)) {
            responses.push(
              jsonRpcError(
                message.id,
                -32600,
                "MCP request id reused or session request limit reached; initialize a new session",
              ),
            );
            continue;
          }
          const controller = pendingCalls.get(message);
          const response = await handleMcpJsonRpc({
            message,
            tools: scopedTools.tools,
            toolSchema: scopedTools.toolSchema,
            hookContext: {
              agentId: scopedTools.agentId,
              config: cfg,
              sessionKey: requestContext.sessionKey,
            },
            signal: controller?.signal ?? requestAbort.signal,
            protocolVersion:
              client?.version ??
              (typeof protocolHeader === "string" ? protocolHeader : "2024-11-05"),
          });
          if (response !== null) {
            const toolName =
              message.method === "tools/call" && isRecord(message.params)
                ? message.params.name
                : undefined;
            const isError =
              isRecord(response) && isRecord(response.result) && response.result.isError === true;
            logMcpLoopbackTraffic("response", {
              method: message.method,
              toolName: typeof toolName === "string" ? toolName : undefined,
              isError,
            });
            responses.push(response);
          }
        }

        if (responses.length === 0) {
          res.writeHead(202);
          res.end();
          return;
        }

        const payload = Array.isArray(parsed)
          ? JSON.stringify(responses)
          : JSON.stringify(responses[0]);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(payload);
      } catch (error) {
        logWarn(`mcp loopback: request handling failed: ${formatErrorMessage(error)}`);
        logMcpLoopbackTraffic("request-failed", {
          message: formatErrorMessage(error),
        });
        if (!res.headersSent) {
          if (isMcpHttpBodyTooLargeError(error)) {
            res.writeHead(413, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "payload_too_large" }), () => {
              req.destroy();
            });
          } else if (isMcpHttpBodyTimeoutError(error)) {
            res.writeHead(408, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "request_body_timeout" }), () => {
              req.destroy();
            });
          } else if (isMcpJsonParseError(error)) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify(jsonRpcError(null, -32700, "Parse error")));
          } else {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify(jsonRpcInternalError(parsed)));
          }
        }
      } finally {
        for (const cleanup of cleanupCalls) cleanup();
        requestAbort.cleanup();
      }
    })();
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, "127.0.0.1", () => {
      httpServer.removeListener("error", reject);
      resolve();
    });
  });

  const address = httpServer.address();
  if (!address || typeof address === "string") {
    throw new Error("mcp loopback did not bind to a TCP port");
  }
  // Register tokens only after the TCP listener is live so clients never learn
  // a bearer token for a server that failed to bind.
  setActiveMcpLoopbackRuntime({ port: address.port, ownerToken, nonOwnerToken });
  logDebug(`mcp loopback listening on 127.0.0.1:${address.port}`);

  const server: McpLoopbackServer = {
    port: address.port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        for (const controller of calls) controller.abort(new Error("MCP server closing"));
        httpServer.close((error) => {
          if (!error) {
            clients.clear();
            clearActiveMcpLoopbackRuntimeByOwnerToken(ownerToken);
            if (activeMcpLoopbackServer === server) {
              activeMcpLoopbackServer = undefined;
            }
          }
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
  };
  return server;
}

/** Returns the active MCP loopback server or starts one if none exists. */
export async function ensureMcpLoopbackServer(port = 0): Promise<McpLoopbackServer> {
  if (activeMcpLoopbackServer) {
    return activeMcpLoopbackServer;
  }
  if (!activeMcpLoopbackServerPromise) {
    activeMcpLoopbackServerPromise = startMcpLoopbackServer(port)
      .then((server) => {
        activeMcpLoopbackServer = server;
        return server;
      })
      .finally(() => {
        activeMcpLoopbackServerPromise = null;
      });
  }
  return activeMcpLoopbackServerPromise;
}

/** Closes the active MCP loopback server if one has been started. */
export async function closeMcpLoopbackServer(): Promise<void> {
  const server =
    activeMcpLoopbackServer ??
    (activeMcpLoopbackServerPromise ? await activeMcpLoopbackServerPromise : undefined);
  if (!server) {
    return;
  }
  activeMcpLoopbackServer = undefined;
  await server.close();
}
