import type { TaskLedgerReference } from './task-ledger-reference.js';
import type { WorkModeId } from './work-mode.js';
import type { SessionTaskWriterClaim } from '../session-task-scope.js';
import type { SessionHandoffOperation } from './session-handoff.js';
import type { ExecutionMigrationOperation } from './execution-migration.js';

export type WorkspacePermissionMode = 'readOnly' | 'acceptEdits' | 'plan' | 'fullAccess';

/** Safe default for new/untrusted workspaces and invalid/missing stored modes (P2-001 / F-AUTH-001). */
export const DEFAULT_WORKSPACE_PERMISSION_MODE: WorkspacePermissionMode = 'readOnly';

export const WORKSPACE_PERMISSION_MODES: readonly WorkspacePermissionMode[] = [
  'readOnly',
  'plan',
  'acceptEdits',
  'fullAccess',
] as const;

export function isWorkspacePermissionMode(value: unknown): value is WorkspacePermissionMode {
  return typeof value === 'string' && (WORKSPACE_PERMISSION_MODES as readonly string[]).includes(value);
}

export function normalizeWorkspacePermissionMode(value: unknown): WorkspacePermissionMode {
  return isWorkspacePermissionMode(value) ? value : DEFAULT_WORKSPACE_PERMISSION_MODE;
}

export type WorkspacePreviewMode = 'static' | 'devServer' | 'externalUrl';

export type WorkspaceReviewView = 'changes' | 'ai-review' | 'pull-requests';
export type WorkspaceBrowserView = 'preview' | 'live';
export type WorkspaceTerminalPlacement = 'bottom' | 'side';

export type WorkspacePanelIntent =
  | { panel: 'review'; view?: WorkspaceReviewView; filePath?: string }
  | { panel: 'browser'; view?: WorkspaceBrowserView; url?: string; sessionId?: string }
  | { panel: 'files'; filePath?: string }
  | { panel: 'terminal'; placement?: WorkspaceTerminalPlacement }
  | { panel: 'artifact'; artifactId?: string }
  | { panel: 'audit' }
  /** `sessionKey` focuses one sub-agent's transcript on open. */
  | { panel: 'agents'; sessionKey?: string }
  /**
   * One sub-agent's own page. Unlike `agents` (the roster), this opens a tab per
   * worker, so two workers can be read side by side and each chip carries that
   * worker's own face and name.
   */
  | { panel: 'subagent'; sessionKey: string; roleName?: string }
  /** One shell process's own page: its command, exit code, and captured output. */
  | { panel: 'process'; processId: string; command?: string };

export type PermissionApprovalStatus = 'pending' | 'approved' | 'denied' | 'expired';
export type PermissionApprovalDecision = 'approved' | 'denied';
export type PermissionApprovalSource = 'terminal' | 'gateway' | 'mcp' | 'file' | 'remoteControl' | 'git' | 'cleaner';
export type PermissionRiskLevel = 'write' | 'network' | 'destructive' | 'external-write' | 'dangerous';

export type WorkspaceTerminalStatus = 'idle' | 'starting' | 'running' | 'exited' | 'blocked';
export type WorkspaceWebPreviewStatus = 'idle' | 'detecting' | 'starting' | 'running' | 'stopping' | 'stopped' | 'error';
export type WorkspaceWebPreviewPackageManager = 'pnpm' | 'npm' | 'yarn' | 'bun';
export type WorkspaceWebPreviewLaunchSource = 'manual' | 'detected' | 'packageScripts' | 'externalUrl';

export interface WorkspaceTerminalState {
  open?: boolean;
  cwd?: string;
  lastCommand?: string;
  scrollbackId?: string;
  activeProcessId?: string | null;
  sessionId?: string | null;
  registeredWorkspaceId?: string | null;
  cols?: number;
  rows?: number;
  status?: WorkspaceTerminalStatus;
  lastExitCode?: number | null;
}

export interface WorkspaceWebPreviewLaunchConfig {
  mode: WorkspacePreviewMode;
  name: string;
  cwd?: string | null;
  command?: string | null;
  packageManager?: WorkspaceWebPreviewPackageManager | null;
  scriptName?: string | null;
  expectedPort?: number | null;
  source?: WorkspaceWebPreviewLaunchSource;
}

