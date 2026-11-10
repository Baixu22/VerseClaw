import { knowledgeLibraryApi } from './library';
import { knowledgeInboxApi } from './inbox';
import { knowledgeDraftsApi } from './drafts';
import { knowledgeProposalsApi } from './proposals';
import { knowledgeStewardApi } from './steward';
import { knowledgeRuntimeLessonsApi } from './runtime-lessons';
import { knowledgeSourceSetApi } from './source-set';
import { knowledgeWatchedDirectoriesApi } from './watched-directories';
import { knowledgeProvenanceApi } from './provenance';
import { knowledgeRoutingApi } from './routing';
import { knowledgeConnectorsApi } from './connectors';
import { knowledgeEmbeddingApi } from './embedding';

export const knowledgeHostApi = {
  ...knowledgeEmbeddingApi,
  ...knowledgeConnectorsApi,
  ...knowledgeLibraryApi,
  ...knowledgeRoutingApi,
  ...knowledgeInboxApi,
  ...knowledgeDraftsApi,
  ...knowledgeProposalsApi,
  ...knowledgeStewardApi,
  ...knowledgeRuntimeLessonsApi,
  ...knowledgeSourceSetApi,
  ...knowledgeProvenanceApi,
  ...knowledgeWatchedDirectoriesApi,
};
