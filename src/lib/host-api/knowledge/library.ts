import { invokeHost } from '../../host-api-client';
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