export interface WorkspacePreviewSelectedElement {
  href: string;
  tagName: string;
  id?: string;
  className?: string;
  cssSelector: string;
  text?: string;
  role?: string;
  ariaLabel?: string;
  attributes: Record<string, string>;
  rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  outerHtmlPreview: string;
}

export interface WorkspaceWebPreviewState {
  open?: boolean;
  mode?: WorkspacePreviewMode;
  targetPath?: string | null;
  url?: string | null;
  port?: number | null;
  lastStartedAt?: number | null;
  previewId?: string | null;
  previewUrl?: string | null;
  targetUrl?: string | null;
  rootPath?: string | null;
  processSessionId?: string | null;
  launchConfig?: WorkspaceWebPreviewLaunchConfig | null;
  selectedElement?: WorkspacePreviewSelectedElement | null;
  status?: WorkspaceWebPreviewStatus;
  error?: string | null;
  agentBrowserSessionId?: string | null;
  agentBrowserMode?: 'headless' | 'visible' | null;
  agentBrowserProfile?: string | null;
  agentBrowserUrl?: string | null;
  agentBrowserTitle?: string | null;
  agentBrowserUpdatedAt?: number | null;
}

export interface WorkspaceAgentBinding {
  workspaceId: string;
  agentId: string;
  sessionKey: string;
  skillOverrides?: Array<{
    skillKey: string;
    enabled: boolean;
    source?: string;
    config?: Record<string, unknown>;
  }>;
  mcpOverrides?: Array<{
    serverId: string;
    enabled: boolean;
    allowedTools?: string[];
    deniedTools?: string[];
  }>;
  bootstrapOverrides?: Record<string, string>;
}

export type WorkspaceCoordinatorBindingState = 'active' | 'paused' | 'invalid';
export type WorkspaceCoordinatorArchiveRestorePolicy = 'restore' | 'none';

/** Facts resolved from the existing workspace and Git/worktree owners. */
export interface WorkspaceCoordinatorEnvironmentBinding {
  kind: 'local' | 'managed-worktree';
  canonicalRoot: string;
  backend: 'local-workspace' | 'git';
  branch: string | null;
  detachedHead: boolean;
  setupProfile: string | null;
}

/**
 * Minimal explicit long-collaboration metadata. Task status and completion stay
 * in Task Ledger; this record carries only a one-way reference list.
 */
