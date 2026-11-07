import { resolveGlobalSingleton } from "../shared/global-singleton.js";
import { randomUUID } from "node:crypto";

import {
  RESOURCE_ENVELOPE_SCHEMA,
  RESOURCE_METRICS_TTL_MS,
  type ResourceProcessObservation,
  type ResourceProcessTotals,
  type ResourceEventLoopPressure,
  type ResourceEnvelopeEntry,
  type ResourceEnvelopeExceeded,
  type ResourceEnvelopeSnapshot,
  type ResourceEnvelopeTotals,
  type ResourceKind,
  type ResourceLimits,
} from "../../../shared/types/resources.js";

export {
  RESOURCE_ENVELOPE_SCHEMA,
  type ResourceEnvelopeEntry,
  type ResourceEnvelopeExceeded,
  type ResourceEnvelopeSnapshot,
  type ResourceEnvelopeTotals,
  type ResourceKind,
  type ResourceLimits,
  type ResourcePriority,
} from "../../../shared/types/resources.js";

export type ResourceEnvelopeCandidate = Omit<ResourceEnvelopeEntry, "workspaceKey" | "updatedAt" | "limits"> & {
  /** A missing workspace is different from an unknown one and must stay absent. */
  workspaceKey?: string;
  updatedAt?: number;
  limits?: Partial<ResourceLimits>;
};

const DEFAULT_LIMITS: Record<ResourceKind, ResourceLimits> = {
  "agent-turn": { memoryBytes: 2 * 1024 ** 3, cpuPercent: 400, processCount: 64, concurrencySlots: 8, queueLength: 32 },
  "terminal-exec": { memoryBytes: 2 * 1024 ** 3, cpuPercent: 400, processCount: 128, concurrencySlots: 2, queueLength: 64 },
  "runtime-bash": { memoryBytes: 2 * 1024 ** 3, cpuPercent: 400, processCount: 128, concurrencySlots: 2, queueLength: 64 },
  "workspace-search": { memoryBytes: 512 * 1024 ** 2, cpuPercent: 200, processCount: 32, concurrencySlots: 2, queueLength: 64 },
  "workspace-writer": { memoryBytes: 512 * 1024 ** 2, cpuPercent: 100, processCount: 16, concurrencySlots: 1, queueLength: 32 },
  "subtree-mutation": { memoryBytes: 512 * 1024 ** 2, cpuPercent: 100, processCount: 16, concurrencySlots: 1, queueLength: 32 },
  "file-mutation": { memoryBytes: 256 * 1024 ** 2, cpuPercent: 50, processCount: 8, concurrencySlots: 1, queueLength: 32 },
  "browser-session": { memoryBytes: 2 * 1024 ** 3, cpuPercent: 200, processCount: 64, concurrencySlots: 4, queueLength: 16 },
  "pty-session": { memoryBytes: 512 * 1024 ** 2, cpuPercent: 100, processCount: 16, concurrencySlots: 8, queueLength: 32 },
  "mcp-process": { memoryBytes: 1024 * 1024 ** 2, cpuPercent: 200, processCount: 8, concurrencySlots: 200, queueLength: 64 },
  "provider-sidecar": { memoryBytes: 1024 * 1024 ** 2, cpuPercent: 200, processCount: 8, concurrencySlots: 16, queueLength: 64 },
  "background-index": { memoryBytes: 1024 * 1024 ** 2, cpuPercent: 200, processCount: 32, concurrencySlots: 4, queueLength: 128 },
  "chat-history": { memoryBytes: 512 * 1024 ** 2, cpuPercent: 100, processCount: 16, concurrencySlots: 2, queueLength: 64 },
  "network-pool": { memoryBytes: 512 * 1024 ** 2, cpuPercent: 100, processCount: 32, concurrencySlots: 8, queueLength: 64 },
};

function mergeLimits(kind: ResourceKind, overrides?: Partial<ResourceLimits>): ResourceLimits {
  const base = DEFAULT_LIMITS[kind];
  return {
    memoryBytes: overrides?.memoryBytes ?? base.memoryBytes,
    cpuPercent: overrides?.cpuPercent ?? base.cpuPercent,
    processCount: overrides?.processCount ?? base.processCount,
    concurrencySlots: overrides?.concurrencySlots ?? base.concurrencySlots,
    queueLength: overrides?.queueLength ?? base.queueLength,
  };
}

