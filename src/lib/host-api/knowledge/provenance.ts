import { invokeHost } from '../../host-api-client';
import type {
  KnowledgeGovernanceResult,
  KnowledgeListGovernanceReceiptsResult,
  KnowledgeProvenancePayload,
  KnowledgeProvenanceResult,
  KnowledgeRecordReferencePayload,
} from '@shared/host-api/contract';

export const knowledgeProvenanceApi = {
  recordKnowledgeReference: (input: KnowledgeRecordReferencePayload): Promise<KnowledgeProvenanceResult> => (
    invokeHost('knowledge', 'recordKnowledgeReference', input)
  ),
  getProvenance: (input: KnowledgeProvenancePayload): Promise<KnowledgeProvenanceResult> => (
    invokeHost('knowledge', 'getProvenance', input)
  ),
  governanceAudit: (): Promise<KnowledgeGovernanceResult> => invokeHost('knowledge', 'governanceAudit'),
  listGovernanceReceipts: (): Promise<KnowledgeListGovernanceReceiptsResult> => (
    invokeHost('knowledge', 'listGovernanceReceipts')
  ),
} as const;
