// Gateway tool invocation engine.
// Shared implementation behind HTTP and RPC tool invocation adapters.
import { realpathSync } from "node:fs";
import path from "node:path";
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
import {
  ToolAuthorizationError,
  ToolInputError,
  type AnyAgentTool,
} from "../agents/tools/common.js";
import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../agents/agent-scope.js";
import { resolveSessionWorkspaceDir } from "../agents/spawned-context.js";
import { resolveRuntimeConfigCacheKey } from "../config/runtime-snapshot.js";
import { resolveMainSessionKey } from "../config/sessions.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { logWarn } from "../logger.js";
import { isTestDefaultMemorySlotDisabled } from "../plugins/config-state.js";
import { defaultSlotIdForKey } from "../plugins/slots.js";
import { getPluginToolMeta } from "../plugins/tools.js";
import type {
  RuntimeCoreJsonObject,
  RuntimeCoreJsonValue,
  RuntimeErrorType,
  ToolCallRequest,
  ToolCallResult,
} from "../runtime-core/types.js";
import {
  isSecurityVerificationShadowEnabled,
  recordSecurityVerificationShadow,
} from "../security-verification-shadow/index.js";
import { canonicalizeSessionKeyForAgent } from "./session-store-key.js";
import { resolveGatewayScopedTools } from "./tool-resolution.js";
import { loadSessionEntry } from "./session-utils.js";

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
  runId?: unknown;
  dryRun?: unknown;
  workspaceDir?: unknown;
  expectedSessionGeneration?: unknown;
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

function toRuntimeCoreJsonValue(value: unknown): RuntimeCoreJsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map(toRuntimeCoreJsonValue);
  if (value && typeof value === "object")
    return toRuntimeCoreJsonObject(value as Record<string, unknown>);
  return null;
}

function toRuntimeCoreJsonObject(value: Record<string, unknown>): RuntimeCoreJsonObject {
  const output: RuntimeCoreJsonObject = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined || typeof item === "function" || typeof item === "symbol") continue;
    output[key] = toRuntimeCoreJsonValue(item);
  }
  return output;
}

function toolInvokeOutcomeStatus(outcome: ToolsInvokeOutcome): ToolCallResult["status"] {
  if (outcome.ok) return "success";
  return outcome.status === 403 ? "denied" : "error";
}

function toolInvokeErrorType(outcome: ToolsInvokeOutcome): RuntimeErrorType {
  if (outcome.ok) return "tool";
  return outcome.error.requiresApproval || outcome.error.type === "tool_call_blocked"
    ? "permission"
    : "tool";
}

function maybeRecordToolsInvokeShadow(params: {
  cfg: OpenClawConfig;
  toolName: string;
  args: Record<string, unknown>;
  sessionKey: string;
  toolCallIdPrefix: string;
  idempotencyKey?: string;
  runId?: string;
  outcome: ToolsInvokeOutcome;
}): void {
  if (!isSecurityVerificationShadowEnabled(params.cfg)) {
    return;
  }
  const now = Date.now();
  const callId = params.idempotencyKey
    ? `${params.toolCallIdPrefix}-${params.idempotencyKey}`
    : `${params.toolCallIdPrefix}-shadow-${now}`;
  const request: ToolCallRequest = {
    callId,
    taskId: params.sessionKey,
    toolName: params.toolName,
    args: toRuntimeCoreJsonObject(params.args),
    permissionContext: {
      surface: "tools.invoke",
      sessionKey: params.sessionKey,
    },
  };
  const result: ToolCallResult = {
    callId,
    status: toolInvokeOutcomeStatus(params.outcome),
    contextItems: [],
    structuredData: params.outcome.ok
      ? { ok: true, source: params.outcome.source }
      : { ok: false, errorType: params.outcome.error.type },
    ...(!params.outcome.ok
      ? {
          error: {
            type: toolInvokeErrorType(params.outcome),
            message: params.outcome.error.message,
            retryable: false,
            evidenceRefs: [],
          },
        }
      : {}),
    startedAt: now,
    finishedAt: now,
    evidence: [{ type: "tool", ref: callId, label: `tools.invoke:${params.toolName}` }],
  };
  recordSecurityVerificationShadow({
    source: "tools.invoke",
    request,
    result,
    ...(params.runId ? { runId: params.runId } : {}),
  });
}

