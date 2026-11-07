/**
 * Builds the effective OpenClaw agent tool surface.
 * Assembles core, shell, channel, OpenClaw, plugin, and Tool Search tools, then
 * applies sandbox, profile, provider, sender, group, and sub-agent policy.
 */
import path from "node:path";
import {
  normalizeLowercaseStringOrEmpty,
  normalizeOptionalLowercaseString,
} from "@openclaw/normalization-core/string-coerce";
import type { SourceReplyDeliveryMode } from "../auto-reply/get-reply-options.types.js";
import { HEARTBEAT_RESPONSE_TOOL_NAME } from "../auto-reply/heartbeat-tool-response.js";
import type { InboundEventKind } from "../channels/inbound-event/kind.js";
import { resolveExecCommandHighlighting } from "../config/exec-command-highlighting.js";
import type { ModelCompatConfig } from "../config/types.models.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import {
  createDiagnosticTraceContextFromActiveScope,
  type DiagnosticTraceContext,
} from "../infra/diagnostic-trace-context.js";
import { resolveEventSessionRoutingPolicy } from "../infra/event-session-routing.js";
import {
  type ExecAsk,
  type ExecMode,
  type ExecSecurity,
  resolveExecPolicyForMode,
} from "../infra/exec-approvals.js";
import { resolveMergedSafeBinProfileFixtures } from "../infra/exec-safe-bin-runtime-policy.js";
import { logWarn } from "../logger.js";
import { getPluginToolMeta } from "../plugins/tools.js";
import { createLazyImportLoader } from "../shared/lazy-promise.js";
import type { SkillSnapshot } from "../skills/types.js";
import { resolveGatewayMessageChannel } from "../utils/message-channel.js";
import type { ContentProvenanceContext } from "../../../shared/security/content-provenance.js";
import { resolveAgentConfig } from "./agent-scope.js";
import { wrapToolWithAbortSignal } from "./agent-tools.abort.js";
import {
  type ToolOutcomeObserver,
  wrapToolWithBeforeToolCallHook,
} from "./agent-tools.before-tool-call.js";
import { applyDeferredFollowupToolDescriptions } from "./agent-tools.deferred-followup.js";
import type { ToolLoopTerminationObserver } from "./tool-loop-termination.js";
import { filterToolsByMessageProvider } from "./agent-tools.message-provider-policy.js";
import {
  isToolAllowedByPolicies,
  resolveEffectiveToolPolicy,
  resolveGroupToolPolicy,
  resolveInheritedToolPolicyForSession,
  resolveSubagentToolPolicyForSession,
} from "./agent-tools.policy.js";
import {
  assertRequiredParams,
  createHostWorkspaceEditTool,
  createHostWorkspaceWriteTool,
  createOpenClawReadTool,
  createSandboxedEditTool,
  createSandboxedLsTool,
  createSandboxedReadTool,
  createSandboxedWriteTool,
  getToolParamsRecord,
  wrapToolMemoryFlushAppendOnlyWrite,
  wrapToolWorkspaceRootGuard,
  wrapToolWorkspaceRootGuardWithOptions,
  wrapToolParamValidation,
  resolveToolPathAgainstWorkspaceRoot,
} from "./agent-tools.read.js";
import { cleanToolSchemaForGemini, normalizeToolParameters } from "./agent-tools.schema.js";
import type { AnyAgentTool } from "./agent-tools.types.js";
import { createPersistentTaskTool } from './tools/persistent-task-tool.js';
import { extractApplyPatchTargetPaths } from "./apply-patch-paths.js";
import { createApplyPatchTool, parsePatchText } from "./apply-patch.js";
import { createMemoryQueryTool } from "../runtime-core/memory-query-tool.js";
import { createMemorySelfEditTools } from "../runtime-core/memory-self-edit-adapter.js";
import type { BlockStoreApi, ContextBlockSink } from "../context-engine/block.js";
import { createDcsContextAgentTools } from "./tools/context-agent-tools.js";
import type { WorkspaceFactService } from "../context-engine/factstore/workspace-fact-service.js";
import {
  isCodingParseOnTouchEnabled,
  isCodingStaleWriteGuardEnabled,
  isCodingWriteJournalEnabled,
  isCodingSymbolLeaseEnabled,
  resolveCodingAutoVerifyConfig,
  resolveSymbolLeaseMode,
} from "../context-engine/coding-runtime-flags.js";
import { wrapToolWithSymbolLease } from "./symbol-lease-guard.js";
import { wrapToolWithParseOnTouch } from "./parse-on-touch.js";
import { wrapToolWithStaleWriteGuard } from "./stale-write-guard.js";
import { wrapToolWithStage1ToolGuard, type Stage1ToolGuardOptions } from "./stage1-tool-guard.js";
import { wrapToolWithStage4ToolGuard, type Stage4ToolGuardOptions } from "./stage4-tool-guard.js";
import { type TestRunnerExecutor, wrapToolWithWriteSideEffects } from "./write-side-effects.js";
import { wrapToolWithSoftWriteGates } from "./write-soft-gates.js";
import { wrapToolWithDestructiveTier } from "./write-destructive-tier.js";
import {
  resolveCanonicalWorkspaceWriteScope,
  wrapToolWithWorkspaceExternalWriteProvenance,
} from "./workspace-external-write-provenance-policy.js";
import { createUndoWriteTool, wrapToolWithWriteJournal } from "./tools/write-journal.js";
import type { AuthProfileStore } from "./auth-profiles/types.js";
import { describeExecTool, describeProcessTool } from "./bash-tools.descriptions.js";
import type { ExecToolDefaults } from "./bash-tools.exec-types.js";
import type { ProcessToolDefaults } from "./bash-tools.process.js";
import { execSchema, processSchema } from "./bash-tools.schemas.js";
import { listChannelAgentTools } from "./channel-tools.js";
import { shouldSuppressManagedWebSearchTool } from "./codex-native-web-search.js";
import { resolveImageSanitizationLimits } from "./image-sanitization.js";
import {
  filterLocalModelLeanTools,
  resolveLocalModelLeanPreserveToolNames,
} from "./local-model-lean.js";
import type { ModelAuthMode } from "./model-auth.js";
import { resolveOpenClawPluginToolsForOptions } from "./openclaw-plugin-tools.js";
import { createOpenClawTools } from "./openclaw-tools.js";
import type { SandboxContext } from "./sandbox.js";
import type {
  ManualCompactionRequest,
  ManualCompactionRequestStatus,
} from "./manual-compaction-request.js";
import { SANDBOX_AGENT_WORKSPACE_MOUNT } from "./sandbox/constants.js";
import { resolveReadOnlyWorkspaceSkillMounts } from "./sandbox/workspace-mounts.js";
import { resolveSenderToolPolicy } from "./sender-tool-policy.js";
import { createLsTool, createReadTool } from "./sessions/index.js";
import {
  isSubagentEnvelopeSession,
  resolveSubagentCapabilityStore,
} from "./subagent-capabilities.js";
import {
  EXEC_TOOL_DISPLAY_SUMMARY,
  PROCESS_TOOL_DISPLAY_SUMMARY,
} from "./tool-description-presets.js";
import { createToolFsPolicy, resolveToolFsConfig } from "./tool-fs-policy.js";
import { resolveToolLoopDetectionConfig } from "./tool-loop-detection-config.js";
import {
  applyToolPolicyPipeline,
  buildDefaultToolPolicyPipelineSteps,
} from "./tool-policy-pipeline.js";
import {
  collectExplicitAllowlist,
  collectExplicitDenylist,
  expandToolGroups,
  hasRestrictiveAllowPolicy,
  mergeAlsoAllowPolicy,
  normalizeToolName,
  replaceWithEffectiveToolAllowlist,
  resolveToolProfilePolicy,
} from "./tool-policy.js";
import {
  createToolSearchTools,
  resolveToolSearchConfig,
  TOOL_CALL_RAW_TOOL_NAME,
  TOOL_DESCRIBE_RAW_TOOL_NAME,
  TOOL_SEARCH_CODE_MODE_TOOL_NAME,
  TOOL_SEARCH_RAW_TOOL_NAME,
  type ToolSearchCatalogRef,
  type ToolSearchCatalogToolExecutor,
} from "./tool-search.js";
import { resolveWorkspaceRoot } from "./workspace-dir.js";
import { createVerseShellResultTool } from "./verseshell/result-tool.js";
import { createVerseShellReadonlyFacadeTools } from "./verseshell/readonly-facade.js";
import { createVerseShellPatchPreviewTool } from "./verseshell/patch-preview.js";

const MEMORY_FLUSH_ALLOWED_TOOL_NAMES = new Set(["read", "write"]);

type GuardContainerMount = {
  containerRoot: string;
  hostRoot: string;
};

