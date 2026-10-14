import {
  type BackgroundWorkDeferReason,
  type BackgroundWorkGateInput,
  type BackgroundWorkGateState,
  type BackgroundWorkPriority,
} from "../../../shared/types/resources.js";

export type {
  BackgroundWorkDeferReason,
  BackgroundWorkGateInput,
  BackgroundWorkGateState,
  BackgroundWorkPriority,
} from "../../../shared/types/resources.js";
export const DEFAULT_BACKGROUND_WORK_WATERMARKS = { highQueueDepth: 16, lowQueueDepth: 4, highTreeRssBytes: 3 * 1024 ** 3, lowTreeRssBytes: 2 * 1024 ** 3, highCpuPercent: 300, lowCpuPercent: 120, minDwellMs: 10_000 };
type Pending = { task: () => Promise<unknown> | unknown; resolve: (value: unknown) => void; reject: (error: unknown) => void };
function finite(value: number | undefined): number | undefined { return typeof value === "number" && Number.isFinite(value) ? value : undefined; }
export class BackgroundWorkGate {
  private readonly watermarks = { ...DEFAULT_BACKGROUND_WORK_WATERMARKS };
  private readonly now: () => number;
  private state: BackgroundWorkGateState = { deferring: false, reason: null, activeReasons: [], deferredCount: 0, resumeCount: 0, lastDeferReason: null, lastTransitionAt: null, transitionCount: 0, pendingCount: 0, foregroundChecks: 0, foregroundDeferredCount: 0 };
  private readonly pending: Pending[] = [];
  constructor(options?: { watermarks?: Partial<typeof DEFAULT_BACKGROUND_WORK_WATERMARKS>; now?: () => number }) { Object.assign(this.watermarks, options?.watermarks); this.now = options?.now ?? (() => Date.now()); }
  getState(): BackgroundWorkGateState { return { ...this.state, activeReasons: [...this.state.activeReasons], pendingCount: this.pending.length }; }
  shouldDefer(priority: BackgroundWorkPriority): boolean { if (priority === "foreground") { this.state = { ...this.state, foregroundChecks: this.state.foregroundChecks + 1 }; return false; } return this.state.deferring; }
  shouldResume(priority: BackgroundWorkPriority = "background"): boolean { return priority === "background" && !this.state.deferring; }
  update(input: BackgroundWorkGateInput): BackgroundWorkGateState {
    const reasons = this.highReasons(input);
    if (!this.state.deferring) {
      if (input.shedSignal === true || reasons.length > 0) {
        const activeReasons: BackgroundWorkDeferReason[] = input.shedSignal === true ? ["shed-signal", ...reasons] : reasons;
        this.state = { ...this.state, deferring: true, reason: activeReasons[0] ?? "shed-signal", activeReasons, lastDeferReason: activeReasons[0] ?? "shed-signal", lastTransitionAt: this.now(), transitionCount: this.state.transitionCount + 1 };
      }
      return this.getState();
    }
    if (this.canResume(input)) {
      this.state = { ...this.state, deferring: false, reason: null, activeReasons: [], resumeCount: this.state.resumeCount + 1, lastTransitionAt: this.now(), transitionCount: this.state.transitionCount + 1 };
      void this.drain();
    } else {
      const activeReasons: BackgroundWorkDeferReason[] = input.shedSignal === true ? ["shed-signal", ...reasons] : reasons;
      this.state = { ...this.state, activeReasons };
    }
    return this.getState();
  }
  async runBackground<T>(_key: string, task: () => Promise<T> | T): Promise<T> {
    if (!this.state.deferring) return await task();
    this.state = { ...this.state, deferredCount: this.state.deferredCount + 1, lastDeferReason: this.state.reason ?? this.state.lastDeferReason };
    return await new Promise<T>((resolve, reject) => { this.pending.push({ task, resolve: resolve as (value: unknown) => void, reject }); });
  }
  private highReasons(input: BackgroundWorkGateInput): BackgroundWorkDeferReason[] {
    const reasons: BackgroundWorkDeferReason[] = [];
    if (input.shedSignal === true) reasons.push("shed-signal");
    const queueDepth = finite(input.queueDepth), treeRssBytes = finite(input.treeRssBytes), treeCpuPercent = finite(input.treeCpuPercent);
    if (queueDepth !== undefined && queueDepth > this.watermarks.highQueueDepth) reasons.push("queue-depth");
    if (treeRssBytes !== undefined && treeRssBytes >= this.watermarks.highTreeRssBytes) reasons.push("tree-rss");
    if (treeCpuPercent !== undefined && treeCpuPercent >= this.watermarks.highCpuPercent) reasons.push("tree-cpu");
    return reasons;
  }
  private canResume(input: BackgroundWorkGateInput): boolean {
    if (input.shedSignal === true) return false;
    if (this.state.lastTransitionAt !== null && this.now() - this.state.lastTransitionAt < this.watermarks.minDwellMs) return false;
    const queueDepth = finite(input.queueDepth), treeRssBytes = finite(input.treeRssBytes), treeCpuPercent = finite(input.treeCpuPercent);
    if (this.state.reason === "queue-depth" && queueDepth === undefined) return false;
    if (this.state.reason === "tree-rss" && treeRssBytes === undefined) return false;
    if (this.state.reason === "tree-cpu" && treeCpuPercent === undefined) return false;
    return (queueDepth === undefined || queueDepth <= this.watermarks.lowQueueDepth) && (treeRssBytes === undefined || treeRssBytes <= this.watermarks.lowTreeRssBytes) && (treeCpuPercent === undefined || treeCpuPercent <= this.watermarks.lowCpuPercent);
  }
  private async drain(): Promise<void> { for (const entry of this.pending.splice(0)) { try { entry.resolve(await entry.task()); } catch (error) { entry.reject(error); } } }
  reset(): void { this.pending.length = 0; this.state = { deferring: false, reason: null, activeReasons: [], deferredCount: 0, resumeCount: 0, lastDeferReason: null, lastTransitionAt: null, transitionCount: 0, pendingCount: 0, foregroundChecks: 0, foregroundDeferredCount: 0 }; }
}
const KEY = Symbol.for("openclaw.backgroundWorkGate");
export function getBackgroundWorkGate(): BackgroundWorkGate { const store = globalThis as Record<PropertyKey, unknown>; if (!Object.hasOwn(store, KEY)) store[KEY] = new BackgroundWorkGate(); return store[KEY] as BackgroundWorkGate; }
export function resetBackgroundWorkGateForTest(): void { (globalThis as Record<PropertyKey, unknown>)[KEY] = new BackgroundWorkGate(); }