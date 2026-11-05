import { invokeHost } from '../../host-api-client';
import type { HostSuccess, KnowledgeConnectorReceipt, KnowledgeGithubConnectorConfig } from '@shared/host-api/contract';

export const knowledgeConnectorsApi = {
  listSourceConnectors: (): Promise<HostSuccess & { connectors: Array<KnowledgeGithubConnectorConfig & { receipt?: KnowledgeConnectorReceipt }> }> => invokeHost('knowledge', 'listSourceConnectors'),
  upsertSourceConnector: (config: KnowledgeGithubConnectorConfig): Promise<HostSuccess> => invokeHost('knowledge', 'upsertSourceConnector', config),
  syncSourceConnector: (id: string): Promise<HostSuccess & { receipt?: KnowledgeConnectorReceipt }> => invokeHost('knowledge', 'syncSourceConnector', { id }),
  removeSourceConnector: (id: string): Promise<HostSuccess> => invokeHost('knowledge', 'removeSourceConnector', { id }),
} as const;
