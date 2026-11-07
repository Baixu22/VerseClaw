import crypto from "node:crypto";
import { realpathSync } from "node:fs";
import path from "node:path";
import { ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { normalizeOptionalString } from "@openclaw/normalization-core/string-coerce";
import { redactSensitiveUrlLikeString } from "@openclaw/net-policy/redact-sensitive-url";
import { buildBundleMcpToolsFromCatalog } from "../../agents/agent-bundle-mcp-materialize.js";
import {
  createBundleMcpJsonSchemaValidator,
  getOrCreateSessionMcpRuntime,
  peekSessionMcpRuntime,
  resolveSessionMcpConfigFingerprint,
  resolveSessionMcpConfigSummary,
} from "../../agents/agent-bundle-mcp-runtime.js";
import { applyFinalEffectiveToolPolicy } from "../../agents/embedded-agent-runner/effective-tool-policy.js";
import { runBeforeToolCallHook } from "../../agents/agent-tools.before-tool-call.js";
import { resolveOrchestrationContext } from "../../agents/orchestration-workspace-context.js";
import { resolveSandboxRuntimeStatus } from "../../agents/sandbox/runtime-status.js";
import { ToolInputError } from "../../agents/tools/common.js";
import type { McpCatalogTool } from "../../agents/agent-bundle-mcp-types.js";
import { resolveRuntimeConfigCacheKey } from "../../config/runtime-snapshot.js";
import { logWarn } from "../../logger.js";
import { getPluginToolMeta } from "../../plugins/tools.js";
import { deliveryContextFromSession } from "../../utils/delivery-context.shared.js";
import { loadSessionEntry, resolveSessionModelRef } from "../session-utils.js";
import type { GatewayRequestHandlerOptions, GatewayRequestHandlers } from "./types.js";

const schemaValidator = createBundleMcpJsonSchemaValidator();

function reject(code: string, message: string): never {
  throw Object.assign(new Error(message), { code });
}

export async function prepareSessionMcpManagement(
  params: Record<string, unknown>,
  context: Pick<GatewayRequestHandlerOptions["context"], "getRuntimeConfig">,
) {
  const serverId = normalizeOptionalString(params.serverId);
  const sessionKey = normalizeOptionalString(params.sessionKey);
  if (!serverId || !sessionKey)
    reject("VALIDATION", "MCP management requires serverId and sessionKey");
  let parent;
  try {
    parent = resolveOrchestrationContext(params, () => context.getRuntimeConfig());
  } catch (error) {
    reject("VALIDATION", error instanceof Error ? error.message : String(error));
  }
  const owner = parent.workspaceOwner!;
  const loaded = loadSessionEntry(owner.sessionKey);
  if (!loaded.entry || loaded.entry.sessionId !== owner.expectedSessionId)
    reject("VALIDATION", "MCP session generation changed");
  const cfg = context.getRuntimeConfig();
  const configRevision = resolveRuntimeConfigCacheKey(cfg);
  const warm = peekSessionMcpRuntime({
    sessionId: owner.expectedSessionId,
    sessionKey: owner.sessionKey,
  });
  if (warm && path.relative(realpathSync(warm.workspaceDir), parent.workspaceDir!) !== "") {
    reject("VALIDATION", "MCP runtime workspace differs from the current parent workspace");
  }
  const runtimeParams = {
    sessionId: owner.expectedSessionId,
    sessionKey: owner.sessionKey,
    workspaceDir: warm?.workspaceDir ?? parent.workspaceDir!,
    agentId: owner.agentId,
    workspaceId: warm?.workspaceDir ?? parent.workspaceDir!,
    cfg,
  };
  const summary = resolveSessionMcpConfigSummary(runtimeParams);
  if (!summary.serverNames.includes(serverId))
    reject("VALIDATION", `MCP server "${serverId}" is not available to this session`);
  const runtime = await getOrCreateSessionMcpRuntime(runtimeParams);
  const release = runtime.acquireLease?.();
  try {
    const catalog = await runtime.getCatalog();
    const server = catalog.servers[serverId];
    if (!server?.health?.connected) {
      const diagnostic = catalog.diagnostics?.find((entry) => entry.serverName === serverId);
      reject(
        diagnostic?.errorCode === ErrorCode.RequestTimeout ? "TIMEOUT" : "INTERNAL",
        diagnostic?.message ?? `MCP server "${serverId}" did not complete its SDK handshake`,
      );
    }
    const model = resolveSessionModelRef(cfg, loaded.entry, owner.agentId);
    const delivery = deliveryContextFromSession(loaded.entry);
    const sandbox = resolveSandboxRuntimeStatus({ cfg, sessionKey: owner.sessionKey });
    const tools = applyFinalEffectiveToolPolicy({
      bundledTools: buildBundleMcpToolsFromCatalog({ catalog }),
      config: cfg,
      sandboxToolPolicy: sandbox.sandboxed ? sandbox.toolPolicy : undefined,
      sessionKey: owner.sessionKey,
      agentId: owner.agentId,
      modelProvider: model.provider,
      modelId: model.model,
      messageProvider:
        delivery?.channel ??
        loaded.entry.lastChannel ??
        loaded.entry.channel ??
        loaded.entry.origin?.provider,
      agentAccountId:
        delivery?.accountId ?? loaded.entry.lastAccountId ?? loaded.entry.origin?.accountId,
      groupId: loaded.entry.groupId,
      groupChannel: loaded.entry.groupChannel,
      groupSpace: loaded.entry.space,
      spawnedBy: loaded.entry.spawnedBy,
      warn: logWarn,
    }).filter((tool) => getPluginToolMeta(tool)?.mcp?.serverName === serverId);
    const catalogRevision = crypto
      .createHash("sha256")
      .update(
        JSON.stringify({
          sessionKey: owner.sessionKey,
          sessionGeneration: owner.expectedSessionId,
          workspaceDir: parent.workspaceDir,
          configRevision,
          mcpFingerprint: runtime.configFingerprint,
          catalogGeneratedAt: catalog.generatedAt,
        }),
      )
      .digest("hex");
    if (params.catalogRevision !== undefined && params.catalogRevision !== catalogRevision)
      reject("VALIDATION", "MCP catalog revision changed; list tools again");
    const assertCurrent = () => {
      try {
        parent.assertWorkspaceCurrent?.();
      } catch (error) {
        reject("VALIDATION", error instanceof Error ? error.message : String(error));
      }
      const currentConfig = context.getRuntimeConfig();
      if (resolveRuntimeConfigCacheKey(currentConfig) !== configRevision)
        reject("VALIDATION", "MCP session policy configuration changed during this request");
      const fingerprint = resolveSessionMcpConfigFingerprint({
        ...runtimeParams,
        cfg: currentConfig,
      });
      if (fingerprint !== runtime.configFingerprint || runtime.peekCatalog() !== catalog)
        reject("VALIDATION", "MCP configuration or catalog changed during this request");
    };
    assertCurrent();
    const validateArgs = (schema: McpCatalogTool["inputSchema"], input: unknown) => {
      const checked = schemaValidator.getValidator(schema)(input);
      if (!checked.valid)
        throw Object.assign(
          new ToolInputError(checked.errorMessage ?? "MCP arguments do not match the tool schema"),
          { code: "VALIDATION" },
        );
    };
    return {
      serverId,
      owner,
      runtime,
      catalog,
      tools,
      catalogRevision,
      assertCurrent,
      release,
      cfg,
      validateArgs,
    };
  } catch (error) {
    release?.();
    throw error;
  }
}

async function handle(
  operation: "list" | "heartbeat" | "call",
  options: GatewayRequestHandlerOptions,
) {
  const { params, context, respond } = options;
  const serverId = normalizeOptionalString(params.serverId) ?? "";
  const toolName = normalizeOptionalString(params.toolName) ?? "";
  const started = Date.now();
  let prepared: Awaited<ReturnType<typeof prepareSessionMcpManagement>> | undefined;
  try {
    prepared = await prepareSessionMcpManagement(params, context);
    if (operation === "list") {
      const tools = prepared.tools.flatMap((tool) => {
        const meta = getPluginToolMeta(tool)?.mcp;
        return meta?.operation === "tool"
          ? [
              {
                name: meta.toolName,
                description: tool.description,
                inputSchema: tool.parameters,
                serverId,
              },
            ]
          : [];
      });
      respond(true, {
        success: true,
        serverId,
        tools,
        status: "connected",
        catalogRevision: prepared.catalogRevision,
        sessionGeneration: prepared.owner.expectedSessionId,
        latencyMs: Date.now() - started,
      });
      return;
    }
    if (operation === "heartbeat") {
      if (!prepared.runtime.ping) reject("UNSUPPORTED", "MCP runtime does not support ping");
      await prepared.runtime.ping(serverId);
      prepared.assertCurrent();
      respond(true, {
        success: true,
        serverId,
        status: "connected",
        latencyMs: Date.now() - started,
      });
      return;
    }
    if (!toolName) reject("VALIDATION", "MCP call requires toolName");
    const entry = prepared.catalog.tools.find(
      (tool) => tool.serverName === serverId && tool.toolName === toolName,
    );
    const tool = prepared.tools.find((tool) => {
      const meta = getPluginToolMeta(tool)?.mcp;
      return meta?.operation === "tool" && meta.toolName === toolName;
    });
    if (!entry || !tool)
      reject(
        "VALIDATION",
        `MCP tool "${toolName}" is not available under the current session policy`,
      );
    if (
      params.args !== undefined &&
      (!params.args || typeof params.args !== "object" || Array.isArray(params.args))
    )
      reject("VALIDATION", "MCP arguments must be an object");
    const args = params.args ?? {};
    prepared.validateArgs(entry.inputSchema, args);
    const hook = await runBeforeToolCallHook({
      toolName: tool.name,
      params: args,
      toolCallId: `mcp-management-${crypto.randomUUID()}`,
      ctx: {
        agentId: prepared.owner.agentId,
        config: prepared.cfg,
        sessionKey: prepared.owner.sessionKey,
        sessionId: prepared.owner.expectedSessionId,
        cwd: prepared.runtime.workspaceDir,
        workspaceDir: prepared.runtime.workspaceDir,
      },
      approvalMode: "report",
    });
    if (hook.blocked) {
      respond(true, {
        success: false,
        serverId,
        toolName,
        blocked: true,
        approvalRequired: hook.deniedReason === "plugin-approval",
        error: hook.reason,
        reason: hook.reason,
        errorCode: "VALIDATION",
      });
      return;
    }
    prepared.validateArgs(entry.inputSchema, hook.params);
    prepared.assertCurrent();
    const result = await prepared.runtime.callTool(serverId, toolName, hook.params);
    prepared.assertCurrent();
    respond(true, {
      success: result.isError !== true,
      serverId,
      toolName,
      result,
      ...(result.isError ? { error: "MCP tool returned an error", errorCode: "INTERNAL" } : {}),
    });
  } catch (error) {
    const rawCode = error && typeof error === "object" && "code" in error ? error.code : undefined;
    const errorCode =
      rawCode === "VALIDATION" ||
      rawCode === "UNSUPPORTED" ||
      rawCode === "TIMEOUT" ||
      rawCode === "INTERNAL"
        ? rawCode
        : rawCode === ErrorCode.RequestTimeout
          ? "TIMEOUT"
          : "INTERNAL";
    const message = redactSensitiveUrlLikeString(
      error instanceof Error ? error.message : String(error),
    );
    respond(true, {
      success: false,
      serverId,
      error: message,
      errorCode,
      ...(operation === "call"
        ? {
            toolName,
            blocked: errorCode === "VALIDATION" || errorCode === "UNSUPPORTED",
            reason: message,
          }
        : { status: "error", ...(operation === "list" ? { tools: [] } : {}) }),
    });
  } finally {
    prepared?.release?.();
  }
}

export const mcpManagementHandlers: GatewayRequestHandlers = {
  "mcp.listTools": (options) => handle("list", options),
  "mcp.heartbeat": (options) => handle("heartbeat", options),
  "mcp.callTool": (options) => handle("call", options),
};
