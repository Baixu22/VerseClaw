import { computeCacheHitRate as hitRateForUsage, isHiddenUsageSource, promptTokensForUsage } from '@shared/types/usage';
import type { UsageAggregateDayBucket, UsageAggregateDimension, UsageAggregateSummary, UsageAggregateWindow } from '@shared/host-api/contract';

export interface TokenUsageHistoryEntry {
  timestamp: string;
  sessionId: string;
  agentId: string;
  model?: string;
  provider?: string;
  content?: string;
  usageStatus: 'available' | 'missing' | 'error';
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  costUsd?: number;
}

export interface ParsedSessionKey {
  agentId: string;
  sessionId: string;
}

export interface TokenUsageSummary {
  sessionId: string;
  agentId: string;
  usageStatus: 'available' | 'missing' | 'error';
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  estimatedCostUsd?: number;
  latestTimestamp?: string;
  lastTurnHitRate: number | null;
  warmTurnHitRate: number | null;
  lastTurnCacheReadTokens: number;
  lastTurnCacheMissTokens: number;
  lastTurnCacheWriteTokens: number;
  lastTurnPromptTokens: number;
  warmTurnPromptTokens: number;
  warmTurnCacheReadTokens: number;
  warmTurnCacheMissTokens: number;
  entryCount: number;
  missingEntryCount: number;
  errorEntryCount: number;
}

export function extractSessionIdFromTranscriptFileName(fileName: string): string | undefined {
  if (!fileName.endsWith('.jsonl') && !fileName.includes('.jsonl.reset.')) return undefined;
  return fileName
    .replace(/\.reset\..+$/, '')
    .replace(/\.deleted\.jsonl$/, '')
    .replace(/\.jsonl$/, '');
}

export function parseOpenClawSessionKey(sessionKey: string): ParsedSessionKey {
  const trimmed = sessionKey.trim();
  if (trimmed.startsWith('agent:')) {
    const parts = trimmed.split(':');
    const agentId = parts[1]?.trim() || 'main';
    const sessionId = parts.slice(2).join(':').trim() || 'main';
    return { agentId, sessionId };
  }
  return { agentId: 'main', sessionId: trimmed || 'main' };
}

interface TranscriptUsageShape {
  [key: string]: unknown;
  input?: number;
  output?: number;
  total?: number;
  cacheRead?: number;
  cacheWrite?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  cache_read?: number;
  cache_write?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
  inputTokenCount?: number;
  input_token_count?: number;
  outputTokenCount?: number;
  output_token_count?: number;
  promptTokenCount?: number;
  prompt_token_count?: number;
  completionTokenCount?: number;
  completion_token_count?: number;
  totalTokenCount?: number;
  total_token_count?: number;
  cacheReadTokenCount?: number;
  cacheReadTokens?: number;
  cache_write_token_count?: number;
  cached_tokens?: number;
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
  input_tokens_details?: {
    cached_tokens?: number;
  };
  prompt_tokens_details?: {
    cached_tokens?: number;
  };
  cost?: {
    total?: number;
  };
}

type UsageRecordStatus = 'available' | 'missing' | 'error';

interface ParsedUsageTokens {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  costUsd?: number;
  usageStatus: UsageRecordStatus;
}

function normalizeUsageNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return undefined;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function firstUsageNumber(usage: TranscriptUsageShape | undefined, candidates: string[]): number | undefined {
  if (!usage) return undefined;
  for (const key of candidates) {
    const value = usage[key];
    const parsed = normalizeUsageNumber(value);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

function nestedCachedTokens(usage: TranscriptUsageShape): number | undefined {
  return normalizeUsageNumber(usage.input_tokens_details?.cached_tokens)
    ?? normalizeUsageNumber(usage.prompt_tokens_details?.cached_tokens);
}

function parseUsageFromShape(usage: unknown): ParsedUsageTokens | undefined {
  if (usage === undefined) {
    return undefined;
  }

  if (usage === null || typeof usage !== 'object' || Array.isArray(usage)) {
    return {
      usageStatus: 'error',
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
    };
  }

  const usageShape = usage as TranscriptUsageShape;

  const cacheReadTokens = firstUsageNumber(usageShape, [
    'cacheRead',
    'cache_read',
    'cacheReadTokens',
    'cache_read_tokens',
    'cacheReadTokenCount',
    'cache_read_token_count',
    'prompt_cache_hit_tokens',
    'cached_tokens',
  ]) ?? nestedCachedTokens(usageShape);
  const explicitCacheMissTokens = firstUsageNumber(usageShape, [
    'prompt_cache_miss_tokens',
  ]);
  const rawInputTokens = firstUsageNumber(usageShape, [
    'input',
    'promptTokens',
    'prompt_tokens',
    'input_tokens',
    'inputTokenCount',
    'input_token_count',
    'promptTokenCount',
    'prompt_token_count',
  ]);
  const usesOpenAiStylePromptTotals =
    explicitCacheMissTokens === undefined
    && cacheReadTokens !== undefined
    && (
      usageShape.prompt_cache_hit_tokens !== undefined
      || usageShape.cached_tokens !== undefined
      || usageShape.input_tokens_details?.cached_tokens !== undefined
      || usageShape.prompt_tokens_details?.cached_tokens !== undefined
    );
  const inputTokens = explicitCacheMissTokens ?? (
    rawInputTokens !== undefined && usesOpenAiStylePromptTotals
      ? rawInputTokens - cacheReadTokens
      : rawInputTokens
  );
  const outputTokens = firstUsageNumber(usageShape, [
    'output',
    'completionTokens',
    'completion_tokens',
    'output_tokens',
    'outputTokenCount',
    'output_token_count',
    'completionTokenCount',
    'completion_token_count',
  ]);
  const cacheWriteTokens = firstUsageNumber(usageShape, [
    'cacheWrite',
    'cache_write',
    'cacheWriteTokens',
    'cache_write_tokens',
    'cacheWriteTokenCount',
    'cache_write_token_count',
  ]);
  const explicitTotalTokens = firstUsageNumber(usageShape, [
    'total',
    'totalTokens',
    'total_tokens',
    'totalTokenCount',
    'total_token_count',
  ]);

  const hasUsageValue =
    inputTokens !== undefined
    || outputTokens !== undefined
    || cacheReadTokens !== undefined
    || cacheWriteTokens !== undefined
    || explicitTotalTokens !== undefined
    || normalizeUsageNumber(usageShape.cost?.total) !== undefined;

  if (!hasUsageValue) {
    return {
      usageStatus: 'missing',
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
    };
  }

  const totalTokens = explicitTotalTokens ?? (
    (inputTokens ?? 0)
      + (outputTokens ?? 0)
      + (cacheReadTokens ?? 0)
      + (cacheWriteTokens ?? 0)
  );

  return {
    usageStatus: 'available',
    inputTokens: inputTokens ?? 0,
    outputTokens: outputTokens ?? 0,
    cacheReadTokens: cacheReadTokens ?? 0,
    cacheWriteTokens: cacheWriteTokens ?? 0,
    totalTokens,
    costUsd: normalizeUsageNumber(usageShape.cost?.total),
  };
}

interface TranscriptLineShape {
  type?: string;
  timestamp?: string;
  message?: {
    role?: string;
    model?: string;
    modelRef?: string;
    provider?: string;
    usage?: TranscriptUsageShape;
    details?: {
      provider?: string;
      model?: string;
      usage?: TranscriptUsageShape;
      content?: unknown;
      externalContent?: {
        provider?: string;
      };
    };
  };
}

function normalizeUsageContent(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  if (Array.isArray(value)) {
    const chunks = value
      .map((item) => normalizeUsageContent(item))
      .filter((item): item is string => Boolean(item));
    if (chunks.length === 0) return undefined;
    return chunks.join('\n\n');
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.text === 'string') {
      const trimmed = record.text.trim();
      if (trimmed.length > 0) return trimmed;
    }
    if (typeof record.content === 'string') {
      const trimmed = record.content.trim();
      if (trimmed.length > 0) return trimmed;
    }
    if (Array.isArray(record.content)) {
      return normalizeUsageContent(record.content);
    }
    if (typeof record.thinking === 'string') {
      const trimmed = record.thinking.trim();
      if (trimmed.length > 0) return trimmed;
    }
    try {
      return JSON.stringify(record, null, 2);
    } catch {
      return undefined;
    }
  }

  return undefined;
}

export function parseUsageEntriesFromJsonl(
  content: string,
  context: { sessionId: string; agentId: string },
  limit?: number,
): TokenUsageHistoryEntry[] {
  const entries: TokenUsageHistoryEntry[] = [];
  const lines = content.split(/\r?\n/).filter(Boolean);
  const maxEntries = typeof limit === 'number' && Number.isFinite(limit)
    ? Math.max(Math.floor(limit), 0)
    : Number.POSITIVE_INFINITY;

  for (let i = lines.length - 1; i >= 0 && entries.length < maxEntries; i -= 1) {
    let parsed: TranscriptLineShape;
    try {
      parsed = JSON.parse(lines[i]) as TranscriptLineShape;
    } catch {
      continue;
    }

    const message = parsed.message;
    if (!message || !parsed.timestamp) {
      continue;
    }

    if (message.role === 'assistant' && 'usage' in message) {
      const usage = parseUsageFromShape(message.usage);
      if (!usage) continue;

      const contentText = normalizeUsageContent((message as Record<string, unknown>).content);
      entries.push({
        timestamp: parsed.timestamp,
        sessionId: context.sessionId,
        agentId: context.agentId,
        model: message.model ?? message.modelRef,
        provider: message.provider,
        ...(contentText ? { content: contentText } : {}),
        ...usage,
      });
      continue;
    }

    if (message.role !== 'toolResult') {
      continue;
    }

    const details = message.details;
    if (!details || !('usage' in details)) {
      continue;
    }

    const usage = parseUsageFromShape(details.usage);
    if (!usage) continue;

    const provider = details.provider ?? details.externalContent?.provider ?? message.provider;
    const model = details.model ?? message.model ?? message.modelRef;
    const contentText = normalizeUsageContent(details.content)
      ?? normalizeUsageContent((message as Record<string, unknown>).content);

    entries.push({
      timestamp: parsed.timestamp,
      sessionId: context.sessionId,
      agentId: context.agentId,
      model,
      provider,
      ...(contentText ? { content: contentText } : {}),
      ...usage,
    });
  }

  return entries;
}

export function summarizeUsageEntries(
  entries: TokenUsageHistoryEntry[],
  context: { sessionId: string; agentId: string },
): TokenUsageSummary {
  const summary: TokenUsageSummary = {
    sessionId: context.sessionId,
    agentId: context.agentId,
    usageStatus: 'missing',
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    lastTurnHitRate: null,
    warmTurnHitRate: null,
    lastTurnCacheReadTokens: 0,
    lastTurnCacheMissTokens: 0,
    lastTurnCacheWriteTokens: 0,
    lastTurnPromptTokens: 0,
    warmTurnPromptTokens: 0,
    warmTurnCacheReadTokens: 0,
    warmTurnCacheMissTokens: 0,
    entryCount: entries.length,
    missingEntryCount: 0,
    errorEntryCount: 0,
  };

  for (const entry of entries) {
    if (!summary.latestTimestamp || Date.parse(entry.timestamp) > Date.parse(summary.latestTimestamp)) {
      summary.latestTimestamp = entry.timestamp;
    }
    if (entry.usageStatus === 'missing') {
      summary.missingEntryCount += 1;
      continue;
    }
    if (entry.usageStatus === 'error') {
      summary.errorEntryCount += 1;
      continue;
    }
    summary.inputTokens += entry.inputTokens;
    summary.outputTokens += entry.outputTokens;
    summary.cacheReadTokens += entry.cacheReadTokens;
    summary.cacheWriteTokens += entry.cacheWriteTokens;
    summary.totalTokens += entry.totalTokens;
    if (entry.costUsd !== undefined) {
      summary.estimatedCostUsd = (summary.estimatedCostUsd ?? 0) + entry.costUsd;
    }
  }

  if (entries.some((entry) => entry.usageStatus === 'available')) {
    summary.usageStatus = 'available';
  } else if (summary.errorEntryCount > 0) {
    summary.usageStatus = 'error';
  }

  const availableEntries = entries
    .filter((entry) => entry.usageStatus === 'available')
    .toSorted((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
  const lastTurn = availableEntries.at(-1);
  if (lastTurn) {
    summary.lastTurnCacheReadTokens = lastTurn.cacheReadTokens;
    summary.lastTurnCacheMissTokens = lastTurn.inputTokens;
    summary.lastTurnCacheWriteTokens = lastTurn.cacheWriteTokens;
    summary.lastTurnPromptTokens = promptTokensForUsage(lastTurn);
    summary.lastTurnHitRate = hitRateForUsage(lastTurn);
  }

  for (const entry of availableEntries.slice(1)) {
    summary.warmTurnPromptTokens += promptTokensForUsage(entry);
    summary.warmTurnCacheReadTokens += entry.cacheReadTokens;
    summary.warmTurnCacheMissTokens += entry.inputTokens;
  }
  summary.warmTurnHitRate = summary.warmTurnPromptTokens > 0
    ? summary.warmTurnCacheReadTokens / summary.warmTurnPromptTokens
    : null;

  return summary;
}

function localDayKey(timestamp: string): string | null {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const USAGE_AGGREGATE_WINDOWS = new Set<UsageAggregateWindow>(['7d', '30d', 'all']);
const USAGE_AGGREGATE_DEFAULT_WINDOW: UsageAggregateWindow = '30d';
const USAGE_AGGREGATE_MODEL_CAP = 12;

export function normalizeUsageAggregateWindow(value: unknown): UsageAggregateWindow {
  if (typeof value === 'string' && USAGE_AGGREGATE_WINDOWS.has(value as UsageAggregateWindow)) {
    return value as UsageAggregateWindow;
  }
  return USAGE_AGGREGATE_DEFAULT_WINDOW;
}

function emptyUsageAggregateDimension(key: string, label: string): UsageAggregateDimension {
  return {
    key,
    label,
    records: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    costUsd: 0,
    promptTokens: 0,
    cacheHitRate: null,
  };
}

function isBillableUsageEntry(entry: TokenUsageHistoryEntry): boolean {
  return entry.usageStatus === 'available' && entry.totalTokens > 0;
}

function foldUsageIntoDimension(dimension: UsageAggregateDimension, entry: TokenUsageHistoryEntry): void {
  dimension.records += 1;
  dimension.inputTokens += entry.inputTokens;
  dimension.outputTokens += entry.outputTokens;
  dimension.cacheReadTokens += entry.cacheReadTokens;
  dimension.cacheWriteTokens += entry.cacheWriteTokens;
  dimension.totalTokens += entry.totalTokens;
  dimension.costUsd += typeof entry.costUsd === 'number' && Number.isFinite(entry.costUsd) ? entry.costUsd : 0;
  dimension.promptTokens += promptTokensForUsage(entry);
}

/**
 * Aggregate every scanned usage entry into window-scoped totals, stable
 * per-day buckets, and per-model / per-agent dimensions — with no entry
 * cap, so the "All" window reflects complete local history rather than
 * just the recent-records list.
 */
export function aggregateUsageEntries(
  entries: TokenUsageHistoryEntry[],
  window: UsageAggregateWindow,
  options: { now?: number; scannedFiles?: number } = {},
): UsageAggregateSummary {
  const now = typeof options.now === 'number' && Number.isFinite(options.now) ? options.now : Date.now();
  const normalizedWindow = normalizeUsageAggregateWindow(window);

  const inWindowEntries = normalizedWindow === 'all'
    ? entries
    : (() => {
      const days = normalizedWindow === '7d' ? 7 : 30;
      const cutoff = now - days * 24 * 60 * 60 * 1000;
      return entries.filter((entry) => {
        const timestamp = Date.parse(entry.timestamp);
        return Number.isFinite(timestamp) && timestamp >= cutoff;
      });
    })();

  const visibleEntries = inWindowEntries.filter((entry) => (
    !isHiddenUsageSource(entry.provider) && !isHiddenUsageSource(entry.model)
  ));

  const dayBuckets = new Map<string, UsageAggregateDayBucket>();
  if (normalizedWindow !== 'all') {
    const dayCount = normalizedWindow === '7d' ? 7 : 30;
    for (let index = dayCount - 1; index >= 0; index -= 1) {
      const date = new Date(now);
      date.setDate(date.getDate() - index);
      const key = localDayKey(date.toISOString());
      if (key) {
        dayBuckets.set(key, { ...emptyUsageAggregateDimension(key, key), date: key });
      }
    }
  }

  const models = new Map<string, UsageAggregateDimension>();
  const agents = new Map<string, UsageAggregateDimension>();

  const totals: UsageAggregateDimension = emptyUsageAggregateDimension('totals', 'totals');
  let billableEntries = 0;
  let missingEntries = 0;
  let errorEntries = 0;
  let earliestTimestamp: string | null = null;
  let latestTimestamp: string | null = null;

  for (const entry of visibleEntries) {
    if (entry.usageStatus === 'missing') {
      missingEntries += 1;
      continue;
    }
    if (entry.usageStatus === 'error') {
      errorEntries += 1;
      continue;
    }

    const timestampMs = Date.parse(entry.timestamp);
    if (Number.isFinite(timestampMs)) {
      if (earliestTimestamp === null || timestampMs < Date.parse(earliestTimestamp)) {
        earliestTimestamp = entry.timestamp;
      }
      if (latestTimestamp === null || timestampMs > Date.parse(latestTimestamp)) {
        latestTimestamp = entry.timestamp;
      }
    }

    if (!isBillableUsageEntry(entry)) continue;
    billableEntries += 1;
    foldUsageIntoDimension(totals, entry);

    const dayKey = localDayKey(entry.timestamp);
    if (dayKey) {
      if (!dayBuckets.has(dayKey)) {
        dayBuckets.set(dayKey, { ...emptyUsageAggregateDimension(dayKey, dayKey), date: dayKey });
      }
      foldUsageIntoDimension(dayBuckets.get(dayKey)!, entry);
    }

    const modelLabel = entry.model?.trim() || 'Unknown';
    if (!models.has(modelLabel)) {
      models.set(modelLabel, emptyUsageAggregateDimension(modelLabel, modelLabel));
    }
    foldUsageIntoDimension(models.get(modelLabel)!, entry);

    const agentLabel = entry.agentId?.trim() || 'Unknown';
    if (!agents.has(agentLabel)) {
      agents.set(agentLabel, emptyUsageAggregateDimension(agentLabel, agentLabel));
    }
    foldUsageIntoDimension(agents.get(agentLabel)!, entry);
  }

  const finalizeDimension = <T extends UsageAggregateDimension>(dimension: T): T => ({
    ...dimension,
    cacheHitRate: dimension.promptTokens > 0 ? dimension.cacheReadTokens / dimension.promptTokens : null,
  });

  const sortDimensionsByTokens = (dimensions: UsageAggregateDimension[]): UsageAggregateDimension[] => (
    dimensions
      .sort((left, right) => right.totalTokens - left.totalTokens || left.label.localeCompare(right.label))
  );

  const days = Array.from(dayBuckets.values())
    .map(finalizeDimension)
    .sort((left, right) => left.date.localeCompare(right.date));

  const finalizedTotals = finalizeDimension(totals);

  return {
    window: normalizedWindow,
    generatedAt: now,
    scannedFiles: typeof options.scannedFiles === 'number' ? Math.max(0, Math.floor(options.scannedFiles)) : 0,
    scannedEntries: entries.length,
    entriesInWindow: visibleEntries.length,
    billableEntries,
    missingEntries,
    errorEntries,
    inputTokens: finalizedTotals.inputTokens,
    outputTokens: finalizedTotals.outputTokens,
    cacheReadTokens: finalizedTotals.cacheReadTokens,
    cacheWriteTokens: finalizedTotals.cacheWriteTokens,
    totalTokens: finalizedTotals.totalTokens,
    costUsd: finalizedTotals.costUsd,
    promptTokens: finalizedTotals.promptTokens,
    cacheHitRate: finalizedTotals.cacheHitRate,
    earliestTimestamp,
    latestTimestamp,
    days,
    models: sortDimensionsByTokens(Array.from(models.values()).map(finalizeDimension)).slice(0, USAGE_AGGREGATE_MODEL_CAP),
    agents: sortDimensionsByTokens(Array.from(agents.values()).map(finalizeDimension)),
  };
}
