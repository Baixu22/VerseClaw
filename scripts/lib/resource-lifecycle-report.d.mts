export type LifecycleVerification = {
  verified: true;
  smoke: boolean;
  repeatCycles: number;
  soakProbes: number;
  ownedExits: number;
  cancelToExitMs: number[];
  segments: unknown;
  baseline: Record<string, unknown>;
  recovered: Record<string, unknown>;
  final: Record<string, unknown>;
  observations: Record<string, unknown>[];
  unknown: unknown;
  cleanup: unknown;
  boundary: string;
};

export function verifyLifecycleReport(
  report: unknown,
  options?: { smoke?: boolean },
): LifecycleVerification;
