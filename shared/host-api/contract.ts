import type { RawMessage } from '../chat/types';
import type { SystemPortfolio, SystemProjectRead, SystemProjectSnapshot } from '../types/system-portfolio';
import type { SystemControlChange, SystemControlState } from '../types/system-control';
import type { ProjectConfigurationApply, ProjectConfigurationInput, ProjectConfigurationPreview, ProjectConfigurationRecovery, ProjectConfigurationResult } from '../project-configuration';
import type { KnowledgeEmbeddingSelection, KnowledgeEmbeddingStatusResult } from '../knowledge/embedding';
import type { KnowledgeVectorStatusResult } from '../knowledge/vector';
import type { ProjectRagConfigInput, KnowledgeOperationsResult, KnowledgeOperationsConfigureResult, KnowledgeIndexResult } from '../knowledge/operations';
import type { KnowledgeRerankSelection, KnowledgeRerankStatusResult } from '../knowledge/rerank';
import type { RetainedEvidenceManifestV1 } from '../knowledge/packing';
import type { AnswerClaimV1, KnowledgeAnswerMode } from '../knowledge/answer';
import type { KnowledgeResearchPayload, KnowledgeResearchRequestPayload, KnowledgeResearchResult } from '../knowledge/research';
import type { RankSignalsV2, RetrievalMode, RetrievalProfile, RetrievalResultV2 } from '../knowledge/retrieval';
import type { OwnerReadRejectionCode, OwnerReadSnapshotV1, SourceRefV2 } from '../knowledge/owner-read-contract';
export type { OwnerReadRejectionCode, OwnerReadSnapshotV1, SourceRefV2 } from '../knowledge/owner-read-contract';
import type { SessionHandoffOperation } from '../types/session-handoff';
import type { ExecutionMigrationOperation, WorkspaceExecutionMigrationPayload, WorkspaceExecutionMigrationReadPayload } from '../types/execution-migration';
export type { WorkspaceExecutionMigrationPayload, WorkspaceExecutionMigrationReadPayload } from '../types/execution-migration';
import type { ScopedRunId } from '../types/identity-scope';
import type { InstructionLayerKind, InstructionResolution, InstructionTrust } from '../instruction-precedence';
import type { BackgroundWorkGateState, ResourceEnvelopeSnapshot } from '../types/resources';
import type {
  VtokenAssembleHostResult,
  VtokenAssemblePayload,
  VtokenCloseResult,
  VtokenIngestMarkdownPayload,
  VtokenIngestMemoryPayload,
  VtokenIngestPathPayload,
  VtokenIngestResult,
  VtokenIngestToolsPayload,
  VtokenOpenPayload,
  VtokenOpenResult,
  VtokenPingResult,
  VtokenSetEnabledPayload,
  VtokenSetEnabledResult,
  VtokenStatsResult,
  VtokenStatusResult,
} from '../vtoken/types';
import type {
  DcsProdFlagSetPayload,
  DcsProdFlagSetResult,
  DcsProdFlagAckRequeryResult,
  DcsPreviewSetPayload,
  DcsPreviewSetResult,
  DcsPreviewState,
  DcsProdFlagsSnapshot,
  WorkspaceContextSetPayload,
  WorkspaceContextSetResult,
  WorkspaceContextState,
} from '../dcs/prod-flags-control';
import type { PermissionDecisionEvent } from '../product-semantics';
import type { SandboxDenialDetails } from '../sandbox/errors';
import type {
  AgentAvatarPreset,
  AgentReasoningEffort,
  AgentsSnapshot,
  RuntimeIntensityPreference,
} from '../types/agent';
import type { CronJob, CronJobCreateInput, CronJobUpdateInput } from '../types/cron';
import type { GatewayHealth, GatewayStatus } from '../types/gateway';
import type { ArchiveHandle } from '../types/context-family';
import type { ContextDiagnostic, ContextFoldResult, ContextFoldingStatus } from '../types/context-folding';
import type {
  MemoryCard,
  MemoryCardScope,
  MemoryCardStatus,
  MemoryConflict,
  MemoryEvidenceCheckResult,
  MemoryGatekeeperDecision,
  MemoryHealthReport,
  MemoryInjectionRecord,
  MemoryProposal,
  MemoryProposalPreview,
  MemoryProposalRecord,
  MemorySurfaceSnapshot,
  MemorySurfaceSource,
} from '../types/memory';
import type { SessionActivitySnapshot, SessionActivityReadQuery } from '../types/session-activity';
import type { SessionCollaborationQuery, SessionCollaborationPage } from '../types/session-collaboration';
import type { SessionCollaborationWatch, SessionCollaborationWatchResult } from '../types/session-collaboration-watch';
import type { SessionCollaborationMessageInput, SessionCollaborationMessageReceipt, SessionCollaborationMessageQuery, SessionCollaborationMessagePage } from '../types/session-collaboration-message';
import type { AutonomySessionScope } from '../types/identity-scope';
import type { SessionCollaborationTaskContext } from '../types/session-collaboration-context';
import type { SessionCollaborationMaterialPage, SessionCollaborationMaterialPresentation, SessionCollaborationMaterialQuery } from '../types/session-collaboration-material';
import type {
  SessionDelegationPayload,
  SessionDelegationResult,
} from '../types/session-delegation';
export type {
  SessionDelegationAdmission,
  SessionDelegationBackend,
  SessionDelegationBudget,
  SessionDelegationChildReceipt,
  SessionDelegationCoordinator,
  SessionDelegationIsolation,
  SessionDelegationIsolationBackend,
  SessionDelegationIsolationMode,
  SessionDelegationPayload,
  SessionDelegationReceipt,
  SessionDelegationResult,
  SessionDelegationSchedulerReceipt,
  SessionDelegationStatus,
  SessionDelegationToolAuthorization,
  SessionDelegationWorkerPlan,
} from '../types/session-delegation';
import type { LongSessionContinuityContextPack } from '../long-session-continuity';
export type { SessionEffectivePolicy } from '../types/session-effective-policy';
import type {
  GitBranch,
  GitCapabilities,
  GitCommitInfo,
  GitCommitResult,
  GitReflogEntry,
  GitDiffMode,
  GitDiffResult,
  GitApplyPatchPayload,
  GitApplyPatchResult,
  GitDiffToBasePayload,
  GitDiffToBaseResult,
  GitOperationResult,
  GitRepositoryStatus,
  GitStashEntry,
  GitWorktree,
  GithubAuthStatus,
  GithubPrCreateInput,
  GithubPrSummary,
  GithubRepository,
} from '../types/git';
import type {
  GitPatchArtifactV1,
  RemoteForgeCapabilityMatrix,
  RemoteForgeContent,
  RemoteForgeErrorV1,
  RemoteForgeMergePolicyDecision,
  RemoteForgeMergeStrategy,
  RemoteForgeMutationBinding,
  RemoteForgeMutationV1,
  RemoteForgePullRequestReadV1,
  RemoteForgeReadiness,
} from '../types/remote-forge';
export type { GitApplyPatchMode, GitApplyPatchPayload, GitApplyPatchResult, GitBaseResolution, GitCommitResult, GitDiffToBasePayload, GitDiffToBaseResult, GitOperationResult, GithubPrCreateInput } from '../types/git';
import type {
  McpCallToolResult,
  McpExposureConfig,
  McpHeartbeatResult,
  McpListToolsResult,
  McpNetworkPolicy,
  McpReloadRuntimeResult,
  McpResolvedConfig,
  McpScope,
  McpServerConfig,
  McpServerTestResult,
  McpTransport,
} from '../types/mcp';
import type {
  SandboxExplanation,
  SandboxProfile,
  SandboxProviderStatus,
  SandboxStatus,
} from '../types/sandbox';
import type { ChannelAccessPolicyView } from '../types/channel';
import type { MarketplaceSkill, QuickAccessSkill, Skill } from '../types/skill';
import type { JsSourceResource, JsSourceMatch, JsSourceContext, JsSourceFetchFailure, SourceMapCandidate, SourceMapResolvedLocation, SourceMapOriginalContext } from '../agent-browser/types';
import type {
  LiveTokenUsage,
  PermissionApprovalDecision,
  PermissionApprovalEvent,
  PromptCacheRiskAction,
  PromptCacheRiskAssessment,
  PromptCacheRiskDecision,
  PromptCacheRiskSeverity,
  PromptCacheStatus,
  WorkspaceContextRange,
  KnowledgeInvocationMode,
  SessionArchiveEntry,
  SessionPendingMutation,
  SessionFolder,
  WorkspaceCoordinatorArchiveRestorePolicy,
  WorkspaceCoordinatorBinding,
  WorkspaceCoordinatorEnvironmentBinding,
  WorkspaceCoordinatorRecovery,
  WorkspaceKnowledgeScope,
  WorkspacePermissionMode,
  WorkspacePreviewMode,
  WorkspaceProfile,
  WorkspaceSnapshot,
  WorkspaceUiState,
  WorkspaceWebPreviewLaunchConfig,
  WorkspaceWebPreviewStatus,
} from '../types/workspace';
import type {
  WorkProviderConfig,
  WorkProviderRunPayload,
  WorkProviderRunResult,
  WorkProviderStatusSnapshot,
  WorkProviderValidateArtifactPayload,
  WorkProviderValidateArtifactResult,
} from '../types/work-provider';
export type {
  WorkProviderConfig,
  WorkProviderRunPayload,
  WorkProviderRunResult,
  WorkProviderStatusSnapshot,
  WorkProviderValidateArtifactPayload,
  WorkProviderValidateArtifactResult,
} from '../types/work-provider';
import type {
  ObservabilityDashboardSnapshot,
  ObservabilityNodeDiagnostics,
  ObservabilityTrace,
  ObservabilityTraceGraphResult,
  ObservabilityTraceQuery,
  ObservabilityTraceQueryResult,
  ObservabilityTrajectoryHistoryPage,
  ObservabilityTrajectorySessionSupply,
} from '../types/observability';

export type {
  PromptCacheRiskAction,
  PromptCacheRiskAssessment,
  PromptCacheRiskDecision,
  PromptCacheRiskEvent,
  PromptCacheRiskSeverity,
  PromptCacheStatus,
} from '../types/workspace';
import type {
  ClawGraphCompileResult,
  ClawGraphReviewDecision,
  ClawGraphRunEvent,
  ClawGraphRunSnapshot,
  ClawGraphWorkflowFile,
} from '../types/clawgraph';
import type {
  CodeReviewRun,
  CodeReviewTarget,
} from '../types/code-review';
import type { ChangeContextApiContract } from '../types/change-context';
export type {
  ChangeContextProjectionPayload,
  ChangeContextProjectionResult,
  ChangeContextPullChangesPayload,
  ChangeContextPullChangesResult,
  ChangeContextReviewCommentCreatePayload,
  ChangeContextReviewCommentDeletePayload,
  ChangeContextReviewCommentListPayload,
  ChangeContextReviewCommentListResult,
  ChangeContextReviewCommentMutationResult,
  ChangeContextReviewCommentReanchorPayload,
  ChangeContextReviewCommentResolvePayload,
  ChangeContextReviewVerdictPayload,
  ChangeContextReviewVerdictResult,
} from '../types/change-context';
import type {
  TaskLedgerEdge,
  TaskLedgerEvidenceRef,
  TaskLedgerEventInput,
  TaskLedgerNode,
  TaskLedgerNodeKind,
  TaskLedgerNodeStatus,
  TaskLedgerSessionLink,
  TaskLedgerSnapshot,
} from '../types/task-ledger';
import type {
  RemoteTaskCommand,
  RemoteTaskPreview,
  RemoteTaskRecord,
  RemoteTaskSnapshot,
} from '../types/remote-tasks';
import type {
  LongTaskCheckpointRecord,
  LongTaskControlEvent,
  LongTaskControlStatus,
  LongTaskInputMode,
  ResumeCheckpoint,
} from '../types/long-task-control';
import type {
  AgentDevScenarioDefinition,
  AgentDevScenarioId,
} from '../agent-dev/scenarios';
import type {
  AgentDevCostReport,
  AgentDevSkillSandboxReport,
  AgentDevTraceEvent,
} from '../agent-dev/trace-contract';
export type {
  LongTaskCheckpointRecord,
  LongTaskControlEvent,
  LongTaskControlStatus,
  LongTaskInputMode,
  ResumeCheckpoint,
} from '../types/long-task-control';

export type {
  ContextPack,
  ContextPackBudget,
  ContextPackBucketName,
  ContextPackBuckets,
  MemoryCard,
  MemoryCardScope,
  MemoryCardStatus,
  MemoryCardType,
  MemoryConflict,
  MemoryConflictDetail,
  MemoryEvidenceCheckResult,
  MemoryEvidenceRef,
  MemoryFeedbackRecord,
  MemoryGatekeeperDecision,
  MemoryHealthReport,
  MemoryInjectionCandidateExplain,
  MemoryInjectionRecord,
  MemoryInjectionSimulation,
  MemoryMergeDraft,
  MemoryPermissionDecision,
  MemoryPhaseTag,
  MemoryProposal,
  MemoryProposalOperation,
  MemoryProposalPreview,
  MemoryProposalRecord,
  MemoryProposalStatus,
  MemoryReviewAction,
  MemoryReviewBatchResult,
  MemoryRetentionAction,
  MemoryRetentionCandidate,
  MemoryRiskLevel,
  MemoryCardSensitivity,
  MemorySuggestedAction,
  MemoryUtilityCardReport,
  MemoryUtilityReport,
} from '../types/memory';

export type JsonRecord = Record<string, unknown>;
import type { ReclaimReceipt } from '../long-session-resource-reclamation';

export type HostSuccess = { success: boolean; error?: string };
export type ProviderDefaultSyncResult = HostSuccess & {
  /** True when the default was saved but the runtime model registry sync
   * (per-agent models.json) failed partially. */
  degraded?: boolean;
  /** Diagnostic detail for the degraded sync (not user-facing copy). */
  reason?: string;
};
export type SessionDeleteResult = HostSuccess & {
  /** Physical generation whose runtime finalizer produced the delete receipt. */
  expectedSessionId?: string;
  /** Owner-derived cleanup result, including recovery identity when incomplete. */
  resourceReclamation?: ReclaimReceipt;
  /** True when the transcript was removed but side artefacts or the
   * sessions.json update failed — the session entry is kept so the user can
   * retry instead of seeing a fake success. */
  partial?: boolean;
  /** Paths that could not be unlinked (only meaningful when partial). */
  remainingPaths?: string[];
};
export type AppUpdateStatus = {
  status: 'available' | 'not-available' | 'downloaded' | 'error';
  version?: string;
};
export type AppUpdateStatusResult = HostSuccess & {
  status: AppUpdateStatus;
};
export type OptionalHostSuccess = { success?: boolean; error?: string };

export type OpenClawDoctorMode = 'diagnose' | 'fix';
export type OpenClawDoctorResult = HostSuccess & {
  mode: OpenClawDoctorMode;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  command: string;
  cwd: string;
  durationMs: number;
  sandbox?: SandboxStatus;
  timedOut?: boolean;
};
export type OpenClawDoctorPayload = { mode: OpenClawDoctorMode };


// ── Local backup inspect / restore ────────────────────────────────────────
//
// `openclaw backup create` can produce a `tar.gz` archive with a manifest, but
// the product had no restore surface. These types describe a conservative
// restore: only paths that do not exist yet are written, existing files are
// reported and left untouched, and entries escaping the manifest asset roots
// are rejected. See `electron/services/backup-restore.ts`.

export type BackupRestoreEntryAction = 'create' | 'skip-existing' | 'rejected';

export type BackupRestorePreviewEntry = {
  archivePath: string;
  targetPath: string;
  action: BackupRestoreEntryAction;
  reason?: string;
};

export type BackupRestorePreviewResult = HostSuccess & {
  valid: boolean;
  dryRun: true;
  archivePath: string;
  createdAt?: string;
  includeWorkspace?: boolean;
  entries: BackupRestorePreviewEntry[];
  counts: { create: number; skipped: number; rejected: number };
  errors: string[];
};

export type BackupRestoreResult = HostSuccess & {
  dryRun: boolean;
  archivePath: string;
  written: string[];
  skipped: string[];
  rejected: Array<{ archivePath: string; reason: string }>;
  errors: string[];
  rolledBack: string[];
};

/** Inspect (and optionally apply) a restore. `dryRun` performs no writes. */
export type BackupRestorePayload = { archivePath: string; dryRun?: boolean };

export type OpenClawStatusResult = {
  packageExists: boolean;
  isBuilt: boolean;
  entryPath: string;
  dir: string;
  version?: string;
};
export type OpenClawCliCommandResult = HostSuccess & { command?: string };
export type OpenClawRuntimeFlagsResult = {
  runtimeMode: 'source' | 'npm';
  mockProviderEnabled: boolean;
};

export type ShellPathPayload = { path: string };
export type ShellOpenExternalPayload = { url: string };
export type DialogOpenPayload = {
  title?: string;
  defaultPath?: string;
  buttonLabel?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
  properties?: Array<
    | 'openFile'
    | 'openDirectory'
    | 'multiSelections'
    | 'showHiddenFiles'
    | 'createDirectory'
    | 'promptToCreate'
    | 'noResolveAliases'
    | 'treatPackageAsDirectory'
    | 'dontAddToRecent'
  >;
  message?: string;
  securityScopedBookmarks?: boolean;
};
export type DialogOpenResult = {
  canceled: boolean;
  filePaths: string[];
  bookmarks?: string[];
};
export type DialogMessagePayload = {
  message: string;
  type?: 'none' | 'info' | 'error' | 'question' | 'warning';
  buttons?: string[];
  defaultId?: number;
  cancelId?: number;
  detail?: string;
  checkboxLabel?: string;
  checkboxChecked?: boolean;
  noLink?: boolean;
  title?: string;
};
export type DialogMessageResult = {
  response: number;
  checkboxChecked?: boolean;
};
export type WindowSyncTrafficLightPayload = { sidebarCollapsed: boolean };

/**
 * Main-owned system notification request. The renderer may ask for a native
 * notification, but only Main decides whether the OS can display it and which
 * window action a click should take. This is deliberately separate from the
 * in-app toast/attention feed.
 */
export type SystemNotificationAttention = 'completion' | 'error' | 'action-required';
export type SystemNotificationRequest = {
  id: string;
  title: string;
  body: string;
  attention: SystemNotificationAttention;
  sessionKey?: string;
  route?: string;
};
export type SystemNotificationResult = HostSuccess & {
  delivered: boolean;
  reason?: string;
};
export type SettingsSnapshot = Partial<{
  theme: 'light' | 'dark' | 'system';
  language: string;
  startMinimized: boolean;
  launchAtStartup: boolean;
  telemetryEnabled: boolean;
  gatewayAutoStart: boolean;
  gatewayPort: number;
  roleMemoryEnabled: boolean;
  memoryEmbeddingEnabled: boolean;
  proxyEnabled: boolean;
  proxyServer: string;
  proxyHttpServer: string;
  proxyHttpsServer: string;
  proxyAllServer: string;
  proxyBypassRules: string;
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  devModeUnlocked: boolean;
  runActivityKeepExpandedOnComplete: boolean;
  setupComplete: boolean;
  /**
   * FP-P1-01: sanitized Setup provider verification state (no key material).
   * 'verified' requires a real credential validation + model check during Setup;
   * 'skipped' marks limited mode until a provider is configured in Settings.
   */
  setupProviderVerification: {
    status: 'unverified' | 'verified' | 'skipped';
    accountId?: string;
    vendorId?: string;
    model?: string;
    checkedAt?: string;
  };
  cdpRemoteControlEnabled: boolean;
  cdpRemoteDebuggingPort: number;
  workProviders: WorkProviderConfig;
  sessionActivityPanelEnabled: boolean;
  chatContextDisplayEnabled: boolean;
  sessionActivityAutoExpand: 'active' | 'attention' | 'never';
  sessionActivityShowGit: boolean;
  sessionActivityShowCommands: boolean;
  sessionRecoveryNotificationsEnabled: boolean;
  desktopNotificationsEnabled: boolean;
  sessionActivityRetentionMinutes: 0 | 5 | 15;
}>;
export type SettingsKey = keyof SettingsSnapshot & string;
export type SettingsValue = SettingsSnapshot[SettingsKey];
export type SettingsGetPayload = { key: SettingsKey };
export type SettingsSetPayload = { key: SettingsKey; value: SettingsValue };
export type SettingsSetManyPayload = { patch: Partial<SettingsSnapshot> };
export type SettingsResetResult = HostSuccess & { settings: SettingsSnapshot };

/**
 * P2 #161: user-visible runtime efficiency sampling surface.
 *
 * The sampler runs in the Main process; these shapes are the only contract the
 * renderer sees. Every value is measured (never estimated): when nothing has
 * been sampled yet the state reports `measured: false` and a null summary so
 * the UI can fail closed to "not sampled" instead of showing a healthy zero.
 */
export type RuntimeEfficiencySampleSource = 'os-cpu' | 'process-memory';
export type RuntimeEfficiencySample = {
  at: number;
  cpuPercent: number;
  rssBytes: number;
  heapUsedBytes: number;
  systemFreeBytes: number;
  systemTotalBytes: number;
  cpuCount: number;
  shed: boolean;
  source: RuntimeEfficiencySampleSource;
};
export type RuntimeEfficiencySummary = {
  sampleCount: number;
  coverageMs: number;
  latest: RuntimeEfficiencySample | null;
  avgCpuPercent: number;
  peakCpuPercent: number;
  peakRssBytes: number;
  shedSampleCount: number;
};
export type RuntimeEfficiencyShedState = {
  shedding: boolean;
  reason: string | null;
  activeReasons: string[];
  transitionCount: number;
  lastTransitionAt: number | null;
};
export type RuntimeBackgroundWorkState = Pick<BackgroundWorkGateState, 'deferring' | 'reason' | 'deferredCount' | 'resumeCount' | 'lastDeferReason' | 'pendingCount' | 'transitionCount'>;
export type RuntimePerformanceMark = {
  name: string;
  at: number;
  fromStartMs: number;
};

export type RuntimePerformanceSpawnSample = {
  method: string;
  at: number;
  fromStartMs: number;
  command: string | null;
};

export type RuntimePerformanceCounterState = {
  spawnCount: number;
  spawnByMethod: Record<string, number>;
  recentSpawns: RuntimePerformanceSpawnSample[];
  activeIntervals: number;
  activeWatchers: number;
  unavailable: string[];
};

export type RuntimePerformanceState = {
  startedAt: number;
  elapsedMs: number;
  marks: RuntimePerformanceMark[];
  counters: RuntimePerformanceCounterState;
  rssBytes: number;
};

export type RuntimeEfficiencyState = {
  /** Persisted user preference. */
  enabled: boolean;
  /** True when the Main sampler timer is actually running. */
  running: boolean;
  /** True once at least one real sample exists in the retained window. */
  measured: boolean;
  /** Bounded rolling summary including the latest sample, or null when unmeasured. */
  summary: RuntimeEfficiencySummary | null;
  /** Bounded rolling raw samples for explicit before/after diagnostics. */
  samples: RuntimeEfficiencySample[];
  /** Load-shed policy state, or null before the policy has been created. */
  shed: RuntimeEfficiencyShedState | null;
  /** Background work gate state, or null while runtime efficiency sampling is stopped. */
  backgroundWork: RuntimeBackgroundWorkState | null;
  /** Local main-process performance counters and startup marks. */
  performance: RuntimePerformanceState;
};
export type RuntimeEfficiencySetEnabledPayload = { enabled: boolean };

/** P0B #213: shadow workspace resource-envelope snapshot. `measured=false` means no trustworthy snapshot exists. */
export type RuntimeResourceEnvelopeState = {
  measured: boolean;
  snapshot: ResourceEnvelopeSnapshot | null;
};

export type WorkspaceSnapshotResult = HostSuccess & WorkspaceSnapshot;
export type WorkspaceCreateResult = WorkspaceSnapshotResult & { createdWorkspace: WorkspaceProfile };

/** FP-P1-02: workspace preflight (run before accepting a directory as workspace). */
export type WorkspacePreflightPayload = { rootPath: string };
export type WorkspacePreflightCheckResult = {
  id: 'exists' | 'readable' | 'writable' | 'git' | 'sensitivePath' | 'diskSpace';
  status: 'ok' | 'warn' | 'fail' | 'info';
  detail: string;
};
export type WorkspacePreflightResult = {
  success: boolean;
  rootPath: string;
  resolvedPath: string;
  ok: boolean;
  readOnlyOnly: boolean;
  isGitRepo: boolean;
  checks: WorkspacePreflightCheckResult[];
  error?: string;
};
export type WorkspaceCreatePayload = {
  activate?: boolean;
  name?: string;
  rootPath: string;
  agentId?: string;
  activeSessionKey?: string;
  permissionMode?: WorkspacePermissionMode;
};
export type WorkspaceUpdatePayload = {
  id: string;
  name?: string;
  rootPath?: string;
  agentId?: string;
  activeSessionKey?: string;
  permissionMode?: WorkspacePermissionMode;
  state?: WorkspaceUiState;
  sessionKey?: string;
};
export type WorkspaceDeletePayload = { id: string };
export type WorkspaceSwitchPayload = { id: string };
export type WorkspaceFolderCreatePayload = {
  workspaceId: string;
  name: string;
  parentId?: string | null;
  kind?: SessionFolder['kind'];
};
export type WorkspaceFolderRenamePayload = {
  workspaceId: string;
  folderId: string;
  name: string;
};
export type WorkspaceFolderDeletePayload = {
  workspaceId: string;
  folderId: string;
};
export type WorkspaceFolderMoveSessionPayload = {
  workspaceId: string;
  sessionKey: string;
  folderId: string | null;
};
export type WorkspaceSaveStatePayload = {
  id: string;
  activeSessionKey?: string;
  state?: WorkspaceUiState;
  sessionKey?: string;
};
export type WorkspaceCoordinatorEnvironmentSelection = {
  kind: WorkspaceCoordinatorEnvironmentBinding['kind'];
  rootPath: string;
  setupProfile?: string | null;
};
export type WorkspaceCoordinatorBindPayload = {
  workspaceId: string;
  agentId: string;
  sessionKey: string;
  expectedRevision?: number;
  taskLedgerNodeIds: string[];
  environment: WorkspaceCoordinatorEnvironmentSelection;
  archiveRestorePolicy: WorkspaceCoordinatorArchiveRestorePolicy;
};
export type WorkspaceCoordinatorResolvePayload = {
  workspaceId: string;
  agentId: string;
  sessionKey: string;
};
export type WorkspaceCoordinatorPausePayload = {
  workspaceId: string;
  agentId: string;
  sessionKey: string;
  expectedRevision: number;
};
export type WorkspaceCoordinatorBindingResult = HostSuccess & {
  binding: WorkspaceCoordinatorBinding | null;
  recovery: WorkspaceCoordinatorRecovery;
};
export type WorkspaceActiveResult = HostSuccess & {
  activeWorkspaceId: string | null;
  activeWorkspace: WorkspaceProfile | null;
};
export type WorkspaceTerminalRunPayload = {
  command: string;
  timeoutMs?: number;
  approvalId?: string;
};
export type WorkspaceTerminalRunResult = HostSuccess & {
  /** Present only when workspace execution admission times out, before any RPC. */
  leaseKind?: 'workspaceExec';
  leaseKey?: string;
  timeoutMs?: number;
  blocked?: boolean;
  approvalRequired?: boolean;
  sandboxDenial?: SandboxDenialDetails;
  approval?: PermissionApprovalEvent;
  timedOut?: boolean;
  reason?: string;
  cwd?: string;
  command?: string;
  exitCode?: number | null;
  stdout?: string;
  stderr?: string;
  durationMs?: number;
  risk?: 'read' | 'write' | 'network' | 'destructive' | 'external-write' | 'none' | 'dangerous';
};
export type WorkspaceTerminalOpenPayload = {
  /** Known managed server ports; reserved before launch. */
  reservedPorts?: number[];
  workspaceId?: string;
  sessionKey?: string;
  /** Optional caller-provided physical generation; Main verifies it with Gateway when supplied. */
  expectedSessionId?: string;
  cwd?: string;
  cols?: number;
  rows?: number;
  approvalId?: string;
  kind?: 'interactive' | 'webPreviewDevServer';
  command?: string;
  /** Keep this terminal alive across renderer teardown; owner default is true. */
  keepOnLeave?: boolean;
};
export type WorkspaceTerminalSessionPayload = {
  sessionId: string;
  workspaceId?: string;
  sessionKey?: string;
  expectedSessionId?: string;
};
export type WorkspaceTerminalWritePayload = WorkspaceTerminalSessionPayload & {
  data: string;
};
export type WorkspaceTerminalResizePayload = WorkspaceTerminalSessionPayload & {
  cols: number;
  rows: number;
};
export type WorkspaceTerminalStatusPayload = {
  workspaceId?: string;
  sessionKey?: string;
  sessionId?: string;
};
export type WorkspaceTerminalListPayload = {
  workspaceId?: string;
  sessionKey?: string;
};
export type WorkspaceTerminalSessionResult = HostSuccess & {
  blocked?: boolean;
  approvalRequired?: boolean;
  approval?: PermissionApprovalEvent;
  reason?: string;
  sessionId?: string | null;
  workspaceId?: string | null;
  sessionKey?: string | null;
  expectedSessionId?: string | null;
  kind?: 'interactive' | 'webPreviewDevServer';
  cwd?: string | null;
  pid?: number | null;
  cols?: number;
  rows?: number;
  status?: 'idle' | 'starting' | 'running' | 'exited' | 'blocked';
  exitCode?: number | null;
  scrollback?: string;
};
export type WorkspaceTerminalListResult = HostSuccess & {
  processReservations?: Array<{
    reservationId: string; owner: string; phase: 'reserved' | 'dispatched' | 'observed' | 'terminal' | 'unknown';
    ports: number[]; rootPids: number[]; limit: number | null; reason?: string;
  }>;
  sessions: Array<Omit<WorkspaceTerminalSessionResult, 'success'>>;
};
export type SessionActivitySnapshotPayload = {
  workspaceId?: string | null;
  sessionKey: string;
};
export type SessionActivitySnapshotResult = HostSuccess & {
  snapshot: SessionActivitySnapshot;
  runtimeAvailable: boolean;
};
export type SessionCollaborationQueryResult = HostSuccess & { page: SessionCollaborationPage };
export type WorkspaceWebPreviewStartPayload = {
  mode?: WorkspacePreviewMode;
  targetPath?: string;
  url?: string;
  launchConfig?: WorkspaceWebPreviewLaunchConfig | null;
  autoOpen?: boolean;
  approvalId?: string;
};
export type WorkspaceWebPreviewDetectPayload = {
  targetPath?: string;
};
export type WorkspaceWebPreviewDetectResult = HostSuccess & {
  configs: WorkspaceWebPreviewLaunchConfig[];
  preferred?: WorkspaceWebPreviewLaunchConfig | null;
  rootPath?: string | null;
};
export type WorkspaceWebPreviewStopPayload = {
  workspaceId?: string;
};
export type WorkspaceWebPreviewStatusPayload = {
  workspaceId?: string;
};
export type WorkspaceWebPreviewResult = HostSuccess & {
  blocked?: boolean;
  approvalRequired?: boolean;
  approval?: PermissionApprovalEvent;
  running?: boolean;
  mode?: WorkspacePreviewMode;
  status?: WorkspaceWebPreviewStatus;
  url?: string | null;
  previewId?: string | null;
  previewUrl?: string | null;
  targetUrl?: string | null;
  rootPath?: string | null;
  targetPath?: string | null;
  port?: number | null;
  processSessionId?: string | null;
  launchConfig?: WorkspaceWebPreviewLaunchConfig | null;
  error?: string;
};
export type PermissionApprovalListResult = HostSuccess & {
  approvals: PermissionApprovalEvent[];
};
export type PermissionApprovalListPayload = {
  workspaceId?: string;
  sessionKey?: string;
  status?: PermissionApprovalEvent['status'] | PermissionApprovalEvent['status'][];
  source?: PermissionApprovalEvent['source'] | PermissionApprovalEvent['source'][];
  includeExpired?: boolean;
  limit?: number;
};
export type PermissionApprovalDecisionPayload = {
  id: string;
  decision: PermissionApprovalDecision;
};
export type PermissionApprovalDecisionResult = HostSuccess & {
  approval?: PermissionApprovalEvent;
};
export type PermissionDecisionEventListPayload = {
  limit?: number;
};
export type PermissionDecisionEventListResult = HostSuccess & {
  events: PermissionDecisionEvent[];
};

