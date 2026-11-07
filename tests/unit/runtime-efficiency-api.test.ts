/**
 * P2 #161: runtime efficiency host-api contract.
 *
 * The renderer-visible surface must fail closed (no invented values) and the
 * toggle must actually start/stop the Main sampler.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const state = { enabled: true };
  return {
    state,
    getSettingMock: vi.fn(async () => state.enabled),
    setSettingMock: vi.fn(async (_key: string, value: boolean) => {
      state.enabled = value;
    }),
  };
});

vi.mock('electron', () => ({
  app: { on: vi.fn(), removeListener: vi.fn() },
  powerMonitor: { on: vi.fn(), removeListener: vi.fn(), isOnBatteryPower: () => false },
  BrowserWindow: { getAllWindows: () => [] },
}));

vi.mock('../../electron/utils/store', () => ({
  getSetting: mocks.getSettingMock,
  setSetting: mocks.setSettingMock,
}));

import { createEfficiencyApi } from '../../electron/services/efficiency-api';
import { resetRuntimeEfficiencyForTests } from '../../electron/services/efficiency-orchestrator';

describe('runtime efficiency host api', () => {
  beforeEach(() => {
    mocks.state.enabled = true;
    mocks.getSettingMock.mockClear();
    mocks.setSettingMock.mockClear();
    resetRuntimeEfficiencyForTests();
  });

  afterEach(() => {
    resetRuntimeEfficiencyForTests();
  });

  it('fails closed to not-sampled before any real sample', async () => {
    const state = await createEfficiencyApi().getState();
    expect(state.enabled).toBe(true);
    expect(state.running).toBe(false);
    expect(state.measured).toBe(false);
    expect(state.summary).toBeNull();
    expect(state.samples).toEqual([]);
    expect(state.performance.counters.spawnCount).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(state.performance.marks)).toBe(true);
  });

  it('persists the toggle and starts or stops the sampler', async () => {
    const api = createEfficiencyApi();

    const off = await api.setEnabled({ enabled: false });
    expect(mocks.setSettingMock).toHaveBeenCalledWith('efficiencySamplingEnabled', false);
    expect(off.enabled).toBe(false);
    expect(off.running).toBe(false);

    const on = await api.setEnabled({ enabled: true });
    expect(mocks.setSettingMock).toHaveBeenCalledWith('efficiencySamplingEnabled', true);
    expect(on.enabled).toBe(true);
    expect(on.running).toBe(true);
    // Running but not yet sampled: still fail closed, never a healthy zero.
    expect(on.measured).toBe(false);
    expect(on.summary).toBeNull();
  });

  it('rejects a non-boolean payload instead of guessing', async () => {
    const invalid = { enabled: 'yes' } as unknown as { enabled: boolean };
    await expect(createEfficiencyApi().setEnabled(invalid)).rejects.toThrow();
    expect(mocks.setSettingMock).not.toHaveBeenCalled();
  });
});
