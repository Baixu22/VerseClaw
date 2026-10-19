/** Bounded write batching primitive with explicit flush and observable stats. */
export type WriteCoalescerOptions<T> = {
  maxBatch?: number;
  flushDelayMs?: number;
  flush: (batch: T[]) => void | Promise<void>;
};

export type WriteCoalescerStats = {
  queued: number;
  batches: number;
  flushedItems: number;
};

type PendingWrite<T> = {
  value: T;
  resolve: () => void;
  reject: (error: unknown) => void;
};

function normalizePositiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${label} must be a positive integer`);
  }
  return value;
}

function normalizeNonNegativeInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer`);
  }
  return value;
}

/**
 * Coalesces bounded mutations into explicit batches. Each enqueue resolves only
 * after its batch has flushed successfully, so callers keep durable completion
 * semantics instead of observing a queue acceptance.
 */
export class WriteCoalescer<T> {
  private readonly maxBatch: number;
  private readonly flushDelayMs: number;
  private readonly flushFn: (batch: T[]) => void | Promise<void>;
  private readonly queue: PendingWrite<T>[] = [];
  private scheduledFlush: ReturnType<typeof setTimeout> | null = null;
  private flushPromise: Promise<void> | null = null;
  private batches = 0;
  private flushedItems = 0;

  constructor(options: WriteCoalescerOptions<T>) {
    this.maxBatch = normalizePositiveInteger(options.maxBatch ?? 1, 'maxBatch');
    this.flushDelayMs = normalizeNonNegativeInteger(options.flushDelayMs ?? 0, 'flushDelayMs');
    this.flushFn = options.flush;
  }

  enqueue(value: T): Promise<void> {
    const completion = new Promise<void>((resolve, reject) => {
      this.queue.push({ value, resolve, reject });
    });
    if (this.queue.length >= this.maxBatch) {
      this.scheduleFlush(0);
    } else {
      this.scheduleFlush(this.flushDelayMs);
    }
    return completion;
  }

  async flush(): Promise<void> {
    if (this.flushPromise) {
      return await this.flushPromise;
    }
    this.clearScheduledFlush();
    const running = this.drain();
    this.flushPromise = running;
    try {
      await running;
    } finally {
      this.flushPromise = null;
      if (this.queue.length > 0) {
        this.scheduleFlush(this.flushDelayMs);
      }
    }
  }

  getStats(): WriteCoalescerStats {
    return { queued: this.queue.length, batches: this.batches, flushedItems: this.flushedItems };
  }

  private async drain(): Promise<void> {
    while (this.queue.length > 0) {
      const batch = this.queue.splice(0, Math.min(this.maxBatch, this.queue.length));
      try {
        await this.flushFn(batch.map((entry) => entry.value));
        this.batches += 1;
        this.flushedItems += batch.length;
        for (const entry of batch) entry.resolve();
      } catch (error) {
        // A failed batch rejects every caller in it. Later queued batches remain
        // eligible so unrelated writes do not inherit an earlier failure.
        for (const entry of batch) entry.reject(error);
      }
    }
  }

  private scheduleFlush(delayMs: number): void {
    if (this.scheduledFlush || this.flushPromise) return;
    const handle = setTimeout(() => {
      this.scheduledFlush = null;
      void this.flush();
    }, delayMs);
    (handle as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();
    this.scheduledFlush = handle;
  }

  private clearScheduledFlush(): void {
    if (!this.scheduledFlush) return;
    clearTimeout(this.scheduledFlush);
    this.scheduledFlush = null;
  }
}