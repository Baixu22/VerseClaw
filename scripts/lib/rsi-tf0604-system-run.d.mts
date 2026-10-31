export const TF0604_SYSTEM_RUN_DIR: string;
export const TF0604_SYSTEM_RUN_ACTOR: string;
export function preserveTrialEvidence(runDir: string, outputDir: string, options?: { root?: string }): {
  schemaVersion: string; driven_by: 'agent'; actor: string; directory: string; manifestDigest: string;
  recordedTrials: number; expectedTrials: number; completeCaseCount: number;
  failureClasses: Record<string, { trialCount: number; caseCount: number }>;
  fileCount: number; complete: boolean; claims: Record<string, boolean>;
};
