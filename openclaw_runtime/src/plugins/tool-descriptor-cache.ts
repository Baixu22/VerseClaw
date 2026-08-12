/** Caches plugin tool descriptors by plugin source, contract names, and runtime context. */
import type { AnyAgentTool } from "../agents/tools/common.js";
import { resolveRuntimeConfigCacheKey } from "../config/runtime-snapshot.js";
import type { JsonObject, ToolDescriptor } from "../tools/types.js";
import type { PluginLoadOptions } from "./loader.js";
import { registerPluginMetadataProcessMemoLifecycleClear } from "./plugin-metadata-lifecycle.js";
import type { OpenClawPluginToolContext } from "./types.js";

const PLUGIN_TOOL_DESCRIPTOR_CACHE_VERSION = 3;
const PLUGIN_TOOL_DESCRIPTOR_CACHE_LIMIT = 256;

/** Cached display descriptor for one plugin-created tool. */
export type CachedPluginToolDescriptor = {
  descriptor: ToolDescriptor;
  displaySummary?: string;
  executionMode?: AnyAgentTool["executionMode"];
  hasFinalizeBeforeToolCallParams?: boolean;
  hasPrepareArguments?: boolean;
  hasPrepareBeforeToolCallParams?: boolean;
  optional: boolean;
  risk?: AnyAgentTool["risk"];
  writeRiskProfile?: AnyAgentTool["writeRiskProfile"];
};

const descriptorCache = new Map<string, CachedPluginToolDescriptor[]>();
let descriptorCacheObjectIds = new WeakMap<object, number>();
let nextDescriptorCacheObjectId = 1;

export type PluginToolDescriptorConfigCacheKeyMemo = WeakMap<object, string | number | null>;

/** Creates a memo table for config cache keys reused across descriptor cache calls. */
export function createPluginToolDescriptorConfigCacheKeyMemo(): PluginToolDescriptorConfigCacheKeyMemo {
  return new WeakMap();
}

export function resetPluginToolDescriptorCache(): void {
  descriptorCache.clear();
  descriptorCacheObjectIds = new WeakMap();
  nextDescriptorCacheObjectId = 1;
}

// Plugin metadata and runtime registrations are gateway-lifecycle facts. The
// gateway reload/close path clears this bounded process cache explicitly, so
// request-time descriptor construction does not poll the plugin filesystem.
registerPluginMetadataProcessMemoLifecycleClear(resetPluginToolDescriptorCache);

function getDescriptorCacheObjectId(value: object | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const existing = descriptorCacheObjectIds.get(value);
  if (existing !== undefined) {
    return existing;
  }
  const next = nextDescriptorCacheObjectId++;
  descriptorCacheObjectIds.set(value, next);
  return next;
}

function stripDescriptorVolatileConfigFields(
  value: NonNullable<PluginLoadOptions["config"]>,
): NonNullable<PluginLoadOptions["config"]> {
  if (typeof value !== "object") {
    return value;
  }
  if (!("meta" in value) && !("wizard" in value)) {
    return value;
  }
  const { meta: _meta, wizard: _wizard, ...stableConfig } = value as Record<string, unknown>;
  return stableConfig as NonNullable<PluginLoadOptions["config"]>;
}

function getDescriptorConfigCacheKey(
  value: PluginLoadOptions["config"] | null | undefined,
  memo?: PluginToolDescriptorConfigCacheKeyMemo,
): string | number | null {
  if (!value) {
    return null;
  }
  const cached = memo?.get(value);
  if (cached !== undefined) {
    return cached;
  }
  let resolved: string | number | null;
  try {
    resolved = resolveRuntimeConfigCacheKey(stripDescriptorVolatileConfigFields(value));
  } catch {
    resolved = getDescriptorCacheObjectId(value);
  }
  memo?.set(value, resolved);
  return resolved;
}

