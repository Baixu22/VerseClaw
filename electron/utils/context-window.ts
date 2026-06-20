import { getProviderBackendConfig } from '../shared/providers/registry';
import { getDefaultProviderAccountId, listProviderAccounts } from '../services/providers/provider-store';
import { getOpenClawProvidersConfig } from './openclaw-auth';

type ModelLimitCandidate = {
  id?: unknown;
  name?: unknown;
  contextWindow?: unknown;
  context_window?: unknown;
  contextLength?: unknown;
  context_length?: unknown;
  maxContextTokens?: unknown;
  max_context_tokens?: unknown;
  maxInputTokens?: unknown;
  max_input_tokens?: unknown;
  maxTokens?: unknown;
  max_tokens?: unknown;
};

export type ContextWindowResolutionSource =
  | 'openclaw-model'
  | 'openclaw-provider'
  | 'provider-registry'
  | 'unavailable';

export interface ContextWindowResolution {
  modelRef: string | null;
  maxTokens: number | null;
  source: ContextWindowResolutionSource;
}

function positiveInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const floored = Math.floor(value);
    return floored > 0 ? floored : null;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) {
      const floored = Math.floor(parsed);
      return floored > 0 ? floored : null;
    }
  }
  return null;
}

function firstTokenLimit(candidate: ModelLimitCandidate | undefined): number | null {
  if (!candidate) return null;
  return positiveInteger(candidate.contextWindow)
    ?? positiveInteger(candidate.context_window)
    ?? positiveInteger(candidate.contextLength)
    ?? positiveInteger(candidate.context_length)
    ?? positiveInteger(candidate.maxContextTokens)
    ?? positiveInteger(candidate.max_context_tokens)
    ?? positiveInteger(candidate.maxInputTokens)
    ?? positiveInteger(candidate.max_input_tokens)
    ?? positiveInteger(candidate.maxTokens)
    ?? positiveInteger(candidate.max_tokens);
}

export function splitModelRef(modelRef: string | null | undefined): { providerKey: string; modelId: string } | null {
  const trimmed = (modelRef ?? '').trim();
  if (!trimmed) return null;
  const slash = trimmed.indexOf('/');
  if (slash <= 0 || slash >= trimmed.length - 1) return null;
  return {
    providerKey: trimmed.slice(0, slash),
    modelId: trimmed.slice(slash + 1),
  };
}

function resolveRuntimeProviderKey(account: { id: string; vendorId: string; authMode?: string }): string {
  if (account.authMode === 'oauth_browser' && account.vendorId === 'openai') {
    return 'openai-codex';
  }
  if (account.vendorId === 'custom' || account.vendorId === 'ollama') {
    const suffix = account.id.replace(/-/g, '').slice(0, 8);
    return `${account.vendorId}-${suffix}`;
  }
  if (account.vendorId === 'minimax-portal-cn') {
    return 'minimax-portal';
  }
  return account.vendorId;
}

async function resolveConfiguredModelRefFallback(): Promise<string | null> {
  try {
    const [accounts, defaultAccountId] = await Promise.all([
      listProviderAccounts(),
      getDefaultProviderAccountId(),
    ]);
    const candidates = accounts
      .filter((account) => account.enabled && account.model?.trim())
      .sort((left, right) => {
        if (left.id === defaultAccountId || left.isDefault) return -1;
        if (right.id === defaultAccountId || right.isDefault) return 1;
        return right.updatedAt.localeCompare(left.updatedAt);
      });
    const account = candidates[0];
    if (!account?.model) return null;
    const runtimeProviderKey = resolveRuntimeProviderKey(account);
    const modelId = account.model.startsWith(`${runtimeProviderKey}/`)
      ? account.model.slice(runtimeProviderKey.length + 1)
      : account.model.trim();
    return modelId ? `${runtimeProviderKey}/${modelId}` : null;
  } catch {
    return null;
  }
}

function normalizeModelId(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function findModelLimit(models: unknown, modelId: string): number | null {
  if (!Array.isArray(models)) return null;
  const normalizedModelId = modelId.trim().toLowerCase();
  const entries = models.filter((entry): entry is ModelLimitCandidate => Boolean(entry) && typeof entry === 'object');
  const exact = entries.find((entry) =>
    normalizeModelId(entry.id) === normalizedModelId
    || normalizeModelId(entry.name) === normalizedModelId
  );
  return firstTokenLimit(exact);
}

function resolveFromProviderRegistry(providerKey: string, modelId: string): number | null {
  const backendConfig = getProviderBackendConfig(providerKey);
  if (!backendConfig) return null;
  return findModelLimit(backendConfig.models, modelId) ?? firstTokenLimit(backendConfig as ModelLimitCandidate);
}

export async function resolveContextWindow(modelRef: string | null | undefined): Promise<ContextWindowResolution> {
  const { providers, defaultModel } = await getOpenClawProvidersConfig();
  const configuredModelRef = await resolveConfiguredModelRefFallback();
  const effectiveModelRef = (modelRef ?? defaultModel ?? configuredModelRef ?? '').trim();
  const parsed = splitModelRef(effectiveModelRef);
  if (!parsed) {
    return { modelRef: effectiveModelRef || null, maxTokens: null, source: 'unavailable' };
  }

  const providerEntry = providers[parsed.providerKey];
  if (providerEntry && typeof providerEntry === 'object') {
    const modelLimit = findModelLimit(providerEntry.models, parsed.modelId);
    if (modelLimit !== null) {
      return { modelRef: effectiveModelRef, maxTokens: modelLimit, source: 'openclaw-model' };
    }
    const providerLimit = firstTokenLimit(providerEntry as ModelLimitCandidate);
    if (providerLimit !== null) {
      return { modelRef: effectiveModelRef, maxTokens: providerLimit, source: 'openclaw-provider' };
    }
  }

  const registryLimit = resolveFromProviderRegistry(parsed.providerKey, parsed.modelId);
  if (registryLimit !== null) {
    return { modelRef: effectiveModelRef, maxTokens: registryLimit, source: 'provider-registry' };
  }

  return { modelRef: effectiveModelRef, maxTokens: null, source: 'unavailable' };
}
