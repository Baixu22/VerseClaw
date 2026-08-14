// Billing aggregate semantics: the backend aggregate over ALL local
// transcripts must agree with the Billing page math — window filtering,
// hidden-source exclusion, hit-rate denominators, and dimension grouping.

import { describe, expect, it } from 'vitest';
import {
  aggregateUsageEntries,
  normalizeUsageAggregateWindow,
  type TokenUsageHistoryEntry,
} from '@electron/utils/token-usage-core';
import { computeCacheHitRate, isHiddenUsageSource, promptTokensForUsage } from '@shared/types/usage';

function isoDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(12, 0, 0, 0);
  return date.toISOString();
}

function entry(overrides: Partial<TokenUsageHistoryEntry>): TokenUsageHistoryEntry {
  return {
    timestamp: isoDaysAgo(0),
    sessionId: 'session-agg',
    agentId: 'main',
    model: 'gpt-5',
    provider: 'openai',
    usageStatus: 'available',
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 25,
    cacheWriteTokens: 10,
    totalTokens: 185,
    costUsd: 0.02,
    ...overrides,
  };
}

describe('shared usage math', () => {
  it('computes prompt tokens as input + cache read + cache write', () => {
    expect(promptTokensForUsage({ inputTokens: 100, cacheReadTokens: 25, cacheWriteTokens: 10 })).toBe(135);
  });

  it('computes cache hit rate over prompt tokens and returns null without a denominator', () => {
    expect(computeCacheHitRate({ inputTokens: 75, cacheReadTokens: 25, cacheWriteTokens: 0 })).toBeCloseTo(0.25);
    expect(computeCacheHitRate({ inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBeNull();
  });

  it('classifies hidden sources case-insensitively by marker substring', () => {
    expect(isHiddenUsageSource('gateway-injected')).toBe(true);
    expect(isHiddenUsageSource('Delivery-Mirror')).toBe(true);
    expect(isHiddenUsageSource('openai')).toBe(false);
    expect(isHiddenUsageSource(undefined)).toBe(false);
  });
});

describe('aggregateUsageEntries', () => {
  it('normalizes aggregate windows', () => {
    expect(normalizeUsageAggregateWindow('7d')).toBe('7d');
    expect(normalizeUsageAggregateWindow('30d')).toBe('30d');
    expect(normalizeUsageAggregateWindow('all')).toBe('all');
    expect(normalizeUsageAggregateWindow('bogus')).toBe('30d');
    expect(normalizeUsageAggregateWindow(undefined)).toBe('30d');
  });

  it('aggregates totals with cache hit-rate semantics', () => {
    const entries = [
      entry({ inputTokens: 75, cacheReadTokens: 25, cacheWriteTokens: 0, totalTokens: 100, costUsd: 0.01 }),
      entry({ inputTokens: 150, cacheReadTokens: 50, cacheWriteTokens: 0, totalTokens: 200, costUsd: 0.03 }),
    ];

    const summary = aggregateUsageEntries(entries, 'all');

    expect(summary.billableEntries).toBe(2);
    expect(summary.inputTokens).toBe(225);
    expect(summary.cacheReadTokens).toBe(75);
    expect(summary.promptTokens).toBe(300);
    expect(summary.cacheHitRate).toBeCloseTo(0.25);
    expect(summary.totalTokens).toBe(300);
    expect(summary.costUsd).toBeCloseTo(0.04);
  });

  it('excludes hidden gateway bookkeeping sources from totals and dimensions', () => {
    const entries = [
      entry({ sessionId: 'a', totalTokens: 100, costUsd: 0.01 }),
      entry({ sessionId: 'b', provider: 'gateway-injected', totalTokens: 999, costUsd: 9.99 }),
      entry({ sessionId: 'c', model: 'delivery-mirror', totalTokens: 999, costUsd: 9.99 }),
    ];

    const summary = aggregateUsageEntries(entries, 'all');

    expect(summary.entriesInWindow).toBe(1);
    expect(summary.billableEntries).toBe(1);
    expect(summary.totalTokens).toBe(100);
    expect(summary.scannedEntries).toBe(3);
  });

  it('counts missing and error records without billing them', () => {
    const entries = [
      entry({ usageStatus: 'available', totalTokens: 100 }),
      entry({ usageStatus: 'missing', totalTokens: 0 }),
      entry({ usageStatus: 'error', totalTokens: 0 }),
    ];

    const summary = aggregateUsageEntries(entries, 'all');

    expect(summary.missingEntries).toBe(1);
    expect(summary.errorEntries).toBe(1);
    expect(summary.billableEntries).toBe(1);
    expect(summary.totalTokens).toBe(100);
  });

  it('keeps stable zero-filled day buckets for the 7d window', () => {
    const entries = [entry({ timestamp: isoDaysAgo(1), totalTokens: 100 })];

    const summary = aggregateUsageEntries(entries, '7d', { now: Date.now() });

    expect(summary.days).toHaveLength(7);
    expect(summary.days.filter((day) => day.totalTokens > 0)).toHaveLength(1);
    expect(summary.days[0].date <= summary.days[6].date).toBe(true);
  });

  it('filters entries outside the window', () => {
    const entries = [
      entry({ sessionId: 'recent', timestamp: isoDaysAgo(0), totalTokens: 100 }),
      entry({ sessionId: 'old', timestamp: isoDaysAgo(40), totalTokens: 500 }),
    ];

    const summary = aggregateUsageEntries(entries, '30d');

    expect(summary.entriesInWindow).toBe(1);
    expect(summary.totalTokens).toBe(100);
    expect(summary.models).toHaveLength(1);
  });

  it('groups and sorts per-model dimensions with per-model hit rates', () => {
    const entries = [
      entry({ model: 'model-b', inputTokens: 90, cacheReadTokens: 10, totalTokens: 120 }),
      entry({ model: 'model-a', inputTokens: 50, cacheReadTokens: 50, totalTokens: 220 }),
      entry({ model: 'model-a', inputTokens: 0, cacheReadTokens: 0, totalTokens: 180 }),
    ];

    const summary = aggregateUsageEntries(entries, 'all');

    expect(summary.models.map((model) => model.label)).toEqual(['model-a', 'model-b']);
    expect(summary.models[0].totalTokens).toBe(400);
    expect(summary.models[0].cacheHitRate).toBeCloseTo(50 / 120);
  });

  it('groups per-agent dimensions', () => {
    const entries = [
      entry({ agentId: 'agent-b', totalTokens: 100 }),
      entry({ agentId: 'agent-a', totalTokens: 300 }),
    ];

    const summary = aggregateUsageEntries(entries, 'all');

    expect(summary.agents.map((agent) => agent.label)).toEqual(['agent-a', 'agent-b']);
    expect(summary.agents[0].totalTokens).toBe(300);
  });

  it('caps model dimensions but keeps every agent dimension', () => {
    const entries = Array.from({ length: 20 }, (_, index) => (
      entry({ sessionId: `s${index}`, model: `model-${index}`, agentId: `agent-${index}`, totalTokens: index + 1 })
    ));

    const summary = aggregateUsageEntries(entries, 'all');

    expect(summary.models).toHaveLength(12);
    expect(summary.agents).toHaveLength(20);
    expect(summary.models[0].label).toBe('model-19');
  });
});
