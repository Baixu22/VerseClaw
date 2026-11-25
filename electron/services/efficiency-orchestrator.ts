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
import { getResourceFabric } from './resource-fabric';
import { getTimerAligner } from '../../shared/resources';
import { setManagedProcessHostPressure, pruneManagedProcessHostPressure } from '../../openclaw_runtime/src/agents/verseshell/managed-process-reservation';
import { taskLedgerOwnIncarnation } from '../../shared/task-ledger-process';
import { getResourceEnvelopeLedger } from '../../openclaw_runtime/src/resources/resource-envelope';

let sampler: EfficiencySampler | null = null;
let policy: EfficiencyPowerPolicy | null = null;
let started = false;
let protectionStarted = false;
let unsubscribeWindowEvents: (() => void) | null = null;
let unsubscribePowerEvents: (() => void) | null = null;
let backgroundGateUnregister: (() => void) | null = null;
let efficiencyGeneration = 0;
let publishedHostPressure: boolean | null = null;
let publishedIncarnation: string | null = null;

function getOrCreate(): { sampler: EfficiencySampler; policy: EfficiencyPowerPolicy } {
  if (!sampler) {
    // The policy is constructed first so the sampler can read its shed state.
    policy = new EfficiencyPowerPolicy({
      onTransition: (state) => {
        getTimerAligner().setShedding(state.shedding);
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

/** The single protection observer continues independently of diagnostic recording. */
function startBackgroundWorkGate(
  activePolicy: EfficiencyPowerPolicy,
): void {
  if (backgroundGateUnregister) return;
  const generation = efficiencyGeneration;
  let inFlight = false;
  const update = async (): Promise<void> => {
    if (!protectionStarted || generation !== efficiencyGeneration || inFlight) return;
    inFlight = true;
    try {
      const snapshot = await getAggregatedResourceEnvelopeSnapshot();
      if (!protectionStarted || generation !== efficiencyGeneration) return;
      const fabric = getResourceFabric();
      fabric.observePressure(snapshot);
      const pressured = fabric.getDiagnostics().pressure.reasons.length > 0;
      const ownProcess = snapshot.entries?.find(entry => entry.id === 'main:process-tree'
        && entry.processMeasurement?.ownerEpoch === getResourceEnvelopeLedger().ownerEpoch)
        ?.processMeasurement?.processes.find(record => record.pid === process.pid);
      let incarnation = process.platform === 'win32' ? ownProcess?.creationToken ?? null : null;
      if (pressured && process.platform !== 'win32') {
        try { incarnation = taskLedgerOwnIncarnation(); } catch { /* Unknown birth keeps conservative pressure. */ }
      }
      // A missing observation cannot erase an already measured birth identity.
      incarnation ??= publishedIncarnation;
      if (pressured !== publishedHostPressure || (pressured && incarnation !== publishedIncarnation)) {
        setManagedProcessHostPressure(pressured, incarnation);
        publishedHostPressure = pressured;
        publishedIncarnation = incarnation;
      }
      pruneManagedProcessHostPressure();
      const physical = snapshot.processTotals;
      getBackgroundWorkGate().update({
        shedSignal: activePolicy.shedding || pressured,
        queueDepth: snapshot.totals.queuedCount,
        ...(physical?.rssBytes != null ? { treeRssBytes: physical.rssBytes } : {}),
        ...(physical?.cpuPercent != null ? { treeCpuPercent: physical.cpuPercent } : {}),
        ...(snapshot.eventLoopPressure ? { eventLoopDegraded: snapshot.eventLoopPressure.degraded } : {}),
      });
    } catch (error) {
      if (protectionStarted && generation === efficiencyGeneration) getResourceFabric().observePressure({});
      logger.warn('[efficiency] background work gate update failed', error);
    } finally {
      inFlight = false;
    }
  };
  void update();
  backgroundGateUnregister = getTimerAligner().register({
    id: 'efficiency-background-gate',
    intervalMs: 5_000,
    priority: 'interactive',
    run: update,
  });
}
export function startRuntimeResourceProtection(): void {
  if (protectionStarted) return;
  const { policy: activePolicy } = getOrCreate();
  efficiencyGeneration += 1;
  protectionStarted = true;
  startBackgroundWorkGate(activePolicy);

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
    const onResume = () => activePolicy.update({ powerSaver: powerMonitor.isOnBatteryPower() });
    const onSuspend = () => activePolicy.update({ displaySleep: true });
    const onUnlock = () => activePolicy.update({ displaySleep: false });
    unsubscribePowerEvents = () => {
      powerMonitor.removeListener('speed-limit-change', onSpeedLimit);
      powerMonitor.removeListener('resume', onResume);
      powerMonitor.removeListener('suspend', onSuspend);
      powerMonitor.removeListener('unlock-screen', onUnlock);
    };
    powerMonitor.on('speed-limit-change', onSpeedLimit);
    powerMonitor.on('resume', onResume);
    powerMonitor.on('suspend', onSuspend);
    powerMonitor.on('unlock-screen', onUnlock);
    // Prime the current state so starting under an existing cap is reflected.
    activePolicy.update({ powerSaver: powerMonitor.isOnBatteryPower() });
  } catch (error) {
    logger.warn('[efficiency] powerMonitor unavailable; shed policy limited to window visibility', error);
  }

  // Window visibility. Tracked per window so closing one window does not leave
  // a stale listener behind.
  unsubscribeWindowEvents = attachWindowVisibility();
}

/** Recording is optional; the single protection observer has the app's lifetime. */
export function startRuntimeEfficiency(): void {
  startRuntimeResourceProtection();
  if (started) return;
  getOrCreate().sampler.start();
  started = true;
  logger.info('[efficiency] runtime efficiency sampling started');
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
  const detachers = new Map<BrowserWindow, () => void>();
  const sync = () => activePolicy.update({
    windowHidden: ![...detachers.keys()].some(win => !win.isDestroyed() && win.isVisible() && !win.isMinimized()),
  });

  const register = (win: BrowserWindow) => {
    if (win.isDestroyed() || detachers.has(win)) return;
    const onClosed = () => { detachers.get(win)?.(); sync(); };
    win.on('hide', sync);
    win.on('show', sync);
    win.on('minimize', sync);
    win.on('restore', sync);
    win.on('closed', onClosed);
    detachers.set(win, () => {
      win.removeListener('hide', sync);
      win.removeListener('show', sync);
      win.removeListener('minimize', sync);
      win.removeListener('restore', sync);
      win.removeListener('closed', onClosed);
      detachers.delete(win);
    });
    sync();
  };

  for (const win of BrowserWindow.getAllWindows()) register(win);
  const onWindowCreated = (_event: unknown, win: BrowserWindow) => register(win);
  app.on('browser-window-created', onWindowCreated);
  sync();

  return () => {
    for (const detach of [...detachers.values()]) detach();
    app.removeListener('browser-window-created', onWindowCreated);
  };
}

/** Stop diagnostic recording while protection continues. */
export function stopRuntimeEfficiency(): void {
  if (!started) return;
  started = false;
  sampler?.stop();
  logger.info('[efficiency] runtime efficiency sampling stopped');
}

/** Application shutdown owns the pressure observer and power/window listeners. */
export function stopRuntimeResourceProtection(): void {
  if (!protectionStarted) return;
  protectionStarted = false;
  efficiencyGeneration += 1;
  if (backgroundGateUnregister) {
    backgroundGateUnregister();
    backgroundGateUnregister = null;
  }
  unsubscribeWindowEvents?.();
  unsubscribeWindowEvents = null;
  unsubscribePowerEvents?.();
  unsubscribePowerEvents = null;
  getTimerAligner().setShedding(false);
  getBackgroundWorkGate().clearObservationPressure();
  getResourceFabric().clearObservationPressure();
  try { setManagedProcessHostPressure(false); }
  catch (error) { logger.warn('[efficiency] pressure owner shutdown failed', error); }
  publishedHostPressure = null;
  publishedIncarnation = null;
}

export function getEfficiencySummary(): EfficiencySummary | null {
  return sampler?.getSummary() ?? null;
}
/** Bounded raw samples for explicit runtime before/after diagnostics. */
export function getEfficiencySamples(): ReturnType<EfficiencySampler['getSamples']> {
  return sampler?.getSamples() ?? [];
}

export function getEfficiencyShedState(): EfficiencyShedState | null {
  return protectionStarted ? policy?.getState() ?? null : null;
}

export function getBackgroundWorkGateState(): BackgroundWorkGateState | null {
  return protectionStarted ? getBackgroundWorkGate().getState() : null;
}

export function isRuntimeEfficiencyRunning(): boolean {
  return started;
}

/** Test seam: drop all module state. */
export function resetRuntimeEfficiencyForTests(): void {
  stopRuntimeEfficiency();
  stopRuntimeResourceProtection();
  sampler = null;
  policy = null;
  started = false;
  protectionStarted = false;
  resetBackgroundWorkGateForTest();
}
