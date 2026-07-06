import { describe, expect, it } from 'vitest';
import { assessPromptCacheStatus } from '../../electron/utils/prompt-cache-status';
import type { TokenUsageSummary } from '../../electron/utils/token-usage-core';

function summary(overrides: Partial<TokenUsageSummary> = {}): TokenUsageSummary {
  return {
    sessionId: 'main',
    agentId: 'main',
    usageStatus: 'available',
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
    entryCount: 1,
    missingEntryCount: 0,
    errorEntryCount: 0,
    ...overrides,
  };
}

describe('prompt cache status assessment', () => {
  it('derives hit rate from input plus cache read/write tokens', () => {
    const assessment = assessPromptCacheStatus({
      summary: summary({
        inputTokens: 1000,
        cacheReadTokens: 3000,
        cacheWriteTokens: 1000,
      }),
      modelRef: 'anthropic/claude-sonnet-4',
    });

    expect(assessment.status).toBe('warm');
    expect(assessment.hitRate).toBeCloseTo(0.6);
    expect(assessment.promptTokens).toBe(5000);
    expect(assessment.providerStrategy).toBe('anthropic');
    expect(assessment.confidence).toBe('high');
  });

  it('warns for warm cache model switches', () => {
    const assessment = assessPromptCacheStatus({
      summary: summary({
        inputTokens: 24_000,
        cacheReadTokens: 12_000,
      }),
      modelRef: 'anthropic/claude-sonnet-4',
      targetModelRef: 'anthropic/claude-opus-4',
      action: 'model-switch',
    });

    expect(assessment.status).toBe('at-risk');
    expect(assessment.severity).toBe('high');
    expect(assessment.shouldWarn).toBe(true);
    expect(assessment.reason).toBe('model-switch');
  });

  it('raises DeepSeek confidence after observing cache usage', () => {
    const assessment = assessPromptCacheStatus({
      summary: summary({
        inputTokens: 20_000,
        cacheReadTokens: 10_000,
        lastTurnCacheReadTokens: 10_000,
      }),
      modelRef: 'deepseek/deepseek-v4-flash',
    });

    expect(assessment.status).toBe('warm');
    expect(assessment.providerStrategy).toBe('openai-compatible');
    expect(assessment.confidence).toBe('medium');
    expect(assessment.reason).toBeUndefined();
  });

  it('warns for unknown providers only when the prompt is large', () => {
    const small = assessPromptCacheStatus({
      summary: summary(),
      modelRef: 'custom-local/model',
      usedTokens: 2000,
      action: 'manual-compaction',
    });
    const large = assessPromptCacheStatus({
      summary: summary(),
      modelRef: 'custom-local/model',
      usedTokens: 12_000,
      action: 'manual-compaction',
    });

    expect(small.shouldWarn).toBe(false);
    expect(small.severity).toBe('low');
    expect(large.shouldWarn).toBe(true);
    expect(large.severity).toBe('unknown');
  });

  it('keeps risk ledger counts scoped to the exact agent session', () => {
    const assessment = assessPromptCacheStatus({
      summary: summary({
        sessionId: 'main',
        agentId: 'primary',
      }),
      modelRef: 'anthropic/claude-sonnet-4',
      ledger: [
        {
          sessionKey: 'agent:primary:main',
          action: 'model-switch',
          severity: 'high',
          status: 'at-risk',
          decision: 'cancelled',
          hitRate: 0.5,
          promptTokens: 10_000,
          updatedAt: 20,
        },
        {
          sessionKey: 'agent:secondary:main',
          action: 'manual-compaction',
          severity: 'medium',
          status: 'at-risk',
          decision: 'continued',
          hitRate: 0.5,
          promptTokens: 10_000,
          updatedAt: 30,
        },
      ],
    });

    expect(assessment.warningCount).toBe(1);
    expect(assessment.cancelledBreakCount).toBe(1);
    expect(assessment.lastRiskEvent?.sessionKey).toBe('agent:primary:main');
  });
});
