import type { SourceRefV2 } from './owner-read-contract.js';

export type RelationshipIntent = 'lookup' | 'relationship' | 'research';
export type RelationshipEdgeV1 = {
  kind: 'imports' | 'calls';
  source: SourceRefV2;
  target: SourceRefV2;
  sourceSymbolId: string;
  targetSymbolId: string;
  sourceSymbol: string;
  targetSymbol: string;
  line: number;
  depth: number;
};
export type RelationshipExpansionV1 = {
  schema: 'RelationshipExpansion/v1';
  status: 'complete' | 'partial' | 'unavailable' | 'disabled';
  repoRevision: string;
  maxDepth: number;
  maxNodes: number;
  sources: SourceRefV2[];
  edges: RelationshipEdgeV1[];
  rejected: Array<{ filePath: string; reason: string }>;
  truncated: boolean;
};
export type TaskContextHintV1 = {
  schema: 'TaskContextHint/v1';
  status: 'available' | 'unavailable' | 'disabled';
  reason?: string;
  sourceRef?: SourceRefV2;
  taskNodeId?: string;
  revision?: number;
  contractDigest?: string;
  objective?: string;
  constraints: string[];
  evidenceRefs: Array<{ path: string; sha256: string; receiptId?: string; criterionId?: string }>;
  truncated: boolean;
};
