// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ProcessTreeSampler, type ProcessTreeSample } from '../../openclaw_runtime/src/process/process-tree-sampler';
import { ResourceEnvelopeLedger, mergeResourceEnvelopeSnapshots } from '../../openclaw_runtime/src/resources/resource-envelope';

const observation = (pid: number, token: string, rssBytes: number, cpuTimeMs: number, cpuPercent: number | null = 0) => ({
  pid, parentPid: 1, creationToken: token, rssBytes, privateBytes: rssBytes * 2, cpuTimeMs, cpuPercent,
});
function snapshot(owner: string, pid: number, epoch: string, at: number, processes: ReturnType<typeof observation>[], slots = 0) {
  const ledger = new ResourceEnvelopeLedger();
  ledger.update({
    id: `${owner}:process-tree`, workspaceKey: owner, owner, kind: 'agent-turn', priority: 'foreground',
    activeSlots: slots, queuedCount: 0, queueWaitMs: 0, processCount: processes.length,
    treeRssBytes: processes.reduce((n, p) => n + p.rssBytes, 0), treeCpuPercent: processes.reduce((n, p) => n + (p.cpuPercent ?? 0), 0),
    processMeasurement: { status: 'ok', sampledAt: at, ownerEpoch: epoch, rootPids: [pid], processes },
  } as Parameters<ResourceEnvelopeLedger['update']>[0]);
  return { ...ledger.snapshot(at), producer: { pid, epoch, creationToken: processes.find(p => p.pid === pid)?.creationToken ?? '1' } };
}

describe('process metrics calibration', () => {
  it('deduplicates overlapping Main/Gateway trees while preserving logical leases', () => {
    const a = observation(10, '1', 100, 100, 50);
    const b = observation(20, '2', 200, 200, 100);
    const c = observation(30, '3', 300, 300, 350);
    const result = mergeResourceEnvelopeSnapshots([snapshot('main', 10, 'main', 1000, [a, b], 2), snapshot('gateway', 20, 'gateway', 1000, [b, c], 3)], 2000);
    expect(result.totals).toMatchObject({ activeSlots: 5, processCount: 3, treeRssBytes: 600, treeCpuPercent: 500 });
    expect(result).toMatchObject({ processTotals: { privateBytes: 1200, rssBytes: 600, cpuPercent: 500 } });
  });

  it('uses the latest generation of a reused PID rather than adding both', () => {
    const old = observation(20, '2', 200, 200, 100);
    const fresh = observation(20, '9', 500, 10, null);
    const result = mergeResourceEnvelopeSnapshots([snapshot('main', 10, 'main', 1000, [observation(10, '1', 100, 100, 0), old]), snapshot('gateway', 20, 'new', 2000, [fresh])], 2100);
    expect(result.totals).toMatchObject({ processCount: 2, treeRssBytes: 600 });
    expect(result).toMatchObject({ processTotals: { cpuPercent: null } });
  });

  it('rejects stale and future snapshots before their logical occupancy is added', () => {
    const live = snapshot('main', 10, 'main', 40_000, [observation(10, '1', 100, 100)], 1);
    const stale = snapshot('gateway', 20, 'old', 1000, [observation(20, '2', 1000, 1000)], 100);
    const future = snapshot('gateway', 20, 'future', 50_000, [observation(20, '2', 1000, 1000)], 100);
    for (const invalid of [stale, future]) {
      const result = mergeResourceEnvelopeSnapshots([live, invalid], 40_000);
      expect(result.totals.activeSlots).toBe(1);
      expect(result.warnings.length).toBeGreaterThan(0);
    }
  });

  it('selects the latest producer epoch and does not refresh a stale measurement on merge', () => {
    const old = snapshot('gateway', 20, 'old', 1000, [observation(20, '2', 200, 200)], 10);
    const fresh = snapshot('gateway', 20, 'new', 2000, [observation(20, '9', 300, 0)], 1);
    expect(mergeResourceEnvelopeSnapshots([old, fresh], 2100).totals.activeSlots).toBe(1);
    const stale = snapshot('main', 10, 'main', 1000, [observation(10, '1', 100, 100, 500)]);
    stale.generatedAt = 40_000;
    expect(mergeResourceEnvelopeSnapshots([stale], 40_000)).toMatchObject({ processTotals: { cpuPercent: null, rssBytes: null } });
  });

  it('starts a new CPU interval after PID reuse, discovery failure or an expired sample', async () => {
    let now = 1000;
    let current: ProcessTreeSample = {
      status: 'ok', sampledAt: now, rootPids: [10], processCount: 1, treeRssBytes: 100,
      treeCpuTimeMs: 100, treeCpuPercent: null, queueDepth: 0, queueWaitMs: 0, source: 'windows-cim',
      processes: [observation(10, '1', 100, 100)],
    } as ProcessTreeSample;
    const sampler = new ProcessTreeSampler({ now: () => now, readSample: async () => current });
    expect((await sampler.sample({ rootPids: [10] })).treeCpuPercent).toBeNull();
    now = 2000;
    current = { ...current, sampledAt: now, treeCpuTimeMs: 1000, processes: [observation(10, '2', 100, 1000)] } as ProcessTreeSample;
    expect((await sampler.sample({ rootPids: [10] })).treeCpuPercent).toBeNull();
    now = 3000;
    current = { ...current, sampledAt: now, treeCpuTimeMs: 1500, processes: [observation(10, '2', 100, 1500)] } as ProcessTreeSample;
    expect((await sampler.sample({ rootPids: [10] })).treeCpuPercent).toBe(50);
    current = { ...current, status: 'unknown' };
    await sampler.sample({ rootPids: [10] });
    now = 4000; current = { ...current, status: 'ok', sampledAt: now };
    expect((await sampler.sample({ rootPids: [10] })).treeCpuPercent).toBeNull();
    now = 40_000;
    expect((await sampler.sample({ rootPids: [10] })).status).toBe('unknown');
  });
});