/**
 * Area 3 §3.3: Trusted Orchestration Preset — workspace-scoped standing
 * approval for a named orchestration shape (templateId + role set + maxWorkers).
 * Auto-approves matching `orchestrator.run` requests with an audit trail;
 * revoked presets stop matching. The approval gate itself is unchanged.
 */
export type TrustedOrchestrationPreset = {
  id: string;
  workspaceId: string;
  label: string;
  templateId?: string;
  allowedRoles: string[];
  maxWorkers: number;
  approvedAt: string;
  revokedAt?: string;
};
export type OrchestrationPresetListPayload = {
  workspaceId?: string;
  includeRevoked?: boolean;
};
export type OrchestrationPresetListResult = HostSuccess & {
  presets: TrustedOrchestrationPreset[];
};
export type OrchestrationPresetCreatePayload = {
  workspaceId: string;
  label: string;
  templateId?: string;
  allowedRoles: string[];
  maxWorkers: number;
};
export type OrchestrationPresetCreateResult = HostSuccess & {
  preset?: TrustedOrchestrationPreset;
};
export type OrchestrationPresetRevokePayload = {
  workspaceId: string;
  presetId: string;
};
export type OrchestrationPresetRevokeResult = HostSuccess & {
  preset?: TrustedOrchestrationPreset;
};

export type ProjectRulesFileStatus = 'missing' | 'present' | 'empty' | 'tooLarge' | 'unreadable';
export type ProjectRulesIssueSeverity = 'info' | 'warning' | 'error';
export type ProjectRulesIssueSource = 'agents' | 'ruleFile' | 'contextPreview';
export type ProjectRulesIssue = {
  id: string;
  severity: ProjectRulesIssueSeverity;
  source: ProjectRulesIssueSource;
  path?: string;
  relatedPaths?: string[];
  params?: JsonRecord;
};
export type ProjectRulesAgentsFile = {
  path: string;
  relativePath: 'AGENTS.md';
  status: ProjectRulesFileStatus;
  exists: boolean;
  size: number;
  modifiedAt?: string;
  content?: string;
  truncated?: boolean;
  error?: string;
};
export type ProjectRulesRuleFile = {
  name: string;
  path: string;
  relativePath: string;
  status: Exclude<ProjectRulesFileStatus, 'missing'>;
  size: number;
  modifiedAt?: string;
  error?: string;
};
export type ProjectRulesContextPreviewItem = {
  id: 'agents' | 'harnessSpecs' | 'clawxRules';
  status: 'included' | 'available' | 'referenceOnly' | 'missing';
  fileCount?: number;
};
export type ProjectRulesSnapshot = {
  workspace: Pick<WorkspaceProfile, 'id' | 'name' | 'rootPath'> | null;
  agentsFile: ProjectRulesAgentsFile | null;
  ruleFiles: ProjectRulesRuleFile[];
  issues: ProjectRulesIssue[];
  contextPreview: {
    items: ProjectRulesContextPreviewItem[];
  };
  generatedAt: string;
};
export type ProjectRulesExplainPayload = {
  skills?: Array<{ id: string; content: string; trust?: InstructionTrust }>;
  role?: { name: string; content: string; trust?: InstructionTrust };
  turnOverride?: { source?: string; content: string };
};
export type ProjectRulesExplainResult = HostSuccess & InstructionResolution;
export type ProjectRulesExplainLayerKind = InstructionLayerKind;
export type ProjectRulesSnapshotResult = HostSuccess & ProjectRulesSnapshot & {
  templateCreated?: boolean;
};

export type CodeReviewRunPayload = {
  target: CodeReviewTarget;
  focus?: string;
  timeoutMs?: number;
};
export type CodeReviewRunResult = {
  success: boolean;
  error?: RemoteForgeErrorV1;
  review: CodeReviewRun;
};
export type CodeReviewCreateTaskLedgerNodePayload = TaskLedgerWorkspacePayload & {
  runId: string;
  findingId?: string | null;
};
export type CodeReviewCreateTaskLedgerNodeResult = TaskLedgerSnapshotResult & {
  nodeId: string;
};

export type RemoteForgeRepositoryPayload = {
  provider: 'github';
  owner: string;
  repository: string;
};
export type RemoteForgePullRequestReadPayload = RemoteForgeRepositoryPayload & {
  number: number;
};
export type RemoteForgeContentReadPayload = RemoteForgeRepositoryPayload & {
  ref: string;
  paths: string[];
};
export type RemoteForgeMutationBasePayload = RemoteForgePullRequestReadPayload & {
  expectedHeadSha: string;
  approvalId?: string;
};
export type RemoteForgeReviewSubmitPayload = RemoteForgeMutationBasePayload & {
  action: 'review_submit';
  event: 'comment' | 'approve' | 'request_changes';
  body: string;
};
export type RemoteForgeLineCommentCreatePayload = RemoteForgeMutationBasePayload & {
  action: 'line_comment_create';
  path: string;
  side: 'LEFT' | 'RIGHT';
  line: number;
  body: string;
  diffHunk?: string;
};
export type RemoteForgeCommentEditPayload = RemoteForgeMutationBasePayload & {
  action: 'comment_edit';
  commentId: number;
  body: string;
};
export type RemoteForgeThreadReplyPayload = RemoteForgeMutationBasePayload & {
  action: 'thread_reply';
  commentId: number;
  body: string;
};
export type RemoteForgeMetadataUpdatePayload = RemoteForgeMutationBasePayload & {
  action: 'metadata_update';
  expectedUpdatedAt: string;
  title?: string;
  body?: string;
  labels?: string[];
  reviewers?: string[];
};
export type RemoteForgeMutationPayload =
  | RemoteForgeReviewSubmitPayload
  | RemoteForgeLineCommentCreatePayload
  | RemoteForgeCommentEditPayload
  | RemoteForgeThreadReplyPayload
  | RemoteForgeMetadataUpdatePayload;
export type RemoteForgeCapabilitiesResult = {
  success: boolean;
  capability: RemoteForgeCapabilityMatrix;
  error?: RemoteForgeErrorV1;
};
export type RemoteForgePullRequestReadResult = {
  success: boolean;
  pullRequest?: RemoteForgePullRequestReadV1;
  error?: RemoteForgeErrorV1;
};
export type RemoteForgeContentReadResult = {
  success: boolean;
  contents: RemoteForgeContent[];
  error?: RemoteForgeErrorV1;
};
export type RemoteForgeMutationResult = {
  success: boolean;
  blocked?: boolean;
  approvalRequired?: boolean;
  approval?: PermissionApprovalEvent;
  binding?: RemoteForgeMutationBinding;
  mutation?: RemoteForgeMutationV1;
  error?: RemoteForgeErrorV1;
};
export type RemoteForgeMergePayload = RemoteForgePullRequestReadPayload & {
  expectedHeadSha: string;
  strategy: RemoteForgeMergeStrategy;
  commitTitle?: string;
  commitMessage?: string;
  approvalId?: string;
  expectedReadinessDigest?: string;
  expectedPolicyDigest?: string;
};
export type RemoteForgeMergeResult = {
  success: boolean;
  blocked?: boolean;
  approvalRequired?: boolean;
  approval?: PermissionApprovalEvent;
  binding?: RemoteForgeMutationBinding;
  mutation?: RemoteForgeMutationV1;
  readiness?: RemoteForgeReadiness;
  policy?: RemoteForgeMergePolicyDecision;
  error?: RemoteForgeErrorV1;
};

export type GatewayControlUiPayload = {
  view?: 'dreams';
  /** When true (default), Main opens Control UI; token never returns to Renderer. */
  open?: boolean;
};
export type GatewayControlUiResult = HostSuccess & {
  /** @deprecated P4-001: never returned to Renderer (token-bearing URL stays in Main). */
  url?: string;
  /** @deprecated P4-001: never returned to Renderer as plaintext. */
  token?: string;
  port?: number;
  /** Whether Main successfully opened the system browser. */
  opened?: boolean;
  /** Whether a gateway token exists without revealing its value. */
  hasToken?: boolean;
};
export type GatewayCopyTokenResult = HostSuccess;
export type GatewayHealthPayload = { probe?: boolean };
export type GatewayRpcPayload = {
  method: string;
  params?: unknown;
  timeoutMs?: number;
  approvalId?: string;
  expectedWorkspaceId?: string;
};

export type LocalControlPlaneReportKind =
  | 'context'
  | 'model_router'
  | 'capability'
  | 'evidence'
  | 'mission';
export type LocalControlPlaneReportMode = 'observe';
export type LocalControlPlaneDiagnosticSeverity = 'info' | 'warning' | 'error';
export type LocalControlPlaneJsonPrimitive = string | number | boolean | null;
export type LocalControlPlaneJsonValue =
  | LocalControlPlaneJsonPrimitive
  | LocalControlPlaneJsonValue[]
  | { [key: string]: LocalControlPlaneJsonValue };
export type LocalControlPlaneJsonObject = { [key: string]: LocalControlPlaneJsonValue };
export type LocalControlPlaneEvidenceRef = {
  type: string;
  ref: string;
  label?: string;
  summary?: string;
  metadata?: LocalControlPlaneJsonObject;
};
export type LocalControlPlaneDiagnostic = {
  code: string;
  severity: LocalControlPlaneDiagnosticSeverity;
  message: string;
  metadata?: LocalControlPlaneJsonObject;
};
export type LocalControlPlaneReport = {
  schema: 'openclaw.local-control-plane.report.v1';
  id: string;
  kind: LocalControlPlaneReportKind;
  mode: LocalControlPlaneReportMode;
  legacyUnaffected: true;
  timestamp: string;
  sessionKey?: string;
  runId?: string;
  taskId?: string;
  summary: string;
  diagnostics: LocalControlPlaneDiagnostic[];
  evidenceRefs: LocalControlPlaneEvidenceRef[];
  payload?: LocalControlPlaneJsonValue;
};
export type LocalControlPlaneFlags = Record<
  'contextReport' | 'modelRouterReport' | 'capabilityReport' | 'evidenceReport' | 'missionReport',
  boolean
>;
export type LocalControlPlaneStatus = {
  schema: 'openclaw.local-control-plane.status.v1';
  mode: LocalControlPlaneReportMode;
  legacyUnaffected: true;
  flags: LocalControlPlaneFlags;
  enabledKinds: LocalControlPlaneReportKind[];
  buffer: {
    size: number;
    maxSize: number;
    lastReportAt: string | null;
  };
  countsByKind: Record<LocalControlPlaneReportKind, number>;
};
export type LocalControlPlaneReportFilter = {
  kind?: LocalControlPlaneReportKind;
  sessionKey?: string;
  runId?: string;
  taskId?: string;
  limit?: number;
};
export type LocalControlPlaneCorrelationGroupBy = 'task' | 'run' | 'session' | 'evidence';
export type LocalControlPlaneCorrelationFilter = LocalControlPlaneReportFilter & {
  groupBy?: LocalControlPlaneCorrelationGroupBy;
  evidenceType?: string;
  evidenceRef?: string;
};
export type LocalControlPlaneCorrelationGroup = {
  key: string;
  groupBy: LocalControlPlaneCorrelationGroupBy;
  sessionKey?: string;
  runId?: string;
  taskId?: string;
  evidenceRefs: LocalControlPlaneEvidenceRef[];
  reportIds: string[];
  kinds: LocalControlPlaneReportKind[];
  reportCount: number;
  firstReportAt: string;
  lastReportAt: string;
  diagnosticsBySeverity: Record<LocalControlPlaneDiagnosticSeverity, number>;
  diagnosticCodes: string[];
};
export type LocalControlPlaneCorrelationSummary = {
  schema: 'openclaw.local-control-plane.correlations.v1';
  mode: LocalControlPlaneReportMode;
  legacyUnaffected: true;
  generatedAt: string;
  filter: LocalControlPlaneCorrelationFilter;
  totals: {
    reportCount: number;
    groupCount: number;
    evidenceRefCount: number;
  };
  groups: LocalControlPlaneCorrelationGroup[];
};
export type LocalControlPlaneStatusResult = HostSuccess & {
  status: LocalControlPlaneStatus;
};
export type LocalControlPlaneReportsResult = HostSuccess & {
  reports: LocalControlPlaneReport[];
};
export type LocalControlPlaneCorrelationsResult = HostSuccess & {
  correlations: LocalControlPlaneCorrelationSummary;
};

export type RemoteControlStatusResult = HostSuccess & {
  configuredEnabled: boolean;
  configuredPort: number;
  effectiveEnabled: boolean;
  effectivePort: number | null;
  endpoint?: string | null;
  envOverride: boolean;
  restartRequired: boolean;
};
export type RemoteControlInspectTarget = {
  id?: string;
  title?: string;
  type?: string;
  url?: string;
  webSocketDebuggerUrl?: string;
};
export type RemoteControlInspectResult = HostSuccess & {
  endpoint?: string | null;
  webSocketDebuggerUrl?: string | null;
  browser?: string | null;
  protocolVersion?: string | null;
  targets: RemoteControlInspectTarget[];
};
export type RemoteControlTargetPayload = {
  targetId?: string;
  urlIncludes?: string;
};
export type RemoteControlEvaluatePayload = RemoteControlTargetPayload & {
  expression: string;
};
export type RemoteControlClickPayload = RemoteControlTargetPayload & (
  | { selector: string; x?: never; y?: never }
  | { selector?: never; x: number; y: number }
);
export type RemoteControlScrollPayload = RemoteControlTargetPayload & {
  deltaX?: number;
  deltaY?: number;
  selector?: string;
};
export type RemoteControlScreenshotPayload = RemoteControlTargetPayload & {
  fullPage?: boolean;
  format?: 'png' | 'jpeg' | 'webp';
  quality?: number;
  /** Optional viewport sub-rect (CSS pixels) to capture instead of the full page. */
  clip?: { x: number; y: number; width: number; height: number; scale?: number };
  /** Optional one-time sensitive-capture grant id (P7-003). */
  grantId?: string;
};
export type RemoteControlPageInfoResult = HostSuccess & {
  target?: RemoteControlInspectTarget;
  title?: string;
  url?: string;
  viewport?: { width: number; height: number; deviceScaleFactor: number };
  scroll?: { x: number; y: number; width: number; height: number };
  textSample?: string;
};
export type RemoteControlEvaluateResult = HostSuccess & {
  value?: unknown;
  description?: string;
};
export type RemoteControlActionResult = HostSuccess & {
  target?: RemoteControlInspectTarget;
};
export type RemoteControlScreenshotResult = HostSuccess & {
  target?: RemoteControlInspectTarget;
  dataUrl?: string;
  format: 'png' | 'jpeg' | 'webp';
};

export type AgentBrowserSessionMode = 'headless' | 'visible';
export type AgentBrowserAuthPersistenceMode = 'session-name' | 'profile' | 'off';
export type AgentBrowserConnectionMode = 'managed' | 'auto-connect' | 'cdp' | 'external-profile';
export type AgentBrowserRuntimeMode = 'normal_restricted' | 'controlled_enhanced' | 'full_access';
export type AgentBrowserConnectionSnapshot = {
  mode: AgentBrowserConnectionMode;
  cdpEndpoint?: string;
  externalProfile?: string;
  executablePath?: string;
};
/** Origin context for a browser session created from a ClawX workspace. */
export type AgentBrowserWorkspaceContext = {
  workspaceId?: string;
  sessionKey?: string;
  agentId?: string;
};
export type AgentBrowserSession = {
  id: string;
  profile: string;
  mode: AgentBrowserSessionMode;
  authPersistence?: AgentBrowserAuthPersistenceMode;
  authStateName?: string;
  connection?: AgentBrowserConnectionSnapshot;
  url?: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
  runtimeMode?: AgentBrowserRuntimeMode;
} & AgentBrowserWorkspaceContext;
export type AgentBrowserSecurityPayload = {
  authPersistence?: AgentBrowserAuthPersistenceMode;
  authStateName?: string;
  connectionMode?: AgentBrowserConnectionMode;
  cdpEndpoint?: string;
  externalProfile?: string;
  executablePath?: string;
  allowExternalBrowser?: boolean;
};
export type AgentBrowserOpenPayload = {
  url?: string;
  profile?: string;
  mode?: AgentBrowserSessionMode;
  width?: number;
  height?: number;
  runtimeMode?: AgentBrowserRuntimeMode;
} & AgentBrowserSecurityPayload & AgentBrowserWorkspaceContext;
export type AgentBrowserSessionPayload = {
  sessionId: string;
};
export type AgentBrowserNavigatePayload = AgentBrowserSessionPayload & {
  url: string;
  waitUntil?: 'dom-ready' | 'load';
};
export type AgentBrowserSelectorPayload = AgentBrowserSessionPayload & {
  selector: string;
  timeoutMs?: number;
};
export type AgentBrowserClickPayload = AgentBrowserSelectorPayload;
export type AgentBrowserTypePayload = AgentBrowserSelectorPayload & {
  text: string;
  clear?: boolean;
};
export type AgentBrowserEvaluatePayload = AgentBrowserSessionPayload & {
  expression: string;
};
export type AgentBrowserScreenshotPayload = AgentBrowserSessionPayload & {
  fullPage?: boolean;
  /** Optional one-time sensitive-capture grant id (P7-003). */
  grantId?: string;
};
export type AgentBrowserTakeSnapshotPayload = AgentBrowserSessionPayload;
export type AgentBrowserClickByUidPayload = AgentBrowserSessionPayload & {
  uid: string;
};
export type AgentBrowserFillByUidPayload = AgentBrowserSessionPayload & {
  uid: string;
  value: string;
  clear?: boolean;
};
export type AgentBrowserPressKeyPayload = AgentBrowserSessionPayload & {
  key: string;
};
export type AgentBrowserRequestModeUpgradePayload = AgentBrowserSessionPayload & {
  targetMode: AgentBrowserRuntimeMode;
  reason?: string;
  expiresInMs?: number;
  /** Required true for upgrades above normal_restricted (user approval gate). */
  userApproval?: boolean;
};
export type AgentBrowserRequestModeUpgradeResult = AgentBrowserActionResult & {
  runtimeMode: AgentBrowserRuntimeMode;
  expiresAt?: string;
};
export type AgentBrowserRespondBoundaryChoicePayload = AgentBrowserSessionPayload & {
  requestId: string;
  selectedChoiceIds: string[];
  otherText?: string;
};
export type AgentBrowserRespondBoundaryChoiceResult = HostSuccess & {
  accepted: boolean;
};
export type AgentBrowserCommandPayload = Partial<AgentBrowserSessionPayload> & {
  args: string[];
  globalOptions?: string[];
  profile?: string;
  mode?: AgentBrowserSessionMode;
  timeoutMs?: number;
  maxOutput?: number;
  /** Optional one-time sensitive-capture grant id (P7-003). */
  grantId?: string;
} & AgentBrowserSecurityPayload;
export type AgentBrowserProfileEntry = {
  profile: string;
  label?: string;
  description?: string;
  authStateName?: string;
  createdAt?: string;
  updatedAt?: string;
  lastUsedAt?: string;
  activeSessions?: number;
  source: 'metadata' | 'profile-dir' | 'session';
};
export type AgentBrowserProfilesResult = HostSuccess & {
  profiles: AgentBrowserProfileEntry[];
};
export type AgentBrowserProfileSavePayload = {
  profile: string;
  label?: string;
  description?: string;
  authStateName?: string;
};
export type AgentBrowserProfileSaveResult = HostSuccess & {
  profile: AgentBrowserProfileEntry;
};
export type AgentBrowserValidatePayload = AgentBrowserOpenPayload & {
  /** R5-1: canonical run id (e.g. `cron:<jobId>:<startedAt>`). When provided, validate() records it verbatim instead of minting a new UUID. */
  runId?: string;
  expectedDomains?: string[];
  diagnostics?: {
    snapshot?: boolean;
    console?: boolean;
    errors?: boolean;
    network?: boolean;
    screenshot?: boolean;
  };
};
export type AgentBrowserArtifactKind = 'snapshot' | 'console' | 'errors' | 'network' | 'screenshot' | 'text' | 'manifest';
export type AgentBrowserArtifactRef = {
  id: string;
  kind: AgentBrowserArtifactKind;
  label: string;
  path?: string;
  mimeType?: string;
  size?: number;
  createdAt: string;
};
export type BrowserAutomationRunStep = {
  id: string;
  label: string;
  status: 'passed' | 'failed' | 'skipped';
  detail?: string;
  startedAt?: string;
  endedAt?: string;
};
export type BrowserAutomationRunResult = {
  schemaVersion: 1;
  runId: string;
  status: 'success' | 'failed';
  startedAt: string;
  endedAt: string;
  profile?: string;
  authStateName?: string;
  finalUrl?: string;
  title?: string;
  loginState: 'unknown' | 'authenticated' | 'login-required';
  steps: BrowserAutomationRunStep[];
  evidence: {
    textSample?: string;
    artifacts: AgentBrowserArtifactRef[];
  };
  consoleErrors?: string[];
  networkErrors?: string[];
  error?: string;
};
export type AgentBrowserValidateResult = HostSuccess & {
  ok: boolean;
  session?: AgentBrowserSession;
  url?: string;
  title?: string;
  textSample?: string;
  screenshotDataUrl?: string;
  diagnostics?: Record<string, unknown>;
  runResult?: BrowserAutomationRunResult;
  error?: string;
};
export type AgentBrowserSessionResult = HostSuccess & {
  session: AgentBrowserSession;
  textSample?: string;
};
export type AgentBrowserStatusResult = HostSuccess & {
  sessions: AgentBrowserSession[];
  browserControlEnabled?: boolean;
};
export type AgentBrowserSetEnabledPayload = {
  enabled: boolean;
};
export type AgentBrowserSetEnabledResult = HostSuccess & {
  enabled: boolean;
};
export type AgentBrowserActionResult = HostSuccess & {
  session: AgentBrowserSession;
};
export type AgentBrowserFacadeResult = HostSuccess & {
  ok?: boolean;
  content?: string;
  data?: unknown;
  evidence?: unknown[];
  error?: { code: string; message: string; details?: Record<string, unknown> } | string;
};
export type AgentBrowserEvaluateResult = AgentBrowserActionResult & {
  value?: unknown;
};
export type AgentBrowserScreenshotResult = AgentBrowserActionResult & {
  dataUrl: string;
  format: 'png';
};
export type AgentBrowserTakeSnapshotResult = AgentBrowserActionResult & {
  snapshot: string;
};
export type AgentBrowserNetworkFilter = {
  urlIncludes?: string;
  method?: string;
  resourceType?: string;
  status?: number;
  limit?: number;
  timeoutMs?: number;
};
export type AgentBrowserNetworkListPayload = AgentBrowserSessionPayload & {
  filter?: AgentBrowserNetworkFilter;
  redacted?: boolean;
};
export type AgentBrowserNetworkListResult = HostSuccess & {
  requests: Array<{
    id: string;
    url: string;
    method: string;
    status?: number;
    statusText?: string;
    mimeType?: string;
    resourceType?: string;
    failed?: boolean;
    error?: string;
  }>;
};
export type AgentBrowserNetworkDetailPayload = AgentBrowserSessionPayload & {
  requestIds: string[];
  redacted?: boolean;
};
export type AgentBrowserNetworkDetailResult = HostSuccess & {
  details: unknown[];
};
export type AgentBrowserNetworkClearPayload = AgentBrowserSessionPayload;
export type AgentBrowserNetworkClearResult = HostSuccess;
export type AgentBrowserNetworkWaitPayload = AgentBrowserSessionPayload & {
  filter?: AgentBrowserNetworkFilter;
  redacted?: boolean;
};
export type AgentBrowserNetworkWaitResult = AgentBrowserNetworkListResult;
export type AgentBrowserNetworkComparePayload = AgentBrowserSessionPayload & {
  requestIds: string[];
  redacted?: boolean;
};
export type AgentBrowserNetworkCompareResult = HostSuccess & {
  comparison: string;
};
export type AgentBrowserNetworkFindParamsPayload = AgentBrowserSessionPayload & {
  requestIds: string[];
  redacted?: boolean;
};
export type AgentBrowserNetworkFindParamsResult = HostSuccess & {
  candidates: string;
};
export type AgentBrowserNetworkExtractJsPayload = AgentBrowserSessionPayload & {
  requestIds?: string[];
  keywords?: string[];
  urlIncludes?: string;
  redacted?: boolean;
};
export type AgentBrowserNetworkExtractJsResult = HostSuccess & {
  candidates: string;
};
export type AgentBrowserJsListResourcesPayload = AgentBrowserSessionPayload;
export type AgentBrowserJsListResourcesResult = HostSuccess & {
  resources: JsSourceResource[];
  content: string;
};
export type AgentBrowserJsSearchSourcesPayload = AgentBrowserSessionPayload & {
  keywords: string[];
  urls?: string[];
  limit?: number;
  allowSameOriginFetch?: boolean;
};
export type AgentBrowserJsSearchSourcesResult = HostSuccess & {
  resources: JsSourceResource[];
  matches: JsSourceMatch[];
  failedFetches: JsSourceFetchFailure[];
  truncated: boolean;
  content: string;
};
export type AgentBrowserJsExtractContextPayload = AgentBrowserSessionPayload & {
  resourceId: string;
  position: number;
};
export type AgentBrowserJsExtractContextResult = HostSuccess & {
  resources: JsSourceResource[];
  contexts: JsSourceContext[];
  truncated: boolean;
  content: string;
};
export type AgentBrowserSourceMapListCandidatesPayload = AgentBrowserSessionPayload & {
  resourceIds?: string[];
  limit?: number;
  allowSameOriginFetch?: boolean;
};
export type AgentBrowserSourceMapListCandidatesResult = HostSuccess & {
  candidates: SourceMapCandidate[];
  failures: Array<{ resourceId?: string; url?: string; message: string }>;
  truncated: boolean;
  content: string;
};
export type AgentBrowserSourceMapResolveLocationPayload = AgentBrowserSessionPayload & {
  resourceId: string;
  line: number;
  column: number;
  allowSameOriginFetch?: boolean;
};
export type AgentBrowserSourceMapResolveLocationResult = HostSuccess & {
  candidates: SourceMapCandidate[];
  resolvedLocations: SourceMapResolvedLocation[];
  failures: Array<{ resourceId?: string; url?: string; message: string }>;
  content: string;
};
export type AgentBrowserSourceMapExtractOriginalContextPayload = AgentBrowserSessionPayload & {
  resourceId: string;
  line: number;
  column: number;
  radius?: number;
  allowSameOriginFetch?: boolean;
};
export type AgentBrowserSourceMapExtractOriginalContextResult = HostSuccess & {
  candidates: SourceMapCandidate[];
  resolvedLocations: SourceMapResolvedLocation[];
  originalContexts: SourceMapOriginalContext[];
  failures: Array<{ resourceId?: string; url?: string; message: string }>;
  truncated: boolean;
  content: string;
};
export type AgentBrowserRuntimeInspectGlobalsPayload = AgentBrowserSessionPayload & {
  paths: string[];
  maxDepth?: number;
  limit?: number;
};
export type AgentBrowserRuntimeInspectGlobalsResult = HostSuccess & {
  content: string;
  isError?: boolean;
};
export type AgentBrowserRuntimeSearchModulesPayload = AgentBrowserSessionPayload & {
  keywords: string[];
  limit?: number;
  radius?: number;
};
export type AgentBrowserRuntimeSearchModulesResult = HostSuccess & {
  content: string;
  isError?: boolean;
};
export type AgentBrowserRuntimeDescribeFunctionPayload = AgentBrowserSessionPayload & {
  path: string;
  keywords?: string[];
  radius?: number;
};
export type AgentBrowserRuntimeDescribeFunctionResult = HostSuccess & {
  content: string;
  isError?: boolean;
};
export type AgentBrowserReplayPrepareRequestPayload = AgentBrowserSessionPayload & {
  requestId: string;
};
export type AgentBrowserReplayPrepareRequestResult = HostSuccess & {
  content: string;
  isError?: boolean;
};
export type AgentBrowserReplaySendRequestPayload = AgentBrowserSessionPayload & {
  draftId: string;
};
export type AgentBrowserReplaySendRequestResult = HostSuccess & {
  content: string;
  isError?: boolean;
};
export type AgentBrowserReplayCompareResponsesPayload = AgentBrowserSessionPayload & {
  draftId: string;
};
export type AgentBrowserReplayCompareResponsesResult = HostSuccess & {
  content: string;
  isError?: boolean;
};
export type AgentBrowserConsoleMessagesPayload = AgentBrowserSessionPayload;
export type AgentBrowserConsoleMessagesResult = HostSuccess & {
  content: string;
};
export type AgentBrowserFullAccessExecuteScriptPayload = AgentBrowserSessionPayload & {
  script: string;
  awaitPromise?: boolean;
};
export type AgentBrowserFullAccessExecuteScriptResult = HostSuccess & {
  content: string;
  isError?: boolean;
};
export type AgentBrowserFullAccessFetchPayload = AgentBrowserSessionPayload & {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  credentials?: 'include' | 'same-origin' | 'omit';
};
export type AgentBrowserFullAccessFetchResult = HostSuccess & {
  content: string;
  isError?: boolean;
};
export type AgentBrowserFullAccessGetNetworkDetailsPayload = AgentBrowserSessionPayload & {
  requestIds: string[];
};
export type AgentBrowserFullAccessGetNetworkDetailsResult = HostSuccess & {
  content: string;
  isError?: boolean;
  toolAttachments?: unknown[];
};
export type AgentBrowserFullAccessReadStoragePayload = AgentBrowserSessionPayload;
export type AgentBrowserFullAccessReadStorageResult = HostSuccess & {
  content: string;
  isError?: boolean;
};
export type AgentBrowserFullAccessRevokePayload = AgentBrowserSessionPayload;
export type AgentBrowserFullAccessRevokeResult = HostSuccess & {
  content: string;
  isError?: boolean;
};
export type AgentBrowserExtractPageTextRule = {
  id: string;
  alias: string;
  urlPattern: string;
  selectorsText: string;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
};
export type AgentBrowserExtractPageTextPayload = AgentBrowserSessionPayload & {
  rules: AgentBrowserExtractPageTextRule[];
  maxLength?: number;
  extractMode?: 'text' | 'all';
  selectorType?: 'css' | 'xpath';
  allowFallback?: boolean;
};
export type AgentBrowserExtractPageTextResult = HostSuccess & {
  text: string;
  truncated: boolean;
  usedFallback: boolean;
  matchedRuleId?: string;
};
export type AgentBrowserValidateExtractionRulePayload = {
  alias: string;
  urlPattern: string;
  selectorsText: string;
};
export type AgentBrowserValidateExtractionRuleResult = HostSuccess & {
  ok: boolean;
  message?: string;
};
export type AgentBrowserPageInfo = {
  pageId: string;
  index: number;
  url: string;
  title: string;
  active: boolean;
};
export type AgentBrowserNewPagePayload = AgentBrowserSessionPayload & {
  url?: string;
  background?: boolean;
};
export type AgentBrowserSelectPagePayload = AgentBrowserSessionPayload & {
  pageId: string;
};
export type AgentBrowserClosePagePayload = AgentBrowserSessionPayload & {
  pageId?: string;
};
export type AgentBrowserNavigatePagePayload = AgentBrowserSessionPayload & {
  url: string;
  pageId?: string;
  waitUntil?: 'dom-ready' | 'load';
};
export type AgentBrowserListPagesResult = AgentBrowserActionResult & {
  pages: AgentBrowserPageInfo[];
  activePageId?: string;
};
export type AgentBrowserCommandResult = HostSuccess & {
  session?: AgentBrowserSession;
  data?: unknown;
  stdout: string;
  stderr: string;
  command: string[];
};
export type AgentBrowserTaskStatus =
  | 'queued'
  | 'running'
  | 'waiting-approval'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted';
