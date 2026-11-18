import type { SourceRefV2 } from './owner-read-contract.js';
import type { RetainedEvidenceManifestV1 } from './packing.js';

export type ResearchScope = Readonly<{
  fingerprint: string;
  workspaceId?: string;
  sessionKey?: string;
  sessionId?: string;
  corpus: 'wiki' | 'memory' | 'all';
}>;
export type ResearchBudget = Readonly<{
  deadlineAtMs: number;
  maxRounds: number;
  maxQueries: number;
  maxPlanningModelCalls: number;
  maxPlanningTokens: number;
  maxCostUsd: number;
  maxEvidenceTokens: number;
  maxEvidenceChars: number;
  maxSources: number;
  graphMaxHops: number;
  graphMaxNodes: number;
  graphMaxEdges: number;
}>;
export type ResearchPlanV1 = Readonly<{
  schema: 'ResearchPlan/v1';
  requestId: string;
  query: string;
  scope: ResearchScope;
  budget: ResearchBudget;
  questions: readonly string[];
}>;
export type EvidenceGapV1 = {
  schema: 'EvidenceGap/v1';
  question: string;
  reason: string;
};
export type ResearchEvidence = {
  id: string;
  lookup: string;
  title: string;
  content: string;
  contentDigest: string;
  sourceRef: SourceRefV2;
  conflictGroupId?: string;
  updatedAt?: string;
  truncated?: boolean;
};
export type ResearchQuote = { sourceId: string; quote: string };
export type ResearchReview = {
  queries: string[];
  coverage: Array<ResearchQuote & { question: string }>;
  inferences: string[];
  conflicts: Array<{ description: string; citations: ResearchQuote[] }>;
  gaps: string[];
};
export type ResearchStepV1 = {
  schema: 'ResearchStep/v1';
  round: number;
  query: string;
  status: 'complete' | 'partial' | 'cancelled';
  newEvidence: number;
  sourceIds: string[];
};
export type ResearchStopReason = 'covered' | 'no-new-evidence' | 'repeated-query' | 'queries-exhausted'
  | 'round-budget' | 'query-budget' | 'evidence-budget' | 'deadline' | 'cancelled' | 'scope-changed' | 'unavailable';
export type ResearchResultV1 = {
  schema: 'ResearchResult/v1';
  actor: 'knowledge-research';
  driven_by: 'agent';
  realHumanEvidence: false;
  plan: ResearchPlanV1;
  status: 'running' | 'complete' | 'partial' | 'cancelled' | 'unavailable';
  phase: 'retrieving' | 'planning' | 'finished';
  stopReason?: ResearchStopReason;
  steps: ResearchStepV1[];
  evidence: ResearchEvidence[];
  coverage: ResearchReview['coverage'];
  inferences: string[];
  conflicts: ResearchReview['conflicts'];
  gaps: EvidenceGapV1[];
  graph: { nodes: string[]; edges: Array<{ sourceId: string; lookup: string; depth: number }>; truncated: boolean };
  usage: {
    queries: number;
    rounds: number;
    planningModelCalls: number;
    reservedPlanningTokens: number;
    reservedCostUsd: number;
    actualPlanningTokens: number | null;
    actualCostUsd: number | null;
    evidenceTokens: number;
    evidenceChars: number;
  };
  retainedEvidence: RetainedEvidenceManifestV1[];
};
export type KnowledgeResearchPayload = {
  requestId: string;
  query: string;
  corpus?: ResearchScope['corpus'];
  workspaceId?: string;
  sessionKey?: string;
};
export type KnowledgeResearchRequestPayload = Omit<KnowledgeResearchPayload, 'query' | 'corpus'>;
export type KnowledgeResearchResult = { success: boolean; error?: string; research?: ResearchResultV1 };
