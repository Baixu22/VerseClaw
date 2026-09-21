import type { GatewayManager } from '../../gateway/manager';
import { getProviderAccount, listProviderAccounts } from './provider-store';
import { getProviderSecret } from '../secrets/secret-store';
import type { ProviderConfig } from '../../utils/secure-storage';
import { getAllProviders, getApiKey, getDefaultProvider, getProvider } from '../../utils/secure-storage';
import { getProviderConfig, getProviderDefaultModel } from '../../utils/provider-registry';
import {
  ensureAnthropicMessagesModelMaxTokens,
  ensureOpenClawProviderAgentRuntimePins,
  pruneInvalidApiProviderEntries,
  removeProviderFromOpenClaw,
  removeProviderKeyFromOpenClaw,
  saveOAuthTokenToOpenClaw,
  saveProviderKeyToOpenClaw,
  setOpenClawDefaultModel,
  setOpenClawDefaultModelWithOverride,
  syncProviderConfigToOpenClaw,
  updateAgentModelProvider,
  updateSingleAgentModelProvider,
} from '../../utils/openclaw-auth';
import {
  piAiModelsJsonModelEntry,
  type PiAiModelCostRates,
} from '../../shared/pi-ai-model-cost';
import { logger } from '../../utils/logger';
import { buildMultiInstanceProviderApiKeySecretRef } from '../../utils/provider-keys';
import { listAgentsSnapshot } from '../../utils/agent-config';

const OPENAI_OAUTH_RUNTIME_PROVIDER = 'openai-codex';
const OPENAI_OAUTH_DEFAULT_MODEL_REF = `${OPENAI_OAUTH_RUNTIME_PROVIDER}/gpt-5.5`;

/**
 * Provider types that are not in the built-in provider registry (no `providerConfig.api`).
 * They require explicit api-protocol defaulting to `openai-completions`.
 */
function isUnregisteredProviderType(type: string): boolean {
  return type === 'custom' || type === 'ollama';
}

type RuntimeProviderSyncContext = {
  runtimeProviderKey: string;
  meta: ReturnType<typeof getProviderConfig>;
  api: string;
};

/**
 * Translates the UI auth selection into the runtime `request.auth` override.
 * The value is the provider API key; the runtime resolver shared with the
 * save-time validator converts it into the concrete header/query format.
 */
function buildRuntimeProviderRequestAuth(
  config: ProviderConfig,
  apiKey: string | undefined,
): { auth: Record<string, unknown> } | undefined {
  const auth = config.requestAuth;
  if (!auth || auth.mode === 'none') {
    return undefined;
  }
  const value = (apiKey ?? '').trim();
  if (!value) {
    return undefined;
  }
  if (auth.mode === 'bearer') {
    return { auth: { mode: 'authorization-bearer', token: value } };
  }
  if (auth.mode === 'custom-header' && auth.headerName?.trim()) {
    return {
      auth: {
        mode: 'header',
        headerName: auth.headerName.trim(),
        value,
        ...(auth.prefix && auth.prefix.trim() ? { prefix: auth.prefix } : {}),
      },
    };
  }
  if (auth.mode === 'query' && auth.parameterName?.trim()) {
    return {
      auth: { mode: 'query', parameterName: auth.parameterName.trim(), value },
    };
  }
  return undefined;
}

/**
 * Declared model capability metadata (R4). Fields are only written when the
 * user declared them; absence keeps the runtime default and the UI marks the
 * value as "undeclared".
 */
function buildRuntimeModelProfileEntry(config: ProviderConfig, modelId: string): ReturnType<typeof piAiModelsJsonModelEntry> {
  const profile = config.modelProfile;
  return piAiModelsJsonModelEntry(modelId, modelId, {
    contextWindow: profile?.contextWindow,
    maxTokens: profile?.maxTokens,
    input:
      profile?.supportsVision === true
        ? ['text', 'image']
        : profile?.supportsVision === false
          ? ['text']
          : undefined,
    reasoning: profile?.supportsReasoning,
  });
}