export type AgentBrowserTaskRecovery = {
  recoveredFrom: AgentBrowserTaskStatus;
  reason: 'app-restart-while-running';
  recoveredAt: string;
};
export type AgentBrowserTaskStepAction = 'navigate' | 'wait-for-selector' | 'click';
export type AgentBrowserTaskStepStatus = 'pending' | 'running' | 'passed' | 'failed' | 'cancelled';
export type AgentBrowserTaskStepInput = {
  action: AgentBrowserTaskStepAction;
  url?: string;
  selector?: string;
  timeoutMs?: number;
};
export type AgentBrowserTaskStep = AgentBrowserTaskStepInput & {
  id: string;
  status: AgentBrowserTaskStepStatus;
  startedAt?: string;
  endedAt?: string;
  errorCode?: string;
  error?: string;
};
export type AgentBrowserTaskSuccessCriteria = {
  kind: 'url-includes' | 'text-includes' | 'selector-visible';
  value: string;
  timeoutMs?: number;
};
export type AgentBrowserTaskVerification = AgentBrowserTaskSuccessCriteria & {
  status: 'passed' | 'failed';
  reasonCode: string;
  message: string;
  checkedAt: string;
};
export type AgentBrowserTaskApproval = {
  status: 'pending' | 'approved' | 'consumed' | 'rejected';
  requestedAt: string;
  decidedAt?: string;
  consumedAt?: string;
};
export type AgentBrowserTaskCounters = {
  totalSteps: number;
  passedSteps: number;
  failedSteps: number;
};
export type AgentBrowserTask = {
  id: string;
  name: string;
  url: string;
  objective: string;
  successCondition?: string;
  profile: string;
  mode: AgentBrowserSessionMode;
  allowedDomains: string[];
  permissionScope: Array<'navigate' | 'read-page' | 'interact-page'>;
  steps: AgentBrowserTaskStep[];
  successCriteria?: AgentBrowserTaskSuccessCriteria;
  verification?: AgentBrowserTaskVerification;
  approval: AgentBrowserTaskApproval;
  counters: AgentBrowserTaskCounters;
  status: AgentBrowserTaskStatus;
  statusExplain?: string;
  retryCount: number;
  createdAt: string;
  updatedAt: string;
  sessionId?: string;
  runId?: string;
  errorCode?: string;
  error?: string;
  recovery?: AgentBrowserTaskRecovery;
} & AgentBrowserWorkspaceContext;
export type AgentBrowserTaskCreatePayload = Pick<
  AgentBrowserTask,
  'name' | 'url' | 'objective' | 'successCondition' | 'profile' | 'mode'
> & {
  allowedDomains?: string[];
  steps?: AgentBrowserTaskStepInput[];
  successCriteria?: AgentBrowserTaskSuccessCriteria;
} & AgentBrowserWorkspaceContext;
export type AgentBrowserTaskPayload = { taskId: string };
export type AgentBrowserTasksResult = HostSuccess & { tasks: AgentBrowserTask[] };
export type AgentBrowserTaskResult = HostSuccess & { task: AgentBrowserTask };
export type AgentBrowserCredentialMetadata = {
  id: string;
  profile: string;
  origin: string;
  username: string;
  createdAt: string;
  updatedAt: string;
};
export type AgentBrowserVaultState =
  | 'not_configured'
  | 'ready'
  | 'corrupted'
  | 'encryption_unavailable';
export type AgentBrowserVaultHealth = {
  state: AgentBrowserVaultState;
  path: string;
  credentialCount: number;
  errorCode?: 'VAULT_NOT_CONFIGURED' | 'VAULT_CORRUPTED' | 'VAULT_ENCRYPTION_UNAVAILABLE';
  errorMessage?: string;
};
export type AgentBrowserVaultHealthResult = HostSuccess & {
  health: AgentBrowserVaultHealth;
};
export type AgentBrowserCredentialSavePayload = {
  id?: string;
  profile: string;
  origin: string;
  username: string;
  password: string;
};
export type AgentBrowserCredentialPayload = { credentialId: string };
export type AgentBrowserVaultResult = HostSuccess & {
  credentials: AgentBrowserCredentialMetadata[];
};
export type AgentBrowserCredentialResult = HostSuccess & {
  credential: AgentBrowserCredentialMetadata;
};

export type McpServerListResult = HostSuccess & {
  servers: McpServerConfig[];
};
export type McpServerCreatePayload = {
  name: string;
  localAddress?: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  cwd?: string;
  url?: string;
  env?: Record<string, string | { kind: 'secret-ref'; secretId: string }>;
  headers?: Record<string, string>;
  sslVerify?: boolean;
  enabled?: boolean;
  scope?: McpScope;
  ownerId?: string;
  exposure?: McpExposureConfig;
  toolAllowlist?: string[];
  toolDenylist?: string[];
  permissionMode?: WorkspacePermissionMode;
  sandboxProfileId?: string;
  networkPolicy?: McpNetworkPolicy;
};
export type McpServerUpdatePayload = Partial<McpServerCreatePayload> & { id: string };
export type McpServerDeletePayload = { id: string };
export type McpServerTestPayload = { id?: string; server?: McpServerCreatePayload };
export type McpServerResolvePayload = { workspaceId?: string | null; agentId?: string | null };
export type McpServerResolveResult = HostSuccess & McpResolvedConfig;
export type McpManagementContext = {
  sessionKey?: string;
  expectedSessionGeneration?: string;
  catalogRevision?: string;
  workspaceId?: string | null;
  agentId?: string | null;
};
export type McpListToolsPayload = McpManagementContext & { serverId: string };
export type McpHeartbeatPayload = McpManagementContext & { serverId: string };
export type McpCallToolPayload = McpManagementContext & {
  serverId: string;
  toolName: string;
  args?: Record<string, unknown>;
  approvalId?: string;
};
export type McpReloadRuntimePayload = { workspaceId?: string | null; agentId?: string | null };

export type HookTrustStateView = 'trusted' | 'untrusted' | 'changed' | 'disabled';
export type HookTrustEntryView = {
  hookKey: string;
  name: string;
  source: string;
  managed: boolean;
  trustState: HookTrustStateView;
  hash: string | null;
  expectedHash: string | null;
  enabled: boolean;
  loadable: boolean;
  reason: string;
  filePath: string;
};
export type HookListResult = HostSuccess & {
  hooks: HookTrustEntryView[];
};
export type HookSetTrustedPayload = {
  hookKey: string;
  trusted?: boolean;
  enabled?: boolean;
};
export type HookTrustMutationResult = HookListResult & {
  hookKey: string;
  trustState: HookTrustStateView;
};
export type SandboxStatusResult = HostSuccess & SandboxStatus;
export type SandboxDetectProvidersResult = HostSuccess & {
  providers: SandboxProviderStatus[];
};
export type SandboxUpdateProfilePayload = Partial<SandboxProfile> & { id?: string };
export type SandboxUpdateProfileResult = HostSuccess & { profile: SandboxProfile };
export type SandboxExplainPayload = { workspaceId?: string | null; agentId?: string | null };
export type SandboxExplainResult = HostSuccess & {
  status: SandboxStatus;
  explain: string[];
  explanation: SandboxExplanation;
};

export type LogContentResult = { content: string };
export type LogDirResult = { dir: string | null };
export type LogFilePathResult = { path: string | null };
export type LogRecentPayload = { tailLines?: number };
export type LogMemoryPayload = { count?: number };
export type LogReadFilePayload = { path: string; tailLines?: number };
export type LogFileEntry = {
  path: string;
  name?: string;
  size?: number;
  mtime?: number;
};
export type LogFilesResult = { files: LogFileEntry[] };

export type GatewayHealthSummary = {
  state: 'healthy' | 'degraded' | 'unresponsive';
  reasons: string[];
  consecutiveHeartbeatMisses: number;
  lastAliveAt?: number;
  lastRpcSuccessAt?: number;
  lastRpcFailureAt?: number;
  lastRpcFailureMethod?: string;
  lastChannelsStatusOkAt?: number;
  lastChannelsStatusFailureAt?: number;
};

export type ChannelRuntimeStatus = 'connected' | 'connecting' | 'degraded' | 'disconnected' | 'error';
export type ChannelAccountItem = {
  accountId: string;
  name: string;
  configured: boolean;
  connected?: boolean;
  running?: boolean;
  linked?: boolean;
  status: ChannelRuntimeStatus;
  statusReason?: string;
  lastError?: string;
  isDefault: boolean;
  agentId?: string;
  accessPolicy?: ChannelAccessPolicyView;
};
export type ChannelGroupItem = {
  channelType: string;
  defaultAccountId: string;
  status: ChannelRuntimeStatus;
  statusReason?: string;
  accessPolicy?: ChannelAccessPolicyView;
  accounts: ChannelAccountItem[];
};
export type ChannelTargetOption = {
  value: string;
  label: string;
  kind: 'user' | 'group' | 'channel';
};
export type ChannelAccountsPayload = {
  mode?: 'config' | 'runtime';
  configOnly?: boolean;
  probe?: boolean;
};
export type ChannelAccountsResult = HostSuccess & {
  channels?: ChannelGroupItem[];
  gatewayHealth?: GatewayHealthSummary;
};
export type ChannelTargetsPayload = {
  channelType: string;
  accountId?: string;
  query?: string;
};
export type ChannelTargetsResult = HostSuccess & {
  channelType?: string;
  accountId?: string;
  targets?: ChannelTargetOption[];
};
export type ChannelTypePayload = { channelType: string };
export type ChannelAccountPayload = ChannelTypePayload & { accountId?: string };
export type ChannelRequiredAccountPayload = ChannelTypePayload & { accountId: string };
export type ChannelBindingSavePayload = ChannelRequiredAccountPayload & { agentId: string };
export type ChannelBindingDeletePayload = ChannelAccountPayload;
export type ChannelSetEnabledPayload = ChannelTypePayload & { enabled: boolean };
export type ChannelFormValuesResult = HostSuccess & {
  values?: Record<string, string>;
};
export type ChannelCredentialValidationPayload = ChannelTypePayload & {
  config: Record<string, unknown>;
};
export type ChannelCredentialValidationResult = HostSuccess & {
  valid: boolean;
  errors?: string[];
  warnings?: string[];
  details?: {
    botUsername?: string;
    guildName?: string;
    channelName?: string;
  };
};
export type ChannelSaveConfigPayload = ChannelTypePayload & {
  config: Record<string, unknown>;
  accountId?: string;
};
export type ChannelSaveConfigResult = HostSuccess & {
  noChange?: boolean;
  warning?: string;
};
export type ChannelConfiguredResult = HostSuccess & { channels?: Array<string | JsonRecord> };

export type AgentSnapshotResult = AgentsSnapshot & OptionalHostSuccess;
export type AgentModelUpdateResult = AgentSnapshotResult & {
  /** False when the model override was saved locally but the runtime
   * (models.json / provider auth) could not be synced. */
  runtimeSynced?: boolean;
  /** Machine-readable sync failure detail (diagnostic only, not user copy). */
  warning?: string;
};
export type AgentCreatePayload = { name: string; inheritWorkspace?: boolean };
export type AgentUpdatePayload = { id: string; name: string };
export type AgentUpdateModelPayload = { id: string; modelRef: string | null };
export type AgentUpdateReasoningEffortPayload = { id: string; reasoningEffort: AgentReasoningEffort };
export type AgentUpdateAvatarPayload = { id: string; preset: AgentAvatarPreset };
export type AgentIdPayload = { id: string };
export type AgentChannelPayload = { id: string; channelType: string };
export type RoleConfigEffort = 'low' | 'medium' | 'high';
export type RoleConfigPermissions = {
  filesystem?: 'none' | 'read' | 'write' | 'admin';
  network?: 'none' | 'limited' | 'full';
  commands?: string[];
  readPaths?: string[];
  writePaths?: string[];
};
export type RoleUpsertConfigRolePayload = {
  name: string;
  displayName: string;
  description?: string;
  rolePrompt: string;
  tools?: string[];
  effort: RoleConfigEffort;
  permissions?: RoleConfigPermissions;
  tags?: string[];
};
export type RoleConfigRoleSummary = {
  name: string;
  displayName: string;
  description?: string;
  rolePrompt: string;
  tools: string[];
  effort: RoleConfigEffort;
  permissions: {
    filesystem: 'none' | 'read' | 'write' | 'admin';
    network: 'none' | 'limited' | 'full';
    commands: string[];
    readPaths?: string[];
    writePaths?: string[];
  };
  tags: string[];
  origin: 'config';
};
export type RoleUpsertConfigRoleResult = HostSuccess & {
  role: RoleConfigRoleSummary;
  pendingRuntimeRefresh: boolean;
};
export type AgencyRoleLifecycle = 'draft' | 'reviewed' | 'active' | 'retired';
export type AgencyRoleEvidenceQualification =
  | 'unverified'
  | 'scenario-verified'
  | 'release-qualified';
export type AgencyRoleMaterializationStatus =
  | 'not-started'
  | 'pending'
  | 'complete'
  | 'failed';
export type AgencyRoleSourcePayload = { sourceRoot: string };
export type AgencyRoleDraftPayload = AgencyRoleSourcePayload & { draftId: string };
export type AgencyRoleToolHintDisposition = {
  hint: string;
  disposition: 'mapped' | 'waived';
  selectedTools: string[];
  reviewerNote: string;
};
export type AgencyRoleCandidatePayload = RoleUpsertConfigRolePayload & {
  outputFormat: 'markdown' | 'json' | 'text';
  outputSections: string[];
  handoffTo: string[];
  handoffFrom: string[];
  requiresReview: boolean;
  riskProfile: 'low' | 'medium' | 'high' | 'critical';
};
export type AgencyRoleReviewPayload = {
  packageId: string;
  reviewer: string;
  candidate: AgencyRoleCandidatePayload;
  toolHintDispositions: AgencyRoleToolHintDisposition[];
  evidenceQualification: AgencyRoleEvidenceQualification;
  evidenceRefs: string[];
  comment: string;
};

export type AgencyRoleDecisionPayload = {
  reviewId: string;
  reviewer: string;
  comment: string;
};
export type AgencyRoleDraftSummary = {
  id: string;
  status: 'draft';
  sourceDivision?: string;
  sourceAgentName: string;
  roleName: string;
  displayName: string;
  description?: string;
  capabilityHints: string[];
  toolHints: string[];
  handoffHints: string[];
  sourceRef: { relativePath: string; sha256: string };
  roleCandidate: AgencyRoleCandidatePayload;
  validationIssues: Array<{ path: string; message: string }>;
  toolMappingSuggestions: Array<{ hint: string; candidateTools: string[] }>;
};
export type AgencyRolePackageImportPayload = AgencyRoleDraftPayload;
export type AgencyRolePackageRefreshPayload = {
  packageId: string;
  sourceRoot: string;
};
export type AgencyRoleMemoryProposalsPayload = {
  packageId: string;
  reviewId: string;
};
export type AgencyRolePackageSummary = {
  packageId: string;
  draftId: string;
  sourceRef: { relativePath: string; sha256: string };
  completeness: 'complete' | 'legacy-reconstructed';
  importedAt: string;
  supersedesPackageId?: string;
  sourceDivision?: string;
  matchedRunbooks: string[];
  draft: AgencyRoleDraftSummary;
};

export type AgencyRolePromotionRecord = {
  id: string;
  packageId: string;
  draftId: string;
  sourceRef: { relativePath: string; sha256: string };
  lifecycle: AgencyRoleLifecycle;
  evidenceQualification: AgencyRoleEvidenceQualification;
  evidenceRefs: string[];
  reviewer: string;
  reviewedAt: string;
  decision?: 'approved' | 'retired';
  decidedBy?: string;
  decidedAt?: string;
  comment: string;
  candidate: AgencyRoleCandidatePayload;
  toolHintDispositions: AgencyRoleToolHintDisposition[];
  contractSha256: string;
  materializedRoleName?: string;
  materialization: {
    status: AgencyRoleMaterializationStatus;
    error?: string;
  };
};
export type AgencyRolePackageListResult = HostSuccess & {
  packages: AgencyRolePackageSummary[];
  reviews: AgencyRolePromotionRecord[];
};
export type AgencyRolePackageResult = HostSuccess & {
  package: AgencyRolePackageSummary;
};
export type AgencyMemoryProposalCandidate =
  AgencyRoleMemoryProposalCandidate;
export type AgencyRoleMemoryProposalCandidate = {
  sectionId: string;
  type: 'constraint' | 'procedure' | 'risk' | 'handoff';
  headingPath: string[];
  content: string;
  proposal: MemoryProposal;
};
export type AgencyRoleMemoryProposalsResult = HostSuccess & {
  packageId: string;
  reviewId: string;
  materializedRoleName: string;
  candidates: AgencyRoleMemoryProposalCandidate[];
};
export type AgencyRoleListResult = HostSuccess & {
  drafts: AgencyRoleDraftSummary[];
  reviews: AgencyRolePromotionRecord[];
};
export type AgencyRolePromotionPreviewResult = HostSuccess & {
  persisted: false;
  validation: {
    ok: boolean;
    issues: Array<{ path: string; message: string }>;
  };
  contractSha256: string;
  role: RoleConfigRoleSummary;
};
export type AgencyRolePromotionResult = HostSuccess & {
  record: AgencyRolePromotionRecord;
  pendingRuntimeRefresh: boolean;
};
export type AgentBootstrapResult = HostSuccess & {
  agentId: string;
  soulMd: string;
  bootstrapPath?: string;
  defaultSkillIds?: string[];
  defaultMcpServerIds?: string[];
  roleProfile?: import('@shared/types/agent').AgentRoleProfile | null;
  agentsMd?: string;
  agentsMdPath?: string;
  toolsMd?: string;
  toolsMdPath?: string;
  userMd?: string;
  userMdPath?: string;
  identityMd?: string;
  identityMdPath?: string;
  heartbeatMd?: string;
  heartbeatMdPath?: string;
  bootMd?: string;
  bootMdPath?: string;
  bootDeprecated?: {
    supported: false;
    code: 'BOOT_MD_DEPRECATED';
    message: string;
  };
};
export type AgentBootstrapUpdatePayload = {
  id: string;
  soulMd?: string;
  defaultSkillIds?: string[];
  defaultMcpServerIds?: string[];
  agentsMd?: string;
  toolsMd?: string;
  userMd?: string;
  identityMd?: string;
  heartbeatMd?: string;
  /** Deprecated: writes are rejected with BOOT_MD_DEPRECATED during the compatibility window. */
  bootMd?: string;
  roleProfile?: import('@shared/types/agent').AgentRoleProfile;
};

export type DiagnosticsGatewaySnapshotResult = JsonRecord;

/** FP-P1-06: sanitized support bundle export result. */
export type SupportBundleExportResult = {
  success: boolean;
  path?: string;
  redaction?: {
    findings: Array<{ type: string; hits: number }>;
    totalHits: number;
    verified: boolean;
  };
  truncated?: string[];
  error?: string;
};

export type { AgentDevScenarioId } from '../agent-dev/scenarios';
export type AgentDevScenario = AgentDevScenarioDefinition;
export type AgentDevSeedConversation = {
  id: string;
  title: string;
  agentId?: string;
  workspacePath?: string;
  messages: RawMessage[];
  createdAt: string;
};
export type AgentDevSeedProviderConfig = {
  id: string;
  name: string;
  type: ProviderType | 'custom';
  model?: string;
  baseUrl?: string;
  apiProtocol?: ProviderProtocol;
  hasApiKey?: boolean;
};
export type AgentDevSeedState = {
  scenario?: AgentDevScenarioId;
  settings?: SettingsSnapshot;
  conversations: AgentDevSeedConversation[];
  providers: AgentDevSeedProviderConfig[];
  gatewayStatus?: JsonRecord;
  featureFlags: string[];
  visual?: AgentDevVisualPreset;
  metadata: JsonRecord;
  updatedAt: string;
};
export type AgentDevSeedStatePayload = Partial<{
  scenario: AgentDevScenarioId;
  settings: SettingsSnapshot;
  conversations: AgentDevSeedConversation[];
  providers: AgentDevSeedProviderConfig[];
  gatewayStatus: JsonRecord;
  featureFlags: string[];
  visual: AgentDevVisualPreset;
  metadata: JsonRecord;
}>;
export type AgentDevSeedStateResult = HostSuccess & {
  enabled: boolean;
  state: AgentDevSeedState;
  applied: string[];
};
export type AgentDevCreateConversationPayload = Partial<Omit<AgentDevSeedConversation, 'createdAt'>> & {
  messages?: RawMessage[];
};
export type AgentDevCreateConversationResult = HostSuccess & {
  enabled: boolean;
  conversation: AgentDevSeedConversation;
  state: AgentDevSeedState;
};
export type AgentDevCreateProviderConfigPayload = {
  provider: Partial<AgentDevSeedProviderConfig> & { id: string };
  apiKey?: string;
  makeDefault?: boolean;
};
export type AgentDevCreateProviderConfigResult = HostSuccess & {
  enabled: boolean;
  provider: AgentDevSeedProviderConfig;
  state: AgentDevSeedState;
};
export type AgentDevMockReplayMode = 'off' | 'record' | 'replay';
export type AgentDevHostApiFixture = {
  module: string;
  action: string;
  payload?: unknown;
  result: unknown;
};
export type AgentDevMockReplayConfig = {
  mode: AgentDevMockReplayMode;
  fixtures?: AgentDevHostApiFixture[];
  clearCalls?: boolean;
};
export type AgentDevHostApiCall = {
  id: string;
  module: string;
  action: string;
  payload?: unknown;
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  mocked?: boolean;
  ok?: boolean;
  error?: string;
};
export type AgentDevMockReplayResult = HostSuccess & {
  enabled: boolean;
  mode: AgentDevMockReplayMode;
  fixtureCount: number;
  callCount: number;
};
export type AgentDevHostApiCallsPayload = { limit?: number };
export type AgentDevHostApiCallsResult = HostSuccess & {
  calls: AgentDevHostApiCall[];
};
export type AgentDevFeatureFlagsPayload = { flags?: string[]; merge?: boolean };
export type AgentDevFeatureFlagsResult = HostSuccess & {
  flags: string[];
};
export type AgentDevVisualPreset = Partial<{
  enabled: boolean;
  width: number;
  height: number;
  theme: 'light' | 'dark';
  language: 'en' | 'zh' | 'ja' | 'ru';
  reducedMotion: boolean;
  scenario: AgentDevScenarioId;
}>;
export type AgentDevVisualPresetResult = HostSuccess & {
  preset: AgentDevVisualPreset;
};
export type AgentDevDiagnosticsSnapshotResult = HostSuccess & {
  snapshot: JsonRecord;
};
export type AgentDevTransportTracePayload = {
  sessionId?: string;
  limit?: number;
};
export type AgentDevTransportTraceEvent = AgentDevTraceEvent;
export type AgentDevTransportTraceResult = HostSuccess & {
  events: AgentDevTransportTraceEvent[];
};
export type AgentDevTraceTimelinePayload = {
  requestId?: string;
  limit?: number;
};
export type AgentDevTraceTimelineResult = HostSuccess & {
  events: AgentDevTraceEvent[];
};
export type AgentDevRecordScenarioPayload = Partial<{
  slug: string;
  route: string;
  language: string;
  theme: string;
  visibleState: JsonRecord;
}>;
export type AgentDevRecordScenarioResult = HostSuccess & {
  artifactPath: string;
  scenario: JsonRecord;
};
export type AgentDevCostReportResult = HostSuccess & {
  report: AgentDevCostReport;
};
export type AgentDevSkillSandboxReportResult = HostSuccess & {
  report: AgentDevSkillSandboxReport;
};
export type AgentDevWorkbenchEvidence = {
  generatedAt: string;
  scenarioCount: number;
  /** Max ageHours across the generated evidence inventory in artifacts/agent-dev-audit/report.json; null when the audit report is unavailable. */
  evidenceAgeHours: number | null;
  /** Freshness window from the audit report policy; null when the audit report is unavailable. */
  maxEvidenceAgeHours: number | null;
  /** Deep-test decision.requiredFullGates from artifacts/agent-dev-deep-test/report.json. */
  requiredFullGates: string[];
  /** Deep-test decision.status from artifacts/agent-dev-deep-test/report.json; null when the report is unavailable. */
  decisionStatus: string | null;
  artifactStatus: {
    workbench: boolean;
    quality: boolean;
    channelConformance: boolean;
    scenarioRecordings: boolean;
  };
  hostApi: {
    contractActions: string[];
    facadeActions: string[];
    serviceActions: string[];
    missingFacadeActions: string[];
    missingServiceActions: string[];
  };
  contracts: {
    traceTimeline: boolean;
    costReport: boolean;
    skillSandboxReport: boolean;
    selectorContract: boolean;
  };
  gateCommands: {
    fastPr: string[];
    fullLocal: string[];
    nightlyRelease: string[];
  };
};
export type AgentDevWorkbenchEvidenceResult = HostSuccess & {
  evidence: AgentDevWorkbenchEvidence;
};
export type AgentDevSelectorContractResult = HostSuccess & {
  requiredAttributes: string[];
  requiredSurfaces: string[];
  notes: string[];
};
export type AgentDevStatusResult = HostSuccess & {
  enabled: boolean;
  scenarios: AgentDevScenario[];
  state: AgentDevSeedState;
  flags: string[];
  mockReplay: {
    mode: AgentDevMockReplayMode;
    fixtureCount: number;
    callCount: number;
  };
};

export type ProviderType =
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'openrouter'
  | 'ark'
  | 'moonshot'
  | 'moonshot-global'
  | 'siliconflow'
  | 'deepseek'
  | 'minimax-portal'
  | 'minimax-portal-cn'
  | 'modelstudio'
  | 'ollama'
  | 'custom';
export type ProviderAuthMode = 'api_key' | 'oauth_device' | 'oauth_browser' | 'local';
export type ProviderVendorCategory = 'official' | 'compatible' | 'local' | 'custom';
export type ProviderProtocol =
  | 'openai-completions'
  | 'openai-responses'
  | 'openai-codex-responses'
  | 'anthropic-messages'
  | 'google-generative-ai'
  | 'github-copilot'
  | 'bedrock-converse-stream'
  | 'ollama'
  | 'azure-openai-responses';
