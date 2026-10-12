/**
 * Runtime Efficiency Power / Idle Policy
 *
 * Companion to `efficiency-sampler.ts` for
 * `windows-runtime-efficiency-observability-v1`.
 *
 * Decides when background load should be shed, and makes every transition
 * observable. Deliberately policy-free with respect to Electron: the caller
 * feeds it plain booleans, so the decision table is unit testable without
 * booting the app or stubbing `powerMonitor`.
 *
 * Policy notes:
 * - Shedding only ever removes *background* work. User-initiated work is never
 *   gated; there is intentionally no "shed while a request is in flight" rule.
 * - Every input change is a pure function of current state, so the policy is
 *   deterministic and replayable from an event log.
 */

export type EfficiencyShedReason = 'window-hidden' | 'power-saver' | 'display-sleep' | null;

export type EfficiencyPowerInputs = {
  /** Renderer window is hidden or minimized. */
  windowHidden: boolean;
  /** OS reports a power-saving / low-power state. */
  powerSaver: boolean;
  /** OS reports the display going to sleep. */
  displaySleep: boolean;
};

export type EfficiencyShedState = {
  /** True when background load should be shed. */
  shedding: boolean;
  /** Why we are shedding, or null when not shedding. */
  reason: EfficiencyShedReason;
  /** Every reason currently active, for diagnostics. */
  activeReasons: Exclude<EfficiencyShedReason, null>[];
  /** Monotonic counter of shed transitions, so changes are observable. */
  transitionCount: number;
  /** Timestamp of the last transition, or null if never transitioned. */
  lastTransitionAt: number | null;
};

function activeReasons(inputs: EfficiencyPowerInputs): Exclude<EfficiencyShedReason, null>[] {
  const reasons: Exclude<EfficiencyShedReason, null>[] = [];
  if (inputs.windowHidden) reasons.push('window-hidden');
  if (inputs.powerSaver) reasons.push('power-saver');
  if (inputs.displaySleep) reasons.push('display-sleep');
  return reasons;
}

/**
 * Ordered reason precedence. `window-hidden` is the strongest signal because it
 * is unambiguous: nobody can see the window, so nothing user-visible depends on
 * background work.
 */
const REASON_PRECEDENCE: Exclude<EfficiencyShedReason, null>[] = [
  'window-hidden',
  'display-sleep',
  'power-saver',
];

function pickPrimary(reasons: Exclude<EfficiencyShedReason, null>[]): EfficiencyShedReason {
  for (const candidate of REASON_PRECEDENCE) {
    if (reasons.includes(candidate)) return candidate;
  }
  return null;
}

export class EfficiencyPowerPolicy {
  private inputs: EfficiencyPowerInputs = {
    windowHidden: false,
    powerSaver: false,
    displaySleep: false,
  };
  private state: EfficiencyShedState = {
    shedding: false,
    reason: null,
    activeReasons: [],
    transitionCount: 0,
    lastTransitionAt: null,
  };
  private readonly now: () => number;
  private readonly onTransition: (state: EfficiencyShedState) => void;

  constructor(options: { now?: () => number; onTransition?: (state: EfficiencyShedState) => void } = {}) {
    this.now = options.now ?? (() => Date.now());
    this.onTransition = options.onTransition ?? (() => {});
  }

  /**
   * Fold new inputs into the current state. Returns the resulting state.
   *
   * A "transition" is any change of the effective (shedding, reason) pair, so
   * callers can log precisely when background load starts and stops.
   */
  update(next: Partial<EfficiencyPowerInputs>): EfficiencyShedState {
    this.inputs = { ...this.inputs, ...next };
    const reasons = activeReasons(this.inputs);
    const shedding = reasons.length > 0;
    const reason = pickPrimary(reasons);

    const changed = shedding !== this.state.shedding || reason !== this.state.reason;
    if (changed) {
      this.state = {
        shedding,
        reason,
        activeReasons: reasons,
        transitionCount: this.state.transitionCount + 1,
        lastTransitionAt: this.now(),
      };
      this.onTransition(this.state);
    } else {
      // Keep activeReasons fresh even when the effective state is unchanged, so
      // diagnostics never report a stale reason set.
      this.state = { ...this.state, activeReasons: reasons };
    }
    return this.getState();
  }

  getState(): EfficiencyShedState {
    return { ...this.state, activeReasons: [...this.state.activeReasons] };
  }

  getInputs(): EfficiencyPowerInputs {
    return { ...this.inputs };
  }

  /** True when background work should be shed right now. */
  get shedding(): boolean {
    return this.state.shedding;
  }

  reset(): void {
    this.inputs = { windowHidden: false, powerSaver: false, displaySleep: false };
    this.state = {
      shedding: false,
      reason: null,
      activeReasons: [],
      transitionCount: 0,
      lastTransitionAt: null,
    };
  }
}