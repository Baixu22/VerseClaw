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
    this.capacity = { ...capacity };
    this.setCapacity(capacity);
  }

  /** Shrinking capacity keeps existing liabilities; only new reservations wait. */
  setCapacity(capacity: ResourceCapacity): void {
    if (!Number.isSafeInteger(capacity.processes) || capacity.processes <= 0
      || !Number.isSafeInteger(capacity.concurrency) || capacity.concurrency <= 0) {
      throw new RangeError('capacity must be a positive integer');
    }
    Object.assign(this.capacity, capacity);
  }

  reserve(tenant: string, delta: Partial<DrfUsage> = {}): DrfUsage {
    const reserved = this.tryReserve(tenant, delta);
    if (!reserved) throw new RangeError('reservation exceeds capacity');
    return reserved;
  }

  /** Check every tenant and commit both dimensions together, without an await. */
  tryReserve(tenant: string, delta: Partial<DrfUsage> = {}): DrfUsage | undefined {
    if (!tenant.trim()) throw new TypeError('tenant is required');
    if (!Number.isSafeInteger(delta.processes ?? 0) || !Number.isSafeInteger(delta.concurrency ?? 0)) {
      throw new RangeError('resource usage must be a finite integer');
    }
    const next = this.calculate(tenant, delta);
    if (Object.values(next).some((value) => value < 0)) throw new RangeError('usage cannot be negative');
    const total = { ...next };
    for (const [owner, used] of this.usage) {
      if (owner === tenant) continue;
      total.processes += used.processes;
      total.concurrency += used.concurrency;
    }
    const increasing = (delta.processes ?? 0) > 0 || (delta.concurrency ?? 0) > 0;
    if (increasing && (total.processes > this.capacity.processes || total.concurrency > this.capacity.concurrency)) {
      return undefined;
    }
    if (next.processes === 0 && next.concurrency === 0) this.usage.delete(tenant);
    else this.usage.set(tenant, next);
    return { ...next };
  }

  release(tenant: string, delta: Partial<DrfUsage> = {}): DrfUsage {
    if ((delta.processes ?? 0) < 0 || (delta.concurrency ?? 0) < 0) throw new RangeError('release cannot reserve usage');
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
