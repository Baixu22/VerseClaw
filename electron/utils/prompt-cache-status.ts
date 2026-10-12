import type {
  PromptCacheConfidence,
  PromptCacheProviderStrategy,
  PromptCacheRiskAction,
  PromptCacheRiskAssessment,
  PromptCacheRiskDecisionEvent,
  PromptCacheRiskEvent,
  PromptCacheRiskObservation,
  PromptCacheRiskSeverity,
  PromptCacheStatus,
} from '@shared/types/workspace';
import type { TokenUsageSummary } from './token-usage-core';

const MIN_CACHE_ELIGIBLE_PROMPT_TOKENS = 1_024;
const UNKNOWN_RISK_PROMPT_TOKENS = 8_000;
const HIGH_RISK_PROMPT_TOKENS = 32_000;
const HIGH_RISK_CACHE_TOKENS = 8_000;

export type PromptCacheStatusInput = {
  summary: TokenUsageSummary;
  modelRef?: string | null;
  action?: PromptCacheRiskAction;
  targetModelRef?: string | null;
  usedTokens?: number | null;
  ledger?: PromptCacheRiskEvent[];
  now?: number;
};

function clampCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function parseProvider(modelRef?: string | null): string | null {
  const trimmed = modelRef?.trim();
  if (!trimmed) return null;
  const slashIndex = trimmed.indexOf('/');
  const colonIndex = trimmed.indexOf(':');
  const splitIndex = slashIndex > 0
    ? slashIndex
    : colonIndex > 0
      ? colonIndex
      : -1;
  return splitIndex > 0 ? trimmed.slice(0, splitIndex).toLowerCase() : null;
}

function resolveProviderStrategy(modelRef?: string | null): {
  providerStrategy: PromptCacheProviderStrategy;
  confidence: PromptCacheConfidence;
} {
  const provider = parseProvider(modelRef);
  const normalizedModelRef = modelRef?.toLowerCase() ?? '';
  if (!provider) {
    return { providerStrategy: 'unknown', confidence: 'unknown' };
  }
  if (provider.includes('anthropic') || provider.includes('claude') || normalizedModelRef.includes('claude')) {
    return { providerStrategy: 'anthropic', confidence: 'high' };
  }
  if (provider.includes('google') || provider.includes('gemini') || normalizedModelRef.includes('gemini')) {
    return { providerStrategy: 'gemini', confidence: 'medium' };
  }
  if (provider.includes('bedrock') || provider.includes('aws')) {
    return { providerStrategy: 'bedrock', confidence: 'medium' };
  }
  if (provider === 'openai' || provider.includes('openai')) {
    return { providerStrategy: 'openai-native', confidence: 'low' };
  }
  if (
    provider.includes('openrouter')
    || provider.includes('deepseek')
    || provider.includes('deepinfra')
    || provider.includes('litellm')
    || provider.includes('mistral')
    || provider.includes('custom')
    || provider.includes('ollama')
    || provider.includes('self')
  ) {
    return { providerStrategy: 'openai-compatible', confidence: 'unknown' };
  }
  return { providerStrategy: 'generic', confidence: 'unknown' };
}

function isDeepSeekModelRef(modelRef?: string | null): boolean {
  return (modelRef?.toLowerCase() ?? '').includes('deepseek');
}

function isCacheCapableStrategy(strategy: PromptCacheProviderStrategy): boolean {
  return strategy === 'anthropic'
    || strategy === 'gemini'
    || strategy === 'bedrock'
    || strategy === 'openai-native';
}

function resolveHealthStatus(params: {
  promptTokens: number;
  usagePromptTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  providerStrategy: PromptCacheProviderStrategy;
}): PromptCacheStatus {
  if (params.cacheReadTokens > 0) {
    return 'warm';
  }
  if (params.cacheWriteTokens > 0) {
    return 'warming';
  }
  if (params.usagePromptTokens <= 0 && params.promptTokens <= 0) {
    return 'unknown';
  }
  if (params.promptTokens < MIN_CACHE_ELIGIBLE_PROMPT_TOKENS) {
    return 'ineligible';
  }
  if (isCacheCapableStrategy(params.providerStrategy)) {
    return 'cold';
  }
  return 'unknown';
}

function resolveRiskSeverity(params: {
  action?: PromptCacheRiskAction;
  modelRef?: string | null;
  targetModelRef?: string | null;
  promptTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  status: PromptCacheStatus;
  providerStrategy: PromptCacheProviderStrategy;
}): PromptCacheRiskSeverity {
  if (!params.action) return 'none';
  if (
    params.action === 'model-switch'
    && params.targetModelRef
    && params.modelRef
    && params.targetModelRef.trim() === params.modelRef.trim()
  ) {
    return 'none';
  }
  if (params.status === 'ineligible') return 'low';
  const cacheTokens = params.cacheReadTokens + params.cacheWriteTokens;
  if (cacheTokens > 0) {
    return params.promptTokens >= HIGH_RISK_PROMPT_TOKENS || cacheTokens >= HIGH_RISK_CACHE_TOKENS
      ? 'high'
      : 'medium';
  }
  if (isCacheCapableStrategy(params.providerStrategy) && params.promptTokens >= UNKNOWN_RISK_PROMPT_TOKENS) {
    return 'medium';
  }
  if (!isCacheCapableStrategy(params.providerStrategy) && params.promptTokens >= UNKNOWN_RISK_PROMPT_TOKENS) {
    return 'unknown';
  }
  return 'low';
}