function readOnlySandboxReadMounts(
  sandbox: SandboxContext | null | undefined,
): GuardContainerMount[] | undefined {
  if (!sandbox) {
    return undefined;
  }
  const mounts: GuardContainerMount[] = [];
  if (sandbox.workspaceAccess === "ro" && sandbox.agentWorkspaceDir !== sandbox.workspaceDir) {
    mounts.push({
      containerRoot: SANDBOX_AGENT_WORKSPACE_MOUNT,
      hostRoot: sandbox.agentWorkspaceDir,
    });
  }
  if (sandbox.workspaceAccess === "rw") {
    mounts.push(
      ...resolveReadOnlyWorkspaceSkillMounts({
        workspaceDir: sandbox.workspaceDir,
        agentWorkspaceDir: sandbox.agentWorkspaceDir,
        skillsWorkspaceDir: sandbox.skillsWorkspaceDir,
        workdir: sandbox.containerWorkdir,
        workspaceAccess: sandbox.workspaceAccess,
      }).map((mount) => ({
        containerRoot: mount.containerPath,
        hostRoot: mount.hostPath,
      })),
    );
  }
  return mounts.length > 0 ? mounts : undefined;
}

function resolveSkillReadRoots(skillsSnapshot?: SkillSnapshot): string[] | undefined {
  const roots = new Set<string>();
  for (const skill of skillsSnapshot?.resolvedSkills ?? []) {
    const baseDir = typeof skill.baseDir === "string" ? skill.baseDir.trim() : "";
    const filePath = typeof skill.filePath === "string" ? skill.filePath.trim() : "";
    const root = baseDir || (filePath ? path.dirname(filePath) : "");
    if (!root || !path.isAbsolute(root)) {
      continue;
    }
    roots.add(path.resolve(root));
  }
  if (roots.size === 0) {
    return undefined;
  }
  return Array.from(roots);
}

type BashToolsModule = typeof import("./bash-tools.js");

const bashToolsModuleLoader = createLazyImportLoader<BashToolsModule>(
  () => import("./bash-tools.js"),
);

function loadBashToolsModule(): Promise<BashToolsModule> {
  return bashToolsModuleLoader.load();
}

function createLazyExecTool(defaults?: ExecToolDefaults): AnyAgentTool {
  let loadedTool: AnyAgentTool | undefined;
  const loadTool = async () => {
    if (!loadedTool) {
      const { createExecTool } = await loadBashToolsModule();
      loadedTool = createExecTool(defaults) as unknown as AnyAgentTool;
    }
    return loadedTool;
  };

  return {
    name: "exec",
    label: "exec",
    displaySummary: EXEC_TOOL_DISPLAY_SUMMARY,
    get description() {
      return describeExecTool({
        agentId: defaults?.agentId,
        hasCronTool: defaults?.hasCronTool === true,
      });
    },
    parameters: execSchema,
    prepareBeforeToolCallParams: async (...args) =>
      (await loadTool()).prepareBeforeToolCallParams?.(...args) ?? args[0],
    finalizeBeforeToolCallParams: (params, preparedParams) =>
      loadedTool?.finalizeBeforeToolCallParams?.(params, preparedParams) ?? params,
    execute: async (...args: Parameters<AnyAgentTool["execute"]>) =>
      (await loadTool()).execute(...args),
  } as AnyAgentTool;
}

function createLazyProcessTool(defaults?: ProcessToolDefaults): AnyAgentTool {
  let loadedTool: AnyAgentTool | undefined;
  const loadTool = async () => {
    if (!loadedTool) {
      const { createProcessTool } = await loadBashToolsModule();
      loadedTool = createProcessTool(defaults) as unknown as AnyAgentTool;
    }
    return loadedTool;
  };

  return {
    name: "process",
    label: "process",
    displaySummary: PROCESS_TOOL_DISPLAY_SUMMARY,
    description: describeProcessTool({ hasCronTool: defaults?.hasCronTool === true }),
    parameters: processSchema,
    execute: async (...args: Parameters<AnyAgentTool["execute"]>) =>
      (await loadTool()).execute(...args),
  } as AnyAgentTool;
}

/** Resolve the process-tool isolation key for exec/process session state. */
export function resolveProcessToolScopeKey(params: {
  scopeKey?: string;
  sessionKey?: string;
  sessionId?: string;
  agentId?: string;
}): string | undefined {
  const explicitScopeKey = params.scopeKey?.trim();
  if (explicitScopeKey) {
    return explicitScopeKey;
  }
  const sessionKey = params.sessionKey?.trim();
  if (sessionKey) {
    return sessionKey;
  }
  const sessionId = params.sessionId?.trim();
  if (sessionId) {
    return sessionId;
  }
  const agentId = params.agentId?.trim();
  return agentId ? `agent:${agentId}` : undefined;
}

function applyModelProviderToolPolicy(
  toolsInput: AnyAgentTool[],
  params?: {
    config?: OpenClawConfig;
    modelProvider?: string;
    modelApi?: string;
    modelId?: string;
    agentId?: string;
    sessionKey?: string;
    agentDir?: string;
    modelCompat?: ModelCompatConfig;
    suppressManagedWebSearch?: boolean;
    runtimeToolAllowlist?: string[];
    localModelLeanPreserveToolNames?: string[];
  },
): AnyAgentTool[] {
  let tools = toolsInput;
  tools = filterLocalModelLeanTools({
    tools,
    config: params?.config,
    agentId: params?.agentId,
    sessionKey: params?.sessionKey,
    preserveToolNames: params?.localModelLeanPreserveToolNames ?? params?.runtimeToolAllowlist,
  });

  if (
    params?.suppressManagedWebSearch !== false &&
    shouldSuppressManagedWebSearchTool({
      config: params?.config,
      modelProvider: params?.modelProvider,
      modelApi: params?.modelApi,
      agentDir: params?.agentDir,
    })
  ) {
    return tools.filter((tool) => tool.name !== "web_search");
  }

  return tools;
}

function isApplyPatchAllowedForModel(params: {
  modelProvider?: string;
  modelId?: string;
  allowModels?: string[];
}) {
  const allowModels = Array.isArray(params.allowModels) ? params.allowModels : [];
  if (allowModels.length === 0) {
    return true;
  }
  const modelId = params.modelId?.trim();
  if (!modelId) {
    return false;
  }
  const normalizedModelId = normalizeLowercaseStringOrEmpty(modelId);
  const provider = normalizeOptionalLowercaseString(params.modelProvider);
  const normalizedFull =
    provider && !normalizedModelId.includes("/")
      ? `${provider}/${normalizedModelId}`
      : normalizedModelId;
  return allowModels.some((entry) => {
    const normalized = normalizeOptionalLowercaseString(entry);
    if (!normalized) {
      return false;
    }
    return normalized === normalizedModelId || normalized === normalizedFull;
  });
}

type ExecPolicyLayer = {
  mode?: ExecMode;
  security?: ExecSecurity;
  ask?: ExecAsk;
};

function hasLegacyExecPolicy(exec?: ExecPolicyLayer): boolean {
  return exec?.security !== undefined || exec?.ask !== undefined;
}

function applyExecPolicyLayer(base: ExecPolicyLayer, layer?: ExecPolicyLayer): ExecPolicyLayer {
  if (!layer) {
    return base;
  }
  if (layer.mode) {
    return {
      mode: layer.mode,
      ...resolveExecPolicyForMode(layer.mode),
    };
  }
  if (hasLegacyExecPolicy(layer)) {
    return {
      security: layer.security ?? base.security,
      ask: layer.ask ?? base.ask,
    };
  }
  return base;
}

function resolveExecConfig(params: { cfg?: OpenClawConfig; agentId?: string }) {
  const cfg = params.cfg;
  const globalExec = cfg?.tools?.exec;
  const agentExec =
    cfg && params.agentId ? resolveAgentConfig(cfg, params.agentId)?.tools?.exec : undefined;
  const layeredPolicy = applyExecPolicyLayer(applyExecPolicyLayer({}, globalExec), agentExec);
  return {
    host: agentExec?.host ?? globalExec?.host,
    mode: layeredPolicy.mode,
    security: layeredPolicy.security,
    ask: layeredPolicy.ask,
    node: agentExec?.node ?? globalExec?.node,
    pathPrepend: agentExec?.pathPrepend ?? globalExec?.pathPrepend,
    safeBins: agentExec?.safeBins ?? globalExec?.safeBins,
    strictInlineEval: agentExec?.strictInlineEval ?? globalExec?.strictInlineEval,
    commandHighlighting: resolveExecCommandHighlighting({
      config: cfg,
      agentId: params.agentId,
    }),
    safeBinTrustedDirs: agentExec?.safeBinTrustedDirs ?? globalExec?.safeBinTrustedDirs,
    safeBinProfiles: resolveMergedSafeBinProfileFixtures({
      global: globalExec,
      local: agentExec,
    }),
    reviewer: agentExec?.reviewer ?? globalExec?.reviewer,
    backgroundMs: agentExec?.backgroundMs ?? globalExec?.backgroundMs,
    timeoutSec: agentExec?.timeoutSec ?? globalExec?.timeoutSec,
    approvalRunningNoticeMs:
      agentExec?.approvalRunningNoticeMs ?? globalExec?.approvalRunningNoticeMs,
    cleanupMs: agentExec?.cleanupMs ?? globalExec?.cleanupMs,
    notifyOnExit: agentExec?.notifyOnExit ?? globalExec?.notifyOnExit,
    notifyOnExitEmptySuccess:
      agentExec?.notifyOnExitEmptySuccess ?? globalExec?.notifyOnExitEmptySuccess,
    applyPatch: agentExec?.applyPatch ?? globalExec?.applyPatch,
  };
}

