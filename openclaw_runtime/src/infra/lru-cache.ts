export class LruCache<K, V> {
  readonly #maxSize: number;
  readonly #entries = new Map<K, V>();

  constructor(maxSize: number) {
    if (!Number.isInteger(maxSize) || maxSize <= 0) {
      throw new Error(`LruCache maxSize must be a positive integer, got: ${maxSize}`);
    }
    this.#maxSize = maxSize;
  }

  get maxSize(): number {
    return this.#maxSize;
  }

  get(key: K): V | undefined {
    if (!this.#entries.has(key)) {
      return undefined;
    }
    const value = this.#entries.get(key)!;
    this.#entries.delete(key);
    this.#entries.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    if (this.#entries.has(key)) {
      this.#entries.delete(key);
    } else if (this.#entries.size >= this.#maxSize) {
      const eldestKey = this.#entries.keys().next().value;
      if (eldestKey !== undefined) {
        this.#entries.delete(eldestKey);
      }
    }
    this.#entries.set(key, value);
  }

  has(key: K): boolean {
    return this.#entries.has(key);
  }

  delete(key: K): boolean {
    return this.#entries.delete(key);
  }

  clear(): void {
    this.#entries.clear();
  }

  size(): number {
    return this.#entries.size;
  }

  entries(): IterableIterator<[K, V]> {
    return this.#entries.entries();
  }

  keys(): IterableIterator<K> {
    return this.#entries.keys();
  }

  values(): IterableIterator<V> {
    return this.#entries.values();
  }

  forEach(callback: (value: V, key: K, cache: this) => void): void {
    for (const [key, value] of this.#entries) {
      callback(value, key, this);
    }
  }
}
