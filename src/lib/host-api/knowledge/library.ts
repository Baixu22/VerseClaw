import { invokeHost } from '../../host-api-client';
import type { KnowledgeObservabilityResult, KnowledgePolicyImportPayload, KnowledgePolicyRollbackPayload, KnowledgeRetrievalFeedbackPayload } from '@shared/knowledge/observability';
import type { ProjectRagConfigInput, KnowledgeOperationsResult, KnowledgeOperationsConfigureResult, KnowledgeIndexResult } from '@shared/knowledge/operations';
import type {
  KnowledgeApplyDraftPayload,
  KnowledgeApplyDraftResult,
  KnowledgeCompileResult,
  KnowledgeConfigurePayload,
  KnowledgeGetPayload,
  KnowledgeGetResult,
  KnowledgeImportOkfBundlePayload,
  KnowledgeIngestFilesPayload,
  KnowledgeIngestFilesResult,
  KnowledgeInitResult,
  KnowledgeLintResult,
  KnowledgeOkfImportResult,
  KnowledgeOkfValidationResult,
  KnowledgeOpenVaultResult,
  KnowledgeSearchPayload,
  KnowledgeSearchResult,
  KnowledgeStatusResult,
  KnowledgeValidateOkfBundlePayload,
} from '@shared/host-api/contract';

export const knowledgeLibraryApi = {
  observabilityStatus: (): Promise<KnowledgeObservabilityResult> => invokeHost('knowledge', 'observabilityStatus'),
  retrievalFeedback: (input: KnowledgeRetrievalFeedbackPayload): Promise<KnowledgeObservabilityResult> => invokeHost('knowledge', 'retrievalFeedback', input),
  policyPromote: (input: KnowledgePolicyImportPayload): Promise<KnowledgeObservabilityResult> => invokeHost('knowledge', 'policyPromote', input),
  policyRollback: (input: KnowledgePolicyRollbackPayload): Promise<KnowledgeObservabilityResult> => invokeHost('knowledge', 'policyRollback', input),
  operationsStatus: (): Promise<KnowledgeOperationsResult> => invokeHost('knowledge', 'operationsStatus'),
  operationsConfigure: (input: ProjectRagConfigInput): Promise<KnowledgeOperationsConfigureResult> => invokeHost('knowledge', 'operationsConfigure', input),
  indexEnable: (): Promise<KnowledgeIndexResult> => invokeHost('knowledge', 'indexEnable'),
  indexDisable: (): Promise<KnowledgeIndexResult> => invokeHost('knowledge', 'indexDisable'),
  indexPause: (): Promise<KnowledgeIndexResult> => invokeHost('knowledge', 'indexPause'),
  indexResume: (): Promise<KnowledgeIndexResult> => invokeHost('knowledge', 'indexResume'),
  indexRebuild: (): Promise<KnowledgeIndexResult> => invokeHost('knowledge', 'indexRebuild'),
  indexReconcile: (): Promise<KnowledgeIndexResult> => invokeHost('knowledge', 'indexReconcile'),
  indexCleanup: (): Promise<KnowledgeIndexResult> => invokeHost('knowledge', 'indexCleanup'),
  status: (): Promise<KnowledgeStatusResult> => invokeHost('knowledge', 'status'),
  init: (): Promise<KnowledgeInitResult> => invokeHost('knowledge', 'init'),
  configure: (input?: KnowledgeConfigurePayload) => invokeHost('knowledge', 'configure', input),
  ingestFiles: (input: KnowledgeIngestFilesPayload): Promise<KnowledgeIngestFilesResult> => (
    invokeHost('knowledge', 'ingestFiles', input)
  ),
  validateOkfBundle: (input: KnowledgeValidateOkfBundlePayload): Promise<KnowledgeOkfValidationResult> => (
    invokeHost('knowledge', 'validateOkfBundle', input)
  ),
  importOkfBundle: (input: KnowledgeImportOkfBundlePayload): Promise<KnowledgeOkfImportResult> => (
    invokeHost('knowledge', 'importOkfBundle', input)
  ),
  search: (input: KnowledgeSearchPayload): Promise<KnowledgeSearchResult> => invokeHost('knowledge', 'search', input),
  get: (input: KnowledgeGetPayload): Promise<KnowledgeGetResult> => invokeHost('knowledge', 'get', input),
  compile: (): Promise<KnowledgeCompileResult> => invokeHost('knowledge', 'compile'),
  lint: (): Promise<KnowledgeLintResult> => invokeHost('knowledge', 'lint'),
  applyDraft: (input: KnowledgeApplyDraftPayload): Promise<KnowledgeApplyDraftResult> => (
    invokeHost('knowledge', 'applyDraft', input)
  ),
  openVault: (): Promise<KnowledgeOpenVaultResult> => invokeHost('knowledge', 'openVault'),
} as const;
