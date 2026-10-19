/**
 * Cooperative ResourceFabric for Main-process admission control.
 *
 * The fabric owns the only queue/limit state for workspace exec and
 * chat.history. The legacy lease/backpressure queues are removed; all state
 * transitions land in the shadow resource-envelope ledger.
 */
import {
  AdaptiveLimit,
  DrfShare,
  PriorityQueue,
  Singleflight,
  type QosClass,
} from '../../shared/resources';
import { getResourceEnvelopeLedger } from '../../openclaw_runtime/src/resources/resource-envelope';
import type { ResourceKind, ResourceLimitEvent } from '../../shared/types/resources';

export type FabricResource = 'workspaceExec' | 'chatHistory';

export type GatewayRpcRunner = (
  method: string,
  params?: unknown,
  timeoutMs?: number,
) => Promise<unknown>;

export type FabricLease = {
  leaseKind: FabricResource;
  leaseKey: string;
  queuedMs: number;
  qos: QosClass;
  limit: number;
  release: () => void;
};

export type TerminalResourceLease = FabricLease & { leaseKind: 'workspaceExec' };

export class ResourceFabricTimeoutError extends Error {
  readonly code: string;
  readonly leaseKind: FabricResource;
  readonly leaseKey: string;
  readonly timeoutMs: number;

  constructor(params: { resource: FabricResource; leaseKey: string; timeoutMs: number }) {
    super(
      params.resource === 'workspaceExec'
        ? `Timed out waiting for workspaceExec lease (${params.leaseKey}) after ${params.timeoutMs}ms`
        : `Timed out waiting for chat.history admission (${params.leaseKey}) after ${params.timeoutMs}ms`,
    );
    this.name = 'ResourceFabricTimeoutError';
    this.code = params.resource === 'workspaceExec'
      ? 'TERMINAL_RESOURCE_LEASE_TIMEOUT'
      : 'RESOURCE_FABRIC_TIMEOUT';
    this.leaseKind = params.resource;
    this.leaseKey = params.leaseKey;
    this.timeoutMs = params.timeoutMs;
  }
}

export function isResourceFabricTimeoutError(error: unknown): error is ResourceFabricTimeoutError {
  return error instanceof ResourceFabricTimeoutError;
}

export function isTerminalResourceLeaseTimeoutError(
  error: unknown,
): error is ResourceFabricTimeoutError & { leaseKind: 'workspaceExec' } {
  return error instanceof ResourceFabricTimeoutError && error.leaseKind === 'workspaceExec';
}

type FabricAccountConfig = {
  kind: ResourceKind;
  minLimit: number;
  maxLimit: number;
  initialLimit: number;
  queueLength: number;
  defaultTimeoutMs: number;
  minChangeRatio: number;
  tolerance: number;
  agePromotionMs: number;
};

export type ResourceFabricOptions = {
  now?: () => number;
  accounts?: Partial<Record<FabricResource, Partial<FabricAccountConfig>>>;
};

type FabricAccountDiagnostics = {
  active: number;
  queued: number;
  limit: number;
  minLimit: number;
  maxLimit: number;
  activeByQos: Record<QosClass, number>;
  limitHistory: ResourceLimitEvent[];
};

type Waiter = {
  id: number;
  resource: FabricResource;
  key: string;
  tenant: string;
  qos: QosClass;
  requestedAt: number;
  timeoutMs: number;
  resolve: (lease: FabricLease) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
  settled: boolean;
};

const DEFAULT_ACCOUNTS: Record<FabricResource, FabricAccountConfig> = {
  workspaceExec: {
    kind: 'terminal-exec',
    minLimit: 1,
    maxLimit: 4,
    initialLimit: 2,
    queueLength: 64,
    defaultTimeoutMs: 30_000,
    minChangeRatio: 0.1,
    tolerance: 0.1,
    agePromotionMs: 30_000,
  },
  chatHistory: {
    kind: 'chat-history',
    minLimit: 1,
    maxLimit: 4,
    initialLimit: 2,
    queueLength: 64,
    defaultTimeoutMs: 30_000,
    minChangeRatio: 0.1,
    tolerance: 0.1,
    agePromotionMs: 30_000,
  },
};