function normalizeProviderBaseUrl(
  config: ProviderConfig,
  baseUrl?: string,
  apiProtocol?: string,
): string | undefined {
  if (!baseUrl) {
    return undefined;
  }

  const normalized = baseUrl.trim().replace(/\/+$/, '');

  if (config.type === 'minimax-portal' || config.type === 'minimax-portal-cn') {
    return normalized.replace(/\/v1$/, '').replace(/\/anthropic$/, '').replace(/\/$/, '') + '/anthropic';
  }

  if (isUnregisteredProviderType(config.type)) {
    const protocol = apiProtocol || config.apiProtocol || 'openai-completions';
    if (protocol === 'openai-responses') {
      return normalized.replace(/\/responses?$/i, '');
    }
    if (protocol === 'openai-completions') {
      return normalized.replace(/\/chat\/completions$/i, '');
    }
    if (protocol === 'anthropic-messages') {
      return normalized.replace(/\/v1\/messages$/i, '').replace(/\/messages$/i, '');
    }
  }

  return normalized;
}

function shouldUseExplicitDefaultOverride(config: ProviderConfig, runtimeProviderKey: string): boolean {
  return Boolean(config.baseUrl || config.apiProtocol || runtimeProviderKey !== config.type);
}

export function getOpenClawProviderKey(type: string, providerId: string): string {
  if (isUnregisteredProviderType(type)) {
    // If the providerId is already a runtime key (e.g. re-seeded from openclaw.json
    // as "custom-XXXXXXXX"), return it directly to avoid double-hashing.
    const prefix = `${type}-`;
    if (providerId.startsWith(prefix)) {
      const tail = providerId.slice(prefix.length);
      if (tail.length === 8 && !tail.includes('-')) {
        return providerId;
      }
    }
    const suffix = providerId.replace(/-/g, '').slice(0, 8);
    return `${type}-${suffix}`;
  }
  if (type === 'minimax-portal-cn') {
    return 'minimax-portal';
  }
  return type;
}

async function resolveRuntimeProviderKey(config: ProviderConfig): Promise<string> {
  const account = await getProviderAccount(config.id);
  if (account?.authMode === 'oauth_browser' && config.type === 'openai') {
    return OPENAI_OAUTH_RUNTIME_PROVIDER;
  }
  return getOpenClawProviderKey(config.type, config.id);
}

async function getBrowserOAuthRuntimeProvider(config: ProviderConfig): Promise<string | null> {
  const account = await getProviderAccount(config.id);
  if (account?.authMode !== 'oauth_browser') {
    return null;
  }

  const secret = await getProviderSecret(config.id);
  if (secret?.type !== 'oauth') {
    return null;
  }

  if (config.type === 'openai') {
    return OPENAI_OAUTH_RUNTIME_PROVIDER;
  }
  return null;
}

export function getProviderModelRef(config: ProviderConfig): string | undefined {
  const providerKey = getOpenClawProviderKey(config.type, config.id);

  if (config.model) {
    return config.model.startsWith(`${providerKey}/`)
      ? config.model
      : `${providerKey}/${config.model}`;
  }

  const defaultModel = getProviderDefaultModel(config.type);
  if (!defaultModel) {
    return undefined;
  }

  return defaultModel.startsWith(`${providerKey}/`)
    ? defaultModel
    : `${providerKey}/${defaultModel}`;
}

export async function getProviderFallbackModelRefs(config: ProviderConfig): Promise<string[]> {
  const allProviders = await getAllProviders();
  const providerMap = new Map(allProviders.map((provider) => [provider.id, provider]));
  const seen = new Set<string>();
  const results: string[] = [];
  const providerKey = getOpenClawProviderKey(config.type, config.id);

  for (const fallbackModel of config.fallbackModels ?? []) {
    const normalizedModel = fallbackModel.trim();
    if (!normalizedModel) continue;

    const modelRef = normalizedModel.startsWith(`${providerKey}/`)
      ? normalizedModel
      : `${providerKey}/${normalizedModel}`;

    if (seen.has(modelRef)) continue;
    seen.add(modelRef);
    results.push(modelRef);
  }

  for (const fallbackId of config.fallbackProviderIds ?? []) {
    if (!fallbackId || fallbackId === config.id) continue;

    const fallbackProvider = providerMap.get(fallbackId);
    if (!fallbackProvider) continue;

    const modelRef = getProviderModelRef(fallbackProvider);
    if (!modelRef || seen.has(modelRef)) continue;

    seen.add(modelRef);
    results.push(modelRef);
  }

  return results;
}

