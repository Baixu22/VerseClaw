export type MixedExecutable = { role: string; path: string };
export type MixedFixture = {
  id: string; tasks: number; phases: string[]; scrolls: number;
  workers: number[]; windows: number[]; order: string[]; logBytes?: number;
};
type TimedSample = { at: number; durationMs: number };
type ResourceSample = { at: number; memory: { rss: number } };
type ProcessSnapshot = {
  handles?: number;
  tree?: {
    sampledAt: number; treeCpuPercent?: number; treeRssBytes?: number; machineCommit?: unknown;
    processes?: Array<{ privateBytes?: number | null }>;
  };
};
export type MixedRun = {
  driven_by: string; status: string; fixtureId: string; workers: number; windows: number;
  expected: { corpus: string; retrieval?: string; build?: string };
  work: {
    events: Array<{
      id: number; kind: string; receipt: unknown; status: string; receiptVerified: boolean;
      queuedMs: number; serviceMs: number; totalMs: number;
    }>;
    active: number; queued: number; ownedChildren: number; exitedChildren: number;
    elapsedMs: number; startedAt: number; endedAt: number; samples: ResourceSample[];
    cpu?: { user: number; system: number };
  };
  cleanup: { mainExited: boolean; launcherExited: boolean };
  renderer: {
    inputRetained: boolean; finalTextCorrect: boolean; terminalCompleted: boolean; inputStartedAt: number;
    samples: { inputLatencies: number[]; inputEvents: Array<TimedSample & { target: string }>; longTaskEvents: TimedSample[] };
    scrolls: Array<TimedSample & { top: number }>;
  };
  processBefore: ProcessSnapshot; processAfter: ProcessSnapshot;
};
type Timing = { p50: number; p95: number };
type Comparison = { before: number; after: number; changePct: number | null };
export type MixedSummary = {
  workers: number; windows: number; throughputPerSecond: number;
  queuedMs: Timing; serviceMs: Timing; totalMs: Timing; inputMs: Timing; scrollMs: Timing;
  inputSamplesDuringWork: number; scrollSamplesDuringWork: number; longTasks: number[];
  directChildStarts: number; buildServiceStarts: number; observedChildStarts: number;
  processBefore: ProcessSnapshot; processAfter: ProcessSnapshot; counters: ResourceSample[];
  resources: {
    rssBeforeBytes: number | null; rssAfterBytes: number | null;
    privateBeforeBytes: number | null; privateAfterBytes: number | null;
    systemCommitBefore: unknown; systemCommitAfter: unknown;
    handlesBefore: number | null; handlesAfter: number | null;
    mainRssPeakBytes: number | null; mainCpuCoreRatio: number | null;
    treeCpuObservation: { cpuPercent: number | null; from: number | null; to: number | null; intervalMs: number | null; scope: string };
  };
};
export function resolveMixedToolchain(): MixedExecutable[];
export function pinnedMixedEnvironment(executables: MixedExecutable[]): { ESBUILD_BINARY_PATH: string; ELECTRON_OVERRIDE_DIST_PATH: string };
export function percentile(values: number[], quantile: number): number;
export function summarizeMixedRun(run: MixedRun, fixture: MixedFixture): MixedSummary;
export function compareMixedRuns(runs: Array<MixedRun & { variant: string }>, fixture: MixedFixture): Array<{
  windows: number; workers: number; throughput: Comparison; p95Total: Comparison; p95Input: Comparison; p95Scroll: Comparison;
  samples: Array<MixedSummary & { variant: string }>;
}>;
