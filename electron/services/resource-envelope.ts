import process from "node:process";
import { freemem, totalmem } from 'node:os';
import { getResourceEnvelopeLedger, type ResourceEnvelopeSnapshot } from '../../openclaw_runtime/src/resources/resource-envelope';
import {
  readMergedResourceEnvelopeSnapshot,
  resourceEnvelopeSnapshotPath,
} from '../../openclaw_runtime/src/resources/resource-envelope-snapshot-store';
import { ProcessTreeSampler } from '../../openclaw_runtime/src/process/process-tree-sampler';
import type { ProcessTreeSample } from '../../openclaw_runtime/src/process/process-tree-sampler';

let cachedMainTreeSample: ProcessTreeSample | null = null;
let cachedMainTreeSampleAt = 0;
const mainTreeSampler = new ProcessTreeSampler();
let mainTreeInFlight: Promise<ProcessTreeSample> | null = null;

async function readMainProcessTreeSample(): Promise<ProcessTreeSample> {
  const now = Date.now();
  if (cachedMainTreeSample && now >= cachedMainTreeSampleAt && now - cachedMainTreeSampleAt < 30_000) {
    return cachedMainTreeSample;
  }
  mainTreeInFlight ??= mainTreeSampler.sample({ rootPids: [process.pid] }).then(sample => {
    cachedMainTreeSample = sample;
    cachedMainTreeSampleAt = sample.sampledAt;
    return sample;
  }).finally(() => { mainTreeInFlight = null; });
  return mainTreeInFlight;
}
export function recordResourceEnvelopeEntry(
  entry: Parameters<ReturnType<typeof getResourceEnvelopeLedger>["update"]>[0],
): void {
  getResourceEnvelopeLedger().update(entry);
}

export function listResourceEnvelopeEntries() {
  return getResourceEnvelopeLedger().list();
}

export function removeResourceEnvelopeEntry(id: string): void {
  getResourceEnvelopeLedger().remove(id);
}
export async function getMainResourceEnvelopeSnapshot(): Promise<ResourceEnvelopeSnapshot> {
  const ledger = getResourceEnvelopeLedger();
  const warnings: string[] = [];
  try {
    const sample = await readMainProcessTreeSample();
    ledger.update({
        id: 'main:process-tree',
        workspaceKey: process.cwd(),
        kind: 'agent-turn',
        priority: 'foreground',
        owner: 'main',
        activeSlots: 0,
        queuedCount: sample.queueDepth,
        queueWaitMs: sample.queueWaitMs,
        processCount: sample.processCount ?? 0,
        treeRssBytes: sample.treeRssBytes ?? 0,
        treeCpuPercent: sample.treeCpuPercent ?? 0,
        pids: sample.rootPids,
        processMeasurement: { status: sample.status, sampledAt: sample.sampledAt, ownerEpoch: ledger.ownerEpoch, rootPids: sample.rootPids, processes: sample.processes ?? [] },
        reason: 'main process tree sample',
      });
    if (sample.status !== 'ok') {
      warnings.push(`main process tree sample unavailable: ${sample.detail ?? sample.status}`);
    }
  } catch (error) {
    const previous = ledger.get('main:process-tree');
    if (previous?.processMeasurement) ledger.update({ ...previous, processMeasurement: { ...previous.processMeasurement, status: 'unknown' } });
    warnings.push(`main process tree sample failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  const snapshot = ledger.snapshot(Date.now(), warnings);
  snapshot.machineMemory = { sampledAt: Date.now(), availablePhysicalBytes: freemem(), totalPhysicalBytes: totalmem() };
  return snapshot;
}

export async function getAggregatedResourceEnvelopeSnapshot(): Promise<ResourceEnvelopeSnapshot> {
  const main = await getMainResourceEnvelopeSnapshot();
  return readMergedResourceEnvelopeSnapshot({
    main,
    gatewayPath: resourceEnvelopeSnapshotPath('gateway'),
  });
}
