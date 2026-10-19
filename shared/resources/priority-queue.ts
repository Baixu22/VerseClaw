export type QosClass = 'interactive' | 'background' | 'opportunistic';

export type PriorityItem<T> = {
  value: T;
  qos: QosClass;
  enqueuedAt: number;
  boostUntil?: number;
};

const RANK: Record<QosClass, number> = { interactive: 0, background: 1, opportunistic: 2 };

/** Stable QoS queue with explicit priority boost and opportunistic age promotion. */
export class PriorityQueue<T> {
  private readonly items: PriorityItem<T>[] = [];
  private readonly agePromotionMs: number;
  private readonly now: () => number;

  constructor(options: { agePromotionMs?: number; now?: () => number } = {}) {
    this.agePromotionMs = options.agePromotionMs ?? 30_000;
    this.now = options.now ?? Date.now;
  }

  push(value: T, qos: QosClass = 'background'): void {
    this.items.push({ value, qos, enqueuedAt: this.now() });
  }

  remove(predicate: (value: T) => boolean): boolean {
    const index = this.items.findIndex((item) => predicate(item.value));
    if (index < 0) return false;
    this.items.splice(index, 1);
    return true;
  }

  clear(): T[] {
    return this.items.splice(0).map((item) => item.value);
  }

  boost(value: T, durationMs: number): boolean {
    const item = this.items.find((entry) => entry.value === value);
    if (!item) return false;
    item.boostUntil = this.now() + Math.max(0, durationMs);
    return true;
  }

  dequeue(): T | undefined {
    if (this.items.length === 0) return undefined;
    const now = this.now();
    let selected = 0;
    for (let index = 1; index < this.items.length; index += 1) {
      if (this.compare(this.items[index], this.items[selected], now) < 0) selected = index;
    }
    return this.items.splice(selected, 1)[0]?.value;
  }

  peek(): T | undefined {
    if (this.items.length === 0) return undefined;
    const now = this.now();
    return [...this.items].sort((left, right) => this.compare(left, right, now))[0]?.value;
  }

  get size(): number {
    return this.items.length;
  }

  private compare(left: PriorityItem<T>, right: PriorityItem<T>, now: number): number {
    const leftRank = left.boostUntil && left.boostUntil > now ? -1 : this.ageRank(left, now);
    const rightRank = right.boostUntil && right.boostUntil > now ? -1 : this.ageRank(right, now);
    return leftRank - rightRank || left.enqueuedAt - right.enqueuedAt;
  }

  private ageRank(item: PriorityItem<T>, now: number): number {
    return item.qos === 'opportunistic' && now - item.enqueuedAt >= this.agePromotionMs
      ? RANK.background
      : RANK[item.qos];
  }
}
