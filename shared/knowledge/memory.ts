import type { OwnerReadRejectionCode, OwnerReadSnapshotV1, SourceRefV2 } from './owner-read-contract.js';

export type MemorySourceRefV1 = SourceRefV2 & { domain: 'native-memory' | 'role-memory' };
export function isMemorySourceRef(reference: SourceRefV2 | undefined): reference is MemorySourceRefV1 {
  return reference?.domain === 'native-memory' || reference?.domain === 'role-memory';
}
/** A pin owns the domain; explicit bootstrap prefixes only identify a missing pin. */
export function getMemorySourceOwner(reference: { sourceRef?: SourceRefV2; id: string; path?: string }):
  'native-memory' | 'memory-slot' | undefined {
  if (reference.sourceRef) return reference.sourceRef.domain === 'native-memory' ? 'native-memory'
    : reference.sourceRef.domain === 'role-memory' ? 'memory-slot' : undefined;
  const lookup = reference.path || reference.id;
  return lookup.startsWith('native-memory:') ? 'native-memory'
    : lookup.startsWith('memory-slot:') ? 'memory-slot' : undefined;
}
export type RetrievalOwnerDescriptorV1 = {
  schema: 'RetrievalOwnerDescriptor/v1';
  domain: MemorySourceRefV1['domain'];
  authorityId: 'native-memory' | 'memory-slot';
  namespaceId: string;
};
export type MemoryOwnerReadResult =
  | { status: 'admitted'; snapshot: OwnerReadSnapshotV1 }
  | { status: 'denied'; reason: OwnerReadRejectionCode };
