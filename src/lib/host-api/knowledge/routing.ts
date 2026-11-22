import { invokeHost } from '../../host-api-client';
import type { KnowledgeRouteContextPayload, KnowledgeRouteContextResult, KnowledgeRetrievePayload, KnowledgeRetrieveResult } from '@shared/host-api/contract';
import type { KnowledgeResearchPayload, KnowledgeResearchRequestPayload, KnowledgeResearchResult } from '@shared/knowledge/research';

export const knowledgeRoutingApi = {
  researchStart: (input: KnowledgeResearchPayload): Promise<KnowledgeResearchResult> => invokeHost('knowledge', 'researchStart', input),
  researchStatus: (input: KnowledgeResearchRequestPayload): Promise<KnowledgeResearchResult> => invokeHost('knowledge', 'researchStatus', input),
  researchCancel: (input: KnowledgeResearchRequestPayload) => invokeHost('knowledge', 'researchCancel', input),
  retrieve: (input: KnowledgeRetrievePayload): Promise<KnowledgeRetrieveResult> => (
    invokeHost('knowledge', 'retrieve', input)
  ),
  routeContext: (input: KnowledgeRouteContextPayload): Promise<KnowledgeRouteContextResult> => (
    invokeHost('knowledge', 'routeContext', input)
  ),
} as const;
