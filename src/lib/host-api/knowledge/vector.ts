import { invokeHost } from '../../host-api-client';
import type { KnowledgeVectorStatusResult } from '@shared/knowledge/vector';
export const knowledgeVectorApi = {
  vectorStatus: (): Promise<KnowledgeVectorStatusResult> => invokeHost('knowledge', 'vectorStatus'),
  vectorConfigure: (payload: { backend: 'sqlite-flat' | 'lancedb-ann' }): Promise<KnowledgeVectorStatusResult> => invokeHost('knowledge', 'vectorConfigure', payload),
  vectorDisable: (): Promise<KnowledgeVectorStatusResult> => invokeHost('knowledge', 'vectorDisable'),
  vectorRebuild: (): Promise<KnowledgeVectorStatusResult> => invokeHost('knowledge', 'vectorRebuild'),
  vectorOptimize: (): Promise<KnowledgeVectorStatusResult> => invokeHost('knowledge', 'vectorOptimize'),
} as const;
