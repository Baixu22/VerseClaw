import type {
  AgentCreatePayload,
  AgentBrowserClickPayload,
  AgentBrowserActionResult,
  AgentBrowserCommandPayload,
  AgentBrowserCommandResult,
  AgentBrowserEvaluatePayload,
  AgentBrowserEvaluateResult,
  AgentBrowserNavigatePayload,
  AgentBrowserOpenPayload,
  AgentBrowserProfileSavePayload,
  AgentBrowserProfileSaveResult,
  AgentBrowserProfilesResult,
  AgentBrowserScreenshotPayload,
  AgentBrowserScreenshotResult,
  AgentBrowserSelectorPayload,
  AgentBrowserSessionPayload,
  AgentBrowserSessionResult,
  AgentBrowserStatusResult,
  AgentBrowserTypePayload,
  AgentBrowserValidatePayload,
  AgentBrowserValidateResult,
  AgentBootstrapUpdatePayload,
  AgentDevCreateConversationPayload,
  AgentDevCreateConversationResult,
  AgentDevCreateProviderConfigPayload,
  AgentDevCreateProviderConfigResult,
  AgentDevDiagnosticsSnapshotResult,
  AgentDevFeatureFlagsPayload,
  AgentDevFeatureFlagsResult,
  AgentDevHostApiCallsPayload,
  AgentDevHostApiCallsResult,
  AgentDevMockReplayConfig,
  AgentDevMockReplayResult,
  AgentDevSeedStatePayload,
  AgentDevSeedStateResult,
  AgentDevSelectorContractResult,
  AgentDevTransportTracePayload,
  AgentDevTransportTraceResult,
  AgentDevVisualPreset,
  AgentDevVisualPresetResult,
  AgentUpdateReasoningEffortPayload,
  AgentUpdatePayload,
  ChannelAccountsPayload,
  ChannelSaveConfigPayload,
  ChannelTargetsPayload,
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
  ImageGenerationSettingsPayload,
  KnowledgeApplyDraftPayload,
  KnowledgeApplyDraftResult,
  KnowledgeApplyReviewedChangePayload,
  KnowledgeApplyReviewedChangeResult,
  KnowledgeCreateDraftPayload,
  KnowledgeCreateInboxItemPayload,
  KnowledgeCompileResult,
  KnowledgeConfigurePayload,
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
  KnowledgeLintResult,
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
  KnowledgeSearchPayload,
  KnowledgeSearchResult,
  KnowledgeStewardReviewPayload,
  KnowledgeStewardReviewResult,
  KnowledgeStatusResult,
  KnowledgeUpdateDraftPayload,
  KnowledgeUpdateInboxItemPayload,
  KnowledgeValidateOkfBundlePayload,
  KnowledgeGovernanceResult,
  KnowledgeListWatchedDirectoryEventsPayload,
  KnowledgeWatchedDirectoryConfig,
  KnowledgeWatchedDirectoryEvent,
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
  SessionCompactionHistoryResult,
  SessionCompactionHistoryPayload,
  SessionCompactionPayload,
  SessionCompactionResult,
  SessionCompactionStatusResult,
  SessionForkPayload,
  SessionForkResult,
  SessionHandoffPayload,
  SessionHandoffResult,
  SessionLongTaskControlHistoryPayload,
  SessionLongTaskControlHistoryResult,
  SessionLongTaskControlPayload,
  SessionLongTaskControlStatusResult,
  SessionManualCompactPayload,
  SessionPatchThinkingPayload,
  SessionQueueDrainResult,
  SessionResumeCheckpointsResult,
  WorkProviderRunPayload,
  WorkProviderRunResult,
  WorkProviderStatusSnapshot,
  WorkProviderValidateArtifactPayload,
  WorkProviderValidateArtifactResult,
  WorkspaceCreatePayload,
  WorkspaceSaveStatePayload,
  WorkspaceTerminalOpenPayload,
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
} from '@shared/host-api/contract';
import type { CronJobCreateInput, CronJobUpdateInput } from '@shared/types/cron';
import type {
  ObservabilityDashboardSnapshot,
  ObservabilityNodeDiagnostics,
  ObservabilityTrace,
  ObservabilityTraceGraphResult,
  ObservabilityTraceQuery,
  ObservabilityTraceQueryResult,
} from '@shared/types/observability';
import { invokeHost } from './host-api-client';

