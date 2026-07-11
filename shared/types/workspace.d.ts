import type { WorkModeId } from './work-mode';
export type WorkspacePermissionMode = 'readOnly' | 'acceptEdits' | 'plan' | 'fullAccess';
export type WorkspacePreviewMode = 'static' | 'devServer' | 'externalUrl';
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
    workspaceView?: 'home' | 'files' | 'terminal' | 'web' | 'audit' | 'git';
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
    turnSummaryExpanded?: Record<string, boolean>;
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
}
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
export type PromptCacheRiskAction = 'model-switch' | 'manual-compaction' | 'skill-enable' | 'mcp-register' | 'mcp-reload' | 'system-prompt-change' | 'context-reset';
export type PromptCacheRiskSeverity = 'none' | 'low' | 'medium' | 'high' | 'unknown';
export type PromptCacheConfidence = 'high' | 'medium' | 'low' | 'unknown';
export type PromptCacheProviderStrategy = 'anthropic' | 'gemini' | 'bedrock' | 'openai-native' | 'openai-compatible' | 'generic' | 'unknown';
export type PromptCacheRiskDecision = 'continued' | 'cancelled';
export interface PromptCacheRiskEvent {
    sessionKey: string;
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
    lastRiskEvent?: PromptCacheRiskEvent;
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