export interface WorkspaceCoordinatorBinding {
  schemaVersion: 1;
  workspaceId: string;
  agentId: string;
  sessionKey: string;
  sessionGeneration: string | null;
  taskLedgerReferences: TaskLedgerReference[];
  /** Explicit task selection; completion remains in Task Ledger. */
  activeTaskNodeId?: string;
  /** A run-scoped writer fence. Fork/handoff never copy it to the child. */
  writerClaim?: SessionTaskWriterClaim;
  environment: WorkspaceCoordinatorEnvironmentBinding;
  archiveRestorePolicy: WorkspaceCoordinatorArchiveRestorePolicy;
  state: WorkspaceCoordinatorBindingState;
  bindingRevision: number;
  invalidationReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export type WorkspaceCoordinatorRecoveryState =
  | 'ready'
  | 'paused'
  | 'invalid'
  | 'missing'
  | 'unavailable'
  | 'environment-missing'
  | 'session-missing'
  | 'session-pending'
  | 'generation-mismatch';

export interface WorkspaceCoordinatorRecovery {
  state: WorkspaceCoordinatorRecoveryState;
  reason: string | null;
  bindingRevision: number | null;
}

export interface WorkspaceChatFooterState {
  contextRangeVisible?: boolean;
  tokenUsageVisible?: boolean;
  workContextVisible?: boolean;
}

/** Per-conversation presentation state owned by the left session sidebar. */
export interface WorkspaceSessionListState {
  pinned?: boolean;
  unread?: boolean;
  /** Timestamp of the last explicit read action, for future activity comparisons. */
  lastReadAt?: number;
}

export type WorkspaceKnowledgeScope = 'none' | 'memory' | 'wiki' | 'all';
export type KnowledgeInvocationMode = 'manual' | 'suggest' | 'auto-read';

export interface WorkspaceArtifactPanelState {
  open?: boolean;
  /** Whether the panel occupies layout space instead of overlaying the chat. */
  expanded?: boolean;
  /** Tab strip contents, oldest first. Empty/absent means the launcher shows. */
  tabs?: Array<{ kind?: string; title?: string }>;
  /** Which tab kind was focused when the session was saved. */
  activeTabKind?: string;
  reviewView?: WorkspaceReviewView;
  browserView?: WorkspaceBrowserView;
  browserSessionId?: string | null;
  terminalPlacement?: WorkspaceTerminalPlacement;
  /**
   * @deprecated Pre-tab-strip sessions. Read on restore and migrated into a
   * single equivalent tab; never written by current code.
   */
  activeTab?: string;
  /** @deprecated Pre-tab-strip nested workspace sub-route. See `activeTab`. */
  workspaceView?: 'home' | 'files' | 'terminal' | 'web' | 'audit' | 'git';
  selectedPath?: string | null;
  gitSelectedPath?: string | null;
  gitDiffMode?: 'unstaged' | 'staged';
  gitBranchFilter?: string | null;
  githubPrFilter?: 'open' | 'closed' | 'merged' | 'all';
}

export interface WorkspaceUiState {
  draftInput?: string;
  readingPosition?: { generation?: string; scrollTop: number; messageKey?: string; offset?: number; pinned?: boolean };
  /** A deliberate stop is remembered so the composer can render its resume state. */
  composerRunState?: 'idle' | 'paused';
  selectedModelRef?: string | null;
  activeTopicId?: string | null;
  knowledgeScope?: WorkspaceKnowledgeScope;
  knowledgeMode?: KnowledgeInvocationMode;
  /**
   * @deprecated Internal migration compatibility only. Current Chat behavior
   * uses explicit effort/intensity fields and must not persist Work Mode as
   * session behavior state.
   */
  workMode?: WorkModeId;
  artifactPanel?: WorkspaceArtifactPanelState;
  terminal?: WorkspaceTerminalState;
  webPreview?: WorkspaceWebPreviewState;
  chatFooter?: WorkspaceChatFooterState;
  sessionList?: WorkspaceSessionListState;
  graphExpanded?: Record<string, boolean>;
  turnSummaryExpanded?: Record<string, boolean>;
  turnSummaryStepDetailsExpanded?: Record<string, Record<string, boolean>>;
  recentFiles?: string[];
}

export interface SessionFolder {
  id: string;
  name: string;
  parentId: string | null;
  order: number;
  kind?: 'folder' | 'workgroup';
  createdAt: number;
  updatedAt: number;
}

export interface WorkspaceProfile {
  id: string;
  name: string;
  rootPath: string;
  agentId: string;
  selectedAgentId?: string;
  activeSessionKey: string;
  agentBindings?: Record<string, WorkspaceAgentBinding>;
  permissionMode: WorkspacePermissionMode;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number;
  state: WorkspaceUiState;
  sessionStates?: Record<string, WorkspaceUiState>;
  sessionFolders?: SessionFolder[];
  sessionFolderAssignments?: Record<string, string>;
  archivedSessionKeys?: string[];
  /** Explicit long-collaboration metadata, keyed by stable SessionKey. */
  coordinatorBindings?: Record<string, WorkspaceCoordinatorBinding>;
  /** Stable project entry, owned by coordinator binding/handoff rather than chat selection. */
  projectCoordinatorSessionKey?: string;
  handoffOperations?: Record<string, SessionHandoffOperation>;
  executionMigrations?: Record<string, ExecutionMigrationOperation>;
}

export type SessionPendingMutation = {
  operationId: string;
  operationKind: 'archive' | 'restore' | 'delete';
  sessionKey: string;
  agentId: string;
  createdAt: number;
};

export interface SessionArchiveEntry {
  sessionKey: string;
  agentId: string;
  transcriptPath: string;
  label: string;
  archivedAt: number;
  originalWorkspaceId: string | null;
  originalFolderId: string | null;
  sessionsJsonSnapshot: unknown;
}

export interface SessionArchiveIndex {
  version: 1;
  entries: SessionArchiveEntry[];
}

export interface WorkspaceSnapshot {
  profiles: WorkspaceProfile[];
  activeWorkspaceId: string | null;
  activeWorkspace: WorkspaceProfile | null;
}

export interface WorkspaceContextRange {
  sessionKey: string;
  modelRef?: string | null;
  maxTokens?: number | null;
  usedTokens?: number | null;
  visibleMessageStartIndex?: number | null;
  visibleMessageEndIndex?: number | null;
  retainedMessageCount?: number;
  truncatedMessageCount?: number;
  summarizedMessageCount?: number;
  status: 'exact' | 'bestEffort' | 'unavailable';
}

export interface LiveTokenUsage {
  sessionKey: string;
  runId?: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  lastTurnHitRate?: number | null;
  warmTurnHitRate?: number | null;
  lastTurnCacheReadTokens?: number;
  lastTurnCacheMissTokens?: number;
  totalTokens: number;
  estimatedCostUsd?: number;
  updatedAt: number;
  status: 'idle' | 'streaming' | 'final' | 'unavailable';
}

export type PromptCacheStatus = 'warm' | 'warming' | 'cold' | 'at-risk' | 'ineligible' | 'unknown';
export type PromptCacheRiskAction =
  | 'model-switch'
  | 'manual-compaction'
  | 'skill-enable'
  | 'mcp-register'
  | 'mcp-reload'
  | 'system-prompt-change'
  | 'context-reset';
export type PromptCacheRiskSeverity = 'none' | 'low' | 'medium' | 'high' | 'unknown';
export type PromptCacheConfidence = 'high' | 'medium' | 'low' | 'unknown';
export type PromptCacheProviderStrategy =
  | 'anthropic'
  | 'gemini'
  | 'bedrock'
  | 'openai-native'
  | 'openai-compatible'
  | 'generic'
  | 'unknown';
export type PromptCacheRiskDecision = 'continued' | 'cancelled';
/** Closed set of tracked inputs that can break a warm prompt-cache prefix. */
export type PromptCacheChangeCode =
  | 'cacheRetention'
  | 'model'
  | 'streamStrategy'
  | 'systemPrompt'
  | 'tools'
  | 'transport';

/**
 * A bounded, agent-driven observation of a real cache-read break. It is
 * evidence that a warm prefix dropped, not a user action or a decision; it
 * carries only finite counters and closed change codes.
 */
export interface PromptCacheRiskObservation {
  sessionKey: string;
  source: 'observed';
  /** Deterministic identity (run + sequence) used to deduplicate replays. */
  eventId: string;
  previousCacheRead: number;
  cacheRead: number;
  changes: PromptCacheChangeCode[];
  updatedAt: number;
}

/**
 * A recorded prompt-cache risk decision. Confirmed events are the existing
 * UI-driven action decisions; `source` labels them so observed break evidence
 * and explicit decisions stay distinguishable in the shared ledger.
 */
export interface PromptCacheRiskDecisionEvent {
  sessionKey: string;
  source: 'confirmed';
  action: PromptCacheRiskAction;
  severity: PromptCacheRiskSeverity;
  status: PromptCacheStatus;
  decision: PromptCacheRiskDecision;
  hitRate: number | null;
  promptTokens: number;
  estimatedExtraCostUsd?: number;
  reason?: string;
  updatedAt: number;
}

/**
 * A ledger row. Legacy persisted rows predate the `source` field and are read
 * as confirmed decision events.
 */
export type PromptCacheRiskEvent = PromptCacheRiskDecisionEvent | PromptCacheRiskObservation;

export interface PromptCacheRiskAssessment {
  sessionKey: string;
  action?: PromptCacheRiskAction;
  status: PromptCacheStatus;
  severity: PromptCacheRiskSeverity;
  shouldWarn: boolean;
  confidence: PromptCacheConfidence;
  providerStrategy: PromptCacheProviderStrategy;
  hitRate: number | null;
  promptTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  lastTurnHitRate?: number | null;
  warmTurnHitRate?: number | null;
  lastTurnCacheReadTokens?: number;
  lastTurnCacheMissTokens?: number;
  estimatedSavedUsd?: number;
  estimatedExtraCostUsd?: number;
  costEstimateReliable: boolean;
  reason?: string;
  warningCount: number;
  cancelledBreakCount: number;
  lastRiskEvent?: PromptCacheRiskDecisionEvent;
  /** Latest agent-observed cache-read break for this exact session, if any. */
  lastObservedBreak?: PromptCacheRiskObservation;
  updatedAt: number;
}

export interface PermissionApprovalEvent {
  id: string;
  workspaceId: string;
  sessionKey: string;
  runId?: string | null;
  mode: WorkspacePermissionMode;
  source: PermissionApprovalSource;
  requestedAt: number;
  resolvedAt?: number;
  status: PermissionApprovalStatus;
  risk: PermissionRiskLevel;
  command?: string;
  cwd?: string;
  paths?: string[];
  requestHash?: string;
  paramsPreview?: string;
  reason?: string;
}
