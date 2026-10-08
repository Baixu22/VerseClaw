export interface RepositoryArtifactPolicy {
  schemaVersion: number;
  localOnlyDirectories: string[];
  localOnlyFiles: string[];
  retiredTests: string[];
  requiredInputs: string[];
  preservedMixedUseDirectories: string[];
  reviewedDirectories?: string[];
  retainedFiles?: string[];
}

export function isLocalArtifact(path: string, policy: RepositoryArtifactPolicy): boolean;
export function checkRepositoryArtifacts(root?: string): {
  schemaVersion: number;
  trackedPaths: number;
  issues: string[];
  passed: boolean;
};

export function renderReviewedIgnore(policy: RepositoryArtifactPolicy): string;
