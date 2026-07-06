import type {
  KnowledgeErrorExperienceCard,
  KnowledgeGovernanceIssue,
  KnowledgeGovernanceIssueSeverity,
  KnowledgeQualityMetric,
  KnowledgeQualityMetrics,
} from '../host-api/contract';

export type KnowledgeQualityMetricInput = {
  summaries: {
    stale: number;
    dangling: number;
    duplicates: number;
    provenanceGaps: number;
  };
  issues: KnowledgeGovernanceIssue[];
  errorExperienceCards: Array<{
    id: string;
    card: KnowledgeErrorExperienceCard;
  }>;
};

function severityForCount(count: number, warningAt = 1, errorAt = Number.POSITIVE_INFINITY): KnowledgeGovernanceIssueSeverity {
  if (count >= errorAt) return 'error';
  if (count >= warningAt) return 'warning';
  return 'info';
}

function affectedIds(issues: KnowledgeGovernanceIssue[], category: KnowledgeGovernanceIssue['category']): string[] {
  return Array.from(new Set(
    issues
      .filter((issue) => issue.category === category)
      .flatMap((issue) => [...issue.affectedPageIds, ...issue.affectedPagePaths, issue.id])
      .filter(Boolean),
  )).slice(0, 20);
}

export function aggregateKnowledgeQualityMetrics(input: KnowledgeQualityMetricInput): KnowledgeQualityMetrics {
  const staleCardIds = input.errorExperienceCards
    .filter(({ card }) => card.effectiveness.staleCount > 0)
    .map(({ id }) => id);
  const lowConfidenceHighHitIds = input.errorExperienceCards
    .filter(({ card }) => card.applicability.confidence < 0.55 && card.effectiveness.hitCount >= 3)
    .map(({ id }) => id);
  const highDismissalIds = input.errorExperienceCards
    .filter(({ card }) => card.effectiveness.dismissedCount >= Math.max(3, card.effectiveness.acceptedCount * 2))
    .map(({ id }) => id);
  const staleCards = input.summaries.stale + staleCardIds.length;
  const duplicateClusters = input.summaries.duplicates;
  const sourceGaps = input.summaries.provenanceGaps;
  const unreferencedPages = input.summaries.dangling;
  const metrics: KnowledgeQualityMetric[] = [
    {
      kind: 'stale_cards',
      count: staleCards,
      severity: severityForCount(staleCards),
      affectedIds: Array.from(new Set([...affectedIds(input.issues, 'stale'), ...staleCardIds])),
    },
    {
      kind: 'duplicate_clusters',
      count: duplicateClusters,
      severity: severityForCount(duplicateClusters),
      affectedIds: affectedIds(input.issues, 'duplicate'),
    },
    {
      kind: 'source_gaps',
      count: sourceGaps,
      severity: severityForCount(sourceGaps),
      affectedIds: affectedIds(input.issues, 'provenance_gap'),
    },
    {
      kind: 'unreferenced_pages',
      count: unreferencedPages,
      severity: severityForCount(unreferencedPages, 3),
      affectedIds: affectedIds(input.issues, 'dangling'),
    },
    {
      kind: 'low_confidence_high_hit_cards',
      count: lowConfidenceHighHitIds.length,
      severity: severityForCount(lowConfidenceHighHitIds.length),
      affectedIds: lowConfidenceHighHitIds,
    },
    {
      kind: 'high_dismissal_cards',
      count: highDismissalIds.length,
      severity: severityForCount(highDismissalIds.length),
      affectedIds: highDismissalIds,
    },
  ];
  return {
    staleCards,
    duplicateClusters,
    sourceGaps,
    unreferencedPages,
    lowConfidenceHighHitCards: lowConfidenceHighHitIds.length,
    highDismissalCards: highDismissalIds.length,
    metrics,
  };
}
