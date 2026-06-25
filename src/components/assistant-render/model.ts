import type { RawMessage } from '@/stores/chat';
import type { LiveTokenUsage, WorkspaceContextRange, WorkspacePermissionMode } from '@shared/types/workspace';

export type AssistantBranch = {
  id: string;
  label: string;
  text: string;
};

export type AssistantReasoning = {
  id: string;
  title?: string;
  summary: string;
};

export type AssistantToolFallback = {
  id: string;
  name: string;
  status: 'running' | 'completed' | 'error';
  summary?: string;
  durationMs?: number;
};

export type AssistantStatusDimension = {
  id: string;
  label: string;
  state: 'idle' | 'active' | 'ok' | 'warning' | 'error';
};

export type AssistantUsageModel = {
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  totalTokens: number;
  maxTokens?: number | null;
  estimatedCostUsd?: number;
  status: 'idle' | 'streaming' | 'final' | 'unavailable';
};

type RecordLike = Record<string, unknown>;

function isRecord(value: unknown): value is RecordLike {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function getMeta(message: RawMessage): RecordLike {
  const record = message as unknown as RecordLike;
  const meta = record.metadata ?? record.meta ?? record.assistantRender;
  if (isRecord(meta)) return meta;
  if (Array.isArray(message.content)) {
    for (const block of message.content) {
      if (!isRecord(block)) continue;
      const blockMeta = block.assistantRender ?? block.metadata ?? block.meta;
      if (isRecord(blockMeta)) return blockMeta;
    }
  }
  return {};
}

function normalizeBranch(candidate: unknown, index: number): AssistantBranch | null {
  if (typeof candidate === 'string') {
    return { id: `branch-${index + 1}`, label: `Branch ${index + 1}`, text: candidate };
  }
  if (!isRecord(candidate)) return null;
  const text = asString(candidate.text ?? candidate.content ?? candidate.message);
  if (!text) return null;
  return {
    id: asString(candidate.id) ?? `branch-${index + 1}`,
    label: asString(candidate.label ?? candidate.title) ?? `Branch ${index + 1}`,
    text,
  };
}

export function extractAssistantBranches(message: RawMessage): AssistantBranch[] {
  const meta = getMeta(message);
  const record = message as unknown as RecordLike;
  const source = meta.branches ?? meta.alternatives ?? record.branches ?? record.alternatives;
  if (!Array.isArray(source)) return [];
  return source
    .map((entry, index) => normalizeBranch(entry, index))
    .filter((entry): entry is AssistantBranch => entry != null);
}

export function extractAssistantReasoning(message: RawMessage): AssistantReasoning[] {
  const meta = getMeta(message);
  const record = message as unknown as RecordLike;
  const source = meta.reasoning ?? meta.thinkingSummary ?? record.reasoningSummary;
  const values = Array.isArray(source) ? source : source ? [source] : [];
  return values
    .map((entry, index): AssistantReasoning | null => {
      if (typeof entry === 'string') {
        return { id: `reasoning-${index + 1}`, summary: entry };
      }
      if (!isRecord(entry)) return null;
      const summary = asString(entry.summary ?? entry.text ?? entry.content);
      if (!summary) return null;
      return {
        id: asString(entry.id) ?? `reasoning-${index + 1}`,
        title: asString(entry.title) ?? undefined,
        summary,
      };
    })
    .filter((entry): entry is AssistantReasoning => entry != null);
}

export function extractAssistantToolFallbacks(message: RawMessage): AssistantToolFallback[] {
  const meta = getMeta(message);
  const record = message as unknown as RecordLike;
  const source = meta.toolFallbacks ?? meta.tools ?? record.toolFallbacks;
  if (!Array.isArray(source)) return [];
  return source
    .map((entry, index): AssistantToolFallback | null => {
      if (!isRecord(entry)) return null;
      const name = asString(entry.name ?? entry.toolName ?? entry.tool);
      if (!name) return null;
      const rawStatus = asString(entry.status);
      const status = rawStatus === 'running' || rawStatus === 'error' || rawStatus === 'completed'
        ? rawStatus
        : 'completed';
      return {
        id: asString(entry.id ?? entry.toolCallId) ?? `tool-${index + 1}`,
        name,
        status,
        summary: asString(entry.summary ?? entry.result ?? entry.error ?? entry.input) ?? undefined,
        durationMs: asNumber(entry.durationMs),
      };
    })
    .filter((entry): entry is AssistantToolFallback => entry != null);
}

export function buildUsageModel(
  liveUsage: LiveTokenUsage | null,
  contextRange: WorkspaceContextRange | null,
): AssistantUsageModel {
  const inputTokens = liveUsage?.inputTokens ?? 0;
  const outputTokens = liveUsage?.outputTokens ?? 0;
  const cacheTokens = (liveUsage?.cacheReadTokens ?? 0) + (liveUsage?.cacheWriteTokens ?? 0);
  const totalTokens = liveUsage?.totalTokens ?? contextRange?.usedTokens ?? 0;
  return {
    inputTokens,
    outputTokens,
    cacheTokens,
    totalTokens,
    maxTokens: contextRange?.maxTokens ?? null,
    estimatedCostUsd: liveUsage?.estimatedCostUsd,
    status: liveUsage?.status ?? (contextRange?.status === 'unavailable' ? 'unavailable' : 'idle'),
  };
}

export function buildStatusDimensions(input: {
  gatewayState: string;
  sending: boolean;
  pendingFinal: boolean;
  activeRunId?: string | null;
  streamingToolCount: number;
  contextRange: WorkspaceContextRange | null;
  workspaceName?: string | null;
  permissionMode?: WorkspacePermissionMode | null;
}): AssistantStatusDimension[] {
  const contextRatio = input.contextRange?.maxTokens
    ? (input.contextRange.usedTokens ?? 0) / input.contextRange.maxTokens
    : 0;
  return [
    {
      id: 'gateway',
      label: 'gateway',
      state: input.gatewayState === 'running' ? 'ok' : input.gatewayState === 'error' ? 'error' : 'warning',
    },
    {
      id: 'run',
      label: 'run',
      state: input.sending || input.pendingFinal || input.activeRunId ? 'active' : 'idle',
    },
    {
      id: 'tools',
      label: 'tools',
      state: input.streamingToolCount > 0 ? 'active' : 'idle',
    },
    {
      id: 'context',
      label: 'context',
      state: contextRatio > 0.85 ? 'warning' : input.contextRange?.status === 'unavailable' ? 'warning' : 'ok',
    },
    {
      id: 'workspace',
      label: 'workspace',
      state: input.workspaceName ? 'ok' : 'warning',
    },
    {
      id: 'permission',
      label: input.permissionMode ?? 'permission',
      state: input.permissionMode === 'readOnly' || input.permissionMode === 'plan' ? 'warning' : 'ok',
    },
  ];
}

export function buildHeatGraphDays(entries: Array<{ timestamp: string; totalTokens?: number }>, dayCount = 35): Array<{
  date: string;
  count: number;
  tokens: number;
}> {
  const now = new Date();
  const days = new Map<string, { date: string; count: number; tokens: number }>();
  for (let index = dayCount - 1; index >= 0; index -= 1) {
    const date = new Date(now);
    date.setDate(now.getDate() - index);
    const key = date.toISOString().slice(0, 10);
    days.set(key, { date: key, count: 0, tokens: 0 });
  }
  for (const entry of entries) {
    const date = new Date(entry.timestamp);
    if (Number.isNaN(date.getTime())) continue;
    const key = date.toISOString().slice(0, 10);
    const bucket = days.get(key);
    if (!bucket) continue;
    bucket.count += 1;
    bucket.tokens += entry.totalTokens ?? 0;
  }
  return Array.from(days.values());
}

/**
 * Extracts per-message token usage from a RawMessage's metadata/details.
 *
 * The Gateway attaches `usage` to the final event (not inside the message),
 * but the runtime may also embed it in `message.details` or `message.metadata`.
 * This function tries every known location and returns a normalized shape.
 *
 * Returns `null` when no usage data is found — the caller should then fall
 * back to the session-level `liveUsage` for the streaming case.
 */
export function extractMessageUsage(message: RawMessage): {
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  totalTokens: number;
  estimatedCostUsd?: number;
} | null {
  const record = message as unknown as RecordLike;
  const meta = getMeta(message);
  const details = isRecord(record.details) ? record.details : undefined;

  // Try every known location: message.metadata, message.details, message.meta
  const sources: unknown[] = [
    meta.usage,
    meta.tokenUsage,
    meta.tokens,
    details?.usage,
    details?.tokenUsage,
    details?.tokens,
    record.usage,
    record.tokenUsage,
  ].filter((v) => v != null);

  for (const source of sources) {
    const parsed = normalizeUsageRecord(source);
    if (parsed) return parsed;
  }
  return null;
}

function normalizeUsageRecord(source: unknown): {
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  totalTokens: number;
  estimatedCostUsd?: number;
} | null {
  if (typeof source === 'number') {
    return { inputTokens: 0, outputTokens: 0, cacheTokens: 0, totalTokens: source };
  }
  if (!isRecord(source)) return null;

  const input = asNumber(source.inputTokens ?? source.input_tokens ?? source.input ?? source.promptTokens ?? source.prompt_tokens) ?? 0;
  const output = asNumber(source.outputTokens ?? source.output_tokens ?? source.output ?? source.completionTokens ?? source.completion_tokens) ?? 0;
  const cacheRead = asNumber(source.cacheReadTokens ?? source.cache_read_tokens ?? source.cacheReadInputTokens) ?? 0;
  const cacheWrite = asNumber(source.cacheWriteTokens ?? source.cache_creation_tokens ?? source.cacheCreationInputTokens) ?? 0;
  const cache = cacheRead + cacheWrite;
  const total = asNumber(source.totalTokens ?? source.total_tokens ?? source.total) ?? (input + output + cache);

  if (input === 0 && output === 0 && cache === 0 && total === 0) return null;

  const cost = asNumber(source.estimatedCostUsd ?? source.estimated_cost_usd ?? source.costUsd ?? source.cost_usd);
  return {
    inputTokens: input,
    outputTokens: output,
    cacheTokens: cache,
    totalTokens: total,
    estimatedCostUsd: cost,
  };
}
