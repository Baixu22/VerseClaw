/**
 * Builds extension factories available to embedded-agent runtime sessions.
 */
import { randomUUID } from "node:crypto";
import { normalizeOptionalLowercaseString } from "@openclaw/normalization-core/string-coerce";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { Assembler, contextBlockFlagNameForSourceSystem } from "../../context-engine/assembler.js";
import type { BlockStoreApi, ContextBlock, ContextBlockSink } from "../../context-engine/block.js";
import { BlockStore } from "../../context-engine/block-store.js";
import { handleWorkingMemoryAction } from "../../context-engine/handlers/working-memory-handler.js";
import { handleBeforeAgentStartToolRegistry, type ToolRegistryEntry } from "../../context-engine/handlers/tool-registry-handler.js";
import { restoreChildState, buildChildHandoffFromParent, writeChildHandoffPack, CHILD_CONTEXT_READ_INSTRUCTION } from "../../context-engine/handlers/task-loop-handler.js";
import type { TrajectoryCapture } from "../../knowledge/sekb/trajectory-capture.js";
import { isSubagentSessionKey } from "../../sessions/session-key-utils.js";
import { openOpenClawStateDatabase } from "../../state/openclaw-state-db.js";
import type { ProviderRuntimeModel } from "../../plugins/provider-runtime-model.types.js";
import {
  setTaskStateHandlerConfig,
} from "../harness/lifecycle-hook-helpers.js";
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