export { resolveToolLoopDetectionConfig } from "./tool-loop-detection-config.js";

/** Test-only access to internal tool assembly helpers. */
export const testing = {
  cleanToolSchemaForGemini,
  getToolParamsRecord,
  wrapToolParamValidation,
  assertRequiredParams,
  applyModelProviderToolPolicy,
} as const;

export type OpenClawCodingToolConstructionPlan = {
  includeBaseCodingTools: boolean;
  includeShellTools: boolean;
  includeChannelTools: boolean;
  includeOpenClawTools: boolean;
  includePluginTools: boolean;
};

/** Build the runtime tool list for one agent run. */
export function createOpenClawCodingTools(options?: {
  agentId?: string;
  /** Structured content sidecar consumed by sensitive sink adapters. */
  contentProvenance?: unknown;
  exec?: ExecToolDefaults & ProcessToolDefaults;
  messageProvider?: string;
  agentAccountId?: string;
  messageTo?: string;
  messageThreadId?: string | number;
  sandbox?: SandboxContext | null;
  sessionKey?: string;
  /**
   * The actual live run session key. When the tool set is constructed with a
   * sandbox/policy session key, this allows `session_status({sessionKey:"current"})`
   * to resolve to the live run session instead of the stale sandbox key.
   */
  runSessionKey?: string;
  /** Ephemeral session UUID 閳?regenerated on /new and /reset. */
  sessionId?: string;
  /** Stable run identifier for this agent invocation. */
  runId?: string;
  /** Diagnostic trace context for hook/log correlation during this run. */
  trace?: DiagnosticTraceContext;
  /** What initiated this run (for trigger-specific tool restrictions). */
  trigger?: string;
  /** Stable cron job identifier populated for cron-triggered runs. */
  jobId?: string;
  /** Relative workspace path that memory-triggered writes may append to. */
  memoryFlushWritePath?: string;
  agentDir?: string;
  /** Task working directory for coding tools. Defaults to workspaceDir. */
  cwd?: string;
  /** Workspace revision used to isolate read-only VerseShell facade cache entries. */
  workspaceRevision?: string;
  workspaceDir?: string;
  /**
   * Workspace directory that spawned subagents should inherit.
   * When sandboxing uses a copied workspace (`ro` or `none`), workspaceDir is the
   * sandbox copy but subagents should inherit the real agent workspace instead.
   * Defaults to workspaceDir when not set.
   */
  spawnWorkspaceDir?: string;
  config?: OpenClawConfig;
  abortSignal?: AbortSignal;
  /** Disable hook-owned diagnostics when an outer runtime owns tool diagnostics. */
  emitBeforeToolCallDiagnostics?: boolean;
  /**
   * Provider of the currently selected model (used for provider-specific tool quirks).
   * Example: "anthropic", "openai", "google", "openai".
   */
  modelProvider?: string;
  /** Model id for the current provider (used for model-specific tool gating). */
  modelId?: string;
  /** Model API for the current provider (used for provider-native tool arbitration). */
  modelApi?: string;
  /** Model context window in tokens (used to scale read-tool output budget). */
  modelContextWindowTokens?: number;
  /** Resolved runtime model compatibility hints. */
  modelCompat?: ModelCompatConfig;
  /** If false, keep OpenClaw web_search even when a provider-native search tool is active. */
  suppressManagedWebSearch?: boolean;
  /**
   * Auth mode for the current provider. We only need this for Anthropic OAuth
   * tool-name blocking quirks.
   */
  modelAuthMode?: ModelAuthMode;
  /** Current channel ID for auto-threading (Slack). */
  currentChannelId?: string;
  /** Normalized conversation id exposed to tool hooks. Defaults to currentChannelId. */
  hookChannelId?: string;
  /** Current thread timestamp for auto-threading (Slack). */
  currentThreadTs?: string;
  /** Current inbound message id for action fallbacks (e.g. Telegram react). */
  currentMessageId?: string | number;
  /** True when the current inbound turn carried audio media. */
  currentInboundAudio?: boolean;
  /** Group id for channel-level tool policy resolution. */
  groupId?: string | null;
  /** Group channel label (e.g. #general) for channel-level tool policy resolution. */
  groupChannel?: string | null;
  /** Group space label (e.g. guild/team id) for channel-level tool policy resolution. */
  groupSpace?: string | null;
  /** Trusted provider role ids for the requester in this group turn. */
  memberRoleIds?: string[];
  /** Parent session key for subagent group policy inheritance. */
  spawnedBy?: string | null;
  senderId?: string | null;
  senderName?: string | null;
  senderUsername?: string | null;
  senderE164?: string | null;
  /** Reply-to mode for Slack auto-threading. */
  replyToMode?: "off" | "first" | "all" | "batched";
  /** Mutable ref to track if a reply was sent (for "first" mode). */
  hasRepliedRef?: { value: boolean };
  /** Allow plugin tools for this run to late-bind the gateway subagent. */
  allowGatewaySubagentBinding?: boolean;
  /** Runtime-scoped explicit allowlist used to materialize matching plugin tools. */
  runtimeToolAllowlist?: string[];
  /** If true, the model has native vision capability */
  modelHasVision?: boolean;
  /** Require explicit message targets (no implicit last-route sends). */
  requireExplicitMessageTarget?: boolean;
  /** Visible source replies must be sent through the message tool when set to message_tool_only. */
  sourceReplyDeliveryMode?: SourceReplyDeliveryMode;
  inboundEventKind?: InboundEventKind;
  /** If true, omit the message tool from the tool list. */
  disableMessageTool?: boolean;
  /** Keep the message tool available even when the selected profile omits it. */
  forceMessageTool?: boolean;
  /** Include the heartbeat response tool for structured heartbeat outcomes. */
  enableHeartbeatTool?: boolean;
  /** Keep the heartbeat response tool available even when the selected profile omits it. */
  forceHeartbeatTool?: boolean;
  /** If false, build plugin tools only while preserving the shared policy pipeline. */
  includeCoreTools?: boolean;
  /** Include Tool Search control tools when enabled for this run. */
  includeToolSearchControls?: boolean;
  /** Executes cataloged tools through the active agent run lifecycle. */
  toolSearchCatalogExecutor?: ToolSearchCatalogToolExecutor;
  /** Runtime-local Tool Search catalog ref shared with attempt compaction. */
  toolSearchCatalogRef?: ToolSearchCatalogRef;
  /** Limits which tool families are materialized before the shared policy pipeline runs. */
  toolConstructionPlan?: OpenClawCodingToolConstructionPlan;
  /** Trusted sender identity bit for command/channel-action auth; does not filter model tools. */
  senderIsOwner?: boolean;
  /** Auth profiles already loaded for this run; used for prompt-time tool availability. */
  authProfileStore?: AuthProfileStore;
  /** Callback invoked when sessions_yield tool is called. */
  onYield?: (message: string) => Promise<void> | void;
  /** Records a current-session compaction request for post-attempt execution. */
  onManualCompactionRequest?: (request: ManualCompactionRequest) => ManualCompactionRequestStatus;
  /** TF-0645: lazy transcript read for the checkpoint-first reset tool. */
  readCheckpointTranscript?: () => string | undefined;
  /** Optional instrumentation callback for tool preparation stage timing. */
  recordToolPrepStage?: (name: string) => void;
  /** Lower routine policy-removal audits for diagnostic-only tool probes. */
  toolPolicyAuditLogLevel?: "info" | "debug";
  /** Live observer called after wrapped tool outcomes are recorded. */
  onToolOutcome?: ToolOutcomeObserver;
  /**
   * Stage 1 golden-runner opt-in. When omitted, tool construction is
   * byte-for-byte equivalent to the legacy path and no Tool Guard runs.
   */
  stage1ToolGuard?: Stage1ToolGuardOptions;
  /**
   * Stage 4 unified CapabilityGrant Tool Guard opt-in. When omitted, tool
   * construction is byte-for-byte equivalent to the legacy path and no Tool
   * Guard runs. When both Stage 1 and Stage 4 options are present, Stage 4
   * wins for the guarded tool.
   */
  stage4ToolGuard?: Stage4ToolGuardOptions;
  /**
   * Live observer called when a critical tool-loop veto must end the turn.
   * Forwarded into every wrapped coding tool so a runaway identical-call loop
   * terminates the run instead of blocking one call at a time forever.
   */
  onToolLoopTermination?: ToolLoopTerminationObserver;
  /**
   * DCS Stage 5: session-scoped BlockStore for context_read / context_search.
   * When provided with sessionId, registers real context_* agent tools.
   */
  dcsBlockStore?: Pick<BlockStoreApi, "query" | "queryByEntity">;
  /** DCS Stage 5: sink for context_write notes admissions. */
  dcsContextBlockSink?: ContextBlockSink;
  /** Optional agency role for context_write whitelist (defaults to implementer). */
  dcsContextRole?: string;
  /**
   * C0-3: shared per-workspace FactStore + Materializer for Fact view tools.
   * When omitted, the four view tools are absent (dep-gate, same as Block tools).
   */
  factService?: WorkspaceFactService;
  /** Optional ContextPack budget for context_understand (W0-4). */
  dcsFactBudgetChars?: number;
  /** C0-2 override for parse-on-touch after successful reads / parse-on-write. */
  parseOnTouchEnabled?: boolean;
  /** C2-2 override for stale full-file write guard (default false). */
  staleWriteGuardEnabled?: boolean;
  /** C2-8 override for write journal (default true). */
  writeJournalEnabled?: boolean;
  /** C5-1 override for symbol lease on write tools (default false). */
  symbolLeaseEnabled?: boolean;
  /** Runtime-only resolved skill paths that the read tool may load under workspaceOnly. */
  skillsSnapshot?: SkillSnapshot;
}): AnyAgentTool[] {
  const effectiveTrace = options?.trace ?? createDiagnosticTraceContextFromActiveScope();
  const sandbox = options?.sandbox?.enabled ? options.sandbox : undefined;
  const isMemoryFlushRun = options?.trigger === "memory";
  if (isMemoryFlushRun && !options?.memoryFlushWritePath) {
    throw new Error("memoryFlushWritePath required for memory-triggered tool runs");
  }
  const memoryFlushWritePath = isMemoryFlushRun ? options.memoryFlushWritePath : undefined;
  const cronSelfRemoveOnlyJobId =
    options?.trigger === "cron" && options.jobId?.trim() ? options.jobId.trim() : undefined;
  const {
    agentId,
    globalPolicy,
    globalProviderPolicy,
    agentPolicy,
    agentProviderPolicy,
    profile,
    providerProfile,
    profileAlsoAllow,
    providerProfileAlsoAllow,
  } = resolveEffectiveToolPolicy({
    config: options?.config,
    sessionKey: options?.sessionKey,
    agentId: options?.agentId,
    modelProvider: options?.modelProvider,
    modelId: options?.modelId,
  });
  // Prefer the already-resolved sandbox context policy. Recomputing from
  // sessionKey/config can lose the real sandbox agent when callers pass a
  // legacy alias like `main` instead of an agent session key.
  const sandboxToolPolicy = sandbox?.tools;
  const groupPolicy = resolveGroupToolPolicy({
    config: options?.config,
    sessionKey: options?.sessionKey,
    spawnedBy: options?.spawnedBy,
    messageProvider: options?.messageProvider,
    groupId: options?.groupId,
    groupChannel: options?.groupChannel,
    groupSpace: options?.groupSpace,
    accountId: options?.agentAccountId,
    senderId: options?.senderId,
    senderName: options?.senderName,
    senderUsername: options?.senderUsername,
    senderE164: options?.senderE164,
  });
  const senderPolicy = resolveSenderToolPolicy({
    config: options?.config,
    agentId,
    messageProvider: options?.messageProvider,
    senderId: options?.senderId,
    senderName: options?.senderName,
    senderUsername: options?.senderUsername,
    senderE164: options?.senderE164,
  });
  const profilePolicy = resolveToolProfilePolicy(profile);
  const providerProfilePolicy = resolveToolProfilePolicy(providerProfile);

  const enableHeartbeatTool =
    options?.enableHeartbeatTool === true ||
    (options?.trigger === "heartbeat" &&
      options?.config?.messages?.visibleReplies === "message_tool");
  const forceHeartbeatTool = options?.forceHeartbeatTool === true || enableHeartbeatTool;
  const toolSearchConfig = resolveToolSearchConfig(options?.config);
  const toolSearchControlsEnabled =
    options?.includeToolSearchControls === true &&
    (toolSearchConfig.enabled || toolSearchConfig.auto);
  const toolSearchControlAllowlist = toolSearchControlsEnabled
    ? [
        TOOL_SEARCH_CODE_MODE_TOOL_NAME,
        TOOL_SEARCH_RAW_TOOL_NAME,
        TOOL_DESCRIBE_RAW_TOOL_NAME,
        TOOL_CALL_RAW_TOOL_NAME,
      ]
    : [];
  const mergeToolSearchControlAllowlist = <TPolicy extends { allow?: string[] }>(
    policy: TPolicy | undefined,
  ) => mergeAlsoAllowPolicy(policy, toolSearchControlAllowlist);
  const runtimeToolAllowlistIncludesMessage = expandToolGroups(
    options?.runtimeToolAllowlist ?? [],
  ).some((toolName) => {
    const normalized = normalizeToolName(toolName);
    return normalized === "*" || normalized === "message";
  });
  const localModelLeanPreserveToolNames = resolveLocalModelLeanPreserveToolNames({
    toolNames: options?.runtimeToolAllowlist,
    forceMessageTool: options?.forceMessageTool,
    sourceReplyDeliveryMode: options?.sourceReplyDeliveryMode,
  });
  const runtimeProfileAlsoAllow = [
    ...(options?.forceMessageTool || options?.sourceReplyDeliveryMode === "message_tool_only"
      ? ["message"]
      : []),
    ...(runtimeToolAllowlistIncludesMessage ? ["message"] : []),
    ...(forceHeartbeatTool ? [HEARTBEAT_RESPONSE_TOOL_NAME] : []),
    ...toolSearchControlAllowlist,
  ];
  const profilePolicyWithAlsoAllow = mergeAlsoAllowPolicy(profilePolicy, [
    ...(profileAlsoAllow ?? []),
    ...runtimeProfileAlsoAllow,
  ]);
  const providerProfilePolicyWithAlsoAllow = mergeAlsoAllowPolicy(providerProfilePolicy, [
    ...(providerProfileAlsoAllow ?? []),
    ...runtimeProfileAlsoAllow,
  ]);
  // Prefer sessionKey for process isolation scope to prevent cross-session process visibility/killing.
  // Fallback to agentId if no sessionKey is available (e.g. legacy or global contexts).
  const scopeKey = resolveProcessToolScopeKey({
    scopeKey: options?.exec?.scopeKey,
    sessionKey: options?.sessionKey,
    sessionId: options?.sessionId,
    agentId,
  });
  const subagentStore = resolveSubagentCapabilityStore(options?.sessionKey, {
    cfg: options?.config,
  });
  const subagentPolicy =
    options?.sessionKey &&
    isSubagentEnvelopeSession(options.sessionKey, {
      cfg: options.config,
      store: subagentStore,
    })
      ? resolveSubagentToolPolicyForSession(options.config, options.sessionKey, {
          store: subagentStore,
        })
      : undefined;
  const inheritedToolPolicy = resolveInheritedToolPolicyForSession(
    options?.config,
    options?.sessionKey,
    {
      store: subagentStore,
    },
  );
  const globalPolicyWithToolSearchControls = mergeToolSearchControlAllowlist(globalPolicy);
  const globalProviderPolicyWithToolSearchControls =
    mergeToolSearchControlAllowlist(globalProviderPolicy);
  const agentPolicyWithToolSearchControls = mergeToolSearchControlAllowlist(agentPolicy);
  const agentProviderPolicyWithToolSearchControls =
    mergeToolSearchControlAllowlist(agentProviderPolicy);
  const groupPolicyWithToolSearchControls = mergeToolSearchControlAllowlist(groupPolicy);
  const senderPolicyWithToolSearchControls = mergeToolSearchControlAllowlist(senderPolicy);
  const sandboxToolPolicyWithToolSearchControls =
    mergeToolSearchControlAllowlist(sandboxToolPolicy);
  const subagentPolicyWithToolSearchControls = mergeToolSearchControlAllowlist(subagentPolicy);
  const allowBackground = isToolAllowedByPolicies("process", [
    profilePolicyWithAlsoAllow,
    providerProfilePolicyWithAlsoAllow,
    globalPolicyWithToolSearchControls,
    globalProviderPolicyWithToolSearchControls,
    agentPolicyWithToolSearchControls,
    agentProviderPolicyWithToolSearchControls,
    groupPolicyWithToolSearchControls,
    senderPolicyWithToolSearchControls,
    sandboxToolPolicyWithToolSearchControls,
    subagentPolicyWithToolSearchControls,
    inheritedToolPolicy,
  ]);
  options?.recordToolPrepStage?.("tool-policy");
  const execConfig = resolveExecConfig({ cfg: options?.config, agentId });
  const fsConfig = resolveToolFsConfig({ cfg: options?.config, agentId });
  const fsPolicy = createToolFsPolicy({
    workspaceOnly: isMemoryFlushRun || fsConfig.workspaceOnly,
  });
  const sandboxRoot = sandbox?.workspaceDir;
  const sandboxFsBridge = sandbox?.fsBridge;
  const allowWorkspaceWrites = sandbox?.workspaceAccess !== "ro";
  const workspaceRoot = resolveWorkspaceRoot(options?.workspaceDir);
  const runtimeRoot = resolveWorkspaceRoot(options?.cwd ?? options?.workspaceDir);
  const codingRoot = sandboxRoot ?? runtimeRoot;
  const externalWriteRoot = sandboxRoot ?? (options?.workspaceDir ? workspaceRoot : runtimeRoot);
  const parseOnTouchEnabled = isCodingParseOnTouchEnabled(options?.config, {
    parseOnTouchEnabled: options?.parseOnTouchEnabled,
  });
  const staleWriteGuardEnabled = isCodingStaleWriteGuardEnabled(options?.config, {
    staleWriteGuardEnabled: options?.staleWriteGuardEnabled,
  });
  const writeJournalEnabled = isCodingWriteJournalEnabled(options?.config, {
    writeJournalEnabled: options?.writeJournalEnabled,
  });
  const symbolLeaseEnabled = isCodingSymbolLeaseEnabled(options?.config, {
    symbolLeaseEnabled: options?.symbolLeaseEnabled,
  });
  const symbolLeaseMode = resolveSymbolLeaseMode(options?.config);
  const autoVerifyConfig = resolveCodingAutoVerifyConfig(options?.config);
  const contentProvenanceContext: ContentProvenanceContext = {
    provenance: options?.contentProvenance,
  };
  // Filled only after the complete policy/hook pipeline. The write wrapper's
  // closure therefore cannot bypass an exec tool removed from the final surface.
  const autoVerifyExecToolRef: { current?: AnyAgentTool } = {};
  const executeTestCommand: TestRunnerExecutor = async (params) =>
    await autoVerifyExecToolRef.current?.execute(
      params.toolCallId,
      {
        command: params.command,
        workdir: params.workdir,
        timeout: params.timeoutSeconds,
        yieldMs: Math.min(params.timeoutSeconds * 1000 + 1000, 120_000),
        background: false,
      },
      params.signal,
      undefined,
    );
  const codingSessionId = options?.sessionId;
  const applyParseOnTouch = (tool: AnyAgentTool): AnyAgentTool =>
    wrapToolWithParseOnTouch(tool, {
      workspaceRoot: codingRoot,
      materializer: options?.factService?.materializer,
      enabled: parseOnTouchEnabled,
      sessionId: codingSessionId,
      trackReadHashes: true,
    });
  const writeJournalFlags = {
    parseOnTouch: parseOnTouchEnabled,
    staleWriteGuard: staleWriteGuardEnabled,
    writeJournal: writeJournalEnabled,
    symbolLease: symbolLeaseEnabled,
  };
  const resolveExternalWriteScope = async (targetPaths: readonly string[]) => {
    try {
      const scope = await resolveCanonicalWorkspaceWriteScope({
        workspaceRoot: externalWriteRoot,
        targetPaths,
      });
      return { check: true, scopeKnown: true, ...scope };
    } catch {
      return { check: true, scopeKnown: false, targetPaths: [] };
    }
  };
  const applyWriteKit = (
    tool: AnyAgentTool,
    kind: "edit" | "write" | "apply_patch",
  ): AnyAgentTool => {
    let next = tool;
    // C5-1 symbol lease (default off): acquire before other write kit layers
    next = wrapToolWithSymbolLease(next, {
      workspaceRoot: codingRoot,
      holderId: codingSessionId ?? "anonymous",
      enabled: symbolLeaseEnabled,
      mode: symbolLeaseMode,
    });
    // apply_patch journals inside its batch lease so the snapshot and preflight
    // cannot race another overlapping patch. Other writes keep the outer wrapper.
    if (kind !== "apply_patch") {
      next = wrapToolWithWriteJournal(next, {
        workspaceRoot: codingRoot,
        sessionId: codingSessionId,
        enabled: writeJournalEnabled,
        flags: writeJournalFlags,
      });
    }
    // C2-2 stale guard only for full-file write
    if (kind === "write") {
      next = wrapToolWithStaleWriteGuard(next, {
        workspaceRoot: codingRoot,
        sessionId: codingSessionId,
        enabled: staleWriteGuardEnabled,
        factStore: options?.factService?.store,
      });
    }
    // C2-1 parse-on-write + C2-9 syntax check + C2-5 diag + C2-3 verify after success
    next = wrapToolWithWriteSideEffects(next, {
      workspaceRoot: codingRoot,
      materializer: options?.factService?.materializer,
      factStore: options?.factService?.store,
      parseOnWriteEnabled: parseOnTouchEnabled,
      syntaxCheckEnabled: true,
      verifyConsumeEnabled: true,
      autoVerifyEnabled: autoVerifyConfig.enabled,
      autoVerifyTimeoutSeconds: autoVerifyConfig.timeoutSeconds,
      autoVerifyCommand: autoVerifyConfig.command,
      executeTestCommand,
    });
    // C2-4 / C2-7 soft warnings (never hard-block)
    next = wrapToolWithSoftWriteGates(next, {
      workspaceRoot: codingRoot,
      factService: options?.factService,
      impactPrecheckEnabled: true,
      editReadinessEnabled: true,
    });
    // C2-10 destructive tier classification + approval metrics
    next = wrapToolWithDestructiveTier(next, {
      journalEnabled: writeJournalEnabled,
      // Missing diagnostics config is generally enabled elsewhere; this new monitor is explicit opt-in.
      approvalRateDiagnosticsEnabled: options?.config?.diagnostics?.enabled === true,
    });
    next = wrapToolWithWorkspaceExternalWriteProvenance(next, {
      action: kind,
      provenanceContext: contentProvenanceContext,
      workspaceRoot: externalWriteRoot,
      resolveTargets: async (params) => {
        const record = getToolParamsRecord(params);
        if (kind !== "apply_patch") {
          const rawPath = record?.path;
          if (typeof rawPath !== "string" || !rawPath.trim()) {
            return { check: false, scopeKnown: false, targetPaths: [] };
          }
          return resolveExternalWriteScope([
            resolveToolPathAgainstWorkspaceRoot({
              filePath: rawPath,
              root: codingRoot,
              containerWorkdir: sandbox?.containerWorkdir,
            }),
          ]);
        }
        const input = record?.input;
        if (typeof input !== "string" || !input.trim()) {
          return { check: false, scopeKnown: false, targetPaths: [] };
        }
        try {
          if (parsePatchText(input).hunks.length === 0) {
            return { check: false, scopeKnown: false, targetPaths: [] };
          }
        } catch {
          // Preserve the strict parser's existing error for malformed input.
          return { check: false, scopeKnown: false, targetPaths: [] };
        }
        const targetPaths = extractApplyPatchTargetPaths(record, {
          cwd: codingRoot,
          ...(sandboxRoot && sandboxFsBridge
            ? { sandbox: { root: sandboxRoot, bridge: sandboxFsBridge } }
            : {}),
        });
        // Let the strict patch parser retain its existing malformed-envelope
        // errors. A parsed patch with no extractable target is unknown and must
        // fail closed for external or unknown provenance.
        return targetPaths.length > 0
          ? resolveExternalWriteScope(targetPaths)
          : { check: true, scopeKnown: false, targetPaths: [] };
      },
    });
    return next;
  };
  const memoryFlushWriteRoot = sandboxRoot ?? workspaceRoot;
  const includeCoreTools = options?.includeCoreTools !== false;
  const toolConstructionPlan = options?.toolConstructionPlan ?? {
    includeBaseCodingTools: includeCoreTools,
    includeShellTools: includeCoreTools,
    includeChannelTools: includeCoreTools,
    includeOpenClawTools: includeCoreTools,
    includePluginTools: true,
  };
  const includeBaseCodingTools = includeCoreTools && toolConstructionPlan.includeBaseCodingTools;
  const includeShellTools = includeCoreTools && toolConstructionPlan.includeShellTools;
  const includeOpenClawTools = includeCoreTools && toolConstructionPlan.includeOpenClawTools;
  const includeChannelTools = toolConstructionPlan.includeChannelTools;
  const includePluginTools = toolConstructionPlan.includePluginTools;
  const workspaceOnly = fsPolicy.workspaceOnly;
  const skillReadRoots = sandboxRoot ? undefined : resolveSkillReadRoots(options?.skillsSnapshot);
  const applyPatchConfig = execConfig.applyPatch;
  // The fs policy is the umbrella boundary. An apply_patch-only restriction may
  // narrow it, but cannot weaken an enabled umbrella restriction.
  const applyPatchWorkspaceOnly = workspaceOnly || applyPatchConfig?.workspaceOnly === true;
  const applyPatchEnabled =
    applyPatchConfig?.enabled !== false &&
    isApplyPatchAllowedForModel({
      modelProvider: options?.modelProvider,
      modelId: options?.modelId,
      allowModels: applyPatchConfig?.allowModels,
    });

  if (sandboxRoot && !sandboxFsBridge) {
    throw new Error("Sandbox filesystem bridge is unavailable.");
  }
  const imageSanitization = resolveImageSanitizationLimits(options?.config);
  options?.recordToolPrepStage?.("workspace-policy");

  const baseToolAssemblers: Array<{
    name: "read" | "ls" | "edit" | "write";
    build: () => AnyAgentTool;
  }> = [
    {
      name: "read",
      build: () => {
        if (sandboxRoot) {
          const sandboxed = createSandboxedReadTool({
            root: sandboxRoot,
            bridge: sandboxFsBridge!,
            modelContextWindowTokens: options?.modelContextWindowTokens,
            imageSanitization,
          });
          return workspaceOnly
            ? wrapToolWorkspaceRootGuardWithOptions(sandboxed, sandboxRoot, {
                additionalContainerMounts: readOnlySandboxReadMounts(sandbox),
                containerWorkdir: sandbox.containerWorkdir,
              })
            : sandboxed;
        }
        const wrapped = createOpenClawReadTool(createReadTool(codingRoot), {
          modelContextWindowTokens: options?.modelContextWindowTokens,
          imageSanitization,
        });
        return workspaceOnly
          ? wrapToolWorkspaceRootGuardWithOptions(wrapped, codingRoot, {
              additionalRoots: skillReadRoots,
            })
          : wrapped;
      },
    },
    {
      name: "ls",
      build: () => {
        if (sandboxRoot) {
          const sandboxed = createSandboxedLsTool({
            root: sandboxRoot,
            bridge: sandboxFsBridge!,
          });
          return workspaceOnly
            ? wrapToolWorkspaceRootGuardWithOptions(sandboxed, sandboxRoot, {
                additionalContainerMounts: readOnlySandboxReadMounts(sandbox),
                containerWorkdir: sandbox.containerWorkdir,
              })
            : sandboxed;
        }
        const tool = createLsTool(codingRoot) as unknown as AnyAgentTool;
        return workspaceOnly
          ? wrapToolWorkspaceRootGuardWithOptions(tool, codingRoot, {
              additionalRoots: skillReadRoots,
            })
          : tool;
      },
    },
    {
      name: "edit",
      build: () => {
        const wrapped = sandboxRoot
          ? createSandboxedEditTool({ root: sandboxRoot, bridge: sandboxFsBridge! })
          : createHostWorkspaceEditTool(codingRoot, { workspaceOnly });
        if (!workspaceOnly) {
          return wrapped;
        }
        return sandboxRoot
          ? wrapToolWorkspaceRootGuardWithOptions(wrapped, sandboxRoot, {
              containerWorkdir: sandbox.containerWorkdir,
            })
          : wrapToolWorkspaceRootGuard(wrapped, codingRoot);
      },
    },
    {
      name: "write",
      build: () => {
        const wrapped = sandboxRoot
          ? createSandboxedWriteTool({ root: sandboxRoot, bridge: sandboxFsBridge! })
          : createHostWorkspaceWriteTool(codingRoot, { workspaceOnly });
        if (!workspaceOnly) {
          return wrapped;
        }
        return sandboxRoot
          ? wrapToolWorkspaceRootGuardWithOptions(wrapped, sandboxRoot, {
              containerWorkdir: sandbox.containerWorkdir,
            })
          : wrapToolWorkspaceRootGuard(wrapped, codingRoot);
      },
    },
  ];
  const base = includeBaseCodingTools
    ? baseToolAssemblers
        .filter(
          ({ name }) => name === "read" || name === "ls" || !sandboxRoot || allowWorkspaceWrites,
        )
        .map(({ name, build }) => {
          const tool = build();
          if (name === "read") {
            return applyParseOnTouch(tool);
          }
          if (name === "edit" || name === "write") {
            return applyWriteKit(tool, name);
          }
          return tool;
        })
    : [];
  options?.recordToolPrepStage?.("base-coding-tools");

  // COMPASS: memory_query tool 閳?agent 閸欘垯瀵岄崝銊︾叀鐠囥垽鏆遍張鐔活唶韫?(閸?persist + COMPASS 闂傘劍甯?.
  // factory 鏉╂柨娲?null 閺冩儼鐑︽潻鍥ㄦ暈閸?(persist 閺堫亜绱戦崥顖涘灗 COMPASS disabled).
  const memoryQueryTool = createMemoryQueryTool({ config: options?.config });
  if (memoryQueryTool) {
    base.push(memoryQueryTool);
  }
  // COMPASS: memory self-edit tools (recall/update/forget/strengthen).
  // Same persist gate as memory_query; factory returns [] when disabled.
  base.push(...createMemorySelfEditTools({ config: options?.config }));
  // DCS Stage 5: register context_read / context_search / context_write when
  // attempt/compact supplied BlockStore (+ sink for write) and session id.
  const dcsContextTools = createDcsContextAgentTools({
    sessionId: options?.sessionId,
    runSessionKey: options?.runSessionKey,
    agentSessionKey: options?.sessionKey,
    workspaceRoot: codingRoot,
    blockStore: options?.dcsBlockStore,
    contextBlockSink: options?.dcsContextBlockSink,
    role: options?.dcsContextRole,
    factService: options?.factService,
    budgetChars: options?.dcsFactBudgetChars,
    // context-folding-rlm: flag resolves from the attempt config (default off).
    config: options?.config,
  });
  if (dcsContextTools.length > 0) {
    base.push(...dcsContextTools);
  }
  // C2-8: undo_write when journal enabled
  const undoWriteTool = createUndoWriteTool({
    workspaceRoot: codingRoot,
    sessionId: codingSessionId,
    enabled: writeJournalEnabled && includeBaseCodingTools,
    workspaceOnly,
  });
  if (undoWriteTool) {
    base.push(undoWriteTool);
  }
  const { cleanupMs: cleanupMsOverride, ...execDefaults } = options?.exec ?? {};
  const effectiveExecPolicy = applyExecPolicyLayer(execConfig, options?.exec);
  const execTool = includeShellTools
    ? createLazyExecTool({
        ...execDefaults,
        contentProvenance: options?.contentProvenance ?? execDefaults.contentProvenance,
        host: options?.exec?.host ?? execConfig.host,
        mode: effectiveExecPolicy.mode,
        security: effectiveExecPolicy.security,
        ask: effectiveExecPolicy.ask,
        config: options?.exec?.config ?? options?.config,
        reviewer: options?.exec?.reviewer ?? execConfig.reviewer,
        trigger: options?.trigger,
        node: options?.exec?.node ?? execConfig.node,
        pathPrepend: options?.exec?.pathPrepend ?? execConfig.pathPrepend,
        safeBins: options?.exec?.safeBins ?? execConfig.safeBins,
        strictInlineEval: options?.exec?.strictInlineEval ?? execConfig.strictInlineEval,
        commandHighlighting: options?.exec?.commandHighlighting ?? execConfig.commandHighlighting,
        safeBinTrustedDirs: options?.exec?.safeBinTrustedDirs ?? execConfig.safeBinTrustedDirs,
        safeBinProfiles: options?.exec?.safeBinProfiles ?? execConfig.safeBinProfiles,
        agentId,
        trace: effectiveTrace,
        cwd: codingRoot,
        allowBackground,
        scopeKey,
        sessionKey: options?.sessionKey,
        sessionId: options?.sessionId,
        sessionStore: options?.config?.session?.store,
        mainKey: options?.config?.session?.mainKey,
        sessionScope: options?.config?.session?.scope,
        eventRouting: resolveEventSessionRoutingPolicy({
          cfg: options?.config,
          sessionKey: options?.sessionKey,
          channel: options?.messageProvider,
          accountId: options?.agentAccountId,
        }),
        messageProvider: options?.messageProvider,
        currentChannelId: options?.currentChannelId,
        currentThreadTs: options?.currentThreadTs,
        accountId: options?.agentAccountId,
        backgroundMs: options?.exec?.backgroundMs ?? execConfig.backgroundMs,
        timeoutSec: options?.exec?.timeoutSec ?? execConfig.timeoutSec,
        approvalRunningNoticeMs:
          options?.exec?.approvalRunningNoticeMs ?? execConfig.approvalRunningNoticeMs,
        notifyOnExit: options?.exec?.notifyOnExit ?? execConfig.notifyOnExit,
        notifyOnExitEmptySuccess:
          options?.exec?.notifyOnExitEmptySuccess ?? execConfig.notifyOnExitEmptySuccess,
        onYield: options?.onYield,
        sandbox: sandbox
          ? {
              containerName: sandbox.containerName,
              workspaceDir: sandbox.workspaceDir,
              containerWorkdir: sandbox.containerWorkdir,
              env: sandbox.backend?.env ?? sandbox.docker.env,
              buildExecSpec: sandbox.backend?.buildExecSpec.bind(sandbox.backend),
              finalizeExec: sandbox.backend?.finalizeExec?.bind(sandbox.backend),
            }
          : undefined,
      })
    : null;
  const processTool = includeShellTools
    ? createLazyProcessTool({
        cleanupMs: cleanupMsOverride ?? execConfig.cleanupMs,
        scopeKey,
      })
    : null;
  const verseShellResultTool = includeShellTools
    ? createVerseShellResultTool({
        cwd: codingRoot,
        agentId,
        config: options?.config,
        trace: effectiveTrace,
      })
    : null;
  const verseShellReadonlyFacadeTools = includeShellTools
    ? createVerseShellReadonlyFacadeTools({
        cwd: codingRoot,
        agentId,
        revision: options?.workspaceRevision,
        config: options?.config,
        trace: effectiveTrace,
      })
    : null;
  // Preview only: it reports base hashes, preconditions and diffs. Committing,
  // undo and recovery stay with the apply_patch write journal below.
  const verseShellPatchPreviewTool = includeShellTools
    ? createVerseShellPatchPreviewTool({
        cwd: codingRoot,
        agentId,
        revision: options?.workspaceRevision,
        config: options?.config,
        trace: effectiveTrace,
      })
    : null;
  const applyPatchToolRaw =
    !includeShellTools || !applyPatchEnabled || (sandboxRoot && !allowWorkspaceWrites)
      ? null
      : createApplyPatchTool({
          cwd: codingRoot,
          sandbox:
            sandboxRoot && allowWorkspaceWrites
              ? { root: sandboxRoot, bridge: sandboxFsBridge! }
              : undefined,
          workspaceOnly: applyPatchWorkspaceOnly,
          journal: {
            workspaceRoot: codingRoot,
            sessionId: codingSessionId,
            enabled: writeJournalEnabled,
            flags: writeJournalFlags,
          },
        });
  const applyPatchTool = applyPatchToolRaw
    ? applyWriteKit(applyPatchToolRaw as unknown as AnyAgentTool, "apply_patch")
    : null;
  options?.recordToolPrepStage?.("shell-tools");
  const pluginToolAllowlist = collectExplicitAllowlist([
    profilePolicy,
    providerProfilePolicy,
    globalPolicy,
    globalProviderPolicy,
    agentPolicy,
    agentProviderPolicy,
    groupPolicy,
    senderPolicy,
    sandboxToolPolicy,
    subagentPolicy,
    inheritedToolPolicy,
    options?.runtimeToolAllowlist ? { allow: options.runtimeToolAllowlist } : undefined,
  ]);
  const pluginToolDenylist = collectExplicitDenylist([
    profilePolicy,
    providerProfilePolicy,
    globalPolicy,
    globalProviderPolicy,
    agentPolicy,
    agentProviderPolicy,
    groupPolicy,
    senderPolicy,
    sandboxToolPolicy,
    subagentPolicy,
    inheritedToolPolicy,
  ]);
  const inheritedToolDenylist = [...pluginToolDenylist];
  // Passed by reference to sessions_spawn and populated after the final policy
  // pass so child sessions inherit the actual parent tool surface.
  const inheritedToolAllowlist: string[] = [];
  const shouldInheritEffectiveToolAllowlist = [
    profilePolicy,
    providerProfilePolicy,
    globalPolicy,
    globalProviderPolicy,
    agentPolicy,
    agentProviderPolicy,
    groupPolicy,
    senderPolicy,
    sandboxToolPolicy,
    subagentPolicy,
    inheritedToolPolicy,
    options?.runtimeToolAllowlist ? { allow: options.runtimeToolAllowlist } : undefined,
  ].some(hasRestrictiveAllowPolicy);
  const pluginToolsOnly =
    includeOpenClawTools || !includePluginTools
      ? []
      : resolveOpenClawPluginToolsForOptions({
          options: {
            agentSessionKey: options?.sessionKey,
            agentChannel: resolveGatewayMessageChannel(options?.messageProvider),
            agentAccountId: options?.agentAccountId,
            agentTo: options?.messageTo,
            agentThreadId: options?.messageThreadId,
            agentDir: options?.agentDir,
            workspaceDir: workspaceRoot,
            config: options?.config,
            fsPolicy,
            requesterSenderId: options?.senderId,
            sessionId: options?.sessionId,
            sandboxBrowserBridgeUrl: sandbox?.browser?.bridgeUrl,
            allowHostBrowserControl: sandbox ? sandbox.browserAllowHostControl : true,
            sandboxed: Boolean(sandbox),
            pluginToolAllowlist,
            pluginToolDenylist,
            currentChannelId: options?.currentChannelId,
            currentThreadTs: options?.currentThreadTs,
            currentMessageId: options?.currentMessageId,
            modelProvider: options?.modelProvider,
            modelId: options?.modelId,
            modelHasVision: options?.modelHasVision,
            requireExplicitMessageTarget: options?.requireExplicitMessageTarget,
            disableMessageTool: options?.disableMessageTool,
            requesterAgentIdOverride: agentId,
            allowGatewaySubagentBinding: options?.allowGatewaySubagentBinding,
            authProfileStore: options?.authProfileStore,
          },
          resolvedConfig: options?.config,
        });
  const toolSearchTools = toolSearchControlsEnabled
    ? createToolSearchTools({
        config: options?.config,
        runtimeConfig: options?.config,
        agentId,
        sessionKey: options?.sessionKey,
        sessionId: options?.sessionId,
        runId: options?.runId,
        catalogRef: options?.toolSearchCatalogRef,
        abortSignal: options?.abortSignal,
        executeTool: options?.toolSearchCatalogExecutor,
      })
    : [];
  const tools: AnyAgentTool[] = [
    ...base,
    ...(options?.sessionKey && options?.sessionId && !sandbox ? [createPersistentTaskTool({ workspace: workspaceRoot,sessionKey:options.sessionKey,generation:options.sessionId })] : []),
    ...(includeShellTools && applyPatchTool ? [applyPatchTool as unknown as AnyAgentTool] : []),
    ...(execTool ? [execTool as unknown as AnyAgentTool] : []),
    ...(processTool ? [processTool as unknown as AnyAgentTool] : []),
    ...(verseShellResultTool ? [verseShellResultTool] : []),
    ...(verseShellReadonlyFacadeTools ?? []),
    ...(verseShellPatchPreviewTool ? [verseShellPatchPreviewTool] : []),
    // Channel docking: include channel-defined agent tools (login, etc.).
    ...(includeChannelTools ? listChannelAgentTools({ cfg: options?.config }) : []),
    ...(includeOpenClawTools
      ? createOpenClawTools({
          contentProvenanceContext,
          sandboxBrowserBridgeUrl: sandbox?.browser?.bridgeUrl,
          allowHostBrowserControl: sandbox ? sandbox.browserAllowHostControl : true,
          agentSessionKey: options?.sessionKey,
          runId: options?.runId,
          runSessionKey: options?.runSessionKey,
          agentChannel: resolveGatewayMessageChannel(options?.messageProvider),
          agentAccountId: options?.agentAccountId,
          agentTo: options?.messageTo,
          agentThreadId: options?.messageThreadId,
          agentGroupId: options?.groupId ?? null,
          agentGroupChannel: options?.groupChannel ?? null,
          agentGroupSpace: options?.groupSpace ?? null,
          agentMemberRoleIds: options?.memberRoleIds,
          agentDir: options?.agentDir,
          sandboxRoot,
          sandboxContainerWorkdir: sandbox?.containerWorkdir,
          sandboxFsBridge,
          fsPolicy,
          workspaceDir: workspaceRoot,
          spawnWorkspaceDir: options?.spawnWorkspaceDir
            ? resolveWorkspaceRoot(options.spawnWorkspaceDir)
            : undefined,
          sandboxed: Boolean(sandbox),
          config: options?.config,
          pluginToolAllowlist,
          pluginToolDenylist,
          currentChannelId: options?.currentChannelId,
          currentThreadTs: options?.currentThreadTs,
          currentMessageId: options?.currentMessageId,
          currentInboundAudio: options?.currentInboundAudio,
          modelProvider: options?.modelProvider,
          modelId: options?.modelId,
          replyToMode: options?.replyToMode,
          hasRepliedRef: options?.hasRepliedRef,
          modelHasVision: options?.modelHasVision,
          requireExplicitMessageTarget: options?.requireExplicitMessageTarget,
          sourceReplyDeliveryMode: options?.sourceReplyDeliveryMode,
          inboundEventKind: options?.inboundEventKind,
          disableMessageTool: options?.disableMessageTool,
          enableHeartbeatTool,
          disablePluginTools: !includePluginTools,
          wrapBeforeToolCallHook: false,
          ...(cronSelfRemoveOnlyJobId ? { cronSelfRemoveOnlyJobId } : {}),
          requesterAgentIdOverride: agentId,
          requesterSenderId: options?.senderId,
          senderIsOwner: options?.senderIsOwner,
          authProfileStore: options?.authProfileStore,
          sessionId: options?.sessionId,
          inheritedToolAllowlist,
          inheritedToolDenylist,
          onYield: options?.onYield,
          onManualCompactionRequest: options?.onManualCompactionRequest,
          readCheckpointTranscript: options?.readCheckpointTranscript,
          allowGatewaySubagentBinding: options?.allowGatewaySubagentBinding,
          recordToolPrepStage: options?.recordToolPrepStage,
        })
      : pluginToolsOnly),
    ...toolSearchTools,
  ];
  options?.recordToolPrepStage?.("openclaw-tools");
  const toolsForMemoryFlush: AnyAgentTool[] = isMemoryFlushRun && memoryFlushWritePath ? [] : tools;
  if (isMemoryFlushRun && memoryFlushWritePath) {
    for (const tool of tools) {
      if (!MEMORY_FLUSH_ALLOWED_TOOL_NAMES.has(tool.name)) {
        continue;
      }
      if (tool.name === "write") {
        toolsForMemoryFlush.push(
          wrapToolMemoryFlushAppendOnlyWrite(tool, {
            root: memoryFlushWriteRoot,
            relativePath: memoryFlushWritePath,
            containerWorkdir: sandbox?.containerWorkdir,
            sandbox:
              sandboxRoot && sandboxFsBridge
                ? { root: sandboxRoot, bridge: sandboxFsBridge }
                : undefined,
          }),
        );
        continue;
      }
      toolsForMemoryFlush.push(tool);
    }
  }
  const unavailableCoreToolReason =
    isMemoryFlushRun && memoryFlushWritePath
      ? "memory-triggered compaction runs expose only read and append-only write"
      : undefined;
  const toolsForMessageProvider = filterToolsByMessageProvider(
    toolsForMemoryFlush,
    options?.messageProvider,
  );
  options?.recordToolPrepStage?.("message-provider-policy");
  const toolsForModelProvider = applyModelProviderToolPolicy(toolsForMessageProvider, {
    config: options?.config,
    modelProvider: options?.modelProvider,
    modelApi: options?.modelApi,
    modelId: options?.modelId,
    agentId: options?.agentId,
    sessionKey: options?.sessionKey,
    agentDir: options?.agentDir,
    modelCompat: options?.modelCompat,
    suppressManagedWebSearch: options?.suppressManagedWebSearch,
    runtimeToolAllowlist: options?.runtimeToolAllowlist,
    localModelLeanPreserveToolNames,
  });
  options?.recordToolPrepStage?.("model-provider-policy");
  // Sender identity is carried for command/channel-action auth; tool visibility
  // comes from configured tool policies, not per-turn sender ownership.
  const subagentFiltered = applyToolPolicyPipeline({
    tools: toolsForModelProvider,
    toolMeta: (tool) => getPluginToolMeta(tool),
    warn: logWarn,
    steps: [
      ...buildDefaultToolPolicyPipelineSteps({
        profilePolicy: profilePolicyWithAlsoAllow,
        profile,
        profileUnavailableCoreWarningAllowlist: profilePolicy?.allow,
        providerProfilePolicy: providerProfilePolicyWithAlsoAllow,
        providerProfile,
        providerProfileUnavailableCoreWarningAllowlist: providerProfilePolicy?.allow,
        globalPolicy: globalPolicyWithToolSearchControls,
        globalProviderPolicy: globalProviderPolicyWithToolSearchControls,
        agentPolicy: agentPolicyWithToolSearchControls,
        agentProviderPolicy: agentProviderPolicyWithToolSearchControls,
        groupPolicy: groupPolicyWithToolSearchControls,
        senderPolicy: senderPolicyWithToolSearchControls,
        agentId,
        unavailableCoreToolReason,
      }),
      {
        policy: sandboxToolPolicyWithToolSearchControls,
        label: "sandbox tools.allow",
        unavailableCoreToolReason,
      },
      {
        policy: subagentPolicyWithToolSearchControls,
        label: "subagent tools.allow",
        unavailableCoreToolReason,
      },
      { policy: inheritedToolPolicy, label: "inherited tools", unavailableCoreToolReason },
    ],
    auditLogLevel: options?.toolPolicyAuditLogLevel,
  });
  if (shouldInheritEffectiveToolAllowlist) {
    replaceWithEffectiveToolAllowlist(inheritedToolAllowlist, subagentFiltered);
  }
  options?.recordToolPrepStage?.("authorization-policy");
  // Always normalize tool JSON Schemas before handing them to OpenClaw model runtime.
  // Without this, some providers (notably OpenAI) will reject root-level union schemas.
  // Provider-specific cleaning: Gemini needs constraint keywords stripped, but Anthropic expects them.
  const normalized = subagentFiltered.map((tool) =>
    normalizeToolParameters(tool, {
      modelProvider: options?.modelProvider,
      modelId: options?.modelId,
      modelCompat: options?.modelCompat,
    }),
  );
  options?.recordToolPrepStage?.("schema-normalization");
  const withHooks = normalized.map((tool) =>
    wrapToolWithBeforeToolCallHook(
      options?.stage4ToolGuard
        ? wrapToolWithStage4ToolGuard(tool, options.stage4ToolGuard)
        : options?.stage1ToolGuard
          ? wrapToolWithStage1ToolGuard(tool, options.stage1ToolGuard)
          : tool,
      {
        agentId,
        ...(options?.config ? { config: options.config } : {}),
        cwd: codingRoot,
        workspaceDir: workspaceRoot,
        ...(options?.skillsSnapshot ? { skillsSnapshot: options.skillsSnapshot } : {}),
        ...(sandboxRoot && allowWorkspaceWrites
          ? { sandbox: { root: sandboxRoot, bridge: sandboxFsBridge! } }
          : {}),
        sessionKey: options?.sessionKey,
        sessionId: options?.sessionId,
        runId: options?.runId,
        channelId: options?.hookChannelId ?? options?.currentChannelId,
        trace: effectiveTrace,
        loopDetection: resolveToolLoopDetectionConfig({ cfg: options?.config, agentId }),
        onToolOutcome: options?.onToolOutcome,
        onToolLoopTermination: options?.onToolLoopTermination,
      },
      { emitDiagnostics: options?.emitBeforeToolCallDiagnostics },
    ),
  );
  options?.recordToolPrepStage?.("tool-hooks");
  const withAbort = options?.abortSignal
    ? withHooks.map((tool) => wrapToolWithAbortSignal(tool, options.abortSignal))
    : withHooks;
  options?.recordToolPrepStage?.("abort-wrappers");
  const withDeferredFollowupDescriptions = applyDeferredFollowupToolDescriptions(withAbort, {
    agentId,
  });
  autoVerifyExecToolRef.current = withDeferredFollowupDescriptions.find(
    (tool) => tool.name === "exec",
  );
  options?.recordToolPrepStage?.("deferred-followup-descriptions");

  // NOTE: Keep canonical (lowercase) tool names here.
  // shared model runtime's Anthropic OAuth transport remaps tool names to Claude Code-style names
  // on the wire and maps them back for tool dispatch.
  return withDeferredFollowupDescriptions;
}
export { testing as __testing };
