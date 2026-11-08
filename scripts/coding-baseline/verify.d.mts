import type { BinaryLike } from 'node:crypto';

export const PROBE_FILES: Readonly<Record<'worktrees' | 'boundaries' | 'routing' | 'journal', string>>;
export function sha256(data: BinaryLike): string;
export function readWithin(root: string, relative: string): Buffer;
export function boundInputPaths(root: string): string[];
export function evaluateFindings(probes: unknown): Array<{
  id: string;
  repairNode: string;
  status: 'reproduced' | 'changed-or-unverified';
  productPass: false;
}>;
export function verifyEvidence(report: unknown, options?: {
  readArtifact?: (path: string) => Buffer;
  readSource?: (path: string) => Buffer;
  requiredSources?: string[];
  expectedCandidate?: string;
}): { ok: boolean; issues: string[]; productVerdict: 'needs-fix' };
