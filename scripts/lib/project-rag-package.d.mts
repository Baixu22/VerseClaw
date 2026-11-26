export type RetrievalArtifactManifestV1 = {
  schema: 'RetrievalArtifactManifest/v1'; candidate: string; target: string; runtimeVersion: string;
  stateSchema: { minimumReadable: number; maximumReadable: number; writes: number; migration: string };
  portableCapacity: number; annCapacity: number; nativeStatus: string; modelArtifacts: unknown[];
  files: Array<{ path: string; bytes: number; sha256: string }>; totalBytes: number;
  actor: string; driven_by: 'agent'; manifestDigest: string;
};
export const RETRIEVAL_ARTIFACT_MANIFEST: string;
export function createRetrievalArtifactManifest(root: string, options: { candidate: string; platform: string; arch: string }): RetrievalArtifactManifestV1;
export function verifyRetrievalArtifactManifest(root: string, options?: { target?: string }): RetrievalArtifactManifestV1;
export function sealRetrievalArtifactManifest(root: string, options: { candidate: string; platform: string; arch: string }): RetrievalArtifactManifestV1;
export function planRetrievalUpgrade(previous: RetrievalArtifactManifestV1, next: RetrievalArtifactManifestV1, input: { databaseUserVersion: number; freeBytes: number }): { schema: 'RetrievalUpgradeReceipt/v1'; status: 'ready' | 'rejected'; reasons: string[]; [key: string]: unknown };
export function availableArtifactBytes(directory: string): number;
