import type { TaskLedgerEvidenceRef } from './task-ledger';

export type CodeReviewSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type CodeReviewTarget =
  | { kind: 'uncommitted' }
  | { kind: 'baseBranch'; baseBranch: string }
  | { kind: 'commit'; commit: string };

export type CodeReviewTargetSummary = CodeReviewTarget & {
  label: string;
  baseCommit?: string;
  headCommit?: string;
  resolvedCommit?: string;
};

export type CodeReviewDiffStats = {
  files: number;
  additions: number;
  deletions: number;
  patchBytes: number;
  truncated: boolean;
};

export type CodeReviewFinding = {
  id: string;
  severity: CodeReviewSeverity;
  file: string;
  line?: number;
  reason: string;
  suggestedFix: string;
};

export type CodeReviewRunStatus = 'completed' | 'error';

export type CodeReviewRun = {
  runId: string;
  readonly: true;
  status: CodeReviewRunStatus;
  target: CodeReviewTargetSummary;
  focus?: string;
  summary: string;
  diffStats: CodeReviewDiffStats;
  findings: CodeReviewFinding[];
  evidenceRefs: TaskLedgerEvidenceRef[];
  startedAt: string;
  endedAt: string;
  modelRunId?: string;
  sessionKey?: string;
  traceId?: string;
  error?: string;
};
