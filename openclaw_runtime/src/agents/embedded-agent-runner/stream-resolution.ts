/**
 * Resolves provider stream functions and API keys for embedded agents.
 */
import { getApiProvider } from "../../llm/api-registry.js";
import { streamSimple } from "../../llm/stream.js";
import { createAnthropicVertexStreamFnForModel } from "../anthropic-vertex-stream.js";
import { createBoundaryAwareStreamFnForModel } from "../provider-transport-stream.js";
import {
  attachShadowReceiptOptions,
  beginShadowModelCall,
  recordShadowCensusFailure,
  resolveRc03WireCorrelationDigest,
} from "../shadow-census.js";
import {
  getRc03SealCorrelationDigest,
  getRc03SealPlan,
  assertRc03SealedSystemPrompt,
  clearRc03SealPlan,
  nextRc03ModelCallIndex,
  recordRc03ModelCallStarted,
  resolveCurrentRc03SealState,
  runRc03SealHook,
} from "../../context-engine/rc03-seal-hook.js";
import {
  recordModelCallCompleted,
  recordModelCallStart,
  type ModelCallObservation,
} from "../model-call-observations.js";
import { RC03_PRE_SEAL_PRODUCERS } from "../../context-engine/rc03-producers.js";
import { SealMutationError } from "../../context-engine/seal-registry.js";
import type { CompilePlan } from "../../context-engine/compile-plan.js";
import { SUMMARIZATION_SYSTEM_PROMPT } from "../../../packages/agent-core/src/harness/compaction/compaction.js";
import type { StreamFn } from "../runtime/index.js";
import { stripSystemPromptCacheBoundary } from "../system-prompt-cache-boundary.js";
import type { EmbeddedRunAttemptParams } from "./run/types.js";
import type { ProviderSpendRunContext } from '../provider-spend-budget.js';

let embeddedAgentBaseStreamFnCache = new WeakMap<object, StreamFn | undefined>();
let openClawNativeCodexResponsesStreamFnForTest: StreamFn | undefined;

type EmbeddedStreamOptions = Parameters<StreamFn>[2] & {
  authProfileId?: string;
  promptCacheKey?: string;
};

export function resolveEmbeddedAgentBaseStreamFn(params: {
  session: { agent: { streamFn?: StreamFn } };
}): StreamFn | undefined {
  const cached = embeddedAgentBaseStreamFnCache.get(params.session);
  if (cached !== undefined || embeddedAgentBaseStreamFnCache.has(params.session)) {
    return cached;
  }
  const baseStreamFn = params.session.agent.streamFn;
  embeddedAgentBaseStreamFnCache.set(params.session, baseStreamFn);
  return baseStreamFn;
}

export function resetEmbeddedAgentBaseStreamFnCacheForTest(): void {
  embeddedAgentBaseStreamFnCache = new WeakMap<object, StreamFn | undefined>();
}

function isDefaultOpenClawStreamFnForModel(
  model: EmbeddedRunAttemptParams["model"],
  streamFn: StreamFn | undefined,
): boolean {
  if (!streamFn || streamFn === streamSimple) {
    return true;
  }
  const api = typeof model.api === "string" ? model.api.trim() : "";
  if (!api) {
    return false;
  }
  const provider = getApiProvider(api as never);
  return streamFn === provider?.streamSimple || streamFn === provider?.stream;
}

function hasResolvedRuntimeApiKey(apiKey: string | undefined): boolean {
  return typeof apiKey === "string" && apiKey.trim().length > 0;
}

function isOpenAICodexResponsesModel(model: EmbeddedRunAttemptParams["model"]): boolean {
  return model.provider === "openai" && model.api === "openai-chatgpt-responses";
}

function resolveOpenClawNativeCodexResponsesStreamFn(params: {
  model: EmbeddedRunAttemptParams["model"];
  currentStreamFn: StreamFn | undefined;
}): StreamFn | undefined {
  if (!isOpenAICodexResponsesModel(params.model)) {
    return undefined;
  }
  if (!isDefaultOpenClawStreamFnForModel(params.model, params.currentStreamFn)) {
    return undefined;
  }
  return openClawNativeCodexResponsesStreamFnForTest ?? params.currentStreamFn ?? streamSimple;
}