const ZERO_QOS: Record<QosClass, number> = {
  interactive: 0,
  background: 0,
  opportunistic: 0,
};

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

function asTenant(params: unknown, fallback: string): string {
  if (params && typeof params === 'object' && !Array.isArray(params)) {
    const sessionKey = (params as Record<string, unknown>).sessionKey;
    if (typeof sessionKey === 'string' && sessionKey.trim()) return sessionKey;
  }
  return fallback;
}

class FabricAccount {
  private readonly limit: AdaptiveLimit;
  private readonly queue: PriorityQueue<Waiter>;
  private readonly activeQos: Record<QosClass, number> = { ...ZERO_QOS };
  private readonly limitHistory: ResourceLimitEvent[] = [];
  private active = 0;
  private nextWaiterId = 1;

  constructor(
    private readonly resource: FabricResource,
    private readonly accountKey: string,
    private readonly ledgerId: string,
    private readonly workspaceKey: string,
    private readonly config: FabricAccountConfig,
    private readonly drf: DrfShare,
    private readonly now: () => number,
  ) {
    this.limit = new AdaptiveLimit({
      initialLimit: config.initialLimit,
      minLimit: config.minLimit,
      maxLimit: config.maxLimit,
      minChangeRatio: config.minChangeRatio,
      tolerance: config.tolerance,
    });
    this.queue = new PriorityQueue<Waiter>({
      agePromotionMs: config.agePromotionMs,
      now,
    });
    this.syncEnvelope();
  }

  acquire(options: { qos?: QosClass; timeoutMs?: number; tenant?: string } = {}): Promise<FabricLease> {
    const timeoutMs = Math.max(1, Math.floor(options.timeoutMs ?? this.config.defaultTimeoutMs));
    const qos = options.qos ?? 'interactive';
    const tenant = options.tenant?.trim() || this.accountKey;
    return new Promise<FabricLease>((resolve, reject) => {
      const waiter: Waiter = {
        id: this.nextWaiterId++,
        resource: this.resource,
        key: this.accountKey,
        tenant,
        qos,
        requestedAt: this.now(),
        timeoutMs,
        resolve,
        reject,
        timer: null,
        settled: false,
      };
      waiter.timer = setTimeout(() => {
        if (!this.queue.remove((candidate) => candidate === waiter)) return;
        waiter.settled = true;
        waiter.timer = null;
        this.syncEnvelope();
        waiter.reject(new ResourceFabricTimeoutError({
          resource: this.resource,
          leaseKey: this.accountKey,
          timeoutMs,
        }));
        this.drain();
      }, timeoutMs);
      this.queue.push(waiter, qos);
      if (qos === 'interactive' && this.hasLowerQosActive()) {
        this.queue.boost(waiter, 1_000);
      }
      this.syncEnvelope();
      this.drain();
    });
  }

  observeLatency(latencyMs: number, queueSize = 0): ResourceLimitEvent | null {
    const previous = this.limit.limit;
    const next = this.limit.sample(Math.max(1, latencyMs), Math.max(0, queueSize));
    if (next === previous) return null;
    const event: ResourceLimitEvent = {
      at: this.now(),
      from: previous,
      to: next,
      reason: 'gradient2 latency sample',
    };
    this.limitHistory.push(event);
    if (this.limitHistory.length > 64) this.limitHistory.splice(0, this.limitHistory.length - 64);
    this.syncEnvelope(0, `limit ${previous}->${next}`);
    return event;
  }

  diagnostics(): FabricAccountDiagnostics {
    return {
      active: this.active,
      queued: this.queue.size,
      limit: this.limit.limit,
      minLimit: this.config.minLimit,
      maxLimit: this.config.maxLimit,
      activeByQos: { ...this.activeQos },
      limitHistory: this.limitHistory.map((event) => ({ ...event })),
    };
  }

  resetForTest(): void {
    for (const waiter of this.queue.clear()) {
      if (waiter.timer) clearTimeout(waiter.timer);
      waiter.settled = true;
      waiter.timer = null;
    }
    this.active = 0;
    for (const qos of Object.keys(this.activeQos) as QosClass[]) this.activeQos[qos] = 0;
    this.limitHistory.length = 0;
  }

