export type MixedExecutable = { role: string; path: string };
export type MixedPercentiles = { p50: number; p95: number };
export type MixedChange = { before: number; after: number; changePct: number | null };

export type MixedRunSummary = {
  workers: number;
  windows: number;
  throughputPerSecond: number;
  queuedMs: MixedPercentiles;
  serviceMs: MixedPercentiles;
  totalMs: MixedPercentiles;
  inputMs: MixedPercentiles;
  scrollMs: MixedPercentiles;
  inputSamplesDuringWork: number;
  scrollSamplesDuringWork: number;
  longTasks: number[];
  directChildStarts: number;
  buildServiceStarts: number;
  observedChildStarts: number;
  processBefore: unknown;
  processAfter: unknown;
  resources: {
    rssBeforeBytes: number | null;
    rssAfterBytes: number | null;
    privateBeforeBytes: number | null;
    privateAfterBytes: number | null;
    systemCommitBefore: unknown;
    systemCommitAfter: unknown;
    handlesBefore: unknown;
    handlesAfter: unknown;
    mainRssPeakBytes: number | null;
    mainCpuCoreRatio: number | null;
    treeCpuObservation: {
      cpuPercent: number | null;
      from: number | null;
      to: number | null;
      intervalMs: number | null;
      scope: string;
    };
  };
  counters: unknown[];
};

export function resolveMixedToolchain(): MixedExecutable[];
export function pinnedMixedEnvironment(executables: MixedExecutable[]): {
  ESBUILD_BINARY_PATH: string;
  ELECTRON_OVERRIDE_DIST_PATH: string;
};
export function percentile(values: readonly number[], quantile: number): number;
/** Validates raw run/fixture evidence before returning recomputed measurements. */
export function summarizeMixedRun(run: unknown, fixture: unknown): MixedRunSummary;
export function compareMixedRuns(runs: readonly unknown[], fixture: unknown): Array<{
  windows: number;
  workers: number;
  throughput: MixedChange;
  p95Total: MixedChange;
  p95Input: MixedChange;
  p95Scroll: MixedChange;
  samples: Array<MixedRunSummary & { variant: string }>;
}>;