function buildDescriptorContextCacheKey(params: {
  ctx: OpenClawPluginToolContext;
  currentRuntimeConfig?: PluginLoadOptions["config"] | null;
  configCacheKeyMemo?: PluginToolDescriptorConfigCacheKeyMemo;
}): string {
  const { ctx } = params;
  return JSON.stringify({
    config: getDescriptorConfigCacheKey(ctx.config, params.configCacheKeyMemo),
    runtimeConfig: getDescriptorConfigCacheKey(ctx.runtimeConfig, params.configCacheKeyMemo),
    currentRuntimeConfig: getDescriptorConfigCacheKey(
      params.currentRuntimeConfig,
      params.configCacheKeyMemo,
    ),
    fsPolicy: ctx.fsPolicy ?? null,
    workspaceDir: ctx.workspaceDir ?? null,
    agentDir: ctx.agentDir ?? null,
    agentId: ctx.agentId ?? null,
    activeModel: ctx.activeModel ?? null,
    browser: ctx.browser ?? null,
    messageChannel: ctx.messageChannel ?? null,
    agentAccountId: ctx.agentAccountId ?? null,
    deliveryContext: ctx.deliveryContext ?? null,
    requesterSenderId: ctx.requesterSenderId ?? null,
    sandboxed: ctx.sandboxed ?? null,
  });
}

export function buildPluginToolDescriptorCacheKey(params: {
  pluginId: string;
  source: string;
  rootDir?: string;
  contractToolNames: readonly string[];
  ctx: OpenClawPluginToolContext;
  runtimeRegistryVersion?: number | string;
  currentRuntimeConfig?: PluginLoadOptions["config"] | null;
  configCacheKeyMemo?: PluginToolDescriptorConfigCacheKeyMemo;
}): string {
  return JSON.stringify({
    version: PLUGIN_TOOL_DESCRIPTOR_CACHE_VERSION,
    pluginId: params.pluginId,
    source: params.source,
    rootDir: params.rootDir ?? null,
    runtimeRegistryVersion: params.runtimeRegistryVersion ?? null,
    contractToolNames: [...params.contractToolNames].toSorted(),
    context: buildDescriptorContextCacheKey({
      ctx: params.ctx,
      currentRuntimeConfig: params.currentRuntimeConfig,
      configCacheKeyMemo: params.configCacheKeyMemo,
    }),
  });
}

function asJsonObject(value: unknown): JsonObject {
  return value as JsonObject;
}

export function capturePluginToolDescriptor(params: {
  pluginId: string;
  tool: AnyAgentTool;
  optional: boolean;
}): CachedPluginToolDescriptor {
  const { tool } = params;
  const label = (tool as { label?: unknown }).label;
  const title = typeof label === "string" && label.trim() ? label.trim() : undefined;
  return {
    ...(tool.displaySummary ? { displaySummary: tool.displaySummary } : {}),
    ...(tool.executionMode ? { executionMode: tool.executionMode } : {}),
    ...(tool.finalizeBeforeToolCallParams ? { hasFinalizeBeforeToolCallParams: true } : {}),
    optional: params.optional,
    ...(tool.prepareArguments ? { hasPrepareArguments: true } : {}),
    ...(tool.prepareBeforeToolCallParams ? { hasPrepareBeforeToolCallParams: true } : {}),
    ...(tool.risk ? { risk: tool.risk } : {}),
    ...(tool.writeRiskProfile ? { writeRiskProfile: tool.writeRiskProfile } : {}),
    descriptor: {
      name: tool.name,
      ...(title ? { title } : {}),
      description: tool.description,
      inputSchema: asJsonObject(tool.parameters),
      owner: { kind: "plugin", pluginId: params.pluginId },
      executor: { kind: "plugin", pluginId: params.pluginId, toolName: params.tool.name },
    },
  };
}

export function readCachedPluginToolDescriptors(
  cacheKey: string,
): readonly CachedPluginToolDescriptor[] | undefined {
  return descriptorCache.get(cacheKey);
}

export function writeCachedPluginToolDescriptors(params: {
  cacheKey: string;
  descriptors: readonly CachedPluginToolDescriptor[];
}): void {
  if (
    !descriptorCache.has(params.cacheKey) &&
    descriptorCache.size >= PLUGIN_TOOL_DESCRIPTOR_CACHE_LIMIT
  ) {
    const oldestKey = descriptorCache.keys().next().value;
    if (oldestKey !== undefined) {
      descriptorCache.delete(oldestKey);
    }
  }
  descriptorCache.set(params.cacheKey, [...params.descriptors]);
}
