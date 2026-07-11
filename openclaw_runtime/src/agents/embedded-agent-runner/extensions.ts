/**
 * Builds extension factories available to embedded-agent runtime sessions.
 */
import { randomUUID } from "node:crypto";
import { normalizeOptionalLowercaseString } from "@openclaw/normalization-core/string-coerce";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { Assembler } from "../../context-engine/assembler.js";
import type { BlockStoreApi, ContextBlockSink } from "../../context-engine/block.js";
import { BlockStore } from "../../context-engine/block-store.js";
import { handleWorkingMemoryAction } from "../../context-engine/handlers/working-memory-handler.js";
import { openOpenClawStateDatabase } from "../../state/openclaw-state-db.js";
import type { ProviderRuntimeModel } from "../../plugins/provider-runtime-model.types.js";
import { setCompactionSafeguardRuntime } from "../agent-hooks/compaction-safeguard-runtime.js";
import compactionSafeguardExtension from "../agent-hooks/compaction-safeguard.js";
import contextPruningExtension from "../agent-hooks/context-pruning.js";
import { setContextPruningRuntime } from "../agent-hooks/context-pruning/runtime.js";
import { computeEffectiveSettings } from "../agent-hooks/context-pruning/settings.js";
import { makeToolPrunablePredicate } from "../agent-hooks/context-pruning/tools.js";
import {
  ensureAgentCompactionReserveTokens,
  resolveEffectiveCompactionMode,
} from "../agent-settings.js";
import { resolveContextWindowInfo } from "../context-window-guard.js";
import { DEFAULT_CONTEXT_TOKENS } from "../defaults.js";
import { createAgentToolResultMiddlewareRunner } from "../harness/tool-result-middleware.js";
import type { AgentToolResult } from "../runtime/index.js";
import type { ExtensionFactory, SessionManager } from "../sessions/index.js";
import { resolveTranscriptPolicy } from "../transcript-policy.js";
import { isCacheTtlEligibleProvider, readLastCacheTtlTimestamp } from "./cache-ttl.js";

type AgentToolResultEvent = {
  threadId?: string;
  turnId?: string;
  toolCallId?: string;
  toolName?: string;
  input?: unknown;
  content?: AgentToolResult<unknown>["content"];
  details?: unknown;
  isError?: boolean;
};

