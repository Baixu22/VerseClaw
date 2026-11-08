/**
 * Deterministic latency feedback with bounded demand-driven growth.
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

export type AdaptivePhase = 'unknown' | 'read' | 'execution' | 'remote-wait';
type PhaseSample = { short: number; long: number; healthy: number; slow: number; samples: number };

export class AdaptiveLimit {
  private readonly options: Required<AdaptiveLimitOptions>;
  private current: number;
  private readonly phases = new Map<AdaptivePhase, PhaseSample>();
  private pressured = false;
  private recoverySamples = 0;

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
    if (!Number.isFinite(tolerance) || !Number.isFinite(minChangeRatio)
      || tolerance < 0 || minChangeRatio < 0 || minChangeRatio >= 1) {
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

  sample(latencyMs: number, queueSize = 0, phase: AdaptivePhase = 'unknown'): number {
    if (!Number.isFinite(latencyMs) || latencyMs <= 0 || !Number.isFinite(queueSize) || queueSize < 0) {
      throw new RangeError('latencyMs and queueSize must be finite and non-negative');
    }
    if (!['unknown', 'read', 'execution', 'remote-wait'].includes(phase)) throw new RangeError('invalid execution phase');
    const sample = this.phases.get(phase) ?? { short: latencyMs, long: latencyMs, healthy: 0, slow: 0, samples: 0 };
    sample.short += this.options.smoothing * (latencyMs - sample.short);
    sample.samples += 1;
    this.phases.set(phase, sample);
    // Remote service time is recorded but does not tune local execution capacity.
    if (phase === 'remote-wait') return this.current;
    const threshold = sample.long + Math.max(1, sample.long * this.options.tolerance);
    // Millisecond quantization and isolated spawn/GC pauses must not collapse a
    // healthy account. Require two consecutive slow completions of this phase.
    const degraded = sample.short > threshold && latencyMs > threshold;
    if (degraded) {
      sample.healthy = 0;
      sample.slow += 1;
      if (sample.slow < 2) return this.current;
      this.recoverySamples = 3;
      const gradient = Math.max(0.5, sample.long / sample.short);
      return this.change(Math.floor(this.current * gradient));
    }
    sample.slow = 0;
    // Do not teach the baseline to accept an overloaded service time.
    sample.long += (this.options.smoothing / 5) * (latencyMs - sample.long);
    if (this.pressured) { sample.healthy = 0; return this.current; }
    if (this.recoverySamples > 0) {
      this.recoverySamples -= 1;
      sample.healthy = 0;
      return this.current;
    }
    sample.healthy = queueSize > 0 ? sample.healthy + 1 : 0;
    if (sample.healthy >= 3) {
      sample.healthy = 0;
      return this.change(this.current + 1);
    }
    return this.current;
  }

  setPressure(active: boolean): number {
    if (active === this.pressured) return this.current;
    this.pressured = active;
    this.recoverySamples = 3;
    for (const sample of this.phases.values()) sample.healthy = 0;
    return active ? this.change(Math.floor(this.current / 2)) : this.current;
  }

  private change(value: number): number {
    const target = Math.max(this.options.minLimit, Math.min(this.options.maxLimit, value));
    // Growth already requires sustained healthy demand; applying a relative
    // dead zone to one-slot steps would make larger configured caps unreachable.
    if (target > this.current || Math.abs(target - this.current) / this.current >= this.options.minChangeRatio) this.current = target;
    return this.current;
  }

  getDiagnostics(): { pressured: boolean; phases: Partial<Record<AdaptivePhase, PhaseSample>> } {
    return { pressured: this.pressured, phases: Object.fromEntries([...this.phases].map(([phase, sample]) => [phase, { ...sample }])) };
  }

  get limit(): number {
    return this.current;
  }
}
