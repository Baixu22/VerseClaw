/** In-memory token bucket with an injected clock; a denied call never sleeps. */
export type TokenBucketOptions = {
  capacity: number;
  refillPerSecond: number;
  now?: () => number;
};

export class TokenBucket {
  private readonly capacity: number;
  private readonly refillPerMs: number;
  private readonly now: () => number;
  private tokens: number;
  private lastRefillMs: number;

  constructor(options: TokenBucketOptions) {
    if (!Number.isFinite(options.capacity) || options.capacity <= 0
      || !Number.isFinite(options.refillPerSecond) || options.refillPerSecond <= 0) {
      throw new RangeError('bucket capacity and refill rate must be positive');
    }
    this.capacity = options.capacity;
    this.refillPerMs = options.refillPerSecond / 1000;
    this.now = options.now ?? Date.now;
    this.tokens = options.capacity;
    this.lastRefillMs = this.now();
  }

  tryTake(count = 1): boolean {
    if (!Number.isFinite(count) || count <= 0) throw new RangeError('count must be positive');
    this.refill();
    if (this.tokens + Number.EPSILON >= count) {
      this.tokens -= count;
      return true;
    }
    return false;
  }

  get available(): number {
    this.refill();
    return this.tokens;
  }

  private refill(): void {
    const now = this.now();
    const elapsed = Math.max(0, now - this.lastRefillMs);
    if (elapsed > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerMs);
      this.lastRefillMs = now;
    }
  }
}
