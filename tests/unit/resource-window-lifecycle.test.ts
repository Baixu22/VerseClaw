// @vitest-environment node
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ windows: [] as FakeWindow[], snapshot: vi.fn(), refresh: null as null | (() => Promise<void>) }));
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  return { app: new EventEmitter(), powerMonitor: Object.assign(new EventEmitter(), { isOnBatteryPower: () => false }), BrowserWindow: { getAllWindows: () => mocks.windows } };
});
vi.mock('../../electron/utils/logger', () => ({ logger: { info() {}, warn() {} } }));
vi.mock('../../electron/services/resource-envelope', () => ({ getAggregatedResourceEnvelopeSnapshot: mocks.snapshot }));
vi.mock('../../electron/services/efficiency-sampler', () => ({ EfficiencySampler: class { start() {} stop() {} } }));
vi.mock('../../shared/resources', async importOriginal => ({ ...await importOriginal<typeof import('../../shared/resources')>(), getTimerAligner: () => ({ setShedding() {}, register: (task: { run: () => Promise<void> }) => { mocks.refresh = task.run; return () => { mocks.refresh = null; }; } }) }));
import { app, powerMonitor } from 'electron';
import { getEfficiencyShedState, startRuntimeEfficiency, stopRuntimeEfficiency, resetRuntimeEfficiencyForTests } from '../../electron/services/efficiency-orchestrator';
import { getBackgroundWorkGate } from '../../openclaw_runtime/src/resources/background-work-gate';
import { getResourceFabric } from '../../electron/services/resource-fabric';
import { registerWindowVisibility } from '../../electron/main/window-visibility';
import type { BrowserWindow } from 'electron';

class FakeWindow extends EventEmitter {
  webContents = Object.assign(new EventEmitter(), { isDestroyed: () => false, send: vi.fn() });
  visible = true; minimized = false; destroyed = false;
  isVisible() { if (this.destroyed) throw new Error('Window destroyed'); return this.visible; }
  isMinimized() { return this.minimized; }
  isDestroyed() { return this.destroyed; }
  hide() { this.visible = false; this.emit('hide'); }
  close() { this.destroyed = true; mocks.windows = mocks.windows.filter(w => w !== this); this.emit('closed'); }
}
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const healthy = { totals: { queuedCount: 0 }, processTotals: { cpuPercent: 0, rssBytes: 0 } };
beforeEach(() => { mocks.windows = []; mocks.snapshot.mockReset().mockResolvedValue(healthy); });
afterEach(() => { resetRuntimeEfficiencyForTests(); app.removeAllListeners(); powerMonitor.removeAllListeners(); });

describe('window resource lifetimes', () => {
  it('publishes per-window native visibility and releases bridge listeners on close', () => {
    const win = new FakeWindow(); const contents = win.webContents;
    Object.defineProperty(win, 'webContents', { get: () => { if (win.destroyed) throw new Error('Object has been destroyed'); return contents; } });
    registerWindowVisibility(win as unknown as BrowserWindow);
    win.webContents.emit('did-finish-load');
    expect(win.webContents.send).toHaveBeenLastCalledWith('window:visibility', true);
    win.hide(); expect(win.webContents.send).toHaveBeenLastCalledWith('window:visibility', false);
    win.close(); expect(win.listenerCount('show')).toBe(0); expect(contents.listenerCount('did-finish-load')).toBe(0);
  });
  it('aggregates visibility and detaches a closed window before reopen', async () => {
    const first = new FakeWindow(); const second = new FakeWindow(); mocks.windows = [first, second];
    startRuntimeEfficiency(); await flush();
    second.hide(); expect(getEfficiencyShedState()?.shedding).toBe(false);
    first.hide(); expect(getEfficiencyShedState()?.shedding).toBe(true);
    const third = new FakeWindow(); mocks.windows.push(third); app.emit('browser-window-created', {}, third);
    expect(getEfficiencyShedState()?.shedding).toBe(false);
    second.close(); expect(second.listenerCount('hide')).toBe(0);
    third.close(); expect(getEfficiencyShedState()?.shedding).toBe(true);
    first.close(); expect(first.listenerCount('show')).toBe(0);
    stopRuntimeEfficiency(); expect(app.listenerCount('browser-window-created')).toBe(0);
  });
  it('releases power listeners on stop and creates one set on restart', () => {
    startRuntimeEfficiency(); stopRuntimeEfficiency(); startRuntimeEfficiency();
    for (const name of ['speed-limit-change', 'resume', 'suspend', 'unlock-screen']) expect(powerMonitor.listenerCount(name)).toBe(1);
    stopRuntimeEfficiency();
    for (const name of ['speed-limit-change', 'resume', 'suspend', 'unlock-screen']) expect(powerMonitor.listenerCount(name)).toBe(0);
  });
  it('ignores a late pressure result after stopping and restarting its generation', async () => {
    mocks.windows = [new FakeWindow()];
    let resolve!: (value: typeof healthy) => void;
    mocks.snapshot.mockImplementationOnce(() => new Promise<typeof healthy>(done => { resolve = done; }));
    startRuntimeEfficiency(); stopRuntimeEfficiency(); startRuntimeEfficiency(); await flush();
    resolve({ totals: { queuedCount: 100 }, processTotals: { cpuPercent: 400, rssBytes: 0 } }); await flush();
    expect(mocks.snapshot).toHaveBeenCalledTimes(2);
    expect(getBackgroundWorkGate().getState().deferring).toBe(false);
    expect(getResourceFabric().getDiagnostics().pressure.reasons).toEqual([]);
  });
  it('releases observation pressure on stop without dropping queued work', async () => {
    startRuntimeEfficiency(); await flush();
    const work = vi.fn(async () => 'completed');
    const gate = getBackgroundWorkGate();
    gate.update({ shedSignal: true });
    const pending = gate.runBackground('task', work);
    expect(work).not.toHaveBeenCalled();
    stopRuntimeEfficiency();
    expect(await pending).toBe('completed'); expect(work).toHaveBeenCalledOnce();
    expect(gate.getState().pendingCount).toBe(0);
  });
  it('feeds fresh memory pressure to admission and clears it when sampling stops', async () => {
    mocks.snapshot.mockResolvedValue({ ...healthy, machineMemory: { sampledAt: Date.now(), availablePhysicalBytes: 5, totalPhysicalBytes: 100 } });
    startRuntimeEfficiency(); await flush();
    expect(getResourceFabric().getDiagnostics().pressure.reasons).toEqual(['physical-memory']);
    stopRuntimeEfficiency();
    expect(getResourceFabric().getDiagnostics().pressure.reasons).toEqual([]);
  });
});
