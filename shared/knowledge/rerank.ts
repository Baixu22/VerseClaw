export const RERANK_MODEL_MANIFEST = [
  { model: 'Qwen/Qwen3-Reranker-0.6B', architecture: 'cross-encoder', languages: '100+', maxInputTokens: 32768 },
  { model: 'Qwen/Qwen3-Reranker-4B', architecture: 'cross-encoder', languages: '100+', maxInputTokens: 32768 },
  { model: 'Qwen/Qwen3-Reranker-8B', architecture: 'cross-encoder', languages: '100+', maxInputTokens: 32768 },
] as const;

export type KnowledgeRerankSelection = {
  mode: 'local' | 'remote';
  providerRef?: string;
  model?: string;
  endpoint?: string;
};

export type KnowledgeRerankStatus = {
  mode: 'disabled' | 'local' | 'remote';
  status: 'disabled' | 'ready' | 'unavailable' | 'cancelled';
  credentialEpoch: number;
  providerRef?: string;
  model?: string;
  endpoint?: string;
  models: typeof RERANK_MODEL_MANIFEST;
  error?: string;
};

export type KnowledgeRerankStatusResult = {
  success: boolean;
  rerank?: KnowledgeRerankStatus;
  error?: string;
};

export type RerankResultV1 = {
  schema: 'RerankResult/v1';
  status: 'complete' | 'cancelled' | 'unavailable';
  providerRef: string;
  model: string;
  scoreKind: 'raw-relevance';
  calibrated: false;
  candidateCount: number;
  batchCount: number;
  elapsedMs: number;
  inputTokens?: number;
  results: Array<{ id: string; score: number }>;
};
