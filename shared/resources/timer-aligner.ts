/**
 * Cooperative, phase-aligned timer scheduler.
 *
 * The aligner owns at most one process interval. Registered tasks are polled on
 * the shared tick and skipped while a previous async run is still in flight.
 * Non-interactive work is stretched 4x while the resource fabric is shedding.
 */
export type TimerTaskPriority = 'interactive' | 'background' | 'opportunistic';

export type TimerAlignTaskOptions = {
  id: string;
  intervalMs: number;
  priority?: TimerTaskPriority;
  immediate?: boolean;
  run: () => void | Promise<void>;
};

type TimerAlignTask = {
  id: string;
  intervalMs: number;
  priority: TimerTaskPriority;
  run: () => void | Promise<void>;
  nextDueAt: number;
  inFlight: boolean;
};

export type TimerAlignerOptions = {
  tickMs?: number;
  now?: () => number;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
};

export type TimerAlignerDiagnostics = {
  running: boolean;
  shedding: boolean;
  tickMs: number;
  ticks: number;
  runs: number;
  skippedInFlight: number;
  tasks: Array<{ id: string; intervalMs: number; effectiveIntervalMs: number; priority: TimerTaskPriority }>;
};

const MIN_TICK_MS = 250;
const DEFAULT_TICK_MS = 1_000;
const SHED_MULTIPLIER = 4;

export class TimerAligner {
  private readonly tickMs: number;
  private readonly now: () => number;
  private readonly setIntervalFn: typeof setInterval;
  private readonly clearIntervalFn: typeof clearInterval;
  private readonly tasks = new Map<string, TimerAlignTask>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private shedding = false;
  private ticks = 0;
  private runs = 0;
  private skippedInFlight = 0;

  constructor(options: TimerAlignerOptions = {}) {
    this.tickMs = Math.max(MIN_TICK_MS, Math.floor(options.tickMs ?? DEFAULT_TICK_MS));
    this.now = options.now ?? Date.now;
    this.setIntervalFn = options.setIntervalFn ?? setInterval;
    this.clearIntervalFn = options.clearIntervalFn ?? clearInterval;
  }

  start(): void {
    if (this.timer) return;
    this.timer = this.setIntervalFn(() => this.tick(), this.tickMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (!this.timer) return;
    this.clearIntervalFn(this.timer);
    this.timer = null;
  }

  setShedding(shedding: boolean): void {
    this.shedding = shedding;
  }

  register(options: TimerAlignTaskOptions): () => void {
    const id = options.id.trim();
    if (!id) throw new TypeError('timer task id is required');
    if (!Number.isFinite(options.intervalMs) || options.intervalMs < this.tickMs) {
      throw new RangeError(`timer task interval must be >= tick (${this.tickMs}ms)`);
    }
    if (this.tasks.has(id)) throw new Error(`timer task already registered: ${id}`);
    const task: TimerAlignTask = {
      id,
      intervalMs: Math.floor(options.intervalMs),
      priority: options.priority ?? 'background',
      run: options.run,
      nextDueAt: this.now() + (options.immediate ? 0 : Math.floor(options.intervalMs)),
      inFlight: false,
    };
    this.tasks.set(id, task);
    this.start();
    return () => {
      this.tasks.delete(id);
      if (this.tasks.size === 0) this.stop();
    };
  }

  get running(): boolean {
    return this.timer !== null;
  }

  getDiagnostics(): TimerAlignerDiagnostics {
    return {
      running: this.running,
      shedding: this.shedding,
      tickMs: this.tickMs,
      ticks: this.ticks,
      runs: this.runs,
      skippedInFlight: this.skippedInFlight,
      tasks: [...this.tasks.values()].map((task) => ({
        id: task.id,
        intervalMs: task.intervalMs,
        effectiveIntervalMs: this.effectiveInterval(task),
        priority: task.priority,
      })),
    };
  }

  resetForTest(): void {
    this.stop();
    this.tasks.clear();
    this.shedding = false;
    this.ticks = 0;
    this.runs = 0;
    this.skippedInFlight = 0;
  }

  private effectiveInterval(task: TimerAlignTask): number {
    return task.priority === 'interactive'
      ? task.intervalMs
      : this.shedding ? task.intervalMs * SHED_MULTIPLIER : task.intervalMs;
  }

  private tick(): void {
    this.ticks += 1;
    const now = this.now();
    for (const task of this.tasks.values()) {
      if (now < task.nextDueAt) continue;
      if (task.inFlight) {
        this.skippedInFlight += 1;
        task.nextDueAt = now + this.effectiveInterval(task);
        continue;
      }
      task.nextDueAt = now + this.effectiveInterval(task);
      task.inFlight = true;
      this.runs += 1;
      try {
        const result = task.run();
        if (result && typeof (result as Promise<void>).then === 'function') {
          void (result as Promise<void>).finally(() => { task.inFlight = false; });
        } else {
          task.inFlight = false;
        }
      } catch {
        task.inFlight = false;
      }
    }
  }
}

const TIMER_ALIGNER_GLOBAL_KEY = Symbol.for('openclaw.timerAligner');
export function getTimerAligner(): TimerAligner {
  const globalStore = globalThis as Record<PropertyKey, unknown>;
  const existing = globalStore[TIMER_ALIGNER_GLOBAL_KEY];
  if (existing instanceof TimerAligner) return existing;
  const created = new TimerAligner();
  globalStore[TIMER_ALIGNER_GLOBAL_KEY] = created;
  return created;
}

export function resetTimerAlignerForTest(): void {
  const globalStore = globalThis as Record<PropertyKey, unknown>;
  delete globalStore[TIMER_ALIGNER_GLOBAL_KEY];
  getTimerAligner().resetForTest();
}