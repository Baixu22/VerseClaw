import { afterEach, describe, expect, it } from 'vitest';
import {
  PROMPT_CACHE_OBSERVABILITY_ENV,
  beginPromptCacheObservation,
  completePromptCacheObservation,
  isPromptCacheObservabilityEnabled,
  resetPromptCacheObservabilityForTest,
} from '../../openclaw_runtime/src/agents/embedded-agent-runner/prompt-cache-observability';

afterEach(() => {
  resetPromptCacheObservabilityForTest();
});

function begin(overrides: Record<string, unknown> = {}) {
  return beginPromptCacheObservation({
    sessionId: 'session-a',
    provider: 'anthropic',
    modelId: 'claude-sonnet-4-6',
    streamStrategy: 'anthropic-messages',
    systemPrompt: 'stable prefix',
    toolNames: ['read', 'write'],
    ...overrides,
  });
}

describe('prompt cache observability kill switch', () => {
  it('runs by default so break attribution is available without a trace file', () => {
    expect(isPromptCacheObservabilityEnabled({})).toBe(true);
  });

  it('can be disabled with OPENCLAW_PROMPT_CACHE_OBSERVABILITY=0', () => {
    expect(isPromptCacheObservabilityEnabled({ [PROMPT_CACHE_OBSERVABILITY_ENV]: '0' })).toBe(false);
    expect(isPromptCacheObservabilityEnabled({ [PROMPT_CACHE_OBSERVABILITY_ENV]: 'off' })).toBe(false);
  });

  it('accepts explicit truthy values', () => {
    expect(isPromptCacheObservabilityEnabled({ [PROMPT_CACHE_OBSERVABILITY_ENV]: '1' })).toBe(true);
    expect(isPromptCacheObservabilityEnabled({ [PROMPT_CACHE_OBSERVABILITY_ENV]: 'yes' })).toBe(true);
  });

  it('falls back to the default for ambiguous input', () => {
    expect(isPromptCacheObservabilityEnabled({ [PROMPT_CACHE_OBSERVABILITY_ENV]: 'maybe' })).toBe(true);
  });
});

describe('prompt cache break attribution', () => {
  it('reports no change when the tracked inputs are stable', () => {
    begin();
    const result = completePromptCacheObservation({ sessionId: 'session-a', usage: { cacheRead: 5_000 } });
    expect(result).toBeNull();
  });

  it('attributes a warm-prefix break to the changed tool set', () => {
    begin();
    completePromptCacheObservation({ sessionId: 'session-a', usage: { cacheRead: 10_000 } });
    begin({ toolNames: ['read', 'write', 'bash'] });
    const result = completePromptCacheObservation({ sessionId: 'session-a', usage: { cacheRead: 4_000 } });
    expect(result?.changes?.map((change) => change.code)).toContain('tools');
    expect(result?.changes?.map((change) => change.code)).not.toContain('systemPrompt');
  });

  it('attributes a warm-prefix break to the changed system prompt', () => {
    begin();
    completePromptCacheObservation({ sessionId: 'session-a', usage: { cacheRead: 10_000 } });
    begin({ systemPrompt: 'changed prefix' });
    const result = completePromptCacheObservation({ sessionId: 'session-a', usage: { cacheRead: 4_000 } });
    expect(result?.changes?.map((change) => change.code)).toContain('systemPrompt');
  });

  it('does not flag a small drop as a break', () => {
    begin();
    completePromptCacheObservation({ sessionId: 'session-a', usage: { cacheRead: 10_000 } });
    begin({ systemPrompt: 'changed prefix' });
    const result = completePromptCacheObservation({ sessionId: 'session-a', usage: { cacheRead: 9_500 } });
    expect(result).toBeNull();
  });

  it('does not flag a break below the token-drop floor', () => {
    begin();
    completePromptCacheObservation({ sessionId: 'session-a', usage: { cacheRead: 1_200 } });
    begin({ systemPrompt: 'changed prefix' });
    const result = completePromptCacheObservation({ sessionId: 'session-a', usage: { cacheRead: 400 } });
    expect(result).toBeNull();
  });

  it('ignores usage without a cache-read number', () => {
    begin();
    const result = completePromptCacheObservation({ sessionId: 'session-a', usage: { input: 10 } });
    expect(result).toBeNull();
  });
});