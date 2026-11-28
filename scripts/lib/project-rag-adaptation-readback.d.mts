export function verifyKnowledgeAdaptationPackage(directory: string, pin: { path: string; digest: string }, expectedCandidate: string, expectedPolicyDigest: string, expectedProfile: 'local' | 'quality' | 'research', expectedBaselineDigest: string): {
  schema: 'KnowledgeAdaptationQualificationResult/v1'; driven_by: 'agent'; candidate: string; origin: string;
  snapshotDigest: string; evaluatorVersion: string; planDigest: string; datasetDigest: string;
  status: 'insufficient-evidence' | 'qualified'; reasons: string[]; rows: Array<{queryId: string; arm: string; failureStage: string | null; success: boolean}>; slices: unknown[]; effect: unknown;
};
