import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import {
  RESOURCE_ENVELOPE_SCHEMA,
  mergeResourceEnvelopeSnapshots,
  isResourceKind,
  type ResourceEnvelopeSnapshot,
} from "./resource-envelope.js";

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function nonnegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
function validEntry(value: unknown): boolean {
  if (!record(value) || !["id", "workspaceKey", "kind", "owner"].every(key => typeof value[key] === "string" && value[key])
    || !isResourceKind(value.kind) || !["foreground", "background"].includes(String(value.priority)) || !record(value.limits)
    || !["activeSlots", "queuedCount", "queueWaitMs", "processCount", "treeRssBytes", "treeCpuPercent", "updatedAt"].every(key => nonnegative(value[key]))
    || !["memoryBytes", "cpuPercent", "processCount", "concurrencySlots", "queueLength"].every(key => nonnegative((value.limits as Record<string, unknown>)[key]))) return false;
  const m = value.processMeasurement;
  if (m === undefined) return true;
  return record(m) && ["ok", "empty", "unknown"].includes(String(m.status)) && nonnegative(m.sampledAt)
    && typeof m.ownerEpoch === "string" && m.ownerEpoch.length > 0 && Array.isArray(m.rootPids)
    && m.rootPids.every(pid => Number.isInteger(pid) && pid > 0) && Array.isArray(m.processes) && m.processes.length <= 512
    && m.processes.every(p => record(p) && Number.isInteger(p.pid) && Number(p.pid) > 0 && Number.isInteger(p.parentPid)
      && typeof p.creationToken === "string" && p.creationToken.length > 0 && nonnegative(p.rssBytes) && nonnegative(p.cpuTimeMs)
      && (p.privateBytes === null || nonnegative(p.privateBytes)) && (p.cpuPercent === null || nonnegative(p.cpuPercent)));
}

export function resourceEnvelopeSnapshotPath(owner: string, stateDir = resolveStateDir()): string {
  const safeOwner = owner.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 64) || "owner";
  return path.join(stateDir, "resource-envelope", `${safeOwner}.json`);
}

export function writeResourceEnvelopeSnapshot(
  snapshot: ResourceEnvelopeSnapshot,
  filePath = resourceEnvelopeSnapshotPath("gateway"),
): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(snapshot)}\n`, "utf8");
  try {
    fs.renameSync(tempPath, filePath);
  } catch {
    fs.rmSync(filePath, { force: true });
    fs.renameSync(tempPath, filePath);
  }
}

export function readResourceEnvelopeSnapshot(
  filePath = resourceEnvelopeSnapshotPath("gateway"),
): ResourceEnvelopeSnapshot | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<ResourceEnvelopeSnapshot>;
    if (parsed.schema !== RESOURCE_ENVELOPE_SCHEMA || !nonnegative(parsed.generatedAt) || parsed.mode !== "shadow"
      || !Array.isArray(parsed.entries) || !parsed.entries.every(validEntry) || !Array.isArray(parsed.warnings)
      || !parsed.warnings.every(warning => typeof warning === "string")
      || !parsed.producer || !Number.isInteger(parsed.producer.pid) || parsed.producer.pid <= 0
      || typeof parsed.producer.epoch !== "string" || !parsed.producer.epoch
      || parsed.entries.some(entry => entry.processMeasurement && entry.processMeasurement.ownerEpoch !== parsed.producer?.epoch)
      || (parsed.eventLoopPressure && (typeof parsed.eventLoopPressure.degraded !== "boolean"
        || parsed.eventLoopPressure.ownerEpoch !== parsed.producer.epoch
        || ![parsed.eventLoopPressure.sampledAt, parsed.eventLoopPressure.delayP99Ms, parsed.eventLoopPressure.delayMaxMs, parsed.eventLoopPressure.utilization].every(nonnegative)))) {
      return null;
    }
    return parsed as ResourceEnvelopeSnapshot;
  } catch {
    return null;
  }
}

export function readMergedResourceEnvelopeSnapshot(params?: {
  main?: ResourceEnvelopeSnapshot;
  gatewayPath?: string;
  now?: number;
}): ResourceEnvelopeSnapshot {
  const snapshots: ResourceEnvelopeSnapshot[] = [];
  const warnings: string[] = [];
  if (params?.main) snapshots.push(params.main);
  const gateway = readResourceEnvelopeSnapshot(params?.gatewayPath);
  if (gateway) {
    snapshots.push(gateway);
  } else {
    warnings.push("gateway resource-envelope snapshot unavailable");
  }
  if (snapshots.length === 0) {
    return {
      schema: RESOURCE_ENVELOPE_SCHEMA,
      generatedAt: params?.now ?? Date.now(),
      mode: "shadow",
      entries: [],
      totals: {
        activeSlots: 0,
        queuedCount: 0,
        queueWaitMs: 0,
        processCount: 0,
        treeRssBytes: 0,
        treeCpuPercent: 0,
      },
      exceeded: [],
      warnings,
    };
  }
  const merged = mergeResourceEnvelopeSnapshots(snapshots, params?.now ?? Date.now());
  merged.warnings.push(...warnings);
  return merged;
}
