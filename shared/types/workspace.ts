import type { WorkModeId } from './work-mode';

export type WorkspacePermissionMode = 'readOnly' | 'acceptEdits' | 'plan' | 'fullAccess';

export type WorkspacePreviewMode = 'static' | 'devServer' | 'externalUrl';

export type PermissionApprovalStatus = 'pending' | 'approved' | 'denied' | 'expired';
export type PermissionApprovalDecision = 'approved' | 'denied';
export type PermissionApprovalSource = 'terminal' | 'gateway' | 'mcp' | 'file' | 'remoteControl' | 'git';
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

export interface WorkspaceChatFooterState {
  contextRangeVisible?: boolean;
  tokenUsageVisible?: boolean;
  workContextVisible?: boolean;
}

export type WorkspaceKnowledgeScope = 'none' | 'memory' | 'wiki' | 'all';
export type KnowledgeInvocationMode = 'manual' | 'suggest' | 'auto-read';

export interface WorkspaceArtifactPanelState {
  open?: boolean;
  activeTab?: string;
  workspaceView?: 'files' | 'terminal' | 'web' | 'audit' | 'git';
  selectedPath?: string | null;
  gitSelectedPath?: string | null;
  gitDiffMode?: 'unstaged' | 'staged';
  gitBranchFilter?: string | null;
  githubPrFilter?: 'open' | 'closed' | 'merged' | 'all';
}

export interface WorkspaceUiState {
  draftInput?: string;
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
  graphExpanded?: Record<string, boolean>;
  recentFiles?: string[];
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
  totalTokens: number;
  estimatedCostUsd?: number;
  updatedAt: number;
  status: 'idle' | 'streaming' | 'final' | 'unavailable';
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
