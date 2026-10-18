export type DrfUsage = {
  processes: number;
  concurrency: number;
};

export type ResourceCapacity = {
  processes: number;
  concurrency: number;
};

const ZERO: DrfUsage = { processes: 0, concurrency: 0 };

/** DRF-lite share accounting for the two bounded scalar resources. */
export class DrfShare {
  private readonly capacity: ResourceCapacity;
  private readonly usage = new Map<string, DrfUsage>();

  constructor(capacity: ResourceCapacity) {
    if (!Number.isFinite(capacity.processes) || capacity.processes <= 0
      || !Number.isFinite(capacity.concurrency) || capacity.concurrency <= 0) {
      throw new RangeError('capacity must be positive');
    }
    this.capacity = { ...capacity };
  }

  reserve(tenant: string, delta: Partial<DrfUsage> = {}): DrfUsage {
    if (!tenant.trim()) throw new TypeError('tenant is required');
    const next = this.calculate(tenant, delta);
    if (Object.values(next).some((value) => value < 0)) throw new RangeError('usage cannot be negative');
    if (next.processes > this.capacity.processes || next.concurrency > this.capacity.concurrency) {
      throw new RangeError('reservation exceeds capacity');
    }
    this.usage.set(tenant, next);
    return { ...next };
  }

  release(tenant: string, delta: Partial<DrfUsage> = {}): DrfUsage {
    return this.reserve(tenant, {
      processes: -(delta.processes ?? 0),
      concurrency: -(delta.concurrency ?? 0),
    });
  }

  share(tenant: string): number {
    const usage = this.usage.get(tenant) ?? ZERO;
    return Math.max(usage.processes / this.capacity.processes, usage.concurrency / this.capacity.concurrency);
  }

  dominantTenant(): string | null {
    let winner: string | null = null;
    let highest = -1;
    for (const tenant of this.usage.keys()) {
      const value = this.share(tenant);
      if (value > highest) {
        highest = value;
        winner = tenant;
      }
    }
    return winner;
  }

  isFair(maxRatio = 2): boolean {
    const active = [...this.usage.values()].filter((value) => value.processes > 0 || value.concurrency > 0);
    if (active.length <= 1) return true;
    const average = active.reduce((sum, value) => sum + Math.max(
      value.processes / this.capacity.processes,
      value.concurrency / this.capacity.concurrency,
    ), 0) / active.length;
    if (average === 0) return true;
    return active.every((value) => Math.max(
      value.processes / this.capacity.processes,
      value.concurrency / this.capacity.concurrency,
    ) <= average * maxRatio + 1e-9);
  }

  private calculate(tenant: string, delta: Partial<DrfUsage>): DrfUsage {
    const current = this.usage.get(tenant) ?? ZERO;
    return {
      processes: current.processes + (delta.processes ?? 0),
      concurrency: current.concurrency + (delta.concurrency ?? 0),
    };
  }
}
