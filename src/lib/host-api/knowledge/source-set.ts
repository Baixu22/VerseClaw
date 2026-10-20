import { invokeHost } from '../../host-api-client';
import type {
  KnowledgeAnswerFromSourceSetPayload,
  KnowledgeAnswerFromSourceSetResult,
  KnowledgeCreateArtifactDraftPayload,
  KnowledgeDeleteSourceSetPayload,
  KnowledgeDraftResult,
  KnowledgeListSourceSetsResult,
  KnowledgeSaveSourceSetPayload,
  KnowledgeSourceSetResult,
  HostSuccess,
} from '@shared/host-api/contract';

export const knowledgeSourceSetApi = {
  listSourceSets: (): Promise<KnowledgeListSourceSetsResult> => invokeHost('knowledge', 'listSourceSets'),
  saveSourceSet: (input: KnowledgeSaveSourceSetPayload): Promise<KnowledgeSourceSetResult> => (
    invokeHost('knowledge', 'saveSourceSet', input)
  ),
  deleteSourceSet: (input: KnowledgeDeleteSourceSetPayload): Promise<HostSuccess> => (
    invokeHost('knowledge', 'deleteSourceSet', input)
  ),
  answerFromSourceSet: (
    input: KnowledgeAnswerFromSourceSetPayload,
  ): Promise<KnowledgeAnswerFromSourceSetResult> => (
    invokeHost('knowledge', 'answerFromSourceSet', input)
  ),
  createArtifactDraft: (input: KnowledgeCreateArtifactDraftPayload): Promise<KnowledgeDraftResult> => (
    invokeHost('knowledge', 'createArtifactDraft', input)
  ),
} as const;
