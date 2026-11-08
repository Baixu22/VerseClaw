import { beforeEach, describe, expect, it } from 'vitest';
import { BoundedCache, retainedPayloadBytes } from '../../shared/resources/bounded-cache';
import { CHAT_CACHE_MAX_BYTES, chatCacheDiagnostics, clearChatContentCache, createChatContentCache } from '../../src/stores/chat/content-cache';

describe('bounded payload cache', () => {
  const options = { maxEntries: 20, ttlMs: 100, maxBytes: 12, sizeOf: (value: string) => value.length * 2 };
  it('evicts least recently used payloads before their combined bytes exceed capacity', () => {
    const cache = new BoundedCache<string, string>(options);
    cache.set('a', 'abc'); cache.set('b', 'def'); cache.get('a'); cache.set('c', 'ghi');
    expect(cache.get('b')).toBeUndefined(); expect(cache.get('a')).toBe('abc'); expect(cache.get('c')).toBe('ghi');
  });
  it('does not retain a single oversized value', () => {
    const cache = new BoundedCache<string, string>(options);
    cache.set('large', 'x'.repeat(20)); expect(cache.get('large')).toBeUndefined();
  });
  it('reclaims overwritten, deleted and expired payload accounting', () => {
    let now = 0; const cache = new BoundedCache<string, string>({ ...options, now: () => now });
    cache.set('a', 'abc'); cache.set('a', 'a'); cache.set('b', 'bcdef');
    expect(cache.get('a')).toBe('a'); cache.delete('a'); cache.set('c', 'a');
    expect(cache.get('b')).toBe('bcdef'); now = 101; expect(cache.size).toBe(0);
    cache.set('new', 'abcdef'); expect(cache.get('new')).toBe('abcdef');
    expect(cache.bytes).toBe(12); cache.invalidate(() => true); expect(cache.bytes).toBe(0);
    cache.set('next', 'abc'); cache.clear(); expect(cache.bytes).toBe(0);
  });
});

describe('shared chat cache budget', () => {
  beforeEach(clearChatContentCache);
  it('charges history, previews and projections to one limit and retains each namespace count', () => {
    const history = createChatContentCache<string>('history-test', 20);
    const preview = createChatContentCache<string>('preview-test', 100);
    const projection = createChatContentCache<string>('projection-test', 2);
    const payload = '汉'.repeat(4 * 1024 * 1024);
    history.set('first', payload); preview.set('image', payload);
    projection.set('one', payload); projection.set('two', payload);
    expect(history.get('first')).toBeUndefined();
    expect(chatCacheDiagnostics().bytes).toBeLessThanOrEqual(CHAT_CACHE_MAX_BYTES);
    projection.set('three', 'small'); projection.set('four', 'small');
    expect(projection.entries()).toHaveLength(2);
  });
  it('counts cycles, aliases and binary buffers without traversing them twice', () => {
    const shared = { text: '汉😀' }; const value: Record<string, unknown> = { first: shared, second: shared };
    value.self = value;
    expect(retainedPayloadBytes(value)).toBeGreaterThan(100);
    expect(retainedPayloadBytes(value)).toBeLessThan(400);
    const buffer = new ArrayBuffer(1024);
    expect(retainedPayloadBytes([new Uint8Array(buffer), buffer])).toBeLessThan(1200);
  });
  it('does not retain an oversized body and can load it again through its cold key', async () => {
    const cache = createChatContentCache<string>('cold-session', 20);
    const body = 'x'.repeat(CHAT_CACHE_MAX_BYTES / 2);
    cache.set('session-a', body); expect(cache.get('session-a')).toBeUndefined();
    const read = async (session: string) => session === 'session-a' ? body : '';
    expect(await read('session-a')).toBe(body);
    expect(chatCacheDiagnostics().bytes).toBe(0);
  });
});