  private drain(): void {
    while (this.active < this.limit.limit) {
      const waiter = this.queue.dequeue();
      if (!waiter) return;
      if (waiter.settled) continue;
      this.grant(waiter);
    }
  }

  private grant(waiter: Waiter): void {
    this.active += 1;
    this.activeQos[waiter.qos] += 1;
    this.drf.reserve(waiter.tenant, { concurrency: 1 });
    const queuedMs = Math.max(0, this.now() - waiter.requestedAt);
    waiter.settled = true;
    if (waiter.timer) clearTimeout(waiter.timer);
    waiter.timer = null;
    let released = false;
    const startedAt = this.now();
    waiter.resolve({
      leaseKind: this.resource,
      leaseKey: this.accountKey,
      queuedMs,
      qos: waiter.qos,
      limit: this.limit.limit,
      release: () => {
        if (released) return;
        released = true;
        this.release(waiter, startedAt, queuedMs);
      },
    });
    this.syncEnvelope(queuedMs, 'admitted');
  }

  private release(waiter: Waiter, startedAt: number, queuedMs: number): void {
    this.active = Math.max(0, this.active - 1);
    this.activeQos[waiter.qos] = Math.max(0, this.activeQos[waiter.qos] - 1);
    this.drf.release(waiter.tenant, { concurrency: 1 });
    this.observeLatency(Math.max(1, this.now() - startedAt), this.queue.size);
    this.syncEnvelope(queuedMs, 'released');
    this.drain();
  }

  private hasLowerQosActive(): boolean {
    return this.activeQos.background > 0 || this.activeQos.opportunistic > 0;
  }

  private syncEnvelope(queueWaitMs = 0, reason?: string): void {
    const ledger = getResourceEnvelopeLedger();
    const previous = ledger.get(this.ledgerId);
    if (this.active === 0 && this.queue.size === 0 && this.limitHistory.length === 0) {
      ledger.remove(this.ledgerId);
      return;
    }
    ledger.update({
      id: this.ledgerId,
      workspaceKey: this.workspaceKey,
      kind: this.config.kind,
      priority: 'foreground',
      owner: 'main',
      activeSlots: this.active,
      queuedCount: this.queue.size,
      queueWaitMs: Math.max(previous?.queueWaitMs ?? 0, Math.max(0, Math.floor(queueWaitMs))),
      processCount: previous?.processCount ?? 0,
      treeRssBytes: previous?.treeRssBytes ?? 0,
      treeCpuPercent: previous?.treeCpuPercent ?? 0,
      limits: {
        concurrencySlots: this.limit.limit,
        queueLength: this.config.queueLength,
      },
      ...(this.limitHistory.length > 0
        ? { limitHistory: this.limitHistory.map((event) => ({ ...event })) }
        : {}),
      reason: reason ?? `${this.resource} admission`,
    });
  }
}

export class ResourceFabric {
  private readonly now: () => number;
  private readonly accountConfigs: Record<FabricResource, FabricAccountConfig>;
  private readonly accounts = new Map<string, FabricAccount>();
  private readonly drf = new DrfShare({ processes: 64, concurrency: 64 });
  private historyFlights = new Singleflight<string, unknown>();

  constructor(options: ResourceFabricOptions = {}) {
    this.now = options.now ?? Date.now;
    this.accountConfigs = {
      workspaceExec: { ...DEFAULT_ACCOUNTS.workspaceExec, ...options.accounts?.workspaceExec },
      chatHistory: { ...DEFAULT_ACCOUNTS.chatHistory, ...options.accounts?.chatHistory },
    };
  }

  acquire(
    resource: FabricResource,
    key: string,
    options: { qos?: QosClass; timeoutMs?: number; tenant?: string } = {},
  ): Promise<FabricLease> {
    if (!key.trim()) throw new TypeError('resource key is required');
    return this.accountFor(resource, key).acquire(options);
  }

  async runResource<T>(
    resource: FabricResource,
    key: string,
    options: { qos?: QosClass; timeoutMs?: number; tenant?: string } = {},
    work: (lease: FabricLease) => Promise<T>,
  ): Promise<T> {
    const lease = await this.acquire(resource, key, options);
    try {
      return await work(lease);
    } finally {
      lease.release();
    }
  }

