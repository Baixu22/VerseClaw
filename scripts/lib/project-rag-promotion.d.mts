import type { OfflineRetrievalEvaluationV1 } from '../../shared/knowledge/observability.js';
import type { RetrievalPolicyV1 } from '../../shared/knowledge/observability.js';
export function evaluateOfflineRagReport(input: unknown): OfflineRetrievalEvaluationV1;
export function verifyOfflineRagPolicyPackage(directory: string, expectedManifestDigest: string, manifestName?: string): {
  candidate: RetrievalPolicyV1; expectedPolicyDigest: string; evaluation: OfflineRetrievalEvaluationV1;
  evidenceRoot: string; evidenceManifestDigest: string;
};
