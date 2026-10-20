import { invokeHost } from '../../host-api-client';
import type {
  KnowledgeListWatchedDirectoryEventsPayload,
  KnowledgeWatchedDirectoryConfig,
  KnowledgeWatchedDirectoryEvent,
  HostSuccess,
} from '@shared/host-api/contract';

export const knowledgeWatchedDirectoriesApi = {
  listWatchedDirectories: (): Promise<KnowledgeWatchedDirectoryConfig[]> => (
    invokeHost('knowledge', 'listWatchedDirectories')
  ),
  addWatchedDirectory: (config: KnowledgeWatchedDirectoryConfig): Promise<HostSuccess> => (
    invokeHost('knowledge', 'addWatchedDirectory', config)
  ),
  updateWatchedDirectory: (
    id: string,
    config: Partial<KnowledgeWatchedDirectoryConfig>,
  ): Promise<HostSuccess> => (
    invokeHost('knowledge', 'updateWatchedDirectory', { id, config })
  ),
  removeWatchedDirectory: (id: string): Promise<HostSuccess> => (
    invokeHost('knowledge', 'removeWatchedDirectory', { id })
  ),
  listWatchedDirectoryEvents: (
    payload: KnowledgeListWatchedDirectoryEventsPayload,
  ): Promise<KnowledgeWatchedDirectoryEvent[]> => (
    invokeHost('knowledge', 'listWatchedDirectoryEvents', payload)
  ),
} as const;
