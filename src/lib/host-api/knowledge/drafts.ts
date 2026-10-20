import { invokeHost } from '../../host-api-client';
import type {
  KnowledgeCreateDraftPayload,
  KnowledgeDraftResult,
  KnowledgeGetDraftPayload,
  KnowledgeListDraftsPayload,
  KnowledgeListDraftsResult,
  KnowledgeReviewDraftPayload,
  KnowledgeUpdateDraftPayload,
} from '@shared/host-api/contract';

export const knowledgeDraftsApi = {
  createDraft: (input: KnowledgeCreateDraftPayload): Promise<KnowledgeDraftResult> => (
    invokeHost('knowledge', 'createDraft', input)
  ),
  listDrafts: (input?: KnowledgeListDraftsPayload): Promise<KnowledgeListDraftsResult> => (
    invokeHost('knowledge', 'listDrafts', input)
  ),
  getDraft: (input: KnowledgeGetDraftPayload): Promise<KnowledgeDraftResult> => invokeHost('knowledge', 'getDraft', input),
  updateDraft: (input: KnowledgeUpdateDraftPayload): Promise<KnowledgeDraftResult> => (
    invokeHost('knowledge', 'updateDraft', input)
  ),
  reviewDraft: (input: KnowledgeReviewDraftPayload): Promise<KnowledgeDraftResult> => (
    invokeHost('knowledge', 'reviewDraft', input)
  ),
} as const;