type GatewayRefreshMode = 'reload' | 'restart';

function scheduleGatewayRefresh(
  gatewayManager: GatewayManager | undefined,
  message: string,
  options?: { delayMs?: number; onlyIfRunning?: boolean; mode?: GatewayRefreshMode },
): void {
  if (!gatewayManager) {
    return;
  }

  if (options?.onlyIfRunning && gatewayManager.getStatus().state === 'stopped') {
    return;
  }

  logger.info(message);
  if (options?.mode === 'restart') {
    gatewayManager.debouncedRestart(options?.delayMs);
    return;
  }
  gatewayManager.debouncedReload(options?.delayMs);
}

export async function syncProviderApiKeyToRuntime(
  providerType: string,
  providerId: string,
  apiKey: string,
): Promise<void> {
  const ock = getOpenClawProviderKey(providerType, providerId);
  await saveProviderKeyToOpenClaw(ock, apiKey);
}

export async function syncAllProviderAuthToRuntime(): Promise<void> {
  const accounts = await listProviderAccounts();
  for (const account of accounts) {
    const runtimeProviderKey = await resolveRuntimeProviderKey({
      id: account.id,
      name: account.label,
      type: account.vendorId,
      baseUrl: account.baseUrl,
      model: account.model,
      fallbackModels: account.fallbackModels,
      fallbackProviderIds: account.fallbackAccountIds,
      enabled: account.enabled,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
    });

    const secret = await getProviderSecret(account.id);
    if (!secret) {
      continue;
    }

    if (secret.type === 'api_key') {
      await saveProviderKeyToOpenClaw(runtimeProviderKey, secret.apiKey);
      continue;
    }

    if (secret.type === 'local' && secret.apiKey) {
      await saveProviderKeyToOpenClaw(runtimeProviderKey, secret.apiKey);
      continue;
    }

    if (secret.type === 'oauth') {
      await saveOAuthTokenToOpenClaw(runtimeProviderKey, {
        access: secret.accessToken,
        refresh: secret.refreshToken,
        expires: secret.expiresAt,
        email: secret.email,
        projectId: secret.subject,
      });
    }
  }
}

async function syncProviderSecretToRuntime(
  config: ProviderConfig,
  runtimeProviderKey: string,
  apiKey: string | undefined,
): Promise<void> {
  const secret = await getProviderSecret(config.id);
  if (apiKey !== undefined) {
    const trimmedKey = apiKey.trim();
    if (trimmedKey) {
      await saveProviderKeyToOpenClaw(runtimeProviderKey, trimmedKey);
    } else {
      // An explicit empty string means the caller wants to clear the key.
      // Mirror that intent into OpenClaw auth-profiles so the gateway no
      // longer authenticates with the stale value (matches the explicit
      // delete branch in the legacy /api/providers/:id PUT handler).
      await removeProviderKeyFromOpenClaw(runtimeProviderKey);
    }
    return;
  }

  if (secret?.type === 'api_key') {
    await saveProviderKeyToOpenClaw(runtimeProviderKey, secret.apiKey);
    return;
  }

  if (secret?.type === 'oauth') {
    await saveOAuthTokenToOpenClaw(runtimeProviderKey, {
      access: secret.accessToken,
      refresh: secret.refreshToken,
      expires: secret.expiresAt,
      email: secret.email,
      projectId: secret.subject,
    });
    return;
  }

  if (secret?.type === 'local' && secret.apiKey) {
    await saveProviderKeyToOpenClaw(runtimeProviderKey, secret.apiKey);
  }
}

