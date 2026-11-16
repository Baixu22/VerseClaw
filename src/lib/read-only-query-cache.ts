import { BoundedCache, Singleflight } from '../../shared/resources/index.js';

export type ReadOnlyQueryCache<T> = {
  get(key: string, load: () => Promise<T>, ttlMs?: number): Promise<T>;
  invalidatePrefix(prefix: string): number;
  clear(): void;
};

/** The caller's key identifies the source; invalidation fences pending publication. */
export function createReadOnlyQueryCache<T>(options: { maxEntries?: number; ttlMs?: number; now?: () => number } = {}): ReadOnlyQueryCache<T> {
  const now = options.now ?? Date.now;
  const cache = new BoundedCache<string, { value: T; at: number }>({ maxEntries: options.maxEntries ?? 32, ttlMs: Number.MAX_SAFE_INTEGER, now });
  const flight = new Singleflight<string, T>();
  let generation = 0;
  return {
    async get(key, load, ttlMs = options.ttlMs ?? 5000) {
      if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new RangeError('ttlMs must be a positive finite number');
      const cached = cache.get(key);
      if (cached && now() - cached.at < ttlMs) return cached.value;
      const owner = generation;
      const value = await flight.run(`${owner}:${key}`, load);
      if (generation === owner) cache.set(key, { value, at: now() });
      return value;
    },
    invalidatePrefix(prefix) { generation++; return cache.invalidate(key => key.startsWith(prefix)); },
    clear() { generation++; cache.clear(); },
  };
}
