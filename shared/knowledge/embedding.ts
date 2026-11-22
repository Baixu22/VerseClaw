export type KnowledgeEmbeddingSelection = {
  mode: 'local' | 'remote';
  providerRef?: string;
  model?: string;
};

export type KnowledgeEmbeddingStatus = {
  mode: 'disabled' | 'local' | 'remote';
  status: 'disabled' | 'installing' | 'warming' | 'ready' | 'unavailable' | 'cancelled';
  providerRef?: string;
  model?: string;
  dimensions?: number;
  spaceId?: string;
  credentialEpoch: number;
  capability?: { schema: 'ProviderCapabilitySnapshot/v1'; observedAt: string };
  progress?: { bytes: number; total: number };
  error?: string;
};

export type KnowledgeEmbeddingStatusResult = {
  success: boolean;
  embedding?: KnowledgeEmbeddingStatus;
  error?: string;
};
