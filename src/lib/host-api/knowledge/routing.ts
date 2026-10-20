import { invokeHost } from '../../host-api-client';
import type { KnowledgeRouteContextPayload, KnowledgeRouteContextResult } from '@shared/host-api/contract';

export const knowledgeRoutingApi = {
  routeContext: (input: KnowledgeRouteContextPayload): Promise<KnowledgeRouteContextResult> => (
    invokeHost('knowledge', 'routeContext', input)
  ),
} as const;
