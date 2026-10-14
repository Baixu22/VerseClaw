import process from "node:process";
import { getResourceEnvelopeLedger, type ResourceEnvelopeSnapshot } from '../../openclaw_runtime/src/resources/resource-envelope';
import {
  readMergedResourceEnvelopeSnapshot,
  resourceEnvelopeSnapshotPath,
} from '../../openclaw_runtime/src/resources/resource-envelope-snapshot-store';
import { readProcessTreeSample } from '../../openclaw_runtime/src/process/process-tree-sampler';
import type { ProcessTreeSample } from '../../openclaw_runtime/src/process/process-tree-sampler';

let cachedMainTreeSample: ProcessTreeSample | null = null;
let cachedMainTreeSampleAt = 0;

async function readMainProcessTreeSample(): Promise<ProcessTreeSample> {
  const now = Date.now();
  if (cachedMainTreeSample && now - cachedMainTreeSampleAt < 30_000) {
    return cachedMainTreeSample;
  }
  const sample = await readProcessTreeSample({ rootPids: [process.pid] });
  cachedMainTreeSample = sample;
  cachedMainTreeSampleAt = now;
  return sample;
}
export async function getMainResourceEnvelopeSnapshot(): Promise<ResourceEnvelopeSnapshot> {
  const ledger = getResourceEnvelopeLedger();
  const warnings: string[] = [];
  try {
    const sample = await readMainProcessTreeSample();
    if (sample.status === 'ok') {
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
        reason: 'main process tree sample',
      });
    } else {
      warnings.push(`main process tree sample unavailable: ${sample.detail ?? sample.status}`);
    }
  } catch (error) {
    warnings.push(`main process tree sample failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return ledger.snapshot(Date.now(), warnings);
}

export async function getAggregatedResourceEnvelopeSnapshot(): Promise<ResourceEnvelopeSnapshot> {
  const main = await getMainResourceEnvelopeSnapshot();
  return readMergedResourceEnvelopeSnapshot({
    main,
    gatewayPath: resourceEnvelopeSnapshotPath('gateway'),
  });
}