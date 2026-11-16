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
  type AdaptivePhase,
} from '../../shared/resources';
import { getResourceEnvelopeLedger } from '../../openclaw_runtime/src/resources/resource-envelope';
import { RESOURCE_METRICS_TTL_MS, type ResourceKind, type ResourceLimitEvent, type ResourceEnvelopeSnapshot } from '../../shared/types/resources';
import { checkResourceWait, watchResourceWait, resourceQueueFullError, type ResourceWaitOptions } from '../../shared/resources/wait';
import { getHostDeadline, runWithHostDeadline } from '../utils/host-deadline-context';

export type FabricAcquireOptions = ResourceWaitOptions & { qos?: QosClass; timeoutMs?: number; tenant?: string; phase?: AdaptivePhase; operationKey?: string };

const PRESSURE_POLICY = { lowAvailableRatio: 0.10, recoveredAvailableRatio: 0.15, highCommitRatio: 0.90, recoveredCommitRatio: 0.80, recoveryDwellMs: 10_000, idleAccountMs: 300_000 };
type PressureReason = 'physical-memory' | 'system-commit' | 'event-loop';
type PressureSignal = { sampledAt: number; observedAt: number; active: boolean; lowSince: number | null; available: boolean };

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
  deadline: number;
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
  queueLimit: number;
  activeByQos: Record<QosClass, number>;
  limitHistory: ResourceLimitEvent[];
  feedback: ReturnType<AdaptiveLimit['getDiagnostics']>;
};

