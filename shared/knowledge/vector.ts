export type KnowledgeVectorStatus = {
  status: 'disabled' | 'building' | 'ready' | 'unavailable' | 'cancelled';
  requestedBackend: 'sqlite-flat' | 'lancedb-ann' | null;
  effectiveBackend: 'sqlite-flat' | 'lancedb-ann';
  capability: { available: boolean; maxReferenceRows: number; reason?: string };
  generation: { generationId: string; rowCount: number; spaceId: string; backend: string } | null;
  indexing: boolean;
  reason: string | null;
};
export type KnowledgeVectorStatusResult = { success: boolean; vector?: KnowledgeVectorStatus; error?: string };
