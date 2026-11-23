import { runtimeProviderKey, runtimeAccountProviderKey } from '../../shared/providers/runtime-identity';

const MULTI_INSTANCE_PROVIDER_TYPES = new Set(['custom', 'ollama']);

export const OPENCLAW_PROVIDER_KEY_MINIMAX = 'minimax-portal';
export const OPENCLAW_PROVIDER_KEY_MOONSHOT = 'moonshot';
export const OPENCLAW_PROVIDER_KEY_MOONSHOT_GLOBAL = 'moonshot-global';
export const OPENAI_CODEX_RUNTIME_PROVIDER_KEY = 'openai-codex';
export const VERSE_CLAW_OPENAI_IMAGE_PROVIDER_KEY = 'clawx-openai-image';
export const OAUTH_PROVIDER_TYPES = ['minimax-portal', 'minimax-portal-cn'] as const;
export const OPENCLAW_OAUTH_PLUGIN_PROVIDER_KEYS = [
  OPENCLAW_PROVIDER_KEY_MINIMAX,
  OPENAI_CODEX_RUNTIME_PROVIDER_KEY,
] as const;

const OAUTH_PROVIDER_TYPE_SET = new Set<string>(OAUTH_PROVIDER_TYPES);
const OPENCLAW_OAUTH_PLUGIN_PROVIDER_KEY_SET = new Set<string>(OPENCLAW_OAUTH_PLUGIN_PROVIDER_KEYS);
const HIDDEN_PROVIDER_KEYS_FOR_UI = new Set<string>([
  VERSE_CLAW_OPENAI_IMAGE_PROVIDER_KEY,
]);

const PROVIDER_KEY_ALIASES: Record<string, string> = {
  'minimax-portal-cn': OPENCLAW_PROVIDER_KEY_MINIMAX,
};

export function getOpenClawProviderKeyForType(type: string, providerId: string): string {
  return runtimeProviderKey(type, providerId);
}

export function isMultiInstanceProviderType(type: string): boolean {
  return MULTI_INSTANCE_PROVIDER_TYPES.has(type);
}

export type EnvApiKeySecretRef = { source: 'env'; provider: 'default'; id: string };

/**
 * Multi-instance (custom/ollama) providers have no registry env var, so their
 * key reaches the source runtime as an env SecretRef in openclaw.json plus the
 * matching variable injected into the Gateway process environment.
 */
export function getMultiInstanceProviderApiKeyEnvVar(runtimeProviderKey: string): string {
  return `${runtimeProviderKey.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_API_KEY`;
}

export function buildMultiInstanceProviderApiKeySecretRef(runtimeProviderKey: string): EnvApiKeySecretRef {
  return { source: 'env', provider: 'default', id: getMultiInstanceProviderApiKeyEnvVar(runtimeProviderKey) };
}

/**
 * Resolve the OpenClaw runtime provider key for a saved account.
 * Browser OAuth for OpenAI is stored under vendorId `openai` but runs as `openai-codex`.
 */
export function resolveOpenClawProviderKey(account: {
  vendorId: string;
  id: string;
  authMode?: string;
}): string {
  return runtimeAccountProviderKey(account);
}

/**
 * Get all vendorId values that map to the given openclaw.json key via alias.
 * e.g. getAliasSourceTypes('minimax-portal') → ['minimax-portal-cn']
 */
export function getAliasSourceTypes(openClawKey: string): string[] {
  return Object.entries(PROVIDER_KEY_ALIASES)
    .filter(([, target]) => target === openClawKey)
    .map(([source]) => source);
}

/**
 * OpenAI Codex OAuth uses runtime key `openai-codex` while API keys use `openai`.
 * When only OAuth is configured, hide the redundant bare `openai` active slot so the
 * UI does not show a second "OpenAI • API key (missing)" row.
 */
export function filterActiveProviderKeysForUi(
  activeKeys: Iterable<string>,
  options?: { hasConfiguredOpenAiApiKey?: boolean },
): string[] {
  const keys = Array.from(activeKeys).filter((key) => !HIDDEN_PROVIDER_KEYS_FOR_UI.has(key));
  const active = new Set(keys);
  if (!active.has('openai') || !active.has(OPENAI_CODEX_RUNTIME_PROVIDER_KEY)) {
    return keys;
  }
  if (options?.hasConfiguredOpenAiApiKey) {
    return keys;
  }
  return keys.filter((key) => key !== 'openai');
}

export function isOAuthProviderType(type: string): boolean {
  return OAUTH_PROVIDER_TYPE_SET.has(type);
}

export function isMiniMaxProviderType(type: string): boolean {
  return type === OPENCLAW_PROVIDER_KEY_MINIMAX || type === 'minimax-portal-cn';
}

export function getOAuthProviderTargetKey(type: string): string | undefined {
  if (!isOAuthProviderType(type)) return undefined;
  return OPENCLAW_PROVIDER_KEY_MINIMAX;
}

export function getOAuthProviderApi(type: string): 'anthropic-messages' | undefined {
  if (!isOAuthProviderType(type)) return undefined;
  return 'anthropic-messages';
}

export function getOAuthProviderDefaultBaseUrl(type: string): string | undefined {
  if (!isOAuthProviderType(type)) return undefined;
  if (type === OPENCLAW_PROVIDER_KEY_MINIMAX) return 'https://api.minimax.io/anthropic';
  if (type === 'minimax-portal-cn') return 'https://api.minimaxi.com/anthropic';
  return undefined;
}

export function normalizeOAuthBaseUrl(_type: string, baseUrl?: string): string | undefined {
  if (!baseUrl) return undefined;
  return baseUrl.replace(/\/v1$/, '').replace(/\/anthropic$/, '').replace(/\/$/, '') + '/anthropic';
}

export function usesOAuthAuthHeader(providerKey: string): boolean {
  return providerKey === OPENCLAW_PROVIDER_KEY_MINIMAX;
}

export function getOAuthApiKeyEnv(providerKey: string): string | undefined {
  if (providerKey === OPENCLAW_PROVIDER_KEY_MINIMAX) return 'minimax-oauth';
  return undefined;
}

export function isOpenClawOAuthPluginProviderKey(provider: string): boolean {
  return OPENCLAW_OAUTH_PLUGIN_PROVIDER_KEY_SET.has(provider);
}
