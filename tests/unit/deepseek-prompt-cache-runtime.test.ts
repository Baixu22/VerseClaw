import { describe, expect, it } from 'vitest';
import { normalizeUsage } from '../../openclaw_runtime/src/agents/usage';
import {
  canonicalizeProviderTools,
  summarizeProviderPayloadCacheShape,
} from '../../openclaw_runtime/src/agents/provider-payload-cache-shape';

describe('DeepSeek prompt cache runtime helpers', () => {
  it('normalizes DeepSeek top-level prompt cache hit and miss tokens', () => {
    expect(normalizeUsage({
      prompt_tokens: 20_100,
      completion_tokens: 7,
      total_tokens: 20_107,
      prompt_cache_hit_tokens: 19_900,
      prompt_cache_miss_tokens: 200,
    })).toMatchObject({
      input: 200,
      output: 7,
      cacheRead: 19_900,
      total: 20_107,
    });
  });

  it('does not double-count nested cached prompt tokens', () => {
    expect(normalizeUsage({
      prompt_tokens: 10_000,
      completion_tokens: 5,
      total_tokens: 10_005,
      prompt_tokens_details: { cached_tokens: 8_000 },
    })).toMatchObject({
      input: 2_000,
      output: 5,
      cacheRead: 8_000,
      total: 10_005,
    });
  });

  it('canonicalizes equivalent tool schemas to a stable final payload shape', () => {
    const leftTools = canonicalizeProviderTools([
      {
        type: 'function',
        function: {
          name: 'zeta',
          description: 'Z tool',
          parameters: {
            required: ['b', 'a'],
            type: 'object',
            properties: {
              b: { type: 'string' },
              a: { type: 'number' },
            },
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'alpha',
          description: 'A tool',
          parameters: { type: 'object' },
        },
      },
    ]);
    const rightTools = canonicalizeProviderTools([
      {
        type: 'function',
        function: {
          description: 'A tool',
          parameters: { properties: {}, type: 'object' },
          name: 'alpha',
        },
      },
      {
        type: 'function',
        function: {
          description: 'Z tool',
          name: 'zeta',
          parameters: {
            properties: {
              a: { type: 'number' },
              b: { type: 'string' },
            },
            type: 'object',
            required: ['a', 'b'],
          },
        },
      },
    ]);

    expect(leftTools).toEqual(rightTools);
    expect(summarizeProviderPayloadCacheShape({
      model: 'deepseek-v4-flash',
      messages: [{ role: 'system', content: 'stable' }],
      tools: leftTools,
    }).toolsHash).toBe(summarizeProviderPayloadCacheShape({
      model: 'deepseek-v4-flash',
      messages: [{ role: 'system', content: 'stable' }],
      tools: rightTools,
    }).toolsHash);
  });
});
