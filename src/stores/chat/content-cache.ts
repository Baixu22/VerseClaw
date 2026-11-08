import { BoundedCache, retainedPayloadBytes } from '../../../shared/resources/bounded-cache';

export const CHAT_CACHE_MAX_BYTES = 32 * 1024 * 1024;
const contents = new BoundedCache<string, { key: string; value: unknown }>({
  maxEntries: 2000, ttlMs: Number.MAX_SAFE_INTEGER, maxBytes: CHAT_CACHE_MAX_BYTES, sizeOf: retainedPayloadBytes,
});

/** Existing chat caches share one payload budget; their keys remain cold read handles. */
export function createChatContentCache<V>(namespace: string, maxEntries: number) {
  const prefix = namespace + ':';
  const keyFor = (key: string) => prefix + key;
  const entries = (): Array<[string, V]> => contents.snapshot()
    .filter(([key]) => key.startsWith(prefix)).map(([key, entry]) => [key.slice(prefix.length), entry.value as V]);
  return {
    get: (key: string): V | undefined => contents.get(keyFor(key))?.value as V | undefined,
    set(key: string, value: V): void {
      const fullKey = keyFor(key);
      contents.set(fullKey, { key: fullKey, value });
      const values = entries();
      for (const [oldest] of values.slice(0, Math.max(0, values.length - maxEntries))) contents.delete(keyFor(oldest));
    },
    delete: (key: string): boolean => contents.delete(keyFor(key)),
    clear: (): void => { contents.invalidate(key => key.startsWith(prefix)); },
    entries,
  };
}

export function chatCacheDiagnostics() {
  return { bytes: contents.bytes, maxBytes: CHAT_CACHE_MAX_BYTES, entries: contents.size };
}

export function clearChatContentCache(): void { contents.clear(); }
