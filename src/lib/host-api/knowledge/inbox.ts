import { invokeHost } from '../../host-api-client';
import type {
  KnowledgeCreateInboxItemPayload,
  KnowledgeInboxItemIdPayload,
  KnowledgeInboxResult,
  KnowledgeListInboxItemsPayload,
  KnowledgeListInboxItemsResult,
  KnowledgeUpdateInboxItemPayload,
} from '@shared/host-api/contract';

export const knowledgeInboxApi = {
  createInboxItem: (input: KnowledgeCreateInboxItemPayload): Promise<KnowledgeInboxResult> => (
    invokeHost('knowledge', 'createInboxItem', input)
  ),
  listInboxItems: (input?: KnowledgeListInboxItemsPayload): Promise<KnowledgeListInboxItemsResult> => (
    invokeHost('knowledge', 'listInboxItems', input)
  ),
  updateInboxItem: (input: KnowledgeUpdateInboxItemPayload): Promise<KnowledgeInboxResult> => (
    invokeHost('knowledge', 'updateInboxItem', input)
  ),
  dismissInboxItem: (input: KnowledgeInboxItemIdPayload): Promise<KnowledgeInboxResult> => (
    invokeHost('knowledge', 'dismissInboxItem', input)
  ),
  promoteInboxItemToDraft: (input: KnowledgeInboxItemIdPayload): Promise<KnowledgeInboxResult> => (
    invokeHost('knowledge', 'promoteInboxItemToDraft', input)
  ),
} as const;
