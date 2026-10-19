/**
 * Cooperative keep-alive HTTP pool for Main-process Node fetches.
 *
 * Direct Electron requests use this pool. When a fixed proxy is configured the
 * proxy-aware wrapper keeps Electron net.fetch so proxy bypass rules and
 * certificate handling remain owned by Chromium. The pool keeps one undici
 * Agent, caches DNS answers with a TTL, and exposes bounded metrics through the
 * shadow resource-envelope ledger.
 */
import { lookup as dnsLookup } from 'node:dns';
import type { LookupAddress } from 'node:dns';
import { Agent, fetch as undiciFetch } from 'undici';
import { getResourceEnvelopeLedger } from '../../openclaw_runtime/src/resources/resource-envelope';

export type NetworkPoolResponse = Awaited<ReturnType<typeof undiciFetch>>;

export type NetworkPoolMetrics = {
  transport: 'undici-agent' | 'electron-net' | 'unavailable';
  connectionLimit: number;
  openedConnections: number;
  activeConnections: number;
  requests: number;
  dnsLookups: number;
  active: number;
  reuseRatio: number | null;
};

type DnsLookupCallback = (
  error: NodeJS.ErrnoException | null,
  address?: string | LookupAddress[],
  family?: number,
) => void;

type LookupFunction = (
  hostname: string,
  options: { all?: boolean; family?: number },
  callback: DnsLookupCallback,
) => void;

export type NetworkPoolOptions = {
  connections?: number;
  dnsTtlMs?: number;
  now?: () => number;
  lookup?: LookupFunction;
  fetchImpl?: typeof undiciFetch;
  tlsInsecure?: boolean;
};

type CachedAddresses = { addresses: LookupAddress[]; expiresAt: number };

const DEFAULT_CONNECTIONS = 8;
const DEFAULT_DNS_TTL_MS = 60_000;

export class NetworkPool {
  private readonly connections: number;
  private readonly dnsTtlMs: number;
  private readonly now: () => number;
  private readonly lookup: LookupFunction;
  private readonly fetchImpl: typeof undiciFetch;
  private readonly tlsInsecure: boolean;
  private readonly agent: Agent;
  private readonly dnsCache = new Map<string, CachedAddresses>();
  private requests = 0;
  private dnsLookups = 0;
  private active = 0;
  private openedConnections = 0;
  private activeConnections = 0;

  constructor(options: NetworkPoolOptions = {}) {
    this.connections = Math.max(1, Math.floor(options.connections ?? DEFAULT_CONNECTIONS));
    this.dnsTtlMs = Math.max(1, Math.floor(options.dnsTtlMs ?? DEFAULT_DNS_TTL_MS));
    this.now = options.now ?? Date.now;
    this.lookup = options.lookup ?? this.defaultLookup.bind(this);
    this.fetchImpl = options.fetchImpl ?? undiciFetch;
    this.tlsInsecure = options.tlsInsecure === true;
    this.agent = new Agent({
      connections: this.connections,
      keepAliveTimeout: 30_000,
      keepAliveMaxTimeout: 60_000,
      connect: { rejectUnauthorized: !this.tlsInsecure, lookup: this.cachedLookup.bind(this) } as never,
    });
    this.agent.on('connect', () => {
      this.openedConnections += 1;
      this.activeConnections += 1;
      this.syncEnvelope();
    });
    this.agent.on('disconnect', () => {
      this.activeConnections = Math.max(0, this.activeConnections - 1);
      this.syncEnvelope();
    });
    this.syncEnvelope();
  }

  fetch(input: Parameters<typeof undiciFetch>[0], init?: Parameters<typeof undiciFetch>[1]): Promise<NetworkPoolResponse> {
    this.requests += 1;
    this.active += 1;
    this.syncEnvelope();
    return this.fetchImpl(input, { ...init, dispatcher: this.agent } as never).finally(() => {
      this.active = Math.max(0, this.active - 1);
      this.syncEnvelope();
    });
  }

