import type { RawMessage } from '../chat/types';
import type { AgentReasoningEffort, AgentsSnapshot } from '../types/agent';
import type { CronJob, CronJobCreateInput, CronJobUpdateInput } from '../types/cron';
import type { GatewayHealth, GatewayStatus } from '../types/gateway';
import type {
  GitBranch,
  GitCapabilities,
  GitCommitResult,
  GitDiffMode,
  GitDiffResult,
  GitOperationResult,
  GitRepositoryStatus,
  GitStashEntry,
  GitWorktree,
  GithubAuthStatus,
  GithubPrCreateInput,
  GithubPrSummary,
  GithubRepository,
} from '../types/git';
export type { GitCommitResult, GitOperationResult, GithubPrCreateInput } from '../types/git';
import type {
  McpCallToolResult,
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
import type { MarketplaceSkill, QuickAccessSkill, Skill } from '../types/skill';
import type {
  LiveTokenUsage,
  PermissionApprovalDecision,
  PermissionApprovalEvent,
  WorkspaceContextRange,
  WorkspaceKnowledgeScope,
  WorkspacePermissionMode,
  WorkspacePreviewMode,
  WorkspaceProfile,
  WorkspaceSnapshot,
  WorkspaceUiState,
  WorkspaceWebPreviewLaunchConfig,
  WorkspaceWebPreviewStatus,
} from '../types/workspace';
import type { WorkModeId, WorkModeKitConfig, WorkModeToolBundleConfig } from '../types/work-mode';
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
} from '../types/observability';
import type {
  ClawGraphCompileResult,
  ClawGraphReviewDecision,
  ClawGraphRunEvent,
  ClawGraphRunSnapshot,
  ClawGraphWorkflowFile,
} from '../types/clawgraph';
import type {
  TaskLedgerEdge,
  TaskLedgerEventInput,
  TaskLedgerNode,
  TaskLedgerNodeKind,
  TaskLedgerNodeStatus,
  TaskLedgerSessionLink,
  TaskLedgerSnapshot,
} from '../types/task-ledger';
import type {
  LongTaskCheckpointRecord,
  LongTaskControlEvent,
  LongTaskControlStatus,
  LongTaskInputMode,
  ResumeCheckpoint,
} from '../types/long-task-control';
export type {
  LongTaskCheckpointRecord,
  LongTaskControlEvent,
  LongTaskControlStatus,
  LongTaskInputMode,
  ResumeCheckpoint,
} from '../types/long-task-control';

export type JsonRecord = Record<string, unknown>;
export type HostSuccess = { success: boolean; error?: string };
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
export type UpdateChannel = 'stable' | 'beta' | 'dev';
export type UpdateInfoSnapshot = {
  version: string;
  releaseDate?: string;
  releaseNotes?: string | null;
};
export type UpdateProgressSnapshot = {
  total: number;
  delta: number;
  transferred: number;
  percent: number;
  bytesPerSecond: number;
};
export type UpdateStatusSnapshot = {
  status: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
  info?: UpdateInfoSnapshot;
  progress?: UpdateProgressSnapshot;
  error?: string;
};
export type UpdateCheckResult = HostSuccess & { status?: UpdateStatusSnapshot };
export type UpdateSetChannelPayload = { channel: UpdateChannel };
export type UpdateSetAutoDownloadPayload = { enable: boolean };

export type SettingsSnapshot = Partial<{
  theme: 'light' | 'dark' | 'system';
  language: string;
  startMinimized: boolean;
  launchAtStartup: boolean;
  telemetryEnabled: boolean;
  gatewayAutoStart: boolean;
  gatewayPort: number;
  proxyEnabled: boolean;
  proxyServer: string;
  proxyHttpServer: string;
  proxyHttpsServer: string;
  proxyAllServer: string;
  proxyBypassRules: string;
  updateChannel: 'stable' | 'beta' | 'dev';
  autoCheckUpdate: boolean;
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  devModeUnlocked: boolean;
  setupComplete: boolean;
  cdpRemoteControlEnabled: boolean;
  cdpRemoteDebuggingPort: number;
  workModeToolBundles: WorkModeToolBundleConfig;
  workModeKits: WorkModeKitConfig;
  workProviders: WorkProviderConfig;
}>;
export type SettingsKey = keyof SettingsSnapshot & string;
export type SettingsValue = SettingsSnapshot[SettingsKey];
export type SettingsGetPayload = { key: SettingsKey };
export type SettingsSetPayload = { key: SettingsKey; value: SettingsValue };
export type SettingsSetManyPayload = { patch: Partial<SettingsSnapshot> };
export type SettingsResetResult = HostSuccess & { settings: SettingsSnapshot };

