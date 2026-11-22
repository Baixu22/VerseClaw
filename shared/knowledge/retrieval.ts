import type { SourceRefV2 } from './owner-read-contract.js';
import type { RerankResultV1 } from './rerank.js';

/** Data-only contract shared by runtime, Host and renderer. */
export type RetrievalProfile = 'local' | 'quality' | 'research';
export type RetrievalLane = 'exact' | 'lexical' | 'dense';
export type RetrievalMode = 'off' | 'manual' | 'suggest' | 'auto-read';
export type RetrievalIntent = 'lookup' | 'procedure' | 'decision' | 'troubleshooting' | 'relationship' | 'summary';
export type RetrievalGeneration = {
  namespaceId: string;
  lane: 'lexical' | 'dense';
  generation: string;
  spaceId?: string;
  credentialEpoch?: number;
};
export type RetrievalQuery = { text: string; family: string };
export type RetrievalBudget = {
  candidateK: number;
  rerankK: number;
  finalK: number;
  maxPerParent: number;
  maxTokens: number;
  maxChars: number;
  deadlineAtMs: number;
  maxQueries: number;
  maxModelCalls: number;
};
export type RetrievalPlanV2 = {
  schema: 'RetrievalPlan/v2';
  planId: string;
  requestId: string;
  admissionContextId: string | null;
  policyVersion: 'project-rag-rrf/v2';
  mode: RetrievalMode;
  profile: RetrievalProfile;
  intent: RetrievalIntent;
  namespaceIds: readonly string[];
  queries: readonly RetrievalQuery[];
  explicitRefs: readonly SourceRefV2[];
  generations: readonly RetrievalGeneration[];
  lanes: readonly RetrievalLane[];
  budget: Readonly<RetrievalBudget>;
};
export type RankSignalsV2 = {
  schema: 'RankSignals/v2';
  fusionScore: number;
  lanes: Array<{
    lane: RetrievalLane;
    namespaceId: string;
    queryFamily: string;
    rank: number;
    rawScore: number;
    scoreKind: string;
    contribution: number;
  }>;
};
export type RetrievalHit<T> = {
  id: string;
  sourceRef: SourceRefV2;
  rawScore: number;
  scoreKind: string;
  data: T;
};
export type RetrievalFilter = { namespaceId: string; subjectId: string; reason: string };
export type RetrievalLaneResult<T> = {
  status: 'available' | 'unavailable';
  reason?: string;
  hits: RetrievalHit<T>[];
  denied?: RetrievalFilter[];
};
export type RetrievalLaneReceipt = {
  lane: RetrievalLane;
  namespaceId: string;
  queryFamily: string;
  status: 'available' | 'unavailable' | 'cancelled';
  reason?: string;
  candidateCount: number;
  elapsedMs: number;
};
export type RetrievalResultV2<T> = {
  schema: 'RetrievalResult/v2';
  plan: RetrievalPlanV2;
  status: 'complete' | 'partial' | 'cancelled' | 'disabled' | 'unavailable';
  effectiveProfile: RetrievalProfile | 'hybrid' | 'lexical' | 'exact' | 'none';
  results: Array<RetrievalHit<T> & { rank: number; rankSignals: RankSignalsV2 }>;
  lanes: RetrievalLaneReceipt[];
  filters: RetrievalFilter[];
  fallbackReasons: string[];
  rerank?: RerankResultV1;
  snapshotStatus: 'current' | 'changed';
};
