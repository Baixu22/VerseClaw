import { afterEach, describe, expect, it } from 'vitest';
import { AdaptiveLimit } from '../../shared/resources/adaptive-limit';
import { ResourceFabric } from '../../electron/services/resource-fabric';
import { getResourceEnvelopeLedger, resetResourceEnvelopeLedgerForTest } from '../../openclaw_runtime/src/resources/resource-envelope';
import { mergeResourceEnvelopeSnapshots } from '../../openclaw_runtime/src/resources/resource-envelope';

afterEach(() => resetResourceEnvelopeLedgerForTest());

describe('adaptive resource pressure', () => {
  it('contracts when latency worsens despite a full backlog', () => {
    const limit = new AdaptiveLimit({ initialLimit: 4, minLimit: 1, maxLimit: 8 });
    limit.sample(100, 0);
    expect(limit.sample(1000, 64)).toBeLessThanOrEqual(4);
    expect(limit.sample(1000, 64)).toBeLessThan(4);
  });
  it('treats backlog as demand and grows gradually after healthy samples', () => {
    const limit = new AdaptiveLimit({ initialLimit: 2, minLimit: 1, maxLimit: 8 });
    expect(limit.sample(100, 64)).toBe(2);
    expect(limit.sample(100, 64)).toBe(2);
    expect(limit.sample(100, 64)).toBe(3);
    expect(limit.sample(100, 64)).toBe(3);
  });
  it('reaches a configured large cap with sustained healthy one-slot growth', () => {
    const limit = new AdaptiveLimit({ initialLimit: 2, minLimit: 1, maxLimit: 16 });
    for (let i = 0; i < 60; i++) {
      const before = limit.limit;
      const after = limit.sample(100, 64, 'read');
      expect(after - before).toBeLessThanOrEqual(1);
    }
    expect(limit.limit).toBe(16);
  });
  it('isolates read, long execution and remote service latency', () => {
    const limit = new AdaptiveLimit({ initialLimit: 4, minLimit: 1, maxLimit: 8 });
    for (let i = 0; i < 10; i++) {
      expect(limit.sample(10, 0, 'read')).toBe(4);
      expect(limit.sample(10_000, 0, 'execution')).toBe(4);
      expect(limit.sample(i % 2 ? 60_000 : 1, 64, 'remote-wait')).toBe(4);
    }
    expect(limit.getDiagnostics().phases.read?.long).toBe(10);
    expect(limit.getDiagnostics().phases.execution?.long).toBe(10_000);
    expect(limit.sample(100, 64, 'read')).toBe(4);
    expect(limit.sample(100, 64, 'read')).toBeLessThan(4);
  });
  it('isolates fast reads from Git and log output from builds within a phase', async () => {
    let now = 1000;
    const fabric = new ResourceFabric({ now: () => now });
    for (let i = 0; i < 8; i++) {
      for (const [phase, operationKey, duration] of [['read', 'read', 2], ['read', 'git', 180], ['execution', 'log', 100], ['execution', 'build', 600]] as const) {
        await fabric.runResource('workspaceExec', 'mixed', { phase, operationKey }, async () => { now += duration; });
        expect(fabric.getDiagnostics().accounts['workspaceExec:mixed'].limit).toBe(2);
      }
    }
    const feedback = fabric.getDiagnostics().accounts['workspaceExec:mixed'].feedback;
    expect(feedback.phases['read:read'].long).toBe(2);
    expect(feedback.phases['read:git'].long).toBe(180);
    expect(feedback.phases['execution:log'].long).toBe(100);
    expect(feedback.phases['execution:build'].long).toBe(600);
    fabric.observeLatency('workspaceExec', 'mixed', 100, 64, 'read', 'read');
    fabric.observeLatency('workspaceExec', 'mixed', 100, 64, 'read', 'read');
    expect(fabric.getDiagnostics().accounts['workspaceExec:mixed'].limit).toBe(1);
  });
  it('bounds operation baselines and rejects unbounded identities before admission', async () => {
    const limit = new AdaptiveLimit({ initialLimit: 2, minLimit: 1, maxLimit: 4 });
    for (let i = 0; i < 100; i++) limit.sample(i + 1, 0, 'read', String(i));
    expect(Object.keys(limit.getDiagnostics().phases)).toHaveLength(32);
    expect(limit.getDiagnostics().phases['read:0']).toBeUndefined();
    expect(limit.getDiagnostics().phases['read:99'].long).toBe(100);
    const fabric = new ResourceFabric();
    await expect(fabric.acquire('workspaceExec', 'invalid', { operationKey: 'x'.repeat(65) })).rejects.toThrow('operation key');
    expect(fabric.getDiagnostics().accounts['workspaceExec:invalid']).toMatchObject({ active: 0, queued: 0 });
  });
  it('recovers concurrency after pressure while operation identities exceed the LRU', () => {
    const limit = new AdaptiveLimit({ initialLimit: 2, minLimit: 1, maxLimit: 4 });
    expect(limit.setPressure(true)).toBe(1);
    limit.setPressure(false);
    for (let i = 0; i < 132; i++) limit.sample(10, 64, 'read', `command-${i % 33}`);
    expect(limit.limit).toBe(4);
    expect(Object.keys(limit.getDiagnostics().phases)).toHaveLength(32);
  });
  it('does not turn an isolated read pause into sustained serial execution', () => {
    const limit = new AdaptiveLimit({ initialLimit: 2, minLimit: 1, maxLimit: 4 });
    limit.sample(2, 0, 'read');
    expect(limit.sample(160, 64, 'read')).toBe(2);
    for (let i = 0; i < 6; i++) limit.sample(2, 64, 'read');
    expect(limit.limit).toBe(4);
  });
  it('requires sustained recovery after congestion instead of learning overload as healthy', () => {
    const limit = new AdaptiveLimit({ initialLimit: 4, minLimit: 1, maxLimit: 8 });
    limit.sample(100);
    for (let i = 0; i < 30; i++) limit.sample(1000, 64);
    expect(limit.limit).toBe(1);
    for (let i = 0; i < 3; i++) expect(limit.sample(100, 64)).toBe(1);
    for (let i = 0; i < 80; i++) limit.sample(100, 64);
    expect(limit.limit).toBe(8);
  });
  it('retains active ownership while pressure contracts admission and blocks demand-driven growth', async () => {
    let now = 1000;
    const fabric = new ResourceFabric({ now: () => now });
    const first = await fabric.acquire('workspaceExec', 'ws', { phase: 'read' });
    const second = await fabric.acquire('workspaceExec', 'ws', { phase: 'read' });
    fabric.observePressure({ machineMemory: { sampledAt: now, availablePhysicalBytes: 5, totalPhysicalBytes: 100 } });
    expect(fabric.getDiagnostics().accounts['workspaceExec:ws']).toMatchObject({ active: 2, limit: 1, minLimit: 1, maxLimit: 4, queueLimit: 64 });
    let started = false;
    const waiting = fabric.acquire('workspaceExec', 'ws', { phase: 'read' }).then(lease => { started = true; return lease; });
    for (let i = 0; i < 10; i++) fabric.observeLatency('workspaceExec', 'ws', 10, 64, 'read');
    now += 10; first.release(); await Promise.resolve();
    expect(started).toBe(false);
    second.release(); (await waiting).release();
    expect(fabric.getDiagnostics().accounts['workspaceExec:ws']).toMatchObject({ active: 0, queued: 0, limit: 1 });
  });
  it('needs fresh low-pressure observations spanning dwell; missing, replayed and stale samples cannot recover', () => {
    let now = 1000;
    const fabric = new ResourceFabric({ now: () => now });
    const memory = (sampledAt: number, free: number) => ({ machineMemory: { sampledAt, availablePhysicalBytes: free, totalPhysicalBytes: 100 } });
    fabric.observePressure(memory(now, 5));
    now = 2000; fabric.observePressure(memory(now, 30));
    now = 12_000; fabric.observePressure(memory(2000, 30));
    expect(fabric.getDiagnostics().pressure.reasons).toEqual(['physical-memory']);
    fabric.observePressure({});
    fabric.observePressure(memory(-30_000, 30));
    fabric.observePressure(memory(now + 1, 30));
    fabric.observePressure({ machineMemory: { sampledAt: now, availablePhysicalBytes: 30, totalPhysicalBytes: Infinity } });
    fabric.observePressure(memory(now, 12));
    expect(fabric.getDiagnostics().pressure.reasons).toEqual(['physical-memory']);
    now = 13_000; fabric.observePressure(memory(now, 30));
    now = 22_999; fabric.observePressure(memory(now, 30));
    expect(fabric.getDiagnostics().pressure.reasons).toEqual(['physical-memory']);
    now = 23_000; fabric.observePressure(memory(now, 30));
    expect(fabric.getDiagnostics().pressure.reasons).toEqual([]);
  });
  it('retains each independent commit and event-loop cause until that signal recovers', () => {
    let now = 1000;
    const fabric = new ResourceFabric({ now: () => now });
    const commit = (ratio: number) => ({ sampledAt: now, committedBytes: ratio, commitLimitBytes: 100 });
    const loop = (degraded: boolean) => ({ sampledAt: now, ownerEpoch: 'test', degraded, delayP99Ms: 100, delayMaxMs: 100, utilization: 0.5 });
    fabric.observePressure({ machineCommit: commit(95), eventLoopPressure: loop(true) });
    now += 1000; fabric.observePressure({ machineCommit: commit(50), eventLoopPressure: loop(true) });
    now += 10_000; fabric.observePressure({ machineCommit: commit(50), eventLoopPressure: loop(true) });
    expect(fabric.getDiagnostics().pressure.reasons).toEqual(['event-loop']);
    now += 1000; fabric.observePressure({ machineCommit: commit(50), eventLoopPressure: loop(false) });
    now += 10_000; fabric.observePressure({ machineCommit: commit(50), eventLoopPressure: loop(false) });
    expect(fabric.getDiagnostics().pressure.reasons).toEqual([]);
    expect(fabric.getDiagnostics().pressure.disabledSignals).toContain('cpu-utilization-only');
  });
  it('does not use infinite commit capacity or a long observation gap as recovery', () => {
    let now = 1000;
    const fabric = new ResourceFabric({ now: () => now });
    const update = (used: number, limit = 100) => fabric.observePressure({ machineCommit: { sampledAt: now, committedBytes: used, commitLimitBytes: limit } });
    update(95); now += 1000; update(50);
    now += 10_000; update(50, Infinity);
    expect(fabric.getDiagnostics().pressure.reasons).toEqual(['system-commit']);
    now += 1000; update(50);
    now += 60_000; update(50);
    expect(fabric.getDiagnostics().pressure.reasons).toEqual(['system-commit']);
    now += 10_000; update(50);
    expect(fabric.getDiagnostics().pressure.reasons).toEqual([]);
  });
  it('recovers a cached commit signal on its next fresh probe without replay advancing dwell', () => {
    let now = 1000;
    const fabric = new ResourceFabric({ now: () => now });
    const commit = (sampledAt: number, used: number) => fabric.observePressure({ machineCommit: { sampledAt, committedBytes: used, commitLimitBytes: 100 } });
    commit(now, 95); now = 6000; commit(now, 50);
    for (now = 11_000; now <= 36_000; now += 5000) {
      commit(6000, 50);
      expect(fabric.getDiagnostics().pressure.reasons).toEqual(['system-commit']);
    }
    commit(now, 50);
    expect(fabric.getDiagnostics().pressure.reasons).toEqual([]);
  });
  it('reclaims cold empty accounts and reconstructs them without evicting active or queued owners', async () => {
    let now = 1000;
    const fabric = new ResourceFabric({ now: () => now });
    const cold = await fabric.acquire('workspaceExec', 'cold'); cold.release();
    const live = await fabric.acquire('workspaceExec', 'live');
    const live2 = await fabric.acquire('workspaceExec', 'live');
    const waiting = fabric.acquire('workspaceExec', 'live', { timeoutMs: 600_000 });
    now += 300_001;
    expect(fabric.reclaimIdleAccounts()).toBe(1);
    expect(getResourceEnvelopeLedger().get('main:terminal-exec:cold')).toBeUndefined();
    expect(fabric.getDiagnostics().accounts['workspaceExec:live']).toMatchObject({ active: 2, queued: 1 });
    live.release(); (await waiting).release(); live2.release();
    const rebuilt = await fabric.acquire('workspaceExec', 'cold');
    expect(rebuilt.limit).toBe(2); rebuilt.release();
    expect(fabric.isFair()).toBe(true);
  });
  it('propagates real lease categories and history semantics to feedback', async () => {
    let now = 1000;
    const fabric = new ResourceFabric({ now: () => now });
    await fabric.runResource('workspaceExec', 'ws', { phase: 'execution' }, async () => { now += 5000; });
    await fabric.runResource('workspaceExec', 'ws', { phase: 'read' }, async () => { now += 5; });
    await fabric.run('chat.history', { sessionKey: 'a' }, 1000, async () => { now += 10; return []; });
    expect(fabric.getDiagnostics().accounts['workspaceExec:ws'].feedback.phases).toMatchObject({ execution: { long: 5000 }, read: { long: 5 } });
    expect(fabric.getDiagnostics().chatHistory?.feedback.phases.read?.long).toBe(10);
  });
  it('merges commit counters with their original timestamp and discards stale readings', () => {
    const snapshot = getResourceEnvelopeLedger().snapshot(40_000);
    snapshot.machineCommit = { sampledAt: 39_000, committedBytes: 90, commitLimitBytes: 100 };
    expect(mergeResourceEnvelopeSnapshots([snapshot], 40_000).machineCommit).toEqual(snapshot.machineCommit);
    snapshot.machineCommit.sampledAt = 1000;
    expect(mergeResourceEnvelopeSnapshots([snapshot], 40_000).machineCommit).toBeUndefined();
  });
});
