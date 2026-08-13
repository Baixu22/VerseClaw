import { describe, expect, it } from 'vitest';
import {
  defaultCacheTtlMs,
  detectCacheVendor,
  effectiveCacheTtlMs,
} from '../../openclaw_runtime/src/agents/embedded-agent-runner/vendor-cache-policy';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

describe('vendor-cache-policy', () => {
  it('detects DeepSeek hosts with exact and suffix matching', () => {
    expect(detectCacheVendor('https://api.deepseek.com')).toBe('deepseek');
    expect(detectCacheVendor('https://api.deepseek.com/v1')).toBe('deepseek');
    expect(detectCacheVendor('https://api.deepseek.com/')).toBe('deepseek');
    expect(detectCacheVendor('https://beta.deepseek.com')).toBe('deepseek');
  });

  it('detects Anthropic and DashScope hosts', () => {
    expect(detectCacheVendor('https://api.anthropic.com')).toBe('anthropic');
    expect(detectCacheVendor('https://api.anthropic.com/v1')).toBe('anthropic');
    expect(detectCacheVendor('https://dashscope.aliyuncs.com')).toBe('dashscope');
    expect(detectCacheVendor('https://dashscope.aliyuncs.com/api/v1')).toBe('dashscope');
    expect(detectCacheVendor('https://foo.maas.aliyuncs.com')).toBe('dashscope');
  });

  it('returns unknown for unrelated or invalid hosts', () => {
    expect(detectCacheVendor('https://api.openai.com')).toBe('unknown');
    expect(detectCacheVendor('https://evil.deepseek.com.evil.com')).toBe('unknown');
    expect(detectCacheVendor('not a url')).toBe('unknown');
    expect(detectCacheVendor(undefined)).toBe('unknown');
    expect(detectCacheVendor('')).toBe('unknown');
  });

  it('applies conservative default TTLs per vendor', () => {
    expect(defaultCacheTtlMs('deepseek')).toBe(24 * HOUR_MS);
    expect(defaultCacheTtlMs('unknown')).toBe(24 * HOUR_MS);
    expect(defaultCacheTtlMs('anthropic')).toBe(5 * MINUTE_MS);
    expect(defaultCacheTtlMs('dashscope')).toBe(5 * MINUTE_MS);
  });

  it('lets an explicit cacheTtlMinutes override the vendor default', () => {
    expect(effectiveCacheTtlMs({ baseUrl: 'https://api.deepseek.com' })).toBe(24 * HOUR_MS);
    expect(
      effectiveCacheTtlMs({ baseUrl: 'https://api.deepseek.com', cacheTtlMinutes: 120 }),
    ).toBe(120 * MINUTE_MS);
    expect(effectiveCacheTtlMs({ cacheTtlMinutes: 0 })).toBe(24 * HOUR_MS);
    expect(effectiveCacheTtlMs({ cacheTtlMinutes: -5 })).toBe(24 * HOUR_MS);
  });
});
