/**
 * Builds extension factories available to embedded-agent runtime sessions.
 */
import { randomUUID } from "node:crypto";
import { log } from "./logger.js";
import { normalizeOptionalLowercaseString } from "@openclaw/normalization-core/string-coerce";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import {
  Assembler,
  contextBlockFlagNameForSourceSystem,
  type AssemblerLegacyInputs,
  type ContextBlockFeatureFlags,
} from "../../context-engine/assembler.js";
import {
  finalizeContextOrchestratorTurn,
  getContextOrchestratorCollection,
} from "../../context-engine/context-orchestrator.js";
import {
  collectContextCandidate,
  createContextCandidate,
  reopenContextCandidateCollection,
  type ContextCandidateProjection,
} from "../../context-engine/context-candidate.js";
import { type ResolvedChatKnowledgeRef } from "../../context-engine/chat-knowledge-intent.js";
import { packKnowledgeCandidates } from "../../context-engine/project-rag-packing.js";
import { listContextFinalSnapshots } from "../../context-engine/context-final-snapshot.js";
import { revalidateChatKnowledgeRefs } from "../../context-engine/chat-knowledge-source-adapters.js";
import { resolveKillSwitchConfig } from "../../context-engine/kill-switch-config-source.js";
import { isContextEnhancementKillSwitchEngaged } from "../../context-engine/enhancement-kill-switch.js";
import { nextRc03ModelCallIndex } from "../../context-engine/rc03-seal-hook.js";
import { isWorkingMemoryRegatherEnabled } from "../../context-engine/working-memory-regather.js";
import { resolveInternalContextLadderPolicy } from "../../context-engine/context-ladder.js";
import type { TurnInjectionChannel } from "../../context-engine/turn-injection-budget.js";
import { dcsObservability } from "../../context-engine/dcs-observability.js";
import type { BlockStoreApi, ContextBlock, ContextBlockSink } from "../../context-engine/block.js";
import { BlockStore } from "../../context-engine/block-store.js";
import { handleWorkingMemoryAction } from "../../context-engine/handlers/working-memory-handler.js";
import {
  handleBeforeAgentStartToolRegistry,
  type ToolRegistryEntry,
} from "../../context-engine/handlers/tool-registry-handler.js";
import {
  restoreChildState,
  buildChildHandoffFromParent,
  writeChildHandoffPack,
  CHILD_CONTEXT_READ_INSTRUCTION,
} from "../../context-engine/handlers/task-loop-handler.js";
import { createWorkspaceFactStoreBridge } from "../../context-engine/views/factstore-bridge.js";
import { resolveCompassConfig } from "../../runtime-core/memory-pre-reply-injection.js";
import type { RuntimeMemoryQueryableFact } from "../../runtime-core/memory-context.js";
import type { RuntimeLineage } from "../../runtime-core/lineage.js";
import { createRuntimeMemoryRuntimeIntegration } from "../../runtime-core/memory-runtime-integration.js";
import type { TrajectoryCapture } from "../../knowledge/sekb/trajectory-capture.js";
import type { SekbRunIdentity } from "../../knowledge/sekb/types.js";
import type { EmbeddedSekbRuntime, SekbInstallableAgent } from "./sekb-runtime.js";
import { installEmbeddedSekbHarnessHooks } from "./sekb-runtime.js";
import { isSubagentSessionKey } from "../../sessions/session-key-utils.js";
import { openOpenClawStateDatabase } from "../../state/openclaw-state-db.js";
import type { ProviderRuntimeModel } from "../../plugins/provider-runtime-model.types.js";
import {
  clearTaskStateHandlerConfig,
  getTaskStateHandlerConfig,
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
import { deriveVerseGitToolObservationRequest } from "../harness/versegit-tool-observation.js";
import { enrichToolResultWithVerseGitFeedback } from "../harness/versegit-feedback-delivery.js";
import { getVerseGitRuntimeBindingForRun } from "../../plugin-sdk/versegit-binding-registry.js";
import { createVerseGitRuntimeObservationPortFromEnv } from "../../plugin-sdk/versegit-observation-port.js";
import type { AgentMessage, AgentToolResult } from "../runtime/index.js";
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

function buildAgentToolResultMiddlewareFactory(params: { runId?: string }): ExtensionFactory {
  const runner = createAgentToolResultMiddlewareRunner({ runtime: "openclaw" });
  const observationPort = createVerseGitRuntimeObservationPortFromEnv();
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
      let deliveredResult = result;
      if (observationPort && params.runId) {
        const binding = getVerseGitRuntimeBindingForRun(params.runId);
        if (binding) {
          try {
            const request = deriveVerseGitToolObservationRequest({
              event: {
                threadId: event.threadId,
                turnId: event.turnId,
                toolCallId,
                toolName: event.toolName,
                args: recordFromUnknown(event.input),
                cwd: ctx.cwd,
                isError,
                result,
              },
              binding,
              cwd: ctx.cwd ?? binding.worktreePath,
            });
            const delivery = await enrichToolResultWithVerseGitFeedback({
              result,
              observe: () => observationPort.observe(request),
              reportDelivery: (feedback) =>
                observationPort.reportDelivery({
                  bindingId: binding.bindingId,
                  childRunId: params.runId!,
                  toolCallId,
                  evidenceId: feedback.evidenceId,
                  level: "host-delivered",
                  observedAt: new Date().toISOString(),
                }),
            });
            deliveredResult = delivery.result;
            if (delivery.error) {
              log.warn(
                `VerseGit feedback unavailable; original tool result retained: ${delivery.error}`,
              );
            }
          } catch (error) {
            log.warn(`VerseGit tool observation unavailable: ${String(error).slice(0, 240)}`);
          }
        }
      }
      return {
        content: deliveredResult.content,
        details: deliveredResult.details,
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

export function resolveContextBlockProjectionFlags(
  cfg: OpenClawConfig | undefined,
): ContextBlockFeatureFlags {
  return {
    [contextBlockFlagNameForSourceSystem("compass")]:
      cfg?.runtime?.contextBlock?.compass?.enabled === true,
    [contextBlockFlagNameForSourceSystem("role-memory")]:
      cfg?.runtime?.contextBlock?.["role-memory"]?.enabled === true,
    [contextBlockFlagNameForSourceSystem("working-memory")]: isWorkingMemoryEnabled(cfg),
    [contextBlockFlagNameForSourceSystem("cvk")]: isToolRegistryEnabled(cfg),
  };
}

function hasContextBlockProjection(flags: ContextBlockFeatureFlags): boolean {
  return Object.values(flags).some((enabled) => enabled === true);
}

export function isContextBlockProjectionEnabled(cfg: OpenClawConfig | undefined): boolean {
  return hasContextBlockProjection(resolveContextBlockProjectionFlags(cfg));
}

function readWorkingMemoryEnvelope(
  details: unknown,
): { result_summary: string; significance: "high" | "medium" | "low" } | undefined {
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

export type PrepareEmbeddedContext = (
  messages: AgentMessage[],
) => Promise<ContextCandidateProjection | undefined>;

function buildContextBlockFactory(params: {
  sessionId?: string;
  sessionKey?: string;
  workspaceId?: string;
  workspaceDir?: string;
  provider?: string;
  abortSignal?: AbortSignal;
  runId?: string;
  injectionTurnId?: string;
  attemptIndex?: number;
  projectionFlags: ContextBlockFeatureFlags;
  contextBlockSink?: ContextBlockSink;
  workingMemoryStore?: Pick<BlockStoreApi, "query" | "upsert">;
  /** Model context window used only to size C6 internal Block allowance. */
  contextWindowTokens?: number;
  /** Real source-runtime config: the RC-03 seal switch resolves from it. */
  cfg?: OpenClawConfig | undefined;
  /** KS-04: DCS-admitted typed knowledge refs for this model call. */
  chatKnowledgeRefs?: ResolvedChatKnowledgeRef[];
  objective?: string;
  prepareToolRegistry?: () => Promise<void>;
  registerContextPreparation?: (prepare: PrepareEmbeddedContext) => void;
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
  let projectionObservabilityRecorded = false;

  function buildKnowledgeInputs<TExistingOutput>(
    messages: TExistingOutput,
  ): AssemblerLegacyInputs<TExistingOutput> {
    const inputs: AssemblerLegacyInputs<TExistingOutput> = {
      existing_output: messages,
    };
    if (params.projectionFlags[contextBlockFlagNameForSourceSystem("compass")]) {
      const compassConfig = resolveCompassConfig(params.cfg);
      const compassFacts =
        compassConfig.featureFlags.enablePreReplyRetrieval &&
        params.cfg?.runtime?.memory?.persist === true
          ? (() => {
              try {
                const frozenFacts = createRuntimeMemoryRuntimeIntegration({ config: params.cfg })
                  .loadStore()
                  .store.queryFacts({ limit: 24 });
                // The memory store intentionally returns deep-frozen snapshots.
                // buildPreReplyInjection only reads them, so clone into mutable
                // plain objects for the legacy assembler input contract.
                return frozenFacts.map((fact) =>
                  structuredClone(fact),
                ) as RuntimeMemoryQueryableFact[];
              } catch {
                return undefined;
              }
            })()
          : undefined;
      inputs.compass = {
        userInputText: params.objective?.trim() || "current task",
        config: compassConfig,
        ...(compassFacts ? { facts: compassFacts } : {}),
      };
    }
    if (
      params.projectionFlags[contextBlockFlagNameForSourceSystem("role-memory")] &&
      isSubagentSessionKey(params.sessionKey)
    ) {
      inputs.role_memory = {
        roleName: params.sessionKey?.split(":").at(-1) || "subagent",
        ...(params.objective?.trim() ? { taskState: params.objective.trim() } : {}),
      };
    }
    return inputs;
  }
  const contextLadder = hasContextBlockProjection(params.projectionFlags)
    ? resolveInternalContextLadderPolicy(params.contextWindowTokens ?? DEFAULT_CONTEXT_TOKENS)
    : undefined;
  // F-01: model-call identity inside the attempt. The first finalize (from
  // before_agent_start and the first context callback) seals modelCallIndex 0;
  // every later context callback — one per model call of the tool loop — opens
  // the next model-call collection and seals index N so provider payload,
  // ledger, lineage, and ContextReceipt stay aligned per model call.
  let modelCallIndex = 0;
  let sawFirstContextCall = false;
  // Channels whose content already entered this attempt's transcript through an
  // earlier projection. Later model calls must not collect them again —
  // except working_memory when the T-B6 regather gate is on: it produces new
  // Blocks as the tool loop runs, so it is re-queried and deduplicated by
  // dedupKey instead of channel-skipped (see the context callback below).
  const injectedChannels = new Set<TurnInjectionChannel>();
  // T-B6: dedupKeys of everything injected so far in this attempt
  // (contentDigest is part of the dedupKey). Later model calls receive this
  // set so re-collected working_memory content that did not change is
  // dispositioned "duplicate" instead of injected twice.
  const injectedDedupKeys = new Set<string>();
  const deniedKnowledgeRefs = new Set<string>();
  const projectedKnowledgeMessages = new Map<
    string,
    Array<{ content: string; timestamp: string | number }>
  >();
  const verifyKnowledgeRefs = async () => {
    const requested = (params.chatKnowledgeRefs ?? []).filter(
      (ref) => !deniedKnowledgeRefs.has(ref.refId),
    );
    let current: ResolvedChatKnowledgeRef[] = [];
    try {
      current = await revalidateChatKnowledgeRefs({
        refs: requested,
        cfg: params.cfg,
        internalRunId: params.runId,
        identity: {
          sessionId: params.sessionId,
          agentSessionKey: params.sessionKey,
          workspaceId: params.workspaceId,
          workspaceDir: params.workspaceDir,
          egressProviderRefs: params.provider ? [params.provider] : [],
        },
        signal: params.abortSignal,
      });
    } catch {
      /* The empty current set invalidates every requested source below. */
    }
    const ids = new Set(current.map((ref) => ref.refId));
    for (const ref of requested) if (!ids.has(ref.refId)) deniedKnowledgeRefs.add(ref.refId);
    return current;
  };
  const stripDeniedKnowledgeMessages = (messages: AgentMessage[]) =>
    messages.filter(
      (message) =>
        ![...deniedKnowledgeRefs].some((refId) =>
          projectedKnowledgeMessages
            .get(refId)
            ?.some(
              (projected) =>
                message.role === "user" &&
                message.content === projected.content &&
                message.timestamp === projected.timestamp,
            ),
        ),
    );
  // RC-03: the provider-bound system prompt as it leaves before_agent_start;
  // every sealed model call binds its digest.
  let sealedSystemPrompt: string | undefined;
  async function finalizeCandidates(
    messages: AgentMessage[],
    options: {
      skipChannels?: TurnInjectionChannel[];
      advanceModelCall?: boolean;
      /** F-01: seal only real model-call projections (default true). */
      seal?: boolean;
      /** T-B6: dedupKeys injected by earlier model calls (regather gate). */
      priorDedupKeys?: ReadonlySet<string>;
    } = {},
  ) {
    const turnId = params.injectionTurnId;
    if (!turnId) return undefined;
    await enqueue(async () => undefined);
    let currentKnowledgeRefs = await verifyKnowledgeRefs();
    messages = stripDeniedKnowledgeMessages(messages);
    let existingCollection = getContextOrchestratorCollection(turnId);
    if (existingCollection?.diagnostics.finalized && deniedKnowledgeRefs.size) {
      // Revocation discards the cached projection; the existing DCS budget still applies.
      reopenContextCandidateCollection(turnId);
      existingCollection = undefined;
    }
    if (options.advanceModelCall === true && existingCollection?.diagnostics.finalized) {
      // F-01: this is the next model call of the same attempt. The previous
      // model call's bundle stays frozen; open a fresh collection so Blocks
      // produced by tool results since the last call (working_memory) can
      // enter this call's projection.
      reopenContextCandidateCollection(turnId);
      modelCallIndex += 1;
      existingCollection = undefined;
    }
    if (!existingCollection?.diagnostics.finalized) {
      try {
        await params.prepareToolRegistry?.();
        // KS-04: inject DCS-admitted typed knowledge refs through the same
        // dcs-knowledge candidate channel used by the DCS Assembler. Denied refs
        // are not injected and were already reported to the renderer. Once the
        // knowledge channel was applied in an earlier model call of this attempt,
        // later calls skip it (same exactly-once rule as the assembler channels).
        const hasProjectionSource = hasContextBlockProjection(params.projectionFlags);
        const store = hasProjectionSource ? getBlockStore() : undefined;
        // DCS Stage 4: pass the production contextBlockSink so compass/role-memory
        // knowledge Block writes are real when inputs are supplied (v3 task 3).
        const assembler = new Assembler(
          store || params.contextBlockSink
            ? {
                ...(store ? { workingMemoryStore: store } : {}),
                ...(params.contextBlockSink ? { contextBlockSink: params.contextBlockSink } : {}),
              }
            : {},
        );
        await assembler.assemble(
          {
            session_id: sessionId ?? "",
            turnId,
            deferProjection: true,
            ...(contextLadder ? { contextLadder } : {}),
            ...(options.skipChannels && options.skipChannels.length > 0
              ? { skipChannels: options.skipChannels }
              : {}),
          },
          buildKnowledgeInputs(messages),
          params.projectionFlags,
        );
        // Owner reads run after asynchronous preparation and immediately before projection.
        currentKnowledgeRefs = await verifyKnowledgeRefs();
        if (!options.skipChannels?.includes("knowledge")) {
          for (const input of packKnowledgeCandidates(currentKnowledgeRefs)) {
            collectContextCandidate(turnId, createContextCandidate(input));
          }
        }
      } catch (error) {
        // Optional source reads were isolated by ExtensionRunner before eager
        // preparation. Keep that behavior while still arbitrating collected candidates.
        log.warn(`context source preparation failed: ${String(error)}`);
        for (const ref of params.chatKnowledgeRefs ?? []) deniedKnowledgeRefs.add(ref.refId);
      }
    }
    if (options.seal !== false) {
      modelCallIndex = nextRc03ModelCallIndex(
        params.runId,
        params.attemptIndex ?? 0,
        modelCallIndex,
      );
    }
    messages = stripDeniedKnowledgeMessages(messages);
    const finalized = finalizeContextOrchestratorTurn({
      turnId,
      messages,
      sessionKey: params.sessionKey,
      runId: params.runId,
      cfg: params.cfg,
      attemptIndex: params.attemptIndex,
      modelCallIndex,
      systemPrompt: sealedSystemPrompt,
      seal: options.seal !== false,
      priorDedupKeys: options.priorDedupKeys,
      // FP-P2-06: a DCS-enabled attempt holds the DCS injection capacity in the
      // ledger before the projection charges the lower-precedence CVK addition.
      dcsProjectionEnabled: hasContextBlockProjection(params.projectionFlags),
    });
    for (const ref of currentKnowledgeRefs) {
      const prefix = `[Knowledge reference: ${ref.title} (${ref.lookup})]`;
      const projected = finalized.projection.messages.flatMap((message) =>
        message.role === "user" &&
        typeof message.content === "string" &&
        message.content.startsWith(prefix)
          ? [{ content: message.content, timestamp: message.timestamp }]
          : [],
      );
      if (projected.length) projectedKnowledgeMessages.set(ref.refId, projected);
    }
    // The projection that just sealed is the one that will enter the
    // transcript (or was already consumed for the system prompt); remember
    // which channels actually applied so the next model call skips them.
    for (const entry of finalized.projection.lineage) {
      if (entry.charsApplied > 0) {
        injectedChannels.add(entry.channel);
        injectedDedupKeys.add(entry.dedupKey);
      }
    }
    if (!projectionObservabilityRecorded) {
      projectionObservabilityRecorded = true;
      const dcsChars = finalized.projection.lineage
        .filter(
          (entry) =>
            entry.channel === "knowledge" ||
            entry.channel === "working_memory" ||
            entry.channel === "tool_registry",
        )
        .reduce((total, entry) => total + entry.charsApplied, 0);
      const cvkChars = finalized.projection.lineage
        .filter((entry) => entry.channel === "cvk_addition")
        .reduce((total, entry) => total + entry.charsApplied, 0);
      dcsObservability.recordDcsTransformContextInjection({ chars: dcsChars });
      dcsObservability.recordCvkSystemPromptAddition(cvkChars);
    }
    return finalized;
  }
  // The runner needs the same admitted projection for its overflow precheck,
  // after orphan repair but before prompt submission. Later events reuse it.
  params.registerContextPreparation?.(
    async (messages) => (await finalizeCandidates(messages, { seal: false }))?.projection,
  );
  return (agent) => {
    if (params.projectionFlags[contextBlockFlagNameForSourceSystem("working-memory")]) {
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
          const sink =
            params.contextBlockSink ??
            (store
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
    }

    if (params.injectionTurnId) {
      agent.on("before_agent_start", async (event: unknown) => {
        if (!sessionId) return undefined;
        // F-01: this pass only derives the system-prompt addition. Its empty
        // message list is never sent, so no ContextBundle is sealed for it.
        const finalized = await finalizeCandidates([], { seal: false });
        const addition = finalized?.projection.systemPromptAddition;
        const base = recordFromUnknown(event).systemPrompt;
        if (!addition) {
          sealedSystemPrompt = typeof base === "string" ? base : undefined;
          return undefined;
        }
        const systemPrompt =
          typeof base === "string" && base.length > 0 ? `${base}\n\n${addition}` : addition;
        sealedSystemPrompt = systemPrompt;
        return { systemPrompt };
      });
    }

    agent.on("context", async (event: unknown, ctx?: { getSystemPrompt?: () => string }) => {
      if (!sessionId) {
        return undefined;
      }
      const messages = (recordFromUnknown(event).messages ?? []) as unknown;
      if (!Array.isArray(messages)) {
        return undefined;
      }
      if (params.injectionTurnId) {
        // Continuations can skip before_agent_start; bind the live prompt for this call.
        const currentPrompt = ctx?.getSystemPrompt?.();
        if (typeof currentPrompt === "string") sealedSystemPrompt = currentPrompt;
        // F-01: the first context callback of the attempt reuses the projection
        // sealed at before_agent_start (modelCallIndex 0). Every later callback
        // is a new model call: skip channels already injected into the
        // transcript and collect only what the tool loop produced since the
        // last call, sealing modelCallIndex N.
        //
        // T-B6 (TF-0126): working_memory produces new Blocks as the tool loop
        // runs, so with the regather gate on it is NOT channel-skipped on
        // later calls — it is re-queried, and unchanged content is
        // deduplicated by dedupKey (contentDigest) via priorDedupKeys. Gate
        // off: legacy permanent skip, byte-identical behavior.
        const isFirstContextCall = !sawFirstContextCall;
        sawFirstContextCall = true;
        const regatherEnabled = isWorkingMemoryRegatherEnabled(
          resolveKillSwitchConfig(process.env),
          process.env,
        );
        const nextSkipChannels = [...injectedChannels].filter(
          (channel) => !(regatherEnabled && channel === "working_memory"),
        );
        const finalized = await finalizeCandidates(messages as AgentMessage[], {
          advanceModelCall: !isFirstContextCall,
          ...(!isFirstContextCall ? { skipChannels: nextSkipChannels } : {}),
          priorDedupKeys: regatherEnabled ? injectedDedupKeys : undefined,
        });
        return { messages: finalized?.messages ?? messages };
      }
      // Legacy callers without a turn id retain the direct Assembler path.
      await enqueue(async () => undefined);
      const store = getBlockStore();
      // DCS Stage 4: same production sink wiring as the F-01 path (v3 task 3).
      const assembler = new Assembler(
        store || params.contextBlockSink
          ? {
              ...(store ? { workingMemoryStore: store } : {}),
              ...(params.contextBlockSink ? { contextBlockSink: params.contextBlockSink } : {}),
            }
          : {},
      );
      // FP-P0-02: `cfg` is intentionally omitted, NOT forgotten. The factory only
      // holds a construction-time config snapshot, and a snapshot would pin the
      // config-form kill switch to whatever was true when the agent started.
      // Omitting it makes assemble() resolve config per-request through
      // `resolveAssembleKillSwitchConfig`, so a mid-session kill takes effect.
      const result = await assembler.assemble(
        {
          session_id: sessionId,
          ...(contextLadder ? { contextLadder } : {}),
        },
        buildKnowledgeInputs(messages),
        params.projectionFlags,
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
    wouldTrimShadow: settings.wouldTrimShadow === true,
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
  cfg?: OpenClawConfig;
  sessionKey?: string;
  sessionId?: string;
  contextBlockSink?: ContextBlockSink;
  toolEntries?: ToolRegistryEntry[];
}): { factory: ExtensionFactory; prepare: () => Promise<void> } | undefined {
  const sessionKey = params.sessionKey?.trim() || params.sessionId?.trim();
  // Omit when missing deps or empty tool list: empty array is a valid mapped
  // production tools result (e.g. tools disabled) and must not register a
  // no-op-looking factory that still fires before_agent_start.
  if (
    !sessionKey ||
    !params.contextBlockSink ||
    !params.toolEntries ||
    params.toolEntries.length === 0
  ) {
    return undefined;
  }
  const entries = params.toolEntries;
  const sink = params.contextBlockSink;
  let preparation: Promise<void> | undefined;
  const prepare = () =>
    (preparation ??= (async () => {
      if (isContextEnhancementKillSwitchEngaged(params.cfg)) return;
      try {
        await handleBeforeAgentStartToolRegistry({
          sessionId: sessionKey,
          entries,
          contextBlockSink: sink,
        });
      } catch {
        // Best-effort write; failure does not block agent start.
      }
    })());
  return {
    prepare,
    factory: (agent) => {
      agent.on("before_agent_start", prepare);
    },
  };
}

/**
 * DCS Stage 2: Build the task-state extension factory.
 *
 * Registers a `before_agent_start` handler that restores the child HandoffPack
 * from BlockStore for subagent sessions. Also registers a run-scoped task-state handler
 * config so that `runAgentHarnessTaskPhaseChangeHook` can produce system-managed
 * task_state Block writes and trigger terminal-phase SEKB trajectory capture.
 *
 * The factory returns undefined when no task-state wiring is applicable (no
 * sink and no store), so it does not register an empty extension.
 */
function buildTaskStateFactory(params: {
  runId?: string;
  lineage?: RuntimeLineage;
  sessionKey?: string;
  sessionId?: string;
  contextBlockSink?: ContextBlockSink;
  workingMemoryStore?: Pick<BlockStoreApi, "query" | "upsert">;
  trajectoryCapture?: TrajectoryCapture;
  sekbRuntime?: EmbeddedSekbRuntime;
  objective?: string;
  parentSessionId?: string;
  /** B-3 v2: workspace root used to enrich the child handoff entity snapshot. */
  workspaceDir?: string;
  /** B-3 v3: write-set coordinate forwarded into the child handoff. */
  writeSet?: string[];
}): ExtensionFactory | undefined {
  const sessionKey = params.sessionKey?.trim() || params.sessionId?.trim();
  const hasSink = Boolean(params.contextBlockSink);
  const hasStore = Boolean(params.workingMemoryStore);
  if (!hasSink && !hasStore) {
    // A failed/disabled DCS initialization must invalidate only this run's
    // prior registration; another embedded run may still be active.
    clearTaskStateHandlerConfig({ runId: params.runId, sessionId: sessionKey });
    return undefined;
  }

  // Register the run-scoped task-state handler config so that
  // runAgentHarnessTaskPhaseChangeHook can produce task_state Block writes
  // and trigger terminal-phase SEKB trajectory capture.
  setTaskStateHandlerConfig({
    ...(params.runId ? { runId: params.runId } : {}),
    ...(params.runId ? { ownerRunId: params.runId } : {}),
    ...(sessionKey ? { sessionId: sessionKey } : {}),
    ...(params.contextBlockSink ? { contextBlockSink: params.contextBlockSink } : {}),
    ...(params.workingMemoryStore ? { workingMemoryStore: params.workingMemoryStore } : {}),
    ...(params.trajectoryCapture ? { trajectoryCapture: params.trajectoryCapture } : {}),
    ...(params.objective ? { objective: params.objective } : {}),
    ...(params.parentSessionId ? { parentSessionId: params.parentSessionId } : {}),
    ...(params.lineage ? { lineage: params.lineage } : {}),
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
      // B-3 v2: enrich the child's entity snapshot from the FactStore symbols
      // and the SEKB distilled decisions when a workspace is known. Both are
      // best-effort — a bridge/store absence degrades to the derived snapshot.
      ...(params.workspaceDir
        ? {
            workspaceDir: params.workspaceDir,
            bridgeFactory: createWorkspaceFactStoreBridge(),
          }
        : {}),
      ...(params.sekbRuntime?.store ? { sekbStore: params.sekbRuntime.store } : {}),
      // B-3 v3: forward the spawned-worker write-set coordinate so the child
      // entity snapshot knows the files this worker is expected to touch.
      ...(params.writeSet?.length ? { writeSet: [...params.writeSet] } : {}),
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

/**
 * DCS Stage 5 / W4: install SEKB harness hooks when explicitly enabled.
 * Uses the same agent extension event bus (before_agent_start / tool_result /
 * agent_end) that other DCS factories use. Disabled by default.
 */
function buildSekbFactory(params: {
  chatKnowledgeRefs?: ResolvedChatKnowledgeRef[];
  injectionTurnId?: string;
  attemptIndex?: number;
  sekbRuntime?: EmbeddedSekbRuntime;
  cfg?: OpenClawConfig | undefined;
  lineage?: RuntimeLineage;
  runId?: string;
  sessionId?: string;
  sessionKey?: string;
  sekbAttribution?: Pick<SekbRunIdentity, "taskId" | "experimentId" | "arm" | "repeat">;
}): ExtensionFactory | undefined {
  // sekbRuntime is only supplied when resolveEmbeddedSekbRuntime saw enablement
  // (config and/or OPENCLAW_SEKB_ENABLED). Gate on the runtime object so env-only
  // enable still installs hooks without re-reading cfg alone.
  if (!params.sekbRuntime) {
    return undefined;
  }
  const runtime = params.sekbRuntime;
  return (agent) => {
    const lineage = params.lineage
      ? params.lineage
      : () =>
          getTaskStateHandlerConfig({
            runId: params.runId,
            sessionId: params.sessionKey ?? params.sessionId,
          })?.lineage;
    installEmbeddedSekbHarnessHooks(
      agent as unknown as SekbInstallableAgent,
      runtime,
      lineage,
      {
        runId: params.runId ?? null,
        sessionId: params.sessionId ?? null,
        sessionKey: params.sessionKey ?? null,
        taskId: params.sekbAttribution?.taskId ?? null,
        experimentId: params.sekbAttribution?.experimentId ?? null,
        arm: params.sekbAttribution?.arm ?? null,
        repeat: params.sekbAttribution?.repeat ?? null,
      },
      params.chatKnowledgeRefs !== undefined
        ? () =>
            listContextFinalSnapshots(params.runId)
              .filter(
                (snapshot) =>
                  snapshot.turnId === params.injectionTurnId &&
                  snapshot.attemptIndex === (params.attemptIndex ?? 0),
              )
              .flatMap(
                (snapshot) =>
                  snapshot.budget.retainedEvidence?.units.flatMap((unit) =>
                    unit.citations.map((citation) => citation.sourceRef),
                  ) ?? [],
              )
        : undefined,
    );
  };
}

export function buildEmbeddedExtensionFactories(params: {
  cfg: OpenClawConfig | undefined;
  sessionManager: SessionManager;
  workspaceDir?: string;
  workspaceId?: string;
  abortSignal?: AbortSignal;
  provider: string;
  modelId: string;
  model: ProviderRuntimeModel | undefined;
  sessionId?: string;
  sessionKey?: string;
  runId?: string;
  lineage?: RuntimeLineage;
  sekbAttribution?: Pick<SekbRunIdentity, "taskId" | "experimentId" | "arm" | "repeat">;
  injectionTurnId?: string;
  attemptIndex?: number;
  contextBlockSink?: ContextBlockSink;
  workingMemoryStore?: Pick<BlockStoreApi, "query" | "upsert">;
  trajectoryCapture?: TrajectoryCapture;
  sekbRuntime?: EmbeddedSekbRuntime;
  objective?: string;
  parentSessionId?: string;
  /** B-3 v3: write-set coordinate forwarded into the child handoff. */
  writeSet?: string[];
  toolEntries?: ToolRegistryEntry[];
  chatKnowledgeRefs?: ResolvedChatKnowledgeRef[];
  registerContextPreparation?: (prepare: PrepareEmbeddedContext) => void;
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
      promotionStage: compactionCfg?.promotionStage,
    });
    factories.push(compactionSafeguardExtension);
  }
  const projectionFlags = resolveContextBlockProjectionFlags(params.cfg);
  // DCS Stage 3: tool-registry Block producer on before_agent_start.
  const toolRegistry = isToolRegistryEnabled(params.cfg)
    ? buildToolRegistryFactory(params)
    : undefined;
  if (toolRegistry) {
    factories.push(toolRegistry.factory);
  }
  if (params.injectionTurnId || hasContextBlockProjection(projectionFlags)) {
    factories.push(
      buildContextBlockFactory({
        ...params,
        projectionFlags,
        contextWindowTokens: resolveContextWindowTokens(params),
        prepareToolRegistry: toolRegistry?.prepare,
      }),
    );
  }
  const pruningFactory = buildContextPruningFactory(params);
  if (pruningFactory) {
    factories.push(pruningFactory);
  }
  // DCS Stage 5 / W4: SEKB harness hooks when explicitly enabled.
  const sekbFactory = buildSekbFactory(params);
  if (sekbFactory) {
    factories.push(sekbFactory);
  }
  // DCS Stage 2: task-state adapter and child-session handoff wiring.
  const taskStateFactory = buildTaskStateFactory(params);
  if (taskStateFactory) {
    factories.push(taskStateFactory);
  }
  factories.push(buildAgentToolResultMiddlewareFactory({ runId: params.runId }));
  return factories;
}

export { ensureAgentCompactionReserveTokens };