async function resolveRuntimeSyncContext(config: ProviderConfig): Promise<RuntimeProviderSyncContext | null> {
  const runtimeProviderKey = await resolveRuntimeProviderKey(config);
  const meta = getProviderConfig(config.type);
  const api = config.apiProtocol || (isUnregisteredProviderType(config.type) ? 'openai-completions' : meta?.api);
  if (!api) {
    return null;
  }

  return {
    runtimeProviderKey,
    meta,
    api,
  };
}

async function syncRuntimeProviderConfig(
  config: ProviderConfig,
  context: RuntimeProviderSyncContext,
  apiKey: string | undefined,
): Promise<void> {
  const request = buildRuntimeProviderRequestAuth(config, apiKey);
  const modelEntry = config.model
    ? buildRuntimeModelProfileEntry(config, config.model)
    : undefined;
  await syncProviderConfigToOpenClaw(context.runtimeProviderKey, config.model, {
    baseUrl: normalizeProviderBaseUrl(config, config.baseUrl || context.meta?.baseUrl, context.api),
    api: context.api,
    apiKeyEnv: isUnregisteredProviderType(config.type)
      ? (apiKey?.trim() || await getApiKey(config.id)) ? buildMultiInstanceProviderApiKeySecretRef(context.runtimeProviderKey) : undefined
      : context.meta?.apiKeyEnv,
    // Merge instead of replace so a User-Agent/custom header never wipes vendor defaults.
    headers: { ...(context.meta?.headers ?? {}), ...(config.headers ?? {}) },
    ...(request ? { request } : {}),
    ...(modelEntry ? { modelEntries: [modelEntry] } : {}),
  });
}

async function syncCustomProviderAgentModel(
  config: ProviderConfig,
  runtimeProviderKey: string,
  apiKey: string | undefined,
): Promise<void> {
  if (!isUnregisteredProviderType(config.type)) {
    return;
  }

  const resolvedKey = apiKey !== undefined ? (apiKey.trim() || null) : await getApiKey(config.id);
  if (!resolvedKey || !config.baseUrl) {
    return;
  }

  const modelId = config.model;
  const request = buildRuntimeProviderRequestAuth(config, resolvedKey);
  await updateAgentModelProvider(runtimeProviderKey, {
    baseUrl: normalizeProviderBaseUrl(config, config.baseUrl, config.apiProtocol || 'openai-completions'),
    api: config.apiProtocol || 'openai-completions',
    models: modelId ? [buildRuntimeModelProfileEntry(config, modelId)] : [],
    apiKey: resolvedKey,
    ...(request ? { request } : {}),
  });
}

async function syncProviderToRuntime(
  config: ProviderConfig,
  apiKey: string | undefined,
): Promise<RuntimeProviderSyncContext | null> {
  const context = await resolveRuntimeSyncContext(config);
  if (!context) {
    return null;
  }

  await syncProviderSecretToRuntime(config, context.runtimeProviderKey, apiKey);
  await syncRuntimeProviderConfig(config, context, apiKey);
  await syncCustomProviderAgentModel(config, context.runtimeProviderKey, apiKey);
  return context;
}

async function removeDeletedProviderFromOpenClaw(
  provider: ProviderConfig,
  providerId: string,
  runtimeProviderKey?: string,
): Promise<void> {
  const keys = new Set<string>();
  if (runtimeProviderKey) {
    keys.add(runtimeProviderKey);
  } else {
    keys.add(await resolveRuntimeProviderKey({ ...provider, id: providerId }));
  }
  keys.add(providerId);

  for (const key of keys) {
    await removeProviderFromOpenClaw(key);
  }
}

function parseModelRef(modelRef: string): { providerKey: string; modelId: string } | null {
  const trimmed = modelRef.trim();
  const separatorIndex = trimmed.indexOf('/');
  if (separatorIndex <= 0 || separatorIndex >= trimmed.length - 1) {
    return null;
  }

  return {
    providerKey: trimmed.slice(0, separatorIndex),
    modelId: trimmed.slice(separatorIndex + 1),
  };
}