export function isResourceKind(value: unknown): value is ResourceKind {
  return typeof value === "string" && Object.hasOwn(DEFAULT_LIMITS, value);
}

function workspaceEntryKey(entry: Pick<ResourceEnvelopeEntry, "workspaceKey" | "kind" | "priority" | "owner">): string {
  return [entry.workspaceKey, entry.kind, entry.priority, entry.owner].join("\u0000");
}

function fresh(at: number, now: number): boolean {
  return Number.isFinite(at) && at <= now && now - at <= RESOURCE_METRICS_TTL_MS;
}

function processTotals(entries: readonly ResourceEnvelopeEntry[], now: number, warnings: string[]): ResourceProcessTotals {
  const byPid = new Map<number, { at: number; record: ResourceProcessObservation }>();
  let measured = false;
  let incomplete = false;
  for (const entry of entries) {
    const measurement = entry.processMeasurement;
    if (!measurement) continue;
    if (measurement.status !== "ok" || !measurement.ownerEpoch || !fresh(measurement.sampledAt, now)) {
      incomplete = true;
      warnings.push(`${entry.id}: process measurement unavailable or expired`);
      continue;
    }
    measured = true;
    for (const record of measurement.processes) {
      const previous = byPid.get(record.pid);
      if (!previous || measurement.sampledAt > previous.at) byPid.set(record.pid, { at: measurement.sampledAt, record });
      else if (measurement.sampledAt === previous.at && record.creationToken !== previous.record.creationToken) {
        incomplete = true;
        warnings.push(`PID ${record.pid}: conflicting process identities at the same sample time`);
      }
    }
  }
  const records = [...byPid.values()].map(item => item.record);
  const known = measured && !incomplete;
  return {
    processCount: records.length,
    rssBytes: known ? records.reduce((sum, p) => sum + p.rssBytes, 0) : null,
    privateBytes: known && records.every(p => p.privateBytes !== null) ? records.reduce((sum, p) => sum + (p.privateBytes ?? 0), 0) : null,
    cpuPercent: known && records.every(p => p.cpuPercent !== null) ? records.reduce((sum, p) => sum + (p.cpuPercent ?? 0), 0) : null,
  };
}

function exceededForEntry(entry: ResourceEnvelopeEntry): ResourceEnvelopeExceeded[] {
  const checks: Array<{ dimension: keyof ResourceLimits; observed: number; reason: string }> = [
    { dimension: "memoryBytes", observed: entry.treeRssBytes, reason: "tree RSS exceeds hard limit" },
    { dimension: "cpuPercent", observed: entry.treeCpuPercent, reason: "tree CPU exceeds hard limit" },
    { dimension: "processCount", observed: entry.processCount, reason: "process count exceeds hard limit" },
    { dimension: "concurrencySlots", observed: entry.activeSlots, reason: "active slots exceed hard limit" },
    { dimension: "queueLength", observed: entry.queuedCount, reason: "queue depth exceeds hard limit" },
  ];
  return checks
    .filter((check) => check.observed > entry.limits[check.dimension])
    .map((check) => ({
      entryId: entry.id,
      workspaceKey: entry.workspaceKey,
      kind: entry.kind,
      priority: entry.priority,
      owner: entry.owner,
      dimension: check.dimension,
      observed: check.observed,
      limit: entry.limits[check.dimension],
      reason: check.reason,
    }));
}

export class ResourceEnvelopeLedger {
  readonly ownerEpoch = randomUUID();
  private eventLoopPressure: ResourceEventLoopPressure | undefined;
  private readonly entries = new Map<string, ResourceEnvelopeEntry>();
  private readonly limits: Partial<Record<ResourceKind, Partial<ResourceLimits>>>;

  constructor(options?: { limits?: Partial<Record<ResourceKind, Partial<ResourceLimits>>> }) {
    this.limits = options?.limits ?? {};
  }

  recordEventLoopPressure(value: Omit<ResourceEventLoopPressure, "ownerEpoch"> | undefined): void {
    this.eventLoopPressure = value ? { ...value, ownerEpoch: this.ownerEpoch } : undefined;
  }

