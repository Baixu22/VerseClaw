/**
 * Bounded LRU cache with absolute TTL and explicit invalidation.
 * Values are never refreshed implicitly; callers decide when to read again.
 */
export type BoundedCacheOptions<V = unknown> = {
  maxEntries: number;
  ttlMs: number;
  now?: () => number;
  maxBytes?: number;
  sizeOf?: (value: V) => number;
};

type Entry<V> = { value: V; expiresAt: number; bytes: number };

export class BoundedCache<K, V> {
  private readonly entries = new Map<K, Entry<V>>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly maxBytes: number;
  private readonly sizeOf: (value: V) => number;
  private retainedBytes = 0;

  constructor(options: BoundedCacheOptions<V>) {
    if (!Number.isInteger(options.maxEntries) || options.maxEntries < 1) {
      throw new RangeError('maxEntries must be a positive integer');
    }
    if (!Number.isFinite(options.ttlMs) || options.ttlMs <= 0) {
      throw new RangeError('ttlMs must be a positive finite number');
    }
    this.maxEntries = options.maxEntries;
    this.ttlMs = options.ttlMs;
    this.now = options.now ?? Date.now;
    if (options.maxBytes !== undefined && (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1)) {
      throw new RangeError('maxBytes must be a positive safe integer');
    }
    this.maxBytes = options.maxBytes ?? Number.POSITIVE_INFINITY;
    this.sizeOf = options.sizeOf ?? (() => 0);
  }

  get(key: K): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.delete(key);
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V): void {
    const bytes = this.sizeOf(value);
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw new RangeError('cache payload size must be a nonnegative safe integer');
    this.sweep(); this.delete(key);
    if (bytes > this.maxBytes) return;
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs, bytes });
    this.retainedBytes += bytes;
    while (this.entries.size > this.maxEntries || this.retainedBytes > this.maxBytes) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.delete(oldest.value);
    }
  }

  delete(key: K): boolean {
    const entry = this.entries.get(key);
    if (entry) this.retainedBytes -= entry.bytes;
    return this.entries.delete(key);
  }

  invalidate(predicate: (key: K, value: V) => boolean): number {
    let removed = 0;
    for (const [key, entry] of this.entries) {
      if (predicate(key, entry.value)) {
        this.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  clear(): void {
    this.entries.clear();
    this.retainedBytes = 0;
  }

  get size(): number {
    this.sweep();
    return this.entries.size;
  }

  get bytes(): number { this.sweep(); return this.retainedBytes; }

  snapshot(): Array<[K, V]> {
    this.sweep();
    return [...this.entries].map(([key, entry]) => [key, entry.value]);
  }

  private sweep(): void {
    const now = this.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.delete(key);
    }
  }
}

/** Conservative retained-payload estimate; native heap/RSS is measured separately. */
export function retainedPayloadBytes(value: unknown, seen = new Set<object>()): number {
  if (typeof value === 'string') return value.length * 2;
  if (typeof value === 'number' || typeof value === 'bigint') return 8;
  if (typeof value === 'boolean') return 4;
  if (value === null || typeof value !== 'object' || seen.has(value)) return 0;
  seen.add(value);
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (ArrayBuffer.isView(value)) return retainedPayloadBytes(value.buffer, seen);
  if (value instanceof Map) return 64 + [...value].reduce((bytes, [key, item]) => bytes + 16 + retainedPayloadBytes(key, seen) + retainedPayloadBytes(item, seen), 0);
  if (value instanceof Set) return 64 + [...value].reduce((bytes, item) => bytes + 8 + retainedPayloadBytes(item, seen), 0);
  return 64 + Object.entries(value).reduce((bytes, [key, item]) => bytes + 8 + key.length * 2 + retainedPayloadBytes(item, seen), 0);
}
