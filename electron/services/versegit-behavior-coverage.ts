/**
 * WP4 behavior coverage and feedback-delivery projection.
 * It summarizes normalized events and evidence; it never infers delivery that has no
 * host, transcript or paired-experiment record.
 */
import { createHash } from 'node:crypto';
import type { VerseGitBehaviorEvent } from './versegit-observation';

export const VG_BEHAVIOR_COVERAGE_SCHEMA = 'clawx.versegit.behavior-coverage/v1';
export const VG_FEEDBACK_TIERS = ['produced', 'host-delivered', 'transcript-confirmed', 'behavior-shift'] as const;
export type FeedbackTier = (typeof VG_FEEDBACK_TIERS)[number];
export type CoverageGrade = 'direct' | 'host-event' | 'inferred' | 'partial' | 'unobserved' | 'dropped';
export type FeedbackCase = { id: string; produced: boolean; hostDelivered: boolean; transcriptConfirmed: boolean; behaviorShift: boolean; evidenceRefs?: string[] };
export type CoverageVector = Record<string, CoverageGrade>;
export type BehaviorCoverageReport = {
  schema: typeof VG_BEHAVIOR_COVERAGE_SCHEMA;
  task: 'TF-0470';
  eventCount: number;
  uniqueEventCount: number;
  duplicateCount: number;
  droppedCount: number;
  unobservedCount: number;
  coverageVector: CoverageVector;
  feedbackDelivery: Array<{ id: string; tier: FeedbackTier | 'not-produced'; evidenceRefs: string[]; claimedWithoutEvidence: boolean }>;
  knownGaps: string[];
  limits: { maxEvents: number; truncated: boolean; rawPayloadStored: false };
  passed: boolean;
  issues: string[];
  digest: string;
};
function createDigest(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function maxGrade(a: CoverageGrade, b: CoverageGrade): CoverageGrade {
  const rank: Record<CoverageGrade, number> = { unobserved: 0, dropped: 1, partial: 2, inferred: 3, 'host-event': 4, direct: 5 };
  return rank[b] > rank[a] ? b : a;
}
function surfaceKey(surface: string): string | null {
  if (surface === 'file.read') return 'fileRead';
  if (surface === 'file.write') return 'fileWrite';
  if (surface === 'repo.search') return 'search';
  if (surface === 'exec' || surface === 'test') return 'shellWrite';
  if (surface === 'mcp') return 'mcpRead';
  if (surface === 'network') return 'network';
  if (surface === 'browser') return 'browser';
  return null;
}
function emptyCoverage(): CoverageVector {
  return { fileRead: 'unobserved', fileWrite: 'unobserved', search: 'unobserved', shellRead: 'unobserved', shellWrite: 'unobserved', mcpRead: 'unobserved', mcpWrite: 'unobserved', network: 'unobserved', browser: 'unobserved', directFs: 'unobserved' };
}
export function deriveFeedbackTier(input: Omit<FeedbackCase, 'id'>): FeedbackTier | 'not-produced' {
  if (!input.produced) return 'not-produced';
  if (!input.hostDelivered) return 'produced';
  if (!input.transcriptConfirmed) return 'host-delivered';
  if (!input.behaviorShift) return 'transcript-confirmed';
  return 'behavior-shift';
}
export function buildBehaviorCoverage({ events = [], feedbackCases = [], knownGaps = [], maxEvents = 10_000 }: { events?: VerseGitBehaviorEvent[]; feedbackCases?: FeedbackCase[]; knownGaps?: string[]; maxEvents?: number } = {}): BehaviorCoverageReport {
  const issues: string[] = [];
  const limited = events.slice(0, Math.max(0, maxEvents));
  const seen = new Set<string>();
  let duplicateCount = 0;
  let droppedCount = 0;
  let unobservedCount = 0;
  const coverage = emptyCoverage();
  for (const event of limited) {
    if (!event || typeof event !== 'object') { issues.push('invalid behavior event'); continue; }
    if (event.schema !== 'clawx.versegit.behavior-event/v1') issues.push(`event ${String(event.eventId)} schema mismatch`);
    if (seen.has(event.eventId)) { duplicateCount += 1; continue; }
    seen.add(event.eventId);
    const key = surfaceKey(event.surface);
    if (key) coverage[key] = maxGrade(coverage[key], key === 'shellWrite' ? 'inferred' : event.coverage as CoverageGrade);
    if (event.coverage === 'dropped') droppedCount += 1;
    if (event.coverage === 'unobserved') unobservedCount += 1;
  }
  const feedbackDelivery = feedbackCases.map((entry) => {
    const tier = deriveFeedbackTier(entry);
    const claimedWithoutEvidence = tier === 'behavior-shift' && (entry.evidenceRefs ?? []).length === 0;
    if (claimedWithoutEvidence) issues.push(`feedback ${entry.id} claims behavior-shift without evidence`);
    return { id: entry.id, tier, evidenceRefs: entry.evidenceRefs ?? [], claimedWithoutEvidence };
  });
  const report: BehaviorCoverageReport = {
    schema: VG_BEHAVIOR_COVERAGE_SCHEMA, task: 'TF-0470', eventCount: events.length, uniqueEventCount: seen.size,
    duplicateCount, droppedCount, unobservedCount, coverageVector: coverage, feedbackDelivery,
    knownGaps: [...new Set(knownGaps)], limits: { maxEvents, truncated: events.length > limited.length, rawPayloadStored: false },
    passed: issues.length === 0, issues, digest: '',
  };
  report.digest = createDigest(JSON.stringify({ ...report, digest: undefined }));
  return report;
}
export function validateBehaviorCoverageReport(report: BehaviorCoverageReport): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  if (report?.schema !== VG_BEHAVIOR_COVERAGE_SCHEMA || report?.task !== 'TF-0470') issues.push('coverage schema/task mismatch');
  if (report?.duplicateCount < 0 || report?.droppedCount < 0 || report?.unobservedCount < 0) issues.push('coverage counters are invalid');
  if (!report?.coverageVector || report.coverageVector.directFs !== 'unobserved') issues.push('directFs must remain unobserved');
  if (!report?.feedbackDelivery?.some((entry) => entry.tier === 'produced') || !report.feedbackDelivery.some((entry) => entry.tier === 'behavior-shift')) issues.push('feedback delivery tiers are incomplete');
  if (report.feedbackDelivery.some((entry) => entry.claimedWithoutEvidence)) issues.push('behavior-shift cannot be claimed without evidence');
  if (report?.passed !== true || (report?.issues ?? []).length !== 0) issues.push('coverage report did not pass');
  if (report?.limits?.rawPayloadStored !== false) issues.push('raw payload storage is forbidden');
  if (report?.digest !== createDigest(JSON.stringify({ ...report, digest: undefined }))) issues.push('coverage digest is not reproducible');
  return { ok: issues.length === 0, issues };
}