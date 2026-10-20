import { invokeHost } from '../../host-api-client';
import type {
  KnowledgeStewardConfigGetResult,
  KnowledgeStewardConfigUpdatePayload,
  KnowledgeStewardConfigUpdateResult,
  KnowledgeStewardReviewPayload,
  KnowledgeStewardReviewResult,
} from '@shared/host-api/contract';

export const knowledgeStewardApi = {
  stewardReview: (input: KnowledgeStewardReviewPayload): Promise<KnowledgeStewardReviewResult> => (
    invokeHost('knowledge', 'stewardReview', input)
  ),
  stewardConfigGet: (): Promise<KnowledgeStewardConfigGetResult> => (
    invokeHost('knowledge', 'stewardConfigGet')
  ),
  stewardConfigUpdate: (input: KnowledgeStewardConfigUpdatePayload): Promise<KnowledgeStewardConfigUpdateResult> => (
    invokeHost('knowledge', 'stewardConfigUpdate', input)
  ),
} as const;
