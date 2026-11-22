import { invokeHost } from '../../host-api-client';
import type { KnowledgeRerankSelection, KnowledgeRerankStatusResult } from '@shared/knowledge/rerank';

export const knowledgeRerankApi = {
  rerankStatus: (): Promise<KnowledgeRerankStatusResult> => invokeHost('knowledge', 'rerankStatus'),
  rerankConfigure: (input: KnowledgeRerankSelection): Promise<KnowledgeRerankStatusResult> => invokeHost('knowledge', 'rerankConfigure', input),
  rerankCancel: (): Promise<KnowledgeRerankStatusResult> => invokeHost('knowledge', 'rerankCancel'),
  rerankDisable: (): Promise<KnowledgeRerankStatusResult> => invokeHost('knowledge', 'rerankDisable'),
  rerankRetry: (): Promise<KnowledgeRerankStatusResult> => invokeHost('knowledge', 'rerankRetry'),
} as const;
