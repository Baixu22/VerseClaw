import { invokeHost } from '../../host-api-client';
import type { KnowledgeRouteContextPayload, KnowledgeRouteContextResult, KnowledgeRetrievePayload, KnowledgeRetrieveResult } from '@shared/host-api/contract';

export const knowledgeRoutingApi = {
  retrieve: (input: KnowledgeRetrievePayload): Promise<KnowledgeRetrieveResult> => (
    invokeHost('knowledge', 'retrieve', input)
  ),
  routeContext: (input: KnowledgeRouteContextPayload): Promise<KnowledgeRouteContextResult> => (
    invokeHost('knowledge', 'routeContext', input)
  ),
} as const;
