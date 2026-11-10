import type { OwnerReadSnapshotV1 } from 'openclaw/plugin-sdk/memory-owner-read-types';
export function ragPromotionPolicy(): Record<string, any>;
export function freezeRagV1(repositoryRoot: string, versionRoot: string,
  ownerSnapshot: (raw: string, subjectId: string, vault: string) => Promise<OwnerReadSnapshotV1>, options?: { catalogue?: Array<Record<string, any>>; codeTasks?: Array<Record<string, any>>; corpusId?: string }): Promise<{
  versionRoot: string; freezeDigest: string; sourceFiles: number; queries: number; tasks: number; negatives: number; plannedSlots: number;
}>;