  update(candidate: ResourceEnvelopeCandidate): ResourceEnvelopeEntry {
    const existing = this.entries.get(candidate.id);
    if (!candidate.workspaceKey) {
      throw new TypeError("ResourceEnvelopeCandidate requires an owner-resolved workspaceKey");
    }
    const limits = mergeLimits(candidate.kind, {
      ...this.limits[candidate.kind],
      ...existing?.limits,
      ...candidate.limits,
    });
    const entry: ResourceEnvelopeEntry = {
      ...candidate,
      workspaceKey: candidate.workspaceKey,
      limits,
      limitHistory: candidate.limitHistory ?? existing?.limitHistory,
      updatedAt: candidate.updatedAt ?? Date.now(),
    };
    this.entries.set(entry.id, entry);
    return entry;
  }

  remove(id: string): boolean {
    return this.entries.delete(id);
  }

  get(id: string): ResourceEnvelopeEntry | undefined {
    return this.entries.get(id);
  }

  list(): ResourceEnvelopeEntry[] {
    return [...this.entries.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  evaluate(candidate: ResourceEnvelopeCandidate): {
    allow: true;
    shadow: true;
    exceeded: ResourceEnvelopeExceeded[];
  } {
    const entry = this.update(candidate);
    return { allow: true, shadow: true, exceeded: exceededForEntry(entry) };
  }

  snapshot(now = Date.now(), warnings: readonly string[] = []): ResourceEnvelopeSnapshot {
    const entries = this.list().map((entry) => ({ ...entry, pids: entry.pids?.slice(), limits: { ...entry.limits } }));
    const totals: ResourceEnvelopeTotals = {
      activeSlots: 0,
      queuedCount: 0,
      queueWaitMs: 0,
      processCount: 0,
      treeRssBytes: 0,
      treeCpuPercent: 0,
    };
    const exceeded: ResourceEnvelopeExceeded[] = [];
    for (const entry of entries) {
      totals.activeSlots += entry.activeSlots;
      totals.queuedCount += entry.queuedCount;
      totals.queueWaitMs = Math.max(totals.queueWaitMs, entry.queueWaitMs);
      totals.processCount += entry.processCount;
      totals.treeRssBytes += entry.treeRssBytes;
      totals.treeCpuPercent += entry.treeCpuPercent;
      exceeded.push(...exceededForEntry(entry));
    }
    const measurementWarnings = [...warnings];
    const physical = processTotals(entries, now, measurementWarnings);
    if (entries.some(entry => entry.processMeasurement)) {
      // Logical slots stay additive; physical counters come only from identified processes.
      totals.processCount = physical.processCount;
      totals.treeRssBytes = physical.rssBytes ?? 0;
      totals.treeCpuPercent = physical.cpuPercent ?? 0;
    }
    const ownProcess = entries.flatMap(entry => entry.processMeasurement?.processes ?? []).find(record => record.pid === process.pid);
    return {
      schema: RESOURCE_ENVELOPE_SCHEMA,
      generatedAt: now,
      mode: "shadow",
      entries,
      totals,
      exceeded,
      warnings: measurementWarnings,
      producer: { pid: process.pid, epoch: this.ownerEpoch, ...(ownProcess ? { creationToken: ownProcess.creationToken } : {}) },
      processTotals: physical,
      ...(this.eventLoopPressure && fresh(this.eventLoopPressure.sampledAt, now) ? { eventLoopPressure: { ...this.eventLoopPressure } } : {}),
    };
  }
}

export function mergeResourceEnvelopeSnapshots(
  snapshots: readonly ResourceEnvelopeSnapshot[],
  now = Date.now(),
): ResourceEnvelopeSnapshot {
  const entries: ResourceEnvelopeEntry[] = [];
  const byKey = new Map<string, ResourceEnvelopeEntry>();
  const warnings = new Set<string>();
  const byProducer = new Map<number, ResourceEnvelopeSnapshot>();
  const accepted: ResourceEnvelopeSnapshot[] = [];
  for (const snapshot of snapshots) {
    if (!fresh(snapshot.generatedAt, now)) {
      warnings.add("resource-envelope snapshot expired or future-dated");
      continue;
    }
    if (!snapshot.producer) { accepted.push(snapshot); continue; }
    const previous = byProducer.get(snapshot.producer.pid);
    if (!previous || snapshot.generatedAt >= previous.generatedAt) byProducer.set(snapshot.producer.pid, snapshot);
  }
  accepted.push(...byProducer.values());
  const liveIdentities = new Map<number, { at: number; token: string }>();
  for (const snapshot of accepted) for (const entry of snapshot.entries) {
    const measurement = entry.processMeasurement;
    if (measurement?.status !== "ok" || !fresh(measurement.sampledAt, now)) continue;
    for (const p of measurement.processes) {
      const previous = liveIdentities.get(p.pid);
      if (!previous || measurement.sampledAt > previous.at) liveIdentities.set(p.pid, { at: measurement.sampledAt, token: p.creationToken });
    }
  }
  let eventLoopPressure: ResourceEventLoopPressure | undefined;
  for (const snapshot of accepted) {
    const currentOwner = snapshot.producer ? liveIdentities.get(snapshot.producer.pid) : undefined;
    if (snapshot.producer?.creationToken && currentOwner && snapshot.producer.creationToken !== currentOwner.token) {
      warnings.add(`resource-envelope producer PID ${snapshot.producer.pid} was reused`);
      continue;
    }
    if (snapshot.eventLoopPressure && snapshot.eventLoopPressure.ownerEpoch === snapshot.producer?.epoch
      && fresh(snapshot.eventLoopPressure.sampledAt, now)
      && (!eventLoopPressure || snapshot.eventLoopPressure.sampledAt > eventLoopPressure.sampledAt)) eventLoopPressure = snapshot.eventLoopPressure;
    for (const warning of snapshot.warnings) warnings.add(warning);
    for (const entry of snapshot.entries) {
      const key = entry.processMeasurement ? `${entry.owner}\u0000${entry.id}` : workspaceEntryKey(entry);
      const existing = byKey.get(key);
      if (!existing) {
        const copy = {
          ...entry,
          pids: entry.pids?.slice(),
          limits: { ...entry.limits },
          ...(entry.limitHistory ? { limitHistory: entry.limitHistory.map((event) => ({ ...event })) } : {}),
        };
        byKey.set(key, copy);
        entries.push(copy);
        continue;
      }
      existing.activeSlots += entry.activeSlots;
      existing.queuedCount += entry.queuedCount;
      existing.queueWaitMs = Math.max(existing.queueWaitMs, entry.queueWaitMs);
      existing.processCount += entry.processCount;
      existing.treeRssBytes += entry.treeRssBytes;
      existing.treeCpuPercent += entry.treeCpuPercent;
      existing.updatedAt = Math.max(existing.updatedAt, entry.updatedAt);
      existing.pids = [...(existing.pids ?? []), ...(entry.pids ?? [])];
      if (entry.limitHistory?.length) {
        const mergedHistory = [...(existing.limitHistory ?? []), ...entry.limitHistory];
        const seen = new Set<string>();
        existing.limitHistory = mergedHistory.filter((event) => {
          const key = `${event.at}:${event.from}:${event.to}:${event.reason}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        }).slice(-64);
      }
    }
  }
  const merged = new ResourceEnvelopeLedger();
  for (const entry of entries) merged.update(entry);
  const result = merged.snapshot(now, [...warnings]);
  // A merged projection has no producer epoch of its own.
  delete result.producer;
  const machine = accepted.map(snapshot => snapshot.machineMemory).filter(value => value && fresh(value.sampledAt, now))
    .sort((a, b) => b!.sampledAt - a!.sampledAt)[0];
  if (machine) result.machineMemory = machine;
  if (eventLoopPressure) result.eventLoopPressure = { ...eventLoopPressure };
  return result;
}

const RESOURCE_ENVELOPE_LEDGER_KEY = Symbol.for("openclaw.resourceEnvelopeLedger");

export function getResourceEnvelopeLedger(): ResourceEnvelopeLedger {
  return resolveGlobalSingleton(RESOURCE_ENVELOPE_LEDGER_KEY, () => new ResourceEnvelopeLedger());
}

export function resetResourceEnvelopeLedgerForTest(): void {
  const globalStore = globalThis as Record<PropertyKey, unknown>;
  globalStore[RESOURCE_ENVELOPE_LEDGER_KEY] = new ResourceEnvelopeLedger();
}