export function describeEmbeddedAgentStreamStrategy(params: {
  currentStreamFn: StreamFn | undefined;
  providerStreamFn?: StreamFn;
  model: EmbeddedRunAttemptParams["model"];
  resolvedApiKey?: string;
}): string {
  if (params.providerStreamFn) {
    return "provider";
  }
  if (params.model.provider === "anthropic-vertex") {
    return "anthropic-vertex";
  }
  if (
    resolveOpenClawNativeCodexResponsesStreamFn({
      model: params.model,
      currentStreamFn: params.currentStreamFn,
    })
  ) {
    return "openclaw-native-codex-responses";
  }
  if (isDefaultOpenClawStreamFnForModel(params.model, params.currentStreamFn)) {
    return createBoundaryAwareStreamFnForModel(params.model)
      ? `boundary-aware:${params.model.api}`
      : "stream-simple";
  }
  if (
    hasResolvedRuntimeApiKey(params.resolvedApiKey) &&
    createBoundaryAwareStreamFnForModel(params.model)
  ) {
    return `boundary-aware:${params.model.api}`;
  }
  return "session-custom";
}

export async function resolveEmbeddedAgentApiKey(params: {
  provider: string;
  resolvedApiKey?: string;
  authStorage?: { getApiKey(provider: string): Promise<string | undefined> };
}): Promise<string | undefined> {
  const resolvedApiKey = params.resolvedApiKey?.trim();
  if (resolvedApiKey) {
    return resolvedApiKey;
  }
  return params.authStorage ? await params.authStorage.getApiKey(params.provider) : undefined;
}

type EmbeddedStreamResolutionParams = {
  cfg?: unknown;
  spend?: ProviderSpendRunContext;
  currentStreamFn: StreamFn | undefined;
  providerStreamFn?: StreamFn;
  sessionId: string;
  runId?: string;
  attemptIndex?: number;
  promptCacheKey?: string;
  signal?: AbortSignal;
  model: EmbeddedRunAttemptParams["model"];
  resolvedApiKey?: string;
  authProfileId?: string;
  authStorage?: { getApiKey(provider: string): Promise<string | undefined> };
};

export function resolveEmbeddedAgentStreamFn(params: EmbeddedStreamResolutionParams): StreamFn {
  const inner = resolveUnbudgetedEmbeddedAgentStreamFn(params);
  const spend = params.spend;
  if (!spend?.config || !Object.values(spend.config).some(limit => limit && (limit.maxTokens !== undefined || limit.maxCostUsd !== undefined))) return inner;
  const ownerSpend = structuredClone(spend);
  // Opt-in only: disabled budgets do not load SQLite or change transport behavior.
  let wrapped: Promise<StreamFn> | undefined;
  return (model, context, options) => {
    wrapped ??= import('../provider-spend-budget.js').then(({ wrapProviderSpendStream }) => wrapProviderSpendStream(inner, ownerSpend));
    return wrapped.then(stream => stream(model, context, options));
  };
}

