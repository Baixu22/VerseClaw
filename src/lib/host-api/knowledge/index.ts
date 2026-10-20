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

export const knowledgeHostApi = {
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
