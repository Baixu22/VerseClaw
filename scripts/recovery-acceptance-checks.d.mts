export function assertRecoveryBuildInputs(root: string, electronPath: unknown): void;
export function recoveryAcceptancePassed(input: {
  windowSamples: number;
  qualitySamples: number;
  candidateReport?: { evaluation?: { status?: string }; rejectedEvidence?: unknown[] };
  legacyReport?: { evaluation?: { status?: string }; rejectedEvidence?: unknown[] };
}): boolean;
