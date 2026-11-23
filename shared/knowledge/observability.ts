import type { SourceRefV2 } from './owner-read-contract.js';
import type { RetrievalProfile, RetrievalResultV2 } from './retrieval.js';

export type RetrievalPolicyV1 = {
  schema: 'RetrievalPolicy/v1';
  version: string;
  profile: RetrievalProfile;
  rrfK: number;
  candidateK: number;
  rerankK: number;
  finalK: number;
  maxPerParent: number;
};

/** Persist only references and measured quantities. Unknown usage stays unknown. */
export type RetrievalReceiptV1 = {
  schema: 'RetrievalReceipt/v1';
  receiptId: string;
  requestId: string;
  planId: string;
  createdAt: number;
  ownerKey: string;
  sessionGeneration: string;
  queryDigest: string;
  policyVersion: string;
  policyDigest: string;
  profile: RetrievalProfile;
  status: RetrievalResultV2<unknown>['status'];
  elapsedMs: number;
  sources: SourceRefV2[];
  generations: RetrievalResultV2<unknown>['plan']['generations'];
  stages: Array<{ stage: string; elapsedMs: number; status: string; candidateCount: number }>;
  fallbackCodes: string[];
  model: { providerRef: string; model: string } | null;
  usage: { inputTokens: number | null; outputTokens: number | null; costUsd: number | null;
    totalModelTokens?: number | null; modelCostUsd?: number | null };
  dcs: { runId: string; receiptDigest: string; retainedSourceDigests: string[] } | null;
  modelRuns: Array<{ runId: string; modelRefs: string[]; actualTokens: number | null;
    actualCostUsd: number | null; retainedDigest: string }>;
  feedback: { attach: number; dismiss: number };
};

export type RetrievalSloV1 = {
  schema: 'RetrievalSlo/v1';
  sampleCount: number;
  p50Ms: number | null;
  p95Ms: number | null;
  fallbackCount: number;
  unknownUsageCount: number;
  measuredCostUsd: number;
  indexLagCount: number | null;
  deletionBacklog: number | null;
  calibration: 'unavailable' | 'current' | 'drifted';
};

export type OfflinePolicyPromotionV1 = {
  schema: 'OfflinePolicyPromotion/v1';
  operationId: string;
  createdAt: number;
  candidate: RetrievalPolicyV1;
  candidateDigest: string;
  previousDigest: string;
  evaluationDigest: string;
  corpusDigest: string;
  decision: 'promoted' | 'held' | 'rolled-back';
  reasons: string[];
  driven_by: 'agent';
};

/** The offline evaluator seals this summary with the complete source report digest. */
export type OfflineRetrievalEvaluationV1 = {
  schema: 'OfflineRetrievalEvaluation/v1';
  candidateDigest: string;
  baselineDigest: string;
  corpusDigest: string;
  reportDigest: string;
  candidateCommit: string;
  profile: RetrievalProfile;
  queryCount: number;
  taskCount: number;
  taskSlots: number;
  repeats: number;
  arms: ['off', 'page', 'full'];
  missingSlots: number;
  unknownUsageSlots: number;
  safetyViolations: number;
  ndcg5Gain: number | null;
  ndcg5Ci95: [number, number] | null;
  recallAt20Delta: number | null;
  exactRefPrecision: number | null;
  successGain: number | null;
  successCi95: [number, number] | null;
  relativeCostIncrease: number | null;
  absoluteCostIncreaseUsd: number | null;
  baselineCostUsd: number | null;
  calibrationDigest: string;
  sealedAt: number;
  driven_by: 'agent';
};

export type RetrievalObservabilitySnapshotV1 = {
  schema: 'RetrievalObservabilitySnapshot/v1';
  workspaceId: string;
  receipts: RetrievalReceiptV1[];
  slo: RetrievalSloV1;
  policies: Array<{ active: RetrievalPolicyV1; digest: string; previous?: RetrievalPolicyV1 }>;
  promotions: OfflinePolicyPromotionV1[];
};
export type KnowledgeObservabilityResult = {
  success: boolean;
  error?: string;
  observability?: RetrievalObservabilitySnapshotV1;
};
export type KnowledgePolicyPromotionPayload = {
  operationId: string;
  evidenceRoot: string;
  evidenceManifestName: string;
  evidenceManifestDigest: string;
};
export type KnowledgePolicyImportPayload = { operationId: string };
export type KnowledgePolicyRollbackPayload = {
  operationId: string;
  profile: RetrievalProfile;
  expectedPolicyDigest: string;
};
export type KnowledgeRetrievalFeedbackPayload = {
  operationId: string;
  receiptId: string;
  action: 'attach' | 'dismiss';
};
