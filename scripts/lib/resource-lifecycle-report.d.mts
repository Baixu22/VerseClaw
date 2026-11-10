export type LifecycleReportMetrics = {
  at: number;
  rssBytes: number | null;
  privateBytes: number | null;
  handles: number | null;
  rendererHeapBytes: unknown;
  machineCommit: unknown;
  accounts: number;
  watchers: unknown;
};

export function verifyLifecycleReport(report: unknown, options?: { smoke?: boolean }): {
  verified: true;
  smoke: boolean;
  repeatCycles: number;
  soakProbes: number;
  ownedExits: number;
  cancelToExitMs: number[];
  segments: unknown[];
  baseline: LifecycleReportMetrics;
  recovered: LifecycleReportMetrics;
  final: LifecycleReportMetrics;
  observations: LifecycleReportMetrics[];
  unknown: unknown;
  cleanup: unknown;
  boundary: string;
};