async function invokeWarmMcpTool(params: {
  cfg: OpenClawConfig;
  toolName: string;
  args: Record<string, unknown>;
  sessionKey: string;
  toolCallIdPrefix: string;
  idempotencyKey?: string;
  approvalMode?: "request" | "report";
  requestedAgentId?: string;
  workspaceDir?: unknown;
  expectedSessionGeneration?: unknown;
  getRuntimeConfig: () => OpenClawConfig;
}): Promise<ToolsInvokeOutcome | null> {
  const runtime = peekSessionMcpRuntime({ sessionKey: params.sessionKey });
  const catalog = runtime?.peekCatalog();
  if (!runtime || !catalog) {
    return null;
  }

  let materialized = await materializeBundleMcpToolsForRun({ runtime });
  let admission:
    | Awaited<
        ReturnType<
          (typeof import("./server-methods/mcp-management.js"))["prepareSessionMcpManagement"]
        >
      >
    | undefined;
  try {
    let tool = materialized.tools.find((candidate) => candidate.name === params.toolName);
    if (!tool) {
      return null;
    }
    const meta = getPluginToolMeta(tool)?.mcp;
    if (!meta) throw new ToolInputError("MCP tool metadata is missing");
    const { prepareSessionMcpManagement } = await import("./server-methods/mcp-management.js");
    admission = await prepareSessionMcpManagement(
      {
        serverId: meta.serverName,
        sessionKey: params.sessionKey,
        expectedSessionGeneration: params.expectedSessionGeneration ?? runtime.sessionId,
        ...(params.requestedAgentId ? { agentId: params.requestedAgentId } : {}),
        ...(params.workspaceDir !== undefined ? { workspaceDir: params.workspaceDir } : {}),
      },
      { getRuntimeConfig: params.getRuntimeConfig },
    );
    if (!admission.tools.some((candidate) => candidate.name === params.toolName)) {
      return {
        ok: false,
        status: 403,
        toolName: params.toolName,
        error: {
          type: "tool_call_blocked",
          message: "MCP tool is denied by the current session policy",
        },
      };
    }
    if (admission.runtime !== runtime) {
      await materialized.dispose();
      materialized = await materializeBundleMcpToolsForRun({ runtime: admission.runtime });
      tool = materialized.tools.find((candidate) => candidate.name === params.toolName);
      if (!tool) throw new ToolInputError("MCP tool is no longer in the current catalog");
    }
    const entry = admission.catalog.tools.find(
      (entry) => entry.serverName === meta.serverName && entry.toolName === meta.toolName,
    );
    if (meta.operation === "tool" && !entry) throw new ToolInputError("MCP tool schema is missing");
    const inputSchema = entry?.inputSchema ?? tool.parameters;
    admission.validateArgs(inputSchema, params.args);
    const toolCallId = params.idempotencyKey
      ? `${params.toolCallIdPrefix}-${params.idempotencyKey}`
      : `${params.toolCallIdPrefix}-${Date.now()}`;
    const hookResult = await runBeforeToolCallHook({
      toolName: params.toolName,
      params: params.args,
      toolCallId,
      ctx: {
        agentId: admission.owner.agentId,
        config: admission.cfg,
        sessionKey: params.sessionKey,
        sessionId: admission.owner.expectedSessionId,
        cwd: admission.runtime.workspaceDir,
        workspaceDir: admission.runtime.workspaceDir,
        loopDetection: resolveToolLoopDetectionConfig({
          cfg: admission.cfg,
          agentId: admission.owner.agentId,
        }),
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
    admission.validateArgs(inputSchema, hookResult.params);
    admission.assertCurrent();
    const result = await tool.execute?.(toolCallId, hookResult.params);
    // Preserve this completed call's result; new configuration applies to later admissions.
    return {
      ok: true,
      status: 200,
      toolName: params.toolName,
      source: "mcp",
      result,
    };
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      err.code === "VALIDATION" &&
      !(err instanceof ToolInputError)
    ) {
      return {
        ok: false,
        status: 403,
        toolName: params.toolName,
        error: { type: "tool_call_blocked", message: getErrorMessage(err) },
      };
    }
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
    admission?.release?.();
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
  getRuntimeConfig?: () => OpenClawConfig;
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
  const runId = normalizeOptionalString(params.input.runId);
  const recordAndReturn = (outcome: ToolsInvokeOutcome): ToolsInvokeOutcome => {
    maybeRecordToolsInvokeShadow({
      cfg: params.cfg,
      toolName,
      args,
      sessionKey,
      toolCallIdPrefix: params.toolCallIdPrefix,
      ...(idempotencyKey ? { idempotencyKey } : {}),
      ...(runId ? { runId } : {}),
      outcome,
    });
    return outcome;
  };
  const mcpOutcome = await invokeWarmMcpTool({
    cfg: params.cfg,
    toolName,
    args,
    sessionKey,
    toolCallIdPrefix: params.toolCallIdPrefix,
    idempotencyKey,
    approvalMode: params.approvalMode,
    requestedAgentId: normalizeOptionalString(params.input.agentId),
    workspaceDir: params.input.workspaceDir,
    expectedSessionGeneration: params.input.expectedSessionGeneration,
    getRuntimeConfig: params.getRuntimeConfig ?? (() => params.cfg),
  });
  if (mcpOutcome) {
    return recordAndReturn(mcpOutcome);
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

  let scoped = resolveTools(knownCoreTool);
  if (knownCoreTool && !scoped.tools.some((candidate) => candidate.name === toolName)) {
    scoped = resolveTools(false);
  }
  const { agentId, tools, workspaceDir, sessionId } = scoped;
  const requestedAgentId = normalizeOptionalString(params.input.agentId);
  if (requestedAgentId && agentId && requestedAgentId !== agentId) {
    return recordAndReturn({
      ok: false,
      status: 400,
      toolName,
      error: {
        type: "invalid_request",
        message: `agent id "${requestedAgentId}" does not match session agent "${agentId}"`,
      },
    });
  }
  const tool = tools.find((candidate) => candidate.name === toolName);
  if (!tool) {
    return recordAndReturn({
      ok: false,
      status: 404,
      toolName,
      error: { type: "not_found", message: `Tool not available: ${toolName}` },
    });
  }

  try {
    const assertedRoot = normalizeOptionalString(params.input.workspaceDir);
    const expectedGeneration = params.input.expectedSessionGeneration ?? sessionId;
    const initialConfigRevision = assertedRoot
      ? resolveRuntimeConfigCacheKey(params.cfg)
      : undefined;
    const assertScopeCurrent = () => {
      if (!assertedRoot && params.input.expectedSessionGeneration === undefined) return;
      const currentConfig = params.getRuntimeConfig?.() ?? params.cfg;
      const current = loadSessionEntry(sessionKey).entry;
      const currentRoot =
        resolveSessionWorkspaceDir({
          spawnedWorkspaceDir: current?.spawnedWorkspaceDir,
          persistedWorkspaceDir: current?.workspaceDir,
        }) ??
        resolveAgentWorkspaceDir(currentConfig, agentId ?? resolveDefaultAgentId(currentConfig));
      if (
        assertedRoot &&
        (path.relative(realpathSync(workspaceDir), realpathSync(assertedRoot)) !== "" ||
          path.relative(realpathSync(currentRoot), realpathSync(assertedRoot)) !== "")
      ) {
        throw new ToolAuthorizationError(
          "Tool workspace differs from the authorized Main workspace",
        );
      }
      if (expectedGeneration !== undefined && current?.sessionId !== expectedGeneration)
        throw new ToolAuthorizationError("Tool session generation changed");
      if (
        initialConfigRevision &&
        resolveRuntimeConfigCacheKey(currentConfig) !== initialConfigRevision
      )
        throw new ToolAuthorizationError("Tool policy configuration changed");
    };
    assertScopeCurrent();
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
      return recordAndReturn({
        ok: false,
        status: 403,
        toolName,
        error: {
          type: "tool_call_blocked",
          message: hookResult.reason,
          requiresApproval: hookResult.deniedReason === "plugin-approval",
        },
      });
    }
    assertScopeCurrent();
    const result = await gatewayTool.execute?.(toolCallId, hookResult.params);
    assertScopeCurrent();
    return recordAndReturn({
      ok: true,
      status: 200,
      toolName,
      source: resolveToolSource(gatewayTool),
      result,
    });
  } catch (err) {
    const inputStatus = resolveToolInputErrorStatus(err);
    if (inputStatus !== null) {
      return recordAndReturn({
        ok: false,
        status: inputStatus === 403 ? 403 : 400,
        toolName,
        error: {
          type: "tool_error",
          message: getErrorMessage(err) || "invalid tool arguments",
        },
      });
    }
    logWarn(`tools-invoke: tool execution failed: ${String(err)}`);
    return recordAndReturn({
      ok: false,
      status: 500,
      toolName,
      error: { type: "tool_error", message: "tool execution failed" },
    });
  }
}
