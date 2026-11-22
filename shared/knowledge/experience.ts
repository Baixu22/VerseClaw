import type { SourceRefV2, OwnerReadSnapshotV1 } from './owner-read-contract.js';
import { getMemorySourceOwner } from './memory.js';

/** ExperienceRef/v1 uses the canonical owner pin and its content version. */
export type ExperienceRefV1 = SourceRefV2 & { domain: 'experience'; authorityId: 'sekb' };
export type ExperienceCandidate = {
  principle_id: string; title: string; condition: string; action: string; reason: string;
  retrieval_count: number; sourceRef: ExperienceRefV1; content: string; snapshot: OwnerReadSnapshotV1;
};
export type ExperienceRetrieveResult = {
  status: 'admitted' | 'denied'; reason?: string; requestId?: string; candidates: ExperienceCandidate[];
};

export function isExperienceSourceRef(ref: SourceRefV2 | undefined): ref is ExperienceRefV1 {
  return ref?.domain === 'experience' && ref.authorityId === 'sekb';
}

export function getExplicitKnowledgeOwner(ref: { sourceRef?: SourceRefV2; id: string; path?: string }) {
  if (ref.sourceRef) return isExperienceSourceRef(ref.sourceRef) ? 'sekb' : getMemorySourceOwner(ref);
  return (ref.path || ref.id).startsWith('sekb:') ? 'sekb' : getMemorySourceOwner(ref);
}
