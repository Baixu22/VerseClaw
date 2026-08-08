/**
 * Transport-aware stream factory selection.
 *
 * Routes models that need OpenClaw-managed proxy/TLS/local-service semantics onto built-in transport implementations.
 */
import type { OpenClawConfig } from "../config/types.openclaw.js";
import type { Api, Model } from "../llm/types.js";
import { resolveProviderStreamFn } from "../plugins/provider-runtime.js";
import { createAnthropicVertexStreamFnForModel } from "./anthropic-vertex-stream.js";
import { createAnthropicMessagesTransportStreamFn } from "./anthropic-transport-stream.js";
import {
  createAzureOpenAIResponsesTransportStreamFn,
  createOpenAICompletionsTransportStreamFn,
  createOpenAIResponsesTransportStreamFn,
} from "./openai-transport-stream.js";
import { getModelProviderLocalService } from "./provider-local-service.js";
import { getModelProviderRequestTransport } from "./provider-request-config.js";
import type { StreamFn } from "./runtime/index.js";

const SIMPLE_TRANSPORT_API_ALIAS: Record<string, Api> = {
  "openai-responses": "openclaw-openai-responses-transport",
  "openai-chatgpt-responses": "openclaw-openai-responses-transport",
  "openai-completions": "openclaw-openai-completions-transport",
  "azure-openai-responses": "openclaw-azure-openai-responses-transport",
  "anthropic-messages": "openclaw-anthropic-messages-transport",
  "google-generative-ai": "openclaw-google-generative-ai-transport",
};

type ProviderTransportStreamContext = {
  cfg?: OpenClawConfig;
  agentDir?: string;
  workspaceDir?: string;
  env?: NodeJS.ProcessEnv;
};

type SourceRuntimeTransportDescriptor = {
  id: string;
  api: Api;
  provider?: string;
  create: (model: Model, ctx?: ProviderTransportStreamContext) => StreamFn | undefined;
};

export type SourceRuntimeTransportMetadata = Pick<
  SourceRuntimeTransportDescriptor,
  "id" | "api" | "provider"
>;

function createProviderOwnedTransportStreamFn(
  model: Model,
  ctx?: ProviderTransportStreamContext,
  fallbackProvider?: string,
): StreamFn | undefined {
  return (
    resolveProviderStreamFn({
      provider: model.provider,
      config: ctx?.cfg,
      workspaceDir: ctx?.workspaceDir,
      env: ctx?.env,
      context: {
        config: ctx?.cfg,
        agentDir: ctx?.agentDir,
        workspaceDir: ctx?.workspaceDir,
        provider: model.provider,
        modelId: model.id,
        model,
      },
    }) ??
    (fallbackProvider
      ? resolveProviderStreamFn({
      provider: fallbackProvider,
      config: ctx?.cfg,
      workspaceDir: ctx?.workspaceDir,
      env: ctx?.env,
      context: {
        config: ctx?.cfg,
        agentDir: ctx?.agentDir,
        workspaceDir: ctx?.workspaceDir,
        provider: model.provider,
        modelId: model.id,
        model,
      },
    })
      : undefined) ??
    undefined
  );
}

const SOURCE_RUNTIME_TRANSPORTS: readonly SourceRuntimeTransportDescriptor[] = [
  { id: "openai-responses", api: "openai-responses", create: () => createOpenAIResponsesTransportStreamFn() },
  { id: "openai-chatgpt-responses", api: "openai-chatgpt-responses", create: () => createOpenAIResponsesTransportStreamFn() },
  { id: "openai-completions", api: "openai-completions", create: () => createOpenAICompletionsTransportStreamFn() },
  { id: "azure-openai-responses", api: "azure-openai-responses", create: () => createAzureOpenAIResponsesTransportStreamFn() },
  {
    id: "anthropic-vertex",
    api: "anthropic-messages",
    provider: "anthropic-vertex",
    create: (model, ctx) => createAnthropicVertexStreamFnForModel(model, ctx?.env),
  },
  { id: "anthropic-messages", api: "anthropic-messages", create: () => createAnthropicMessagesTransportStreamFn() },
  {
    id: "google-generative-ai",
    api: "google-generative-ai",
    create: (model, ctx) => createProviderOwnedTransportStreamFn(model, ctx, "google"),
  },
  {
    id: "google-vertex",
    api: "google-vertex",
    create: (model, ctx) => createProviderOwnedTransportStreamFn(model, ctx, "google"),
  },
  {
    id: "amazon-bedrock",
    api: "bedrock-converse-stream",
    provider: "amazon-bedrock",
    create: (model, ctx) => createProviderOwnedTransportStreamFn(model, ctx, "amazon-bedrock"),
  },
];

