/**
 * Deterministic Gradient2-style limit controller.
 * The caller supplies observed latency and queue depth; this class owns no timers.
 */
export type AdaptiveLimitOptions = {
  initialLimit: number;
  minLimit: number;
  maxLimit: number;
  smoothing?: number;
  tolerance?: number;
  minChangeRatio?: number;
};

export class AdaptiveLimit {
  private readonly options: Required<AdaptiveLimitOptions>;
  private current: number;
  private shortAverage: number | null = null;
  private longAverage: number | null = null;

  constructor(options: AdaptiveLimitOptions) {
    const smooth = options.smoothing ?? 0.2;
    if (!Number.isFinite(smooth) || smooth <= 0 || smooth > 1) {
      throw new RangeError('smoothing must be in (0, 1]');
    }
    if (!Number.isInteger(options.minLimit) || options.minLimit < 1
      || !Number.isInteger(options.maxLimit) || options.maxLimit < options.minLimit
      || !Number.isInteger(options.initialLimit)
      || options.initialLimit < options.minLimit || options.initialLimit > options.maxLimit) {
      throw new RangeError('adaptive limit bounds are invalid');
    }
    const tolerance = options.tolerance ?? 0.1;
    const minChangeRatio = options.minChangeRatio ?? 0.1;
    if (tolerance < 0 || minChangeRatio < 0 || minChangeRatio >= 1) {
      throw new RangeError('adaptive limit tolerances are invalid');
    }
    this.options = {
      initialLimit: options.initialLimit,
      minLimit: options.minLimit,
      maxLimit: options.maxLimit,
      smoothing: smooth,
      tolerance,
      minChangeRatio,
    };
    this.current = options.initialLimit;
  }

  sample(latencyMs: number, queueSize = 0): number {
    if (!Number.isFinite(latencyMs) || latencyMs <= 0 || !Number.isFinite(queueSize) || queueSize < 0) {
      throw new RangeError('latencyMs and queueSize must be finite and non-negative');
    }
    this.shortAverage = this.shortAverage == null
      ? latencyMs
      : this.shortAverage + this.options.smoothing * (latencyMs - this.shortAverage);
    this.longAverage = this.longAverage == null
      ? latencyMs
      : this.longAverage + (this.options.smoothing / 5) * (latencyMs - this.longAverage);
    // Gradient2: allow contraction when short latency rises above the long
    // average, but clamp expansion to 1 so only queue depth grows the limit.
    const gradient = Math.min(1, Math.max(0.5, this.longAverage / this.shortAverage));
    const target = Math.max(
      this.options.minLimit,
      Math.min(this.options.maxLimit, Math.floor(this.current * gradient + queueSize)),
    );
    if (Math.abs(target - this.current) / this.current < this.options.minChangeRatio) {
      return this.current;
    }
    this.current = target;
    return this.current;
  }

  get limit(): number {
    return this.current;
  }
}