function resolveUnbudgetedEmbeddedAgentStreamFn(params: EmbeddedStreamResolutionParams): StreamFn {
  if (params.providerStreamFn) {
    return wrapEmbeddedAgentStreamFn(params.providerStreamFn, {
      runSignal: params.signal,
      resolvedApiKey: params.resolvedApiKey,
      authProfileId: params.authProfileId,
      authStorage: params.authStorage,
      providerId: params.model.provider,
      sessionId: params.sessionId,
      runId: params.runId,
      cfg: params.cfg,
      attemptIndex: params.attemptIndex,
      promptCacheKey: params.promptCacheKey,
      transformContext: (context) =>
        context.systemPrompt
          ? {
              ...context,
              systemPrompt: stripSystemPromptCacheBoundary(context.systemPrompt),
            }
          : context,
    });
  }

  const currentStreamFn = params.currentStreamFn ?? streamSimple;
  if (params.model.provider === "anthropic-vertex") {
    return wrapEmbeddedAgentStreamFn(createAnthropicVertexStreamFnForModel(params.model), {
      runSignal: params.signal,
      resolvedApiKey: params.resolvedApiKey,
      authProfileId: params.authProfileId,
      authStorage: params.authStorage,
      providerId: params.model.provider,
      sessionId: params.sessionId,
      runId: params.runId,
      cfg: params.cfg,
      attemptIndex: params.attemptIndex,
      promptCacheKey: params.promptCacheKey,
    });
  }

  const openClawNativeCodexResponsesStreamFn = resolveOpenClawNativeCodexResponsesStreamFn({
    model: params.model,
    currentStreamFn: params.currentStreamFn,
  });
  if (openClawNativeCodexResponsesStreamFn) {
    return wrapEmbeddedAgentStreamFn(openClawNativeCodexResponsesStreamFn, {
      runSignal: params.signal,
      resolvedApiKey: params.resolvedApiKey,
      authProfileId: params.authProfileId,
      authStorage: params.authStorage,
      providerId: params.model.provider,
      sessionId: params.sessionId,
      runId: params.runId,
      cfg: params.cfg,
      attemptIndex: params.attemptIndex,
      promptCacheKey: params.promptCacheKey,
      transformContext: (context) =>
        context.systemPrompt
          ? {
              ...context,
              systemPrompt: stripSystemPromptCacheBoundary(context.systemPrompt),
            }
          : context,
    });
  }

  if (
    isDefaultOpenClawStreamFnForModel(params.model, params.currentStreamFn) ||
    hasResolvedRuntimeApiKey(params.resolvedApiKey)
  ) {
    const boundaryAwareStreamFn = createBoundaryAwareStreamFnForModel(params.model);
    if (boundaryAwareStreamFn) {
      // Some OpenClaw session factories return a provider-specific stream wrapper
      // once runtime auth is resolved. Keep transport-supported APIs on
      // OpenClaw's HTTP transport so provider-specific auth/header semantics
      // are not lost behind that wrapper.
      // Boundary-aware transports read credentials from options.apiKey just
      // like provider-owned streams, but the embedded run layer never gets to
      // inject the resolved runtime key for them. Without this wrap, OAuth
      // providers (e.g. openai/gpt-5.5 over ChatGPT OAuth) hit the Responses API with an
      // empty bearer and fail with 401 Missing bearer auth header.
      return wrapEmbeddedAgentStreamFn(boundaryAwareStreamFn, {
        runSignal: params.signal,
        resolvedApiKey: params.resolvedApiKey,
        authProfileId: params.authProfileId,
        authStorage: params.authStorage,
        providerId: params.model.provider,
        sessionId: params.sessionId,
        runId: params.runId,
        cfg: params.cfg,
        attemptIndex: params.attemptIndex,
        promptCacheKey: params.promptCacheKey,
      });
    }
  }

  return wrapEmbeddedAgentStreamFn(currentStreamFn, {
    runSignal: params.signal,
    resolvedApiKey: undefined,
    authProfileId: undefined,
    authStorage: undefined,
    providerId: params.model.provider,
    sessionId: params.sessionId,
    runId: params.runId,
    cfg: params.cfg,
    attemptIndex: params.attemptIndex,
    promptCacheKey: params.promptCacheKey,
  });
}

export const testing = {
  setOpenClawNativeCodexResponsesStreamFnForTest(streamFn: StreamFn | undefined): void {
    openClawNativeCodexResponsesStreamFnForTest = streamFn;
  },
  resetOpenClawNativeCodexResponsesStreamFnForTest(): void {
    openClawNativeCodexResponsesStreamFnForTest = undefined;
  },
};

/**
 * RC-03: a provider-bound call with no orchestrator-sealed plan. When the run
 * has RC-03 engaged (it already sealed a plan), a registered boundary producer
 * is sealed here before transport serialization; anything else is an unknown
 * semantic mutation and lands in the census. Observational: never changes bytes.
 */
function sealBoundaryModelCall(
  context: Parameters<StreamFn>[1],
  identity: {
    providerId: string;
    sessionKey?: string;
    runId?: string;
    attemptIndex?: number;
    modelCallIndex: number;
  },
): CompilePlan | undefined {
  if (context.systemPrompt !== SUMMARIZATION_SYSTEM_PROMPT) {
    recordShadowCensusFailure("context-write", "unsealed-model-call");
    throw new SealMutationError('provider-context', 'post-seal', 'unsealed-model-call');
  }
  const chars = context.systemPrompt.length + JSON.stringify(context.messages ?? []).length;
  return runRc03SealHook(
    { systemPromptAddition: context.systemPrompt, messages: [], lineage: [] },
    context.messages ?? [],
    {
      enabled: true,
      runId: identity.runId,
      sessionKey: identity.sessionKey,
      providerId: identity.providerId,
      attemptIndex: identity.attemptIndex,
      modelCallIndex: identity.modelCallIndex,
      boundaryProducer: { id: RC03_PRE_SEAL_PRODUCERS.compactionSummarizer, chars },
    },
  ).plan;
}