async function buildRuntimeProviderConfigMap(): Promise<Map<string, ProviderConfig>> {
  const configs = await getAllProviders();
  const runtimeMap = new Map<string, ProviderConfig>();

  for (const config of configs) {
    const runtimeKey = await resolveRuntimeProviderKey(config);
    runtimeMap.set(runtimeKey, config);
  }

  return runtimeMap;
}

async function buildAgentModelProviderEntry(
  config: ProviderConfig,
  modelId: string,
): Promise<{
  baseUrl?: string;
  api?: string;
  models?: Array<{ id: string; name: string; cost?: PiAiModelCostRates; [key: string]: unknown }>;
  apiKey?: string;
  authHeader?: boolean;
  request?: Record<string, unknown>;
} | null> {
  const meta = getProviderConfig(config.type);
  const api = config.apiProtocol || (isUnregisteredProviderType(config.type) ? 'openai-completions' : meta?.api);
  const baseUrl = normalizeProviderBaseUrl(config, config.baseUrl || meta?.baseUrl, api);
  if (!api || !baseUrl) {
    return null;
  }

  let apiKey: string | undefined;
  let authHeader: boolean | undefined;

  if (isUnregisteredProviderType(config.type)) {
    apiKey = (await getApiKey(config.id)) || undefined;
  } else if (config.type === 'minimax-portal' || config.type === 'minimax-portal-cn') {
    const accountApiKey = await getApiKey(config.id);
    const oauthMarker = meta?.oauthApiKeyMarker;
    if (accountApiKey) {
      apiKey = accountApiKey;
    } else if (oauthMarker) {
      // OAuth-backed marker from provider metadata (single source instead of a
      // minimax-only hardcode); the runtime resolves the real token from auth-profiles.
      authHeader = meta?.oauthAuthHeader ?? false;
      apiKey = oauthMarker;
    }
  }

  const request = buildRuntimeProviderRequestAuth(config, apiKey);

  return {
    baseUrl,
    api,
    models: [buildRuntimeModelProfileEntry(config, modelId)],
    apiKey,
    authHeader,
    ...(request ? { request } : {}),
  };
}

async function syncAgentModelsToRuntime(agentIds?: Set<string>): Promise<void> {
  const snapshot = await listAgentsSnapshot();
  const runtimeProviderConfigs = await buildRuntimeProviderConfigMap();

  const targets = snapshot.agents.filter((agent) => {
    if (!agent.modelRef) return false;
    if (!agentIds) return true;
    return agentIds.has(agent.id);
  });

  for (const agent of targets) {
    const parsed = parseModelRef(agent.modelRef || '');
    if (!parsed) {
      continue;
    }

    const providerConfig = runtimeProviderConfigs.get(parsed.providerKey);
    if (!providerConfig) {
      logger.warn(
        `[provider-runtime] No provider account mapped to runtime key "${parsed.providerKey}" for agent "${agent.id}"`,
      );
      continue;
    }

    const entry = await buildAgentModelProviderEntry(providerConfig, parsed.modelId);
    if (!entry) {
      continue;
    }

    await updateSingleAgentModelProvider(agent.id, parsed.providerKey, entry);
  }
}

export async function syncAgentModelOverrideToRuntime(agentId: string): Promise<void> {
  await syncAgentModelsToRuntime(new Set([agentId]));
}

export async function syncSavedProviderToRuntime(
  config: ProviderConfig,
  apiKey: string | undefined,
  gatewayManager?: GatewayManager,
): Promise<void> {
  const context = await syncProviderToRuntime(config, apiKey);
  if (!context) {
    return;
  }

  try {
    await syncAgentModelsToRuntime();
  } catch (err) {
    logger.warn('[provider-runtime] Failed to sync per-agent model registries after provider save:', err);
  }

  scheduleGatewayRefresh(
    gatewayManager,
    `Scheduling Gateway reload after saving provider "${context.runtimeProviderKey}" config`,
  );
}

