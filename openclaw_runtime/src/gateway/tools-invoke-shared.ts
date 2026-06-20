// Gateway tool invocation engine.
// Shared implementation behind HTTP and RPC tool invocation adapters.
import {
  normalizeOptionalLowercaseString,
  normalizeOptionalString,
} from "@openclaw/normalization-core/string-coerce";
import { materializeBundleMcpToolsForRun } from "../agents/agent-bundle-mcp-materialize.js";
import { peekSessionMcpRuntime } from "../agents/agent-bundle-mcp-runtime.js";
import { runBeforeToolCallHook } from "../agents/agent-tools.before-tool-call.js";
import { resolveToolLoopDetectionConfig } from "../agents/agent-tools.js";
import { getChannelAgentToolMeta } from "../agents/channel-tools.js";
import { isKnownCoreToolId } from "../agents/tool-catalog.js";
import { ToolInputError, type AnyAgentTool } from "../agents/tools/common.js";
import { resolveMainSessionKey } from "../config/sessions.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { logWarn } from "../logger.js";
import { isTestDefaultMemorySlotDisabled } from "../plugins/config-state.js";
import { defaultSlotIdForKey } from "../plugins/slots.js";
import { getPluginToolMeta } from "../plugins/tools.js";
import { canonicalizeSessionKeyForAgent } from "./session-store-key.js";
import { resolveGatewayScopedTools } from "./tool-resolution.js";

const MEMORY_TOOL_NAMES = new Set(["memory_search", "memory_get"]);

/** Protocol input shape accepted by gateway tool invocation surfaces. */
export type ToolsInvokeInput = {
  tool?: unknown;
  name?: unknown;
  action?: unknown;
  args?: unknown;
  sessionKey?: unknown;
  agentId?: unknown;
  idempotencyKey?: unknown;
  dryRun?: unknown;
};

type ToolsInvokeErrorType = "invalid_request" | "not_found" | "tool_call_blocked" | "tool_error";

type ToolsInvokeOutcome =
  | {
      ok: true;
      status: 200;
      toolName: string;
      source: "core" | "plugin" | "channel" | "mcp";
      result: unknown;
    }
  | {
      ok: false;
      status: 400 | 403 | 404 | 500;
      toolName: string;
      error: {
        type: ToolsInvokeErrorType;
        message: string;
        requiresApproval?: boolean;
      };
    };

function resolveSessionKey(params: { cfg: OpenClawConfig; input: ToolsInvokeInput }): string {
  const rawSessionKey = normalizeOptionalString(params.input.sessionKey);
  if (rawSessionKey && rawSessionKey !== "main") {
    return rawSessionKey;
  }
  const agentId = normalizeOptionalString(params.input.agentId);
  if (agentId) {
    return canonicalizeSessionKeyForAgent(agentId, "main");
  }
  return resolveMainSessionKey(params.cfg);
}

function resolveMemoryToolDisableReasons(cfg: OpenClawConfig): string[] {
  if (!process.env.VITEST) {
    return [];
  }
  const reasons: string[] = [];
  const plugins = cfg.plugins;
  const slotRaw = plugins?.slots?.memory;
  const slotDisabled = slotRaw === null || normalizeOptionalLowercaseString(slotRaw) === "none";
  const pluginsDisabled = plugins?.enabled === false;
  const defaultDisabled = isTestDefaultMemorySlotDisabled(cfg);

  if (pluginsDisabled) {
    reasons.push("plugins.enabled=false");
  }
  if (slotDisabled) {
    reasons.push(slotRaw === null ? "plugins.slots.memory=null" : 'plugins.slots.memory="none"');
  }
  if (!pluginsDisabled && !slotDisabled && defaultDisabled) {
    reasons.push("memory plugin disabled by test default");
  }
  return reasons;
}

function mergeActionIntoArgsIfSupported(params: {
  toolSchema: unknown;
  action: string | undefined;
  args: Record<string, unknown>;
}): Record<string, unknown> {
  const { toolSchema, action, args } = params;
  if (!action || args.action !== undefined) {
    return args;
  }
  const schemaObj = toolSchema as { properties?: Record<string, unknown> } | null;
  const hasAction = Boolean(
    schemaObj &&
    typeof schemaObj === "object" &&
    schemaObj.properties &&
    "action" in schemaObj.properties,
  );
  return hasAction ? { ...args, action } : args;
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message || String(err);
  }
  if (typeof err === "string") {
    return err;
  }
  return String(err);
}

