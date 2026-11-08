import process from "node:process";
import { freemem, totalmem } from 'node:os';
import { getResourceEnvelopeLedger, type ResourceEnvelopeSnapshot } from '../../openclaw_runtime/src/resources/resource-envelope';
import {
  readMergedResourceEnvelopeSnapshot,
  resourceEnvelopeSnapshotPath,
} from '../../openclaw_runtime/src/resources/resource-envelope-snapshot-store';
import { ProcessTreeSampler } from '../../openclaw_runtime/src/process/process-tree-sampler';
import type { ProcessTreeSample } from '../../openclaw_runtime/src/process/process-tree-sampler';
import { getResourceFabric } from './resource-fabric';
import type { TerminalSessionManager } from './terminal-session-manager';

export type MainEnvelopeOwners = { terminalManager?: Pick<TerminalSessionManager, 'listAll'> | null };

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
export async function getMainResourceEnvelopeSnapshot(owners: MainEnvelopeOwners = {}): Promise<ResourceEnvelopeSnapshot> {
  const ledger = getResourceEnvelopeLedger();
  getResourceFabric().getDiagnostics();
  const warnings: string[] = [];
  try {
    const { getDefaultAgentBrowserService } = await import('./agent-browser-api');
    const browsers = getDefaultAgentBrowserService().list();
    const manager = owners.terminalManager === undefined
      ? (await import('../main/ipc-handlers')).getTerminalSessionManager() : owners.terminalManager;
    const terminals = manager?.listAll() ?? [];
    const entries = [
      ...browsers.map(session => ({ id: `main:browser-session:${session.id}`, workspaceKey: session.workspaceId ?? 'global',
        kind: 'browser-session' as const, pids: [] as number[], reason: 'HostAgentBrowserService session' })),
      ...terminals.map(session => ({ id: `main:pty-session:${session.sessionId}`, workspaceKey: session.workspaceId,
        kind: 'pty-session' as const, pids: session.pid ? [session.pid] : [], reason: 'TerminalSessionManager session' })),
    ];
    const ids = new Set(entries.map(entry => entry.id));
    for (const old of ledger.list()) if ((old.id.startsWith('main:browser-session:') || old.id.startsWith('main:pty-session:')) && !ids.has(old.id)) ledger.remove(old.id);
    for (const entry of entries) ledger.update({ ...entry, owner: 'main', priority: 'foreground', activeSlots: 1,
      queuedCount: 0, queueWaitMs: 0, processCount: entry.pids.length, treeRssBytes: 0, treeCpuPercent: 0 });
  } catch (error) {
    warnings.push(`desktop resource owners unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
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
  if (cachedMainTreeSample?.machineCommit) snapshot.machineCommit = { ...cachedMainTreeSample.machineCommit };
  return snapshot;
}

export async function getAggregatedResourceEnvelopeSnapshot(owners: MainEnvelopeOwners = {}): Promise<ResourceEnvelopeSnapshot> {
  const main = await getMainResourceEnvelopeSnapshot(owners);
  return readMergedResourceEnvelopeSnapshot({
    main,
    gatewayPath: resourceEnvelopeSnapshotPath('gateway'),
  });
}