export async function syncUpdatedProviderToRuntime(
  config: ProviderConfig,
  apiKey: string | undefined,
  gatewayManager?: GatewayManager,
): Promise<void> {
  const context = await syncProviderToRuntime(config, apiKey);
  if (!context) {
    return;
  }

  const ock = context.runtimeProviderKey;
  const fallbackModels = await getProviderFallbackModelRefs(config);

  const defaultProviderId = await getDefaultProvider();
  const isDefaultProvider = defaultProviderId === config.id;
  if (isDefaultProvider) {
    const modelOverride = config.model ? `${ock}/${config.model}` : undefined;
    if (!isUnregisteredProviderType(config.type)) {
      if (shouldUseExplicitDefaultOverride(config, ock)) {
        await setOpenClawDefaultModelWithOverride(ock, modelOverride, {
          baseUrl: normalizeProviderBaseUrl(config, config.baseUrl || context.meta?.baseUrl, context.api),
          api: context.api,
          apiKeyEnv: context.meta?.apiKeyEnv,
          headers: config.headers ?? context.meta?.headers,
        }, fallbackModels);
      } else {
        await setOpenClawDefaultModel(ock, modelOverride, fallbackModels);
      }
    } else {
      await setOpenClawDefaultModelWithOverride(ock, modelOverride, {
        baseUrl: normalizeProviderBaseUrl(config, config.baseUrl, config.apiProtocol || 'openai-completions'),
        api: config.apiProtocol || 'openai-completions',
        headers: config.headers,
      }, fallbackModels);
    }
  }

  try {
    await syncAgentModelsToRuntime();
  } catch (err) {
    logger.warn('[provider-runtime] Failed to sync per-agent model registries after provider update:', err);
  }

  scheduleGatewayRefresh(
    gatewayManager,
    `Scheduling Gateway reload after updating provider "${ock}" config`,
  );
}

export async function syncDeletedProviderToRuntime(
  provider: ProviderConfig | null,
  providerId: string,
  gatewayManager?: GatewayManager,
  runtimeProviderKey?: string,
): Promise<void> {
  if (!provider?.type) {
    return;
  }

  const ock = runtimeProviderKey ?? await resolveRuntimeProviderKey({ ...provider, id: providerId });
  await removeDeletedProviderFromOpenClaw(provider, providerId, ock);

  scheduleGatewayRefresh(
    gatewayManager,
    `Scheduling Gateway restart after deleting provider "${ock}"`,
    { mode: 'restart' },
  );
}

export async function syncDeletedProviderApiKeyToRuntime(
  provider: ProviderConfig | null,
  providerId: string,
  runtimeProviderKey?: string,
): Promise<void> {
  if (!provider?.type) {
    return;
  }

  const ock = runtimeProviderKey ?? await resolveRuntimeProviderKey({ ...provider, id: providerId });
  await removeProviderKeyFromOpenClaw(ock);
}

export type ProviderRuntimeSyncOutcome = {
  /** True when the default provider was saved but part of the runtime
   * registry sync (per-agent models.json) failed. */
  degraded: boolean;
  /** Diagnostic detail for the degraded sync (not user-facing copy). */
  reason?: string;
};