function wrapEmbeddedAgentStreamFn(
  inner: StreamFn,
  params: {
    cfg?: unknown;
    runSignal: AbortSignal | undefined;
    resolvedApiKey: string | undefined;
    authProfileId: string | undefined;
    authStorage: { getApiKey(provider: string): Promise<string | undefined> } | undefined;
    providerId: string;
    sessionId?: string;
    runId?: string;
    attemptIndex?: number;
    promptCacheKey?: string;
    transformContext?: (context: Parameters<StreamFn>[1]) => Parameters<StreamFn>[1];
  },
): StreamFn {
  let nextModelCallIndex = 0;
  const transformContext =
    params.transformContext ?? ((context: Parameters<StreamFn>[1]) => context);
  const mergeRunSignal = (options: Parameters<StreamFn>[2]) => {
    const embeddedOptions = options as EmbeddedStreamOptions | undefined;
    const signal = embeddedOptions?.signal ?? params.runSignal;
    let merged =
      params.sessionId && !embeddedOptions?.sessionId
        ? { ...embeddedOptions, sessionId: params.sessionId }
        : embeddedOptions;
    const promptCacheKey = params.promptCacheKey?.trim();
    if (promptCacheKey && !merged?.promptCacheKey) {
      merged = { ...merged, promptCacheKey };
    }
    if (params.authProfileId && !merged?.authProfileId) {
      merged = { ...merged, authProfileId: params.authProfileId };
    }
    return signal ? { ...merged, signal } : merged;
  };
  const withShadowContext = (
    model: Parameters<StreamFn>[0],
    context: Parameters<StreamFn>[1],
    options: Parameters<StreamFn>[2],
    transformedContext: Parameters<StreamFn>[1],
  ): {
    options: Parameters<StreamFn>[2];
    observation?: ModelCallObservation;
  } => {
    const optionRecord = options as Record<string, unknown> | undefined;
    const runId =
      typeof optionRecord?.runId === "string" ? optionRecord.runId : params.runId;
    const attemptIndex = typeof optionRecord?.attemptIndex === "number" ? optionRecord.attemptIndex : params.attemptIndex ?? 0;
    const sealState = resolveCurrentRc03SealState(params.cfg);
    if (sealState.killed || (sealState.configured && !sealState.enabled)) clearRc03SealPlan(runId);
    const latestPlan = getRc03SealPlan(runId, undefined, attemptIndex);
    const sealEnabled = !sealState.killed && (sealState.enabled || latestPlan !== undefined);
    const explicitIndex = typeof optionRecord?.modelCallIndex === "number" ? optionRecord.modelCallIndex : undefined;
    const summarizing = context.systemPrompt === SUMMARIZATION_SYSTEM_PROMPT;
    // Explicit identities are never silently renamed, including summary retries.
    const modelCallIndex = explicitIndex ?? (sealEnabled && summarizing
      ? nextRc03ModelCallIndex(runId, attemptIndex, nextModelCallIndex)
      : sealEnabled ? Math.max(nextModelCallIndex, latestPlan?.callIndex.modelCallIndex ?? 0) : nextModelCallIndex);
    const callContext = {
      providerId: model.provider,
      adapterId: model.api,
      modelId: model.id,
      sessionKey: typeof optionRecord?.sessionId === "string" ? optionRecord.sessionId : params.sessionId,
      runId,
      traceId: typeof optionRecord?.traceId === "string" ? optionRecord.traceId : undefined,
      attemptIndex,
      modelCallIndex,
      wireAttemptIndex: typeof optionRecord?.wireAttemptIndex === "number" ? optionRecord.wireAttemptIndex : undefined,
    };
    const existingPlan = sealEnabled ? getRc03SealPlan(runId, modelCallIndex, attemptIndex) : undefined;
    const shadowCall = beginShadowModelCall(context, callContext, options);
    if (!shadowCall.active && !sealEnabled) {
      nextModelCallIndex = Math.max(nextModelCallIndex, modelCallIndex + 1);
      recordRc03ModelCallStarted(runId, attemptIndex, modelCallIndex);
      return { options };
    }
    const plan =
      existingPlan ??
      (sealEnabled
        ? sealBoundaryModelCall(context, { ...callContext, runId, modelCallIndex })
        : undefined);
    if (plan) {
      try {
        assertRc03SealedSystemPrompt(runId, modelCallIndex, context.systemPrompt);
        // Validate the real result of the registered cache-boundary transform too.
        assertRc03SealedSystemPrompt(runId, modelCallIndex, transformedContext.systemPrompt);
      } catch (error) {
        recordShadowCensusFailure("context-write", "post-seal-semantic-mutation");
        throw error;
      }
    }
    // A refused invocation must not advance into an unsealed gap on retry.
    nextModelCallIndex = Math.max(nextModelCallIndex, modelCallIndex + 1);
    recordRc03ModelCallStarted(runId, attemptIndex, modelCallIndex);
    // R5-3: overwrite the wire-side correlation with the sealed
    // ContextReceipt's correlation digest (the bundle digest) so
    // WireReceipt/v1 and ContextReceipt/v1 join on the same value. A miss
    // keeps any caller-provided correlation; the emit boundary falls back to
    // the identity-derived digest as before.
    const contextReceiptCorrelation =
      getRc03SealCorrelationDigest(runId, modelCallIndex) ??
      (plan && shadowCall.active
        ? resolveRc03WireCorrelationDigest(shadowCall.options, plan)
        : undefined);
    const shadowOptions = plan && shadowCall.active
      ? {
          ...shadowCall.options,
          rc03Plan: plan,
          correlationDigest:
            contextReceiptCorrelation ?? shadowCall.options.correlationDigest,
        }
      : shadowCall.options;
    const observation: ModelCallObservation = {
      ...callContext,
      attemptIndex: callContext.attemptIndex ?? params.attemptIndex ?? 0,
      ...(contextReceiptCorrelation
        ? { correlationDigest: contextReceiptCorrelation }
        : shadowCall.options.correlationDigest
          ? { correlationDigest: shadowCall.options.correlationDigest }
          : {}),
    };
    if (params.sessionId) recordModelCallStart(params.sessionId, observation);
    return {
      options: shadowCall.active ? attachShadowReceiptOptions(options, shadowOptions) : options,
      observation,
    };
  };
  const observeModelCallResult = <T extends { result(): Promise<unknown> }>(
    result: T | Promise<T>,
    observation: ModelCallObservation | undefined,
  ): T | Promise<T> => {
    if (!observation || !params.sessionId) return result;
    const wrap = (stream: T): T => {
      if (typeof stream.result !== "function") return stream;
      void stream.result().then((message) => {
        if (message && typeof message === "object") {
          recordModelCallCompleted(params.sessionId!, observation, message);
        } else {
          recordModelCallCompleted(params.sessionId!, observation);
        }
      });
      return stream;
    };
    return result instanceof Promise ? result.then(wrap) : wrap(result);
  };
  if (!params.authStorage && !params.resolvedApiKey) {
    return (m, context, options) => {
      const merged = mergeRunSignal(options);
      const transformedContext = transformContext(context);
      const observed = withShadowContext(m, context, merged, transformedContext);
      return observeModelCallResult(
        inner(m, transformedContext, observed.options),
        observed.observation,
      );
    };
  }
  const { authStorage, providerId, resolvedApiKey } = params;
  return async (m, context, options) => {
    const apiKey = await resolveEmbeddedAgentApiKey({
      provider: providerId,
      resolvedApiKey,
      authStorage,
    });
    const transformedContext = transformContext(context);
    const observed = withShadowContext(m, context, mergeRunSignal(options), transformedContext);
    return observeModelCallResult(
      inner(m, transformedContext, {
        ...observed.options,
        apiKey: apiKey ?? options?.apiKey,
      }),
      observed.observation,
    );
  };
}
export { testing as __testing };