  /** Gateway-facing compatibility surface: only chat.history is admitted. */
  run(
    method: string,
    params: unknown,
    timeoutMs: number | undefined,
    runner: GatewayRpcRunner,
  ): Promise<unknown> {
    if (method !== 'chat.history') return runner(method, params, timeoutMs);
    const requestKey = `${method}:${stableStringify(params)}:${timeoutMs ?? 'default'}`;
    return this.historyFlights.run(requestKey, () => this.runResource(
      'chatHistory',
      requestKey,
      {
        qos: 'interactive',
        timeoutMs: this.accountConfigs.chatHistory.defaultTimeoutMs,
        tenant: asTenant(params, requestKey),
      },
      () => runner(method, params, timeoutMs),
    ));
  }

  observeLatency(resource: FabricResource, key: string, latencyMs: number, queueSize = 0): ResourceLimitEvent | null {
    return this.accountFor(resource, key).observeLatency(latencyMs, queueSize);
  }

  isFair(maxRatio = 2): boolean {
    return this.drf.isFair(maxRatio);
  }

  getLimitEvents(): ResourceLimitEvent[] {
    return [...this.accounts.values()]
      .flatMap((account) => account.diagnostics().limitHistory)
      .sort((left, right) => left.at - right.at);
  }

  getDiagnostics(): {
    accounts: Record<string, FabricAccountDiagnostics>;
    chatHistory: FabricAccountDiagnostics | null;
    fair: boolean;
    limitEvents: ResourceLimitEvent[];
  } {
    const accounts: Record<string, FabricAccountDiagnostics> = {};
    for (const [key, account] of this.accounts) accounts[key] = account.diagnostics();
    return {
      accounts,
      chatHistory: accounts.chatHistory ?? null,
      fair: this.drf.isFair(),
      limitEvents: this.getLimitEvents(),
    };
  }

  resetForTest(): void {
    for (const account of this.accounts.values()) account.resetForTest();
    this.accounts.clear();
    this.historyFlights = new Singleflight<string, unknown>();
    const ledger = getResourceEnvelopeLedger();
    for (const entry of ledger.list()) {
      if (entry.owner === 'main' && (entry.kind === 'terminal-exec' || entry.kind === 'chat-history')) {
        ledger.remove(entry.id);
      }
    }
  }

  private accountFor(resource: FabricResource, key: string): FabricAccount {
    const accountKey = resource === 'chatHistory' ? 'chatHistory' : `workspaceExec:${key}`;
    const existing = this.accounts.get(accountKey);
    if (existing) return existing;
    const config = this.accountConfigs[resource];
    const account = new FabricAccount(
      resource,
      key,
      resource === 'chatHistory' ? 'main:chat-history' : `main:terminal-exec:${key}`,
      resource === 'chatHistory' ? 'main:chat-history' : key,
      config,
      this.drf,
      this.now,
    );
    this.accounts.set(accountKey, account);
    return account;
  }
}

const RESOURCE_FABRIC_GLOBAL_KEY = Symbol.for('openclaw.resourceFabric');
export function getResourceFabric(): ResourceFabric {
  const globalStore = globalThis as Record<PropertyKey, unknown>;
  const existing = globalStore[RESOURCE_FABRIC_GLOBAL_KEY];
  if (existing instanceof ResourceFabric) return existing;
  const created = new ResourceFabric();
  globalStore[RESOURCE_FABRIC_GLOBAL_KEY] = created;
  return created;
}

export const resourceFabric = getResourceFabric();

export async function withWorkspaceExecLease<T>(
  workspaceKey: string,
  timeoutMs: number,
  fn: (lease: TerminalResourceLease) => Promise<T>,
): Promise<T> {
  return resourceFabric.runResource(
    'workspaceExec',
    workspaceKey,
    { qos: 'interactive', timeoutMs, tenant: workspaceKey },
    async (lease) => fn(lease as TerminalResourceLease),
  );
}

export const TerminalResourceLeaseTimeoutError = ResourceFabricTimeoutError;

export function resetTerminalResourceLeasesForTest(): void {
  resourceFabric.resetForTest();
}