function isToolRegistryEnabled(cfg: OpenClawConfig | undefined): boolean {
  return cfg?.runtime?.contextBlock?.["tool-registry"]?.enabled === true;
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
  // S1-B: same-attempt tool_result callbacks are serialized in callback-entry
  // order through this single promise chain. The existing session write lock
  // stays the sole cross-attempt exclusion owner; this queue never spans attempts.
  let queueTail: Promise<void> = Promise.resolve();
  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = queueTail.then(operation, operation);
    queueTail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
  // Merge baseline: initialized once from the persisted stable Block, then
  // advanced only after the matching sink result is accepted, so a rejected
  // write never poisons the next merge baseline.
  let baselineLoaded = false;
  let acceptedBaseline: ContextBlock | undefined;
  return (agent) => {
    agent.on("tool_result", (rawEvent: unknown) => {
      if (!sessionId) {
        return undefined;
      }
      const event = recordFromUnknown(rawEvent) as AgentToolResultEvent;
      const envelope = readWorkingMemoryEnvelope(event.details);
      if (!envelope || envelope.significance === "low") {
        return undefined;
      }
      const significance: "high" | "medium" = envelope.significance;
      return enqueue(async () => {
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
        if (!baselineLoaded) {
          baselineLoaded = true;
          const [persistedBlock] = store
            ? await store.query({
                requester_session_id: sessionId,
                session_id: sessionId,
                block_types: ["working_memory"],
                source_systems: ["working-memory"],
                limit: 1,
              })
            : [];
          acceptedBaseline = persistedBlock;
        }
        const block = handleWorkingMemoryAction({
          sessionId,
          existingBlock: acceptedBaseline,
          action: {
            tool: event.toolName ?? "tool",
            result_summary: envelope.result_summary,
            significance,
          },
        });
        const [writeResult] = await sink([
          {
            block,
            admission: { significance, write_origin: "handler" },
          },
        ]);
        if (writeResult?.accepted) {
          acceptedBaseline = block;
        }
        return undefined;
      });
    });

    agent.on("context", async (event: unknown) => {
      if (!sessionId) {
        return undefined;
      }
      const messages = (recordFromUnknown(event).messages ?? []) as unknown;
      if (!Array.isArray(messages)) {
        return undefined;
      }
      // S1-B: the pre-LLM projection waits for already queued synchronous
      // tool-result writes before querying BlockStore.
      await enqueue(async () => undefined);
      const store = getBlockStore();
      const assembler = new Assembler(store ? { workingMemoryStore: store } : {});
      const result = await assembler.assemble(
        { session_id: sessionId },
        { existing_output: messages },
        { [contextBlockFlagNameForSourceSystem("working-memory")]: true },
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

/**
 * DCS Stage 3: Build the tool-registry extension factory.
 *
 * Registers a `before_agent_start` handler that produces one system-managed
 * `tool_registry` Block through `ContextBlockSink` when the feature flag is on.
 * The Block carries `always_on=true`, `token_budget=200`, `priority=7`.
 *
 * The factory returns undefined when no sink is available or no session key
 * is provided, so it does not register an empty extension.
 *
 * The `toolEntries` are provided by the caller from the agent's tool list.
 * The existing CVK `ContextRuntimeKitContextEngine.assemble` path is unchanged;
 * this handler is a parallel, flag-gated producer.
 */
function buildToolRegistryFactory(params: {
  sessionKey?: string;
  sessionId?: string;
  contextBlockSink?: ContextBlockSink;
  toolEntries?: ToolRegistryEntry[];
}): ExtensionFactory | undefined {
  const sessionKey = params.sessionKey?.trim() || params.sessionId?.trim();
  if (!sessionKey || !params.contextBlockSink || !params.toolEntries) {
    return undefined;
  }
  const entries = params.toolEntries;
  const sink = params.contextBlockSink;
  return (agent) => {
    agent.on("before_agent_start", async () => {
      try {
        await handleBeforeAgentStartToolRegistry({
          sessionId: sessionKey,
          entries,
          contextBlockSink: sink,
        });
      } catch {
        // Best-effort write; failure does not block agent start.
      }
      return undefined;
    });
  };
}

/**
 * DCS Stage 2: Build the task-state extension factory.
 *
 * Registers a `before_agent_start` handler that restores the child HandoffPack
 * from BlockStore for subagent sessions. Also sets the global task-state handler
 * config so that `runAgentHarnessTaskPhaseChangeHook` can produce system-managed
 * task_state Block writes and trigger terminal-phase SEKB trajectory capture.
 *
 * The factory returns undefined when no task-state wiring is applicable (no
 * sink and no store), so it does not register an empty extension.
 */
function buildTaskStateFactory(params: {
  sessionKey?: string;
  sessionId?: string;
  contextBlockSink?: ContextBlockSink;
  workingMemoryStore?: Pick<BlockStoreApi, "query" | "upsert">;
  trajectoryCapture?: TrajectoryCapture;
  objective?: string;
  parentSessionId?: string;
}): ExtensionFactory | undefined {
  const sessionKey = params.sessionKey?.trim() || params.sessionId?.trim();
  const hasSink = Boolean(params.contextBlockSink);
  const hasStore = Boolean(params.workingMemoryStore);
  if (!hasSink && !hasStore) {
    return undefined;
  }

  // Set the global task-state handler config so that
  // runAgentHarnessTaskPhaseChangeHook can produce task_state Block writes
  // and trigger terminal-phase SEKB trajectory capture.
  setTaskStateHandlerConfig({
    ...(params.contextBlockSink ? { contextBlockSink: params.contextBlockSink } : {}),
    ...(params.workingMemoryStore ? { workingMemoryStore: params.workingMemoryStore } : {}),
    ...(params.trajectoryCapture ? { trajectoryCapture: params.trajectoryCapture } : {}),
    ...(params.objective ? { objective: params.objective } : {}),
    ...(params.parentSessionId ? { parentSessionId: params.parentSessionId } : {}),
  });

  // DCS Stage 2: Parent writes child HandoffPack before spawn.
  // When this is a subagent session with a sink, parentSessionId, and objective,
  // the parent writes the child-owned task_state Block to the child session key
  // before the child agent starts. The write is kicked off during factory
  // construction and awaited in before_agent_start to ensure ordering.
  const isChildSession = Boolean(sessionKey && isSubagentSessionKey(sessionKey));
  let handoffWritePromise: Promise<unknown> | undefined;
  if (
    isChildSession &&
    params.contextBlockSink &&
    params.parentSessionId &&
    params.objective &&
    params.workingMemoryStore
  ) {
    handoffWritePromise = buildChildHandoffFromParent({
      parentSessionKey: params.parentSessionId,
      objective: params.objective,
      currentPhase: "running",
      workingMemoryStore: params.workingMemoryStore,
    })
      .then((handoffPack) =>
        writeChildHandoffPack({
          childSessionKey: sessionKey!,
          handoffPack,
          contextBlockSink: params.contextBlockSink,
        }),
      )
      .catch(() => {
        // Best-effort write; failure does not block agent start.
      });
  }

  return (agent) => {
    // DCS Stage 2: child before_agent_start restoration.
    // Reads only the child session's current task_state Block and appends
    // the fixed context_read instruction to the system prompt.
    // Non-subagent (main) sessions skip restoration.
    agent.on("before_agent_start", async (event) => {
      if (!sessionKey || !isSubagentSessionKey(sessionKey)) {
        return undefined;
      }
      // Await the parent's handoff write before reading
      if (handoffWritePromise) {
        await handoffWritePromise;
      }
      if (params.workingMemoryStore) {
        try {
          await restoreChildState({
            childSessionKey: sessionKey,
            store: params.workingMemoryStore,
          });
        } catch {
          // Best-effort restoration; failure does not block agent start.
        }
      }
      // Append the fixed context_read instruction to the existing system prompt.
      // The instruction contains no HandoffPack JSON, Block ids, transcript
      // excerpt, or raw tool output.
      const existingPrompt = (event as { systemPrompt?: string }).systemPrompt ?? "";
      return { systemPrompt: `${existingPrompt}\n\n${CHILD_CONTEXT_READ_INSTRUCTION}` };
    });
  };
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
  trajectoryCapture?: TrajectoryCapture;
  objective?: string;
  parentSessionId?: string;
  toolEntries?: ToolRegistryEntry[];
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
  // DCS Stage 3: tool-registry Block producer on before_agent_start.
  if (isToolRegistryEnabled(params.cfg)) {
    const toolRegistryFactory = buildToolRegistryFactory(params);
    if (toolRegistryFactory) {
      factories.push(toolRegistryFactory);
    }
  }
  const pruningFactory = buildContextPruningFactory(params);
  if (pruningFactory) {
    factories.push(pruningFactory);
  }
  // DCS Stage 2: task-state adapter and child-session handoff wiring.
  const taskStateFactory = buildTaskStateFactory(params);
  if (taskStateFactory) {
    factories.push(taskStateFactory);
  }
  factories.push(buildAgentToolResultMiddlewareFactory());
  return factories;
}

export { ensureAgentCompactionReserveTokens };