function resolveToolInputErrorStatus(err: unknown): number | null {
  if (err instanceof ToolInputError) {
    const status = (err as { status?: unknown }).status;
    return typeof status === "number" ? status : 400;
  }
  if (typeof err !== "object" || err === null || !("name" in err)) {
    return null;
  }
  const name = (err as { name?: unknown }).name;
  if (name !== "ToolInputError" && name !== "ToolAuthorizationError") {
    return null;
  }
  const status = (err as { status?: unknown }).status;
  if (typeof status === "number") {
    return status;
  }
  return name === "ToolAuthorizationError" ? 403 : 400;
}

function resolveToolSource(tool: AnyAgentTool): "core" | "plugin" | "channel" {
  if (getPluginToolMeta(tool)) {
    return "plugin";
  }
  if (getChannelAgentToolMeta(tool as never)) {
    return "channel";
  }
  return "core";
}

async function invokeWarmMcpTool(params: {
  cfg: OpenClawConfig;
  toolName: string;
  args: Record<string, unknown>;
  sessionKey: string;
  toolCallIdPrefix: string;
  idempotencyKey?: string;
  approvalMode?: "request" | "report";
}): Promise<ToolsInvokeOutcome | null> {
  const runtime = peekSessionMcpRuntime({ sessionKey: params.sessionKey });
  const catalog = runtime?.peekCatalog();
  if (!runtime || !catalog) {
    return null;
  }

  const materialized = await materializeBundleMcpToolsForRun({ runtime });
  try {
    const tool = materialized.tools.find((candidate) => candidate.name === params.toolName);
    if (!tool) {
      return null;
    }
    const toolCallId = params.idempotencyKey
      ? `${params.toolCallIdPrefix}-${params.idempotencyKey}`
      : `${params.toolCallIdPrefix}-${Date.now()}`;
    const hookResult = await runBeforeToolCallHook({
      toolName: params.toolName,
      params: params.args,
      toolCallId,
      ctx: {
        agentId: undefined,
        config: params.cfg,
        sessionKey: params.sessionKey,
        loopDetection: resolveToolLoopDetectionConfig({ cfg: params.cfg }),
      },
      approvalMode: params.approvalMode,
    });
    if (hookResult.blocked) {
      return {
        ok: false,
        status: 403,
        toolName: params.toolName,
        error: {
          type: "tool_call_blocked",
          message: hookResult.reason,
          requiresApproval: hookResult.deniedReason === "plugin-approval",
        },
      };
    }
    return {
      ok: true,
      status: 200,
      toolName: params.toolName,
      source: "mcp",
      result: await tool.execute?.(toolCallId, hookResult.params),
    };
  } catch (err) {
    const inputStatus = resolveToolInputErrorStatus(err);
    if (inputStatus !== null) {
      return {
        ok: false,
        status: inputStatus === 403 ? 403 : 400,
        toolName: params.toolName,
        error: {
          type: "tool_error",
          message: getErrorMessage(err) || "invalid tool arguments",
        },
      };
    }
    logWarn(`tools-invoke: mcp tool execution failed: ${String(err)}`);
    return {
      ok: false,
      status: 500,
      toolName: params.toolName,
      error: { type: "tool_error", message: "mcp tool execution failed" },
    };
  } finally {
    await materialized.dispose();
  }
}

