export interface RepositoryArtifactPolicy {
  schemaVersion: number;
  localOnlyDirectories: string[];
  localOnlyFiles: string[];
  retiredTests: string[];
  requiredInputs: string[];
  preservedMixedUseDirectories: string[];
  artifactBatches: Record<string, 'retained' | 'mixed' | 'local-only'>;
}

export function isLocalArtifact(path: string, policy: RepositoryArtifactPolicy): boolean;
export function checkRepositoryArtifacts(root?: string): {
  schemaVersion: number;
  trackedPaths: number;
  issues: string[];
  passed: boolean;
};