type Waiter = {
  id: number;
  resource: FabricResource;
  key: string;
  tenant: string;
  qos: QosClass;
  phase: AdaptivePhase;
  operationKey?: string;
  requestedAt: number;
  timeoutMs: number;
  deadline: number;
  signal?: AbortSignal;
  resolve: (lease: FabricLease) => void;
  reject: (error: Error) => void;
  cleanup: () => void;
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
  private lastActivityAt: number;

  constructor(
    private readonly resource: FabricResource,
    private readonly accountKey: string,
    private readonly ledgerId: string,
    private readonly workspaceKey: string,
    private readonly config: FabricAccountConfig,
    private readonly drf: DrfShare,
    private readonly now: () => number,
    private readonly wakeAccounts: () => void,
  ) {
    this.lastActivityAt = now();
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
      tieBreak: (left, right) => drf.share(left.tenant) - drf.share(right.tenant),
    });
    this.syncEnvelope();
  }

  acquire(options: FabricAcquireOptions = {}): Promise<FabricLease> {
    this.lastActivityAt = this.now();
    const timeoutMs = Math.max(1, Math.floor(options.timeoutMs ?? this.config.defaultTimeoutMs));
    const qos = options.qos ?? 'interactive';
    const tenant = options.tenant?.trim() || this.accountKey;
    return new Promise<FabricLease>((resolve, reject) => {
      if (options.operationKey !== undefined && (typeof options.operationKey !== 'string' || options.operationKey.length < 1 || options.operationKey.length > 64)) throw new RangeError('invalid operation key');
      const deadline = Math.min(this.now() + timeoutMs, options.deadline ?? Infinity);
      const expired = () => new ResourceFabricTimeoutError({ resource: this.resource, leaseKey: this.accountKey, timeoutMs });
      checkResourceWait({ signal: options.signal, deadline }, expired, this.now);
      this.wakeAccounts();
      const waiter: Waiter = {
        id: this.nextWaiterId++,
        resource: this.resource,
        key: this.accountKey,
        tenant,
        qos,
        phase: options.phase ?? 'unknown',
        operationKey: options.operationKey,
        requestedAt: this.now(),
        timeoutMs,
        deadline,
        signal: options.signal,
        resolve,
        reject,
        cleanup: () => {},
        settled: false,
      };
      if (this.queue.size === 0 && this.active < this.limit.limit && this.grant(waiter)) return;
      if (this.queue.size >= this.config.queueLength) {
        reject(resourceQueueFullError());
        return;
      }
      this.queue.push(waiter, qos);
      waiter.cleanup = watchResourceWait(waiter, error => {
        this.reject(waiter, error);
        this.wakeAccounts();
      }, expired, this.now);
      if (waiter.settled) waiter.cleanup();
      if (qos === 'interactive' && this.hasLowerQosActive()) {
        this.queue.boost(waiter, 1_000);
      }
      this.syncEnvelope();
      this.drain();
    });
  }

  observeLatency(latencyMs: number, queueSize = 0, phase: AdaptivePhase = 'unknown', operationKey?: string): ResourceLimitEvent | null {
    const previous = this.limit.limit;
    const next = this.limit.sample(Math.max(1, latencyMs), Math.max(0, queueSize), phase, operationKey);
    return this.recordLimit(previous, next, `${phase}${operationKey ? ':' + operationKey : ''} latency feedback`);
  }

  setPressure(active: boolean): void {
    const previous = this.limit.limit;
    this.recordLimit(previous, this.limit.setPressure(active), 'fresh resource pressure');
  }

  reclaimIfIdle(): boolean {
    if (this.active || this.queue.size || this.now() - this.lastActivityAt < PRESSURE_POLICY.idleAccountMs) return false;
    getResourceEnvelopeLedger().remove(this.ledgerId);
    return true;
  }

  private recordLimit(previous: number, next: number, reason: string): ResourceLimitEvent | null {
    if (next === previous) return null;
    const event: ResourceLimitEvent = {
      at: this.now(),
      from: previous,
      to: next,
      reason,
    };
    this.limitHistory.push(event);
    if (this.limitHistory.length > 64) this.limitHistory.splice(0, this.limitHistory.length - 64);
    this.syncEnvelope(0, `limit ${previous}->${next}`);
    return event;
  }

  diagnostics(): FabricAccountDiagnostics {
    this.syncEnvelope();
    return {
      active: this.active,
      queued: this.queue.size,
      limit: this.limit.limit,
      minLimit: this.config.minLimit,
      maxLimit: this.config.maxLimit,
      queueLimit: this.config.queueLength,
      activeByQos: { ...this.activeQos },
      limitHistory: this.limitHistory.map((event) => ({ ...event })),
      feedback: this.limit.getDiagnostics(),
    };
  }

  resetForTest(): void {
    for (const waiter of this.queue.clear()) {
      this.reject(waiter, new DOMException('Resource owner reset', 'AbortError'));
    }
    this.active = 0;
    for (const qos of Object.keys(this.activeQos) as QosClass[]) this.activeQos[qos] = 0;
    this.limitHistory.length = 0;
  }

  get oldestWaiterAt(): number {
    return this.queue.peek()?.requestedAt ?? Number.POSITIVE_INFINITY;
  }

  get waitingPriority(): number { return this.queue.peekPriority(); }
  get waitingShare(): number {
    const waiter = this.queue.peek();
    return waiter ? this.drf.share(waiter.tenant) : Number.POSITIVE_INFINITY;
  }

  drain(maxGrants = Number.POSITIVE_INFINITY): number {
    let processed = 0;
    while (this.active < this.limit.limit && processed < maxGrants) {
      const waiter = this.queue.peek();
      if (!waiter) break;
      if (waiter.settled) { this.queue.remove(candidate => candidate === waiter); continue; }
      if (!this.grant(waiter)) break;
      processed += 1;
    }
    return processed;
  }

  private grant(waiter: Waiter): boolean {
    try {
      checkResourceWait(waiter, () => new ResourceFabricTimeoutError({
        resource: this.resource, leaseKey: this.accountKey, timeoutMs: waiter.timeoutMs,
      }), this.now);
    } catch (error) { this.reject(waiter, error as Error); return true; }
    // Reserve globally only after wait validity is checked; a refusal remains queued.
    if (!this.drf.tryReserve(waiter.tenant, { concurrency: 1 })) return false;
    this.queue.remove(candidate => candidate === waiter);
    this.active += 1;
    this.activeQos[waiter.qos] += 1;
    const queuedMs = Math.max(0, this.now() - waiter.requestedAt);
    waiter.settled = true;
    waiter.cleanup();
    let released = false;
    const startedAt = this.now();
    waiter.resolve({
      leaseKind: this.resource,
      leaseKey: this.accountKey,
      queuedMs,
      qos: waiter.qos,
      limit: this.limit.limit,
      deadline: waiter.deadline,
      release: () => {
        if (released) return;
        released = true;
        this.release(waiter, startedAt, queuedMs);
      },
    });
    this.syncEnvelope(queuedMs, 'admitted');
    return true;
  }

  private reject(waiter: Waiter, error: Error): void {
    if (waiter.settled) return;
    waiter.settled = true;
    this.lastActivityAt = this.now();
    this.queue.remove(candidate => candidate === waiter);
    waiter.cleanup();
    waiter.reject(error);
    this.syncEnvelope();
  }

  private release(waiter: Waiter, startedAt: number, queuedMs: number): void {
    this.lastActivityAt = this.now();
    this.active = Math.max(0, this.active - 1);
    this.activeQos[waiter.qos] = Math.max(0, this.activeQos[waiter.qos] - 1);
    this.drf.release(waiter.tenant, { concurrency: 1 });
    this.observeLatency(Math.max(1, this.now() - startedAt), this.queue.size, waiter.phase, waiter.operationKey);
    this.syncEnvelope(queuedMs, 'released');
    this.wakeAccounts();
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
  private drf = new DrfShare({ processes: 64, concurrency: 64 });
  private historyFlights = new Singleflight<string, unknown>();
  private readonly pressureSignals = new Map<PressureReason, PressureSignal>();

  constructor(options: ResourceFabricOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.accountConfigs = {
      workspaceExec: { ...DEFAULT_ACCOUNTS.workspaceExec, ...options.accounts?.workspaceExec },
      chatHistory: { ...DEFAULT_ACCOUNTS.chatHistory, ...options.accounts?.chatHistory },
    };
    for (const config of Object.values(this.accountConfigs)) {
      if (!Number.isInteger(config.queueLength) || config.queueLength < 0) throw new RangeError('Invalid queueLength');
    }
  }

  acquire(
    resource: FabricResource,
    key: string,
    options: FabricAcquireOptions = {},
  ): Promise<FabricLease> {
    if (!key.trim()) throw new TypeError('resource key is required');
    return this.accountFor(resource, key).acquire(options);
  }

  async runResource<T>(
    resource: FabricResource,
    key: string,
    options: FabricAcquireOptions = {},
    work: (lease: FabricLease) => Promise<T>,
  ): Promise<T> {
    const lease = await this.acquire(resource, key, options);
    const expired = () => new ResourceFabricTimeoutError({ resource, leaseKey: key, timeoutMs: options.timeoutMs ?? this.accountConfigs[resource].defaultTimeoutMs });
    try {
      checkResourceWait({ signal: options.signal, deadline: lease.deadline }, expired, this.now);
      // Once started, the execution owner decides completion and cancellation.
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
    options: ResourceWaitOptions = {},
  ): Promise<unknown> {
    if (method !== 'chat.history') return runner(method, params, timeoutMs);
    const requestKey = `${method}:${stableStringify(params)}:${timeoutMs ?? 'default'}`;
    const budget = timeoutMs ?? this.accountConfigs.chatHistory.defaultTimeoutMs;
    const deadline = this.now() + budget;
    const callerDeadline = Math.min(options.deadline ?? Infinity, getHostDeadline()?.deadlineAtMs ?? Infinity);
    // Shared execution owns its budget; a caller's ambient deadline belongs to
    // that subscriber and must not shorten another subscriber's Gateway RPC.
    return this.historyFlights.run(requestKey, signal => runWithHostDeadline(
      { deadlineAtMs: deadline, timeoutMs: budget, stage: 'main' },
      () => this.runResource(
      'chatHistory',
      requestKey,
      {
        qos: 'interactive',
        phase: 'read',
        timeoutMs: this.accountConfigs.chatHistory.defaultTimeoutMs,
        tenant: asTenant(params, requestKey),
        signal,
        deadline,
      },
      () => {
        const remaining = deadline - this.now();
        if (remaining <= 0) throw new ResourceFabricTimeoutError({ resource: 'chatHistory', leaseKey: requestKey, timeoutMs: timeoutMs ?? this.accountConfigs.chatHistory.defaultTimeoutMs });
        return runner(method, params, remaining);
      },
    )), {
      ...options,
      deadline: callerDeadline === Infinity ? undefined : callerDeadline,
      expired: () => new ResourceFabricTimeoutError({ resource: 'chatHistory', leaseKey: requestKey, timeoutMs: budget }),
    });
  }

  observeLatency(resource: FabricResource, key: string, latencyMs: number, queueSize = 0, phase: AdaptivePhase = 'unknown', operationKey?: string): ResourceLimitEvent | null {
    return this.accountFor(resource, key).observeLatency(latencyMs, queueSize, phase, operationKey);
  }

  observePressure(snapshot: Pick<ResourceEnvelopeSnapshot, 'machineMemory' | 'machineCommit' | 'eventLoopPressure'>): void {
    const now = this.now();
    const update = (reason: PressureReason, at: number | undefined, high: boolean, low: boolean, valid: boolean) => {
      const state = this.pressureSignals.get(reason) ?? { sampledAt: -Infinity, observedAt: -Infinity, active: false, lowSince: null, available: false };
      state.available = valid && at != null && Number.isFinite(at) && at >= state.sampledAt && at <= now && now - at <= RESOURCE_METRICS_TTL_MS;
      this.pressureSignals.set(reason, state);
      if (!state.available) { state.lowSince = null; return; }
      // Cached observations keep continuity while fresh, but only a new sample
      // can complete recovery. The process probe refreshes on a slower cadence.
      if (now - state.observedAt > RESOURCE_METRICS_TTL_MS) state.lowSince = null;
      state.observedAt = now;
      if (at! <= state.sampledAt) return;
      state.sampledAt = at!;
      if (high) { state.active = true; state.lowSince = null; }
      else if (low && state.active) {
        state.lowSince ??= at!;
        if (at! - state.lowSince >= PRESSURE_POLICY.recoveryDwellMs) { state.active = false; state.lowSince = null; }
      } else state.lowSince = null;
    };
    const memory = snapshot.machineMemory;
    const available = memory ? memory.availablePhysicalBytes / memory.totalPhysicalBytes : NaN;
    update('physical-memory', memory?.sampledAt, available <= PRESSURE_POLICY.lowAvailableRatio, available >= PRESSURE_POLICY.recoveredAvailableRatio,
      Number.isFinite(available) && available >= 0 && available <= 1 && Number.isFinite(memory?.totalPhysicalBytes) && memory!.totalPhysicalBytes > 0);
    const commit = snapshot.machineCommit;
    const committed = commit ? commit.committedBytes / commit.commitLimitBytes : NaN;
    update('system-commit', commit?.sampledAt, committed >= PRESSURE_POLICY.highCommitRatio, committed <= PRESSURE_POLICY.recoveredCommitRatio,
      Number.isFinite(committed) && committed >= 0 && Number.isFinite(commit?.commitLimitBytes) && commit!.commitLimitBytes > 0);
    const loop = snapshot.eventLoopPressure;
    update('event-loop', loop?.sampledAt, loop?.degraded === true, loop?.degraded === false,
      !!loop?.ownerEpoch && typeof loop.degraded === 'boolean' && Number.isFinite(loop.delayP99Ms) && loop.delayP99Ms >= 0
        && Number.isFinite(loop.utilization) && loop.utilization >= 0 && loop.utilization <= 1);
    const active = [...this.pressureSignals.values()].some(signal => signal.active);
    for (const account of this.accounts.values()) account.setPressure(active);
    this.reclaimIdleAccounts();
  }

  clearObservationPressure(): void {
    this.pressureSignals.clear();
    for (const account of this.accounts.values()) account.setPressure(false);
  }

  reclaimIdleAccounts(): number {
    let reclaimed = 0;
    for (const [key, account] of this.accounts) if (account.reclaimIfIdle()) { this.accounts.delete(key); reclaimed += 1; }
    return reclaimed;
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
    pressure: { reasons: PressureReason[]; signals: Partial<Record<PressureReason, PressureSignal>>; policy: typeof PRESSURE_POLICY; disabledSignals: string[] };
  } {
    const accounts: Record<string, FabricAccountDiagnostics> = {};
    for (const [key, account] of this.accounts) accounts[key] = account.diagnostics();
    return {
      accounts,
      chatHistory: accounts.chatHistory ?? null,
      fair: this.drf.isFair(),
      limitEvents: this.getLimitEvents(),
      pressure: {
        reasons: [...this.pressureSignals].filter(([, signal]) => signal.active).map(([reason]) => reason),
        signals: Object.fromEntries([...this.pressureSignals].map(([reason, signal]) => [reason, { ...signal, available: signal.available && this.now() - signal.sampledAt <= RESOURCE_METRICS_TTL_MS }])),
        policy: { ...PRESSURE_POLICY },
        disabledSignals: ['cpu-utilization-only', 'system-io-wait', ...(['physical-memory', 'system-commit', 'event-loop'] as const)
          .filter(reason => { const signal = this.pressureSignals.get(reason); return !signal?.available || this.now() - signal.sampledAt > RESOURCE_METRICS_TTL_MS; })],
      },
    };
  }

  resetForTest(): void {
    for (const account of this.accounts.values()) account.resetForTest();
    this.accounts.clear();
    this.pressureSignals.clear();
    this.drf = new DrfShare({ processes: 64, concurrency: 64 });
    this.historyFlights = new Singleflight<string, unknown>();
    const ledger = getResourceEnvelopeLedger();
    for (const entry of ledger.list()) {
      if (entry.owner === 'main' && (entry.kind === 'terminal-exec' || entry.kind === 'chat-history')) {
        ledger.remove(entry.id);
      }
    }
  }

  private accountFor(resource: FabricResource, key: string): FabricAccount {
    this.reclaimIdleAccounts();
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
      () => {
        // Re-evaluate shares after each grant so one account cannot consume a
        // whole release wave ahead of equally prioritized tenants.
        for (;;) {
          const waiting = [...this.accounts.values()].filter(account => Number.isFinite(account.oldestWaiterAt))
            .sort((a, b) => a.waitingPriority - b.waitingPriority
              || (a.waitingPriority < 0 ? 0 : a.waitingShare - b.waitingShare)
              || a.oldestWaiterAt - b.oldestWaiterAt);
          if (!waiting.some(account => account.drain(1) > 0)) break;
        }
      },
    );
    this.accounts.set(accountKey, account);
    account.setPressure([...this.pressureSignals.values()].some(signal => signal.active));
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
  options: ResourceWaitOptions & { phase?: AdaptivePhase; operationKey?: string } = {},
): Promise<T> {
  return resourceFabric.runResource(
    'workspaceExec',
    workspaceKey,
    { qos: 'interactive', timeoutMs, tenant: workspaceKey, ...options },
    async (lease) => fn(lease as TerminalResourceLease),
  );
}

export const TerminalResourceLeaseTimeoutError = ResourceFabricTimeoutError;

export function resetTerminalResourceLeasesForTest(): void {
  resourceFabric.resetForTest();
}
