import type {
  AgentCreatePayload,
  AgentBrowserClickPayload,
  AgentBrowserActionResult,
  AgentBrowserClickByUidPayload,
  AgentBrowserCommandPayload,
  AgentBrowserCommandResult,
  AgentBrowserCredentialPayload,
  AgentBrowserCredentialResult,
  AgentBrowserCredentialSavePayload,
  AgentBrowserVaultHealthResult,
  AgentBrowserEvaluatePayload,
  AgentBrowserEvaluateResult,
  AgentBrowserFillByUidPayload,
  AgentBrowserNavigatePayload,
  AgentBrowserOpenPayload,
  AgentBrowserPressKeyPayload,
  AgentBrowserRequestModeUpgradePayload,
  AgentBrowserRequestModeUpgradeResult,
  AgentBrowserRespondBoundaryChoicePayload,
  AgentBrowserRespondBoundaryChoiceResult,
  AgentBrowserNetworkListPayload,
  AgentBrowserNetworkListResult,
  AgentBrowserNetworkDetailPayload,
  AgentBrowserNetworkDetailResult,
  AgentBrowserNetworkClearPayload,
  AgentBrowserNetworkClearResult,
  AgentBrowserNetworkWaitPayload,
  AgentBrowserNetworkWaitResult,
  AgentBrowserNetworkComparePayload,
  AgentBrowserNetworkCompareResult,
  AgentBrowserNetworkFindParamsPayload,
  AgentBrowserNetworkFindParamsResult,
  AgentBrowserNetworkExtractJsPayload,
  AgentBrowserNetworkExtractJsResult,
  AgentBrowserNewPagePayload,
  AgentBrowserSelectPagePayload,
  AgentBrowserClosePagePayload,
  AgentBrowserNavigatePagePayload,
  AgentBrowserListPagesResult,
  AgentBrowserJsListResourcesPayload,
  AgentBrowserJsListResourcesResult,
  AgentBrowserJsSearchSourcesPayload,
  AgentBrowserJsSearchSourcesResult,
  AgentBrowserJsExtractContextPayload,
  AgentBrowserJsExtractContextResult,
  AgentBrowserSourceMapListCandidatesPayload,
  AgentBrowserSourceMapListCandidatesResult,
  AgentBrowserSourceMapResolveLocationPayload,
  AgentBrowserSourceMapResolveLocationResult,
  AgentBrowserSourceMapExtractOriginalContextPayload,
  AgentBrowserSourceMapExtractOriginalContextResult,
  AgentBrowserRuntimeInspectGlobalsPayload,
  AgentBrowserRuntimeInspectGlobalsResult,
  AgentBrowserRuntimeSearchModulesPayload,
  AgentBrowserRuntimeSearchModulesResult,
  AgentBrowserRuntimeDescribeFunctionPayload,
  AgentBrowserRuntimeDescribeFunctionResult,
  AgentBrowserReplayPrepareRequestPayload,
  AgentBrowserReplayPrepareRequestResult,
  AgentBrowserReplaySendRequestPayload,
  AgentBrowserReplaySendRequestResult,
  AgentBrowserReplayCompareResponsesPayload,
  AgentBrowserReplayCompareResponsesResult,
  AgentBrowserConsoleMessagesPayload,
  AgentBrowserConsoleMessagesResult,
  AgentBrowserFullAccessExecuteScriptPayload,
  AgentBrowserFullAccessExecuteScriptResult,
  AgentBrowserFullAccessFetchPayload,
  AgentBrowserFullAccessFetchResult,
  AgentBrowserFullAccessGetNetworkDetailsPayload,
  AgentBrowserFullAccessGetNetworkDetailsResult,
  AgentBrowserFullAccessReadStoragePayload,
  AgentBrowserFullAccessReadStorageResult,
  AgentBrowserFullAccessRevokePayload,
  AgentBrowserFullAccessRevokeResult,
  AgentBrowserExtractPageTextPayload,
  AgentBrowserExtractPageTextResult,
  AgentBrowserValidateExtractionRulePayload,
  AgentBrowserValidateExtractionRuleResult,
  AgentBrowserProfileSavePayload,
  AgentBrowserProfileSaveResult,
  AgentBrowserProfilesResult,
  AgentBrowserScreenshotPayload,
  AgentBrowserScreenshotResult,
  AgentBrowserSelectorPayload,
  AgentBrowserSessionPayload,
  AgentBrowserSessionResult,
  AgentBrowserSetEnabledPayload,
  AgentBrowserSetEnabledResult,
  AgentBrowserStatusResult,
  AgentBrowserTakeSnapshotPayload,
  AgentBrowserTakeSnapshotResult,
  AgentBrowserTaskCreatePayload,
  AgentBrowserTaskPayload,
  AgentBrowserTaskResult,
  AgentBrowserTasksResult,
  AgentBrowserTypePayload,
  AgentBrowserValidatePayload,
  AgentBrowserValidateResult,
  AgentBrowserVaultResult,
  AgentBootstrapUpdatePayload,
  AgentDevCreateConversationPayload,
  AgentDevCreateConversationResult,
  AgentDevCreateProviderConfigPayload,
  AgentDevCreateProviderConfigResult,
  AgentDevCostReportResult,
  AgentDevDiagnosticsSnapshotResult,
  AgentDevFeatureFlagsPayload,
  AgentDevFeatureFlagsResult,
  AgentDevHostApiCallsPayload,
  AgentDevHostApiCallsResult,
  AgentDevMockReplayConfig,
  AgentDevMockReplayResult,
  AgentDevRecordScenarioPayload,
  AgentDevRecordScenarioResult,
  AgentDevSeedStatePayload,
  AgentDevSeedStateResult,
  AgentDevSelectorContractResult,
  AgentDevSkillSandboxReportResult,
  AgentDevTraceTimelinePayload,
  AgentDevTraceTimelineResult,
  AgentDevTransportTracePayload,
  AgentDevTransportTraceResult,
  AgentDevVisualPreset,
  AgentDevVisualPresetResult,
  AgentDevWorkbenchEvidenceResult,
  AgentUpdateReasoningEffortPayload,
  AgentUpdateAvatarPayload,
  AgentUpdatePayload,
  AgencyRoleDecisionPayload,
  AgencyRoleListResult,
  AgencyRoleMemoryProposalsPayload,
  AgencyRoleMemoryProposalsResult,
  AgencyRolePackageImportPayload,
  AgencyRolePackageListResult,
  AgencyRolePackageRefreshPayload,
  AgencyRolePackageResult,
  AgencyRolePromotionPreviewResult,
  AgencyRolePromotionResult,
  AgencyRoleReviewPayload,
  AgencyRoleSourcePayload,
  CapabilityPublicationQuery,
  CapabilityPublicationResult,
  ChannelAccountsPayload,
  ChannelBindingDeletePayload,
  ChannelBindingSavePayload,
  ChannelRequiredAccountPayload,
  ChannelSaveConfigPayload,
  ChannelSetEnabledPayload,
  ChannelTargetsPayload,
  ChannelTypePayload,
  ChatSendWithMediaPayload,
  ClawGraphAbortPayload,
  ClawGraphCompileHostResult,
  ClawGraphCompilePayload,
  ClawGraphEventsPayload,
  ClawGraphEventsResult,
  ClawGraphListWorkflowsResult,
  ClawGraphReviewPayload,
  ClawGraphRunPayload,
  ClawGraphRunResult,
  ClawGraphStatusResult,
  ClawGraphWorkspacePayload,
  ClawHubSearchPayload,
  CodeReviewCreateTaskLedgerNodePayload,
  CodeReviewCreateTaskLedgerNodeResult,
  CodeReviewRunPayload,
  CodeReviewRunResult,
  CronSessionHistoryPayload,
  DialogMessagePayload,
  DialogOpenPayload,
  FilePreviewTreeOptions,
  FileReadBinaryOptions,
  HostSuccess,
  GitBranchCheckoutPayload,
  GitBranchCreatePayload,
  GitBranchListResult,
  GitCapabilitiesResult,
  GitCommitResult,
  GitCommitPayload,
  GitDiffListResult,
  GitFetchPayload,
  GitFileDiffResult,
  GitFileDiffPayload,
  GitMergePayload,
  GitRebasePayload,
  GitResetPayload,
  GitLogPayload,
  GitLogResult,
  GitReflogPayload,
  GitReflogResult,
  GitMergeBasePayload,
  GitMergeBaseResult,
  GitApplyPatchPayload,
  GitApplyPatchResult,
  GitDiffToBasePayload,
  GitDiffToBaseResult,
  GitOperationResult,
  GitPathPayload,
  GitPathsPayload,
  GitPullPayload,
  GitPushPayload,
  GitStatusResult,
  GitStashListResult,
  GitStashPayload,
  GitStashRefPayload,
  GitWorktreeListResult,
  GitWorktreeAddPayload,
  GithubAuthStatusResult,
  GithubPrCreateInput,
  GithubPrCreateResult,
  GithubPrListPayload,
  GithubPrListResult,
  GithubPrOpenPayload,
  GithubPrViewPayload,
  GithubPrViewResult,
  GithubRepoResult,
  HostApiContract,
  SessionActivitySnapshotPayload,
  ImageGenerationSettingsPayload,
  KnowledgeApplyDraftPayload,
  KnowledgeApplyDraftResult,
  KnowledgeApplyReviewedChangePayload,
  KnowledgeApplyReviewedChangeResult,
  KnowledgeAnswerFromSourceSetPayload,
  KnowledgeAnswerFromSourceSetResult,
  KnowledgeCreateArtifactDraftPayload,
  KnowledgeCreateDraftPayload,
  KnowledgeCreateInboxItemPayload,
  KnowledgeCompileResult,
  KnowledgeConfigurePayload,
  KnowledgeDeleteSourceSetPayload,
  KnowledgeDraftResult,
  KnowledgeGetPayload,
  KnowledgeGetResult,
  KnowledgeInboxItemIdPayload,
  KnowledgeInboxResult,
  KnowledgeImportOkfBundlePayload,
  KnowledgeIngestFilesPayload,
  KnowledgeIngestFilesResult,
  KnowledgeInitResult,
  KnowledgeListDraftsPayload,
  KnowledgeListDraftsResult,
  KnowledgeListInboxItemsPayload,
  KnowledgeListInboxItemsResult,
  KnowledgeListProposalsPayload,
  KnowledgeListProposalsResult,
  KnowledgeListSourceSetsResult,
  KnowledgeLintResult,
  KnowledgeMatchErrorExperiencePayload,
  KnowledgeMatchErrorExperienceResult,
  KnowledgeOkfImportResult,
  KnowledgeOkfValidationResult,
  KnowledgeOpenVaultResult,
  KnowledgePreviewChangePayload,
  KnowledgePreviewChangeResult,
  KnowledgeProposalResult,
  KnowledgeProposeChangePayload,
  KnowledgeProvenancePayload,
  KnowledgeProvenanceResult,
  KnowledgeRecordReferencePayload,
  KnowledgeReviewDraftPayload,
  KnowledgeRouteContextPayload,
  KnowledgeRouteContextResult,
  KnowledgeRuntimeLessonsReportResult,
  KnowledgeSekbSuggestPrinciplesResult,
  KnowledgeSekbSuggestPrinciplesPayload,
  KnowledgeSekbShadowEvaluationReportResult,
  KnowledgeSekbShadowEvaluationReportPayload,
  KnowledgeSekbShadowEvaluationProtocolResult,
  KnowledgeSekbShadowEvaluationProtocolPayload,
  KnowledgeSekbShadowEvaluationExportResult,
  KnowledgeSekbShadowEvaluationExportPayload,
  KnowledgeSekbRejectSuggestionResult,
  KnowledgeSekbCaptureTrajectoryResult,
  KnowledgeSekbCaptureTrajectoryPayload,
  KnowledgeSekbRetrieveForTaskResult,
  KnowledgeSekbRetrieveForTaskPayload,
  KnowledgeSekbRejectSuggestionPayload,
  KnowledgeSekbConfirmPrincipleResult,
  KnowledgeSekbConfirmPrinciplePayload,
  KnowledgeSekbBatchDistillSuggestResult,
  KnowledgeSekbBatchDistillSuggestPayload,
  KnowledgeSearchPayload,
  KnowledgeSearchResult,
  KnowledgeSaveSourceSetPayload,
  KnowledgeSourceSetResult,
  KnowledgeStewardReviewPayload,
  KnowledgeStewardReviewResult,
  KnowledgeStewardConfigGetResult,
  KnowledgeStewardConfigUpdatePayload,
  KnowledgeStewardConfigUpdateResult,
  KnowledgeStatusResult,
  KnowledgeUpdateErrorExperienceEffectivenessPayload,
  KnowledgeUpdateErrorExperienceEffectivenessResult,
  KnowledgeUpdateDraftPayload,
  KnowledgeUpdateInboxItemPayload,
  KnowledgeValidateOkfBundlePayload,
  KnowledgeGovernanceResult,
  KnowledgeListWatchedDirectoryEventsPayload,
  KnowledgeWatchedDirectoryConfig,
  KnowledgeWatchedDirectoryEvent,
  LogMemoryPayload,
  LocalControlPlaneCorrelationFilter,
  LocalControlPlaneCorrelationsResult,
  LocalControlPlaneReportFilter,
  LocalControlPlaneReportsResult,
  LocalControlPlaneStatusResult,
  MediaThumbnailEntry,
  McpCallToolPayload,
  McpHeartbeatPayload,
  McpListToolsPayload,
  McpReloadRuntimePayload,
  McpServerCreatePayload,
  McpServerDeletePayload,
  McpServerResolvePayload,
  McpServerTestPayload,
  McpServerUpdatePayload,
  OpenClawDoctorMode,
  OpenClawDoctorResult,
  OfficecliInstallPayload,
  OfficecliRenderHtmlPayload,
  OfficecliSkillApplyLinksPayload,
  OfficecliWatchPayload,
  ProviderAccount,
  ProviderConfig,
  ProviderModelListPayload,
  ProviderModelListResult,
  ProviderOAuthRequestPayload,
  ProviderUpdateWithKeyPayload,
  ProviderValidationPayload,
  SaveImagePayload,
  SandboxDetectProvidersResult,
  SandboxExplainPayload,
  SandboxExplainResult,
  SandboxStatusResult,
  SandboxUpdateProfilePayload,
  SandboxUpdateProfileResult,
  SettingsKey,
  SettingsSnapshot,
  SettingsValue,
  ShellOpenExternalPayload,
  ShellPathPayload,
  SkillPackId,
  SkillPackReadSkillResult,
  SkillPackSummary,
  SkillQuickAccessPayload,
  SkillUpdateConfigPayload,
  SkillUpdatePayload,
  TaskLedgerAddEdgePayload,
  TaskLedgerAppendEventsPayload,
  TaskLedgerCreateNodePayload,
  TaskLedgerExportHtmlPayload,
  TaskLedgerExportHtmlResult,
  TaskLedgerLinkSessionPayload,
  TaskLedgerReviewPayload,
  TaskLedgerSnapshotResult,
  TaskLedgerUpdateNodePayload,
  TaskLedgerWorkspacePayload,
  PermissionApprovalDecisionPayload,
  PermissionApprovalListPayload,
  PermissionDecisionEventListPayload,
  PermissionDecisionEventListResult,
  OrchestrationPresetCreatePayload,
  OrchestrationPresetListPayload,
  OrchestrationPresetRevokePayload,
  RemoteControlClickPayload,
  RemoteControlEvaluatePayload,
  RemoteControlScreenshotPayload,
  RemoteControlScrollPayload,
  RemoteControlTargetPayload,
  RemoteTaskApprovePayload,
  RemoteTaskCreatePayload,
  RemoteTaskIdPayload,
  RemoteTaskListResult,
  RemoteTaskPreviewResult,
  RemoteTaskRecordResult,
  RoleUpsertConfigRolePayload,
  RoleUpsertConfigRoleResult,
  SessionArchivePayload,
  SessionCompressionArtifactPayload,
  SessionCompressionArtifactResult,
  SessionCompactionHistoryResult,
  SessionCompactionHistoryPayload,
  SessionCompactionPayload,
  SessionCompactionResult,
  SessionCompactionStatusResult,
  SessionCheckpointDiffResult,
  SessionExpandSelectorPayload,
  SessionExpandSelectorResult,
  SessionEmptyArchivePayload,
  SessionForkPayload,
  SessionQueueDrainPayload,
  SessionForkResult,
  SessionStopPayload,
  SessionStopResult,
  SessionHandoffPayload,
  SessionHandoffResult,
  SessionListArchivedPayload,
  SessionListArchivedResult,
  SessionLongTaskControlHistoryPayload,
  SessionLongTaskControlHistoryResult,
  SessionLongTaskControlPayload,
  SessionPermanentDeletePayload,
  SessionRestorePayload,
  SessionLongTaskControlStatusResult,
  SessionManualCompactPayload,
  SessionPatchThinkingPayload,
  SessionPatchRuntimeModelPayload,
  SessionQueueDrainResult,
  SessionRecallOriginalPayload,
  SessionRecallOriginalResult,
  SessionRecoveryContextPayload,
  SessionRecoveryContextResult,
  SessionResumeCheckpointsResult,
  SessionRestoreCheckpointPayload,
  SessionRestoreCheckpointResult,
  SessionTruncatePayload,
  SessionTruncateResult,
  RemoteForgeCapabilitiesResult,
  RemoteForgeContentReadPayload,
  RemoteForgeContentReadResult,
  RemoteForgeMergePayload,
  RemoteForgeMergeResult,
  RemoteForgeMutationPayload,
  RemoteForgeMutationResult,
  RemoteForgePullRequestReadPayload,
  RemoteForgePullRequestReadResult,
  RemoteForgeRepositoryPayload,
  WorkProviderRunPayload,
  WorkProviderRunResult,
  WorkProviderStatusSnapshot,
  WorkProviderValidateArtifactPayload,
  WorkProviderValidateArtifactResult,
  SystemScanPayload,
  SystemDeleteItemsPayload,
  WorkspaceCreatePayload,
  WorkspaceFolderCreatePayload,
  WorkspaceFolderDeletePayload,
  WorkspaceFolderMoveSessionPayload,
  WorkspaceFolderRenamePayload,
  WorkspaceSaveStatePayload,
  WorkspaceTerminalOpenPayload,
  WorkspaceTerminalListPayload,
  WorkspaceTerminalResizePayload,
  WorkspaceTerminalRunPayload,
  WorkspaceTerminalSessionPayload,
  WorkspaceTerminalStatusPayload,
  WorkspaceTerminalWritePayload,
  WorkspaceUpdatePayload,
  WorkspaceWebPreviewDetectPayload,
  WorkspaceWebPreviewStartPayload,
  WorkspaceWebPreviewStatusPayload,
  WorkspaceWebPreviewStopPayload,
  MemoryDetailPayload,
  MemoryExplainInjectionPayload,
  MemoryListPayload,
  MemoryProposal,
  MemoryProposalPreviewResult,
  MemorySearchPayload,
  MemoryUpdatePayload,
} from '@shared/host-api/contract';
import type { CronJobCreateInput, CronJobUpdateInput } from '@shared/types/cron';
import type {
  VtokenAssemblePayload,
  VtokenIngestMarkdownPayload,
  VtokenIngestMemoryPayload,
  VtokenIngestPathPayload,
  VtokenIngestToolsPayload,
  VtokenOpenPayload,
  VtokenSetEnabledPayload,
} from '@shared/vtoken/types';
import type {
  DcsProdFlagSetPayload,
  DcsProdFlagsSnapshot,
} from '@shared/dcs/prod-flags-control';
import type {
  ObservabilityDashboardSnapshot,
  ObservabilityNodeDiagnostics,
  ObservabilityTrace,
  ObservabilityTraceGraphResult,
  ObservabilityTraceQuery,
  ObservabilityTraceQueryResult,
  ObservabilityTrajectoryHistoryPage,
  ObservabilityTrajectorySessionSupply,
} from '@shared/types/observability';
import type { TrajectoryEventV2 } from '../../openclaw_runtime/src/trajectory/types';
import { invokeHost } from './host-api-client';

