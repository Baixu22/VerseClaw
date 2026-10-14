import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import {
  RESOURCE_ENVELOPE_SCHEMA,
  mergeResourceEnvelopeSnapshots,
  type ResourceEnvelopeSnapshot,
} from "./resource-envelope.js";

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
    if (parsed.schema !== RESOURCE_ENVELOPE_SCHEMA || !Array.isArray(parsed.entries)) {
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
  return mergeResourceEnvelopeSnapshots(snapshots, params?.now ?? Date.now());
}