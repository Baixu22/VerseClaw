/**
 * Runtime Efficiency Orchestrator
 *
 * Wires the measurement surface (`efficiency-sampler.ts`) to the shed policy
 * (`efficiency-power-policy.ts`) and to Electron's power/visibility events.
 *
 * This is the only Electron-aware piece. Both underlying modules stay pure so
 * they remain unit testable without booting the app.
 *
 * Everything here is local-only. Nothing is uploaded.
 */

import { app, powerMonitor, BrowserWindow } from 'electron';
import { logger } from '../utils/logger';
import { EfficiencySampler, type EfficiencySummary } from './efficiency-sampler';
import { EfficiencyPowerPolicy, type EfficiencyShedState } from './efficiency-power-policy';
import { getBackgroundWorkGate, resetBackgroundWorkGateForTest, type BackgroundWorkGateState } from '../../openclaw_runtime/src/resources/background-work-gate';
import { getAggregatedResourceEnvelopeSnapshot } from './resource-envelope';

let sampler: EfficiencySampler | null = null;
let policy: EfficiencyPowerPolicy | null = null;
let started = false;
let unsubscribeWindowEvents: (() => void) | null = null;
let backgroundGateTimer: ReturnType<typeof setInterval> | null = null;
let backgroundGateInFlight = false;

function getOrCreate(): { sampler: EfficiencySampler; policy: EfficiencyPowerPolicy } {
  if (!sampler) {
    // The policy is constructed first so the sampler can read its shed state.
    policy = new EfficiencyPowerPolicy({
      onTransition: (state) => {
        logger.info('[efficiency] shed state changed', {
          shedding: state.shedding,
          reason: state.reason,
          activeReasons: state.activeReasons,
          transitionCount: state.transitionCount,
        });
      },
    });
    sampler = new EfficiencySampler({
      isShed: () => policy?.shedding ?? false,
    });
  }
  return { sampler: sampler as EfficiencySampler, policy: policy as EfficiencyPowerPolicy };
}

/**
 * Start efficiency sampling. Safe to call more than once.
 *
 * Sampling is opt-out via settings in the future; today the default is enabled
 * because the cost is a single unref'd 5s timer and one cheap counter read.
 */
function startBackgroundWorkGate(
  activeSampler: EfficiencySampler,
  activePolicy: EfficiencyPowerPolicy,
): void {
  if (backgroundGateTimer) return;
  const update = async (): Promise<void> => {
    if (backgroundGateInFlight) return;
    backgroundGateInFlight = true;
    try {
      const summary = activeSampler.getSummary();
      const snapshot = await getAggregatedResourceEnvelopeSnapshot();
      const latest = summary.latest;
      getBackgroundWorkGate().update({
        shedSignal: activePolicy.shedding,
        queueDepth: snapshot.totals.queuedCount,
        ...(latest ? { treeRssBytes: snapshot.totals.treeRssBytes, treeCpuPercent: latest.cpuPercent } : {}),
      });
    } catch (error) {
      logger.warn('[efficiency] background work gate update failed', error);
    } finally {
      backgroundGateInFlight = false;
    }
  };
  void update();
  backgroundGateTimer = setInterval(() => {
    void update();
  }, 5_000);
  backgroundGateTimer.unref?.();
}
export function startRuntimeEfficiency(): void {
  if (started) return;
  const { sampler: activeSampler, policy: activePolicy } = getOrCreate();

  activeSampler.start();
  started = true;
  startBackgroundWorkGate(activeSampler, activePolicy);
  logger.info('[efficiency] runtime efficiency sampling started', {
    intervalMs: 5000,
    platform: process.platform,
  });

  // Power state. Guarded because powerMonitor is unavailable in some headless
  // or E2E environments.
  try {
    // `speed-limit-change` is the authoritative cross-platform signal: the OS
    // advertises a CPU speed limit in percent, engaging when power saver or a
    // battery/thermal cap applies and releasing when it lifts. Treating any
    // limit below 100% as a power-saver state is stricter and more accurate than
    // inferring it from battery presence alone.
    const onSpeedLimit = (event: Electron.Event<{ limit: number }>): void => {
      activePolicy.update({ powerSaver: event.limit < 100 });
    };
    powerMonitor.on('speed-limit-change', onSpeedLimit);
    powerMonitor.on('resume', () => {
      activePolicy.update({ powerSaver: powerMonitor.isOnBatteryPower() });
    });
    powerMonitor.on('suspend', () => activePolicy.update({ displaySleep: true }));
    powerMonitor.on('unlock-screen', () => activePolicy.update({ displaySleep: false }));
    // Prime the current state so starting under an existing cap is reflected.
    activePolicy.update({ powerSaver: powerMonitor.isOnBatteryPower() });
  } catch (error) {
    logger.warn('[efficiency] powerMonitor unavailable; shed policy limited to window visibility', error);
  }

  // Window visibility. Tracked per window so closing one window does not leave
  // a stale listener behind.
  unsubscribeWindowEvents = attachWindowVisibility();
}

/**
 * Feed renderer visibility into the shed policy.
 *
 * Renderer pages already suspend their own animation loops on
 * `document.hidden`; this adds the main-process view of the same signal so
 * background polling can be shed too.
 */
export function attachWindowVisibility(): () => void {
  const { policy: activePolicy } = getOrCreate();
  const detachers: Array<() => void> = [];

  const register = (win: BrowserWindow) => {
    const sync = () => activePolicy.update({ windowHidden: !win.isVisible() || win.isMinimized() });
    win.on('hide', sync);
    win.on('show', sync);
    win.on('minimize', sync);
    win.on('restore', sync);
    sync();
    detachers.push(() => {
      win.removeListener('hide', sync);
      win.removeListener('show', sync);
      win.removeListener('minimize', sync);
      win.removeListener('restore', sync);
    });
  };

  for (const win of BrowserWindow.getAllWindows()) register(win);
  const onWindowCreated = (_event: unknown, win: BrowserWindow) => register(win);
  app.on('browser-window-created', onWindowCreated);

  return () => {
    for (const detach of detachers) detach();
    app.removeListener('browser-window-created', onWindowCreated);
  };
}

/** Stop sampling and detach listeners. Safe to call when not started. */
export function stopRuntimeEfficiency(): void {
  if (!started) return;
  if (backgroundGateTimer) {
    clearInterval(backgroundGateTimer);
    backgroundGateTimer = null;
  }
  sampler?.stop();
  unsubscribeWindowEvents?.();
  unsubscribeWindowEvents = null;
  started = false;
  logger.info('[efficiency] runtime efficiency sampling stopped');
}

export function getEfficiencySummary(): EfficiencySummary | null {
  return sampler?.getSummary() ?? null;
}

export function getEfficiencyShedState(): EfficiencyShedState | null {
  return policy?.getState() ?? null;
}

export function getBackgroundWorkGateState(): BackgroundWorkGateState | null {
  return started ? getBackgroundWorkGate().getState() : null;
}

export function isRuntimeEfficiencyRunning(): boolean {
  return started;
}

/** Test seam: drop all module state. */
export function resetRuntimeEfficiencyForTests(): void {
  stopRuntimeEfficiency();
  sampler = null;
  policy = null;
  started = false;
  backgroundGateInFlight = false;
  resetBackgroundWorkGateForTest();
}