  resolveHostname(hostname: string): Promise<LookupAddress[]> {
    return new Promise((resolve, reject) => {
      this.cachedLookup(hostname, { all: true }, (error, addresses) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(Array.isArray(addresses) ? addresses : []);
      });
    });
  }

  getMetrics(): NetworkPoolMetrics {
    const reuseRatio = this.requests === 0
      ? null
      : Math.max(0, Math.min(1, 1 - this.openedConnections / this.requests));
    return {
      transport: 'undici-agent',
      connectionLimit: this.connections,
      openedConnections: this.openedConnections,
      activeConnections: this.activeConnections,
      requests: this.requests,
      dnsLookups: this.dnsLookups,
      active: this.active,
      reuseRatio,
    };
  }

  async close(): Promise<void> {
    await this.agent.close();
    this.activeConnections = 0;
    this.syncEnvelope();
  }

  private defaultLookup(
    hostname: string,
    options: { all?: boolean; family?: number },
    callback: DnsLookupCallback,
  ): void {
    dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
      callback(error, addresses as LookupAddress[]);
    });
  }

  private cachedLookup(
    hostname: string,
    options: { all?: boolean; family?: number },
    callback: DnsLookupCallback,
  ): void {
    const cached = this.dnsCache.get(hostname);
    if (cached && cached.expiresAt > this.now()) {
      const addresses = this.filterAddresses(cached.addresses, options.family);
      if (addresses.length > 0) {
        this.reply(callback, options, addresses);
        return;
      }
    }
    this.dnsLookups += 1;
    this.lookup(hostname, options, (error, addresses) => {
      if (error || !addresses) {
        callback(error);
        return;
      }
      const normalized = Array.isArray(addresses) ? addresses : [{ address: addresses, family: 4 }];
      this.dnsCache.set(hostname, { addresses: normalized, expiresAt: this.now() + this.dnsTtlMs });
      const filtered = this.filterAddresses(normalized, options.family);
      if (filtered.length === 0) {
        callback(new Error(`DNS lookup returned no addresses for family ${options.family}`) as NodeJS.ErrnoException);
        return;
      }
      this.reply(callback, options, filtered);
    });
  }

  private filterAddresses(addresses: LookupAddress[], family?: number): LookupAddress[] {
    if (family !== 4 && family !== 6) {
      return addresses;
    }
    return addresses.filter((address) => address.family === family);
  }

  private reply(
    callback: DnsLookupCallback,
    options: { all?: boolean; family?: number },
    addresses: LookupAddress[],
  ): void {
    if (options.all === true) {
      (callback as (...args: unknown[]) => void)(null, addresses);
      return;
    }
    const first = addresses[0];
    if (!first) {
      callback(new Error('DNS lookup returned no addresses') as NodeJS.ErrnoException);
      return;
    }
    callback(null, first.address, first.family);
  }

  private syncEnvelope(): void {
    const metrics = this.getMetrics();
    getResourceEnvelopeLedger().update({
      id: 'main:network-pool',
      workspaceKey: 'main:network-pool',
      kind: 'network-pool',
      priority: 'background',
      owner: 'main',
      activeSlots: metrics.active,
      queuedCount: 0,
      queueWaitMs: 0,
      processCount: 0,
      treeRssBytes: 0,
      treeCpuPercent: 0,
      limits: { concurrencySlots: this.connections, queueLength: 64 },
      reason: JSON.stringify(metrics),
    });
  }
}

let singleton: NetworkPool | null = null;

export function getNetworkPool(): NetworkPool {
  singleton ??= new NetworkPool();
  return singleton;
}

export function pooledFetch(
  input: Parameters<typeof undiciFetch>[0],
  init?: Parameters<typeof undiciFetch>[1],
): Promise<NetworkPoolResponse> {
  return getNetworkPool().fetch(input, init);
}

export function getNetworkPoolMetrics(): NetworkPoolMetrics {
  return getNetworkPool().getMetrics();
}

export function resetNetworkPoolForTest(): void {
  singleton = null;
}