function recordFromUnknown(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

// Only checks "error" and "timeout" — the status values emitted by the
// adapter's buildToolExecutionErrorResult. The subscribe-side classifier
// (isErrorLikeStatus) uses a broader regex because it handles arbitrary
// external tool results; this bridge only elevates adapter-produced statuses.
function hasErrorToolResultStatus(result: AgentToolResult<unknown>): boolean {
  const details = recordFromUnknown(result.details);
  const status = normalizeOptionalLowercaseString(details.status);
  return status === "error" || status === "timeout";
}

function buildAgentToolResultMiddlewareFactory(): ExtensionFactory {
  const runner = createAgentToolResultMiddlewareRunner({ runtime: "openclaw" });
  return (agent) => {
    agent.on("tool_result", async (rawEvent: unknown, ctx: { cwd?: string }) => {
      const event = recordFromUnknown(rawEvent) as AgentToolResultEvent;
      if (!event.toolName) {
        return undefined;
      }
      const toolCallId =
        typeof event.toolCallId === "string" && event.toolCallId.trim()
          ? event.toolCallId
          : `openclaw-${randomUUID()}`;
      const content = Array.isArray(event.content) ? event.content : [];
      const current = {
        content,
        details: event.details,
      } satisfies AgentToolResult<unknown>;
      const inputHadErrorStatus = hasErrorToolResultStatus(current);
      const result = await runner.applyToolResultMiddleware({
        threadId: event.threadId,
        turnId: event.turnId,
        toolCallId,
        toolName: event.toolName,
        args: recordFromUnknown(event.input),
        cwd: ctx.cwd,
        isError: event.isError,
        result: current,
      });
      const isError =
        event.isError === true || inputHadErrorStatus || hasErrorToolResultStatus(result);
      return {
        content: result.content,
        details: result.details,
        ...(isError ? { isError: true } : {}),
      };
    });
  };
}


function isWorkingMemoryEnabled(cfg: OpenClawConfig | undefined): boolean {
  return cfg?.runtime?.contextBlock?.["working-memory"]?.enabled === true;
}

function readWorkingMemoryEnvelope(details: unknown):
  | { result_summary: string; significance: "high" | "medium" | "low" }
  | undefined {
  const detailsRecord = recordFromUnknown(details);
  const workingMemory = recordFromUnknown(detailsRecord.working_memory);
  const resultSummary = workingMemory.result_summary;
  const significance = workingMemory.significance;
  if (typeof resultSummary !== "string" || resultSummary.trim().length === 0) {
    return undefined;
  }
  if (significance !== "high" && significance !== "medium" && significance !== "low") {
    return undefined;
  }
  return {
    result_summary: resultSummary.trim().slice(0, 100),
    significance,
  };
}

function buildWorkingMemoryFactory(params: {
  sessionId?: string;
  sessionKey?: string;
  contextBlockSink?: ContextBlockSink;
  workingMemoryStore?: Pick<BlockStoreApi, "query" | "upsert">;
}): ExtensionFactory {
  const sessionId = params.sessionKey?.trim() || params.sessionId?.trim();
  let currentBlockStore: Pick<BlockStoreApi, "query" | "upsert"> | undefined =
    params.workingMemoryStore;
  function getBlockStore(): Pick<BlockStoreApi, "query" | "upsert"> | undefined {
    if (currentBlockStore) {
      return currentBlockStore;
    }
    currentBlockStore = new BlockStore(openOpenClawStateDatabase().db);
    return currentBlockStore;
  }
  return (agent) => {
    agent.on("tool_result", async (rawEvent: unknown) => {
      if (!sessionId) {
        return undefined;
      }
      const event = recordFromUnknown(rawEvent) as AgentToolResultEvent;
      const envelope = readWorkingMemoryEnvelope(event.details);
      if (!envelope || envelope.significance === "low") {
        return undefined;
      }
      const store = getBlockStore();
      const sink = params.contextBlockSink ?? (store
        ? async (writes: Parameters<ContextBlockSink>[0]) => {
            const results = [];
            for (const write of writes) {
              results.push(await store.upsert(write.block, write.admission));
            }
            return results;
          }
        : undefined);
      if (!sink) {
        return undefined;
      }
      const [existingBlock] = store
        ? await store.query({
            requester_session_id: sessionId,
            session_id: sessionId,
            block_types: ["working_memory"],
            source_systems: ["working-memory"],
            limit: 1,
          })
        : [];
      const block = handleWorkingMemoryAction({
        sessionId,
        existingBlock,
        action: {
          tool: event.toolName ?? "tool",
          result_summary: envelope.result_summary,
          significance: envelope.significance,
        },
      });
      await sink([
        {
          block,
          admission: { significance: envelope.significance, write_origin: "handler" },
        },
      ]);
      return undefined;
    });

    agent.on("context", async (event: unknown) => {
      if (!sessionId) {
        return undefined;
      }
      const messages = (recordFromUnknown(event).messages ?? []) as unknown;
      if (!Array.isArray(messages)) {
        return undefined;
      }
      const store = getBlockStore();
      const assembler = new Assembler(store ? { workingMemoryStore: store } : {});
      const result = await assembler.assemble(
        { session_id: sessionId },
        { existing_output: messages },
        { "runtime.contextBlock.working_memory.enabled": true },
      );
      return { messages: result.output };
    });
  };
}
function resolveContextWindowTokens(params: {
  cfg: OpenClawConfig | undefined;
  provider: string;
  modelId: string;
  model: ProviderRuntimeModel | undefined;
}): number {
  return resolveContextWindowInfo({
    cfg: params.cfg,
    provider: params.provider,
    modelId: params.modelId,
    modelContextTokens: params.model?.contextTokens,
    modelContextWindow: params.model?.contextWindow,
    defaultTokens: DEFAULT_CONTEXT_TOKENS,
  }).tokens;
}

function buildContextPruningFactory(params: {
  cfg: OpenClawConfig | undefined;
  sessionManager: SessionManager;
  provider: string;
  modelId: string;
  model: ProviderRuntimeModel | undefined;
}): ExtensionFactory | undefined {
  const raw = params.cfg?.agents?.defaults?.contextPruning;
  if (raw?.mode !== "cache-ttl") {
    return undefined;
  }
  if (!isCacheTtlEligibleProvider(params.provider, params.modelId, params.model?.api)) {
    return undefined;
  }

  const settings = computeEffectiveSettings(raw);
  if (!settings) {
    return undefined;
  }
  const transcriptPolicy = resolveTranscriptPolicy({
    modelApi: params.model?.api,
    provider: params.provider,
    modelId: params.modelId,
  });

  setContextPruningRuntime(params.sessionManager, {
    settings,
    contextWindowTokens: resolveContextWindowTokens(params),
    isToolPrunable: makeToolPrunablePredicate(settings.tools),
    dropThinkingBlocks: transcriptPolicy.dropThinkingBlocks,
    lastCacheTouchAt: readLastCacheTtlTimestamp(params.sessionManager, {
      provider: params.provider,
      modelId: params.modelId,
    }),
  });

  return contextPruningExtension;
}

export function buildEmbeddedExtensionFactories(params: {
  cfg: OpenClawConfig | undefined;
  sessionManager: SessionManager;
  workspaceDir?: string;
  provider: string;
  modelId: string;
  model: ProviderRuntimeModel | undefined;
  sessionId?: string;
  sessionKey?: string;
  contextBlockSink?: ContextBlockSink;
  workingMemoryStore?: Pick<BlockStoreApi, "query" | "upsert">;
}): ExtensionFactory[] {
  const factories: ExtensionFactory[] = [];
  if (resolveEffectiveCompactionMode(params.cfg) === "safeguard") {
    const compactionCfg = params.cfg?.agents?.defaults?.compaction;
    const qualityGuardCfg = compactionCfg?.qualityGuard;
    const contextWindowInfo = resolveContextWindowInfo({
      cfg: params.cfg,
      provider: params.provider,
      modelId: params.modelId,
      modelContextTokens: params.model?.contextTokens,
      modelContextWindow: params.model?.contextWindow,
      defaultTokens: DEFAULT_CONTEXT_TOKENS,
    });
    setCompactionSafeguardRuntime(params.sessionManager, {
      maxHistoryShare: compactionCfg?.maxHistoryShare,
      contextWindowTokens: contextWindowInfo.tokens,
      identifierPolicy: compactionCfg?.identifierPolicy,
      identifierInstructions: compactionCfg?.identifierInstructions,
      customInstructions: compactionCfg?.customInstructions,
      qualityGuardEnabled: qualityGuardCfg?.enabled ?? true,
      qualityGuardMaxRetries: qualityGuardCfg?.maxRetries,
      model: params.model,
      recentTurnsPreserve: compactionCfg?.recentTurnsPreserve,
      workspaceDir: params.workspaceDir,
      postCompactionSections: compactionCfg?.postCompactionSections,
      provider: compactionCfg?.provider,
    });
    factories.push(compactionSafeguardExtension);
  }
  if (isWorkingMemoryEnabled(params.cfg)) {
    factories.push(buildWorkingMemoryFactory(params));
  }
  const pruningFactory = buildContextPruningFactory(params);
  if (pruningFactory) {
    factories.push(pruningFactory);
  }
  factories.push(buildAgentToolResultMiddlewareFactory());
  return factories;
}

export { ensureAgentCompactionReserveTokens };
