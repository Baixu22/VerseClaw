import { invokeHost } from '../../host-api-client';
import type {
  KnowledgeApplyReviewedChangePayload,
  KnowledgeApplyReviewedChangeResult,
  KnowledgeListProposalsPayload,
  KnowledgeListProposalsResult,
  KnowledgeListReviewBundlesPayload,
  KnowledgeListReviewBundlesResult,
  KnowledgePreviewChangePayload,
  KnowledgePreviewChangeResult,
  KnowledgeProposeChangePayload,
  KnowledgeProposalResult,
} from '@shared/host-api/contract';

export const knowledgeProposalsApi = {
  proposeChange: (input: KnowledgeProposeChangePayload): Promise<KnowledgeProposalResult> => (
    invokeHost('knowledge', 'proposeChange', input)
  ),
  listProposals: (input?: KnowledgeListProposalsPayload): Promise<KnowledgeListProposalsResult> => (
    invokeHost('knowledge', 'listProposals', input)
  ),
  listReviewBundles: (input?: KnowledgeListReviewBundlesPayload): Promise<KnowledgeListReviewBundlesResult> => (
    invokeHost('knowledge', 'listReviewBundles', input)
  ),
  previewChange: (input: KnowledgePreviewChangePayload): Promise<KnowledgePreviewChangeResult> => (
    invokeHost('knowledge', 'previewChange', input)
  ),
  applyReviewedChange: (input: KnowledgeApplyReviewedChangePayload): Promise<KnowledgeApplyReviewedChangeResult> => (
    invokeHost('knowledge', 'applyReviewedChange', input)
  ),
} as const;
