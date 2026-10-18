/** Coalesce same-key in-flight work. Rejected calls are never cached. */
export class Singleflight<K, V> {
  private readonly inFlight = new Map<K, Promise<V>>();

  run(key: K, work: () => Promise<V>): Promise<V> {
    const existing = this.inFlight.get(key);
    if (existing) return existing;
    const promise = Promise.resolve().then(work).finally(() => {
      if (this.inFlight.get(key) === promise) this.inFlight.delete(key);
    });
    this.inFlight.set(key, promise);
    return promise;
  }

  get size(): number {
    return this.inFlight.size;
  }
}
