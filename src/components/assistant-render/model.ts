import type { RawMessage } from '@/stores/chat';
import { extractThinkingSegments } from '@/pages/Chat/message-utils';

/*
 * F6 note: `AssistantBranch`/`extractAssistantBranches` (the BranchPicker
 * multi-draft switcher) and `AssistantToolFallback`/`extractAssistantToolFallbacks`
 * (the degraded tool card) were removed here. Neither `metadata.branches` nor
 * `metadata.toolFallbacks` ever had a producer — only tests injected them — and
 * the execution graph already owns unknown-tool visibility. If a regenerate
 * feature lands, recover BranchPicker from commit ac5a06830 and give it a real
 * store-side producer instead of resurrecting the speculative metadata shape.
 */

export type AssistantReasoning = {
  id: string;
  title?: string;
  summary: string;
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

/**
 * The agent's reasoning, from whichever channel carries it.
 *
 * Two sources, in priority order:
 *
 *   1. `metadata.reasoning` / `metadata.thinkingSummary` / `reasoningSummary` —
 *      a pre-summarized list, if some producer ever attaches one.
 *   2. The message's own `thinking` content blocks, split into incremental
 *      segments by `extractThinkingSegments`.
 *
 * (2) is the one that actually fires today. It was the audit's F6: the runtime
 * has emitted `thinking` blocks all along and `extractThinkingSegments` was
 * written to turn them into exactly this shape, but nothing consumed it — so
 * every reasoning channel was closed at once and the panel could only be
 * reached by hand-injected metadata in tests.
 */
export function extractAssistantReasoning(message: RawMessage): AssistantReasoning[] {
  const meta = getMeta(message);
  const record = message as unknown as RecordLike;
  const source = meta.reasoning ?? meta.thinkingSummary ?? record.reasoningSummary;
  const values = Array.isArray(source) ? source : source ? [source] : [];
  const fromMetadata = values
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

  if (fromMetadata.length > 0) return fromMetadata;

  return extractThinkingSegments(message).map((summary, index) => ({
    id: `thinking-${index + 1}`,
    summary,
  }));
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