type PromptCacheStatusFn = HostApiContract['usage']['promptCacheStatus'];
type PromptCacheRiskEventFn = HostApiContract['usage']['recordPromptCacheRiskEvent'];
type UsageAggregateSummaryFn = HostApiContract['usage']['aggregateSummary'];

export type { ChatKnowledgeReference, KnowledgeSekbDistillationSuggestion } from '@shared/host-api/contract';

export type {
  ChannelAccountsResult,
  AgentBrowserActionResult,
  AgentBrowserCommandResult,
  AgentBrowserEvaluateResult,
  AgentBrowserProfileSaveResult,
  AgentBrowserProfilesResult,
  AgentBrowserScreenshotResult,
  AgentBrowserSessionResult,
  AgentBrowserStatusResult,
  AgentBrowserTakeSnapshotResult,
  AgentBrowserValidateResult,
  AgentDevCreateConversationResult,
  AgentDevCreateProviderConfigResult,
  AgentDevCostReportResult,
  AgentDevDiagnosticsSnapshotResult,
  AgentDevFeatureFlagsResult,
  AgentDevHostApiCallsResult,
  AgentDevMockReplayResult,
  AgentDevRecordScenarioResult,
  AgentDevScenario,
  AgentDevSeedStateResult,
  AgentDevSelectorContractResult,
  AgentDevSkillSandboxReportResult,
  AgentDevStatusResult,
  AgentDevTraceTimelineResult,
  AgentDevTransportTraceResult,
  AgentDevVisualPresetResult,
  AgentDevWorkbenchEvidenceResult,
  ChannelCredentialValidationResult,
  ChannelFormValuesResult,
  ChannelGroupItem,
  ChannelSaveConfigResult,
  ChannelTargetOption,
  ChannelTargetsResult,
  ChatSendWithMediaResult,
  ClawGraphCompileHostResult,
  ClawGraphEventsResult,
  ClawGraphListWorkflowsResult,
  ClawGraphRunResult,
  ClawGraphStatusResult,
  CodeReviewCreateTaskLedgerNodeResult,
  CodeReviewRunResult,
  ClawHubInstalledSkill,
  ClawHubListResult,
  ClawHubSearchResult,
  CronSessionHistoryResult,
  CompressionArtifact,
  CompressionSemanticAtom,
  CompressionEvidenceRef,
  CompressionFact,
  DeliveryChannelAccount,
  DeliveryChannelGroup,
  DeliveryTargetsResult,
  GatewayHealthSummary,
  ImageGenerationProvidersResult,
  ImageGenerationSettingsResult,
  KnowledgeApplyDraftResult,
  KnowledgeApplyReviewedChangeResult,
  KnowledgeAnswerFromSourceSetResult,
  KnowledgeCompileResult,
  KnowledgeArtifactType,
  KnowledgeDraft,
  KnowledgeChangeProposal,
  KnowledgeDraftType,
  KnowledgeDraftResult,
  KnowledgeGetResult,
  KnowledgeInboxItem,
  KnowledgeInboxKind,
  KnowledgeInboxResult,
  KnowledgeInboxStatus,
  KnowledgeOkfConcept,
  KnowledgeOkfFrontmatter,
  KnowledgeOkfImportResult,
  KnowledgeOkfValidationResult,
  KnowledgeOkfWarning,
  KnowledgeIngestFilesResult,
  KnowledgeInitResult,
  KnowledgeListDraftsResult,
  KnowledgeListProposalsResult,
  KnowledgeListSourceSetsResult,
  KnowledgeLintResult,
  KnowledgeOpenVaultResult,
  KnowledgePreviewChangeResult,
  KnowledgeProposalResult,
  KnowledgeProvenanceRecord,
  KnowledgeProvenanceResult,
  KnowledgeRouteCandidate,
  KnowledgeRouteCandidateGroup,
  KnowledgeRouteCandidateGroupKey,
  KnowledgeRouteContextResult,
  KnowledgeRuntimeLessonsReportResult,
  KnowledgeSekbSuggestPrinciplesResult,
  KnowledgeSekbSuggestPrinciplesPayload,
  KnowledgeSekbShadowEvaluationReportResult,
  KnowledgeSekbShadowEvaluationReportPayload,
  KnowledgeSekbShadowEvaluationProtocolResult,
  KnowledgeSekbShadowEvaluationProtocolPayload,
  KnowledgeSekbShadowEvaluationExportResult,
  KnowledgeSekbShadowEvaluationExportPayload,
  KnowledgeSekbRejectSuggestionResult,
  KnowledgeSekbCaptureTrajectoryResult,
  KnowledgeSekbCaptureTrajectoryPayload,
  KnowledgeSekbRetrieveForTaskResult,
  KnowledgeSekbRetrieveForTaskPayload,
  KnowledgeSekbRejectSuggestionPayload,
  KnowledgeSekbConfirmPrincipleResult,
  KnowledgeSekbConfirmPrinciplePayload,
  KnowledgeSekbBatchDistillSuggestResult,
  KnowledgeSekbBatchDistillSuggestPayload,
  KnowledgeErrorGuardAdvisory,
  KnowledgeErrorGuardSignal,
  KnowledgeMatchErrorExperienceResult,
  KnowledgeQualityMetric,
  KnowledgeQualityMetrics,
  KnowledgeRetrievalDiagnostics,
  KnowledgeSearchResult,
  KnowledgeSourceSet,
  KnowledgeSourceSetAnswerSource,
  KnowledgeSourceSetResult,
  KnowledgeStewardTriage,
  KnowledgeStewardTriageAction,
  KnowledgeStewardConfig,
  KnowledgeStewardConfigGetResult,
  KnowledgeStewardConfigUpdatePayload,
  KnowledgeStewardConfigUpdateResult,
  KnowledgeRolePlayerConfig,
  KnowledgeRoleRegistryFile,
  KnowledgeStewardReviewResult,
  KnowledgeStatusResult,
  LocalControlPlaneCorrelationFilter,
  LocalControlPlaneCorrelationsResult,
  LocalControlPlaneCorrelationSummary,
  LocalControlPlaneReport,
  LocalControlPlaneReportFilter,
  LocalControlPlaneReportsResult,
  LocalControlPlaneStatus,
  LocalControlPlaneStatusResult,
  LocalSkillsResult,
  LogContentResult,
  LogDirResult,
  OpenClawCliCommandResult,
  OpenClawDoctorResult,
  OpenClawStatusResult,
  PermissionApprovalDecisionResult,
  PermissionApprovalListResult,
  PermissionDecisionEventListResult,
  SandboxDetectProvidersResult,
  SandboxExplainResult,
  SandboxStatusResult,
  SandboxUpdateProfileResult,
  ProviderAccountKeyInfo,
  ProviderDefaultAccountResult,
  ProviderModelListResult,
  ProviderValidationResult,
  SessionCompactionHistoryResult,
  SessionCompactionResult,
  SessionCompactionStatus,
  SessionCompactionStatusResult,
  SessionCheckpointDiffResult,
  SessionForkResult,
  SessionHandoffResult,
  SessionHistoryResult,
  SessionLabelSummary,
  SessionLongTaskControlHistoryResult,
  SessionLongTaskControlStatusResult,
  SessionQueueDrainResult,
  SessionResumeCheckpointsResult,
  SessionRestoreCheckpointPayload,
  SessionRestoreCheckpointResult,
  SessionSummariesResult,
  SettingsResetResult,
  SettingsSnapshot,
  SkillConfigsResult,
  SkillsStatusResult,
  StagedFileResult,
  TaskLedgerExportHtmlResult,
  TaskLedgerSnapshotResult,
  PromptCacheRiskAssessment,
  RemoteForgeCapabilitiesResult,
  RemoteForgeContentReadPayload,
  RemoteForgeContentReadResult,
  RemoteForgeMergePayload,
  RemoteForgeMergeResult,
  RemoteForgeMutationPayload,
  RemoteForgeMutationResult,
  RemoteForgePullRequestReadPayload,
  RemoteForgePullRequestReadResult,
  RemoteForgeRepositoryPayload,
  UsageHistoryEntry,
  WorkspaceActiveResult,
  WorkspaceContextRangeResult,
  WorkspaceLiveUsageResult,
  WorkspaceSnapshotResult,
  WorkspaceTerminalRunResult,
  WorkspaceTerminalSessionResult,
  WorkspaceWebPreviewDetectResult,
  WorkspaceWebPreviewResult,
  GitCapabilitiesResult,
  GitStatusResult,
  GitDiffListResult,
  GitFileDiffResult,
  GitBranchListResult,
  GitLogPayload,
  GitLogResult,
  GitReflogPayload,
  GitReflogResult,
  GitStashListResult,
  GitWorktreeListResult,
  GitOperationResult,
  GitCommitResult,
  GithubAuthStatusResult,
  GithubRepoResult,
  GithubPrListResult,
  GithubPrViewResult,
  GithubPrCreateResult,
  SystemInfoResult,
  SystemScanCategory,
  SystemScanItem,
  SystemScanResult,
  SystemScanPayload,
  SystemDeleteItemsPayload,
  SystemDeleteItemsResult,
} from '@shared/host-api/contract';

