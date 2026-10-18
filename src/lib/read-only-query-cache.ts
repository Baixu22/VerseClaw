import { BoundedCache, Singleflight } from '../../shared/resources/index.js';

export type ReadOnlyQueryCache<T> = {
  get(key: string, load: () => Promise<T>, ttlMs?: number): Promise<T>;
  invalidatePrefix(prefix: string): number;
  clear(): void;
};

/**
 * P1 renderer-side cache for low-risk read-only host queries.
 * It never caches mutations and never invents freshness: callers choose TTL,
 * while mutation paths call invalidatePrefix after they succeed.
 */
export function createReadOnlyQueryCache<T>(options: {
  maxEntries?: number;
  ttlMs?: number;
  now?: () => number;
} = {}): ReadOnlyQueryCache<T> {
  const cache = new BoundedCache<string, T>({
    maxEntries: options.maxEntries ?? 32,
    ttlMs: options.ttlMs ?? 5_000,
    now: options.now,
  });
  const flight = new Singleflight<string, T>();
  const perCallCaches = new Map<number, BoundedCache<string, T>>();
  return {
    async get(key, load, ttlMs) {
      const normalizedTtl = ttlMs === undefined ? (options.ttlMs ?? 5_000) : ttlMs;
      if (!Number.isFinite(normalizedTtl) || normalizedTtl <= 0) {
        throw new RangeError('ttlMs must be a positive finite number');
      }
      const selected = normalizedTtl === (options.ttlMs ?? 5_000)
        ? cache
        : (() => {
          let entry = perCallCaches.get(normalizedTtl);
          if (!entry) {
            entry = new BoundedCache<string, T>({ maxEntries: options.maxEntries ?? 32, ttlMs: normalizedTtl, now: options.now });
            perCallCaches.set(normalizedTtl, entry);
          }
          return entry;
        })();
      const cached = selected.get(key);
      if (cached !== undefined) return cached;
      const value = await flight.run(key, load);
      selected.set(key, value);
      return value;
    },
    invalidatePrefix(prefix) {
      let removed = cache.invalidate((key) => key.startsWith(prefix));
      for (const selected of perCallCaches.values()) {
        removed += selected.invalidate((key) => key.startsWith(prefix));
      }
      return removed;
    },
    clear() {
      cache.clear();
      for (const selected of perCallCaches.values()) selected.clear();
    },
  };
}