export type WorkspaceSnapshotResult = HostSuccess & WorkspaceSnapshot;
export type WorkspaceCreatePayload = {
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
export type WorkspaceSaveStatePayload = {
  id: string;
  activeSessionKey?: string;
  state?: WorkspaceUiState;
  sessionKey?: string;
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
  blocked?: boolean;
  approvalRequired?: boolean;
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
  workspaceId?: string;
  sessionKey?: string;
  cwd?: string;
  cols?: number;
  rows?: number;
  approvalId?: string;
  kind?: 'interactive' | 'webPreviewDevServer';
  command?: string;
};
export type WorkspaceTerminalSessionPayload = {
  sessionId: string;
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
export type WorkspaceTerminalSessionResult = HostSuccess & {
  blocked?: boolean;
  approvalRequired?: boolean;
  approval?: PermissionApprovalEvent;
  reason?: string;
  sessionId?: string | null;
  workspaceId?: string | null;
  sessionKey?: string | null;
  cwd?: string | null;
  pid?: number | null;
  cols?: number;
  rows?: number;
  status?: 'idle' | 'starting' | 'running' | 'exited' | 'blocked';
  exitCode?: number | null;
  scrollback?: string;
};
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

export type GatewayControlUiPayload = { view?: 'dreams' };
export type GatewayControlUiResult = HostSuccess & {
  url?: string;
  token?: string;
  port?: number;
};
export type GatewayHealthPayload = { probe?: boolean };
export type GatewayRpcPayload = {
  method: string;
  params?: unknown;
  timeoutMs?: number;
  approvalId?: string;
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
  env?: Record<string, string>;
  enabled?: boolean;
  scope?: McpScope;
  ownerId?: string;
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
export type McpListToolsPayload = { serverId: string };
export type McpHeartbeatPayload = { serverId: string };
export type McpCallToolPayload = {
  serverId: string;
  toolName: string;
  args?: Record<string, unknown>;
  approvalId?: string;
  workspaceId?: string | null;
  agentId?: string | null;
};
export type McpReloadRuntimePayload = { workspaceId?: string | null; agentId?: string | null };

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
  status: ChannelRuntimeStatus;
  statusReason?: string;
  lastError?: string;
  isDefault: boolean;
  agentId?: string;
};
export type ChannelGroupItem = {
  channelType: string;
  defaultAccountId: string;
  status: ChannelRuntimeStatus;
  statusReason?: string;
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
export type AgentCreatePayload = { name: string; inheritWorkspace?: boolean };
export type AgentUpdatePayload = { id: string; name: string };
export type AgentUpdateModelPayload = { id: string; modelRef: string | null };
export type AgentUpdateReasoningEffortPayload = { id: string; reasoningEffort: AgentReasoningEffort };
export type AgentIdPayload = { id: string };
export type AgentChannelPayload = { id: string; channelType: string };
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
  roleProfile?: import('@shared/types/agent').AgentRoleProfile;
};

export type DiagnosticsGatewaySnapshotResult = JsonRecord;

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
};
export type ProviderValidationPayload = {
  accountId?: string;
  vendorId?: string;
  providerId?: string;
  apiKey?: string;
  options?: ProviderValidationOptions;
};
export type ProviderValidationResult = { valid: boolean; error?: string; durationMs?: number };
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
export type MediaThumbnailResult = Record<string, { preview: string | null; fileSize: number }>;
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
};
export type SessionHistoryResult = OptionalHostSuccess & {
  messages?: RawMessage[];
};
export type SessionSummariesPayload = { sessionKeys?: string[]; limit?: number };
export type SessionLabelSummary = {
  sessionKey: string;
  firstUserText: string | null;
  lastTimestamp: number | null;
};
export type SessionSummariesResult = HostSuccess & {
  summaries?: SessionLabelSummary[];
};
export type SessionDeletePayload = { id: string };
export type SessionRenamePayload = { id: string; title: string };
export type SessionPatchThinkingPayload = {
  sessionKey: string;
  thinkingLevel: AgentReasoningEffort | null;
};
export type SessionCompactionPayload = {
  sessionKey: string;
  agentId?: string;
};
export type SessionCompactionHistoryPayload = SessionCompactionPayload & {
  limit?: number;
};
export type CompressionEvidenceRef = {
  type: 'session' | 'trace' | 'file' | 'tool' | 'task_ledger' | 'clawgraph' | 'manual' | 'other';
  ref: string;
  label?: string;
};
export type CompressionFact = {
  text: string;
  evidenceRefs: CompressionEvidenceRef[];
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
};
export type SessionCompressionArtifactPayload = SessionCompactionPayload & {
  checkpointId?: string;
};
export type SessionRecoveryContextPayload = SessionCompressionArtifactPayload & {
  budgetTokens?: number;
  purpose?: string;
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
export type SessionQueueDrainResult = HostSuccess & {
  key?: string;
  drained: boolean;
  queueCount: number;
  messageCount?: number;
  reason?: string;
};
export type SessionManualCompactPayload = SessionCompactionPayload & {
  customInstructions?: string;
  force?: boolean;
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
  status?: 'compacted' | 'skipped' | 'failed';
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
  id: 'compression_artifact' | 'runtime_checkpoint' | 'transcript' | 'task_ledger' | 'git' | 'observability';
  label: string;
  available: boolean;
  summary?: string;
  warning?: string;
};
export type SessionHandoffResult = HostSuccess & {
  checkpoint?: ResumeCheckpoint;
  draft?: string;
  sources?: SessionHandoffSource[];
  warnings?: string[];
};
export type SessionForkPayload = {
  sessionKey: string;
  agentId?: string;
  workspaceId?: string | null;
  label?: string;
};
export type SessionForkResult = HostSuccess & {
  sourceSessionKey?: string;
  sessionKey?: string;
  agentId?: string | null;
  workspaceId?: string | null;
  forkedFromParent?: boolean;
  warnings?: string[];
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
  message?: string;
  deliver?: boolean;
  idempotencyKey: string;
  media?: ChatMediaItem[];
  inputMode?: ChatInputMode;
  knowledgeScope?: WorkspaceKnowledgeScope;
  knowledgeReferences?: ChatKnowledgeReference[];
  workMode?: WorkModeId;
};
export type ChatSendWithMediaResult = HostSuccess & {
  result?: { runId?: string };
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
  maxResults?: number;
  corpus?: 'wiki' | 'memory' | 'all';
  mode?: string;
};
export type KnowledgeSearchResult = OptionalHostSuccess & {
  results?: Array<Record<string, unknown>>;
  [key: string]: unknown;
};
export type KnowledgeGetPayload = {
  lookup: string;
  fromLine?: number;
  lineCount?: number;
  corpus?: 'wiki' | 'memory' | 'all';
};
export type KnowledgeGetResult = OptionalHostSuccess & Record<string, unknown>;
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
};
export type KnowledgeCompileResult = OptionalHostSuccess & Record<string, unknown>;
export type KnowledgeLintResult = OptionalHostSuccess & Record<string, unknown>;
export type KnowledgeOpenVaultResult = HostSuccess & { path?: string };
export type KnowledgeDraftType = 'source-note' | 'synthesis' | 'decision' | 'architecture' | 'command' | 'troubleshooting' | 'glossary' | 'procedure';
export type KnowledgeDraftStatus = 'draft' | 'steward_reviewed' | 'approved' | 'rejected' | 'applied';
export type KnowledgeDraftActor = 'user' | 'agent' | 'steward';
export type KnowledgeSourceRef = {
  id: string;
  label?: string;
  kind?: 'chat' | 'file' | 'wiki' | 'task_ledger' | 'manual' | 'search_result';
  path?: string;
  url?: string;
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
  createdBy: KnowledgeDraftActor;
  confidence?: number;
  stewardNotes?: string;
  warnings?: string[];
  createdAt: string;
  updatedAt: string;
  reviewedAt?: string;
  appliedAt?: string;
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
  createdBy: KnowledgeDraftActor;
  warnings?: string[];
  metadata?: Record<string, unknown>;
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
export type KnowledgeChangeOperation = 'create' | 'update' | 'merge' | 'archive' | 'delete';
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
};
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
export type KnowledgeCreateDraftPayload = {
  title: string;
  body: string;
  type?: KnowledgeDraftType;
  sourceIds?: string[];
  sourceRefs?: KnowledgeSourceRef[];
  tags?: string[];
  workspaceId?: string | null;
  agentId?: string | null;
  createdBy?: KnowledgeDraftActor;
  confidence?: number;
};
export type KnowledgeDraftResult = HostSuccess & { draft?: KnowledgeDraft };
export type KnowledgeListDraftsPayload = {
  status?: KnowledgeDraftStatus | 'all';
  workspaceId?: string | null;
  limit?: number;
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
export type KnowledgeApplyReviewedChangePayload = { id: string };
export type KnowledgeApplyReviewedChangeResult = KnowledgeApplyDraftResult & {
  proposal?: KnowledgeChangeProposal;
  draft?: KnowledgeDraft;
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

export type CronUpdatePayload = { id: string; input: CronJobUpdateInput };
export type CronIdPayload = { id: string };
export type CronTogglePayload = CronIdPayload & { enabled: boolean };
export type CronSessionHistoryPayload = { sessionKey: string; limit?: number };
export type CronSessionHistoryResult = {
  messages?: RawMessage[];
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
export type GithubPrListPayload = { state?: 'open' | 'closed' | 'merged' | 'all'; limit?: number };
export type GithubPrViewPayload = { number: number };
export type GithubPrOpenPayload = { number: number };
export type GitCapabilitiesResult = HostSuccess & GitCapabilities;
export type GitStatusResult = HostSuccess & { status: GitRepositoryStatus };
export type GitDiffListResult = HostSuccess & { changes: GitRepositoryStatus['changes']; patch?: string };
export type GitFileDiffResult = HostSuccess & GitDiffResult;
export type GitBranchListResult = HostSuccess & { branches: GitBranch[] };
export type GitStashListResult = HostSuccess & { stashes: GitStashEntry[] };
export type GitWorktreeListResult = HostSuccess & { worktrees: GitWorktree[] };
export type GithubAuthStatusResult = HostSuccess & GithubAuthStatus;
export type GithubRepoResult = HostSuccess & { repository: GithubRepository | null };
export type GithubPrListResult = HostSuccess & { pullRequests: GithubPrSummary[] };
export type GithubPrViewResult = HostSuccess & { pullRequest: GithubPrSummary | null; body?: string };
export type GithubPrCreateResult = GitOperationResult & { pullRequest?: GithubPrSummary };

export type TaskLedgerWorkspacePayload = { workspaceId?: string | null };
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
  summary?: string;
  idempotencyKey?: string | null;
};
export type TaskLedgerReviewPayload = TaskLedgerWorkspacePayload & {
  nodeId: string;
  reason?: string;
  status?: TaskLedgerNodeStatus;
  idempotencyKey?: string | null;
};
export type TaskLedgerExportHtmlPayload = TaskLedgerWorkspacePayload & { includeHistory?: boolean };
export type TaskLedgerExportHtmlResult = HostSuccess & { path: string };

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
};
export type UsageHistoryPayload = { limit?: number };
export type WorkspaceLiveUsagePayload = { sessionKey: string; runId?: string | null; streaming?: boolean };
export type WorkspaceLiveUsageResult = HostSuccess & { usage: LiveTokenUsage };
export type WorkspaceContextRangePayload = {
  sessionKey: string;
  modelRef?: string | null;
  messageCount?: number;
  usedTokens?: number | null;
};
export type WorkspaceContextRangeResult = HostSuccess & { range: WorkspaceContextRange };

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

// ── Topic types ────────────────────────────────────────────────────────────

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

export type HostApiContract = {
  app: {
    openClawDoctor: (payload: OpenClawDoctorPayload) => Omit<OpenClawDoctorResult, 'mode'>;
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
    minimize: () => void;
    maximize: () => void;
    close: () => void;
    isMaximized: () => boolean;
  };
  updates: {
    status: () => UpdateStatusSnapshot;
    version: () => string;
    check: () => UpdateCheckResult;
    download: () => HostSuccess;
    install: () => HostSuccess;
    setChannel: (payload: UpdateSetChannelPayload) => HostSuccess;
    setAutoDownload: (payload: UpdateSetAutoDownloadPayload) => HostSuccess;
    cancelAutoInstall: () => HostSuccess;
  };
  uv: {
    installAll: () => HostSuccess;
  };
  settings: {
    getAll: () => SettingsSnapshot;
    get: (payload: SettingsGetPayload) => SettingsValue;
    set: (payload: SettingsSetPayload) => HostSuccess;
    setMany: (payload: SettingsSetManyPayload) => HostSuccess;
    reset: () => SettingsResetResult;
  };
  workspaces: {
    list: () => WorkspaceSnapshotResult;
    getActive: () => WorkspaceActiveResult;
    create: (payload: WorkspaceCreatePayload) => WorkspaceSnapshotResult;
    update: (payload: WorkspaceUpdatePayload) => WorkspaceSnapshotResult;
    delete: (payload: WorkspaceDeletePayload) => WorkspaceSnapshotResult;
    switch: (payload: WorkspaceSwitchPayload) => WorkspaceActiveResult;
    saveState: (payload: WorkspaceSaveStatePayload) => HostSuccess;
  };
  terminal: {
    run: (payload: WorkspaceTerminalRunPayload) => WorkspaceTerminalRunResult;
    open: (payload?: WorkspaceTerminalOpenPayload) => WorkspaceTerminalSessionResult;
    write: (payload: WorkspaceTerminalWritePayload) => HostSuccess;
    resize: (payload: WorkspaceTerminalResizePayload) => HostSuccess;
    interrupt: (payload: WorkspaceTerminalSessionPayload) => HostSuccess;
    close: (payload: WorkspaceTerminalSessionPayload) => HostSuccess;
    status: (payload?: WorkspaceTerminalStatusPayload) => WorkspaceTerminalSessionResult;
  };
  git: {
    capabilities: () => GitCapabilitiesResult;
    status: () => GitStatusResult;
    diff: (payload?: { mode?: GitDiffMode }) => GitDiffListResult;
    fileDiff: (payload: GitFileDiffPayload) => GitFileDiffResult;
    stage: (payload: GitPathsPayload) => GitOperationResult;
    unstage: (payload: GitPathsPayload) => GitOperationResult;
    commit: (payload: GitCommitPayload) => GitCommitResult;
    branches: () => GitBranchListResult;
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
    githubAuthStatus: () => GithubAuthStatusResult;
    githubRepo: () => GithubRepoResult;
    prList: (payload?: GithubPrListPayload) => GithubPrListResult;
    prView: (payload: GithubPrViewPayload) => GithubPrViewResult;
    prCreate: (payload: GithubPrCreateInput) => GithubPrCreateResult;
    openPr: (payload: GithubPrOpenPayload) => GitOperationResult;
  };
  permissions: {
    approvals: (payload?: PermissionApprovalListPayload) => PermissionApprovalListResult;
    decideApproval: (payload: PermissionApprovalDecisionPayload) => PermissionApprovalDecisionResult;
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
    rpc: (payload: GatewayRpcPayload) => unknown;
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
    updateModel: (payload: AgentUpdateModelPayload) => AgentSnapshotResult;
    updateReasoningEffort: (payload: AgentUpdateReasoningEffortPayload) => AgentSnapshotResult;
    getBootstrap: (payload: AgentIdPayload) => AgentBootstrapResult;
    updateBootstrap: (payload: AgentBootstrapUpdatePayload) => AgentBootstrapResult;
    delete: (payload: AgentIdPayload) => AgentSnapshotResult;
    assignChannel: (payload: AgentChannelPayload) => AgentSnapshotResult;
    removeChannel: (payload: AgentChannelPayload) => AgentSnapshotResult;
  };
  diagnostics: {
    gatewaySnapshot: () => DiagnosticsGatewaySnapshotResult;
  };
  providers: {
    list: () => ProviderWithKeyInfo[];
    get: (payload: ProviderIdPayload) => ProviderConfig | null;
    getDefault: () => string | undefined;
    hasApiKey: (payload: ProviderIdPayload) => boolean;
    getApiKey: (payload: ProviderIdPayload) => string | null;
    validateKey: (payload: ProviderValidationPayload) => ProviderValidationResult;
    listModels: (payload: ProviderModelListPayload) => ProviderModelListResult;
    save: (payload: ProviderSavePayload) => HostSuccess;
    delete: (payload: ProviderIdPayload) => HostSuccess;
    setApiKey: (payload: ProviderApiKeyPayload) => HostSuccess;
    updateWithKey: (payload: ProviderUpdateWithKeyPayload) => HostSuccess;
    deleteApiKey: (payload: ProviderIdPayload) => HostSuccess;
    setDefault: (payload: ProviderIdPayload) => HostSuccess;
    accounts: () => ProviderAccount[];
    vendors: () => ProviderVendorInfo[];
    accountKeyInfo: () => ProviderAccountKeyInfo[];
    getDefaultAccount: () => ProviderDefaultAccountResult;
    getAccount: (payload: ProviderAccountIdPayload) => ProviderAccount | null;
    getAccountApiKey: (payload: ProviderAccountIdPayload) => string | null;
    hasAccountApiKey: (payload: ProviderAccountIdPayload) => boolean;
    createAccount: (payload: ProviderCreateAccountPayload) => HostSuccess;
    updateAccount: (payload: ProviderUpdateAccountPayload) => HostSuccess;
    deleteAccount: (payload: ProviderAccountIdPayload) => HostSuccess;
    deleteAccountApiKey: (payload: ProviderAccountIdPayload) => HostSuccess;
    setDefaultAccount: (payload: ProviderAccountIdPayload) => HostSuccess;
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
  };
  media: {
    thumbnails: (payload: MediaThumbnailsPayload) => MediaThumbnailResult;
    saveImage: (payload: SaveImagePayload) => JsonRecord;
    imageGenerationSettings: () => ImageGenerationSettingsResult;
    saveImageGenerationSettings: (payload: ImageGenerationSettingsPayload) => ImageGenerationSettingsResult;
    imageGenerationProviders: () => ImageGenerationProvidersResult;
    testImageGeneration: (payload: ImageGenerationTestPayload) => ImageGenerationTestResult;
  };
  sessions: {
    delete: (payload: SessionDeletePayload) => HostSuccess;
    rename: (payload: SessionRenamePayload) => HostSuccess;
    summaries: (payload?: SessionSummariesPayload) => SessionSummariesResult;
    history: (payload: SessionHistoryPayload) => SessionHistoryResult;
    patchThinking: (payload: SessionPatchThinkingPayload) => HostSuccess & { result?: unknown };
    compactionStatus: (payload: SessionCompactionPayload) => SessionCompactionStatusResult;
    compactionHistory: (payload: SessionCompactionHistoryPayload) => SessionCompactionHistoryResult;
    compressionArtifact: (payload: SessionCompressionArtifactPayload) => SessionCompressionArtifactResult;
    recoveryContext: (payload: SessionRecoveryContextPayload) => SessionRecoveryContextResult;
    longTaskControlStatus: (payload: SessionLongTaskControlPayload) => SessionLongTaskControlStatusResult;
    longTaskControlHistory: (payload: SessionLongTaskControlHistoryPayload) => SessionLongTaskControlHistoryResult;
    resumeCheckpoints: (payload: SessionLongTaskControlHistoryPayload) => SessionResumeCheckpointsResult;
    queueDrain: (payload: SessionLongTaskControlPayload) => SessionQueueDrainResult;
    compact: (payload: SessionManualCompactPayload) => SessionCompactionResult;
    prepareHandoff: (payload: SessionHandoffPayload) => SessionHandoffResult;
    fork: (payload: SessionForkPayload) => SessionForkResult;
  };
  chat: {
    sendWithMedia: (payload: ChatSendWithMediaPayload) => ChatSendWithMediaResult;
  };
  workProviders: {
    status: () => WorkProviderStatusSnapshot;
    run: (payload: WorkProviderRunPayload) => WorkProviderRunResult;
    validateArtifact: (payload: WorkProviderValidateArtifactPayload) => WorkProviderValidateArtifactResult;
  };
  knowledge: {
    status: () => KnowledgeStatusResult;
    init: () => KnowledgeInitResult;
    configure: (payload?: KnowledgeConfigurePayload) => HostSuccess;
    ingestFiles: (payload: KnowledgeIngestFilesPayload) => KnowledgeIngestFilesResult;
    validateOkfBundle: (payload: KnowledgeValidateOkfBundlePayload) => KnowledgeOkfValidationResult;
    importOkfBundle: (payload: KnowledgeImportOkfBundlePayload) => KnowledgeOkfImportResult;
    search: (payload: KnowledgeSearchPayload) => KnowledgeSearchResult;
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
    listDrafts: (payload?: KnowledgeListDraftsPayload) => KnowledgeListDraftsResult;
    getDraft: (payload: KnowledgeGetDraftPayload) => KnowledgeDraftResult;
    updateDraft: (payload: KnowledgeUpdateDraftPayload) => KnowledgeDraftResult;
    reviewDraft: (payload: KnowledgeReviewDraftPayload) => KnowledgeDraftResult;
    proposeChange: (payload: KnowledgeProposeChangePayload) => KnowledgeProposalResult;
    listProposals: (payload?: KnowledgeListProposalsPayload) => KnowledgeListProposalsResult;
    previewChange: (payload: KnowledgePreviewChangePayload) => KnowledgePreviewChangeResult;
    applyReviewedChange: (payload: KnowledgeApplyReviewedChangePayload) => KnowledgeApplyReviewedChangeResult;
    stewardReview: (payload: KnowledgeStewardReviewPayload) => KnowledgeStewardReviewResult;
    recordKnowledgeReference: (payload: KnowledgeRecordReferencePayload) => KnowledgeProvenanceResult;
    getProvenance: (payload: KnowledgeProvenancePayload) => KnowledgeProvenanceResult;
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
    snapshot: (payload?: TaskLedgerWorkspacePayload) => TaskLedgerSnapshotResult;
    appendEvents: (payload: TaskLedgerAppendEventsPayload) => TaskLedgerSnapshotResult;
    createNode: (payload: TaskLedgerCreateNodePayload) => TaskLedgerSnapshotResult;
    updateNode: (payload: TaskLedgerUpdateNodePayload) => TaskLedgerSnapshotResult;
    addEdge: (payload: TaskLedgerAddEdgePayload) => TaskLedgerSnapshotResult;
    linkSession: (payload: TaskLedgerLinkSessionPayload) => TaskLedgerSnapshotResult;
    requestReview: (payload: TaskLedgerReviewPayload) => TaskLedgerSnapshotResult;
    clearReview: (payload: TaskLedgerReviewPayload) => TaskLedgerSnapshotResult;
    exportHtml: (payload?: TaskLedgerExportHtmlPayload) => TaskLedgerExportHtmlResult;
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
  usage: {
    recentTokenHistory: (payload?: UsageHistoryPayload) => UsageHistoryEntry[];
    live: (payload: WorkspaceLiveUsagePayload) => WorkspaceLiveUsageResult;
    contextRange: (payload: WorkspaceContextRangePayload) => WorkspaceContextRangeResult;
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
    clearTraces: () => HostSuccess;
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
