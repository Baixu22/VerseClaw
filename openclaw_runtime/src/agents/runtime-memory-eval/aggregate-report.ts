// Aggregate report for runtime-memory evaluation.
// Pure function: combines all evaluation dimensions, enhanced report,
// rejection coverage, and test suite results into a single artifact.
//
// Fills the "no single aggregate artifact" gap — each test file runs
// independently with no unified report. This module produces the JSON +
// markdown artifact written to artifacts/runtime-memory-eval/.

import type { EnhancedEvalReport } from "./enhanced-report-eval.js";

export const ALL_REJECTION_REASONS: readonly string[] = [
  "record_kind_not_fact",
  "verification_status_not_verified",
  "future_valid_at",
  "invalidated_at_reference_time",
  "expired_at_reference_time",
  "task_mismatch",
  "subject_mismatch",
  "predicate_mismatch",
  "prompt_injection_sentinel",
  "raw_leak_sentinel",
  "conflicting_fact",
  "token_budget_exceeded",
  "limit_exceeded",
];

export type RejectionCoverage = {
  totalReasons: number;
  firedReasons: string[];
  missingReasons: string[];
  coverageRate: number;
};

export type TestSuiteSummary = {
  totalFiles: number;
  passedFiles: number;
  failedFiles: string[];
};

export type AggregateEvidenceClass = "synthetic" | "runtime-fixture" | "live-runtime";

export type AggregateEvalReport = {
  generatedAt: number;
  evidenceClass: AggregateEvidenceClass;
  accepted: boolean;
  acceptanceNote: string;
  enhancedReport: EnhancedEvalReport;
  rejectionCoverage: RejectionCoverage;
  testSuite: TestSuiteSummary;
};

const DEFAULT_NOW = () => Date.now();

export function generateAggregateReport(options: {
  enhancedReport: EnhancedEvalReport;
  firedReasons?: string[];
  testSuite?: TestSuiteSummary;
  evidenceClass?: AggregateEvidenceClass;
  accepted?: boolean;
  acceptanceNote?: string;
  now?: () => number;
}): AggregateEvalReport {
  const now = options.now ?? DEFAULT_NOW;

  const firedSet = new Set(options.firedReasons ?? []);
  const missingReasons = ALL_REJECTION_REASONS.filter((r) => !firedSet.has(r));
  const coverageRate =
    ALL_REJECTION_REASONS.length === 0
      ? 1
      : (ALL_REJECTION_REASONS.length - missingReasons.length) / ALL_REJECTION_REASONS.length;

  const testSuite: TestSuiteSummary = options.testSuite ?? {
    totalFiles: 0,
    passedFiles: 0,
    failedFiles: [],
  };

  return {
    generatedAt: now(),
    evidenceClass: options.evidenceClass ?? "synthetic",
    accepted: options.accepted ?? false,
    acceptanceNote:
      options.acceptanceNote ??
      "Synthetic fixture evaluation; it is not runtime or live-session acceptance evidence.",
    enhancedReport: options.enhancedReport,
    rejectionCoverage: {
      totalReasons: ALL_REJECTION_REASONS.length,
      firedReasons: [...firedSet].sort(),
      missingReasons,
      coverageRate,
    },
    testSuite,
  };
}

export function formatAggregateReportAsMarkdown(report: AggregateEvalReport): string {
  const lines: string[] = [];
  lines.push("# Runtime Memory Aggregate Evaluation Report");
  lines.push("");
  lines.push(`- Generated at: ${new Date(report.generatedAt).toISOString()}`);
  lines.push(`- Evidence class: ${report.evidenceClass}`);
  lines.push(`- Accepted: ${report.accepted ? "yes" : "no"}`);
  lines.push(`- Acceptance note: ${report.acceptanceNote}`);
  lines.push("");

  lines.push("## Rejection Coverage");
  lines.push("");
  lines.push(`- Total reasons: ${report.rejectionCoverage.totalReasons}`);
  lines.push(`- Fired reasons: ${report.rejectionCoverage.firedReasons.length}`);
  lines.push(`- Missing reasons: ${report.rejectionCoverage.missingReasons.length}`);
  lines.push(`- Coverage rate: ${(report.rejectionCoverage.coverageRate * 100).toFixed(1)}%`);
  lines.push("");

  if (report.rejectionCoverage.missingReasons.length > 0) {
    lines.push("### Missing Rejection Reasons");
    lines.push("");
    for (const reason of report.rejectionCoverage.missingReasons) {
      lines.push(`- ${reason}`);
    }
    lines.push("");
  }

  if (report.rejectionCoverage.firedReasons.length > 0) {
    lines.push("### Fired Rejection Reasons");
    lines.push("");
    for (const reason of report.rejectionCoverage.firedReasons) {
      lines.push(`- ${reason}`);
    }
    lines.push("");
  }

  lines.push("## Test Suite");
  lines.push("");
  lines.push(`- Total files: ${report.testSuite.totalFiles}`);
  lines.push(`- Passed files: ${report.testSuite.passedFiles}`);
  lines.push(`- Failed files: ${report.testSuite.failedFiles.length}`);
  if (report.testSuite.failedFiles.length > 0) {
    lines.push("");
    lines.push("### Failed Files");
    lines.push("");
    for (const f of report.testSuite.failedFiles) {
      lines.push(`- ${f}`);
    }
  }
  lines.push("");

  return lines.join("\n");
}
