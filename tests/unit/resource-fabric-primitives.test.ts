import { describe, expect, it, vi } from 'vitest';
import {
  AdaptiveLimit,
  BoundedCache,
  DrfShare,
  PriorityQueue,
  Singleflight,
  TokenBucket,
} from '../../shared/resources';

describe('resource fabric P0 primitives', () => {
  it('evicts LRU entries, expires by injected TTL, and invalidates by prefix', () => {
    let now = 0;
    const cache = new BoundedCache<string, number>({ maxEntries: 2, ttlMs: 100, now: () => now });
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.get('a')).toBe(1);
    cache.set('c', 3);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe(1);
    expect(cache.size).toBe(2);
    now = 100;
    cache.set('doc:a', 4);
    now = 150;
    cache.set('doc:b', 5);
    now = 200;
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('doc:a')).toBeUndefined();
    expect(cache.get('doc:b')).toBe(5);
    expect(cache.size).toBe(1);
    now = 249;
    expect(cache.invalidate((key) => key.startsWith('doc:'))).toBe(1);
    expect(cache.size).toBe(0);
  });

  it('coalesces same-key work and does not cache rejected calls', async () => {
    const flight = new Singleflight<string, number>();
    let calls = 0;
    let resolve!: (value: number) => void;
    const work = vi.fn(() => {
      calls += 1;
      return new Promise<number>((done) => { resolve = done; });
    });
    const first = flight.run('key', work);
    const second = flight.run('key', work);
    expect(first).toBe(second);
    expect(flight.size).toBe(1);
    await Promise.resolve();
    resolve(7);
    await expect(first).resolves.toBe(7);
    expect(calls).toBe(1);
    expect(flight.size).toBe(0);

    const failed = flight.run('key', async () => { throw new Error('boom'); });
    await expect(failed).rejects.toThrow('boom');
    await expect(flight.run('key', async () => 9)).resolves.toBe(9);
  });

  it('adjusts adaptive limits with bounds and a dead zone', () => {
    const limit = new AdaptiveLimit({ initialLimit: 4, minLimit: 1, maxLimit: 8, smoothing: 0.2, minChangeRatio: 0.1 });
    expect(limit.limit).toBe(4);
    expect(limit.sample(100, 0)).toBe(4);
    expect(limit.sample(10, 1)).toBe(5);
    expect(limit.sample(100, 0)).toBe(5);
    expect(() => limit.sample(0)).toThrow(RangeError);
    expect(() => limit.sample(1, -1)).toThrow(RangeError);
  });

  it('enforces token-bucket bursts with injected time and rejects invalid input', () => {
    let now = 0;
    const bucket = new TokenBucket({ capacity: 2, refillPerSecond: 1, now: () => now });
    expect(bucket.tryTake()).toBe(true);
    expect(bucket.tryTake()).toBe(true);
    expect(bucket.tryTake()).toBe(false);
    now = 1000;
    expect(bucket.tryTake()).toBe(true);
    expect(bucket.tryTake()).toBe(false);
    expect(() => bucket.tryTake(0)).toThrow(RangeError);
  });

  it('orders QoS, boosts explicit work, and ages opportunistic work', () => {
    let now = 0;
    const queue = new PriorityQueue<string>({ agePromotionMs: 50, now: () => now });
    queue.push('background', 'background');
    queue.push('interactive', 'interactive');
    queue.push('opportunistic', 'opportunistic');
    expect(queue.dequeue()).toBe('interactive');
    expect(queue.boost('opportunistic', 10)).toBe(true);
    expect(queue.dequeue()).toBe('opportunistic');
    expect(queue.boost('missing', 10)).toBe(false);

    const aged = new PriorityQueue<string>({ agePromotionMs: 50, now: () => now });
    aged.push('aged-opportunistic', 'opportunistic');
    aged.push('fresh-background', 'background');
    now = 50;
    expect(aged.dequeue()).toBe('aged-opportunistic');
    expect(aged.dequeue()).toBe('fresh-background');
  });

  it('enforces DRF-lite capacity and fairness bounds', () => {
    const shares = new DrfShare({ processes: 4, concurrency: 4 });
    shares.reserve('a', { processes: 1 });
    shares.reserve('b', { processes: 1 });
    expect(shares.isFair()).toBe(true);
    shares.reserve('a', { processes: 3 });
    shares.reserve('c', { processes: 1 });
    shares.reserve('d', { processes: 1 });
    expect(shares.isFair()).toBe(false);
    expect(shares.dominantTenant()).toBe('a');
    expect(shares.release('a', { processes: 2 })).toEqual({ processes: 2, concurrency: 0 });
    expect(() => shares.reserve('e', { processes: 5 })).toThrow(RangeError);
    expect(() => shares.release('a', { processes: 3 })).toThrow(RangeError);
  });
});