export type ProviderConfig = {
  id: string;
  name: string;
  type: ProviderType;
  baseUrl?: string;
  apiProtocol?: ProviderProtocol;
  headers?: Record<string, string>;
  modelProfile?: { contextWindow?: number; maxTokens?: number; supportsVision?: boolean; supportsReasoning?: boolean };
  model?: string;
  fallbackModels?: string[];
  fallbackProviderIds?: string[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};
export type ProviderWithKeyInfo = ProviderConfig & {
  hasKey: boolean;
  keyMasked: string | null;
};
export type ProviderVendorInfo = {
  id: ProviderType;
  name: string;
  icon: string;
  placeholder: string;
  model?: string;
  requiresApiKey: boolean;
  defaultBaseUrl?: string;
  showBaseUrl?: boolean;
  showModelId?: boolean;
  showModelIdInDevModeOnly?: boolean;
  modelIdPlaceholder?: string;
  defaultModelId?: string;
  isOAuth?: boolean;
  supportsApiKey?: boolean;
  apiKeyUrl?: string;
  docsUrl?: string;
  docsUrlZh?: string;
  codePlanPresetBaseUrl?: string;
  codePlanPresetModelId?: string;
  codePlanDocsUrl?: string;
  hidden?: boolean;
  hideOAuthUi?: boolean;
  category: ProviderVendorCategory;
  envVar?: string;
  supportedAuthModes: ProviderAuthMode[];
  defaultAuthMode: ProviderAuthMode;
  supportsMultipleAccounts: boolean;
};
export type ProviderAccount = {
  id: string;
  vendorId: ProviderType;
  label: string;
  authMode: ProviderAuthMode;
  baseUrl?: string;
  apiProtocol?: ProviderProtocol;
  headers?: Record<string, string>;
  model?: string;
  fallbackModels?: string[];
  fallbackAccountIds?: string[];
  enabled: boolean;
  isDefault: boolean;
  metadata?: {
    region?: string;
    email?: string;
    resourceUrl?: string;
    customModels?: string[];
    /** FP-P1-01: sanitized validation record (never contains key material). */
    validation?: {
      status: 'valid' | 'invalid' | 'network-error' | 'rate-limited' | 'protocol-error' | 'unchecked';
      checkedAt: string;
      model?: string;
      reason?: string;
      retryAfterMs?: number;
      source: 'setup' | 'settings';
    };
  };
  createdAt: string;
  updatedAt: string;
};
export type ProviderAccountKeyInfo = {
  accountId: string;
  hasKey: boolean;
  keyMasked: string | null;
};
export type ProviderDefaultAccountResult = { accountId: string | null };
export type ProviderValidationOptions = {
  baseUrl?: string;
  apiProtocol?: string;
  /** Custom-provider auth format; mirrors ProviderRequestAuthConfig (electron/shared/providers/types). */
  auth?: {
    mode: 'bearer' | 'custom-header' | 'query' | 'none';
    headerName?: string;
    prefix?: string;
    parameterName?: string;
  };
};
export type ProviderValidationPayload = {
  accountId?: string;
  vendorId?: string;
  providerId?: string;
  apiKey?: string;
  options?: ProviderValidationOptions;
};
/**
 * TF-0733: structured provider validation state.
 *
 * Validation used to collapse every non-auth 4xx and even 429 into
 * `valid: true`, so the Settings/Setup UI could say "Credentials verified"
 * for a rate-limited or protocol-mismatched endpoint. The six dimensions
 * below keep those facts separate:
 *  - reachable: did the endpoint answer at all
 *  - auth: did it accept the credential
 *  - protocol: did it accept the request shape
 *  - model: is the probed/selected model usable
 *  - rateLimited (+ retryAfterMs): HTTP 429 and its Retry-After
 *  - ready: the single surface the UI may render as verified/connected
 *
 * `valid` is kept for one release as a compatibility field with fixed
 * semantics: `auth === 'valid' && protocol !== 'incompatible'`. It is NOT the
 * readiness signal; UI must gate "verified" on `ready`.
 */
export type ProviderValidationReachability = 'reachable' | 'unreachable' | 'unknown';
export type ProviderValidationAuth = 'valid' | 'invalid' | 'unknown';
export type ProviderValidationProtocol = 'compatible' | 'incompatible' | 'unknown';
export type ProviderValidationModel = 'available' | 'unavailable' | 'unknown';
export type ProviderValidationReason =
  | 'ok'
  | 'unauthorized'
  | 'rate-limited'
  | 'protocol-error'
  | 'model-unavailable'
  | 'server-error'
  | 'network-error'
  | 'timeout'
  | 'dns-error'
  | 'blocked'
  | 'unknown';
/** Stage that produced a validation outcome (TF-0734). */
export type ProviderValidationStage =
  | 'preflight'
  | 'models'
  | 'probe'
  | 'transport'
  | 'unknown';
export type ProviderValidationBlockedReason =
  | 'invalid-url'
  | 'unsupported-protocol'
  | 'blocked-hostname'
  | 'metadata-address'
  | 'link-local-address'
  | 'private-network'
  | 'hostname-not-allowlisted';

export type ProviderValidationState = {
  reachable: ProviderValidationReachability;
  auth: ProviderValidationAuth;
  protocol: ProviderValidationProtocol;
  model: ProviderValidationModel;
  rateLimited: boolean;
  retryAfterMs?: number;
  ready: boolean;
  reason: ProviderValidationReason;
};
export type ProviderValidationResult = ProviderValidationState & {
  valid: boolean;
  error?: string;
  status?: number;
  durationMs?: number;
  /** Stable hash of the SSRF/private-network/proxy policy used for the probe. */
  policyFingerprint?: string;
  /** Where the outcome was decided (preflight, model listing, probe, transport). */
  stage?: ProviderValidationStage;
  /** Set only when the pre-flight policy denied the target. */
  blockedReason?: ProviderValidationBlockedReason;
  /** Total validation deadline, not a per-request timeout. */
  deadlineMs?: number;
};
export type ProviderModelListPayload = {
  accountId?: string;
  vendorId?: string;
  providerId?: string;
  apiKey?: string;
  options?: ProviderValidationOptions;
};
export type ProviderModelListResult = HostSuccess & {
  models: string[];
  durationMs?: number;
  /** TF-0733: structured outcome when listing failed (429 / protocol / model). */
  state?: ProviderValidationState;
};
export type ProviderIdPayload = { providerId: string };
export type ProviderApiKeyPayload = ProviderIdPayload & { apiKey: string };
export type ProviderSavePayload = { config: ProviderConfig; apiKey?: string };
export type ProviderUpdateWithKeyPayload = {
  providerId: string;
  updates: Partial<ProviderConfig>;
  apiKey?: string;
};
export type ProviderAccountIdPayload = { accountId: string };
export type ProviderCreateAccountPayload = { account: ProviderAccount; apiKey?: string };
export type ProviderUpdateAccountPayload = {
  accountId: string;
  updates: Partial<ProviderAccount>;
  apiKey?: string;
};
export type ProviderOAuthRequestPayload = {
  provider: string;
  region?: 'global' | 'cn';
  accountId?: string;
  label?: string;
};
export type ProviderOAuthSubmitPayload = { code: string };

export type StagedFileResult = {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  stagedPath: string;
  preview: string | null;
  filePath?: string;
};
export type StagePathsPayload = { filePaths: string[] };
export type StageBufferPayload = { base64: string; fileName: string; mimeType?: string };
export type FilePathPayload = { path: string };
export type FileReadBinaryOptions = { maxBytes?: number };
export type FilePreviewTreeOptions = {
  maxDepth?: number;
  maxNodes?: number;
  includeHidden?: boolean;
};
export type FileReadBinaryPayload = FilePathPayload & { opts?: FileReadBinaryOptions };
export type FileWriteTextPayload = FilePathPayload & { content: string; approvalId?: string };
export type FileListTreePayload = FilePathPayload & { opts?: FilePreviewTreeOptions };
export type FilePreviewError =
  | 'outsideSandbox'
  | 'readOnlyRoot'
  | 'tooLarge'
  | 'binary'
  | 'notFound'
  | 'notDirectory'
  | 'invalidContent'
  | (string & {});
export type ReadTextFileResult = {
  ok: boolean;
  content?: string;
  mimeType?: string;
  size?: number;
  readOnly?: boolean;
  error?: FilePreviewError;
};
export type HtmlPreviewDocumentPayload = { html: string };
export type HtmlPreviewDocumentResult = {
  ok: boolean;
  url?: string;
  error?: FilePreviewError;
};
export type ReadBinaryFileResult = {
  ok: boolean;
  data?: Uint8Array;
  mimeType?: string;
  size?: number;
  readOnly?: boolean;
  error?: FilePreviewError;
};
export type WriteTextFileResult = {
  ok: boolean;
  error?: FilePreviewError;
  approvalRequired?: boolean;
  approval?: PermissionApprovalEvent;
};
export type StatFileResult = {
  ok: boolean;
  size?: number;
  mtime?: number;
  isFile?: boolean;
  isDir?: boolean;
  readOnly?: boolean;
  error?: FilePreviewError;
};
export type FileListDirEntry = {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
};
export type FileListDirResult = {
  ok: boolean;
  entries?: FileListDirEntry[];
  error?: FilePreviewError;
};
export type FilePreviewTreeNode = {
  name: string;
  relPath: string;
  absPath: string;
  isDir: boolean;
  size?: number;
  mtime?: number;
  children?: FilePreviewTreeNode[];
};
export type FileListTreeResult = {
  ok: boolean;
  root?: FilePreviewTreeNode;
  truncated?: boolean;
  error?: FilePreviewError;
};

export type MediaThumbnailEntry = {
  filePath?: string;
  gatewayUrl?: string;
  mimeType?: string;
};
export type MediaThumbnailsPayload = { paths: MediaThumbnailEntry[] };
export type LinkPreviewPayload = { url: string; mode?: 'favicon' };
export type LinkPreviewResult = {
  title?: string;
  description?: string;
  thumbnail?: string;
  favicon?: string;
} | null;
export type MediaThumbnailResult = Record<string, {
  preview: string | null;
  fileSize: number;
  /** Set for `gatewayUrl` entries: the record's file, to be read through `files.readBinary`. */
  resolvedPath?: string;
}>;
export type SaveImagePayload = {
  base64?: string;
  mimeType?: string;
  filePath?: string;
  defaultFileName?: string;
};
export type ImageGenerationModelConfig = {
  primary: string | null;
  fallbacks: string[];
  timeoutMs: number | null;
};
export type ImageGenerationAgentAuthRow = {
  id: string;
  name: string;
  isDefault: boolean;
  provider: string | null;
  configured: boolean;
};
export type OpenAiImageRelayConfig = {
  enabled: boolean;
  baseUrl: string;
  model: string;
  providerKey?: string;
  apiKeyConfigured: boolean;
};
export type ImageGenerationSettingsSnapshot = {
  config: ImageGenerationModelConfig;
  autoProviderFallback: boolean;
  defaultAgentId: string;
  agents: ImageGenerationAgentAuthRow[];
  openAiRelay: OpenAiImageRelayConfig;
};
export type ImageGenerationProviderRow = {
  id: string;
  label: string;
  defaultModel: string;
  configured: boolean;
  available: boolean;
  selected: boolean;
  models: string[];
};
export type ImageGenerationSettingsPayload = {
  primary?: string | null;
  fallbacks?: string[];
  timeoutMs?: number | null;
  openAiRelayEnabled?: boolean;
  openAiRelayBaseUrl?: string | null;
  openAiRelayModel?: string | null;
  openAiRelayApiKey?: string;
};
export type ImageGenerationSettingsResult = OptionalHostSuccess & ImageGenerationSettingsSnapshot;
export type ImageGenerationProvidersResult = OptionalHostSuccess & {
  providers?: ImageGenerationProviderRow[];
};
export type ImageGenerationTestPayload = {
  agentId?: string;
  prompt?: string;
  model?: string;
};
export type ImageGenerationTestResult = {
  success: boolean;
  agentId: string;
  command: string;
  durationMs: number;
  error?: string;
  stdout?: string;
  stderr?: string;
  result?: unknown;
};

export type SessionHistoryPayload = {
  sessionKey?: string;
  agentId?: string;
  sessionId?: string;
  limit?: number;
  expectedSessionGeneration?: string;
  expectedParentSessionKey?: string;
  workerSendIdempotencyKey?: string;
};
export type SessionHistoryResult = OptionalHostSuccess & {
  messages?: RawMessage[];
  sessionGeneration?: string;
  model?: string;
  costUsd?: number | null;
  workerSendReceipt?: { phase: 'queued' | 'steered'; idempotencyKey: string; source: 'runtime-intervention'; queueItemId?: string };
};
export type SessionSendWorkerPayload = {
  workspaceId: string;
  parentSessionKey: string;
  expectedParentGeneration: string;
  childSessionKey: string;
  expectedChildGeneration: string;
  message: string;
  idempotencyKey: string;
  mode: 'send' | 'steer';
};
export type SessionSendWorkerResult = HostSuccess & { phase: 'accepted' | 'queued' | 'steered' | 'rejected' | 'unknown'; run?: ScopedRunId; receipt?: { idempotencyKey: string; source: 'runtime-ack' | 'runtime-intervention'; queueItemId?: string } };
export type SessionSummariesPayload = { sessionKeys?: string[]; limit?: number };
export type SessionLabelSummary = {
  sessionKey: string;
  firstUserText: string | null;
  lastTimestamp: number | null;
  /** Number of user turns in the transcript, used by sidebar active sorting. */
  messageCount?: number;
};
export type SessionSummariesResult = HostSuccess & {
  summaries?: SessionLabelSummary[];
};
export type SessionDeletePayload = { id: string; resumeOperationId?: string };
export type SessionRenamePayload = { id: string; title: string };
export type SessionArchivePayload = {
  id: string;
  resumeOperationId?: string;
  label?: string;
  originalWorkspaceId?: string | null;
  originalFolderId?: string | null;
};
export type SessionRestorePayload = { id: string; resumeOperationId?: string };
export type SessionPermanentDeletePayload = { id: string };
export type SessionListArchivedPayload = { agentId?: string };
export type SessionListArchivedResult = HostSuccess & {
  entries: SessionArchiveEntry[];
  pendingMutations?: SessionPendingMutation[];
};
export type SessionEmptyArchivePayload = { agentId?: string };
/** context-folding-rlm: read-only flag/limits/rollback descriptor (no session required). */
export type SessionContextFoldingStatusPayload = { sessionKey?: string };
export type SessionContextFoldingStatusResult = HostSuccess & { status: ContextFoldingStatus };
/** context-folding-rlm: validate a ContextFoldResult/v1 and bound it for the parent view. */
export type SessionContextFoldProjectionPayload = { result: unknown; maxChars?: number };
export type SessionContextFoldProjectionResult = HostSuccess & {
  ok: boolean;
  projection?: ContextFoldResult;
  chars?: number;
  truncated?: boolean;
  diagnostics: ContextDiagnostic[];
};
export type SessionPatchThinkingPayload = {
  sessionKey: string;
  thinkingLevel: AgentReasoningEffort | null;
};
/**
 * Session-scoped model override (Area 2 §3.3). Sets `SessionEntry.modelOverride`
 * on the current session — every future turn on this session uses the named
 * model until cleared. `modelRef: null` clears the override (reset to agent
 * default). Forks inherit the override (existing runtime behavior).
 */
export type SessionPatchRuntimeModelPayload = {
  sessionKey: string;
  modelRef: string | null;
};
export type SessionCompactionPayload = {
  sessionKey: string;
  agentId?: string;
};
export type SessionQueueDrainPayload = SessionCompactionPayload & {
  /** TF-0082 generation guard: refuse draining a post-reset/forked generation. */
  expectedSessionId?: string;
};
export type SessionCompactionHistoryPayload = SessionCompactionPayload & {
  limit?: number;
};
export type CompressionEvidenceRef = {
  type: 'session' | 'trace' | 'file' | 'tool' | 'task_ledger' | 'clawgraph' | 'manual' | 'archive' | 'cvk' | 'other';
  ref: string;
  label?: string;
};
export type CompressionFact = {
  text: string;
  evidenceRefs: CompressionEvidenceRef[];
  semanticAtomId?: string;
};
export type CompressionSemanticAtomStatus = 'verified' | 'unverified' | 'stale' | 'superseded';
export type CompressionSemanticAtomPolarity = 'positive' | 'negative' | 'neutral';
export type CompressionSemanticAtomSeverity = 'critical' | 'important' | 'nice_to_have';
export type CompressionSemanticAtomType =
  | 'goal'
  | 'latest_user_ask'
  | 'decision'
  | 'constraint'
  | 'failed_attempt'
  | 'entity'
  | 'next_action'
  | 'outcome'
  | 'safety_boundary';
export type CompressionSemanticAtom = {
  id: string;
  type: CompressionSemanticAtomType;
  canonicalIdentity: string;
  severity: CompressionSemanticAtomSeverity;
  confidence: number;
  scope: string;
  polarity: CompressionSemanticAtomPolarity;
  status: CompressionSemanticAtomStatus;
  sourceStatus?: string;
  text: string;
  evidenceRefs: CompressionEvidenceRef[];
  supersedes?: string[];
  conflicts?: string[];
  updatedAt?: number;
  source?: {
    kind: 'summary' | 'message' | 'ledger' | 'cvk' | 'archive';
    ref: string;
  };
};
export type CompressionArtifactQuality = {
  score: number;
  level: 'high' | 'medium' | 'low';
  fieldCoverage: number;
  evidenceCoverage: number;
  artifactTokens: number;
  projectionTokens: number;
  warnings: string[];
};
export type CompressionArtifact = {
  schemaVersion: 1;
  objective: string;
  constraints: CompressionFact[];
  currentState: string;
  done: CompressionFact[];
  inProgress: CompressionFact[];
  blocked: CompressionFact[];
  decisions: CompressionFact[];
  filesTouched: CompressionFact[];
  testsRun: CompressionFact[];
  failedAttempts: CompressionFact[];
  deviations: CompressionFact[];
  nextAction: string;
  reviewNeeded: CompressionFact[];
  evidenceRefs: CompressionEvidenceRef[];
  unverifiedClaims: string[];
  quality: CompressionArtifactQuality;
  tier?: string;
  strategy?: string;
  compressionRatio?: number;
  tokensBefore?: number;
  tokensAfter?: number;
  rehydratedFiles?: string[];
  staleExcludedCount?: number;
  causalAnchorCount?: number;
  warnings?: string[];
  semanticAtoms?: CompressionSemanticAtom[];
  semanticOrigins?: Partial<Record<'objective' | 'currentState' | 'nextAction', string>>;
};
export type SessionCompressionArtifactPayload = SessionCompactionPayload & {
  checkpointId?: string;
};
export type SessionRecoveryContextPayload = SessionCompressionArtifactPayload & {
  budgetTokens?: number;
  purpose?: string;
};
export type SessionRecallDiagnosticCode =
  | 'missing_archive'
  | 'checksum_mismatch'
  | 'read_error'
  | 'invalid_handle'
  | 'missing_selector'
  | 'stale_selector'
  | 'ambiguous_selector'
  | 'checksum_unavailable';
export type SessionRecallDiagnostic = {
  code: SessionRecallDiagnosticCode;
  message: string;
  ref?: string;
};
export type SessionRecallOriginalPayload = SessionCompactionPayload & {
  archiveHandle: ArchiveHandle;
};
export type SessionRecallOriginalResult = HostSuccess & {
  ok: boolean;
  payload?: unknown;
  archiveHandle?: ArchiveHandle;
  diagnostics: SessionRecallDiagnostic[];
};
export type SessionExpandSelectorPayload = SessionCompactionPayload & {
  resourceId: string;
  selector: string;
  checksum?: string;
};
export type SessionExpandSelectorResult = HostSuccess & {
  ok: boolean;
  content?: string;
  resourceId?: string;
  selector?: string;
  checksum?: string;
  diagnostics: SessionRecallDiagnostic[];
};
export type SessionLongTaskControlPayload = SessionCompactionPayload;
export type SessionLongTaskControlHistoryPayload = SessionCompactionPayload & {
  limit?: number;
};
export type SessionLongTaskControlStatusResult = HostSuccess & LongTaskControlStatus;
export type SessionLongTaskControlHistoryResult = HostSuccess & {
  key?: string;
  events: LongTaskControlEvent[];
};
export type SessionResumeCheckpointsResult = HostSuccess & {
  key?: string;
  checkpoints: LongTaskCheckpointRecord[];
};
export type SessionRestoreCheckpointPayload = SessionLongTaskControlHistoryPayload & {
  expectedSessionId?: string;
  checkpointId: string;
};
export type SessionCheckpointDiffFile = {
  filePath: string;
  status: 'modified' | 'created' | 'deleted';
  unifiedDiff: string;
};
export type SessionCheckpointDiffResult = HostSuccess & {
  key?: string;
  checkpointId: string;
  files: SessionCheckpointDiffFile[];
  errors: string[];
};
export type SessionRestoreCheckpointResult = HostSuccess & {
  key?: string;
  checkpointId: string;
  rolledBackTo: string;
  mode: 'legacy_checkpoint_fallback' | 'event_log_replay';
  evidenceSummary: string;
};
export type SessionQueueDrainResult = HostSuccess & {
  key?: string;
  drained: boolean;
  queueCount: number;
  messageCount?: number;
  reason?: string;
};
export type SessionManualCompactPayload = SessionCompactionPayload & {
  expectedSessionId?: string;
  customInstructions?: string;
  force?: boolean;
};
/**
 * #178: summarize a located stretch of a session transcript, keeping the
 * untouched side verbatim. Exactly one of fromLeafId / toLeafId is required.
 */
export type SessionCompactRangePayload = SessionCompactionPayload & {
  expectedSessionId?: string;
  customInstructions?: string;
  fromLeafId?: string;
  toLeafId?: string;
};
export type SessionCompactionHistoryEntry = {
  id: string;
  timestamp: number;
  summary?: string;
  tokensBefore?: number;
  tokensAfter?: number;
  firstKeptEntryId?: string;
  trigger: 'manual' | 'auto-threshold' | 'overflow-retry' | 'timeout-retry';
  quality?: CompressionArtifactQuality;
  artifactTokens?: number;
  projectionTokens?: number;
  evidenceCoverage?: number;
  unverifiedCount?: number;
  warnings?: string[];
};
export type SessionCompactionStatus = {
  available: boolean;
  canCompact: boolean;
  inProgress: boolean;
  reason?: string;
  usedTokens?: number;
  maxTokens?: number;
  remainingTokens?: number;
  pressure: 'unknown' | 'low' | 'medium' | 'high';
  lastCompaction?: SessionCompactionHistoryEntry;
  truncatedMessageCount: number;
  warnings: string[];
};
export type SessionCompactionStatusResult = HostSuccess & SessionCompactionStatus;
export type SessionCompactionHistoryResult = HostSuccess & {
  entries: SessionCompactionHistoryEntry[];
};
export type SessionCompactionResult = HostSuccess & {
  status?: 'compacted' | 'skipped' | 'pending' | 'failed';
  compacted?: boolean;
  summary?: string;
  reason?: string;
  tokensBefore?: number;
  tokensAfter?: number;
  firstKeptEntryId?: string;
  sessionKey?: string;
  sessionId?: string;
  rotatedSessionKey?: string;
  artifact?: CompressionArtifact;
  quality?: CompressionArtifactQuality;
  artifactTokens?: number;
  projectionTokens?: number;
  evidenceCoverage?: number;
  warnings?: string[];
};
export type SessionCompressionArtifactResult = HostSuccess & {
  key?: string;
  checkpointId?: string;
  artifact?: CompressionArtifact;
  quality?: CompressionArtifactQuality;
  warnings: string[];
};
export type SessionRecoveryContextResult = HostSuccess & {
  key?: string;
  checkpointId?: string;
  context: string;
  artifact?: CompressionArtifact;
  quality?: CompressionArtifactQuality;
  projectionTokens?: number;
  warnings: string[];
};
export type SessionHandoffPayload = {
  sessionKey: string;
  agentId?: string;
  workspaceId?: string | null;
};
export type SessionHandoffSource = {
  id: 'compression_artifact' | 'context_recall' | 'runtime_checkpoint' | 'transcript' | 'task_ledger' | 'git' | 'observability';
  label: string;
  available: boolean;
  summary?: string;
  warning?: string;
};
export type SessionCreateHandoffPayload = SessionHandoffPayload & { draftInput: string; operationId?: string };
export type SessionHandoffOperationPayload = SessionHandoffPayload & { operationId?: string; reconcile?: boolean };
export type SessionHandoffOperationResult = HostSuccess & { operation: SessionHandoffOperation | null };
export type WorkspaceSessionTaskSelectPayload = {
  workspaceId: string;
  sessionKey: string;
  taskNodeId: string;
  expectedSessionGeneration?: string;
  expectedRevision?: number;
};
export type ProjectPlanDispatchPayload = {
  workspaceId: string;
  sessionKey: string;
  expectedSessionGeneration: string;
  planId: string;
  expectedRevision: number;
  expectedChildId: string;
  approvalId?: string;
};
export type SystemProjectDispatchPayload = ProjectPlanDispatchPayload & {
  expectedPolicyRevision: number;
};
export type SessionCreateHandoffResult = HostSuccess & {
  operation?: SessionHandoffOperation;
  sessionKey?: string;
  handoffDepth?: number;
  handoffParentSessionKey?: string;
  handoffRootSessionKey?: string;
  parentHandoffId?: string;
  rootHandoffId?: string;
};
export type SessionHandoffResult = HostSuccess & {
  checkpoint?: ResumeCheckpoint;
  draft?: string;
  sources?: SessionHandoffSource[];
  warnings?: string[];
  /** Depth the derived session WOULD have (1 for the first relay of a root). */
  handoffDepth?: number;
  /** Session the draft would be handed off from. */
  handoffParentSessionKey?: string;
  /** Root session of the handoff ancestry. */
  handoffRootSessionKey?: string;
  /** Configured maximum depth that produced a denial, when applicable. */
  handoffMaxDepth?: number;
};
export type SessionStopPayload = {
  sessionKey: string;
  agentId?: string;
  workspaceId?: string;
  expectedSessionId?: string;
};
export type SessionStopResult = HostSuccess & {
  key?: string;
  stopped?: boolean;
  expectedSessionId?: string;
  resourceReclamation?: ReclaimReceipt;
};
export type SessionArchiveResult = HostSuccess & {
  resourceReclamation?: ReclaimReceipt;
};
export type SessionForkPayload = {
  sessionKey: string;
  agentId?: string;
  workspaceId?: string | null;
  label?: string;
  /**
   * #180: fork up to this entry in the parent transcript instead of its tip.
   * Omit for the original whole-session fork. An id the parent transcript does
   * not contain — or that has no assistant turn at or before it — is rejected
   * (fail closed); it is never silently retried against the tip.
   */
  fromLeafId?: string;
};
export type SessionForkResult = HostSuccess & {
  sourceSessionKey?: string;
  sessionKey?: string;
  agentId?: string | null;
  workspaceId?: string | null;
  forkedFromParent?: boolean;
  warnings?: string[];
};
export type SessionTruncatePayload = {
  sessionKey: string;
  agentId?: string;
  messageId: string;
};
export type SessionTruncateResult = HostSuccess & {
  sessionKey?: string;
  messageId?: string;
  truncated?: boolean;
  removedMessageCount?: number;
  retainedLineCount?: number;
};

export type ChatInputMode = LongTaskInputMode;
export type ChatMediaItem = { filePath: string; mimeType?: string; fileName?: string };
export type CapabilityAuditStatus = 'passed' | 'warning' | 'blocked' | 'unknown';
export type CapabilityAuditFindingSeverity = 'info' | 'warning' | 'blocked';
export type CapabilityAuditFinding = {
  id: string;
  severity: CapabilityAuditFindingSeverity;
  title: string;
  detail?: string;
  recommendation?: string;
};
export type CapabilityAuditResult = {
  status: CapabilityAuditStatus;
  summary: string;
  findings: CapabilityAuditFinding[];
  auditedAt: string;
  source?: 'local' | 'mcp-json' | 'registered' | 'unknown';
};
export type CapabilityPublicationKind = 'skill' | 'mcp';
export type CapabilityPublicationSource =
  | 'runtime'
  | 'local'
  | 'bundled'
  | 'workspace'
  | 'mcp-json'
  | 'registered'
  | 'unknown';
export type CapabilityPublicationState =
  | 'published'
  | 'available'
  | 'disabled'
  | 'blocked'
  | 'missing'
  | 'runtimeUnavailable';
export type CapabilityPublicationUseMode = 'prompt' | 'modelTool' | 'userCommand' | 'adminAction';
export type CapabilityPublicationRuntimeStatus =
  | 'ready'
  | 'configured'
  | 'warm'
  | 'cold'
  | 'disabled'
  | 'blocked'
  | 'missing'
  | 'unavailable';
export type CapabilityPublicationDiagnosticSeverity = 'info' | 'warning' | 'blocked';
export type CapabilityPublicationDiagnostic = {
  code: string;
  severity: CapabilityPublicationDiagnosticSeverity;
  message: string;
  details?: JsonRecord;
};
export type CapabilityPublicationOwner = {
  type: 'global' | 'agent' | 'workspace' | 'role' | 'unknown';
  id?: string | null;
};
export type CapabilityPublicationExposure = {
  agentIds?: string[];
  workspaceIds?: string[];
  roleNames?: string[];
  promptVisible?: boolean;
  runtimeVisible?: boolean;
  userInvocable?: boolean;
  toolVisible?: boolean;
};
export type CapabilityPublicationRuntime = {
  status: CapabilityPublicationRuntimeStatus;
  method?: 'prompt' | 'tool' | 'config' | 'fallback';
  source?: 'gateway' | 'local-fallback' | 'electron-store' | 'openclaw-config';
  message?: string;
};
export type CapabilityPublicationQuery = {
  agentId?: string | null;
  workspaceId?: string | null;
  roleName?: string | null;
  includeDiagnostics?: boolean;
  /**
   * Include known but not currently published capabilities for management UIs.
   * Defaults to false so runtime consumers keep seeing only the effective
   * published surface.
   */
  includeCandidates?: boolean;
  includeToolCatalog?: 'none' | 'warmOnly';
};
export type CapabilityPublicationEntry = {
  id: string;
  kind: CapabilityPublicationKind;
  sourceId: string;
  name: string;
  owner: CapabilityPublicationOwner;
  scope?: 'global' | 'agent' | 'workspace' | 'role' | 'unknown';
  source?: CapabilityPublicationSource;
  state: CapabilityPublicationState;
  exposure: CapabilityPublicationExposure;
  useModes: CapabilityPublicationUseMode[];
  runtime: CapabilityPublicationRuntime;
  toolNames?: string[];
  reasons: string[];
  diagnostics: CapabilityPublicationDiagnostic[];
  skillId?: string;
  serverId?: string;
};
export type CapabilityPublicationResult = HostSuccess & {
  source: 'gateway' | 'local-fallback';
  generatedAt: string;
  publications: CapabilityPublicationEntry[];
  diagnostics: CapabilityPublicationDiagnostic[];
};
export type CapabilityRegistryEntry = {
  id: string;
  kind: 'skill' | 'mcp';
  name: string;
  source?: 'local' | 'bundled' | 'workspace' | 'mcp-json' | 'registered' | 'unknown';
  installed: boolean;
  enabled: boolean;
  verified?: boolean;
  lastAuditResult?: CapabilityAuditResult;
  skillId?: string;
  serverId?: string;
  /** @deprecated Use CapabilityPublicationEntry via hostApi.capabilities.publications. */
  publication?: CapabilityPublicationEntry;
};
export type CapabilityOrchestrationStage =
  | 'audit'
  | 'enable'
  | 'register'
  | 'structureCheck'
  | 'runtimeReload'
  | 'heartbeat'
  | 'listTools'
  | 'metadata';
export type CapabilityOrchestrationStepStatus = 'success' | 'warning' | 'blocked' | 'failed' | 'skipped';
export type CapabilityOrchestrationStep = {
  id: string;
  actionId: string;
  stage: CapabilityOrchestrationStage;
  status: CapabilityOrchestrationStepStatus;
  message?: string;
  error?: string;
  details?: JsonRecord;
  completedAt: string;
};
export type CapabilityOrchestrationSummary = {
  status: 'success' | 'partial' | 'failed' | 'blocked';
  steps: CapabilityOrchestrationStep[];
  traceId?: string;
  verified?: boolean;
  reloaded?: boolean;
  heartbeatStatus?: string;
  toolNames?: string[];
};
export type ChatCapabilityActionKind = 'skill.enable' | 'mcp.register' | 'mcp.reload' | 'mcp.heartbeat' | 'mcp.listTools';
export type ChatCapabilityActionPlan = {
  id: string;
  kind: ChatCapabilityActionKind;
  label: string;
  targetName?: string;
  summary?: string;
  risk?: 'low' | 'medium' | 'high';
  skillId?: string;
  skillAlreadyEnabled?: boolean;
  mcpServer?: McpServerCreatePayload;
  serverId?: string;
  auditResult?: CapabilityAuditResult;
};
export type ChatCapabilityActionResult = {
  id: string;
  kind: ChatCapabilityActionKind;
  success: boolean;
  skipped?: boolean;
  targetName?: string;
  skillId?: string;
  serverId?: string;
  toolNames?: string[];
  serverCount?: number;
  hotReloaded?: boolean;
  restartRequired?: boolean;
  message?: string;
  error?: string;
  details?: JsonRecord;
  auditResult?: CapabilityAuditResult;
  orchestration?: CapabilityOrchestrationSummary;
};
export type ChatSendWithMediaPayload = {
  sessionKey: string;
  workspaceId?: string | null;
  message?: string;
  deliver?: boolean;
  idempotencyKey: string;
  handoffOperationId?: string;
  expectedSessionGeneration?: string;
  media?: ChatMediaItem[];
  inputMode?: ChatInputMode;
  knowledgeScope?: WorkspaceKnowledgeScope;
  knowledgeMode?: KnowledgeInvocationMode;
  knowledgeReferences?: ChatKnowledgeReference[];
  activeTaskNodeId?: string | null;
  /**
   * Turn-scoped model override (Area 2 §3.2). When set, this single send runs
   * on the named model instead of the session/agent default. `null`/undefined
   * means "no turn override" (resolution falls to session override → agent
   * config). Never persisted to Agent.modelRef.
   */
  modelRef?: string | null;
  /** Per-send reasoning effort (turn-scoped, never persisted). */
  reasoningEffort?: AgentReasoningEffort;
  /** Per-send linked runtime intensity (turn-scoped, never persisted). */
  runtimeIntensity?: RuntimeIntensityPreference;
};
export type ChatSendWithMediaResult = HostSuccess & {
  result?: { runId?: string };
  denial?: {
    code: 'TOKEN_BUDGET_EXCEEDED' | 'COST_BUDGET_EXCEEDED';
    limit: number;
    used: number;
  };
  knowledgeDenials?: ChatKnowledgeDenial[];
  knowledgeReferences?: ChatKnowledgeReference[];
};

export type ChatContinuityPreviewPayload = {
  sessionKey: string;
  workspaceId: string;
  activeTaskNodeId?: string | null;
  knowledgeReferences?: ChatKnowledgeReference[];
};

export type ChatContinuityPreviewResult = HostSuccess & {
  validation: 'current' | 'missing' | 'invalidated' | 'unavailable';
  pack?: LongSessionContinuityContextPack;
  rendered?: string;
  reason?: string;
};

export type ChatKnowledgeDenial = {
  id: string;
  title: string;
  lookup: string;
  reason:
    | 'invalid_ref'
    | 'unsupported_owner'
    | OwnerReadRejectionCode;
  visibleReason: string;
};

export type ChatKnowledgeReference = {
  id: string;
  title: string;
  lookup: string;
  corpus?: 'wiki' | 'memory' | 'all';
  pageId?: string;
  pagePath?: string;
  sourcePath?: string;
  snippet?: string;
  score?: number;
  attachKind?: 'manual' | 'suggested' | 'auto';
  routingReason?: string;
  confidence?: number;
  freshnessLevel?: string;
  matchedClaimStatus?: string;
  sourceRef?: SourceRefV2;
  revision?: string;
  contentDigest?: string;
  conflictGroupId?: string;
  rank?: number;
  scoreKind?: string;
  rankSignals?: RankSignalsV2;
};

export type KnowledgeRouteCandidateGroupKey = 'docs' | 'pitfalls' | 'rules' | 'runtime_lessons';

export type KnowledgeRouteContextPayload = {
  message: string;
  scope: WorkspaceKnowledgeScope;
  mode: KnowledgeInvocationMode;
  selectedReferences?: ChatKnowledgeReference[];
  sessionKey?: string;
  workspaceId?: string | null;
  profile?: RetrievalProfile;
  sourcePolicy?: {
    runtimeLessons?: boolean;
  };
};

export type KnowledgeRouteCandidate = ChatKnowledgeReference & {
  attachKind: 'suggested' | 'auto';
  routingReason: string;
  confidence?: number;
  routeGroup?: KnowledgeRouteCandidateGroupKey;
  freshnessLevel?: string;
  matchedClaimStatus?: string;
  sourceKind?: 'wiki-page' | 'sekb-principle';
  runtimeLesson?: {
    principleId: string;
    condition: string;
    action: string;
    reason: string;
    retrievalCount: number;
  };
};

export type KnowledgeRouteCandidateGroup = {
  key: KnowledgeRouteCandidateGroupKey;
  candidates: KnowledgeRouteCandidate[];
};

export type KnowledgeRouteContextResult = HostSuccess & {
  experienceExposureId?: string;
  decision: 'skip' | 'suggest' | 'auto_attach';
  reason: string;
  query?: string;
  candidates: KnowledgeRouteCandidate[];
  candidateGroups?: KnowledgeRouteCandidateGroup[];
  groupedCandidates?: Partial<Record<KnowledgeRouteCandidateGroupKey, KnowledgeRouteCandidate[]>>;
  retrievalDiagnostics?: KnowledgeRetrievalDiagnostics;
  retrieval?: KnowledgeRetrievalReport;
  budget: {
    maxReferences: number;
    maxSnippetChars: number;
  };
  runtimeLessons?: {
    requested: boolean;
    included: boolean;
    available: boolean;
    principleCount: number;
    reason?: string;
  };
};

export type KnowledgeRetrievePayload = {
  query: string;
  profile?: RetrievalProfile;
  mode?: RetrievalMode;
  sourceRefs?: SourceRefV2[];
  sessionKey?: string;
  workspaceId?: string | null;
};
export type KnowledgeRetrievalRow = ChatKnowledgeReference & {
  rank: number;
  scoreKind: string;
  rankSignals: RankSignalsV2;
  sourceRef: SourceRefV2;
  metadata?: Record<string, unknown>;
  autoReadAdmission?: { eligible: boolean; contextId: string; reason: string };
};
export type KnowledgeRetrievalReport = Omit<RetrievalResultV2<unknown>, 'results'> & { results: KnowledgeRetrievalRow[] };
export type KnowledgeRetrieveResult = HostSuccess & { retrieval?: KnowledgeRetrievalReport };

export type KnowledgeRuntimeLessonsReportResult = HostSuccess & {
  attribution?: {
    uiExposures: number; contextExposures: number; citations: number; adoptions: number;
    operationalOutcomes: number; taskGrades: number; unknownOperationalOutcomes: number;
  };
  available: boolean;
  reason?: 'runtimeUnavailable' | 'reportFailed';
  counts: {
    trajectories: number;
    undistilledTrajectories: number;
    activePrinciples: number;
  };
  /** Bounded runtime correlation metadata; absent for legacy trajectories. */
  lineageSchema?: 'runtime-lineage.v1';
  undistilled: Array<{
    trajectory_id: string;
    created_at: string;
    task_intent: string;
    task_type: string;
    context_fingerprint: string[];
    outcome: 'success' | 'failure' | 'partial';
    error_signature: string | null;
    lineage?: KnowledgeRuntimeLineage;
  }>;
  activePrinciples: Array<{
    principle_id: string;
    title: string;
    task_types: string[];
    context_tags: string[];
    criticality: 'low' | 'medium' | 'high' | 'critical';
    retrieval_count: number;
    adoption_count: number;
    source_trajectories?: string[];
    lineage?: KnowledgeRuntimeLineage;
  }>;
  indexPreview: string;
  evidence: {
    state: 'disabled' | 'unavailable' | 'insufficient_data' | 'ready' | 'unknown';
    ageDistribution: {
      underHour: number;
      underDay: number;
      underWeek: number;
      older: number;
      invalid: number;
    };
    trajectoriesByOutcome: {
      success: number;
      partial: number;
      failure: number;
    };
    steps: { min: number; max: number; average: number };
    durationSeconds: { min: number; max: number; average: number };
    errorSignatures: {
      withoutSignature: number;
      distinct: number;
      recurringTrajectories: number;
    };
    shadow: {
      evaluatedTrajectories: number;
      captureRecommendations: { retain: number; review_low_signal: number };
      completionStatuses: { supported: number; partial: number; unsupported: number; unknown: number };
    };
    feedback: {
      confirmedPrinciples: number;
      rejectedSuggestions: number;
      rejectionBreakdown: {
        general: number;
        batchAssisted: number;
      };
      retrievals: number;
      adoptions: number;
      postAdoptionSuccesses: number;
    };
    batchDistillationAssistant: {
      state: 'disabled' | 'unavailable' | 'insufficient_data' | 'ready' | 'unknown';
      suggestionCount: KnowledgeRuntimeLessonsMetric;
      acceptedCount: KnowledgeRuntimeLessonsMetric;
      rejectedCount: KnowledgeRuntimeLessonsMetric;
      normalizedEditDistance: KnowledgeRuntimeLessonsMetric;
      duplicateSuggestionRate: KnowledgeRuntimeLessonsMetric;
      sourceAttributionCompleteness: KnowledgeRuntimeLessonsMetric;
      inputTokens: KnowledgeRuntimeLessonsMetric;
      outputTokens: KnowledgeRuntimeLessonsMetric;
      totalCostUsd: KnowledgeRuntimeLessonsMetric;
      fallbackCount: KnowledgeRuntimeLessonsMetric;
      subsequentAdoption: KnowledgeRuntimeLessonsMetric;
    };
    metricsUnavailable: Array<{
      metric: 'historical_suggestion_count' | 'suggestion_edit_distance' | 'historical_acceptance_rate' | 'duplicate_principle_rate';
      reason: 'not_persisted' | 'not_evaluated';
    }>;
  };
};

export type KnowledgeRuntimeLineage = {
  schema: 'runtime-lineage.v1';
  sessionId: string;
  missionId?: string;
  missionTick?: number;
  loopRunId?: string;
  traceId?: string;
  taskLedgerRootId?: string;
};

export type KnowledgeRuntimeLessonsMetric =
  | { status: 'available'; value: number }
  | { status: 'unavailable'; reason: string };

export type KnowledgeSekbDistillationSuggestion = {
  cluster_summary: string;
  source_trajectory_ids: string[];
  suggested_principle: Record<string, unknown>;
  confidence: number;
};

export type KnowledgeSekbShadowEvaluationExportPayload = {
  workspaceRoot?: string;
  pseudonymizationKey: string;
  writeArtifact?: boolean;
};

export type KnowledgeSekbShadowEvaluationExportResult = HostSuccess & {
  available: boolean;
  reason?: 'runtimeUnavailable' | 'exportFailed' | 'missingKey';
  authority: 'offline_evaluation_evidence_not_runtime_source_of_truth';
  artifactPath?: string;
  recordCount?: number;
  export?: Record<string, unknown>;
};

export type KnowledgeSekbShadowEvaluationProtocolPayload = {
  workspaceRoot?: string;
  pseudonymizationKey: string;
  sampleSize?: number;
  holdoutFraction?: number;
  writeArtifact?: boolean;
};

export type KnowledgeSekbShadowEvaluationProtocolResult = HostSuccess & {
  available: boolean;
  reason?: 'runtimeUnavailable' | 'protocolFailed' | 'missingKey';
  authority: 'offline_evaluation_evidence_not_runtime_source_of_truth';
  artifactPath?: string;
  protocol?: Record<string, unknown>;
  reviewsTemplatePath?: string;
};

export type KnowledgeSekbShadowEvaluationReportPayload = {
  workspaceRoot?: string;
  export?: Record<string, unknown>;
  protocol?: Record<string, unknown>;
  reviews: Array<{
    trajectoryId: string;
    reviewerId: string;
    split: 'development' | 'holdout';
    label: 'valuable' | 'not_valuable' | 'uncertain';
  }>;
  reviewers: [string, string];
  writeArtifact?: boolean;
};

export type KnowledgeSekbShadowEvaluationReportResult = HostSuccess & {
  available: boolean;
  reason?: 'runtimeUnavailable' | 'reportFailed' | 'invalidInput';
  authority: 'offline_evaluation_evidence_not_runtime_source_of_truth';
  artifactPath?: string;
  report?: Record<string, unknown>;
};

export type KnowledgeSekbSuggestPrinciplesPayload = {
  trajectoryIds?: string[] | null;
  minClusterSize?: number;
};

export type KnowledgeSekbSuggestPrinciplesResult = HostSuccess & {
  available: boolean;
  reason?: 'runtimeUnavailable' | 'suggestFailed';
  mode: 'deterministic';
  suggestions: KnowledgeSekbDistillationSuggestion[];
};

export type KnowledgeSekbBatchDistillSuggestPayload = {
  trajectoryIds?: string[] | null;
  minClusterSize?: number;
};

export type KnowledgeSekbBatchDistillSuggestResult = HostSuccess & {
  available: boolean;
  reason?: 'runtimeUnavailable' | 'suggestFailed' | 'featureDisabled';
  mode: 'batch' | 'deterministic_fallback' | 'feature_disabled';
  userVisibleStatus: string;
  suggestions: KnowledgeSekbDistillationSuggestion[];
  operatorEvidence?: Record<string, unknown>;
};

export type KnowledgeSekbConfirmPrinciplePayload = {
  suggestion: KnowledgeSekbDistillationSuggestion;
  edits?: Record<string, unknown> | null;
  /** Required for P3-002 session lineage / DCS experience sink. */
  sessionId?: string;
  sourceSystem?: 'sekb' | 'ui-confirm' | 'batch-distiller' | 'unknown' | string;
  integrityClaim?: 'advisory' | 'confirmed' | 'high_trust' | string;
  /** When true, server rejects elevating summary-only text to high_trust. */
  summaryOnly?: boolean;
  /**
   * Explicit API opt-in for the diagnostic experience-shadow journal.
   * The host resolves workspaceRoot; the runtime config leaf stays observability-only.
   */
  experienceShadow?: { enabled: boolean };
};

export type KnowledgeSekbConfirmProvenance = {
  schema: 'sekb-confirm-provenance.v1';
  sessionId: string;
  sourceSystem: string;
  sourceTrajectoryIds: string[];
  integrity: 'advisory' | 'confirmed' | 'high_trust';
  confirmedAt: string;
  revokeKey: string;
  taskId: 'P3-002';
  findingIds: Array<'F-DATA-002' | 'F-DATA-004'>;
  summaryOnlyClaimDowngraded: boolean;
  highTrustEligible: boolean;
};

export type KnowledgeSekbConfirmPrincipleResult = HostSuccess & {
  available: boolean;
  reason?: 'runtimeUnavailable' | 'confirmFailed' | 'missingSession';
  principleId?: string;
  provenance?: KnowledgeSekbConfirmProvenance;
  dcsWrite?: KnowledgeDcsWriteStatus;
  highTrustEligible?: boolean;
  /** When true, only the SEKB principle was saved (no DCS experience record). */
  principleOnly?: boolean;
};

export type KnowledgeSekbRejectSuggestionPayload = {
  suggestion: KnowledgeSekbDistillationSuggestion;
  reason?: string;
};

export type KnowledgeSekbRejectSuggestionResult = HostSuccess & {
  available: boolean;
  reason?: 'runtimeUnavailable' | 'rejectFailed';
};


export type KnowledgeSekbCaptureTrajectoryPayload = {
  taskIntent: string;
  taskType: string;
  contextTags?: string[];
  steps?: Array<{ action: string; input?: unknown; output?: unknown }>;
  outcome: 'success' | 'failure' | 'partial';
  rawError?: string | null;
  /** Explicit runtime correlation only; never infer lineage from sessionKey. */
  runtimeLineage?: KnowledgeRuntimeLineage;
};

export type KnowledgeSekbCaptureTrajectoryResult = HostSuccess & {
  available: boolean;
  reason?: 'runtimeUnavailable' | 'captureFailed' | 'invalidInput';
  trajectoryId?: string;
  stepCount?: number;
  compressed?: boolean;
};

export type KnowledgeSekbRetrieveForTaskPayload = {
  sessionKey?: string;
  workspaceId?: string;
  taskIntent: string;
  taskType: string;
  contextTags?: string[];
  topK?: number;
};

export type KnowledgeSekbRetrieveForTaskResult = HostSuccess & {
  experienceExposureId?: string;
  available: boolean;
  reason?: 'runtimeUnavailable' | 'retrieveFailed';
  principles: Array<{
    sourceRef?: import('../knowledge/experience').ExperienceRefV1;
    principle_id: string;
    title: string;
    condition: string;
    action: string;
    reason: string;
    retrieval_count: number;
  }>;
  injection: string;
};

export type KnowledgeConfigurePayload = {
  vaultPath?: string;
  renderMode?: 'native' | 'obsidian';
};
export type KnowledgeStatusResult = OptionalHostSuccess & {
  status?: {
    vaultMode?: string;
    renderMode?: string;
    vaultPath?: string;
    vaultExists?: boolean;
    bridge?: Record<string, unknown>;
    bridgePublicArtifactCount?: number | null;
    obsidianCli?: {
      enabled?: boolean;
      requested?: boolean;
      available?: boolean;
      command?: string | null;
    };
    unsafeLocal?: {
      allowPrivateMemoryCoreAccess?: boolean;
      pathCount?: number;
    };
    pageCounts?: Record<string, number>;
    sourceCounts?: Record<string, number>;
    warnings?: Array<{ code?: string; message?: string }>;
  };
};
export type KnowledgeInitResult = OptionalHostSuccess & {
  rootDir?: string;
  created?: boolean;
  createdDirectories?: string[];
  createdFiles?: string[];
};
export type KnowledgeIngestFilesPayload = {
  paths: string[];
  maxFiles?: number;
  maxBytesPerFile?: number;
};
export type KnowledgeIngestItem = {
  inputPath: string;
  sourcePath?: string;
  pageId?: string;
  pagePath?: string;
  title?: string;
  bytes?: number;
  created?: boolean;
  error?: string;
};
export type KnowledgeIngestFilesResult = HostSuccess & {
  items: KnowledgeIngestItem[];
  scanned: number;
  imported: number;
  failed: number;
  truncated: boolean;
};
export type KnowledgeOkfFrontmatter = {
  type: string;
  title?: string;
  description?: string;
  resource?: string;
  tags?: string[];
  timestamp?: string;
  okf_version?: string;
  [key: string]: unknown;
};
export type KnowledgeOkfWarning = {
  code: string;
  message: string;
  conceptId?: string;
  filePath?: string;
  target?: string;
};
export type KnowledgeOkfConcept = {
  conceptId: string;
  filePath: string;
  frontmatter: KnowledgeOkfFrontmatter;
  bodyPreview: string;
  links: string[];
  citations: string[];
  warnings: KnowledgeOkfWarning[];
};
export type KnowledgeValidateOkfBundlePayload = {
  path: string;
};
export type KnowledgeOkfValidationResult = HostSuccess & {
  bundleId?: string;
  bundlePath?: string;
  okfVersion?: string;
  summary: {
    scannedFiles: number;
    markdownFiles: number;
    conceptFiles: number;
    validConcepts: number;
    reservedFiles: number;
    warnings: number;
    errors: number;
    truncated: boolean;
  };
  typeDistribution: Record<string, number>;
  concepts: KnowledgeOkfConcept[];
  warnings: KnowledgeOkfWarning[];
  errors: KnowledgeOkfWarning[];
};
export type KnowledgeImportOkfBundlePayload = {
  path: string;
  conceptIds?: string[];
};
export type KnowledgeOkfImportItem = {
  conceptId: string;
  inputPath: string;
  title?: string;
  frontmatter?: KnowledgeOkfFrontmatter;
  warnings?: KnowledgeOkfWarning[];
  sourcePath?: string;
  pageId?: string;
  pagePath?: string;
  skipped?: boolean;
  error?: string;
};
export type KnowledgeOkfImportResult = HostSuccess & {
  bundleId?: string;
  bundlePath?: string;
  imported: number;
  skipped: number;
  failed: number;
  items: KnowledgeOkfImportItem[];
  mappingPath?: string;
};
export type KnowledgeSearchPayload = {
  query: string;
  profile?: RetrievalProfile;
  maxResults?: number;
  corpus?: 'wiki' | 'memory' | 'all';
  mode?: string;
  sessionKey?: string;
  workspaceId?: string | null;
  /**
   * Area 5 §3.4 — optional role tag for ranking shaping. When set, entries
   * whose `roleTags` contain this tag rank first in the result list. This is
   * ranking-only — entries without the tag remain visible (the KB is a single
   * user's wiki; per-role ACLs are off-spec).
   */
  roleTag?: string;
};
export type KnowledgeRetrievalDiagnosticItem = {
  id: string;
  title: string;
  lookup: string;
  sourceKind: 'wiki-page' | 'memory-file' | 'memory-card' | 'sekb-principle' | 'error-experience' | 'rule' | 'draft' | 'inbox' | 'unknown';
  owner?: SourceRefV2['authorityId'];
  sourceRef?: SourceRefV2;
  reason: string;
  score?: number;
  confidence?: number;
  path?: string;
};
export type KnowledgeRetrievalDiagnostics = {
  query: string;
  corpus: 'wiki' | 'memory' | 'all';
  mode: string;
  backend: 'keyword' | 'hybrid' | 'semantic' | 'fallback-keyword';
  resultCount: number;
  selectedCount: number;
  reason: string;
  items: KnowledgeRetrievalDiagnosticItem[];
};
export type KnowledgeSearchResult = OptionalHostSuccess & {
  results?: Array<Record<string, unknown>>;
  retrievalDiagnostics?: KnowledgeRetrievalDiagnostics;
  [key: string]: unknown;
};
export type KnowledgeGetPayload = {
  lookup: string;
  fromLine?: number;
  lineCount?: number;
  corpus?: 'wiki' | 'memory' | 'all';
  sourceRef?: SourceRefV2;
  revision?: string;
  contentDigest?: string;
  sessionKey?: string;
  workspaceId?: string | null;
};
export type KnowledgeGetResult = OptionalHostSuccess & Record<string, unknown> & {
  sourceRef?: SourceRefV2;
  ownerSnapshot?: OwnerReadSnapshotV1;
  readDenial?: OwnerReadRejectionCode;
};
export type KnowledgeApplyDraftPayload = {
  title: string;
  body: string;
  sourceIds: string[];
  claims?: Array<Record<string, unknown>>;
  contradictions?: string[];
  questions?: string[];
  confidence?: number;
  status?: string;
};
export type KnowledgeApplyDraftResult = OptionalHostSuccess & {
  changed?: boolean;
  operation?: string;
  pagePath?: string;
  pageId?: string;
  compile?: Record<string, unknown>;
  reviewRequired?: boolean;
  draft?: KnowledgeDraft;
  proposal?: KnowledgeChangeProposal;
};
export type KnowledgeCompileResult = OptionalHostSuccess & Record<string, unknown>;
export type KnowledgeLintResult = OptionalHostSuccess & Record<string, unknown>;
export type KnowledgeOpenVaultResult = HostSuccess & { path?: string };
export type KnowledgeDraftType = 'source-note' | 'synthesis' | 'decision' | 'architecture' | 'command' | 'troubleshooting' | 'glossary' | 'procedure';
export type KnowledgeDraftStatus = 'draft' | 'steward_reviewed' | 'approved' | 'rejected' | 'applied';
export type KnowledgeDraftActor = 'user' | 'agent' | 'steward';
export type KnowledgeArtifactType = 'summary' | 'faq' | 'decision-memo' | 'troubleshooting-recipe' | 'concept-map';
export type KnowledgeSourceRef = {
  id: string;
  label?: string;
  kind?: 'chat' | 'file' | 'wiki' | 'task_ledger' | 'trace' | 'task_loop' | 'manual' | 'search_result' | 'other';
  path?: string;
  url?: string;
  /** Optional owner version and digest pins; selection never overrides these. */
  revision?: string;
  contentDigest?: string;
  sourceRef?: SourceRefV2;
};
export type KnowledgeInteractionMvpMetadata = {
  mvpVersion: 'knowledge-interaction-mvp-1';
  recommendation: 'save' | 'review' | 'archive-only';
  score: {
    reusability: number;
    uniqueness: number;
    confidence: number;
    overall: number;
  };
  temporality: 'stable' | 'versioned' | 'ephemeral';
  reason: string;
  missionId: string;
  tick: number;
  outcome: 'idle' | 'running' | 'sleeping' | 'paused' | 'ask_user' | 'complete' | 'blocked' | 'cancelled' | 'error';
  evidenceRefs: string[];
  captureKey: string;
};
export type KnowledgeStewardTriageAction =
  | 'needs-decision'
  | 'ready-for-review'
  | 'possible-duplicate'
  | 'observe'
  | 'reject-low-value';
export type KnowledgeStewardTriage = {
  action: KnowledgeStewardTriageAction;
  confidence: number;
  duplicateOf?: string;
  conflictWith?: string[];
  reason: string;
  suggestedEdits?: string[];
};
export type KnowledgeInboxMetadata = Record<string, unknown> & {
  triage?: KnowledgeStewardTriage;
};
export type KnowledgeErrorExperienceCard = {
  schemaVersion: 1;
  id: string;
  title: string;
  summary: string;
  triggerPattern: {
    errorType: 'compile' | 'runtime' | 'lint' | 'test' | 'logic' | 'convention' | 'architecture' | 'ui-regression';
    keywords: string[];
    filePatterns: string[];
    stackTraceSignature?: string;
    commandSignature?: string;
    scenarioDescription: string;
    routeQueries: string[];
  };
  rootCause: {
    summary: string;
    contributingFactors: string[];
  };
  resolution: {
    steps: string[];
    antiPattern?: string;
    correctPattern?: string;
    codeSnippet?: string;
    verificationCommands: string[];
  };
  applicability: {
    projectScopes: string[];
    modules: string[];
    roles: string[];
    confidence: number;
    severity: 'low' | 'medium' | 'high' | 'blocking';
  };
  provenance: {
    createdFrom: {
      kind: 'chat-session' | 'task-ledger' | 'manual' | 'test-run' | 'runtime-event';
      id: string;
      label?: string;
    };
    sourceRefs: Array<{
      id: string;
      kind: string;
      label?: string;
      path?: string;
    }>;
    createdAt: string;
    lastVerifiedAt?: string;
  };
  effectiveness: {
    hitCount: number;
    acceptedCount: number;
    dismissedCount: number;
    preventedFailureCount: number;
    staleCount: number;
  };
};
export type KnowledgeErrorGuardSignal = {
  text: string;
  kind?: 'command-failure' | 'test-failure' | 'lint-failure' | 'build-failure' | 'runtime-error' | 'user-correction';
  command?: string;
  stackTrace?: string;
  filePaths?: string[];
  sessionKey?: string;
  workspaceId?: string | null;
};
export type KnowledgeErrorGuardAdvisory = {
  id: string;
  targetKind: 'inbox' | 'draft';
  targetId: string;
  cardId: string;
  title: string;
  summary: string;
  whyMatched: string[];
  rootCause: string;
  recommendedResolution: string[];
  confidence: number;
  severity: KnowledgeErrorExperienceCard['applicability']['severity'];
  sourceRefs: KnowledgeSourceRef[];
  provenance: {
    createdFrom: KnowledgeErrorExperienceCard['provenance']['createdFrom'];
    source: 'knowledge-error-experience';
  };
};
export type KnowledgeMatchErrorExperiencePayload = {
  signal: KnowledgeErrorGuardSignal;
  limit?: number;
};
export type KnowledgeMatchErrorExperienceResult = HostSuccess & {
  advisories: KnowledgeErrorGuardAdvisory[];
};
export type KnowledgeErrorExperienceEffectivenessAction = 'hit' | 'accepted' | 'dismissed' | 'prevented-failure' | 'stale';
export type KnowledgeUpdateErrorExperienceEffectivenessPayload = {
  targetKind: 'inbox' | 'draft';
  targetId: string;
  action: KnowledgeErrorExperienceEffectivenessAction;
  note?: string;
};
export type KnowledgeUpdateErrorExperienceEffectivenessResult = HostSuccess & {
  effectiveness?: KnowledgeErrorExperienceCard['effectiveness'];
};
export type KnowledgeDraft = {
  id: string;
  title: string;
  body: string;
  type: KnowledgeDraftType;
  status: KnowledgeDraftStatus;
  sourceIds: string[];
  sourceRefs: KnowledgeSourceRef[];
  tags: string[];
  workspaceId?: string | null;
  agentId?: string | null;
  /**
   * Area 5 §3.4 — optional role-tag binding. Reuses the Role Memory binding
   * vocabulary (`MemoryCard.roleTags`, Area 4) so "role-scoped knowledge"
   * means one thing across both systems. Ranking-only — never access control
   * (every KB read remains available to every role; the KB is a single
   * user's wiki, off-spec for per-role vaults/ACLs).
   */
  roleTags?: string[];
  createdBy: KnowledgeDraftActor;
  confidence?: number;
  stewardNotes?: string;
  warnings?: string[];
  metadata?: KnowledgeInboxMetadata;
  createdAt: string;
  updatedAt: string;
  reviewedAt?: string;
  appliedAt?: string;
  /** KS-01: monotonically increasing governance object revision. Legacy records read as 1. */
  revision?: number;
  /** KS-01: digest of the reviewed content at approval time. */
  reviewedDigest?: string;
  /** KS-01: canonical digest of content-bearing draft fields. */
  contentDigest?: string;
};
export type KnowledgeInboxKind = 'chat-session' | 'task-ledger' | 'clawgraph' | 'file' | 'okf' | 'manual' | 'wiki-result';
export type KnowledgeInboxStatus = 'pending' | 'promoted' | 'dismissed';
export type KnowledgeInboxItem = {
  id: string;
  title: string;
  body: string;
  kind: KnowledgeInboxKind;
  type: KnowledgeDraftType;
  status: KnowledgeInboxStatus;
  sourceIds: string[];
  sourceRefs: KnowledgeSourceRef[];
  tags: string[];
  workspaceId?: string | null;
  agentId?: string | null;
  /** Area 5 §3.4 — optional role-tag binding (ranking-only, see KnowledgeDraft.roleTags). */
  roleTags?: string[];
  createdBy: KnowledgeDraftActor;
  warnings?: string[];
  metadata?: KnowledgeInboxMetadata;
  createdAt: string;
  updatedAt: string;
  promotedAt?: string;
  dismissedAt?: string;
  promotedDraftId?: string;
  promotedProposalId?: string;
};
export type KnowledgeCreateInboxItemPayload = {
  title: string;
  body: string;
  kind?: KnowledgeInboxKind;
  type?: KnowledgeDraftType;
  sourceIds?: string[];
  sourceRefs?: KnowledgeSourceRef[];
  tags?: string[];
  workspaceId?: string | null;
  agentId?: string | null;
  /** Area 5 §3.4 — optional role-tag binding (ranking-only, see KnowledgeDraft.roleTags). */
  roleTags?: string[];
  createdBy?: KnowledgeDraftActor;
  warnings?: string[];
  metadata?: Record<string, unknown>;
};
export type KnowledgeInboxResult = HostSuccess & {
  item?: KnowledgeInboxItem;
  draft?: KnowledgeDraft;
  proposal?: KnowledgeChangeProposal;
};
export type KnowledgeListInboxItemsPayload = {
  status?: KnowledgeInboxStatus | 'all';
  kind?: KnowledgeInboxKind | 'all';
  workspaceId?: string | null;
  limit?: number;
};
export type KnowledgeListInboxItemsResult = HostSuccess & { items: KnowledgeInboxItem[] };
export type KnowledgeUpdateInboxItemPayload = {
  id: string;
} & Partial<Omit<KnowledgeCreateInboxItemPayload, 'createdBy'>>;
export type KnowledgeInboxItemIdPayload = { id: string };
export type KnowledgeChangeOperation = 'create' | 'update' | 'merge' | 'archive' | 'revoke' | 'delete' | 'restore';
export type KnowledgeChangeProposal = {
  id: string;
  operation: KnowledgeChangeOperation;
  status: 'proposed' | 'approved' | 'rejected' | 'applied';
  targetPageIds?: string[];
  draftId?: string;
  diff?: string;
  reason: string;
  sources: KnowledgeSourceRef[];
  requiresUserConfirmation: true;
  createdAt: string;
  updatedAt: string;
  appliedAt?: string;
  /** KS-01: monotonically increasing governance object revision. Legacy records read as 1. */
  revision?: number;
  /** KS-01: canonical digest of the target draft content at proposal creation. */
  contentDigest?: string;
  /** KS-01: digest approved by the reviewer; apply must recompute and match. */
  reviewedDigest?: string;
  /** KS-01: draft revision expected at apply time. */
  expectedRevision?: number;
  /** KS-01: stable idempotency key for the governed effect. */
  idempotencyKey?: string;
  workspaceId?: string | null;
};
export type KnowledgeReviewBundle = {
  /** Stable read-model id derived from proposalId:draftId. */
  id: string;
  draftId: string;
  proposalId: string;
  operation: KnowledgeChangeOperation;
  status: KnowledgeChangeProposal['status'];
  draftStatus: KnowledgeDraftStatus;
  reviewedDigest?: string;
  expectedRevision?: number;
  workspaceId?: string | null;
  contentDigest?: string;
  idempotencyKey?: string;
  draft?: KnowledgeDraft;
  proposal?: KnowledgeChangeProposal;
};
export type KnowledgeListReviewBundlesPayload = {
  status?: KnowledgeChangeProposal['status'] | 'all';
  limit?: number;
};
export type KnowledgeListReviewBundlesResult = HostSuccess & {
  bundles: KnowledgeReviewBundle[];
};
export type KnowledgeDcsWriteStatus =
  | 'persisted'
  | 'journaled_degraded'
  | 'rejected'
  | 'not_attempted'
  | 'principle_only'
  | 'written'
  | 'skipped';
export type KnowledgeStewardConfig = {
  enabled: boolean;
  roleId: string;
  capabilities: {
    canSearch: boolean;
    canRead: boolean;
    canProposeDraft: boolean;
    canClassify: boolean;
    canSuggestMerge: boolean;
    canSuggestArchive: boolean;
    canApplyDirectly: false;
  };
  scope: {
    workspace: boolean;
    agent: boolean;
    global: boolean;
  };
};
/**
 * Area 5 §3.1 — config-driven KB role player variant. Extends the existing
 * `KnowledgeStewardConfig` additively. `capabilities.canApplyDirectly`
 * remains the literal type `false` (preserved boundary); variants differ in
 * focus and classification mode only. Missing/corrupt registry file →
 * registry containing exactly `DEFAULT_STEWARD_CONFIG` (today's behavior).
 */
export type KnowledgeRolePlayerConfig = KnowledgeStewardConfig & {
  displayName?: string;
  description?: string;
  classification?: 'heuristic' | 'semantic';
  reviewFocus?: Array<'classification' | 'duplicates' | 'freshness' | 'conflicts'>;
  /** Optional RoleContract name for the semantic pass (§3.2). Default `roleId`. */
  contractRef?: string;
};
/**
 * Area 5 §3.1 — file-backed registry shape. Lives at
 * `<OpenClaw config dir>/knowledge/steward-roles.json` (KB-local, next to the
 * data it governs — same level as `watched-directories.json`). Loaded lazily
 * with read-or-default pattern; corrupt entries are skipped with a logged
 * issue, never crashing the steward.
 */
export type KnowledgeRoleRegistryFile = {
  version: 1;
  defaultRoleId: string;
  roles: KnowledgeRolePlayerConfig[];
};
export type KnowledgeStewardConfigGetResult = HostSuccess & {
  registry: KnowledgeRoleRegistryFile;
  /** Active role for the current workspace/agent context (defaultRoleId resolved). */
  activeRole?: KnowledgeRolePlayerConfig;
};
export type KnowledgeStewardConfigUpdatePayload = {
  registry?: KnowledgeRoleRegistryFile;
  /** Set the active default role id for new steward reviews. */
  defaultRoleId?: string;
};
export type KnowledgeStewardConfigUpdateResult = HostSuccess & {
  registry: KnowledgeRoleRegistryFile;
  issues?: Array<{ path: string; message: string }>;
};
export type KnowledgeCreateDraftPayload = {
  title: string;
  body: string;
  type?: KnowledgeDraftType;
  sourceIds?: string[];
  sourceRefs?: KnowledgeSourceRef[];
  tags?: string[];
  workspaceId?: string | null;
  agentId?: string | null;
  /** Area 5 §3.4 — optional role-tag binding (ranking-only, see KnowledgeDraft.roleTags). */
  roleTags?: string[];
  createdBy?: KnowledgeDraftActor;
  confidence?: number;
  metadata?: Record<string, unknown>;
};
export type KnowledgeDraftResult = HostSuccess & { draft?: KnowledgeDraft };
export type KnowledgeSourceSet = {
  id: string;
  title: string;
  sourceRefs: KnowledgeSourceRef[];
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
  metadata?: Record<string, unknown>;
};
export type KnowledgeSaveSourceSetPayload = {
  id?: string;
  title: string;
  sourceRefs: KnowledgeSourceRef[];
  metadata?: Record<string, unknown>;
};
export type KnowledgeSourceSetResult = HostSuccess & { sourceSet?: KnowledgeSourceSet };
export type KnowledgeListSourceSetsResult = HostSuccess & { sourceSets: KnowledgeSourceSet[] };
export type KnowledgeDeleteSourceSetPayload = { id: string };
export type KnowledgeSourceSetCitation = {
  refId: string;
  owner: string;
  subjectId: string;
  revision: string;
  contentDigest: string;
  sourceRefs: string[];
  sourceRef?: SourceRefV2;
};
export type KnowledgeSourceSetAnswerSource = {
  conflictGroupId?: string;
  id: string;
  lookup: string;
  title: string;
  excerpt: string;
  path?: string;
  content?: string;
  citation?: KnowledgeSourceSetCitation;
  updatedAt?: string;
  readRange?: { fromLine: number; toLine: number; totalLines?: number; truncated: boolean };
};
export type KnowledgeAnswerFromSourceSetPayload = {
  requestId?: string;
  answerMode?: KnowledgeAnswerMode;
  question: string;
  sourceRefs: KnowledgeSourceRef[];
  artifactType?: KnowledgeArtifactType;
  sourceSetId?: string;
  semantic?: boolean;
  /** Retrieval context filter, not an ACL grant. */
  workspaceId?: string;
  synthesis?: boolean;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
};
export type KnowledgeAnswerFromSourceSetResult = HostSuccess & {
  answerMode?: KnowledgeAnswerMode;
  retainedEvidence?: RetainedEvidenceManifestV1;
  question: string;
  answer: string;
  sources: KnowledgeSourceSetAnswerSource[];
  unknowns: string[];
  suggestedNextActions: string[];
  groundingStatus: 'grounded' | 'partial' | 'missing_sources';
  /** Populated only by a measured answer path; template excerpts omit it. */
  confidence?: number;
  synthesisMode?: 'source-excerpts' | 'model' | 'unknown';
  model?: { status: 'completed' | 'unavailable' | 'error'; runId?: string; reason?: string };
  claims?: AnswerClaimV1[];
  claimSupport?: { status: 'completed' | 'error'; runId?: string; reason?: string; actor: 'knowledge-claim-support'; driven_by: 'agent' };
  rejections?: Array<{ refId: string; owner: string; subjectId: string; reason: string; visibleReason: string }>;
  conflictSet?: Array<{ kind: 'claim' | 'source'; key: string; description: string; stances?: string[]; citations: KnowledgeSourceSetCitation[] }>;
  retrievalDiagnostics: KnowledgeRetrievalDiagnostics;
  retrieval?: KnowledgeRetrievalReport;
  semanticRequested?: boolean;
  semanticLane?: {
    status: 'available' | 'unavailable' | 'error';
    providerId?: string;
    dimension?: number;
    reason?: string;
  };
};
export type KnowledgeCreateArtifactDraftPayload = {
  artifactType: KnowledgeArtifactType;
  title?: string;
  question?: string;
  sourceRefs: KnowledgeSourceRef[];
  sourceSetId?: string;
  semantic?: boolean;
  workspaceId?: string;
  metadata?: Record<string, unknown>;
};
export type KnowledgeListDraftsPayload = {
  status?: KnowledgeDraftStatus | 'all';
  workspaceId?: string | null;
  limit?: number;
  /**
   * Area 5 §3.4 — optional role tag for ranking shaping. When set, drafts
   * whose `roleTags` contain this tag rank first in the returned list.
   * Ranking-only — drafts without the tag remain visible.
   */
  roleTag?: string;
};
export type KnowledgeListDraftsResult = HostSuccess & { drafts: KnowledgeDraft[] };
export type KnowledgeGetDraftPayload = { id: string };
export type KnowledgeUpdateDraftPayload = { id: string } & Partial<Omit<KnowledgeCreateDraftPayload, 'createdBy'>>;
export type KnowledgeReviewDraftPayload = {
  id: string;
  action: 'approve' | 'reject' | 'request_changes';
  stewardNotes?: string;
  warnings?: string[];
};
export type KnowledgeProposeChangePayload = {
  operation: KnowledgeChangeOperation;
  targetPageIds?: string[];
  draftId?: string;
  diff?: string;
  reason: string;
  sources?: KnowledgeSourceRef[];
  idempotencyKey?: string;
};
export type KnowledgeProposalResult = HostSuccess & { proposal?: KnowledgeChangeProposal };
export type KnowledgeListProposalsPayload = {
  status?: KnowledgeChangeProposal['status'] | 'all';
  limit?: number;
};
export type KnowledgeListProposalsResult = HostSuccess & { proposals: KnowledgeChangeProposal[] };
export type KnowledgePreviewChangePayload = { id: string };
export type KnowledgePreviewChangeResult = HostSuccess & {
  proposal?: KnowledgeChangeProposal;
  draft?: KnowledgeDraft;
  preview?: string;
};
export type KnowledgeApplyReviewedChangePayload = {
  /** KS-01 single ReviewBundle selection. */
  reviewBundleId?: string;
  /** Legacy read compatibility. Do not use for new mutations. */
  id?: string;
};
export type KnowledgeReviewApplyConflict = {
  code:
    | 'bundle_not_found'
    | 'draft_proposal_mismatch'
    | 'stale_revision'
    | 'stale_digest'
    | 'workspace_mismatch'
    | 'target_not_found'
    | 'not_approved'
    | 'draft_not_approved';
  reason: string;
  expectedRevision?: number;
  actualRevision?: number;
};
export type KnowledgeGovernanceCompensation = {
  status: 'compensated' | 'partial' | 'unrecoverable';
  reason?: string;
};

export type KnowledgeGovernanceReceipt = {
  schema: 'knowledge-governance-receipt.v1';
  receiptId: string;
  operation: KnowledgeChangeOperation;
  owner: 'memory-wiki' | 'memory-slot' | 'sekb';
  subjectId: string;
  subjectRevision?: string;
  contentDigest: string;
  idempotencyKey: string;
  status: 'committed' | 'failed';
  committedAt?: string;
  evidenceRefs: string[];
  compensation?: KnowledgeGovernanceCompensation;
};

export type KnowledgeApplyReviewedChangeResult = KnowledgeApplyDraftResult & {
  proposal?: KnowledgeChangeProposal;
  draft?: KnowledgeDraft;
  reviewBundle?: KnowledgeReviewBundle;
  conflict?: KnowledgeReviewApplyConflict;
  receipt?: KnowledgeGovernanceReceipt;
  compensation?: KnowledgeGovernanceCompensation;
};

export type KnowledgeListGovernanceReceiptsResult = HostSuccess & {
  receipts: KnowledgeGovernanceReceipt[];
};
export type KnowledgeStewardReviewPayload = {
  draftId?: string;
  title?: string;
  body?: string;
  sourceIds?: string[];
  tags?: string[];
};
export type KnowledgeStewardReviewResult = HostSuccess & {
  config: KnowledgeStewardConfig;
  type: KnowledgeDraftType;
  tags: string[];
  warnings: string[];
  notes: string;
  findings?: KnowledgeStewardFinding[];
  reviewEvidence?: {
    draftRevision?: number;
    draftDigest: string;
    reviewFocus: string[];
    sources: Array<{ sourceId: string; revision: string; contentDigest: string }>;
    unverified: string[];
    modelStatus: 'heuristic' | 'completed' | 'unavailable';
    driven_by: 'agent';
    actor: 'knowledge-steward';
  };
};
export type KnowledgeStewardFinding = {
  kind: 'duplicate' | 'conflict' | 'stale' | 'quality';
  severity: 'info' | 'warning' | 'error';
  message: string;
  citations: Array<{ sourceId: string; quote: string; revision?: string; contentDigest?: string }>;
  verified?: boolean;
  unverifiedReason?: string;
};
/**
 * Area 5 §3.2 — structured output from the optional semantic steward pass.
 * The heuristic pass runs first (instant, offline-safe); if the active role
 * has `classification: 'semantic'` and an LLM invoker is available, this
 * second pass refines type/tags and adds judgment warnings. LLM failure or
 * missing invoker → heuristic result stands, notes record "semantic pass
 * unavailable".
 */
export type StewardSemanticReview = {
  type: KnowledgeDraftType;
  tags: string[];
  warnings: Array<{ kind: 'duplicate' | 'conflict' | 'stale' | 'quality'; message: string; relatedPageId?: string }>;
  confidence: number;
  findings?: KnowledgeStewardFinding[];
};
export type KnowledgeProvenanceTargetKind = 'wiki-page' | 'draft' | 'inbox' | 'okf-concept' | 'manual';
export type KnowledgeReferenceKind = 'chat' | 'search' | 'draft' | 'task-ledger' | 'clawgraph' | 'manual';
export type KnowledgeReferenceEvent = {
  id: string;
  kind: KnowledgeReferenceKind;
  timestamp: string;
  sessionKey?: string;
  workspaceId?: string | null;
  agentId?: string | null;
  lookup?: string;
  query?: string;
  note?: string;
};
export type KnowledgeProvenanceRecord = {
  id: string;
  targetId: string;
  targetKind: KnowledgeProvenanceTargetKind;
  title?: string;
  sourceRefs: KnowledgeSourceRef[];
  references: KnowledgeReferenceEvent[];
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};
export type KnowledgeRecordReferencePayload = {
  targetId: string;
  targetKind?: KnowledgeProvenanceTargetKind;
  title?: string;
  sourceRefs?: KnowledgeSourceRef[];
  reference?: Partial<Omit<KnowledgeReferenceEvent, 'id' | 'timestamp'>>;
  metadata?: Record<string, unknown>;
};
export type KnowledgeProvenancePayload = {
  targetId: string;
  targetKind?: KnowledgeProvenanceTargetKind;
};
export type KnowledgeProvenanceResult = HostSuccess & { record?: KnowledgeProvenanceRecord };



// 鈹€鈹€ Governance Audit 鈹€鈹€

export type KnowledgeGovernanceIssueSeverity = 'error' | 'warning' | 'info';

export type KnowledgeGovernanceIssueCategory = 'contradiction' | 'stale' | 'dangling' | 'duplicate' | 'provenance_gap';

export type KnowledgeGovernanceIssue = {
  id: string;
  category: KnowledgeGovernanceIssueCategory;
  severity: KnowledgeGovernanceIssueSeverity;
  title: string;
  description: string;
  affectedPageIds: string[];
  affectedPagePaths: string[];
  stewardSuggestion?: string;
  detectedAt: string;
};
export type KnowledgeQualityMetricKind =
  | 'stale_cards'
  | 'duplicate_clusters'
  | 'source_gaps'
  | 'unreferenced_pages'
  | 'low_confidence_high_hit_cards'
  | 'high_dismissal_cards';
export type KnowledgeQualityMetric = {
  kind: KnowledgeQualityMetricKind;
  count: number;
  severity: KnowledgeGovernanceIssueSeverity;
  affectedIds: string[];
};
export type KnowledgeQualityMetrics = {
  staleCards: number;
  duplicateClusters: number;
  sourceGaps: number;
  unreferencedPages: number;
  lowConfidenceHighHitCards: number;
  highDismissalCards: number;
  metrics: KnowledgeQualityMetric[];
};

export type KnowledgeGovernanceResult = HostSuccess & {
  runAt: string;
  issues: KnowledgeGovernanceIssue[];
  summaries: {
    contradictions: number;
    stale: number;
    dangling: number;
    duplicates: number;
    provenanceGaps: number;
  };
  qualityMetrics?: KnowledgeQualityMetrics;
};

// 鈹€鈹€ Watched Directories 鈹€鈹€

export type KnowledgeWatchedDirectoryConfig = {
  id: string;
  path: string;
  patterns: string[];
  enabled: boolean;
  ingestNewFiles: boolean;
  autoCompile: boolean;
  requiresReview: boolean;
};

export type KnowledgeWatchedDirectoryEventType = 'ingested' | 'compiled' | 'skipped' | 'error';

export type KnowledgeWatchedDirectoryEvent = {
  id: string;
  configId: string;
  event: KnowledgeWatchedDirectoryEventType;
  filePath: string;
  detail?: string;
  timestamp: string;
};

export type KnowledgeListWatchedDirectoryEventsPayload = {
  configId: string;
  limit?: number;
};

export type KnowledgeGithubConnectorConfig = {
  id: string;
  kind: 'github-public-directory';
  owner: string;
  repo: string;
  ref: string;
  /** One file or one directory; directory traversal is deliberately nonrecursive. */
  path: string;
  enabled: boolean;
  intervalSeconds: number;
};
export type KnowledgeConnectorReceipt = {
  connectorId: string;
  observedAt: string;
  lastSuccessAt?: string;
  retryAt?: string;
  status: 'ok' | 'access-lost' | 'error';
  created: number;
  updated: number;
  withdrawn: number;
  unchanged: number;
  error?: string;
  driven_by: 'agent';
  actor: 'knowledge-github-connector';
};

export type CronUpdatePayload = { id: string; input: CronJobUpdateInput };
export type CronIdPayload = { id: string };
export type CronTogglePayload = CronIdPayload & { enabled: boolean };
export type CronSessionHistoryPayload = { sessionKey: string; limit?: number };
export type CronSessionHistoryResult = {
  messages?: RawMessage[];
  browserAutomationRuns?: BrowserAutomationRunResult[];
};

export type GitPathPayload = { path: string; approvalId?: string };
export type GitPathsPayload = { paths: string[]; approvalId?: string };
export type GitFileDiffPayload = { path: string; mode?: GitDiffMode };
export type GitCommitPayload = { message: string; paths?: string[]; approvalId?: string };
export type GitBranchCheckoutPayload = { name: string; approvalId?: string };
export type GitBranchCreatePayload = { name: string; startPoint?: string; checkout?: boolean; approvalId?: string };
export type GitStashPayload = { message?: string; includeUntracked?: boolean; approvalId?: string };
export type GitStashRefPayload = { selector: string; approvalId?: string };
export type GitWorktreeAddPayload = { branch: string; path?: string; startPoint?: string; checkoutNewBranch?: boolean; approvalId?: string };
export type GitFetchPayload = { remote?: string; approvalId?: string };
export type GitPullPayload = { remote?: string; branch?: string; rebase?: boolean; approvalId?: string };
export type GitPushPayload = { remote?: string; branch?: string; setUpstream?: boolean; approvalId?: string };
export type GitMergePayload = { ref: string; noFastForward?: boolean; approvalId?: string };
export type GitRebasePayload = { ref: string; approvalId?: string };
export type GitResetPayload = { ref?: string; mode?: 'soft' | 'mixed' | 'hard'; approvalId?: string };
export type GithubPrListPayload = { state?: 'open' | 'closed' | 'merged' | 'all'; limit?: number };
export type GithubPrViewPayload = { number: number };
export type GithubPrOpenPayload = { number: number };
export type GitCapabilitiesResult = HostSuccess & GitCapabilities;
export type GitStatusResult = HostSuccess & { status: GitRepositoryStatus };
export type GitDiffListResult = HostSuccess & {
  changes: GitRepositoryStatus['changes'];
  patch?: string;
  patchArtifacts: GitPatchArtifactV1[];
  patchArtifactError?: RemoteForgeErrorV1;
  tooLarge?: boolean;
};
export type GitFileDiffResult = HostSuccess & GitDiffResult;
export type GitBranchListResult = HostSuccess & { branches: GitBranch[] };

export type GitMergeBasePayload = { base: string; head?: string };
export type GitMergeBaseResult = HostSuccess & { mergeBase?: string };
export type GitLogPayload = { ref?: string; limit?: number };
export type GitLogResult = HostSuccess & {
  commits: GitCommitInfo[];
  ref?: string;
  ahead?: number;
  behind?: number;
};
export type GitReflogPayload = { limit?: number };
export type GitReflogResult = HostSuccess & { entries: GitReflogEntry[]; truncated?: boolean };
export type GitStashListResult = HostSuccess & { stashes: GitStashEntry[] };
export type GitWorktreeListResult = HostSuccess & { worktrees: GitWorktree[] };
export type GithubAuthStatusResult = HostSuccess & GithubAuthStatus;
export type GithubRepoResult = HostSuccess & { repository: GithubRepository | null };
export type GithubPrListResult = HostSuccess & { pullRequests: GithubPrSummary[] };
export type GithubPrViewResult = HostSuccess & { pullRequest: GithubPrSummary | null; body?: string };
export type GithubPrCreateResult = GitOperationResult & { pullRequest?: GithubPrSummary; reused?: boolean };

export type TaskLedgerWorkspacePayload = { workspaceId?: string | null };
export type TaskSystemCommandPayload = { workspaceId: string; command: import('../task-system/types').TaskSystemCommand };
export type TaskSystemCommandResult = HostSuccess & { result?: unknown; error?: string };
export type TaskTracePayload = import('../task-system/trace').TaskTraceQuery & { workspaceId: string };
export type TaskTraceResult = HostSuccess & { report?: import('../task-system/trace').TaskTraceReport; error?: string };
export type TaskSystemListResult = HostSuccess & { tasks: import('../task-system/types').TaskView[] };
export type TaskSystemQueryPayload = TaskLedgerWorkspacePayload & import('../task-system/types').TaskQuery;
export type TaskSystemQueryResult = HostSuccess & import('../task-system/types').TaskPage;
export type TaskSessionPayload = { workspaceId: string; sessionKey: string; expectedSessionGeneration?: string };
export type TaskSessionResult = HostSuccess & import('../task-system/types').TaskSessionSnapshot;
export type TaskContextHintPayload = TaskSessionPayload & { enabled?: boolean; sourceRef?: SourceRefV2 };
export type TaskContextHintResult = HostSuccess & { hint: import('../knowledge/code-task-context').TaskContextHintV1 };
export type TaskLedgerSnapshotResult = HostSuccess & { snapshot: TaskLedgerSnapshot };
export type TaskLedgerAppendEventsPayload = TaskLedgerWorkspacePayload & {
  events: TaskLedgerEventInput[];
  idempotencyKey?: string | null;
};
export type TaskLedgerNodeInput = {
  title: string;
  kind?: TaskLedgerNodeKind;
  parentId?: string | null;
  status?: TaskLedgerNodeStatus;
  progress?: number;
  owner?: TaskLedgerNode['owner'];
  priority?: TaskLedgerNode['priority'];
  tags?: string[];
  description?: string;
  evidenceRefs?: TaskLedgerEvidenceRef[];
  metadata?: Record<string, unknown>;
};
export type TaskLedgerCreateNodePayload = TaskLedgerWorkspacePayload & {
  node: TaskLedgerNodeInput;
  idempotencyKey?: string | null;
};
export type TaskLedgerUpdateNodePayload = TaskLedgerWorkspacePayload & {
  nodeId: string;
  patch: Partial<Omit<TaskLedgerNode, 'id' | 'createdAt'>>;
  idempotencyKey?: string | null;
};
export type TaskLedgerAddEdgePayload = TaskLedgerWorkspacePayload & {
  edge: Omit<TaskLedgerEdge, 'id' | 'createdAt'> & { id?: string; createdAt?: string };
  idempotencyKey?: string | null;
};
export type TaskLedgerLinkSessionPayload = TaskLedgerWorkspacePayload & {
  nodeId?: string | null;
  sessionKey: string;
  agentId?: string | null;
  traceId?: string | null;
  relation?: TaskLedgerSessionLink['relation'];
  sourceSessionKey?: string | null;
  /** Optional generation fence for links that must not survive a session handoff. */
  sessionGeneration?: string | null;
  summary?: string;
  /** Relay depth of the linked session, so the depth is readable without re-walking the chain. */
  handoffDepth?: number;
  idempotencyKey?: string | null;
};
export type TaskLedgerReviewPayload = TaskLedgerWorkspacePayload & {
  nodeId: string;
  reason?: string;
  status?: TaskLedgerNodeStatus;
  idempotencyKey?: string | null;
};
export type TaskLedgerCompletionOwnerRefs = {
  taskId: string;
  candidateDigest: string;
  generation: string;
  /** Identifier in the existing Evidence Verifier/owner receipt store. */
  verifierReceiptId: string;
  /** Identifier in the existing RC-04 EffectReceipt store. */
  effectReceiptId: string;
};

export type TaskLedgerSubmitCompletionPayload = TaskLedgerWorkspacePayload & {
  refs: TaskLedgerCompletionOwnerRefs;
  idempotencyKey?: string | null;
};
export type TaskLedgerSubmitCompletionResult = TaskLedgerSnapshotResult & {
  accepted: boolean;
  reason?: string;
};

export type TaskLedgerExportHtmlPayload = TaskLedgerWorkspacePayload & { includeHistory?: boolean };
export type TaskLedgerExportHtmlResult = HostSuccess & { path: string };

export type RemoteTaskCreatePayload = {
  command: RemoteTaskCommand;
  source?: 'local' | 'relay' | 'channel' | 'api';
  reason?: string;
};
export type RemoteTaskIdPayload = { id: string };
export type RemoteTaskListResult = HostSuccess & RemoteTaskSnapshot;
export type RemoteTaskRecordResult = HostSuccess & { task: RemoteTaskRecord };
export type RemoteTaskPreviewResult = HostSuccess & RemoteTaskPreview;
export type RemoteTaskApprovePayload = RemoteTaskIdPayload & { approved?: boolean };

export type ClawGraphWorkspacePayload = { workspaceId?: string | null };
export type ClawGraphListWorkflowsResult = HostSuccess & {
  available?: boolean;
  workflows: ClawGraphWorkflowFile[];
  workspaceId?: string | null;
  workspaceRoot?: string | null;
};
export type ClawGraphCompilePayload = ClawGraphWorkspacePayload & {
  workflowYaml?: string;
  sourcePath?: string;
};
export type ClawGraphCompileHostResult = HostSuccess & {
  available?: boolean;
  compile: ClawGraphCompileResult;
  workflow?: ClawGraphWorkflowFile;
};
export type ClawGraphRunPayload = ClawGraphCompilePayload & {
  sessionKey: string;
  agentId?: string;
  approvalId?: string;
};
export type ClawGraphRunResult = HostSuccess & {
  available?: boolean;
  blocked?: boolean;
  approvalRequired?: boolean;
  approval?: PermissionApprovalEvent;
  compile?: ClawGraphCompileResult;
  snapshot?: ClawGraphRunSnapshot | null;
};
export type ClawGraphRunIdPayload = {
  runId: string;
};
export type ClawGraphStatusResult = HostSuccess & {
  available?: boolean;
  blocked?: boolean;
  approvalRequired?: boolean;
  approval?: PermissionApprovalEvent;
  snapshot?: ClawGraphRunSnapshot | null;
};
export type ClawGraphEventsPayload = ClawGraphRunIdPayload & {
  limit?: number;
};
export type ClawGraphEventsResult = HostSuccess & {
  available?: boolean;
  events: ClawGraphRunEvent[];
};
export type ClawGraphAbortPayload = ClawGraphRunIdPayload & {
  reason?: string;
  approvalId?: string;
};
export type ClawGraphReviewPayload = ClawGraphRunIdPayload & {
  reviewId: string;
  decision: ClawGraphReviewDecision;
  reason?: string;
  approvalId?: string;
};

export type SkillsStatusResult = {
  skills?: {
    skillKey: string;
    slug?: string;
    name?: string;
    description?: string;
    disabled?: boolean;
    emoji?: string;
    version?: string;
    author?: string;
    config?: Record<string, unknown>;
    bundled?: boolean;
    always?: boolean;
    source?: string;
    baseDir?: string;
    filePath?: string;
  }[];
};
export type LocalSkillsResult = HostSuccess & { skills?: Skill[] };
export type SkillConfigsResult = Record<string, { enabled?: boolean; apiKey?: string; env?: Record<string, string> }>;
export type SkillKeyPayload = { skillKey: string };
export type SkillUpdateConfigPayload = SkillKeyPayload & {
  enabled?: boolean;
  apiKey?: string;
  env?: Record<string, string>;
};
export type SkillUpdateConfigsPayload = { updates: SkillUpdateConfigPayload[] };
export type SkillUpdatePayload = SkillKeyPayload & { enabled?: boolean };
export type SkillQuickAccessPayload = { workspace?: string };
export type ClawHubInstalledSkill = {
  slug: string;
  version?: string;
  source?: string;
  baseDir?: string;
};
export type ClawHubCapabilityResult = HostSuccess & { capability?: JsonRecord };
export type ClawHubListResult = HostSuccess & {
  results?: ClawHubInstalledSkill[];
};
export type ClawHubSearchPayload = { query?: string };
export type ClawHubSearchResult = HostSuccess & {
  results?: MarketplaceSkill[];
};
export type ClawHubInstallPayload = { slug: string; version?: string };
export type ClawHubUninstallPayload = { slug: string };
export type ClawHubOpenPayload = {
  skillKey?: string;
  slug?: string;
  baseDir?: string;
};
export type SkillPackId = 'superpowers' | 'officecli';
export type SkillPackStatus = 'notInstalled' | 'installing' | 'installed' | 'enabled' | 'syncNeeded' | 'error';
export type SkillPackSkill = {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  installed: boolean;
  sourcePath?: string;
  managedPath?: string;
};
export type SkillPackSummary = {
  id: SkillPackId;
  name: string;
  description: string;
  status: SkillPackStatus;
  enabled: boolean;
  installedVersion?: string;
  skills: SkillPackSkill[];
  error?: string;
};
export type SkillPackListResult = HostSuccess & { packs?: SkillPackSummary[] };
export type SkillPackPayload = { packId: SkillPackId };
export type SkillPackSetEnabledPayload = SkillPackPayload & { enabled: boolean };
export type SkillPackReadSkillPayload = SkillPackPayload & { skillId: string };
export type SkillPackReadSkillResult = HostSuccess & { content?: string };

export type OfficecliInfo = {
  installed: boolean;
  version: string | null;
  path: string | null;
  runtimeError: string | null;
};
export type OfficecliSkill = {
  id: string;
  category: string;
  icon: string;
  sortOrder: number;
  displayName: Record<string, string>;
  description: Record<string, string>;
  installedCentrally: boolean;
};
export type OfficecliSkillSyncReport = {
  synced: number;
  errors: string[];
};
export type OfficecliInstallPayload = { taskId?: string };
export type OfficecliInstallEventKind = 'started' | 'log' | 'completed' | 'failed';
export type OfficecliInstallEvent = {
  taskId: string;
  kind: OfficecliInstallEventKind;
  payload: string;
};
export type OfficecliSkillContentPayload = { skillId: string };
export type OfficecliSkillAgentPayload = { skillId: string; agentId: string };
export type OfficecliSkillLinkState =
  | 'not_linked'
  | 'linked_to_codeg'
  | 'linked_elsewhere'
  | 'blocked_by_real_directory'
  | 'broken';
export type OfficecliSkillInstallStatus = {
  expertId: string;
  skillId: string;
  agentId: string;
  agentType: string;
  agentName: string;
  state: OfficecliSkillLinkState;
  linkPath: string;
  targetPath: string | null;
  expectedTargetPath: string;
  copyMode: boolean;
  installedCentrally: boolean;
};
export type OfficecliSkillLinkOp = {
  expertId: string;
  skillId?: string;
  agentId: string;
  agentType?: string;
  enable: boolean;
};
export type OfficecliSkillLinkOpResult = {
  expertId: string;
  skillId: string;
  agentId: string;
  agentType: string;
  ok: boolean;
  status: OfficecliSkillInstallStatus | null;
  error: string | null;
};
export type OfficecliSkillApplyLinksPayload = { ops: OfficecliSkillLinkOp[] };
export type OfficecliRenderHtmlPayload = { rootPath: string; path: string };
export type OfficecliWatchPayload = { rootPath: string; path: string };
export type OfficecliWatchStarted = {
  port: number;
  cap: string;
};

export type UsageExecutionStatus = 'succeeded' | 'failed' | 'aborted' | 'unknown';
export type UsageRetryKind = 'initial' | 'retry' | 'fallback' | 'unknown';

export type UsageHistoryEntry = {
  timestamp: string;
  sessionId: string;
  agentId: string;
  model?: string;
  provider?: string;
  content?: string;
  usageStatus?: 'available' | 'missing' | 'error';
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  costUsd?: number;
  /** Observational execution outcome from the producing assistant message. */
  executionStatus?: UsageExecutionStatus;
  /** Retry/fallback relation derived from persisted attempt/model-call indexes. */
  retryKind?: UsageRetryKind;
  /** Present when the call can be joined to receipt/model-call identity. */
  attributionStatus?: 'known' | 'unknown';
  runId?: string;
  attemptIndex?: number;
  modelCallIndex?: number;
  wireAttemptIndex?: number;
  correlationDigest?: string;
};
export type UsageHistoryPayload = { limit?: number };

export type UsageAggregateWindow = '7d' | '30d' | 'all';
export type UsageAggregateSummaryPayload = { window?: UsageAggregateWindow };
export type UsageAggregateDimension = {
  key: string;
  label: string;
  records: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  costUsd: number;
  promptTokens: number;
  cacheHitRate: number | null;
};
export type UsageAggregateDayBucket = UsageAggregateDimension & { date: string };
export type UsageAggregateSummary = {
  window: UsageAggregateWindow;
  generatedAt: number;
  scannedFiles: number;
  scannedEntries: number;
  entriesInWindow: number;
  billableEntries: number;
  missingEntries: number;
  errorEntries: number;
  failedEntries?: number;
  abortedEntries?: number;
  retriedEntries?: number;
  unknownAttributionEntries?: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  costUsd: number;
  promptTokens: number;
  cacheHitRate: number | null;
  earliestTimestamp: string | null;
  latestTimestamp: string | null;
  days: UsageAggregateDayBucket[];
  models: UsageAggregateDimension[];
  agents: UsageAggregateDimension[];
};

export type WorkspaceLiveUsagePayload = { sessionKey: string; runId?: string | null; streaming?: boolean };
export type WorkspaceLiveUsageResult = HostSuccess & { usage: LiveTokenUsage };
export type WorkspaceContextRangePayload = {
  sessionKey: string;
  expectedSessionId?: string;
  modelRef?: string | null;
  messageCount?: number;
  usedTokens?: number | null;
};
export type WorkspaceContextRangeResult = HostSuccess & { range: WorkspaceContextRange };
export type PromptCacheStatusPayload = {
  sessionKey: string;
  modelRef?: string | null;
  action?: PromptCacheRiskAction;
  targetModelRef?: string | null;
  usedTokens?: number | null;
};
export type PromptCacheStatusResult = HostSuccess & { assessment: PromptCacheRiskAssessment };
export type PromptCacheRiskEventPayload = {
  sessionKey: string;
  action: PromptCacheRiskAction;
  severity: PromptCacheRiskSeverity;
  status: PromptCacheStatus;
  decision: PromptCacheRiskDecision;
  hitRate?: number | null;
  promptTokens?: number;
  estimatedExtraCostUsd?: number;
  reason?: string;
};
export type PromptCacheRiskEventResult = HostSuccess & { event: PromptCacheRiskAssessment['lastRiskEvent'] };

export type DeliveryChannelAccount = {
  accountId: string;
  name: string;
  isDefault: boolean;
};
export type DeliveryChannelGroup = {
  channelType: string;
  defaultAccountId: string;
  accounts: DeliveryChannelAccount[];
};


// 鈹€鈹€ Topic types 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

export type TopicEntry = {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  updatedAt: number;
};

export type TopicCreatePayload = {
  name: string;
  description?: string;
  agentId?: string;
  workspacePath?: string;
};

export type TopicUpdatePayload = {
  id: string;
  name?: string;
  description?: string;
  contextMd?: string;
  agentId?: string;
  workspacePath?: string;
};

export type TopicDeletePayload = {
  id: string;
  agentId?: string;
  workspacePath?: string;
};

export type TopicContextPayload = {
  id: string;
  agentId?: string;
  workspacePath?: string;
};
export type DeliveryTargetsResult = HostSuccess & { targets: DeliveryChannelGroup[] };

// ── Area 4 §3.3: Memory facade payload/result types ──────────────────────────
// The underlying gateway `memory.*` RPCs return untyped objects; these types
// give the renderer a typed surface. All re-exported from shared/types/memory
// where they already exist.

export type MemoryListPayload = {
  roleName?: string;
  scope?: MemoryCardScope;
  status?: 'all' | MemoryCardStatus;
  limit?: number;
};

export type MemoryListResult = HostSuccess & {
  cards: MemoryCard[];
};

export type MemorySearchPayload = MemoryListPayload & {
  query: string;
  topK?: number;
};

export type MemoryDetailPayload = {
  id: string;
  // Gateway accepts 4 kinds; typed facade passes them through. UI consumers
  // that only handle 'card' | 'proposal' can narrow at the call site.
  kind?: 'card' | 'proposal' | 'conflict' | 'injection';
};

export type MemoryDetailResult = HostSuccess & {
  card?: MemoryCard;
  proposal?: MemoryProposalRecord;
  conflict?: MemoryConflict;
  evidence?: MemoryEvidenceCheckResult;
  // Gateway's getMemoryDetail returns a richer object for conflict/injection
  // kinds; typed facade keeps these as opaque records so the panel can cast.
  [key: string]: unknown;
};

// Gateway's proposeMemoryCard/updateMemoryCard return MemoryGatekeeperDecision
// fields directly (action/accepted/reason/card/conflicts/...), not nested
// under a `decision` key. The result type matches that shape.
export type MemoryProposeResult = HostSuccess & Partial<MemoryGatekeeperDecision>;

// Gateway memory.previewProposal returns the same decision surface as MemoryProposalPreview
// (wouldWrite:false, conflicts, evidence) flattened under HostSuccess.
export type MemoryProposalPreviewResult = HostSuccess & {
  preview: MemoryProposalPreview;
};

export type MemoryUpdatePayload = {
  id: string;
  patch: MemoryProposal;
};

export type MemoryUpdateResult = MemoryProposeResult;

// Gateway returns { health: MemoryHealthReport }; the facade flattens it so
// the typed result IS the report (no nested `.health` access needed).
export type MemoryHealthReportResult = HostSuccess & MemoryHealthReport;

export type MemoryExplainInjectionPayload = {
  injectionId?: string;
  sessionKey?: string;
  roleName?: string;
  limit?: number;
};

export type MemoryExplainInjectionResult = HostSuccess & {
  injections: MemoryInjectionRecord[];
};

// R3-2.2 "本轮注入了什么" — sanitized COMPASS memory-injection receipt entry.
// Refs, counts, and producer source only; never raw injected content. Mirrors
// openclaw_runtime MemoryInjectionReceiptEntry (context-engine).
export type MemoryInjectionReceiptEntry = {
  sessionKey?: string | null;
  /** Producer source (the receipt adapter id, e.g. compass-pre-reply-retrieval). */
  source: string;
  selected: string[];
  omitted: string[];
  budgetCharsApplied: number;
  budgetCharsRequested: number;
  createdAt: number;
};

export type MemoryInjectionReceiptsPayload = {
  sessionKey?: string;
  limit?: number;
};

export type MemoryInjectionReceiptsResult = HostSuccess & {
  receipts: MemoryInjectionReceiptEntry[];
};

// R3-2.4 proposeFacts manual-confirm queue — one pending runtime-memory fact
// candidate awaiting human confirmation. Sanitized projection only.
export type MemoryProposeFactsCandidate = {
  factId: string;
  subject: string;
  predicate: string;
  objectSummary: string;
  confidence: number | null;
  source: string;
  proposedAt: number | null;
};

export type MemoryProposeFactsListPayload = {
  limit?: number;
};

export type MemoryProposeFactsListResult = HostSuccess & {
  /** False when the shadow/proposeFacts flags are off (default). */
  enabled: boolean;
  candidates: MemoryProposeFactsCandidate[];
};

export type MemoryProposeFactsConfirmPayload = {
  factId: string;
  approvedBy?: string;
};

// confirmed:false is a legitimate outcome (owner-convergence blocked or
// persistence disabled), distinct from success:false (RPC/validation error).
export type MemoryProposeFactsConfirmResult = HostSuccess & {
  confirmed: boolean;
  message: string;
  factId?: string;
};

/**
 * Runtime exec-approval boundary (TF-0240). `list` reads the Gateway's pending
 * exec approvals; `resolve` answers exactly one of them with a decision the
 * runtime already offered for that request.
 */
export type RuntimeApprovalPendingEntry = {
  approvalId: string;
  command: string;
  commandPreview?: string | null;
  cwd?: string | null;
  host?: string | null;
  agentId?: string | null;
  sessionKey?: string | null;
  allowedDecisions: string[];
  createdAtMs?: number;
  expiresAtMs?: number;
};
export type RuntimeApprovalListResult = {
  pending: RuntimeApprovalPendingEntry[];
};
export type RuntimeApprovalResolvePayload = {
  approvalId: string;
  decision: string;
};
export type RuntimeApprovalResolveResult =
  | { success: true; approvalId: string; decision: string }
  | { success: false; error: string };


export type MemorySurfacePayload = {
  limit?: number;
};

export type MemorySurfaceResult = HostSuccess & MemorySurfaceSnapshot;

export type MemoryApproveCandidatePayload = {
  source: MemorySurfaceSource;
  id: string;
};

export type MemoryApproveCandidateResult = HostSuccess & {
  approved: boolean;
  acceptedId?: string;
  reason?: string;
};

export type MemoryDeletePayload = {
  source: MemorySurfaceSource;
  id: string;
  reason?: string;
};

export type MemoryDeleteResult = HostSuccess & {
  deleted: boolean;
  source: MemorySurfaceSource;
  id: string;
  state: string;
};

export type MemoryRememberPayload = {
  content: string;
  scope: MemoryCardScope;
  scopeKey?: string | null;
  roleTags?: string[];
  type?: MemoryProposal['type'];
  sensitivity?: MemoryProposal['sensitivity'];
  expiresAt?: string | null;
};

export type MemoryRememberResult = HostSuccess & {
  accepted: boolean;
  reviewRequired: boolean;
  cardId?: string;
  proposalId?: string;
  reason?: string;
};

export type MemoryExportPayload = {
  format?: 'json';
};

export type MemoryExportResult = HostSuccess & {
  path: string;
  sha256: string;
  generatedAt: string;
  counts: {
    accepted: number;
    candidates: number;
    redacted: number;
  };
};

export type VerseGitDiagnosticBinding = {
  workspaceId: string;
  sessionId: string;
  worktreeId: string;
  ownerId: string;
  epoch: number;
  mode: 'M1' | 'M2';
};

export type VerseGitDiagnosticStatus = {
  schema: 'clawx.versegit.host-diagnostics/v1';
  generatedAt: string;
  enabled: boolean;
  mode: 'M0' | 'M1' | 'M2';
  status: 'not_applicable' | 'unavailable' | 'partial' | 'observed' | 'degraded' | 'rejected_by_policy';
  reason?: string;
  identity: {
    repoId: string | null;
    binarySha256: string | null;
    version: string | null;
    capabilitiesSchema: string | null;
  };
  coverage: { declared: string[]; unobserved: string[] };
  capabilities: {
    schema: string | null;
    safety: { default_enable: false | null; managed_opt_in: boolean; strict_admission_present: boolean };
    verdict: {
      single_green_light: false | null;
      dimensions: string[];
      read_surface: { observed_channels: string[]; unobserved_channels: string[] } | null;
    };
  } | null;
  observation: {
    processStarted: boolean;
    exitCode: number | null;
    deadlineMs: number;
    timedOut: boolean;
    cancelled: boolean;
    stdoutSha256: string;
    stderrSha256: string;
  } | null;
  issues: string[];
  hostVerdict: 'unchanged';
};

export type HostApiContract = {
  sessionStorage: import('../types/session-storage').SessionStorageContract;
  app: {
    version: () => string;
    openClawDoctor: (payload: OpenClawDoctorPayload) => Omit<OpenClawDoctorResult, 'mode'>;
    backupRestorePreview: (payload: BackupRestorePayload) => BackupRestorePreviewResult;
    backupRestoreApply: (payload: BackupRestorePayload) => BackupRestoreResult;
  };
  versegit: {
    status: (payload: VerseGitDiagnosticBinding) => VerseGitDiagnosticStatus;
  };
  openclaw: {
    status: () => OpenClawStatusResult;
    getSkillsDir: () => string;
    getCliCommand: () => OpenClawCliCommandResult;
    runtimeFlags: () => OpenClawRuntimeFlagsResult;
  };
  shell: {
    openExternal: (payload: ShellOpenExternalPayload) => void;
    showItemInFolder: (payload: ShellPathPayload) => void;
    openPath: (payload: ShellPathPayload) => string;
  };
  dialog: {
    open: (payload: DialogOpenPayload) => DialogOpenResult;
    message: (payload: DialogMessagePayload) => DialogMessageResult;
  };
  window: {
    syncTrafficLightPosition: (payload: WindowSyncTrafficLightPayload) => void;
    notify: (payload: SystemNotificationRequest) => SystemNotificationResult;
    minimize: () => void;
    maximize: () => void;
    close: () => void;
    isMaximized: () => boolean;
    isVisible: () => boolean;
  };
  updates: {
    check: () => AppUpdateStatusResult;
    download: () => AppUpdateStatusResult;
    install: () => HostSuccess;
  };
  uv: {
    installAll: () => HostSuccess;
  };
  vtoken: {
    ping: () => VtokenPingResult;
    open: (payload?: VtokenOpenPayload) => VtokenOpenResult;
    ingestPath: (payload: VtokenIngestPathPayload) => VtokenIngestResult;
    ingestMarkdown: (payload: VtokenIngestMarkdownPayload) => VtokenIngestResult;
    ingestTools: (payload: VtokenIngestToolsPayload) => VtokenIngestResult;
    ingestMemory: (payload: VtokenIngestMemoryPayload) => VtokenIngestResult;
    assemble: (payload: VtokenAssemblePayload) => VtokenAssembleHostResult;
    stats: () => VtokenStatsResult;
    close: () => VtokenCloseResult;
    getStatus: () => VtokenStatusResult;
    setEnabled: (payload: VtokenSetEnabledPayload) => VtokenSetEnabledResult;
    ensureStarted: () => VtokenStatusResult;
  };
  /** DCS controls: Workspace Context default profile plus developer diagnostics. */
  dcsProdFlags: {
    getFlags: () => DcsProdFlagsSnapshot;
    setFlag: (payload: DcsProdFlagSetPayload) => DcsProdFlagSetResult;
    requeryAck: () => DcsProdFlagAckRequeryResult;
    getPreview: () => DcsPreviewState;
    setPreview: (payload: DcsPreviewSetPayload) => DcsPreviewSetResult;
    getWorkspaceContext: () => WorkspaceContextState;
    setWorkspaceContext: (payload: WorkspaceContextSetPayload) => WorkspaceContextSetResult;
  };
  settings: {
    getAll: () => SettingsSnapshot;
    get: (payload: SettingsGetPayload) => SettingsValue;
    set: (payload: SettingsSetPayload) => HostSuccess;
    setMany: (payload: SettingsSetManyPayload) => HostSuccess;
    reset: () => SettingsResetResult;
  };
  /** P2 #161: read and toggle the local runtime efficiency sampler. */
  efficiency: {
    getState: () => RuntimeEfficiencyState;
    setEnabled: (payload: RuntimeEfficiencySetEnabledPayload) => RuntimeEfficiencyState;
  };
  /** P0B #213: read the shadow Resource Envelope aggregated across Main and Gateway. */
  resourceEnvelope: {
    getState: () => RuntimeResourceEnvelopeState;
  };
  workspaces: {
    list: () => WorkspaceSnapshotResult;
    portfolio: () => SystemPortfolio;
    projectSummary: (payload: SystemProjectRead) => SystemProjectSnapshot;
    systemControl: () => SystemControlState;
    setSystemControl: (payload: SystemControlChange) => SystemControlState;
    previewConfiguration: (payload: ProjectConfigurationInput) => ProjectConfigurationPreview;
    applyConfiguration: (payload: ProjectConfigurationApply) => ProjectConfigurationResult;
    configurationOperation: (payload: { requestId: string }) => ProjectConfigurationResult | null;
    configurationOperations: (payload: { workspaceId: string }) => ProjectConfigurationResult[];
    reconcileConfiguration: (payload: ProjectConfigurationRecovery) => ProjectConfigurationResult;
    getActive: () => WorkspaceActiveResult;
    create: (payload: WorkspaceCreatePayload) => WorkspaceCreateResult;
    update: (payload: WorkspaceUpdatePayload) => WorkspaceSnapshotResult;
    delete: (payload: WorkspaceDeletePayload) => WorkspaceSnapshotResult;
    switch: (payload: WorkspaceSwitchPayload) => WorkspaceActiveResult;
    preflight: (payload: WorkspacePreflightPayload) => WorkspacePreflightResult;
    saveState: (payload: WorkspaceSaveStatePayload) => HostSuccess;
    createFolder: (payload: WorkspaceFolderCreatePayload) => WorkspaceSnapshotResult & { folder?: SessionFolder };
    renameFolder: (payload: WorkspaceFolderRenamePayload) => WorkspaceSnapshotResult;
    deleteFolder: (payload: WorkspaceFolderDeletePayload) => WorkspaceSnapshotResult;
    moveSessionToFolder: (payload: WorkspaceFolderMoveSessionPayload) => WorkspaceSnapshotResult;
    bindCoordinator: (payload: WorkspaceCoordinatorBindPayload) => WorkspaceCoordinatorBindingResult;
    selectSessionTask: (payload: WorkspaceSessionTaskSelectPayload) => WorkspaceCoordinatorBindingResult;
    resolveCoordinator: (payload: WorkspaceCoordinatorResolvePayload) => WorkspaceCoordinatorBindingResult;
    pauseCoordinator: (payload: WorkspaceCoordinatorPausePayload) => WorkspaceCoordinatorBindingResult;
    migrateExecution: (payload: WorkspaceExecutionMigrationPayload) => HostSuccess & { operation: ExecutionMigrationOperation };
    executionMigration: (payload: WorkspaceExecutionMigrationReadPayload) => HostSuccess & { operation: ExecutionMigrationOperation | null };
  };
  projectRules: {
    snapshot: () => ProjectRulesSnapshotResult;
    createAgentsTemplate: () => ProjectRulesSnapshotResult;
    explain: (payload?: ProjectRulesExplainPayload) => ProjectRulesExplainResult;
  };
  codeReview: {
    run: (payload: CodeReviewRunPayload) => CodeReviewRunResult;
    createTaskLedgerNode: (payload: CodeReviewCreateTaskLedgerNodePayload) => CodeReviewCreateTaskLedgerNodeResult;
  };
  changeContext: ChangeContextApiContract;
  remoteForge: {
    capabilities: (payload: RemoteForgeRepositoryPayload) => RemoteForgeCapabilitiesResult;
    readPullRequest: (payload: RemoteForgePullRequestReadPayload) => RemoteForgePullRequestReadResult;
    readContents: (payload: RemoteForgeContentReadPayload) => RemoteForgeContentReadResult;
    mutatePullRequest: (payload: RemoteForgeMutationPayload) => RemoteForgeMutationResult;
    mergePullRequest: (payload: RemoteForgeMergePayload) => RemoteForgeMergeResult;
  };
  terminal: {
    run: (payload: WorkspaceTerminalRunPayload) => WorkspaceTerminalRunResult;
    open: (payload?: WorkspaceTerminalOpenPayload) => WorkspaceTerminalSessionResult;
    write: (payload: WorkspaceTerminalWritePayload) => HostSuccess;
    resize: (payload: WorkspaceTerminalResizePayload) => HostSuccess;
    interrupt: (payload: WorkspaceTerminalSessionPayload) => HostSuccess;
    close: (payload: WorkspaceTerminalSessionPayload) => HostSuccess;
    status: (payload?: WorkspaceTerminalStatusPayload) => WorkspaceTerminalSessionResult;
    list: (payload?: WorkspaceTerminalListPayload) => WorkspaceTerminalListResult;
  };
  sessionActivity: {
    snapshot: (payload: SessionActivitySnapshotPayload) => SessionActivitySnapshotResult;
    read: (payload: SessionActivityReadQuery) => SessionActivitySnapshotResult;
    query: (payload: SessionCollaborationQuery) => SessionCollaborationQueryResult;
    watch: (payload: SessionCollaborationWatch) => HostSuccess & { watch: SessionCollaborationWatchResult };
    cancelWatch: (payload: { id: string; query: SessionCollaborationQuery }) => HostSuccess & { cancelled: boolean };
  };
  git: {
    init: () => GitOperationResult;
    capabilities: () => GitCapabilitiesResult;
    status: () => GitStatusResult;
    diff: (payload?: { mode?: GitDiffMode }) => GitDiffListResult;
    fileDiff: (payload: GitFileDiffPayload) => GitFileDiffResult;
    applyPatch: (payload: GitApplyPatchPayload) => GitApplyPatchResult;
    diffToBase: (payload?: GitDiffToBasePayload) => GitDiffToBaseResult;
    stage: (payload: GitPathsPayload) => GitOperationResult;
    unstage: (payload: GitPathsPayload) => GitOperationResult;
    revertFile: (payload: GitPathPayload) => GitOperationResult;
    commit: (payload: GitCommitPayload) => GitCommitResult;
    branches: () => GitBranchListResult;
    log: (payload?: GitLogPayload) => GitLogResult;
    reflog: (payload?: GitReflogPayload) => GitReflogResult;
    mergeBase: (payload: GitMergeBasePayload) => GitMergeBaseResult;
    checkoutBranch: (payload: GitBranchCheckoutPayload) => GitOperationResult;
    createBranch: (payload: GitBranchCreatePayload) => GitOperationResult;
    stashList: () => GitStashListResult;
    stashPush: (payload?: GitStashPayload) => GitOperationResult;
    stashApply: (payload: GitStashRefPayload) => GitOperationResult;
    stashPop: (payload: GitStashRefPayload) => GitOperationResult;
    worktrees: () => GitWorktreeListResult;
    worktreeAdd: (payload: GitWorktreeAddPayload) => GitOperationResult;
    worktreeRemove: (payload: GitPathPayload) => GitOperationResult;
    worktreePrune: (payload?: { approvalId?: string }) => GitOperationResult;
    fetch: (payload?: GitFetchPayload) => GitOperationResult;
    pull: (payload?: GitPullPayload) => GitOperationResult;
    push: (payload?: GitPushPayload) => GitOperationResult;
    merge: (payload: GitMergePayload) => GitOperationResult;
    rebase: (payload: GitRebasePayload) => GitOperationResult;
    reset: (payload?: GitResetPayload) => GitOperationResult;
    githubAuthStatus: () => GithubAuthStatusResult;
    githubRepo: () => GithubRepoResult;
    prList: (payload?: GithubPrListPayload) => GithubPrListResult;
    prView: (payload: GithubPrViewPayload) => GithubPrViewResult;
    prCreate: (payload: GithubPrCreateInput) => GithubPrCreateResult;
    openPr: (payload: GithubPrOpenPayload) => GitOperationResult;
  };
  permissions: {
    approvals: (payload?: PermissionApprovalListPayload) => PermissionApprovalListResult;
    decisionEvents: (payload?: PermissionDecisionEventListPayload) => PermissionDecisionEventListResult;
    decideApproval: (payload: PermissionApprovalDecisionPayload) => PermissionApprovalDecisionResult;
  };
  orchestrationPresets: {
    list: (payload?: OrchestrationPresetListPayload) => OrchestrationPresetListResult;
    create: (payload: OrchestrationPresetCreatePayload) => OrchestrationPresetCreateResult;
    revoke: (payload: OrchestrationPresetRevokePayload) => OrchestrationPresetRevokeResult;
  };
  webPreview: {
    detect: (payload?: WorkspaceWebPreviewDetectPayload) => WorkspaceWebPreviewDetectResult;
    start: (payload?: WorkspaceWebPreviewStartPayload) => WorkspaceWebPreviewResult;
    startStatic: (payload?: WorkspaceWebPreviewStartPayload) => WorkspaceWebPreviewResult;
    stop: (payload?: WorkspaceWebPreviewStopPayload) => HostSuccess;
    status: (payload?: WorkspaceWebPreviewStatusPayload) => WorkspaceWebPreviewResult;
  };
  gateway: {
    status: () => GatewayStatus;
    start: () => HostSuccess;
    stop: () => HostSuccess;
    restart: () => HostSuccess;
    health: (payload?: GatewayHealthPayload) => GatewayHealth;
    controlUi: (payload?: GatewayControlUiPayload) => GatewayControlUiResult;
    copyGatewayToken: () => GatewayCopyTokenResult;
    rpc: (payload: GatewayRpcPayload) => unknown;
  };
  runtimeApprovals: {
    list: () => RuntimeApprovalListResult;
    resolve: (payload: RuntimeApprovalResolvePayload) => RuntimeApprovalResolveResult;
  };
  localControlPlane: {
    status: () => LocalControlPlaneStatusResult;
    reports: (payload?: LocalControlPlaneReportFilter) => LocalControlPlaneReportsResult;
    correlations: (payload?: LocalControlPlaneCorrelationFilter) => LocalControlPlaneCorrelationsResult;
  };
  capabilities: {
    publications: (payload?: CapabilityPublicationQuery) => CapabilityPublicationResult;
  };
  remoteControl: {
    status: () => RemoteControlStatusResult;
    inspect: () => RemoteControlInspectResult;
    pageInfo: (payload?: RemoteControlTargetPayload) => RemoteControlPageInfoResult;
    evaluate: (payload: RemoteControlEvaluatePayload) => RemoteControlEvaluateResult;
    click: (payload: RemoteControlClickPayload) => RemoteControlActionResult;
    scroll: (payload?: RemoteControlScrollPayload) => RemoteControlActionResult;
    screenshot: (payload?: RemoteControlScreenshotPayload) => RemoteControlScreenshotResult;
  };
  agentBrowser: {
    open: (payload?: AgentBrowserOpenPayload) => AgentBrowserSessionResult;
    status: () => AgentBrowserStatusResult;
    setEnabled: (payload: AgentBrowserSetEnabledPayload) => AgentBrowserSetEnabledResult;
    profiles: () => AgentBrowserProfilesResult;
    saveProfile: (payload: AgentBrowserProfileSavePayload) => AgentBrowserProfileSaveResult;
    validate: (payload?: AgentBrowserValidatePayload) => AgentBrowserValidateResult;
    navigate: (payload: AgentBrowserNavigatePayload) => AgentBrowserActionResult;
    focus: (payload: AgentBrowserSessionPayload) => AgentBrowserActionResult;
    waitForSelector: (payload: AgentBrowserSelectorPayload) => AgentBrowserActionResult;
    click: (payload: AgentBrowserClickPayload) => AgentBrowserActionResult;
    type: (payload: AgentBrowserTypePayload) => AgentBrowserActionResult;
    evaluate: (payload: AgentBrowserEvaluatePayload) => AgentBrowserEvaluateResult;
    screenshot: (payload: AgentBrowserScreenshotPayload) => AgentBrowserScreenshotResult;
    command: (payload: AgentBrowserCommandPayload) => AgentBrowserCommandResult;
    tasks: () => AgentBrowserTasksResult;
    createTask: (payload: AgentBrowserTaskCreatePayload) => AgentBrowserTaskResult;
    runTask: (payload: AgentBrowserTaskPayload) => AgentBrowserTaskResult;
    retryTask: (payload: AgentBrowserTaskPayload) => AgentBrowserTaskResult;
    cancelTask: (payload: AgentBrowserTaskPayload) => AgentBrowserTaskResult;
    requestTaskApproval: (payload: AgentBrowserTaskPayload) => AgentBrowserTaskResult;
    approveTask: (payload: AgentBrowserTaskPayload) => AgentBrowserTaskResult;
    rejectTask: (payload: AgentBrowserTaskPayload) => AgentBrowserTaskResult;
    show: (payload: AgentBrowserSessionPayload) => AgentBrowserActionResult;
    hide: (payload: AgentBrowserSessionPayload) => AgentBrowserActionResult;
    vault: () => AgentBrowserVaultResult;
    vaultHealth: () => AgentBrowserVaultHealthResult;
    saveCredential: (payload: AgentBrowserCredentialSavePayload) => AgentBrowserCredentialResult;
    deleteCredential: (payload: AgentBrowserCredentialPayload) => HostSuccess;
    close: (payload: AgentBrowserSessionPayload) => HostSuccess;
    takeSnapshot: (payload: AgentBrowserTakeSnapshotPayload) => AgentBrowserTakeSnapshotResult;
    clickByUid: (payload: AgentBrowserClickByUidPayload) => AgentBrowserActionResult;
    fillByUid: (payload: AgentBrowserFillByUidPayload) => AgentBrowserActionResult;
    pressKey: (payload: AgentBrowserPressKeyPayload) => AgentBrowserActionResult;
    requestModeUpgrade: (payload: AgentBrowserRequestModeUpgradePayload) => AgentBrowserRequestModeUpgradeResult;
    respondBoundaryChoice: (payload: AgentBrowserRespondBoundaryChoicePayload) => AgentBrowserRespondBoundaryChoiceResult;
    networkListRequests: (payload: AgentBrowserNetworkListPayload) => AgentBrowserNetworkListResult;
    networkGetRequestDetails: (payload: AgentBrowserNetworkDetailPayload) => AgentBrowserNetworkDetailResult;
    networkClearRequests: (payload: AgentBrowserNetworkClearPayload) => AgentBrowserNetworkClearResult;
    networkWaitForRequests: (payload: AgentBrowserNetworkWaitPayload) => AgentBrowserNetworkWaitResult;
    networkCompareRequests: (payload: AgentBrowserNetworkComparePayload) => AgentBrowserNetworkCompareResult;
    networkFindParameterCandidates: (payload: AgentBrowserNetworkFindParamsPayload) => AgentBrowserNetworkFindParamsResult;
    networkExtractJsCandidates: (payload: AgentBrowserNetworkExtractJsPayload) => AgentBrowserNetworkExtractJsResult;
    newPage: (payload: AgentBrowserNewPagePayload) => AgentBrowserListPagesResult;
    listPages: (payload: AgentBrowserSessionPayload) => AgentBrowserListPagesResult;
    selectPage: (payload: AgentBrowserSelectPagePayload) => AgentBrowserListPagesResult;
    closePage: (payload: AgentBrowserClosePagePayload) => AgentBrowserListPagesResult;
    navigatePage: (payload: AgentBrowserNavigatePagePayload) => AgentBrowserListPagesResult;
    jsListResources: (payload: AgentBrowserJsListResourcesPayload) => AgentBrowserJsListResourcesResult;
    jsSearchSources: (payload: AgentBrowserJsSearchSourcesPayload) => AgentBrowserJsSearchSourcesResult;
    jsExtractContext: (payload: AgentBrowserJsExtractContextPayload) => AgentBrowserJsExtractContextResult;
    sourceMapListCandidates: (payload: AgentBrowserSourceMapListCandidatesPayload) => AgentBrowserSourceMapListCandidatesResult;
    sourceMapResolveLocation: (payload: AgentBrowserSourceMapResolveLocationPayload) => AgentBrowserSourceMapResolveLocationResult;
    sourceMapExtractOriginalContext: (payload: AgentBrowserSourceMapExtractOriginalContextPayload) => AgentBrowserSourceMapExtractOriginalContextResult;
    runtimeInspectGlobals: (payload: AgentBrowserRuntimeInspectGlobalsPayload) => AgentBrowserRuntimeInspectGlobalsResult;
    runtimeSearchModules: (payload: AgentBrowserRuntimeSearchModulesPayload) => AgentBrowserRuntimeSearchModulesResult;
    runtimeDescribeFunction: (payload: AgentBrowserRuntimeDescribeFunctionPayload) => AgentBrowserRuntimeDescribeFunctionResult;
    replayPrepareRequest: (payload: AgentBrowserReplayPrepareRequestPayload) => AgentBrowserReplayPrepareRequestResult;
    replaySendRequest: (payload: AgentBrowserReplaySendRequestPayload) => AgentBrowserReplaySendRequestResult;
    replayCompareResponses: (payload: AgentBrowserReplayCompareResponsesPayload) => AgentBrowserReplayCompareResponsesResult;
    getConsoleMessages: (payload: AgentBrowserConsoleMessagesPayload) => AgentBrowserConsoleMessagesResult;
    fullAccessExecuteScript: (payload: AgentBrowserFullAccessExecuteScriptPayload) => AgentBrowserFullAccessExecuteScriptResult;
    fullAccessFetch: (payload: AgentBrowserFullAccessFetchPayload) => AgentBrowserFullAccessFetchResult;
    fullAccessGetNetworkDetails: (payload: AgentBrowserFullAccessGetNetworkDetailsPayload) => AgentBrowserFullAccessGetNetworkDetailsResult;
    fullAccessReadStorage: (payload: AgentBrowserFullAccessReadStoragePayload) => AgentBrowserFullAccessReadStorageResult;
    fullAccessRevoke: (payload: AgentBrowserFullAccessRevokePayload) => AgentBrowserFullAccessRevokeResult;
    extractPageText: (payload: AgentBrowserExtractPageTextPayload) => AgentBrowserExtractPageTextResult;
    verifyFlow: (payload: AgentBrowserSessionPayload & {
      selectors?: string[];
      expect?: Array<{ type: 'text' | 'value' | 'enabled' | 'disabled' | 'url'; selector: string; contains?: string; equals?: string; pattern?: string; label?: string }>;
      baselineConsoleCount?: number;
      baselineNetworkCount?: number;
      screenshot?: boolean;
      evidenceDirName?: string;
      compactHealthSummary?: boolean;
    }) => AgentBrowserFacadeResult;
    validateExtractionRule: (payload: AgentBrowserValidateExtractionRulePayload) => AgentBrowserValidateExtractionRuleResult;
    downloadFile: (payload: AgentBrowserSelectorPayload & { path: string }) => AgentBrowserFacadeResult;
    uploadFiles: (payload: AgentBrowserSelectorPayload & { paths: string[] }) => AgentBrowserFacadeResult;
    pointer: (payload: AgentBrowserSessionPayload & { action: 'hover' | 'double-click' | 'right-click' | 'scroll' | 'scroll-into-view'; selector?: string; deltaX?: number; deltaY?: number; timeoutMs?: number }) => AgentBrowserFacadeResult;
    drag: (payload: AgentBrowserSessionPayload & { sourceSelector: string; targetSelector: string; timeoutMs?: number }) => AgentBrowserFacadeResult;
    selectOption: (payload: AgentBrowserSelectorPayload & { label: string }) => AgentBrowserFacadeResult;
    selectValues: (payload: AgentBrowserSelectorPayload & { values: string[] }) => AgentBrowserFacadeResult;
    appendText: (payload: AgentBrowserTypePayload) => AgentBrowserFacadeResult;
    setChecked: (payload: AgentBrowserSelectorPayload & { checked: boolean }) => AgentBrowserFacadeResult;
    findElement: (payload: AgentBrowserSessionPayload & { role?: string; name?: string; label?: string; testId?: string; timeoutMs?: number }) => AgentBrowserFacadeResult;
    semanticRead: (payload: AgentBrowserSessionPayload & { action: 'observe' | 'extract'; instruction: string; schema?: Record<string, unknown>; timeoutMs?: number }, options?: { signal?: AbortSignal }) => AgentBrowserFacadeResult;
    readForms: (payload: AgentBrowserSessionPayload & { selector?: string }) => AgentBrowserFacadeResult;
    readDialogs: (payload: AgentBrowserSessionPayload) => AgentBrowserFacadeResult;
    respondDialog: (payload: AgentBrowserSessionPayload & { dialogId: string; accept: boolean; promptText?: string }) => AgentBrowserFacadeResult;
  };
  mcp: {
    listServers: () => McpServerListResult;
    createServer: (payload: McpServerCreatePayload) => McpServerListResult;
    updateServer: (payload: McpServerUpdatePayload) => McpServerListResult;
    deleteServer: (payload: McpServerDeletePayload) => McpServerListResult;
    testServer: (payload: McpServerTestPayload) => McpServerTestResult;
    resolveForContext: (payload: McpServerResolvePayload) => McpServerResolveResult;
    listTools: (payload: McpListToolsPayload) => McpListToolsResult;
    callTool: (payload: McpCallToolPayload) => McpCallToolResult;
    reloadRuntime: (payload?: McpReloadRuntimePayload) => McpReloadRuntimeResult;
    heartbeat: (payload: McpHeartbeatPayload) => McpHeartbeatResult;
  };
  sandbox: {
    status: () => SandboxStatusResult;
    detectProviders: () => SandboxDetectProvidersResult;
    updateProfile: (payload: SandboxUpdateProfilePayload) => SandboxUpdateProfileResult;
    explain: (payload?: SandboxExplainPayload) => SandboxExplainResult;
  };
  hooks: {
    list: () => HookListResult;
    setTrusted: (payload: HookSetTrustedPayload) => HookTrustMutationResult;
  };
  logs: {
    recent: (payload?: LogRecentPayload) => LogContentResult;
    memory: (payload?: LogMemoryPayload) => string[];
    dir: () => LogDirResult;
    filePath: () => LogFilePathResult;
    listFiles: () => LogFilesResult;
    readFile: (payload: LogReadFilePayload) => LogContentResult;
  };
  channels: {
    configured: () => ChannelConfiguredResult;
    accounts: (payload?: ChannelAccountsPayload) => ChannelAccountsResult;
    targets: (payload: ChannelTargetsPayload) => ChannelTargetsResult;
    setDefaultAccount: (payload: ChannelRequiredAccountPayload) => HostSuccess;
    bindingSave: (payload: ChannelBindingSavePayload) => HostSuccess;
    bindingDelete: (payload: ChannelBindingDeletePayload) => HostSuccess;
    validateConfig: (payload: ChannelTypePayload) => HostSuccess;
    validateCredentials: (payload: ChannelCredentialValidationPayload) => ChannelCredentialValidationResult;
    saveConfig: (payload: ChannelSaveConfigPayload) => ChannelSaveConfigResult;
    setEnabled: (payload: ChannelSetEnabledPayload) => HostSuccess;
    formValues: (payload: ChannelAccountPayload) => ChannelFormValuesResult;
    deleteConfig: (payload: ChannelAccountPayload) => HostSuccess;
    startLogin: (payload: ChannelAccountPayload) => HostSuccess;
    cancelLogin: (payload: ChannelAccountPayload) => HostSuccess;
  };
  agents: {
    list: () => AgentSnapshotResult;
    create: (payload: AgentCreatePayload) => AgentSnapshotResult;
    update: (payload: AgentUpdatePayload) => AgentSnapshotResult;
    updateModel: (payload: AgentUpdateModelPayload) => AgentModelUpdateResult;
    updateReasoningEffort: (payload: AgentUpdateReasoningEffortPayload) => AgentSnapshotResult;
    updateAvatar: (payload: AgentUpdateAvatarPayload) => AgentSnapshotResult;
    resetAvatar: (payload: AgentIdPayload) => AgentSnapshotResult;
    getBootstrap: (payload: AgentIdPayload) => AgentBootstrapResult;
    updateBootstrap: (payload: AgentBootstrapUpdatePayload) => AgentBootstrapResult;
    delete: (payload: AgentIdPayload) => AgentSnapshotResult;
    assignChannel: (payload: AgentChannelPayload) => AgentSnapshotResult;
    removeChannel: (payload: AgentChannelPayload) => AgentSnapshotResult;
  };
  roles: {
    upsertConfigRole: (payload: RoleUpsertConfigRolePayload) => RoleUpsertConfigRoleResult;
    agencyCatalog: (payload: AgencyRoleSourcePayload) => AgencyRoleListResult;
    listAgencyPackages: () => AgencyRolePackageListResult;
    importAgencyPackage: (payload: AgencyRolePackageImportPayload) => AgencyRolePackageResult;
    refreshAgencyPackage: (payload: AgencyRolePackageRefreshPayload) => AgencyRolePackageResult;
    previewAgencyPromotion: (payload: AgencyRoleReviewPayload) => AgencyRolePromotionPreviewResult;
    previewAgencyMemoryProposals: (payload: AgencyRoleMemoryProposalsPayload) => AgencyRoleMemoryProposalsResult;
    reviewAgencyPromotion: (payload: AgencyRoleReviewPayload) => AgencyRolePromotionResult;
    approveAgencyPromotion: (payload: AgencyRoleDecisionPayload) => AgencyRolePromotionResult;
    retireAgencyPromotion: (payload: AgencyRoleDecisionPayload) => AgencyRolePromotionResult;
  };
  diagnostics: {
    gatewaySnapshot: () => DiagnosticsGatewaySnapshotResult;
    exportSupportBundle: () => SupportBundleExportResult;
  };
  agentDev: {
    status: () => AgentDevStatusResult;
    scenarios: () => AgentDevScenario[];
    seedState: (payload?: AgentDevSeedStatePayload) => AgentDevSeedStateResult;
    resetState: () => AgentDevSeedStateResult;
    createConversation: (payload: AgentDevCreateConversationPayload) => AgentDevCreateConversationResult;
    createProviderConfig: (payload: AgentDevCreateProviderConfigPayload) => AgentDevCreateProviderConfigResult;
    configureMockReplay: (payload: AgentDevMockReplayConfig) => AgentDevMockReplayResult;
    hostApiCalls: (payload?: AgentDevHostApiCallsPayload) => AgentDevHostApiCallsResult;
    featureFlags: () => AgentDevFeatureFlagsResult;
    setFeatureFlags: (payload: AgentDevFeatureFlagsPayload) => AgentDevFeatureFlagsResult;
    visualPreset: (payload?: AgentDevVisualPreset) => AgentDevVisualPresetResult;
    diagnosticsSnapshot: () => AgentDevDiagnosticsSnapshotResult;
    transportTrace: (payload?: AgentDevTransportTracePayload) => AgentDevTransportTraceResult;
    traceTimeline: (payload?: AgentDevTraceTimelinePayload) => AgentDevTraceTimelineResult;
    costReport: () => AgentDevCostReportResult;
    skillSandboxReport: () => AgentDevSkillSandboxReportResult;
    workbenchEvidence: () => AgentDevWorkbenchEvidenceResult;
    recordScenario: (payload?: AgentDevRecordScenarioPayload) => AgentDevRecordScenarioResult;
    selectorContract: () => AgentDevSelectorContractResult;
  };
  providers: {
    list: () => ProviderWithKeyInfo[];
    get: (payload: ProviderIdPayload) => ProviderConfig | null;
    getDefault: () => string | undefined;
    hasApiKey: (payload: ProviderIdPayload) => boolean;
    validateKey: (payload: ProviderValidationPayload) => ProviderValidationResult;
    listModels: (payload: ProviderModelListPayload) => ProviderModelListResult;
    save: (payload: ProviderSavePayload) => HostSuccess;
    delete: (payload: ProviderIdPayload) => HostSuccess;
    setApiKey: (payload: ProviderApiKeyPayload) => HostSuccess;
    updateWithKey: (payload: ProviderUpdateWithKeyPayload) => HostSuccess;
    deleteApiKey: (payload: ProviderIdPayload) => HostSuccess;
    setDefault: (payload: ProviderIdPayload) => ProviderDefaultSyncResult;
    accounts: () => ProviderAccount[];
    vendors: () => ProviderVendorInfo[];
    accountKeyInfo: () => ProviderAccountKeyInfo[];
    getDefaultAccount: () => ProviderDefaultAccountResult;
    getAccount: (payload: ProviderAccountIdPayload) => ProviderAccount | null;
    hasAccountApiKey: (payload: ProviderAccountIdPayload) => boolean;
    createAccount: (payload: ProviderCreateAccountPayload) => HostSuccess;
    updateAccount: (payload: ProviderUpdateAccountPayload) => HostSuccess;
    deleteAccount: (payload: ProviderAccountIdPayload) => HostSuccess;
    deleteAccountApiKey: (payload: ProviderAccountIdPayload) => HostSuccess;
    setDefaultAccount: (payload: ProviderAccountIdPayload) => ProviderDefaultSyncResult;
    requestOAuth: (payload: ProviderOAuthRequestPayload) => HostSuccess;
    cancelOAuth: () => HostSuccess;
    submitOAuth: (payload: ProviderOAuthSubmitPayload) => HostSuccess;
  };
  files: {
    stagePaths: (payload: StagePathsPayload) => StagedFileResult[];
    stageBuffer: (payload: StageBufferPayload) => StagedFileResult;
    readText: (payload: FilePathPayload) => ReadTextFileResult;
    readBinary: (payload: FileReadBinaryPayload) => ReadBinaryFileResult;
    writeText: (payload: FileWriteTextPayload) => WriteTextFileResult;
    stat: (payload: FilePathPayload) => StatFileResult;
    listDir: (payload: FilePathPayload) => FileListDirResult;
    listTree: (payload: FileListTreePayload) => FileListTreeResult;
    registerHtmlPreview: (payload: HtmlPreviewDocumentPayload) => HtmlPreviewDocumentResult;
  };
  media: {
    linkPreview: (payload: LinkPreviewPayload) => LinkPreviewResult;
    thumbnails: (payload: MediaThumbnailsPayload) => MediaThumbnailResult;
    saveImage: (payload: SaveImagePayload) => JsonRecord;
    imageGenerationSettings: () => ImageGenerationSettingsResult;
    saveImageGenerationSettings: (payload: ImageGenerationSettingsPayload) => ImageGenerationSettingsResult;
    imageGenerationProviders: () => ImageGenerationProvidersResult;
    testImageGeneration: (payload: ImageGenerationTestPayload) => ImageGenerationTestResult;
  };
  sessions: {
    collaborationSender: () => HostSuccess & { source: { scope: AutonomySessionScope; name: string } | null; reason?: string };
    collaborationContext: (payload: SessionCollaborationQuery) => HostSuccess & { taskContext: SessionCollaborationTaskContext };
    collaborationMaterials: (payload: SessionCollaborationMaterialQuery) => HostSuccess & { materials: SessionCollaborationMaterialPage };
    presentCollaborationMaterial: (payload: SessionCollaborationMaterialPresentation) => HostSuccess & { recorded: boolean };
    collaborationMessages: (payload: SessionCollaborationMessageQuery) => HostSuccess & { messages: SessionCollaborationMessagePage };
    sendCollaborationMessage: (payload: SessionCollaborationMessageInput & { expectedSource: AutonomySessionScope }) => HostSuccess & { receipt: SessionCollaborationMessageReceipt | null; phase: SessionCollaborationMessageReceipt['phase']; error?: string };
    delegate: (payload: SessionDelegationPayload) => SessionDelegationResult;
    dispatchPlanTask: (payload: ProjectPlanDispatchPayload) => SessionDelegationResult;
    dispatchSystemProject: (payload: SystemProjectDispatchPayload) => SessionDelegationResult;
    delete: (payload: SessionDeletePayload) => SessionDeleteResult;
    rename: (payload: SessionRenamePayload) => HostSuccess;
    summaries: (payload?: SessionSummariesPayload) => SessionSummariesResult;
    history: (payload: SessionHistoryPayload) => SessionHistoryResult;
    sendWorker: (payload: SessionSendWorkerPayload) => SessionSendWorkerResult;
    patchThinking: (payload: SessionPatchThinkingPayload) => HostSuccess & { result?: unknown };
    patchRuntimeModel: (payload: SessionPatchRuntimeModelPayload) => HostSuccess & { result?: unknown };
    compactionStatus: (payload: SessionCompactionPayload) => SessionCompactionStatusResult;
    compactionHistory: (payload: SessionCompactionHistoryPayload) => SessionCompactionHistoryResult;
    compressionArtifact: (payload: SessionCompressionArtifactPayload) => SessionCompressionArtifactResult;
    recoveryContext: (payload: SessionRecoveryContextPayload) => SessionRecoveryContextResult;
    recallOriginal: (payload: SessionRecallOriginalPayload) => SessionRecallOriginalResult;
    expandSelector: (payload: SessionExpandSelectorPayload) => SessionExpandSelectorResult;
    longTaskControlStatus: (payload: SessionLongTaskControlPayload) => SessionLongTaskControlStatusResult;
    longTaskControlHistory: (payload: SessionLongTaskControlHistoryPayload) => SessionLongTaskControlHistoryResult;
    resumeCheckpoints: (payload: SessionLongTaskControlHistoryPayload) => SessionResumeCheckpointsResult;
    restoreCheckpoint: (payload: SessionRestoreCheckpointPayload) => SessionRestoreCheckpointResult;
    checkpointDiff: (payload: SessionRestoreCheckpointPayload) => SessionCheckpointDiffResult;
    queueDrain: (payload: SessionQueueDrainPayload) => SessionQueueDrainResult;
    stop: (payload: SessionStopPayload) => SessionStopResult;
    compact: (payload: SessionManualCompactPayload) => SessionCompactionResult;
    compactRange: (payload: SessionCompactRangePayload) => SessionCompactionResult;
    prepareHandoff: (payload: SessionHandoffPayload) => SessionHandoffResult;
    createHandoff: (payload: SessionCreateHandoffPayload) => SessionCreateHandoffResult;
    handoffOperation: (payload: SessionHandoffOperationPayload) => SessionHandoffOperationResult;
    fork: (payload: SessionForkPayload) => SessionForkResult;
    truncate: (payload: SessionTruncatePayload) => SessionTruncateResult;
    archive: (payload: SessionArchivePayload) => SessionArchiveResult;
    restore: (payload: SessionRestorePayload) => HostSuccess;
    permanentDelete: (payload: SessionPermanentDeletePayload) => HostSuccess;
    listArchived: (payload?: SessionListArchivedPayload) => SessionListArchivedResult;
    emptyArchive: (payload: SessionEmptyArchivePayload) => HostSuccess;
    contextFoldingStatus: (payload?: SessionContextFoldingStatusPayload) => SessionContextFoldingStatusResult;
    contextFoldProjection: (payload: SessionContextFoldProjectionPayload) => SessionContextFoldProjectionResult;
  };
  chat: {
    sendWithMedia: (payload: ChatSendWithMediaPayload) => ChatSendWithMediaResult;
    continuityPreview: (payload: ChatContinuityPreviewPayload) => ChatContinuityPreviewResult;
  };
  workProviders: {
    status: () => WorkProviderStatusSnapshot;
    run: (payload: WorkProviderRunPayload) => WorkProviderRunResult;
    validateArtifact: (payload: WorkProviderValidateArtifactPayload) => WorkProviderValidateArtifactResult;
  };
  knowledge: {
    operationsStatus: () => KnowledgeOperationsResult;
    operationsConfigure: (payload: ProjectRagConfigInput) => KnowledgeOperationsConfigureResult;
    indexEnable: () => KnowledgeIndexResult;
    indexDisable: () => KnowledgeIndexResult;
    indexPause: () => KnowledgeIndexResult;
    indexResume: () => KnowledgeIndexResult;
    indexRebuild: () => KnowledgeIndexResult;
    indexReconcile: () => KnowledgeIndexResult;
    indexCleanup: () => KnowledgeIndexResult;
    retrieve: (payload: KnowledgeRetrievePayload) => KnowledgeRetrieveResult;
    vectorStatus: () => KnowledgeVectorStatusResult;
    vectorConfigure: (payload: { backend: 'sqlite-flat' | 'lancedb-ann' }) => KnowledgeVectorStatusResult;
    vectorDisable: () => KnowledgeVectorStatusResult;
    vectorRebuild: () => KnowledgeVectorStatusResult;
    vectorOptimize: () => KnowledgeVectorStatusResult;
    embeddingStatus: () => KnowledgeEmbeddingStatusResult;
    embeddingConfigure: (payload: KnowledgeEmbeddingSelection) => KnowledgeEmbeddingStatusResult;
    embeddingCancel: () => KnowledgeEmbeddingStatusResult;
    embeddingDisable: () => KnowledgeEmbeddingStatusResult;
    embeddingRetry: () => KnowledgeEmbeddingStatusResult;
    rerankStatus: () => KnowledgeRerankStatusResult;
    rerankConfigure: (payload: KnowledgeRerankSelection) => KnowledgeRerankStatusResult;
    rerankCancel: () => KnowledgeRerankStatusResult;
    rerankDisable: () => KnowledgeRerankStatusResult;
    rerankRetry: () => KnowledgeRerankStatusResult;
    status: () => KnowledgeStatusResult;
    init: () => KnowledgeInitResult;
    configure: (payload?: KnowledgeConfigurePayload) => HostSuccess;
    ingestFiles: (payload: KnowledgeIngestFilesPayload) => KnowledgeIngestFilesResult;
    validateOkfBundle: (payload: KnowledgeValidateOkfBundlePayload) => KnowledgeOkfValidationResult;
    importOkfBundle: (payload: KnowledgeImportOkfBundlePayload) => KnowledgeOkfImportResult;
    search: (payload: KnowledgeSearchPayload) => KnowledgeSearchResult;
    researchStart: (payload: KnowledgeResearchPayload) => KnowledgeResearchResult;
    researchStatus: (payload: KnowledgeResearchRequestPayload) => KnowledgeResearchResult;
    researchCancel: (payload: KnowledgeResearchRequestPayload) => HostSuccess;
    get: (payload: KnowledgeGetPayload) => KnowledgeGetResult;
    compile: () => KnowledgeCompileResult;
    lint: () => KnowledgeLintResult;
    applyDraft: (payload: KnowledgeApplyDraftPayload) => KnowledgeApplyDraftResult;
    openVault: () => KnowledgeOpenVaultResult;
    createInboxItem: (payload: KnowledgeCreateInboxItemPayload) => KnowledgeInboxResult;
    listInboxItems: (payload?: KnowledgeListInboxItemsPayload) => KnowledgeListInboxItemsResult;
    updateInboxItem: (payload: KnowledgeUpdateInboxItemPayload) => KnowledgeInboxResult;
    dismissInboxItem: (payload: KnowledgeInboxItemIdPayload) => KnowledgeInboxResult;
    promoteInboxItemToDraft: (payload: KnowledgeInboxItemIdPayload) => KnowledgeInboxResult;
    createDraft: (payload: KnowledgeCreateDraftPayload) => KnowledgeDraftResult;
    listSourceSets: () => KnowledgeListSourceSetsResult;
    saveSourceSet: (payload: KnowledgeSaveSourceSetPayload) => KnowledgeSourceSetResult;
    deleteSourceSet: (payload: KnowledgeDeleteSourceSetPayload) => HostSuccess;
    answerFromSourceSet: (payload: KnowledgeAnswerFromSourceSetPayload) => KnowledgeAnswerFromSourceSetResult;
    createArtifactDraft: (payload: KnowledgeCreateArtifactDraftPayload) => KnowledgeDraftResult;
    listDrafts: (payload?: KnowledgeListDraftsPayload) => KnowledgeListDraftsResult;
    getDraft: (payload: KnowledgeGetDraftPayload) => KnowledgeDraftResult;
    updateDraft: (payload: KnowledgeUpdateDraftPayload) => KnowledgeDraftResult;
    reviewDraft: (payload: KnowledgeReviewDraftPayload) => KnowledgeDraftResult;
    proposeChange: (payload: KnowledgeProposeChangePayload) => KnowledgeProposalResult;
    listProposals: (payload?: KnowledgeListProposalsPayload) => KnowledgeListProposalsResult;
    previewChange: (payload: KnowledgePreviewChangePayload) => KnowledgePreviewChangeResult;
    listReviewBundles: (payload?: KnowledgeListReviewBundlesPayload) => KnowledgeListReviewBundlesResult;
    applyReviewedChange: (payload: KnowledgeApplyReviewedChangePayload) => KnowledgeApplyReviewedChangeResult;
    stewardReview: (payload: KnowledgeStewardReviewPayload) => KnowledgeStewardReviewResult;
    stewardConfigGet: () => KnowledgeStewardConfigGetResult;
    stewardConfigUpdate: (payload: KnowledgeStewardConfigUpdatePayload) => KnowledgeStewardConfigUpdateResult;
    routeContext: (payload: KnowledgeRouteContextPayload) => KnowledgeRouteContextResult;
    runtimeLessonsReport: () => KnowledgeRuntimeLessonsReportResult;
        sekbShadowEvaluationExport: (payload: KnowledgeSekbShadowEvaluationExportPayload) => KnowledgeSekbShadowEvaluationExportResult;
    sekbShadowEvaluationProtocol: (payload: KnowledgeSekbShadowEvaluationProtocolPayload) => KnowledgeSekbShadowEvaluationProtocolResult;
    sekbShadowEvaluationReport: (payload: KnowledgeSekbShadowEvaluationReportPayload) => KnowledgeSekbShadowEvaluationReportResult;
    sekbSuggestPrinciples: (payload?: KnowledgeSekbSuggestPrinciplesPayload) => KnowledgeSekbSuggestPrinciplesResult;
    sekbBatchDistillSuggest: (payload?: KnowledgeSekbBatchDistillSuggestPayload) => KnowledgeSekbBatchDistillSuggestResult;
    sekbConfirmPrinciple: (payload: KnowledgeSekbConfirmPrinciplePayload) => KnowledgeSekbConfirmPrincipleResult;
    sekbRejectSuggestion: (payload: KnowledgeSekbRejectSuggestionPayload) => KnowledgeSekbRejectSuggestionResult;
    sekbCaptureTrajectory: (payload: KnowledgeSekbCaptureTrajectoryPayload) => KnowledgeSekbCaptureTrajectoryResult;
    sekbRetrieveForTask: (payload: KnowledgeSekbRetrieveForTaskPayload) => KnowledgeSekbRetrieveForTaskResult;
    recordExperienceExposure: (payload: { requestId: string; principleIds: string[] }) => HostSuccess & { recorded: number };
    matchErrorExperience: (payload: KnowledgeMatchErrorExperiencePayload) => KnowledgeMatchErrorExperienceResult;
    updateErrorExperienceEffectiveness: (payload: KnowledgeUpdateErrorExperienceEffectivenessPayload) => KnowledgeUpdateErrorExperienceEffectivenessResult;
    recordKnowledgeReference: (payload: KnowledgeRecordReferencePayload) => KnowledgeProvenanceResult;
    getProvenance: (payload: KnowledgeProvenancePayload) => KnowledgeProvenanceResult;

    governanceAudit: () => KnowledgeGovernanceResult;
    listGovernanceReceipts: () => KnowledgeListGovernanceReceiptsResult;
    listWatchedDirectories: () => KnowledgeWatchedDirectoryConfig[];
    listSourceConnectors: () => HostSuccess & { connectors: Array<KnowledgeGithubConnectorConfig & { receipt?: KnowledgeConnectorReceipt }> };
    upsertSourceConnector: (config: KnowledgeGithubConnectorConfig) => HostSuccess;
    syncSourceConnector: (payload: { id: string }) => HostSuccess & { receipt?: KnowledgeConnectorReceipt };
    removeSourceConnector: (payload: { id: string }) => HostSuccess;
    addWatchedDirectory: (config: KnowledgeWatchedDirectoryConfig) => HostSuccess;
    updateWatchedDirectory: (payload: { id: string; config: Partial<KnowledgeWatchedDirectoryConfig> }) => HostSuccess;
    removeWatchedDirectory: (payload: { id: string }) => HostSuccess;
    listWatchedDirectoryEvents: (payload: KnowledgeListWatchedDirectoryEventsPayload) => KnowledgeWatchedDirectoryEvent[];

  };
  cron: {
    list: () => CronJob[];
    create: (payload: CronJobCreateInput) => CronJob;
    update: (payload: CronUpdatePayload) => CronJob;
    delete: (payload: CronIdPayload) => HostSuccess;
    toggle: (payload: CronTogglePayload) => HostSuccess;
    trigger: (payload: CronIdPayload) => HostSuccess;
    sessionHistory: (payload: CronSessionHistoryPayload) => CronSessionHistoryResult;
    deliveryTargets: () => DeliveryTargetsResult;
  };
  taskLedger: {
    managedTasks: (payload?: TaskLedgerWorkspacePayload) => TaskSystemListResult;
    queryTasks: (payload?: TaskSystemQueryPayload) => TaskSystemQueryResult;
    sessionTask: (payload: TaskSessionPayload) => TaskSessionResult;
    contextHint: (payload: TaskContextHintPayload) => TaskContextHintResult;
    command: (payload: TaskSystemCommandPayload) => TaskSystemCommandResult;
    trace: (payload: TaskTracePayload) => TaskTraceResult;
    snapshot: (payload?: TaskLedgerWorkspacePayload) => TaskLedgerSnapshotResult;
    appendEvents: (payload: TaskLedgerAppendEventsPayload) => TaskLedgerSnapshotResult;
    createNode: (payload: TaskLedgerCreateNodePayload) => TaskLedgerSnapshotResult;
    updateNode: (payload: TaskLedgerUpdateNodePayload) => TaskLedgerSnapshotResult;
    addEdge: (payload: TaskLedgerAddEdgePayload) => TaskLedgerSnapshotResult;
    linkSession: (payload: TaskLedgerLinkSessionPayload) => TaskLedgerSnapshotResult;
    requestReview: (payload: TaskLedgerReviewPayload) => TaskLedgerSnapshotResult;
    clearReview: (payload: TaskLedgerReviewPayload) => TaskLedgerSnapshotResult;
    submitCompletion: (payload: TaskLedgerSubmitCompletionPayload) => TaskLedgerSubmitCompletionResult;
    exportHtml: (payload?: TaskLedgerExportHtmlPayload) => TaskLedgerExportHtmlResult;
  };
  remoteTasks: {
    list: () => RemoteTaskListResult;
    create: (payload: RemoteTaskCreatePayload) => RemoteTaskRecordResult;
    preview: (payload: RemoteTaskIdPayload) => RemoteTaskPreviewResult;
    approve: (payload: RemoteTaskApprovePayload) => RemoteTaskRecordResult;
    reject: (payload: RemoteTaskIdPayload) => RemoteTaskRecordResult;
    execute: (payload: RemoteTaskIdPayload) => RemoteTaskRecordResult;
  };
  clawGraph: {
    listWorkflows: (payload?: ClawGraphWorkspacePayload) => ClawGraphListWorkflowsResult;
    compile: (payload: ClawGraphCompilePayload) => ClawGraphCompileHostResult;
    run: (payload: ClawGraphRunPayload) => ClawGraphRunResult;
    status: (payload: ClawGraphRunIdPayload) => ClawGraphStatusResult;
    events: (payload: ClawGraphEventsPayload) => ClawGraphEventsResult;
    abort: (payload: ClawGraphAbortPayload) => ClawGraphStatusResult;
    review: (payload: ClawGraphReviewPayload) => ClawGraphStatusResult;
  };
  skills: {
    local: () => LocalSkillsResult;
    configs: () => SkillConfigsResult;
    allConfigs: () => SkillConfigsResult;
    getConfig: (payload: SkillKeyPayload) => JsonRecord | undefined;
    updateConfig: (payload: SkillUpdateConfigPayload) => HostSuccess;
    updateConfigs: (payload: SkillUpdateConfigsPayload) => HostSuccess;
    status: () => SkillsStatusResult;
    update: (payload: SkillUpdatePayload) => HostSuccess;
    quickAccess: (payload: SkillQuickAccessPayload) => HostSuccess & { skills?: QuickAccessSkill[] };
    clawhubCapability: () => ClawHubCapabilityResult;
    clawhubList: () => ClawHubListResult;
    clawhubSearch: (payload: ClawHubSearchPayload) => ClawHubSearchResult;
    clawhubInstall: (payload: ClawHubInstallPayload) => HostSuccess;
    clawhubUninstall: (payload: ClawHubUninstallPayload) => HostSuccess;
    clawhubOpenSkillReadme: (payload: ClawHubOpenPayload) => HostSuccess;
    clawhubOpenSkillPath: (payload: ClawHubOpenPayload) => HostSuccess;
  };
  skillPacks: {
    list: () => SkillPackListResult;
    install: (payload: SkillPackPayload) => HostSuccess;
    sync: (payload: SkillPackPayload) => HostSuccess;
    setEnabled: (payload: SkillPackSetEnabledPayload) => HostSuccess;
    readSkill: (payload: SkillPackReadSkillPayload) => SkillPackReadSkillResult;
  };
  officeTools: {
    detect: () => OfficecliInfo;
    install: (payload?: OfficecliInstallPayload) => OfficecliInfo;
    uninstall: () => OfficecliInfo;
    listSkills: () => OfficecliSkill[];
    syncSkills: () => OfficecliSkillSyncReport;
    linkSkillToAgent: (payload: OfficecliSkillAgentPayload) => OfficecliSkillInstallStatus;
    unlinkSkillFromAgent: (payload: OfficecliSkillAgentPayload) => void;
    getSkillInstallStatus: (payload: OfficecliSkillContentPayload) => OfficecliSkillInstallStatus[];
    listAllSkillInstallStatuses: () => OfficecliSkillInstallStatus[];
    applySkillLinks: (payload: OfficecliSkillApplyLinksPayload) => OfficecliSkillLinkOpResult[];
    readSkillContent: (payload: OfficecliSkillContentPayload) => string;
    renderHtml: (payload: OfficecliRenderHtmlPayload) => string;
    startWatch: (payload: OfficecliWatchPayload) => OfficecliWatchStarted;
    stopWatch: (payload: OfficecliWatchPayload) => void;
  };
  usage: {
    recentTokenHistory: (payload?: UsageHistoryPayload) => UsageHistoryEntry[];
    aggregateSummary: (payload?: UsageAggregateSummaryPayload) => UsageAggregateSummary;
    live: (payload: WorkspaceLiveUsagePayload) => WorkspaceLiveUsageResult;
    contextRange: (payload: WorkspaceContextRangePayload) => WorkspaceContextRangeResult;
    promptCacheStatus: (payload: PromptCacheStatusPayload) => PromptCacheStatusResult;
    recordPromptCacheRiskEvent: (payload: PromptCacheRiskEventPayload) => PromptCacheRiskEventResult;
  };
  topics: {
    list: (payload?: { agentId?: string; workspacePath?: string }) => HostSuccess & { topics: TopicEntry[] };
    create: (payload: TopicCreatePayload) => HostSuccess & { topic: TopicEntry };
    update: (payload: TopicUpdatePayload) => HostSuccess & { topic: TopicEntry };
    delete: (payload: TopicDeletePayload) => HostSuccess;
    getContext: (payload: TopicContextPayload) => HostSuccess & { content?: string; path?: string };
  };
  observability: {
    dashboardSnapshot: () => ObservabilityDashboardSnapshot;
    traces: () => unknown[];
    trace: (payload: { id: string }) => ObservabilityTrace | null;
    reportTrace: (payload: { trace: ObservabilityTrace }) => HostSuccess & { traceId?: string };
    queryTraces: (payload?: ObservabilityTraceQuery) => ObservabilityTraceQueryResult;
    traceGraph: (payload: { id: string }) => ObservabilityTraceGraphResult | null;
    traceNodeDiagnostics: (payload: { traceId: string; nodeId: string }) => ObservabilityNodeDiagnostics | null;
    trajectorySessions: () => { sessions: ObservabilityTrajectorySessionSupply[] };
    trajectoryHistory: (payload: { sessionKey: string; fromSeq?: number; limit?: number }) => ObservabilityTrajectoryHistoryPage;
    clearTraces: () => HostSuccess;
  };
  resourceTracker: {
    list: () => import('../types/resource-tracker').ResourceTrackerListResult;
    stop: (payload: { resourceId: string }) => import('../types/resource-tracker').ResourceTrackerStopResult;
    stopAll: () => import('../types/resource-tracker').ResourceTrackerStopAllResult;
  };
  /**
   * Area 4 §3.3: typed memory facade. Forwards to the existing gateway `memory.*`
   * RPCs through `electron/services/memory-api.ts`; reads stay SAFE-listed,
   * writes stay approval-gated. The facade is additive — `hostApi.gateway.rpc('memory.*')`
   * keeps working throughout the incremental migration.
   */
  memory: {
    list: (payload: MemoryListPayload) => MemoryListResult;
    search: (payload: MemorySearchPayload) => MemoryListResult;
    detail: (payload: MemoryDetailPayload) => MemoryDetailResult;
    previewProposal: (payload: MemoryProposal) => MemoryProposalPreviewResult;
    propose: (payload: MemoryProposal) => MemoryProposeResult;
    update: (payload: MemoryUpdatePayload) => MemoryUpdateResult;
    health: () => MemoryHealthReportResult;
    explainInjection: (payload: MemoryExplainInjectionPayload) => MemoryExplainInjectionResult;
    injectionReceipts: (payload: MemoryInjectionReceiptsPayload) => MemoryInjectionReceiptsResult;
    proposeFactsList: (payload: MemoryProposeFactsListPayload) => MemoryProposeFactsListResult;
    proposeFactsConfirm: (payload: MemoryProposeFactsConfirmPayload) => MemoryProposeFactsConfirmResult;
    surface: (payload?: MemorySurfacePayload) => MemorySurfaceResult;
    approveCandidate: (payload: MemoryApproveCandidatePayload) => MemoryApproveCandidateResult;
    delete: (payload: MemoryDeletePayload) => MemoryDeleteResult;
    remember: (payload: MemoryRememberPayload) => MemoryRememberResult;
    export: (payload?: MemoryExportPayload) => MemoryExportResult;
  };
};

export type HostApiModule = keyof HostApiContract & string;
export type HostApiAction<M extends HostApiModule> = keyof HostApiContract[M] & string;
export type HostApiFunction<
  M extends HostApiModule,
  A extends HostApiAction<M>,
> = HostApiContract[M][A] extends (...args: infer Args) => infer Result
  ? (...args: Args) => Result
  : never;
export type HostApiPayload<
  M extends HostApiModule,
  A extends HostApiAction<M>,
> = Parameters<HostApiFunction<M, A>> extends []
  ? undefined
  : Parameters<HostApiFunction<M, A>>[0];
export type HostApiResult<
  M extends HostApiModule,
  A extends HostApiAction<M>,
> = Awaited<ReturnType<HostApiFunction<M, A>>>;
export type HostApiPayloadArgs<
  M extends HostApiModule,
  A extends HostApiAction<M>,
> = Parameters<HostApiFunction<M, A>> extends []
  ? []
  : undefined extends HostApiPayload<M, A>
    ? [payload?: HostApiPayload<M, A>]
    : [payload: HostApiPayload<M, A>];