export const hostApi = {
  app: {
    version: () => invokeHost('app', 'version'),
    openClawDoctor: async (mode: OpenClawDoctorMode): Promise<OpenClawDoctorResult> => ({
      ...(await invokeHost('app', 'openClawDoctor', { mode })),
      mode,
    }),
  },
  openclaw: {
    status: () => invokeHost('openclaw', 'status'),
    getSkillsDir: () => invokeHost('openclaw', 'getSkillsDir'),
    getCliCommand: () => invokeHost('openclaw', 'getCliCommand'),
    runtimeFlags: () => invokeHost('openclaw', 'runtimeFlags'),
  },
  shell: {
    openExternal: (url: string) => invokeHost('shell', 'openExternal', { url } satisfies ShellOpenExternalPayload),
    showItemInFolder: (path: string) => invokeHost('shell', 'showItemInFolder', { path } satisfies ShellPathPayload),
    openPath: (path: string) => invokeHost('shell', 'openPath', { path } satisfies ShellPathPayload),
  },
  dialog: {
    open: (input: DialogOpenPayload) => invokeHost('dialog', 'open', input),
    message: (input: DialogMessagePayload) => invokeHost('dialog', 'message', input),
  },
  window: {
    syncTrafficLightPosition: (sidebarCollapsed: boolean) => (
      invokeHost('window', 'syncTrafficLightPosition', { sidebarCollapsed })
    ),
    minimize: () => invokeHost('window', 'minimize'),
    maximize: () => invokeHost('window', 'maximize'),
    close: () => invokeHost('window', 'close'),
    isMaximized: () => invokeHost('window', 'isMaximized'),
  },
  updates: {
    check: () => invokeHost('updates', 'check'),
    download: () => invokeHost('updates', 'download'),
    install: () => invokeHost('updates', 'install'),
  },
  uv: {
    installAll: () => invokeHost('uv', 'installAll'),
  },
  vtoken: {
    ping: () => invokeHost('vtoken', 'ping'),
    open: (payload?: VtokenOpenPayload) => invokeHost('vtoken', 'open', payload),
    ingestPath: (payload: VtokenIngestPathPayload) => invokeHost('vtoken', 'ingestPath', payload),
    ingestMarkdown: (payload: VtokenIngestMarkdownPayload) => invokeHost('vtoken', 'ingestMarkdown', payload),
    ingestTools: (payload: VtokenIngestToolsPayload) => invokeHost('vtoken', 'ingestTools', payload),
    ingestMemory: (payload: VtokenIngestMemoryPayload) => invokeHost('vtoken', 'ingestMemory', payload),
    assemble: (payload: VtokenAssemblePayload) => invokeHost('vtoken', 'assemble', payload),
    stats: () => invokeHost('vtoken', 'stats'),
    close: () => invokeHost('vtoken', 'close'),
    getStatus: () => invokeHost('vtoken', 'getStatus'),
    setEnabled: (payload: VtokenSetEnabledPayload) => invokeHost('vtoken', 'setEnabled', payload),
    ensureStarted: () => invokeHost('vtoken', 'ensureStarted'),
  },
  dcsProdFlags: {
    getFlags: (): Promise<DcsProdFlagsSnapshot> => invokeHost('dcsProdFlags', 'getFlags'),
    setFlag: (payload: DcsProdFlagSetPayload) => invokeHost('dcsProdFlags', 'setFlag', payload),
    requeryAck: () => invokeHost('dcsProdFlags', 'requeryAck'),
    getPreview: () => invokeHost('dcsProdFlags', 'getPreview'),
    setPreview: (payload: { enabled: boolean; restartGateway?: boolean }) => (
      invokeHost('dcsProdFlags', 'setPreview', payload)
    ),
  },
  settings: {
    getAll: () => invokeHost('settings', 'getAll'),
    get: (key: SettingsKey) => invokeHost('settings', 'get', { key }),
    set: (key: SettingsKey, value: SettingsValue) => invokeHost('settings', 'set', { key, value }),
    setMany: (patch: Partial<SettingsSnapshot>) => (
      invokeHost('settings', 'setMany', { patch })
    ),
    reset: () => invokeHost('settings', 'reset'),
  },
  workspaces: {
    list: () => invokeHost('workspaces', 'list'),
    getActive: () => invokeHost('workspaces', 'getActive'),
    create: (input: WorkspaceCreatePayload) => invokeHost('workspaces', 'create', input),
    update: (id: string, input: Omit<WorkspaceUpdatePayload, 'id'>) => (
      invokeHost('workspaces', 'update', { id, ...input })
    ),
    delete: (id: string) => invokeHost('workspaces', 'delete', { id }),
    switch: (id: string) => invokeHost('workspaces', 'switch', { id }),
    preflight: (rootPath: string) => invokeHost('workspaces', 'preflight', { rootPath }),
    saveState: (input: WorkspaceSaveStatePayload) => invokeHost('workspaces', 'saveState', input),
    createFolder: (input: WorkspaceFolderCreatePayload) => (
      invokeHost('workspaces', 'createFolder', input)
    ),
    renameFolder: (input: WorkspaceFolderRenamePayload) => (
      invokeHost('workspaces', 'renameFolder', input)
    ),
    deleteFolder: (input: WorkspaceFolderDeletePayload) => (
      invokeHost('workspaces', 'deleteFolder', input)
    ),
    moveSessionToFolder: (input: WorkspaceFolderMoveSessionPayload) => (
      invokeHost('workspaces', 'moveSessionToFolder', input)
    ),
  },
  projectRules: {
    snapshot: () => invokeHost('projectRules', 'snapshot'),
    createAgentsTemplate: () => invokeHost('projectRules', 'createAgentsTemplate'),
  },
  terminal: {
    run: (input: WorkspaceTerminalRunPayload) => invokeHost('terminal', 'run', input),
    open: (input?: WorkspaceTerminalOpenPayload) => invokeHost('terminal', 'open', input),
    write: (input: WorkspaceTerminalWritePayload) => invokeHost('terminal', 'write', input),
    resize: (input: WorkspaceTerminalResizePayload) => invokeHost('terminal', 'resize', input),
    interrupt: (input: WorkspaceTerminalSessionPayload) => invokeHost('terminal', 'interrupt', input),
    close: (input: WorkspaceTerminalSessionPayload) => invokeHost('terminal', 'close', input),
    status: (input?: WorkspaceTerminalStatusPayload) => invokeHost('terminal', 'status', input),
    list: (input?: WorkspaceTerminalListPayload) => invokeHost('terminal', 'list', input),
  },
  sessionActivity: {
    snapshot: (input: SessionActivitySnapshotPayload) => invokeHost('sessionActivity', 'snapshot', input),
  },
  git: {
    capabilities: (): Promise<GitCapabilitiesResult> => invokeHost('git', 'capabilities'),
    status: (): Promise<GitStatusResult> => invokeHost('git', 'status'),
    diff: (input?: { mode?: 'unstaged' | 'staged' }): Promise<GitDiffListResult> => invokeHost('git', 'diff', input),
    fileDiff: (input: GitFileDiffPayload): Promise<GitFileDiffResult> => invokeHost('git', 'fileDiff', input),
    applyPatch: (input: GitApplyPatchPayload): Promise<GitApplyPatchResult> => invokeHost('git', 'applyPatch', input),
    diffToBase: (input?: GitDiffToBasePayload): Promise<GitDiffToBaseResult> => invokeHost('git', 'diffToBase', input),
    stage: (input: GitPathsPayload): Promise<GitOperationResult> => invokeHost('git', 'stage', input),
    unstage: (input: GitPathsPayload): Promise<GitOperationResult> => invokeHost('git', 'unstage', input),
    revertFile: (input: GitPathPayload): Promise<GitOperationResult> => invokeHost('git', 'revertFile', input),
    commit: (input: GitCommitPayload): Promise<GitCommitResult> => invokeHost('git', 'commit', input),
    branches: (): Promise<GitBranchListResult> => invokeHost('git', 'branches'),
    log: (input?: GitLogPayload): Promise<GitLogResult> => invokeHost('git', 'log', input),
    reflog: (input?: GitReflogPayload): Promise<GitReflogResult> => invokeHost('git', 'reflog', input),
    mergeBase: (input: GitMergeBasePayload): Promise<GitMergeBaseResult> => invokeHost('git', 'mergeBase', input),
    checkoutBranch: (input: GitBranchCheckoutPayload): Promise<GitOperationResult> => invokeHost('git', 'checkoutBranch', input),
    createBranch: (input: GitBranchCreatePayload): Promise<GitOperationResult> => invokeHost('git', 'createBranch', input),
    stashList: (): Promise<GitStashListResult> => invokeHost('git', 'stashList'),
    stashPush: (input?: GitStashPayload): Promise<GitOperationResult> => invokeHost('git', 'stashPush', input),
    stashApply: (input: GitStashRefPayload): Promise<GitOperationResult> => invokeHost('git', 'stashApply', input),
    stashPop: (input: GitStashRefPayload): Promise<GitOperationResult> => invokeHost('git', 'stashPop', input),
    worktrees: (): Promise<GitWorktreeListResult> => invokeHost('git', 'worktrees'),
    worktreeAdd: (input: GitWorktreeAddPayload): Promise<GitOperationResult> => invokeHost('git', 'worktreeAdd', input),
    worktreeRemove: (input: GitPathPayload): Promise<GitOperationResult> => invokeHost('git', 'worktreeRemove', input),
    worktreePrune: (input?: { approvalId?: string }): Promise<GitOperationResult> => invokeHost('git', 'worktreePrune', input),
    fetch: (input?: GitFetchPayload): Promise<GitOperationResult> => invokeHost('git', 'fetch', input),
    pull: (input?: GitPullPayload): Promise<GitOperationResult> => invokeHost('git', 'pull', input),
    push: (input?: GitPushPayload): Promise<GitOperationResult> => invokeHost('git', 'push', input),
    merge: (input: GitMergePayload): Promise<GitOperationResult> => invokeHost('git', 'merge', input),
    rebase: (input: GitRebasePayload): Promise<GitOperationResult> => invokeHost('git', 'rebase', input),
    reset: (input?: GitResetPayload): Promise<GitOperationResult> => invokeHost('git', 'reset', input),
    githubAuthStatus: (): Promise<GithubAuthStatusResult> => invokeHost('git', 'githubAuthStatus'),
    githubRepo: (): Promise<GithubRepoResult> => invokeHost('git', 'githubRepo'),
    prList: (input?: GithubPrListPayload): Promise<GithubPrListResult> => invokeHost('git', 'prList', input),
    prView: (input: GithubPrViewPayload): Promise<GithubPrViewResult> => invokeHost('git', 'prView', input),
    prCreate: (input: GithubPrCreateInput): Promise<GithubPrCreateResult> => invokeHost('git', 'prCreate', input),
    openPr: (input: GithubPrOpenPayload): Promise<GitOperationResult> => invokeHost('git', 'openPr', input),
  },
  permissions: {
    approvals: (input?: PermissionApprovalListPayload) => invokeHost('permissions', 'approvals', input),
    decisionEvents: (input?: PermissionDecisionEventListPayload): Promise<PermissionDecisionEventListResult> => (
      invokeHost('permissions', 'decisionEvents', input)
    ),
    decideApproval: (input: PermissionApprovalDecisionPayload) => (
      invokeHost('permissions', 'decideApproval', input)
    ),
  },
  orchestrationPresets: {
    list: (input?: OrchestrationPresetListPayload) => (
      invokeHost('orchestrationPresets', 'list', input)
    ),
    create: (input: OrchestrationPresetCreatePayload) => (
      invokeHost('orchestrationPresets', 'create', input)
    ),
    revoke: (input: OrchestrationPresetRevokePayload) => (
      invokeHost('orchestrationPresets', 'revoke', input)
    ),
  },
  webPreview: {
    detect: (input?: WorkspaceWebPreviewDetectPayload) => invokeHost('webPreview', 'detect', input),
    start: (input?: WorkspaceWebPreviewStartPayload) => invokeHost('webPreview', 'start', input),
    startStatic: (input?: WorkspaceWebPreviewStartPayload) => invokeHost('webPreview', 'startStatic', input),
    stop: (input?: WorkspaceWebPreviewStopPayload) => invokeHost('webPreview', 'stop', input),
    status: (input?: WorkspaceWebPreviewStatusPayload) => invokeHost('webPreview', 'status', input),
  },
  gateway: {
    status: () => invokeHost('gateway', 'status'),
    start: () => invokeHost('gateway', 'start'),
    stop: () => invokeHost('gateway', 'stop'),
    restart: () => invokeHost('gateway', 'restart'),
    health: (probe = false) => invokeHost('gateway', 'health', { probe }),
    controlUi: (viewOrPayload?: 'dreams' | { view?: 'dreams'; open?: boolean }) => {
      const payload = typeof viewOrPayload === 'string'
        ? { view: viewOrPayload }
        : (viewOrPayload ?? {});
      return invokeHost('gateway', 'controlUi', payload);
    },
    copyGatewayToken: () => invokeHost('gateway', 'copyGatewayToken'),
    rpc: <T = unknown>(method: string, params?: unknown, timeoutMs?: number, approvalId?: string) => (
      invokeHost('gateway', 'rpc', { method, params, timeoutMs, approvalId }) as Promise<T>
    ),
  },
  localControlPlane: {
    status: (): Promise<LocalControlPlaneStatusResult> => invokeHost('localControlPlane', 'status'),
    reports: (input?: LocalControlPlaneReportFilter): Promise<LocalControlPlaneReportsResult> => (
      invokeHost('localControlPlane', 'reports', input)
    ),
    correlations: (input?: LocalControlPlaneCorrelationFilter): Promise<LocalControlPlaneCorrelationsResult> => (
      invokeHost('localControlPlane', 'correlations', input)
    ),
  },
  capabilities: {
    publications: (input?: CapabilityPublicationQuery): Promise<CapabilityPublicationResult> => (
      invokeHost('capabilities', 'publications', input)
    ),
  },
  remoteControl: {
    status: () => invokeHost('remoteControl', 'status'),
    inspect: () => invokeHost('remoteControl', 'inspect'),
    pageInfo: (input?: RemoteControlTargetPayload) => invokeHost('remoteControl', 'pageInfo', input),
    evaluate: (input: RemoteControlEvaluatePayload) => invokeHost('remoteControl', 'evaluate', input),
    click: (input: RemoteControlClickPayload) => invokeHost('remoteControl', 'click', input),
    scroll: (input?: RemoteControlScrollPayload) => invokeHost('remoteControl', 'scroll', input),
    screenshot: (input?: RemoteControlScreenshotPayload) => invokeHost('remoteControl', 'screenshot', input),
  },
  agentBrowser: {
    open: (input?: AgentBrowserOpenPayload): Promise<AgentBrowserSessionResult> =>
      invokeHost('agentBrowser', 'open', input),
    status: (): Promise<AgentBrowserStatusResult> => invokeHost('agentBrowser', 'status'),
    setEnabled: (input: AgentBrowserSetEnabledPayload): Promise<AgentBrowserSetEnabledResult> =>
      invokeHost('agentBrowser', 'setEnabled', input),
    profiles: (): Promise<AgentBrowserProfilesResult> => invokeHost('agentBrowser', 'profiles'),
    saveProfile: (input: AgentBrowserProfileSavePayload): Promise<AgentBrowserProfileSaveResult> =>
      invokeHost('agentBrowser', 'saveProfile', input),
    validate: (input?: AgentBrowserValidatePayload): Promise<AgentBrowserValidateResult> =>
      invokeHost('agentBrowser', 'validate', input),
    navigate: (input: AgentBrowserNavigatePayload): Promise<AgentBrowserActionResult> =>
      invokeHost('agentBrowser', 'navigate', input),
    focus: (input: AgentBrowserSessionPayload): Promise<AgentBrowserActionResult> =>
      invokeHost('agentBrowser', 'focus', input),
    waitForSelector: (input: AgentBrowserSelectorPayload): Promise<AgentBrowserActionResult> =>
      invokeHost('agentBrowser', 'waitForSelector', input),
    click: (input: AgentBrowserClickPayload): Promise<AgentBrowserActionResult> =>
      invokeHost('agentBrowser', 'click', input),
    type: (input: AgentBrowserTypePayload): Promise<AgentBrowserActionResult> =>
      invokeHost('agentBrowser', 'type', input),
    evaluate: (input: AgentBrowserEvaluatePayload): Promise<AgentBrowserEvaluateResult> =>
      invokeHost('agentBrowser', 'evaluate', input),
    screenshot: (input: AgentBrowserScreenshotPayload): Promise<AgentBrowserScreenshotResult> =>
      invokeHost('agentBrowser', 'screenshot', input),
    command: (input: AgentBrowserCommandPayload): Promise<AgentBrowserCommandResult> =>
      invokeHost('agentBrowser', 'command', input),
    tasks: (): Promise<AgentBrowserTasksResult> => invokeHost('agentBrowser', 'tasks'),
    createTask: (input: AgentBrowserTaskCreatePayload): Promise<AgentBrowserTaskResult> =>
      invokeHost('agentBrowser', 'createTask', input),
    runTask: (input: AgentBrowserTaskPayload): Promise<AgentBrowserTaskResult> =>
      invokeHost('agentBrowser', 'runTask', input),
    retryTask: (input: AgentBrowserTaskPayload): Promise<AgentBrowserTaskResult> =>
      invokeHost('agentBrowser', 'retryTask', input),
    cancelTask: (input: AgentBrowserTaskPayload): Promise<AgentBrowserTaskResult> =>
      invokeHost('agentBrowser', 'cancelTask', input),
    requestTaskApproval: (input: AgentBrowserTaskPayload): Promise<AgentBrowserTaskResult> =>
      invokeHost('agentBrowser', 'requestTaskApproval', input),
    approveTask: (input: AgentBrowserTaskPayload): Promise<AgentBrowserTaskResult> =>
      invokeHost('agentBrowser', 'approveTask', input),
    rejectTask: (input: AgentBrowserTaskPayload): Promise<AgentBrowserTaskResult> =>
      invokeHost('agentBrowser', 'rejectTask', input),
    show: (input: AgentBrowserSessionPayload): Promise<AgentBrowserActionResult> =>
      invokeHost('agentBrowser', 'show', input),
    hide: (input: AgentBrowserSessionPayload): Promise<AgentBrowserActionResult> =>
      invokeHost('agentBrowser', 'hide', input),
    vault: (): Promise<AgentBrowserVaultResult> => invokeHost('agentBrowser', 'vault'),
    vaultHealth: (): Promise<AgentBrowserVaultHealthResult> => invokeHost('agentBrowser', 'vaultHealth'),
    saveCredential: (input: AgentBrowserCredentialSavePayload): Promise<AgentBrowserCredentialResult> =>
      invokeHost('agentBrowser', 'saveCredential', input),
    deleteCredential: (input: AgentBrowserCredentialPayload) =>
      invokeHost('agentBrowser', 'deleteCredential', input),
    close: (input: AgentBrowserSessionPayload) => invokeHost('agentBrowser', 'close', input),
    takeSnapshot: (input: AgentBrowserTakeSnapshotPayload): Promise<AgentBrowserTakeSnapshotResult> =>
      invokeHost('agentBrowser', 'takeSnapshot', input),
    clickByUid: (input: AgentBrowserClickByUidPayload): Promise<AgentBrowserActionResult> =>
      invokeHost('agentBrowser', 'clickByUid', input),
    fillByUid: (input: AgentBrowserFillByUidPayload): Promise<AgentBrowserActionResult> =>
      invokeHost('agentBrowser', 'fillByUid', input),
    pressKey: (input: AgentBrowserPressKeyPayload): Promise<AgentBrowserActionResult> =>
      invokeHost('agentBrowser', 'pressKey', input),
    requestModeUpgrade: (input: AgentBrowserRequestModeUpgradePayload): Promise<AgentBrowserRequestModeUpgradeResult> =>
      invokeHost('agentBrowser', 'requestModeUpgrade', input),
    respondBoundaryChoice: (input: AgentBrowserRespondBoundaryChoicePayload): Promise<AgentBrowserRespondBoundaryChoiceResult> =>
      invokeHost('agentBrowser', 'respondBoundaryChoice', input),
    networkListRequests: (input: AgentBrowserNetworkListPayload): Promise<AgentBrowserNetworkListResult> =>
      invokeHost('agentBrowser', 'networkListRequests', input),
    networkGetRequestDetails: (input: AgentBrowserNetworkDetailPayload): Promise<AgentBrowserNetworkDetailResult> =>
      invokeHost('agentBrowser', 'networkGetRequestDetails', input),
    networkClearRequests: (input: AgentBrowserNetworkClearPayload): Promise<AgentBrowserNetworkClearResult> =>
      invokeHost('agentBrowser', 'networkClearRequests', input),
    networkWaitForRequests: (input: AgentBrowserNetworkWaitPayload): Promise<AgentBrowserNetworkWaitResult> =>
      invokeHost('agentBrowser', 'networkWaitForRequests', input),
    networkCompareRequests: (input: AgentBrowserNetworkComparePayload): Promise<AgentBrowserNetworkCompareResult> =>
      invokeHost('agentBrowser', 'networkCompareRequests', input),
    networkFindParameterCandidates: (input: AgentBrowserNetworkFindParamsPayload): Promise<AgentBrowserNetworkFindParamsResult> =>
      invokeHost('agentBrowser', 'networkFindParameterCandidates', input),
    networkExtractJsCandidates: (input: AgentBrowserNetworkExtractJsPayload): Promise<AgentBrowserNetworkExtractJsResult> =>
      invokeHost('agentBrowser', 'networkExtractJsCandidates', input),
    newPage: (input: AgentBrowserNewPagePayload): Promise<AgentBrowserListPagesResult> =>
      invokeHost('agentBrowser', 'newPage', input),
    listPages: (input: AgentBrowserSessionPayload): Promise<AgentBrowserListPagesResult> =>
      invokeHost('agentBrowser', 'listPages', input),
    selectPage: (input: AgentBrowserSelectPagePayload): Promise<AgentBrowserListPagesResult> =>
      invokeHost('agentBrowser', 'selectPage', input),
    closePage: (input: AgentBrowserClosePagePayload): Promise<AgentBrowserListPagesResult> =>
      invokeHost('agentBrowser', 'closePage', input),
    navigatePage: (input: AgentBrowserNavigatePagePayload): Promise<AgentBrowserListPagesResult> =>
      invokeHost('agentBrowser', 'navigatePage', input),
    jsListResources: (input: AgentBrowserJsListResourcesPayload): Promise<AgentBrowserJsListResourcesResult> =>
      invokeHost('agentBrowser', 'jsListResources', input),
    jsSearchSources: (input: AgentBrowserJsSearchSourcesPayload): Promise<AgentBrowserJsSearchSourcesResult> =>
      invokeHost('agentBrowser', 'jsSearchSources', input),
    jsExtractContext: (input: AgentBrowserJsExtractContextPayload): Promise<AgentBrowserJsExtractContextResult> =>
      invokeHost('agentBrowser', 'jsExtractContext', input),
    sourceMapListCandidates: (input: AgentBrowserSourceMapListCandidatesPayload): Promise<AgentBrowserSourceMapListCandidatesResult> =>
      invokeHost('agentBrowser', 'sourceMapListCandidates', input),
    sourceMapResolveLocation: (input: AgentBrowserSourceMapResolveLocationPayload): Promise<AgentBrowserSourceMapResolveLocationResult> =>
      invokeHost('agentBrowser', 'sourceMapResolveLocation', input),
    sourceMapExtractOriginalContext: (input: AgentBrowserSourceMapExtractOriginalContextPayload): Promise<AgentBrowserSourceMapExtractOriginalContextResult> =>
      invokeHost('agentBrowser', 'sourceMapExtractOriginalContext', input),
    runtimeInspectGlobals: (input: AgentBrowserRuntimeInspectGlobalsPayload): Promise<AgentBrowserRuntimeInspectGlobalsResult> =>
      invokeHost('agentBrowser', 'runtimeInspectGlobals', input),
    runtimeSearchModules: (input: AgentBrowserRuntimeSearchModulesPayload): Promise<AgentBrowserRuntimeSearchModulesResult> =>
      invokeHost('agentBrowser', 'runtimeSearchModules', input),
    runtimeDescribeFunction: (input: AgentBrowserRuntimeDescribeFunctionPayload): Promise<AgentBrowserRuntimeDescribeFunctionResult> =>
      invokeHost('agentBrowser', 'runtimeDescribeFunction', input),
    replayPrepareRequest: (input: AgentBrowserReplayPrepareRequestPayload): Promise<AgentBrowserReplayPrepareRequestResult> =>
      invokeHost('agentBrowser', 'replayPrepareRequest', input),
    replaySendRequest: (input: AgentBrowserReplaySendRequestPayload): Promise<AgentBrowserReplaySendRequestResult> =>
      invokeHost('agentBrowser', 'replaySendRequest', input),
    replayCompareResponses: (input: AgentBrowserReplayCompareResponsesPayload): Promise<AgentBrowserReplayCompareResponsesResult> =>
      invokeHost('agentBrowser', 'replayCompareResponses', input),
    getConsoleMessages: (input: AgentBrowserConsoleMessagesPayload): Promise<AgentBrowserConsoleMessagesResult> =>
      invokeHost('agentBrowser', 'getConsoleMessages', input),
    fullAccessExecuteScript: (input: AgentBrowserFullAccessExecuteScriptPayload): Promise<AgentBrowserFullAccessExecuteScriptResult> =>
      invokeHost('agentBrowser', 'fullAccessExecuteScript', input),
    fullAccessFetch: (input: AgentBrowserFullAccessFetchPayload): Promise<AgentBrowserFullAccessFetchResult> =>
      invokeHost('agentBrowser', 'fullAccessFetch', input),
    fullAccessGetNetworkDetails: (input: AgentBrowserFullAccessGetNetworkDetailsPayload): Promise<AgentBrowserFullAccessGetNetworkDetailsResult> =>
      invokeHost('agentBrowser', 'fullAccessGetNetworkDetails', input),
    fullAccessReadStorage: (input: AgentBrowserFullAccessReadStoragePayload): Promise<AgentBrowserFullAccessReadStorageResult> =>
      invokeHost('agentBrowser', 'fullAccessReadStorage', input),
    fullAccessRevoke: (input: AgentBrowserFullAccessRevokePayload): Promise<AgentBrowserFullAccessRevokeResult> =>
      invokeHost('agentBrowser', 'fullAccessRevoke', input),
    extractPageText: (input: AgentBrowserExtractPageTextPayload): Promise<AgentBrowserExtractPageTextResult> =>
      invokeHost('agentBrowser', 'extractPageText', input),
    validateExtractionRule: (input: AgentBrowserValidateExtractionRulePayload): Promise<AgentBrowserValidateExtractionRuleResult> =>
      invokeHost('agentBrowser', 'validateExtractionRule', input),
  },
  mcp: {
    listServers: () => invokeHost('mcp', 'listServers'),
    createServer: (input: McpServerCreatePayload) => invokeHost('mcp', 'createServer', input),
    updateServer: (input: McpServerUpdatePayload) => invokeHost('mcp', 'updateServer', input),
    deleteServer: (input: McpServerDeletePayload) => invokeHost('mcp', 'deleteServer', input),
    testServer: (input: McpServerTestPayload) => invokeHost('mcp', 'testServer', input),
    resolveForContext: (input: McpServerResolvePayload) => invokeHost('mcp', 'resolveForContext', input),
    listTools: (input: McpListToolsPayload) => invokeHost('mcp', 'listTools', input),
    callTool: (input: McpCallToolPayload) => invokeHost('mcp', 'callTool', input),
    reloadRuntime: (input?: McpReloadRuntimePayload) => invokeHost('mcp', 'reloadRuntime', input),
    heartbeat: (input: McpHeartbeatPayload) => invokeHost('mcp', 'heartbeat', input),
  },
  sandbox: {
    status: (): Promise<SandboxStatusResult> => invokeHost('sandbox', 'status'),
    detectProviders: (): Promise<SandboxDetectProvidersResult> => invokeHost('sandbox', 'detectProviders'),
    updateProfile: (input: SandboxUpdateProfilePayload): Promise<SandboxUpdateProfileResult> => (
      invokeHost('sandbox', 'updateProfile', input)
    ),
    explain: (input?: SandboxExplainPayload): Promise<SandboxExplainResult> => (
      invokeHost('sandbox', 'explain', input)
    ),
  },
  logs: {
    recent: (tailLines = 100) => invokeHost('logs', 'recent', { tailLines }),
    memory: (input?: LogMemoryPayload) => invokeHost('logs', 'memory', input),
    dir: () => invokeHost('logs', 'dir'),
    filePath: () => invokeHost('logs', 'filePath'),
    listFiles: () => invokeHost('logs', 'listFiles'),
    readFile: (path: string, tailLines?: number) => (
      invokeHost('logs', 'readFile', { path, tailLines })
    ),
  },
  system: {
    info: () => invokeHost('system', 'info'),
    scan: (input?: SystemScanPayload) => invokeHost('system', 'scan', input),
    deleteItems: (input: SystemDeleteItemsPayload) => invokeHost('system', 'deleteItems', input),
  },
  resourceTracker: {
    list: () => invokeHost('resourceTracker', 'list'),
    stop: (resourceId: string) => invokeHost('resourceTracker', 'stop', { resourceId }),
    stopAll: () => invokeHost('resourceTracker', 'stopAll'),
  },
  /**
   * Area 4 §3.3: typed memory facade. Additive — `hostApi.gateway.rpc('memory.*')`
   * keeps working; callers migrate incrementally.
   */
  memory: {
    list: (input: MemoryListPayload) => invokeHost('memory', 'list', input),
    search: (input: MemorySearchPayload) => invokeHost('memory', 'search', input),
    detail: (input: MemoryDetailPayload) => invokeHost('memory', 'detail', input),
    previewProposal: (input: MemoryProposal): Promise<MemoryProposalPreviewResult> =>
      invokeHost('memory', 'previewProposal', input),
    propose: (input: MemoryProposal) => invokeHost('memory', 'propose', input),
    update: (input: MemoryUpdatePayload) => invokeHost('memory', 'update', input),
    health: () => invokeHost('memory', 'health'),
    explainInjection: (input: MemoryExplainInjectionPayload) =>
      invokeHost('memory', 'explainInjection', input),
  },
  channels: {
    accounts: (options?: ChannelAccountsPayload) => (
      invokeHost('channels', 'accounts', options)
    ),
    targets: (input: ChannelTargetsPayload) => (
      invokeHost('channels', 'targets', input)
    ),
    configured: () => invokeHost('channels', 'configured'),
    setDefaultAccount: (input: ChannelRequiredAccountPayload) => (
      invokeHost('channels', 'setDefaultAccount', input)
    ),
    bindingSave: (input: ChannelBindingSavePayload) => (
      invokeHost('channels', 'bindingSave', input)
    ),
    bindingDelete: (input: ChannelBindingDeletePayload) => (
      invokeHost('channels', 'bindingDelete', input)
    ),
    validateConfig: (input: ChannelTypePayload) => (
      invokeHost('channels', 'validateConfig', input)
    ),
    formValues: (channelType: string, accountId?: string) => (
      invokeHost('channels', 'formValues', { channelType, accountId })
    ),
    saveConfig: (input: ChannelSaveConfigPayload) => invokeHost('channels', 'saveConfig', input),
    setEnabled: (input: ChannelSetEnabledPayload) => (
      invokeHost('channels', 'setEnabled', input)
    ),
    deleteConfig: (channelType: string, accountId?: string) => (
      invokeHost('channels', 'deleteConfig', { channelType, accountId })
    ),
    validateCredentials: (channelType: string, config: Record<string, unknown>) => (
      invokeHost('channels', 'validateCredentials', { channelType, config })
    ),
    saveBinding: (input: { channelType: string; accountId: string; agentId: string }) => (
      invokeHost('channels', 'bindingSave', input)
    ),
    deleteBinding: (input: { channelType: string; accountId?: string }) => (
      invokeHost('channels', 'bindingDelete', input)
    ),
    startLogin: (channelType: string, input?: { accountId?: string }) => (
      invokeHost('channels', 'startLogin', { channelType, ...input })
    ),
    cancelLogin: (channelType: string, input?: { accountId?: string }) => (
      invokeHost('channels', 'cancelLogin', { channelType, ...input })
    ),
  },
  agents: {
    list: () => invokeHost('agents', 'list'),
    create: (input: AgentCreatePayload) => invokeHost('agents', 'create', input),
    update: (id: string, input: Omit<AgentUpdatePayload, 'id'>) => (
      invokeHost('agents', 'update', {
        id,
        ...input,
      })
    ),
    updateModel: (id: string, modelRef: string | null) => (
      invokeHost('agents', 'updateModel', { id, modelRef })
    ),
    updateReasoningEffort: (id: string, reasoningEffort: AgentUpdateReasoningEffortPayload['reasoningEffort']) => (
      invokeHost('agents', 'updateReasoningEffort', { id, reasoningEffort })
    ),
    updateAvatar: (id: string, preset: AgentUpdateAvatarPayload['preset']) => (
      invokeHost('agents', 'updateAvatar', { id, preset })
    ),
    resetAvatar: (id: string) => invokeHost('agents', 'resetAvatar', { id }),
    getBootstrap: (id: string) => invokeHost('agents', 'getBootstrap', { id }),
    updateBootstrap: (input: AgentBootstrapUpdatePayload) => invokeHost('agents', 'updateBootstrap', input),
    delete: (id: string) => invokeHost('agents', 'delete', { id }),
    assignChannel: (id: string, channelType: string) => (
      invokeHost('agents', 'assignChannel', { id, channelType })
    ),
    removeChannel: (id: string, channelType: string) => (
      invokeHost('agents', 'removeChannel', { id, channelType })
    ),
  },
  roles: {
    upsertConfigRole: (input: RoleUpsertConfigRolePayload): Promise<RoleUpsertConfigRoleResult> => (
      invokeHost('roles', 'upsertConfigRole', input)
    ),
    agencyCatalog: (input: AgencyRoleSourcePayload): Promise<AgencyRoleListResult> => (
      invokeHost('roles', 'agencyCatalog', input)
    ),
    listAgencyPackages: (): Promise<AgencyRolePackageListResult> => (
      invokeHost('roles', 'listAgencyPackages')
    ),
    importAgencyPackage: (input: AgencyRolePackageImportPayload): Promise<AgencyRolePackageResult> => (
      invokeHost('roles', 'importAgencyPackage', input)
    ),
    refreshAgencyPackage: (input: AgencyRolePackageRefreshPayload): Promise<AgencyRolePackageResult> => (
      invokeHost('roles', 'refreshAgencyPackage', input)
    ),
    previewAgencyPromotion: (
      input: AgencyRoleReviewPayload,
    ): Promise<AgencyRolePromotionPreviewResult> => (
      invokeHost('roles', 'previewAgencyPromotion', input)
    ),
    previewAgencyMemoryProposals: (
      input: AgencyRoleMemoryProposalsPayload,
    ): Promise<AgencyRoleMemoryProposalsResult> => (
      invokeHost('roles', 'previewAgencyMemoryProposals', input)
    ),
    reviewAgencyPromotion: (
      input: AgencyRoleReviewPayload,
    ): Promise<AgencyRolePromotionResult> => (
      invokeHost('roles', 'reviewAgencyPromotion', input)
    ),
    approveAgencyPromotion: (
      input: AgencyRoleDecisionPayload,
    ): Promise<AgencyRolePromotionResult> => (
      invokeHost('roles', 'approveAgencyPromotion', input)
    ),
    retireAgencyPromotion: (
      input: AgencyRoleDecisionPayload,
    ): Promise<AgencyRolePromotionResult> => (
      invokeHost('roles', 'retireAgencyPromotion', input)
    ),
  },
  diagnostics: {
    gatewaySnapshot: () => invokeHost('diagnostics', 'gatewaySnapshot'),
    exportSupportBundle: () => invokeHost('diagnostics', 'exportSupportBundle'),
  },
  agentDev: {
    status: () => invokeHost('agentDev', 'status'),
    scenarios: () => invokeHost('agentDev', 'scenarios'),
    seedState: (input?: AgentDevSeedStatePayload): Promise<AgentDevSeedStateResult> => (
      invokeHost('agentDev', 'seedState', input)
    ),
    resetState: (): Promise<AgentDevSeedStateResult> => invokeHost('agentDev', 'resetState'),
    createConversation: (
      input: AgentDevCreateConversationPayload,
    ): Promise<AgentDevCreateConversationResult> => (
      invokeHost('agentDev', 'createConversation', input)
    ),
    createProviderConfig: (
      input: AgentDevCreateProviderConfigPayload,
    ): Promise<AgentDevCreateProviderConfigResult> => (
      invokeHost('agentDev', 'createProviderConfig', input)
    ),
    configureMockReplay: (input: AgentDevMockReplayConfig): Promise<AgentDevMockReplayResult> => (
      invokeHost('agentDev', 'configureMockReplay', input)
    ),
    hostApiCalls: (input?: AgentDevHostApiCallsPayload): Promise<AgentDevHostApiCallsResult> => (
      invokeHost('agentDev', 'hostApiCalls', input)
    ),
    featureFlags: (): Promise<AgentDevFeatureFlagsResult> => invokeHost('agentDev', 'featureFlags'),
    setFeatureFlags: (input: AgentDevFeatureFlagsPayload): Promise<AgentDevFeatureFlagsResult> => (
      invokeHost('agentDev', 'setFeatureFlags', input)
    ),
    visualPreset: (input?: AgentDevVisualPreset): Promise<AgentDevVisualPresetResult> => (
      invokeHost('agentDev', 'visualPreset', input)
    ),
    diagnosticsSnapshot: (): Promise<AgentDevDiagnosticsSnapshotResult> => (
      invokeHost('agentDev', 'diagnosticsSnapshot')
    ),
    transportTrace: (input?: AgentDevTransportTracePayload): Promise<AgentDevTransportTraceResult> => (
      invokeHost('agentDev', 'transportTrace', input)
    ),
    traceTimeline: (input?: AgentDevTraceTimelinePayload): Promise<AgentDevTraceTimelineResult> => (
      invokeHost('agentDev', 'traceTimeline', input)
    ),
    costReport: (): Promise<AgentDevCostReportResult> => invokeHost('agentDev', 'costReport'),
    skillSandboxReport: (): Promise<AgentDevSkillSandboxReportResult> => (
      invokeHost('agentDev', 'skillSandboxReport')
    ),
    workbenchEvidence: (): Promise<AgentDevWorkbenchEvidenceResult> => invokeHost('agentDev', 'workbenchEvidence'),
    recordScenario: (input?: AgentDevRecordScenarioPayload): Promise<AgentDevRecordScenarioResult> => (
      invokeHost('agentDev', 'recordScenario', input)
    ),
    selectorContract: (): Promise<AgentDevSelectorContractResult> => invokeHost('agentDev', 'selectorContract'),
  },
  providers: {
    list: () => invokeHost('providers', 'list'),
    get: (providerId: string) => invokeHost('providers', 'get', { providerId }),
    getDefault: () => invokeHost('providers', 'getDefault'),
    hasApiKey: (providerId: string) => (
      invokeHost('providers', 'hasApiKey', { providerId })
    ),
    validateKey: (input: ProviderValidationPayload) => invokeHost('providers', 'validateKey', input),
    listModels: (input: ProviderModelListPayload): Promise<ProviderModelListResult> => (
      invokeHost('providers', 'listModels', input)
    ),
    save: (input: { config: ProviderConfig; apiKey?: string }) => invokeHost('providers', 'save', input),
    delete: (providerId: string) => invokeHost('providers', 'delete', { providerId }),
    setApiKey: (providerId: string, apiKey: string) => (
      invokeHost('providers', 'setApiKey', { providerId, apiKey })
    ),
    updateWithKey: (input: ProviderUpdateWithKeyPayload) => invokeHost('providers', 'updateWithKey', input),
    deleteApiKey: (providerId: string) => (
      invokeHost('providers', 'deleteApiKey', { providerId })
    ),
    setDefault: (providerId: string) => (
      invokeHost('providers', 'setDefault', { providerId })
    ),
    accounts: () => invokeHost('providers', 'accounts'),
    vendors: () => invokeHost('providers', 'vendors'),
    accountKeyInfo: () => invokeHost('providers', 'accountKeyInfo'),
    getDefaultAccount: () => invokeHost('providers', 'getDefaultAccount'),
    getAccount: (accountId: string) => (
      invokeHost('providers', 'getAccount', { accountId })
    ),
    hasAccountApiKey: (accountId: string) => (
      invokeHost('providers', 'hasAccountApiKey', { accountId })
    ),
    createAccount: (input: { account: ProviderAccount; apiKey?: string }) => (
      invokeHost('providers', 'createAccount', input)
    ),
    updateAccount: (accountId: string, updates: Partial<ProviderAccount>, apiKey?: string) => (
      invokeHost('providers', 'updateAccount', { accountId, updates, apiKey })
    ),
    deleteAccount: (accountId: string) => (
      invokeHost('providers', 'deleteAccount', { accountId })
    ),
    deleteAccountApiKey: (accountId: string) => (
      invokeHost('providers', 'deleteAccountApiKey', { accountId })
    ),
    setDefaultAccount: (accountId: string) => (
      invokeHost('providers', 'setDefaultAccount', { accountId })
    ),
    requestOAuth: (input: ProviderOAuthRequestPayload) => invokeHost('providers', 'requestOAuth', input),
    cancelOAuth: () => invokeHost('providers', 'cancelOAuth'),
    submitOAuth: (input: { code: string }) => invokeHost('providers', 'submitOAuth', input),
  },
  files: {
    stagePaths: (input: { filePaths: string[] }) => invokeHost('files', 'stagePaths', input),
    stageBuffer: (input: { base64: string; fileName: string; mimeType?: string }) => (
      invokeHost('files', 'stageBuffer', input)
    ),
    readText: (path: string) => invokeHost('files', 'readText', { path }),
    readBinary: (path: string, opts?: FileReadBinaryOptions) => (
      invokeHost('files', 'readBinary', { path, opts })
    ),
    writeText: (path: string, content: string, approvalId?: string) => (
      invokeHost('files', 'writeText', { path, content, approvalId })
    ),
    stat: (path: string) => invokeHost('files', 'stat', { path }),
    listDir: (path: string) => invokeHost('files', 'listDir', { path }),
    listTree: (path: string, opts?: FilePreviewTreeOptions) => (
      invokeHost('files', 'listTree', { path, opts })
    ),
  },
  media: {
    thumbnails: (input: { paths: MediaThumbnailEntry[] }) => invokeHost('media', 'thumbnails', input),
    saveImage: (input: SaveImagePayload) => invokeHost('media', 'saveImage', input),
    imageGenerationSettings: () => invokeHost('media', 'imageGenerationSettings'),
    saveImageGenerationSettings: (input: ImageGenerationSettingsPayload) => (
      invokeHost('media', 'saveImageGenerationSettings', input)
    ),
    imageGenerationProviders: () => invokeHost('media', 'imageGenerationProviders'),
    testImageGeneration: (input: { agentId?: string; prompt?: string; model?: string }) => (
      invokeHost('media', 'testImageGeneration', input)
    ),
  },
  sessions: {
    delete: (id: string) => invokeHost('sessions', 'delete', { id }),
    rename: (id: string, title: string) => (
      invokeHost('sessions', 'rename', { id, title })
    ),
    summaries: (input?: { sessionKeys?: string[]; limit?: number }) => invokeHost('sessions', 'summaries', input),
    history: (input: { sessionKey?: string; agentId?: string; sessionId?: string; limit?: number }) => (
      invokeHost('sessions', 'history', input)
    ),
    patchThinking: (input: SessionPatchThinkingPayload) => invokeHost('sessions', 'patchThinking', input),
    patchRuntimeModel: (input: SessionPatchRuntimeModelPayload) => invokeHost('sessions', 'patchRuntimeModel', input),
    compactionStatus: (input: SessionCompactionPayload): Promise<SessionCompactionStatusResult> => (
      invokeHost('sessions', 'compactionStatus', input)
    ),
    compactionHistory: (input: SessionCompactionHistoryPayload): Promise<SessionCompactionHistoryResult> => (
      invokeHost('sessions', 'compactionHistory', input)
    ),
    recallOriginal: (input: SessionRecallOriginalPayload): Promise<SessionRecallOriginalResult> => (
      invokeHost('sessions', 'recallOriginal', input)
    ),
    expandSelector: (input: SessionExpandSelectorPayload): Promise<SessionExpandSelectorResult> => (
      invokeHost('sessions', 'expandSelector', input)
    ),
    compressionArtifact: (
      input: SessionCompressionArtifactPayload,
    ): Promise<SessionCompressionArtifactResult> => (
      invokeHost('sessions', 'compressionArtifact', input)
    ),
    recoveryContext: (
      input: SessionRecoveryContextPayload,
    ): Promise<SessionRecoveryContextResult> => (
      invokeHost('sessions', 'recoveryContext', input)
    ),
    longTaskControlStatus: (
      input: SessionLongTaskControlPayload,
    ): Promise<SessionLongTaskControlStatusResult> => (
      invokeHost('sessions', 'longTaskControlStatus', input)
    ),
    longTaskControlHistory: (
      input: SessionLongTaskControlHistoryPayload,
    ): Promise<SessionLongTaskControlHistoryResult> => (
      invokeHost('sessions', 'longTaskControlHistory', input)
    ),
    resumeCheckpoints: (
      input: SessionLongTaskControlHistoryPayload,
    ): Promise<SessionResumeCheckpointsResult> => (
      invokeHost('sessions', 'resumeCheckpoints', input)
    ),
    restoreCheckpoint: (
      input: SessionRestoreCheckpointPayload,
    ): Promise<SessionRestoreCheckpointResult> => (
      invokeHost('sessions', 'restoreCheckpoint', input)
    ),
    checkpointDiff: (
      input: SessionRestoreCheckpointPayload,
    ): Promise<SessionCheckpointDiffResult> => (
      invokeHost('sessions', 'checkpointDiff', input)
    ),
    queueDrain: (input: SessionQueueDrainPayload): Promise<SessionQueueDrainResult> => (
      invokeHost('sessions', 'queueDrain', input)
    ),
    stop: (input: SessionStopPayload): Promise<SessionStopResult> => (
      invokeHost('sessions', 'stop', input)
    ),
    compact: (input: SessionManualCompactPayload): Promise<SessionCompactionResult> => (
      invokeHost('sessions', 'compact', input)
    ),
    prepareHandoff: (input: SessionHandoffPayload): Promise<SessionHandoffResult> => (
      invokeHost('sessions', 'prepareHandoff', input)
    ),
    fork: (input: SessionForkPayload): Promise<SessionForkResult> => (
      invokeHost('sessions', 'fork', input)
    ),
    truncate: (input: SessionTruncatePayload): Promise<SessionTruncateResult> => (
      invokeHost('sessions', 'truncate', input)
    ),
    archive: (input: SessionArchivePayload) => invokeHost('sessions', 'archive', input),
    restore: (input: SessionRestorePayload) => invokeHost('sessions', 'restore', input),
    permanentDelete: (input: SessionPermanentDeletePayload) => (
      invokeHost('sessions', 'permanentDelete', input)
    ),
    listArchived: (input?: SessionListArchivedPayload): Promise<SessionListArchivedResult> => (
      invokeHost('sessions', 'listArchived', input)
    ),
    emptyArchive: (input: SessionEmptyArchivePayload) => (
      invokeHost('sessions', 'emptyArchive', input)
    ),
  },
  chat: {
    sendWithMedia: (input: ChatSendWithMediaPayload) => invokeHost('chat', 'sendWithMedia', input),
  },
  codeReview: {
    run: (input: CodeReviewRunPayload): Promise<CodeReviewRunResult> => (
      invokeHost('codeReview', 'run', input)
    ),
    createTaskLedgerNode: (
      input: CodeReviewCreateTaskLedgerNodePayload,
    ): Promise<CodeReviewCreateTaskLedgerNodeResult> => (
      invokeHost('codeReview', 'createTaskLedgerNode', input)
    ),
  },
  remoteForge: {
    capabilities: (input: RemoteForgeRepositoryPayload): Promise<RemoteForgeCapabilitiesResult> => (
      invokeHost('remoteForge', 'capabilities', input)
    ),
    readPullRequest: (input: RemoteForgePullRequestReadPayload): Promise<RemoteForgePullRequestReadResult> => (
      invokeHost('remoteForge', 'readPullRequest', input)
    ),
    readContents: (input: RemoteForgeContentReadPayload): Promise<RemoteForgeContentReadResult> => (
      invokeHost('remoteForge', 'readContents', input)
    ),
    mutatePullRequest: (input: RemoteForgeMutationPayload): Promise<RemoteForgeMutationResult> => (
      invokeHost('remoteForge', 'mutatePullRequest', input)
    ),
    mergePullRequest: (input: RemoteForgeMergePayload): Promise<RemoteForgeMergeResult> => (
      invokeHost('remoteForge', 'mergePullRequest', input)
    ),
  },
  workProviders: {
    status: (): Promise<WorkProviderStatusSnapshot> => invokeHost('workProviders', 'status'),
    run: (input: WorkProviderRunPayload): Promise<WorkProviderRunResult> => (
      invokeHost('workProviders', 'run', input)
    ),
    validateArtifact: (input: WorkProviderValidateArtifactPayload): Promise<WorkProviderValidateArtifactResult> => (
      invokeHost('workProviders', 'validateArtifact', input)
    ),
  },
  knowledge: {
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
    createDraft: (input: KnowledgeCreateDraftPayload): Promise<KnowledgeDraftResult> => (
      invokeHost('knowledge', 'createDraft', input)
    ),
    listSourceSets: (): Promise<KnowledgeListSourceSetsResult> => (
      invokeHost('knowledge', 'listSourceSets')
    ),
    saveSourceSet: (input: KnowledgeSaveSourceSetPayload): Promise<KnowledgeSourceSetResult> => (
      invokeHost('knowledge', 'saveSourceSet', input)
    ),
    deleteSourceSet: (input: KnowledgeDeleteSourceSetPayload): Promise<HostSuccess> => (
      invokeHost('knowledge', 'deleteSourceSet', input)
    ),
    answerFromSourceSet: (input: KnowledgeAnswerFromSourceSetPayload): Promise<KnowledgeAnswerFromSourceSetResult> => (
      invokeHost('knowledge', 'answerFromSourceSet', input)
    ),
    createArtifactDraft: (input: KnowledgeCreateArtifactDraftPayload): Promise<KnowledgeDraftResult> => (
      invokeHost('knowledge', 'createArtifactDraft', input)
    ),
    listDrafts: (input?: KnowledgeListDraftsPayload): Promise<KnowledgeListDraftsResult> => (
      invokeHost('knowledge', 'listDrafts', input)
    ),
    getDraft: (input: { id: string }): Promise<KnowledgeDraftResult> => invokeHost('knowledge', 'getDraft', input),
    updateDraft: (input: KnowledgeUpdateDraftPayload): Promise<KnowledgeDraftResult> => (
      invokeHost('knowledge', 'updateDraft', input)
    ),
    reviewDraft: (input: KnowledgeReviewDraftPayload): Promise<KnowledgeDraftResult> => (
      invokeHost('knowledge', 'reviewDraft', input)
    ),
    proposeChange: (input: KnowledgeProposeChangePayload): Promise<KnowledgeProposalResult> => (
      invokeHost('knowledge', 'proposeChange', input)
    ),
    listProposals: (input?: KnowledgeListProposalsPayload): Promise<KnowledgeListProposalsResult> => (
      invokeHost('knowledge', 'listProposals', input)
    ),
    previewChange: (input: KnowledgePreviewChangePayload): Promise<KnowledgePreviewChangeResult> => (
      invokeHost('knowledge', 'previewChange', input)
    ),
    applyReviewedChange: (input: KnowledgeApplyReviewedChangePayload): Promise<KnowledgeApplyReviewedChangeResult> => (
      invokeHost('knowledge', 'applyReviewedChange', input)
    ),
    stewardReview: (input: KnowledgeStewardReviewPayload): Promise<KnowledgeStewardReviewResult> => (
      invokeHost('knowledge', 'stewardReview', input)
    ),
    stewardConfigGet: (): Promise<KnowledgeStewardConfigGetResult> => (
      invokeHost('knowledge', 'stewardConfigGet')
    ),
    stewardConfigUpdate: (input: KnowledgeStewardConfigUpdatePayload): Promise<KnowledgeStewardConfigUpdateResult> => (
      invokeHost('knowledge', 'stewardConfigUpdate', input)
    ),
    routeContext: (input: KnowledgeRouteContextPayload): Promise<KnowledgeRouteContextResult> => (
      invokeHost('knowledge', 'routeContext', input)
    ),
    runtimeLessonsReport: (): Promise<KnowledgeRuntimeLessonsReportResult> => (
      invokeHost('knowledge', 'runtimeLessonsReport')
    ),
    sekbShadowEvaluationExport: (input: KnowledgeSekbShadowEvaluationExportPayload): Promise<KnowledgeSekbShadowEvaluationExportResult> => (
      invokeHost('knowledge', 'sekbShadowEvaluationExport', input)
    ),
    sekbShadowEvaluationProtocol: (input: KnowledgeSekbShadowEvaluationProtocolPayload): Promise<KnowledgeSekbShadowEvaluationProtocolResult> => (
      invokeHost('knowledge', 'sekbShadowEvaluationProtocol', input)
    ),
    sekbShadowEvaluationReport: (input: KnowledgeSekbShadowEvaluationReportPayload): Promise<KnowledgeSekbShadowEvaluationReportResult> => (
      invokeHost('knowledge', 'sekbShadowEvaluationReport', input)
    ),
    sekbSuggestPrinciples: (input?: KnowledgeSekbSuggestPrinciplesPayload): Promise<KnowledgeSekbSuggestPrinciplesResult> => (
      invokeHost('knowledge', 'sekbSuggestPrinciples', input)
    ),
    sekbBatchDistillSuggest: (input?: KnowledgeSekbBatchDistillSuggestPayload): Promise<KnowledgeSekbBatchDistillSuggestResult> => (
      invokeHost('knowledge', 'sekbBatchDistillSuggest', input)
    ),
    sekbConfirmPrinciple: (input: KnowledgeSekbConfirmPrinciplePayload): Promise<KnowledgeSekbConfirmPrincipleResult> => (
      invokeHost('knowledge', 'sekbConfirmPrinciple', input)
    ),
    sekbRejectSuggestion: (input: KnowledgeSekbRejectSuggestionPayload): Promise<KnowledgeSekbRejectSuggestionResult> => (
      invokeHost('knowledge', 'sekbRejectSuggestion', input)
    ),
    sekbCaptureTrajectory: (input: KnowledgeSekbCaptureTrajectoryPayload): Promise<KnowledgeSekbCaptureTrajectoryResult> => (
      invokeHost('knowledge', 'sekbCaptureTrajectory', input)
    ),
    sekbRetrieveForTask: (input: KnowledgeSekbRetrieveForTaskPayload): Promise<KnowledgeSekbRetrieveForTaskResult> => (
      invokeHost('knowledge', 'sekbRetrieveForTask', input)
    ),
    matchErrorExperience: (input: KnowledgeMatchErrorExperiencePayload): Promise<KnowledgeMatchErrorExperienceResult> => (
      invokeHost('knowledge', 'matchErrorExperience', input)
    ),
    updateErrorExperienceEffectiveness: (input: KnowledgeUpdateErrorExperienceEffectivenessPayload): Promise<KnowledgeUpdateErrorExperienceEffectivenessResult> => (
      invokeHost('knowledge', 'updateErrorExperienceEffectiveness', input)
    ),
    recordKnowledgeReference: (input: KnowledgeRecordReferencePayload): Promise<KnowledgeProvenanceResult> => (
      invokeHost('knowledge', 'recordKnowledgeReference', input)
    ),
    getProvenance: (input: KnowledgeProvenancePayload): Promise<KnowledgeProvenanceResult> => (
      invokeHost('knowledge', 'getProvenance', input)
    ),
    governanceAudit: (): Promise<KnowledgeGovernanceResult> => invokeHost('knowledge', 'governanceAudit'),
    listWatchedDirectories: (): Promise<KnowledgeWatchedDirectoryConfig[]> => invokeHost('knowledge', 'listWatchedDirectories'),
    addWatchedDirectory: (config: KnowledgeWatchedDirectoryConfig): Promise<HostSuccess> => invokeHost('knowledge', 'addWatchedDirectory', config),
    updateWatchedDirectory: (id: string, config: Partial<KnowledgeWatchedDirectoryConfig>): Promise<HostSuccess> => invokeHost('knowledge', 'updateWatchedDirectory', { id, config }),
    removeWatchedDirectory: (id: string): Promise<HostSuccess> => invokeHost('knowledge', 'removeWatchedDirectory', { id }),
    listWatchedDirectoryEvents: (payload: KnowledgeListWatchedDirectoryEventsPayload): Promise<KnowledgeWatchedDirectoryEvent[]> => invokeHost('knowledge', 'listWatchedDirectoryEvents', payload),
  },
  cron: {
    list: () => invokeHost('cron', 'list'),
    create: (input: CronJobCreateInput) => invokeHost('cron', 'create', input),
    update: (id: string, input: CronJobUpdateInput) => invokeHost('cron', 'update', { id, input }),
    delete: (id: string) => invokeHost('cron', 'delete', { id }),
    toggle: (id: string, enabled: boolean) => invokeHost('cron', 'toggle', { id, enabled }),
    trigger: (id: string) => invokeHost('cron', 'trigger', { id }),
    sessionHistory: (input: CronSessionHistoryPayload) => invokeHost('cron', 'sessionHistory', input),
    deliveryTargets: () => invokeHost('cron', 'deliveryTargets'),
  },
  skills: {
    local: () => invokeHost('skills', 'local'),
    configs: () => invokeHost('skills', 'configs'),
    allConfigs: () => invokeHost('skills', 'allConfigs'),
    getConfig: (skillKey: string) => invokeHost('skills', 'getConfig', { skillKey }),
    updateConfig: (input: SkillUpdateConfigPayload) => invokeHost('skills', 'updateConfig', input),
    updateConfigs: (updates: SkillUpdateConfigPayload[]) => invokeHost('skills', 'updateConfigs', { updates }),
    status: () => invokeHost('skills', 'status'),
    update: (input: SkillUpdatePayload) => invokeHost('skills', 'update', input),
    quickAccess: (input: SkillQuickAccessPayload) => invokeHost('skills', 'quickAccess', input),
    clawhubCapability: () => invokeHost('skills', 'clawhubCapability'),
    clawhubList: () => invokeHost('skills', 'clawhubList'),
    clawhubSearch: (input: ClawHubSearchPayload) => invokeHost('skills', 'clawhubSearch', input),
    clawhubInstall: (input: { slug: string; version?: string }) => invokeHost('skills', 'clawhubInstall', input),
    clawhubUninstall: (input: { slug: string }) => invokeHost('skills', 'clawhubUninstall', input),
    clawhubOpenSkillReadme: (input: { skillKey?: string; slug?: string; baseDir?: string }) => (
      invokeHost('skills', 'clawhubOpenSkillReadme', input)
    ),
    clawhubOpenSkillPath: (input: { skillKey?: string; slug?: string; baseDir?: string }) => (
      invokeHost('skills', 'clawhubOpenSkillPath', input)
    ),
  },
  skillPacks: {
    list: (): Promise<{ success: boolean; packs?: SkillPackSummary[]; error?: string }> => invokeHost('skillPacks', 'list'),
    install: (packId: SkillPackId): Promise<{ success: boolean; error?: string }> => invokeHost('skillPacks', 'install', { packId }),
    sync: (packId: SkillPackId): Promise<{ success: boolean; error?: string }> => invokeHost('skillPacks', 'sync', { packId }),
    setEnabled: (packId: SkillPackId, enabled: boolean): Promise<{ success: boolean; error?: string }> => (
      invokeHost('skillPacks', 'setEnabled', { packId, enabled })
    ),
    readSkill: (packId: SkillPackId, skillId: string): Promise<SkillPackReadSkillResult> => (
      invokeHost('skillPacks', 'readSkill', { packId, skillId })
    ),
  },
  officeTools: {
    detect: () => invokeHost('officeTools', 'detect'),
    install: (input?: OfficecliInstallPayload) => invokeHost('officeTools', 'install', input),
    uninstall: () => invokeHost('officeTools', 'uninstall'),
    listSkills: () => invokeHost('officeTools', 'listSkills'),
    syncSkills: () => invokeHost('officeTools', 'syncSkills'),
    linkSkillToAgent: (skillId: string, agentId: string) => (
      invokeHost('officeTools', 'linkSkillToAgent', { skillId, agentId })
    ),
    unlinkSkillFromAgent: (skillId: string, agentId: string) => (
      invokeHost('officeTools', 'unlinkSkillFromAgent', { skillId, agentId })
    ),
    getSkillInstallStatus: (skillId: string) => (
      invokeHost('officeTools', 'getSkillInstallStatus', { skillId })
    ),
    listAllSkillInstallStatuses: () => invokeHost('officeTools', 'listAllSkillInstallStatuses'),
    applySkillLinks: (input: OfficecliSkillApplyLinksPayload) => (
      invokeHost('officeTools', 'applySkillLinks', input)
    ),
    readSkillContent: (skillId: string) => (
      invokeHost('officeTools', 'readSkillContent', { skillId })
    ),
    renderHtml: (input: OfficecliRenderHtmlPayload) => invokeHost('officeTools', 'renderHtml', input),
    startWatch: (input: OfficecliWatchPayload) => invokeHost('officeTools', 'startWatch', input),
    stopWatch: (input: OfficecliWatchPayload) => invokeHost('officeTools', 'stopWatch', input),
  },
  usage: {
    recentTokenHistory: (limit?: number) => (
      invokeHost('usage', 'recentTokenHistory', { limit })
    ),
    aggregateSummary: (input?: Parameters<UsageAggregateSummaryFn>[0]): Promise<ReturnType<UsageAggregateSummaryFn>> => (
      invokeHost('usage', 'aggregateSummary', input)
    ),
    live: (sessionKey: string, runId?: string | null, streaming?: boolean) => (
      invokeHost('usage', 'live', { sessionKey, runId, streaming })
    ),
    contextRange: (input: { sessionKey: string; modelRef?: string | null; messageCount?: number; usedTokens?: number | null }) => (
      invokeHost('usage', 'contextRange', input)
    ),
    promptCacheStatus: (input: Parameters<PromptCacheStatusFn>[0]): Promise<ReturnType<PromptCacheStatusFn>> => (
      invokeHost('usage', 'promptCacheStatus', input)
    ),
    recordPromptCacheRiskEvent: (input: Parameters<PromptCacheRiskEventFn>[0]): Promise<ReturnType<PromptCacheRiskEventFn>> => (
      invokeHost('usage', 'recordPromptCacheRiskEvent', input)
    ),
  },
  topics: {
    list: (input?: { agentId?: string; workspacePath?: string }) => invokeHost('topics', 'list', input),
    create: (input: { name: string; description?: string; agentId?: string; workspacePath?: string }) =>
      invokeHost('topics', 'create', input),
    update: (input: { id: string; name?: string; description?: string; contextMd?: string; agentId?: string; workspacePath?: string }) =>
      invokeHost('topics', 'update', input),
    delete: (input: { id: string; agentId?: string; workspacePath?: string }) => invokeHost('topics', 'delete', input),
    getContext: (input: { id: string; agentId?: string; workspacePath?: string }) => invokeHost('topics', 'getContext', input),
  },
  taskLedger: {
    snapshot: (input?: TaskLedgerWorkspacePayload): Promise<TaskLedgerSnapshotResult> => invokeHost('taskLedger', 'snapshot', input),
    appendEvents: (input: TaskLedgerAppendEventsPayload): Promise<TaskLedgerSnapshotResult> => invokeHost('taskLedger', 'appendEvents', input),
    createNode: (input: TaskLedgerCreateNodePayload): Promise<TaskLedgerSnapshotResult> => invokeHost('taskLedger', 'createNode', input),
    updateNode: (input: TaskLedgerUpdateNodePayload): Promise<TaskLedgerSnapshotResult> => invokeHost('taskLedger', 'updateNode', input),
    addEdge: (input: TaskLedgerAddEdgePayload): Promise<TaskLedgerSnapshotResult> => invokeHost('taskLedger', 'addEdge', input),
    linkSession: (input: TaskLedgerLinkSessionPayload): Promise<TaskLedgerSnapshotResult> => invokeHost('taskLedger', 'linkSession', input),
    requestReview: (input: TaskLedgerReviewPayload): Promise<TaskLedgerSnapshotResult> => invokeHost('taskLedger', 'requestReview', input),
    clearReview: (input: TaskLedgerReviewPayload): Promise<TaskLedgerSnapshotResult> => invokeHost('taskLedger', 'clearReview', input),
    exportHtml: (input?: TaskLedgerExportHtmlPayload): Promise<TaskLedgerExportHtmlResult> => invokeHost('taskLedger', 'exportHtml', input),
  },
  remoteTasks: {
    list: (): Promise<RemoteTaskListResult> => invokeHost('remoteTasks', 'list'),
    create: (input: RemoteTaskCreatePayload): Promise<RemoteTaskRecordResult> => invokeHost('remoteTasks', 'create', input),
    preview: (input: RemoteTaskIdPayload): Promise<RemoteTaskPreviewResult> => invokeHost('remoteTasks', 'preview', input),
    approve: (input: RemoteTaskApprovePayload): Promise<RemoteTaskRecordResult> => invokeHost('remoteTasks', 'approve', input),
    reject: (input: RemoteTaskIdPayload): Promise<RemoteTaskRecordResult> => invokeHost('remoteTasks', 'reject', input),
    execute: (input: RemoteTaskIdPayload): Promise<RemoteTaskRecordResult> => invokeHost('remoteTasks', 'execute', input),
  },
  clawGraph: {
    listWorkflows: (input?: ClawGraphWorkspacePayload): Promise<ClawGraphListWorkflowsResult> => (
      invokeHost('clawGraph', 'listWorkflows', input)
    ),
    compile: (input: ClawGraphCompilePayload): Promise<ClawGraphCompileHostResult> => (
      invokeHost('clawGraph', 'compile', input)
    ),
    run: (input: ClawGraphRunPayload): Promise<ClawGraphRunResult> => (
      invokeHost('clawGraph', 'run', input)
    ),
    status: (input: { runId: string }): Promise<ClawGraphStatusResult> => (
      invokeHost('clawGraph', 'status', input)
    ),
    events: (input: ClawGraphEventsPayload): Promise<ClawGraphEventsResult> => (
      invokeHost('clawGraph', 'events', input)
    ),
    abort: (input: ClawGraphAbortPayload): Promise<ClawGraphStatusResult> => (
      invokeHost('clawGraph', 'abort', input)
    ),
    review: (input: ClawGraphReviewPayload): Promise<ClawGraphStatusResult> => (
      invokeHost('clawGraph', 'review', input)
    ),
  },
  observability: {
    dashboardSnapshot: (): Promise<ObservabilityDashboardSnapshot> => invokeHost('observability', 'dashboardSnapshot'),
    traces: (): Promise<unknown[]> => invokeHost('observability', 'traces'),
    trace: (id: string): Promise<ObservabilityTrace | null> => invokeHost('observability', 'trace', { id }),
    reportTrace: (trace: ObservabilityTrace): Promise<{ success: boolean; traceId?: string; error?: string }> =>
      invokeHost('observability', 'reportTrace', { trace }),
    queryTraces: (payload?: ObservabilityTraceQuery): Promise<ObservabilityTraceQueryResult> =>
      invokeHost('observability', 'queryTraces', payload),
    traceGraph: (id: string): Promise<ObservabilityTraceGraphResult | null> => invokeHost('observability', 'traceGraph', { id }),
    traceNodeDiagnostics: (traceId: string, nodeId: string): Promise<ObservabilityNodeDiagnostics | null> =>
      invokeHost('observability', 'traceNodeDiagnostics', { traceId, nodeId }),
    trajectorySessions: (): Promise<{ sessions: ObservabilityTrajectorySessionSupply[] }> =>
      invokeHost('observability', 'trajectorySessions'),
    // Main re-validates every row against the B1-01 v2 schema before it
    // crosses the host boundary, so the renderer surface is typed as raw v2.
    trajectoryHistory: (payload: { sessionKey: string; fromSeq?: number; limit?: number }): Promise<ObservabilityTrajectoryHistoryPage<TrajectoryEventV2>> =>
      invokeHost('observability', 'trajectoryHistory', payload) as Promise<ObservabilityTrajectoryHistoryPage<TrajectoryEventV2>>,
    clearTraces: () => invokeHost('observability', 'clearTraces'),
  },
};

export type HostApi = typeof hostApi;