export async function syncDefaultProviderToRuntime(
  providerId: string,
  gatewayManager?: GatewayManager,
): Promise<ProviderRuntimeSyncOutcome> {
  const provider = await getProvider(providerId);
  if (!provider) {
    return { degraded: false };
  }
  let degradedReason: string | undefined;

  // Self-heal: opportunistically remove any pre-existing models.providers
  // entries with an invalid `api` field so a switch to a healthy provider
  // can rescue the user from a previously broken config (e.g. the historical
  // openrouter `api: 'openrouter'` bug).  Covers both OAuth and non-OAuth
  // branches below.
  try {
    const removed = await pruneInvalidApiProviderEntries();
    if (removed.length > 0) {
      logger.warn(
        `[provider-runtime] Pruned invalid models.providers entries before switch: ${removed.join(', ')}`,
      );
    }
  } catch (err) {
    logger.warn('[provider-runtime] Failed to prune invalid provider entries before switch:', err);
  }

  // Self-heal: pin the embedded agent runtime for legacy OpenAI provider entries
  // (`openai`, `openai-codex`) that would otherwise be auto-routed to the
  // unbundled `codex` harness. Running this before every default-provider switch
  // repairs on-disk config written by earlier Verse Claw builds.
  try {
    const pinned = await ensureOpenClawProviderAgentRuntimePins();
    if (pinned.length > 0) {
      logger.warn(
        `[provider-runtime] Pinned embedded agent runtime for models.providers entries before switch: ${pinned.join(', ')}`,
      );
    }
  } catch (err) {
    logger.warn('[provider-runtime] Failed to pin embedded agent runtime for provider entries before switch:', err);
  }

  try {
    const healed = await ensureAnthropicMessagesModelMaxTokens();
    if (healed.length > 0) {
      logger.warn(
        `[provider-runtime] Ensured anthropic-messages maxTokens for models.providers entries before switch: ${healed.join(', ')}`,
      );
    }
  } catch (err) {
    logger.warn('[provider-runtime] Failed to ensure anthropic-messages maxTokens before switch:', err);
  }

  const ock = await resolveRuntimeProviderKey(provider);
  const providerKey = await getApiKey(providerId);
  const fallbackModels = await getProviderFallbackModelRefs(provider);
  const oauthTypes = ['minimax-portal', 'minimax-portal-cn'];
  const browserOAuthRuntimeProvider = await getBrowserOAuthRuntimeProvider(provider);
  const isOAuthProvider = (oauthTypes.includes(provider.type) && !providerKey) || Boolean(browserOAuthRuntimeProvider);

  if (!isOAuthProvider) {
    const modelOverride = provider.model
      ? (provider.model.startsWith(`${ock}/`) ? provider.model : `${ock}/${provider.model}`)
      : undefined;

    if (isUnregisteredProviderType(provider.type)) {
      await setOpenClawDefaultModelWithOverride(ock, modelOverride, {
        baseUrl: normalizeProviderBaseUrl(provider, provider.baseUrl, provider.apiProtocol || 'openai-completions'),
        api: provider.apiProtocol || 'openai-completions',
        apiKeyEnv: providerKey ? buildMultiInstanceProviderApiKeySecretRef(ock) : undefined,
        headers: provider.headers,
      }, fallbackModels);
    } else if (shouldUseExplicitDefaultOverride(provider, ock)) {
      await setOpenClawDefaultModelWithOverride(ock, modelOverride, {
        baseUrl: normalizeProviderBaseUrl(
          provider,
          provider.baseUrl || getProviderConfig(provider.type)?.baseUrl,
          provider.apiProtocol || getProviderConfig(provider.type)?.api,
        ),
        api: provider.apiProtocol || getProviderConfig(provider.type)?.api,
        apiKeyEnv: getProviderConfig(provider.type)?.apiKeyEnv,
        headers: provider.headers ?? getProviderConfig(provider.type)?.headers,
      }, fallbackModels);
    } else {
      await setOpenClawDefaultModel(ock, modelOverride, fallbackModels);
    }

    if (providerKey) {
      await saveProviderKeyToOpenClaw(ock, providerKey);
    }
  } else {
    if (browserOAuthRuntimeProvider) {
      const secret = await getProviderSecret(provider.id);
      if (secret?.type === 'oauth') {
        await saveOAuthTokenToOpenClaw(browserOAuthRuntimeProvider, {
          access: secret.accessToken,
          refresh: secret.refreshToken,
          expires: secret.expiresAt,
          email: secret.email,
          projectId: secret.subject,
        });
      }

      const defaultModelRef = OPENAI_OAUTH_DEFAULT_MODEL_REF;
      const modelOverride = provider.model
        ? (provider.model.startsWith(`${browserOAuthRuntimeProvider}/`)
          ? provider.model
          : `${browserOAuthRuntimeProvider}/${provider.model}`)
        : defaultModelRef;

      await setOpenClawDefaultModel(browserOAuthRuntimeProvider, modelOverride, fallbackModels);
      logger.info(`Configured openclaw.json for browser OAuth provider "${provider.id}"`);
      try {
        await syncAgentModelsToRuntime();
      } catch (err) {
        degradedReason = `Failed to sync per-agent model registries after browser OAuth switch: ${String(err)}`;
        logger.warn('[provider-runtime] Failed to sync per-agent model registries after browser OAuth switch:', err);
      }
      scheduleGatewayRefresh(
        gatewayManager,
        `Scheduling Gateway reload after provider switch to "${browserOAuthRuntimeProvider}"`,
      );
      return { degraded: Boolean(degradedReason), reason: degradedReason };
    }

    const defaultBaseUrl = provider.type === 'minimax-portal'
      ? 'https://api.minimax.io/anthropic'
      : 'https://api.minimaxi.com/anthropic';
    const api = 'anthropic-messages' as const;

    let baseUrl = provider.baseUrl || defaultBaseUrl;
    if (baseUrl) {
      baseUrl = baseUrl.replace(/\/v1$/, '').replace(/\/anthropic$/, '').replace(/\/$/, '') + '/anthropic';
    }

    // OAuth auth format comes from provider metadata, not a minimax-only hardcode.
    const portalMeta = getProviderConfig(provider.type);
    // Keep the historical marker as a compatibility fallback for older or
    // custom provider metadata. The marker is only a models.json auth hint;
    // omitting the update would regress the R0-2 degraded-path contract.
    const oauthApiKeyMarker = portalMeta?.oauthApiKeyMarker || 'minimax-oauth';
    if (!portalMeta?.oauthApiKeyMarker) {
      logger.warn(`[provider-runtime] Provider metadata omitted oauthApiKeyMarker; using legacy "${oauthApiKeyMarker}" fallback`);
    }
    const targetProviderKey = ock;
    const oauthAuthHeader = portalMeta?.oauthAuthHeader ?? false;

    await setOpenClawDefaultModelWithOverride(targetProviderKey, getProviderModelRef(provider), {
      baseUrl,
      api,
      authHeader: oauthAuthHeader,
      apiKeyEnv: oauthApiKeyMarker,
    }, fallbackModels);

    logger.info(`Configured openclaw.json for OAuth provider "${provider.type}"`);

    try {
      const defaultModelId = provider.model?.split('/').pop();
      await updateAgentModelProvider(targetProviderKey, {
        baseUrl,
        api,
        authHeader: oauthAuthHeader,
        apiKey: oauthApiKeyMarker,
        models: defaultModelId ? [piAiModelsJsonModelEntry(defaultModelId)] : [],
      });
    } catch (err) {
      degradedReason = `Failed to update models.json for OAuth provider "${targetProviderKey}": ${String(err)}`;
      logger.warn(`Failed to update models.json for OAuth provider "${targetProviderKey}":`, err);
    }
  }

  if (
    isUnregisteredProviderType(provider.type) &&
    providerKey &&
    provider.baseUrl
  ) {
    const modelId = provider.model;
    const request = buildRuntimeProviderRequestAuth(provider, providerKey);
    await updateAgentModelProvider(ock, {
      baseUrl: normalizeProviderBaseUrl(provider, provider.baseUrl, provider.apiProtocol || 'openai-completions'),
      api: provider.apiProtocol || 'openai-completions',
      models: modelId ? [buildRuntimeModelProfileEntry(provider, modelId)] : [],
      apiKey: providerKey,
      ...(request ? { request } : {}),
    });
  }

  try {
    await syncAgentModelsToRuntime();
  } catch (err) {
    degradedReason = degradedReason
      ?? `Failed to sync per-agent model registries after default provider switch: ${String(err)}`;
    logger.warn('[provider-runtime] Failed to sync per-agent model registries after default provider switch:', err);
  }

  scheduleGatewayRefresh(
    gatewayManager,
    `Scheduling Gateway reload after provider switch to "${ock}"`,
    { onlyIfRunning: true },
  );

  return { degraded: Boolean(degradedReason), reason: degradedReason };
}
