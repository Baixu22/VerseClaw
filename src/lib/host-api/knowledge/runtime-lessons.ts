import { invokeHost } from '../../host-api-client';
import type {
  KnowledgeMatchErrorExperiencePayload,
  KnowledgeMatchErrorExperienceResult,
  KnowledgeRuntimeLessonsReportResult,
  KnowledgeSekbBatchDistillSuggestPayload,
  KnowledgeSekbBatchDistillSuggestResult,
  KnowledgeSekbCaptureTrajectoryPayload,
  KnowledgeSekbCaptureTrajectoryResult,
  KnowledgeSekbConfirmPrinciplePayload,
  KnowledgeSekbConfirmPrincipleResult,
  KnowledgeSekbRejectSuggestionPayload,
  KnowledgeSekbRejectSuggestionResult,
  KnowledgeSekbRetrieveForTaskPayload,
  KnowledgeSekbRetrieveForTaskResult,
  KnowledgeSekbShadowEvaluationExportPayload,
  KnowledgeSekbShadowEvaluationExportResult,
  KnowledgeSekbShadowEvaluationProtocolPayload,
  KnowledgeSekbShadowEvaluationProtocolResult,
  KnowledgeSekbShadowEvaluationReportPayload,
  KnowledgeSekbShadowEvaluationReportResult,
  KnowledgeSekbSuggestPrinciplesPayload,
  KnowledgeSekbSuggestPrinciplesResult,
  KnowledgeUpdateErrorExperienceEffectivenessPayload,
  KnowledgeUpdateErrorExperienceEffectivenessResult,
} from '@shared/host-api/contract';

export const knowledgeRuntimeLessonsApi = {
  runtimeLessonsReport: (): Promise<KnowledgeRuntimeLessonsReportResult> => (
    invokeHost('knowledge', 'runtimeLessonsReport')
  ),
  sekbShadowEvaluationExport: (
    input: KnowledgeSekbShadowEvaluationExportPayload,
  ): Promise<KnowledgeSekbShadowEvaluationExportResult> => (
    invokeHost('knowledge', 'sekbShadowEvaluationExport', input)
  ),
  sekbShadowEvaluationProtocol: (
    input: KnowledgeSekbShadowEvaluationProtocolPayload,
  ): Promise<KnowledgeSekbShadowEvaluationProtocolResult> => (
    invokeHost('knowledge', 'sekbShadowEvaluationProtocol', input)
  ),
  sekbShadowEvaluationReport: (
    input: KnowledgeSekbShadowEvaluationReportPayload,
  ): Promise<KnowledgeSekbShadowEvaluationReportResult> => (
    invokeHost('knowledge', 'sekbShadowEvaluationReport', input)
  ),
  sekbSuggestPrinciples: (
    input?: KnowledgeSekbSuggestPrinciplesPayload,
  ): Promise<KnowledgeSekbSuggestPrinciplesResult> => (
    invokeHost('knowledge', 'sekbSuggestPrinciples', input)
  ),
  sekbBatchDistillSuggest: (
    input?: KnowledgeSekbBatchDistillSuggestPayload,
  ): Promise<KnowledgeSekbBatchDistillSuggestResult> => (
    invokeHost('knowledge', 'sekbBatchDistillSuggest', input)
  ),
  sekbConfirmPrinciple: (
    input: KnowledgeSekbConfirmPrinciplePayload,
  ): Promise<KnowledgeSekbConfirmPrincipleResult> => (
    invokeHost('knowledge', 'sekbConfirmPrinciple', input)
  ),
  sekbRejectSuggestion: (
    input: KnowledgeSekbRejectSuggestionPayload,
  ): Promise<KnowledgeSekbRejectSuggestionResult> => (
    invokeHost('knowledge', 'sekbRejectSuggestion', input)
  ),
  sekbCaptureTrajectory: (
    input: KnowledgeSekbCaptureTrajectoryPayload,
  ): Promise<KnowledgeSekbCaptureTrajectoryResult> => (
    invokeHost('knowledge', 'sekbCaptureTrajectory', input)
  ),
  sekbRetrieveForTask: (
    input: KnowledgeSekbRetrieveForTaskPayload,
  ): Promise<KnowledgeSekbRetrieveForTaskResult> => (
    invokeHost('knowledge', 'sekbRetrieveForTask', input)
  ),
  matchErrorExperience: (
    input: KnowledgeMatchErrorExperiencePayload,
  ): Promise<KnowledgeMatchErrorExperienceResult> => (
    invokeHost('knowledge', 'matchErrorExperience', input)
  ),
  updateErrorExperienceEffectiveness: (
    input: KnowledgeUpdateErrorExperienceEffectivenessPayload,
  ): Promise<KnowledgeUpdateErrorExperienceEffectivenessResult> => (
    invokeHost('knowledge', 'updateErrorExperienceEffectiveness', input)
  ),
} as const;