/** Lists the production source-runtime transport denominator used by RC-02 coverage. */
export function listSourceRuntimeTransportApis(): readonly Api[] {
  return [...new Set(SOURCE_RUNTIME_TRANSPORTS.map((descriptor) => descriptor.api))];
}

/** Lists provider-specific production adapters without exposing their factories. */
export function listSourceRuntimeTransportDescriptors(): readonly SourceRuntimeTransportMetadata[] {
  return SOURCE_RUNTIME_TRANSPORTS.map(({ id, api, provider }) => ({
    id,
    api,
    ...(provider ? { provider } : {}),
  }));
}

function createSupportedTransportStreamFn(
  model: Model,
  ctx?: ProviderTransportStreamContext,
): StreamFn | undefined {
  const descriptor =
    SOURCE_RUNTIME_TRANSPORTS.find(
      (candidate) => candidate.api === model.api && candidate.provider === model.provider,
    ) ??
    SOURCE_RUNTIME_TRANSPORTS.find(
      (candidate) => candidate.api === model.api && candidate.provider === undefined,
    );
  return descriptor?.create(model, ctx);
}

function hasOpenClawTransportRequirement(model: Model): boolean {
  const request = getModelProviderRequestTransport(model);
  return Boolean(request?.proxy || request?.tls || getModelProviderLocalService(model));
}

/** Returns whether OpenClaw has a managed transport implementation for this API. */
export function isTransportAwareApiSupported(api: Api): boolean {
  return SOURCE_RUNTIME_TRANSPORTS.some((descriptor) => descriptor.api === api);
}

/** Maps public model APIs to the internal transport API id used by simple runtime dispatch. */
export function resolveTransportAwareSimpleApi(api: Api): Api | undefined {
  return SIMPLE_TRANSPORT_API_ALIAS[api];
}

/** Creates a managed transport stream only when request overrides require it. */
export function createTransportAwareStreamFnForModel(
  model: Model,
  ctx?: ProviderTransportStreamContext,
): StreamFn | undefined {
  if (!hasOpenClawTransportRequirement(model)) {
    return undefined;
  }
  if (!isTransportAwareApiSupported(model.api)) {
    throw new Error(
      `Model-provider request.proxy/request.tls/localService is not yet supported for api "${model.api}"`,
    );
  }
  return createSupportedTransportStreamFn(model, ctx);
}

/** Creates a managed OpenClaw transport stream for explicit fallback/runtime callers. */
export function createOpenClawTransportStreamFnForModel(
  model: Model,
  ctx?: ProviderTransportStreamContext,
): StreamFn | undefined {
  // Explicit fallback callers use this when they need OpenClaw's HTTP
  // transport semantics regardless of the default embedded-runner strategy.
  // Native OpenAI HTTP still depends on this path for strict tool shaping,
  // attribution, cache-boundary stripping, and runtime credential injection.
  if (!isTransportAwareApiSupported(model.api)) {
    return undefined;
  }
  return createSupportedTransportStreamFn(model, ctx);
}

export function createBoundaryAwareStreamFnForModel(
  model: Model,
  ctx?: ProviderTransportStreamContext,
): StreamFn | undefined {
  // Default embedded-runner fallback. Keep OpenAI-family APIs here while native
  // HTTP streams preserve the same OpenClaw request contract.
  if (!isTransportAwareApiSupported(model.api)) {
    return undefined;
  }
  return createSupportedTransportStreamFn(model, ctx);
}

export function prepareTransportAwareSimpleModel<TApi extends Api>(
  model: Model<TApi>,
  ctx?: ProviderTransportStreamContext,
): Model {
  const streamFn = createTransportAwareStreamFnForModel(model as Model, ctx);
  const alias = resolveTransportAwareSimpleApi(model.api);
  if (!streamFn || !alias) {
    return model;
  }
  return {
    ...model,
    api: alias,
  };
}

export function buildTransportAwareSimpleStreamFn(
  model: Model,
  ctx?: ProviderTransportStreamContext,
): StreamFn | undefined {
  return createTransportAwareStreamFnForModel(model, ctx);
}
