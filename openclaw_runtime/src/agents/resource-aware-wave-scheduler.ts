// ---------------------------------------------------------------------------
// Stage 3 (criterion 3.9): A5 Wave Immutability
//
// `ResourceAwareWaveScheduler` is a thin facade over `buildExecutionWaves` that
// enforces wave immutability: once a wave has been started, re-planning that
// wave (via `appliesToWave`) is ignored. This prevents A5 budget changes from
// disrupting in-flight execution waves.
//
// See: net use/designs/development-manual.md §1.1, Stage 3
// See: net use/designs/area-composition-spec.md (A5 wave immutability)
// ---------------------------------------------------------------------------

import {
  buildExecutionWaves,
  type OrchestrationExecutionWave,
  type OrchestrationTaskGraph,
} from "./orchestration-protocol.js";

export type WaveStatus = "planned" | "started" | "completed";

export type WavePlan = OrchestrationExecutionWave & {
  status: WaveStatus;
  maxWorkers: number;
};

export type RePlanRequest = {
  /** The wave the re-plan applies to. If the wave is already started, the
   * request is ignored (wave immutability). */
  appliesToWave: number;
  /** New worker cap for subsequent waves. */
  maxWorkers?: number;
  /** Revised task graph (optional). When omitted, only the worker cap changes. */
  graph?: OrchestrationTaskGraph;
};

export type RePlanResult =
  | { accepted: true; replannedWaves: number[] }
  | { accepted: false; reason: "wave_started" | "wave_not_found" | "no_change"; waveNumber: number };

/**
 * P2 fix: Default worker cap when none is specified. Previously this was
 * `Number.MAX_SAFE_INTEGER` (effectively unlimited), which provided no
 * real concurrency cap. 64 is a conservative default that still allows
 * high parallelism for large graphs while preventing pathological cases.
 */
const DEFAULT_MAX_WORKERS = 64;

/**
 * A5-aware wave scheduler. Wraps `buildExecutionWaves` and enforces that
 * started waves cannot be re-planned.
 *
 * Usage:
 *   const scheduler = new ResourceAwareWaveScheduler(graph, { maxWorkers: 4 });
 *   const waves = scheduler.plan();          // initial plan
 *   scheduler.startWave(1);                  // mark wave 1 as started
 *   scheduler.rePlan({ appliesToWave: 1 });   // ignored — wave 1 is started
 *   scheduler.rePlan({ appliesToWave: 2, maxWorkers: 2 }); // accepted
 */
export class ResourceAwareWaveScheduler {
  private readonly waves = new Map<number, WavePlan>();
  private readonly originalGraph: OrchestrationTaskGraph;
  private currentGraph: OrchestrationTaskGraph;
  private currentMaxWorkers: number;

  constructor(graph: OrchestrationTaskGraph, options: { maxWorkers?: number } = {}) {
    this.originalGraph = graph;
    this.currentGraph = graph;
    // P2 fix: use a sane default cap instead of MAX_SAFE_INTEGER.
    this.currentMaxWorkers = options.maxWorkers ?? DEFAULT_MAX_WORKERS;
  }

  /** Compute the initial wave plan. Returns the waves in execution order. */
  plan(): WavePlan[] {
    const raw = buildExecutionWaves(this.currentGraph, this.currentMaxWorkers);
    this.waves.clear();
    for (const wave of raw) {
      this.waves.set(wave.wave, {
        ...wave,
        status: "planned",
        maxWorkers: this.currentMaxWorkers,
      });
    }
    return this.getWaves();
  }

  /** Mark a wave as started. Once started, the wave cannot be re-planned. */
  startWave(waveNumber: number): void {
    const wave = this.waves.get(waveNumber);
    if (!wave) {
      throw new Error(`Cannot start unknown wave: ${waveNumber}`);
    }
    wave.status = "started";
  }

  /** Mark a wave as completed. */
  completeWave(waveNumber: number): void {
    const wave = this.waves.get(waveNumber);
    if (!wave) {
      throw new Error(`Cannot complete unknown wave: ${waveNumber}`);
    }
    wave.status = "completed";
  }

  /**
   * Attempt to re-plan waves. If `appliesToWave` refers to a wave that is
   * already started or completed, the request is rejected (wave immutability).
   * Only waves still in "planned" status can be re-planned.
   *
   * When accepted, all waves from `appliesToWave` onward are re-computed
   * using the new graph/worker cap.
   */
  rePlan(request: RePlanRequest): RePlanResult {
    const target = this.waves.get(request.appliesToWave);
    if (!target) {
      return { accepted: false, reason: "wave_not_found", waveNumber: request.appliesToWave };
    }
    if (target.status === "started" || target.status === "completed") {
      return { accepted: false, reason: "wave_started", waveNumber: request.appliesToWave };
    }
    const newMaxWorkers = request.maxWorkers ?? this.currentMaxWorkers;
    const newGraph = request.graph ?? this.currentGraph;
    if (newMaxWorkers === this.currentMaxWorkers && newGraph === this.currentGraph) {
      return { accepted: false, reason: "no_change", waveNumber: request.appliesToWave };
    }
    // Re-compute waves from the target onward.
    this.currentGraph = newGraph;
    this.currentMaxWorkers = newMaxWorkers;
    const allWaves = buildExecutionWaves(newGraph, newMaxWorkers);
    const replanned: number[] = [];
    for (const wave of allWaves) {
      if (wave.wave < request.appliesToWave) continue;
      const existing = this.waves.get(wave.wave);
      // Only update waves that are still planned.
      if (existing && existing.status !== "planned") continue;
      this.waves.set(wave.wave, {
        ...wave,
        status: "planned",
        maxWorkers: newMaxWorkers,
      });
      replanned.push(wave.wave);
    }
    return { accepted: true, replannedWaves: replanned };
  }

  /** Get the current wave plan (snapshot). */
  getWaves(): WavePlan[] {
    return [...this.waves.values()].sort((a, b) => a.wave - b.wave);
  }

  /** Get a specific wave by number. */
  getWave(waveNumber: number): WavePlan | undefined {
    return this.waves.get(waveNumber);
  }

  /** Get the status of a specific wave. */
  getWaveStatus(waveNumber: number): WaveStatus | undefined {
    return this.waves.get(waveNumber)?.status;
  }
}
