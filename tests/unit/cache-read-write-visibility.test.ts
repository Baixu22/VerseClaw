/**
 * Per-message cache read/write visibility.
 *
 * Covers harness/specs/tasks/cache-read-write-visibility.md: the render layer carries
 * cache reads, cache writes and a hit rate beside the combined figure, without changing
 * what the combined figure means and without a second hit-rate implementation.
 *
 * The cache-break observation loop (runtime event bus -> Main ledger -> typed usage host
 * API) is owned by harness/specs/tasks/prompt-cache-observation-ledger-20261012.md and is
 * deliberately not asserted here.
 */
import { describe, expect, it } from 'vitest';
import type { RawMessage } from '@/stores/chat';
import { extractMessageUsage } from '@/components/assistant-render/model';
import { computeCacheHitRate } from '../../shared/types/usage';

function messageWithUsage(usage: Record<string, unknown>): RawMessage {
  return {
    role: 'assistant',
    content: 'Done.',
    metadata: { usage },
  } as unknown as RawMessage;
}

describe('extractMessageUsage splits cache reads from cache writes', () => {
  it('carries the split, the combined figure and the hit rate', () => {
    const usage = extractMessageUsage(
      messageWithUsage({
        inputTokens: 1_000,
        outputTokens: 300,
        cacheReadTokens: 9_000,
        cacheWriteTokens: 500,
        totalTokens: 10_800,
        estimatedCostUsd: 0.0123,
      }),
    );

    expect(usage).not.toBeNull();
    expect(usage?.cacheReadTokens).toBe(9_000);
    expect(usage?.cacheWriteTokens).toBe(500);
    // The combined figure is unchanged: read + write.
    expect(usage?.cacheTokens).toBe(9_500);
    expect(usage?.inputTokens).toBe(1_000);
    expect(usage?.totalTokens).toBe(10_800);
    expect(usage?.estimatedCostUsd).toBe(0.0123);
    expect(usage?.cacheHitRate).toBeCloseTo(9_000 / 10_500, 10);
  });

  it('reads the Anthropic/Bedrock-shaped field names through the same split', () => {
    const usage = extractMessageUsage(
      messageWithUsage({
        inputTokens: 1_000,
        outputTokens: 300,
        cacheReadInputTokens: 4_000,
        cacheCreationInputTokens: 1_000,
        totalTokens: 6_300,
      }),
    );

    expect(usage?.cacheReadTokens).toBe(4_000);
    expect(usage?.cacheWriteTokens).toBe(1_000);
    expect(usage?.cacheTokens).toBe(5_000);
    expect(usage?.cacheHitRate).toBeCloseTo(4_000 / 6_000, 10);
  });

  it('leaves the hit rate null instead of inventing one when no prompt tokens were sent', () => {
    const usage = extractMessageUsage(
      messageWithUsage({ inputTokens: 0, outputTokens: 300, totalTokens: 300 }),
    );

    expect(usage?.cacheHitRate).toBeNull();
    expect(usage?.cacheReadTokens).toBe(0);
    expect(usage?.cacheWriteTokens).toBe(0);
  });

  it('reports a cache write with no read as a zero hit rate, not a missing one', () => {
    const usage = extractMessageUsage(
      messageWithUsage({ inputTokens: 0, outputTokens: 300, cacheWriteTokens: 5, totalTokens: 305 }),
    );

    expect(usage?.cacheHitRate).toBe(0);
  });

  it('uses the shared hit-rate helper so the render layer cannot drift from billing', () => {
    const usage = extractMessageUsage(
      messageWithUsage({
        inputTokens: 1_000,
        outputTokens: 300,
        cacheReadTokens: 9_000,
        cacheWriteTokens: 500,
        totalTokens: 10_800,
      }),
    );

    expect(usage?.cacheHitRate).toBe(
      computeCacheHitRate({
        inputTokens: 1_000,
        cacheReadTokens: 9_000,
        cacheWriteTokens: 500,
      }),
    );
  });

  it('still returns null when there is no usage at all', () => {
    expect(extractMessageUsage({ role: 'assistant', content: 'Old message.' } as unknown as RawMessage)).toBeNull();
  });
});
