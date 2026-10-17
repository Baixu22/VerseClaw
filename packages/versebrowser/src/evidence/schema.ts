/**
 * Evidence Pack schema v1 — fixed offline layout for PR / critic / replay.
 * See docs/evidence-pack.md for the human-facing contract.
 */
import type {
  ConsoleIncrementalDiff,
  EvidenceRef,
  ExplainErrorResult,
  NetworkFailureSummary,
  VerifyReport,
} from '../contracts/index.ts';

export const EVIDENCE_PACK_SCHEMA_VERSION = 1 as const;

export type EvidencePackManifest = {
  schemaVersion: typeof EVIDENCE_PACK_SCHEMA_VERSION;
  createdAt: string;
  packId: string;
  label: string;
  sessionId?: string;
  /** Relative paths inside the pack directory. */
  files: Array<{
    path: string;
    kind: EvidenceRef['kind'];
    mimeType?: string;
    size?: number;
  }>;
  notes?: string;
};

export type EvidencePackContents = {
  manifest: EvidencePackManifest;
  summaryMarkdown?: string;
  consoleDiff?: ConsoleIncrementalDiff;
  networkFailures?: NetworkFailureSummary;
  /** Free-form console transcript when available. */
  consoleText?: string;
  explain?: ExplainErrorResult;
  verify?: VerifyReport;
  /** Absolute paths of screenshot files under shots/. */
  screenshots: string[];
  diagnosis?: import('../contracts/index.ts').DiagnosisReport;
  timeline?: import('../contracts/index.ts').TimelineRecord;
  prComment?: string;
};

export const PACK_FILES = {
  manifest: 'manifest.json',
  summary: 'summary.md',
  console: 'console.json',
  consoleText: 'console.txt',
  network: 'network.json',
  explain: 'explain.json',
  verify: 'report.json',
  timeline: 'timeline.json',
  diagnosis: 'diagnosis.md',
  diagnosisJson: 'diagnosis.json',
  prComment: 'pr-comment.md',
  viewer: 'viewer.html',
  shotsDir: 'shots',
} as const;
