import { invokeHost } from '../../host-api-client';
import type { KnowledgeEmbeddingSelection, KnowledgeEmbeddingStatusResult } from '@shared/knowledge/embedding';

export const knowledgeEmbeddingApi = {
  embeddingStatus: (): Promise<KnowledgeEmbeddingStatusResult> => invokeHost('knowledge', 'embeddingStatus'),
  embeddingConfigure: (input: KnowledgeEmbeddingSelection): Promise<KnowledgeEmbeddingStatusResult> => invokeHost('knowledge', 'embeddingConfigure', input),
  embeddingCancel: (): Promise<KnowledgeEmbeddingStatusResult> => invokeHost('knowledge', 'embeddingCancel'),
  embeddingDisable: (): Promise<KnowledgeEmbeddingStatusResult> => invokeHost('knowledge', 'embeddingDisable'),
  embeddingRetry: (): Promise<KnowledgeEmbeddingStatusResult> => invokeHost('knowledge', 'embeddingRetry'),
} as const;