function shouldWarn(severity: PromptCacheRiskSeverity, promptTokens: number): boolean {
  return severity === 'medium'
    || severity === 'high'
    || (severity === 'unknown' && promptTokens >= UNKNOWN_RISK_PROMPT_TOKENS);
}

function reasonFor(params: {
  action?: PromptCacheRiskAction;
  severity: PromptCacheRiskSeverity;
  status: PromptCacheStatus;
  providerStrategy: PromptCacheProviderStrategy;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}): string | undefined {
  if (params.action && params.severity !== 'none' && params.severity !== 'low') {
    return params.action;
  }
  if (params.status === 'ineligible') {
    return 'ineligible';
  }
  if (params.cacheReadTokens > 0 || params.cacheWriteTokens > 0) {
    return undefined;
  }
  if (params.providerStrategy === 'unknown' || params.providerStrategy === 'openai-compatible' || params.providerStrategy === 'generic') {
    return 'provider-unknown';
  }
  return undefined;
}

export function assessPromptCacheStatus(input: PromptCacheStatusInput): PromptCacheRiskAssessment {
  const cacheReadTokens = clampCount(input.summary.cacheReadTokens);
  const cacheWriteTokens = clampCount(input.summary.cacheWriteTokens);
  const inputTokens = clampCount(input.summary.inputTokens);
  const usagePromptTokens = inputTokens + cacheReadTokens + cacheWriteTokens;
  const explicitUsedTokens = typeof input.usedTokens === 'number' && Number.isFinite(input.usedTokens)
    ? clampCount(input.usedTokens)
    : 0;
  const promptTokens = Math.max(usagePromptTokens, explicitUsedTokens);
  const hitRate = usagePromptTokens > 0 ? cacheReadTokens / usagePromptTokens : null;
  const { providerStrategy, confidence: baseConfidence } = resolveProviderStrategy(input.modelRef);
  const confidence =
    providerStrategy === 'openai-compatible'
    && isDeepSeekModelRef(input.modelRef)
    && (cacheReadTokens > 0 || clampCount(input.summary.lastTurnCacheReadTokens) > 0)
      ? 'medium'
      : baseConfidence;
  const baseStatus = resolveHealthStatus({
    promptTokens,
    usagePromptTokens,
    cacheReadTokens,
    cacheWriteTokens,
    providerStrategy,
  });
  const severity = resolveRiskSeverity({
    action: input.action,
    modelRef: input.modelRef,
    targetModelRef: input.targetModelRef,
    promptTokens,
    cacheReadTokens,
    cacheWriteTokens,
    status: baseStatus,
    providerStrategy,
  });
  const warn = shouldWarn(severity, promptTokens);
  const sessionKey = input.summary.agentId ? `agent:${input.summary.agentId}:${input.summary.sessionId}` : input.summary.sessionId;
  const sessionEntries = (input.ledger ?? [])
    .filter((event) => event.sessionKey === sessionKey || event.sessionKey === input.summary.sessionId);
  // Warning counts and the last-risk event describe explicit, confirmed
  // decisions only. Observed breaks are agent evidence, not user actions, and
  // must never inflate the UI warning surface.
  const sessionDecisions = sessionEntries.filter(
    (event): event is PromptCacheRiskDecisionEvent => event.source !== 'observed',
  );
  const lastRiskEvent = sessionDecisions.toSorted((left, right) => right.updatedAt - left.updatedAt)[0];
  const lastObservedBreak = sessionEntries
    .filter((event): event is PromptCacheRiskObservation => event.source === 'observed')
    .toSorted((left, right) => right.updatedAt - left.updatedAt)[0];

  return {
    sessionKey,
    ...(input.action ? { action: input.action } : {}),
    status: warn ? 'at-risk' : baseStatus,
    severity,
    shouldWarn: warn,
    confidence,
    providerStrategy,
    hitRate,
    promptTokens,
    cacheReadTokens,
    cacheWriteTokens,
    lastTurnHitRate: input.summary.lastTurnHitRate,
    warmTurnHitRate: input.summary.warmTurnHitRate,
    lastTurnCacheReadTokens: input.summary.lastTurnCacheReadTokens,
    lastTurnCacheMissTokens: input.summary.lastTurnCacheMissTokens,
    costEstimateReliable: false,
    reason: reasonFor({
      action: input.action,
      severity,
      status: baseStatus,
      providerStrategy,
      cacheReadTokens,
      cacheWriteTokens,
    }),
    warningCount: sessionDecisions.length,
    cancelledBreakCount: sessionDecisions.filter((event) => event.decision === 'cancelled').length,
    ...(lastRiskEvent ? { lastRiskEvent } : {}),
    ...(lastObservedBreak ? { lastObservedBreak } : {}),
    updatedAt: input.now ?? Date.now(),
  };
}