export type { ChatKnowledgeReference } from '@shared/host-api/contract';

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
  AgentBrowserValidateResult,
  AgentDevCreateConversationResult,
  AgentDevCreateProviderConfigResult,
  AgentDevDiagnosticsSnapshotResult,
  AgentDevFeatureFlagsResult,
  AgentDevHostApiCallsResult,
  AgentDevMockReplayResult,
  AgentDevScenario,
  AgentDevSeedStateResult,
  AgentDevSelectorContractResult,
  AgentDevStatusResult,
  AgentDevTransportTraceResult,
  AgentDevVisualPresetResult,
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
  DeliveryChannelAccount,
  DeliveryChannelGroup,
  DeliveryTargetsResult,
  GatewayHealthSummary,
  ImageGenerationProvidersResult,
  ImageGenerationSettingsResult,
  KnowledgeApplyDraftResult,
  KnowledgeApplyReviewedChangeResult,
  KnowledgeCompileResult,
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
  KnowledgeLintResult,
  KnowledgeOpenVaultResult,
  KnowledgePreviewChangeResult,
  KnowledgeProposalResult,
  KnowledgeProvenanceRecord,
  KnowledgeProvenanceResult,
  KnowledgeRouteCandidate,
  KnowledgeRouteContextResult,
  KnowledgeRuntimeLessonsReportResult,
  KnowledgeSearchResult,
  KnowledgeStewardConfig,
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
  SessionForkResult,
  SessionHandoffResult,
  SessionHistoryResult,
  SessionLabelSummary,
  SessionLongTaskControlHistoryResult,
  SessionLongTaskControlStatusResult,
  SessionQueueDrainResult,
  SessionResumeCheckpointsResult,
  SessionSummariesResult,
  SettingsResetResult,
  SettingsSnapshot,
  SkillConfigsResult,
  SkillsStatusResult,
  StagedFileResult,
  TaskLedgerExportHtmlResult,
  TaskLedgerSnapshotResult,
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
  GitStashListResult,
  GitWorktreeListResult,
  GitOperationResult,
  GitCommitResult,
  GithubAuthStatusResult,
  GithubRepoResult,
  GithubPrListResult,
  GithubPrViewResult,
  GithubPrCreateResult,
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
  uv: {
    installAll: () => invokeHost('uv', 'installAll'),
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
    saveState: (input: WorkspaceSaveStatePayload) => invokeHost('workspaces', 'saveState', input),
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
  },
  git: {
    capabilities: (): Promise<GitCapabilitiesResult> => invokeHost('git', 'capabilities'),
    status: (): Promise<GitStatusResult> => invokeHost('git', 'status'),
    diff: (input?: { mode?: 'unstaged' | 'staged' }): Promise<GitDiffListResult> => invokeHost('git', 'diff', input),
    fileDiff: (input: GitFileDiffPayload): Promise<GitFileDiffResult> => invokeHost('git', 'fileDiff', input),
    stage: (input: GitPathsPayload): Promise<GitOperationResult> => invokeHost('git', 'stage', input),
    unstage: (input: GitPathsPayload): Promise<GitOperationResult> => invokeHost('git', 'unstage', input),
    revertFile: (input: GitPathPayload): Promise<GitOperationResult> => invokeHost('git', 'revertFile', input),
    commit: (input: GitCommitPayload): Promise<GitCommitResult> => invokeHost('git', 'commit', input),
    branches: (): Promise<GitBranchListResult> => invokeHost('git', 'branches'),
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
    githubAuthStatus: (): Promise<GithubAuthStatusResult> => invokeHost('git', 'githubAuthStatus'),
    githubRepo: (): Promise<GithubRepoResult> => invokeHost('git', 'githubRepo'),
    prList: (input?: GithubPrListPayload): Promise<GithubPrListResult> => invokeHost('git', 'prList', input),
    prView: (input: GithubPrViewPayload): Promise<GithubPrViewResult> => invokeHost('git', 'prView', input),
    prCreate: (input: GithubPrCreateInput): Promise<GithubPrCreateResult> => invokeHost('git', 'prCreate', input),
    openPr: (input: GithubPrOpenPayload): Promise<GitOperationResult> => invokeHost('git', 'openPr', input),
  },
  permissions: {
    approvals: (input?: PermissionApprovalListPayload) => invokeHost('permissions', 'approvals', input),
    decideApproval: (input: PermissionApprovalDecisionPayload) => (
      invokeHost('permissions', 'decideApproval', input)
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
    controlUi: (view?: 'dreams') => invokeHost('gateway', 'controlUi', { view }),
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
    profiles: (): Promise<AgentBrowserProfilesResult> => invokeHost('agentBrowser', 'profiles'),
    saveProfile: (input: AgentBrowserProfileSavePayload): Promise<AgentBrowserProfileSaveResult> =>
      invokeHost('agentBrowser', 'saveProfile', input),
    validate: (input?: AgentBrowserValidatePayload): Promise<AgentBrowserValidateResult> =>
      invokeHost('agentBrowser', 'validate', input),
    navigate: (input: AgentBrowserNavigatePayload): Promise<AgentBrowserActionResult> =>
      invokeHost('agentBrowser', 'navigate', input),
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
    close: (input: AgentBrowserSessionPayload) => invokeHost('agentBrowser', 'close', input),
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
    dir: () => invokeHost('logs', 'dir'),
    listFiles: () => invokeHost('logs', 'listFiles'),
    readFile: (path: string, tailLines?: number) => (
      invokeHost('logs', 'readFile', { path, tailLines })
    ),
  },
  channels: {
    accounts: (options?: ChannelAccountsPayload) => (
      invokeHost('channels', 'accounts', options)
    ),
    targets: (input: ChannelTargetsPayload) => (
      invokeHost('channels', 'targets', input)
    ),
    configured: () => invokeHost('channels', 'configured'),
    formValues: (channelType: string, accountId?: string) => (
      invokeHost('channels', 'formValues', { channelType, accountId })
    ),
    saveConfig: (input: ChannelSaveConfigPayload) => invokeHost('channels', 'saveConfig', input),
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
  diagnostics: {
    gatewaySnapshot: () => invokeHost('diagnostics', 'gatewaySnapshot'),
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
    selectorContract: (): Promise<AgentDevSelectorContractResult> => invokeHost('agentDev', 'selectorContract'),
  },
  providers: {
    list: () => invokeHost('providers', 'list'),
    get: (providerId: string) => invokeHost('providers', 'get', { providerId }),
    getDefault: () => invokeHost('providers', 'getDefault'),
    hasApiKey: (providerId: string) => (
      invokeHost('providers', 'hasApiKey', { providerId })
    ),
    getApiKey: (providerId: string) => (
      invokeHost('providers', 'getApiKey', { providerId })
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
    getAccountApiKey: (accountId: string) => (
      invokeHost('providers', 'getAccountApiKey', { accountId })
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
    compactionStatus: (input: SessionCompactionPayload): Promise<SessionCompactionStatusResult> => (
      invokeHost('sessions', 'compactionStatus', input)
    ),
    compactionHistory: (input: SessionCompactionHistoryPayload): Promise<SessionCompactionHistoryResult> => (
      invokeHost('sessions', 'compactionHistory', input)
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
    queueDrain: (input: SessionLongTaskControlPayload): Promise<SessionQueueDrainResult> => (
      invokeHost('sessions', 'queueDrain', input)
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
    routeContext: (input: KnowledgeRouteContextPayload): Promise<KnowledgeRouteContextResult> => (
      invokeHost('knowledge', 'routeContext', input)
    ),
    runtimeLessonsReport: (): Promise<KnowledgeRuntimeLessonsReportResult> => (
      invokeHost('knowledge', 'runtimeLessonsReport')
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
  usage: {
    recentTokenHistory: (limit?: number) => (
      invokeHost('usage', 'recentTokenHistory', { limit })
    ),
    live: (sessionKey: string, runId?: string | null, streaming?: boolean) => (
      invokeHost('usage', 'live', { sessionKey, runId, streaming })
    ),
    contextRange: (input: { sessionKey: string; modelRef?: string | null; messageCount?: number; usedTokens?: number | null }) => (
      invokeHost('usage', 'contextRange', input)
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
    clearTraces: () => invokeHost('observability', 'clearTraces'),
  },
};

export type HostApi = typeof hostApi;