/** Resolves, authorizes, and invokes one gateway-visible core/plugin/channel tool. */
export async function invokeGatewayTool(params: {
  cfg: OpenClawConfig;
  input: ToolsInvokeInput;
  messageChannel?: string;
  accountId?: string;
  agentTo?: string;
  agentThreadId?: string;
  senderIsOwner?: boolean;
  toolCallIdPrefix: string;
  approvalMode?: "request" | "report";
}): Promise<ToolsInvokeOutcome> {
  const toolName = normalizeOptionalString(params.input.name ?? params.input.tool) ?? "";
  if (!toolName) {
    return {
      ok: false,
      status: 400,
      toolName: "",
      error: { type: "invalid_request", message: "tools.invoke requires name" },
    };
  }

  if (process.env.VITEST && MEMORY_TOOL_NAMES.has(toolName)) {
    const reasons = resolveMemoryToolDisableReasons(params.cfg);
    if (reasons.length > 0) {
      const suffix = ` (${reasons.join(", ")})`;
      return {
        ok: false,
        status: 400,
        toolName,
        error: {
          type: "invalid_request",
          message:
            `memory tools are disabled in tests${suffix}. ` +
            `Enable by setting plugins.slots.memory="${defaultSlotIdForKey("memory")}" (and ensure plugins.enabled is not false).`,
        },
      };
    }
  }

  const knownCoreTool = isKnownCoreToolId(toolName);
  const gatewayRequestedTools = knownCoreTool ? [] : [toolName];

  const action = normalizeOptionalString(params.input.action);
  const argsRaw = params.input.args;
  const args =
    argsRaw && typeof argsRaw === "object" && !Array.isArray(argsRaw)
      ? (argsRaw as Record<string, unknown>)
      : {};
  const sessionKey = resolveSessionKey({ cfg: params.cfg, input: params.input });
  const idempotencyKey = normalizeOptionalString(params.input.idempotencyKey);
  const mcpOutcome = await invokeWarmMcpTool({
    cfg: params.cfg,
    toolName,
    args,
    sessionKey,
    toolCallIdPrefix: params.toolCallIdPrefix,
    idempotencyKey,
    approvalMode: params.approvalMode,
  });
  if (mcpOutcome) {
    return mcpOutcome;
  }

  const resolveTools = (disablePluginTools: boolean) =>
    resolveGatewayScopedTools({
      cfg: params.cfg,
      sessionKey,
      messageProvider: params.messageChannel,
      accountId: params.accountId,
      agentTo: params.agentTo,
      agentThreadId: params.agentThreadId,
      senderIsOwner: params.senderIsOwner,
      allowGatewaySubagentBinding: true,
      allowMediaInvokeCommands: true,
      surface: "http",
      disablePluginTools,
      gatewayRequestedTools,
    });

  let { agentId, tools } = resolveTools(knownCoreTool);
  if (knownCoreTool && !tools.some((candidate) => candidate.name === toolName)) {
    ({ agentId, tools } = resolveTools(false));
  }
  const requestedAgentId = normalizeOptionalString(params.input.agentId);
  if (requestedAgentId && agentId && requestedAgentId !== agentId) {
    return {
      ok: false,
      status: 400,
      toolName,
      error: {
        type: "invalid_request",
        message: `agent id "${requestedAgentId}" does not match session agent "${agentId}"`,
      },
    };
  }
  const tool = tools.find((candidate) => candidate.name === toolName);
  if (!tool) {
    return {
      ok: false,
      status: 404,
      toolName,
      error: { type: "not_found", message: `Tool not available: ${toolName}` },
    };
  }

  try {
    const gatewayTool: AnyAgentTool = tool;
    const toolCallId = idempotencyKey
      ? `${params.toolCallIdPrefix}-${idempotencyKey}`
      : `${params.toolCallIdPrefix}-${Date.now()}`;
    const toolArgs = mergeActionIntoArgsIfSupported({
      toolSchema: gatewayTool.parameters,
      action,
      args,
    });
    const hookResult = await runBeforeToolCallHook({
      toolName,
      params: toolArgs,
      toolCallId,
      ctx: {
        agentId,
        config: params.cfg,
        sessionKey,
        loopDetection: resolveToolLoopDetectionConfig({ cfg: params.cfg, agentId }),
      },
      approvalMode: params.approvalMode,
    });
    if (hookResult.blocked) {
      return {
        ok: false,
        status: 403,
        toolName,
        error: {
          type: "tool_call_blocked",
          message: hookResult.reason,
          requiresApproval: hookResult.deniedReason === "plugin-approval",
        },
      };
    }
    return {
      ok: true,
      status: 200,
      toolName,
      source: resolveToolSource(gatewayTool),
      result: await gatewayTool.execute?.(toolCallId, hookResult.params),
    };
  } catch (err) {
    const inputStatus = resolveToolInputErrorStatus(err);
    if (inputStatus !== null) {
      return {
        ok: false,
        status: inputStatus === 403 ? 403 : 400,
        toolName,
        error: {
          type: "tool_error",
          message: getErrorMessage(err) || "invalid tool arguments",
        },
      };
    }
    logWarn(`tools-invoke: tool execution failed: ${String(err)}`);
    return {
      ok: false,
      status: 500,
      toolName,
      error: { type: "tool_error", message: "tool execution failed" },
    };
  }
}
