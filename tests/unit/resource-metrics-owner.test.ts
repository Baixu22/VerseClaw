// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getResourceEnvelopeLedger, resetResourceEnvelopeLedgerForTest } from '../../openclaw_runtime/src/resources/resource-envelope';
import { createGatewayEventLoopHealthMonitor } from '../../openclaw_runtime/src/gateway/server/event-loop-health';
import { getBackgroundWorkGate } from '../../openclaw_runtime/src/resources/background-work-gate';

const mocks = vi.hoisted(() => ({ snapshot: vi.fn(), publish: vi.fn(), warn: vi.fn(), refresh: null as null | (() => Promise<void>) }));
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  const win = Object.assign(new EventEmitter(), { isDestroyed: () => false, isVisible: () => true, isMinimized: () => false });
  return { app: new EventEmitter(), powerMonitor: Object.assign(new EventEmitter(), { isOnBatteryPower: () => false }), BrowserWindow: { getAllWindows: () => [win] } };
});
vi.mock('../../electron/utils/logger', () => ({ logger: { info() {}, warn: mocks.warn } }));
vi.mock('../../electron/services/resource-envelope', () => ({ getAggregatedResourceEnvelopeSnapshot: mocks.snapshot }));
vi.mock('../../openclaw_runtime/src/resources/resource-envelope-snapshot-store', () => ({ writeResourceEnvelopeSnapshot: mocks.publish }));
vi.mock('../../electron/services/efficiency-sampler', () => ({ EfficiencySampler: class {
  start() {} stop() {} getSummary() { return { latest: { cpuPercent: 0 } }; }
} }));
vi.mock('../../shared/resources', async importOriginal => ({ ...await importOriginal<typeof import('../../shared/resources')>(), getTimerAligner: () => ({ setShedding() {}, register: (task: { id: string; run: () => Promise<void> }) => {
  if (task.id !== 'efficiency-background-gate') return () => {};
  mocks.refresh = task.run; return () => { mocks.refresh = null; };
} }) }));

import { resetRuntimeEfficiencyForTests, startRuntimeEfficiency } from '../../electron/services/efficiency-orchestrator';

const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1000); vi.stubEnv('OPENCLAW_RESOURCE_ENVELOPE_WRITE', '0'); mocks.snapshot.mockClear(); mocks.publish.mockClear(); mocks.warn.mockClear(); resetResourceEnvelopeLedgerForTest(); });
afterEach(() => { resetRuntimeEfficiencyForTests(); resetResourceEnvelopeLedgerForTest(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe('resource measurement owners', () => {
  it('holds background work for a busy Gateway while Main is idle and waits for measured recovery', async () => {
    mocks.snapshot.mockResolvedValue({ totals: { queuedCount: 0 }, processTotals: { rssBytes: 100, cpuPercent: 400 } });
    startRuntimeEfficiency(); await flush();
    expect(getBackgroundWorkGate().getState()).toMatchObject({ deferring: true, reason: 'tree-cpu' });
    vi.setSystemTime(20_000);
    mocks.snapshot.mockResolvedValue({ totals: { queuedCount: 0 }, processTotals: { rssBytes: null, cpuPercent: null } });
    await mocks.refresh!();
    expect(getBackgroundWorkGate().getState().deferring).toBe(true);
    mocks.snapshot.mockResolvedValue({ totals: { queuedCount: 0 }, processTotals: { rssBytes: 100, cpuPercent: 10 } });
    await mocks.refresh!();
    expect(mocks.snapshot).toHaveBeenCalledTimes(3);
    expect(mocks.warn).not.toHaveBeenCalled();
    expect(getBackgroundWorkGate().getState()).toMatchObject({ deferring: false, activeReasons: [] });
  });

  it('projects the existing Gateway event-loop classification with an epoch and clears it on stop', () => {
    const histogram = { enable() {}, disable: vi.fn(), reset() {}, percentile: () => 2_000_000_000, max: 2_000_000_000 };
    const monitor = createGatewayEventLoopHealthMonitor({
      now: Date.now, cpuUsage: () => ({ user: 0, system: 0 }),
      eventLoopUtilization: () => ({ idle: 0, active: 1, utilization: 1 }),
      createDelayMonitor: () => histogram as never,
    });
    vi.setSystemTime(3000); monitor.snapshot();
    expect(mocks.publish).not.toHaveBeenCalled();
    const snapshot = getResourceEnvelopeLedger().snapshot();
    expect(snapshot.eventLoopPressure).toMatchObject({ sampledAt: 3000, degraded: true, delayP99Ms: 2000, ownerEpoch: snapshot.producer?.epoch });
    vi.stubEnv('OPENCLAW_RESOURCE_ENVELOPE_WRITE', '1'); vi.setSystemTime(5000); monitor.snapshot();
    expect(mocks.publish).toHaveBeenCalledWith(expect.objectContaining({ eventLoopPressure: expect.objectContaining({ degraded: true, sampledAt: 5000 }) }));
    monitor.stop();
    expect(getResourceEnvelopeLedger().snapshot().eventLoopPressure).toBeUndefined();
    expect(histogram.disable).toHaveBeenCalledOnce();
  });

  it('feeds fresh event-loop pressure to the existing background gate', async () => {
    mocks.snapshot.mockResolvedValue({ totals: { queuedCount: 0 }, eventLoopPressure: { degraded: true } });
    startRuntimeEfficiency(); await flush();
    expect(getBackgroundWorkGate().getState()).toMatchObject({ deferring: true, reason: 'event-loop' });
    vi.setSystemTime(20_000);
    mocks.snapshot.mockResolvedValue({ totals: { queuedCount: 0 } });
    await mocks.refresh!();
    expect(getBackgroundWorkGate().getState().deferring).toBe(true);
    mocks.snapshot.mockResolvedValue({ totals: { queuedCount: 0 }, eventLoopPressure: { degraded: false } });
    await mocks.refresh!();
    expect(getBackgroundWorkGate().getState().deferring).toBe(false);
  });
});
