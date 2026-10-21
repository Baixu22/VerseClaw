import { describe, expect, it } from 'vitest';
import { buildBehaviorCoverage, deriveFeedbackTier, validateBehaviorCoverageReport } from '../../electron/services/versegit-behavior-coverage';

const baseEvent = {
  schema: 'clawx.versegit.behavior-event/v1', eventId: 'e1', runId: 'r', traceId: 't', requestId: 'q',
  agentSessionId: 'a', vgSessionId: 'v', repoId: 'repo', worktreeId: 'wt', ownerId: 'o', actor: 'agent:codex', epoch: 1,
  source: 'chat-runtime', sourceEventType: 'tool.started', surface: 'file.read', operation: 'read', effect: 'read',
  status: 'started', coverage: 'host-event', evidence: { grade: 'normalized-event', ref: null }, inputDigest: 'a'.repeat(64),
  outputDigest: 'b'.repeat(64), startedAt: '2026-01-01T00:00:00Z', endedAt: null, durationMs: null, reason: null,
} as const;
const feedback = [
  { id: 'p', produced: true, hostDelivered: false, transcriptConfirmed: false, behaviorShift: false, evidenceRefs: ['a'] },
  { id: 'h', produced: true, hostDelivered: true, transcriptConfirmed: false, behaviorShift: false, evidenceRefs: ['a'] },
  { id: 't', produced: true, hostDelivered: true, transcriptConfirmed: true, behaviorShift: false, evidenceRefs: ['a'] },
  { id: 'b', produced: true, hostDelivered: true, transcriptConfirmed: true, behaviorShift: true, evidenceRefs: ['a'] },
  { id: 'n', produced: false, hostDelivered: false, transcriptConfirmed: false, behaviorShift: false, evidenceRefs: [] },
];
describe('WP4 behavior coverage', () => {
  it('deduplicates events and retains unobserved surfaces', () => {
    const report = buildBehaviorCoverage({ events: [baseEvent as never, baseEvent as never], feedbackCases: feedback, knownGaps: ['direct filesystem access remains unobserved'] });
    expect(report.eventCount).toBe(2);
    expect(report.uniqueEventCount).toBe(1);
    expect(report.duplicateCount).toBe(1);
    expect(report.coverageVector.fileRead).toBe('host-event');
    expect(report.coverageVector.directFs).toBe('unobserved');
    expect(validateBehaviorCoverageReport(report).issues).toEqual([]);
  });
  it('derives only the highest evidence-backed feedback tier', () => {
    expect(deriveFeedbackTier(feedback[0])).toBe('produced');
    expect(deriveFeedbackTier(feedback[1])).toBe('host-delivered');
    expect(deriveFeedbackTier(feedback[2])).toBe('transcript-confirmed');
    expect(deriveFeedbackTier(feedback[3])).toBe('behavior-shift');
    expect(deriveFeedbackTier(feedback[4])).toBe('not-produced');
  });
  it('bounds the event projection', () => {
    const events = Array.from({ length: 5 }, (_, index) => ({ ...baseEvent, eventId: `e-${index}` }));
    const report = buildBehaviorCoverage({ events: events as never, feedbackCases: feedback, maxEvents: 2 });
    expect(report.limits).toMatchObject({ maxEvents: 2, truncated: true });
    expect(report.uniqueEventCount).toBe(2);
  });
});