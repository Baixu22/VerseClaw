import type { ChatRuntimeEvent } from '../chat-runtime-events';
import type { ChatKnowledgeReference } from '../host-api/contract';
import type { KnowledgeInvocationMode, WorkspaceKnowledgeScope } from '../types/workspace';
import type { AgentReasoningEffort, RuntimeIntensityPreference } from '../types/agent';
import type { TaskLedgerSnapshot } from '../types/task-ledger';
import type { SessionArchiveEntry, SessionPendingMutation } from '../types/workspace';

/** Metadata for locally-attached files (not from Gateway) */
export interface AttachedFileMeta {
  fileName: string;
  mimeType: string;
  fileSize: number;
  preview: string | null;
  previewStatus?: 'unavailable';
  filePath?: string;
  /**
   * `tool-media` marks audio/video a tool explicitly declared in its result.
   * `tool-result` is a path found in tool output: it may be an artifact from any
   * tool the turn ran, or noise such as `ls *.mp3`. `producedAfter` tells them apart.
   */
  source?: 'user-upload' | 'tool-result' | 'message-ref' | 'gateway-media' | 'tool-media';
  /**
   * Start of the turn (ms) that found this `tool-result` path. Audio and video only
   * count as that turn's output if the file was written at or after this time.
   */
  producedAfter?: number;
  /**
   * For Gateway-injected outgoing media (assistant-media). The Gateway emits
   * an `image` content block with a relative URL like
   * `/api/chat/media/outgoing/<sessionKey>/<attachmentId>/full`. The renderer
   * cannot reach Gateway HTTP directly (CORS / env drift), so this URL is
   * resolved through the Main-process proxy in `media:getThumbnails`, which
   * looks up `~/.openclaw/media/outgoing/records/<attachmentId>.json` and
   * loads the original file off disk.
   */
  gatewayUrl?: string;
  /** http(s) location. Never loaded by the renderer; the card only opens it externally. */
  remoteUrl?: string;
  /** Set when the Gateway delivered audio as a voice note. */
  isVoiceNote?: boolean;
}

/** Raw message from OpenClaw chat.history */
export interface RawMessage {
  role: 'user' | 'assistant' | 'system' | 'toolresult';
  content: unknown; // string | ContentBlock[]
  timestamp?: number;
  id?: string;
  /** Transcript-owner entry identity, distinct from provider or optimistic IDs. */
  __openclaw?: { id?: string; seq?: number; [key: string]: unknown };
  toolCallId?: string;
  toolName?: string;
  details?: unknown;
  isError?: boolean;
  /** R7-1 T2: true when the message was synthesized from cron run logs
   *  (session-history fallback), not read from the real chat transcript. */
  isRunLogReplay?: boolean;
  stopReason?: string;
  stop_reason?: string;
  errorMessage?: string;
  error_message?: string;
  /** Local-only: file metadata for user-uploaded attachments (not sent to/from Gateway) */
  _attachedFiles?: AttachedFileMeta[];
  /** Local-only: knowledge pages explicitly attached to this chat turn. */
  _knowledgeRefs?: ChatKnowledgeReference[];
  _knowledgeScope?: WorkspaceKnowledgeScope;
  _knowledgeMode?: KnowledgeInvocationMode;
  /** Runtime run owning the final DCS usage receipt for this user turn. */
  _knowledgeRunId?: string;
  _knowledgeRequestedCount?: number;
  /** Local-only: selected tool results folded back into visible assistant tool-call turns. */
  _toolResults?: Array<{
    toolCallId?: string;
    toolName?: string;
    isError?: boolean;
    result: unknown;
  }>;
}

/** Content block inside a message */
export interface ContentBlock {
  type:
    | 'text'
    | 'image'
    | 'thinking'
    | 'tool_use'
    | 'tool_result'
    | 'toolCall'
    | 'toolResult'
    | 'attachment'
    | 'audio'
    | 'video'
    | 'input_image'
    | 'image_url';
  text?: string;
  thinking?: string;
  source?: {
    type: string;
    media_type?: string;
    data?: string;
    url?: string;
    /** History projection removed the base64 payload; only the size survives. */
    omitted?: boolean;
    bytes?: number;
  };
  /** Flat image format from Gateway tool results (no source wrapper) */
  data?: string;
  mimeType?: string;
  /**
   * Flat URL on an `image` block. Gateway-injected assistant-media messages
   * use this shape: `{ type:'image', url:'/api/chat/media/outgoing/...', mimeType, width, height, alt, openUrl }`.
   * Neither nested `source.url` nor flat `data` is set in that case; the
   * renderer must read `block.url` directly to surface the artifact.
   */
  url?: string;
  /** Optional companion of `url` — points at a higher-resolution variant. */
  openUrl?: string;
  /** Pixel width of the original image, used for layout hints. */
  width?: number;
  /** Pixel height of the original image, used for layout hints. */
  height?: number;
  /** Human-readable filename / alt text emitted by the Gateway. */
  alt?: string;
  /** History projection removed flat image `data`; only the size survives. */
  omitted?: boolean;
  bytes?: number;
  /** `input_image` carries a string, `image_url` an OpenAI-style `{ url }`. */
  image_url?: string | { url?: string };
  /** Gateway media block: `{ type:'attachment', attachment:{ url, kind, label, ... } }`. */
  attachment?: {
    url?: string;
    kind?: string;
    label?: string;
    mimeType?: string;
    isVoiceNote?: boolean;
  };
  /** Display name on `{ type:'audio' }` blocks. */
  label?: string;
  isVoiceNote?: boolean;
  id?: string;
  name?: string;
  input?: unknown;
  arguments?: unknown;
  content?: unknown;
}

/** Session from sessions.list */
export interface ChatSession {
  key: string;
  /** Physical generation returned by the runtime session owner. */
  sessionId?: string;
  label?: string;
  displayName?: string;
  derivedTitle?: string;
  lastMessagePreview?: string;
  /** Number of user turns in the transcript, used by sidebar activity sorting. */
  messageCount?: number;
  thinkingLevel?: string;
  model?: string;
  modelRefOverride?: string;
  updatedAt?: number;
  status?: string;
  hasActiveRun?: boolean;
  parentSessionKey?: string;
  spawnedBy?: string;
  forkedFromParent?: boolean;
  /** #180: parent transcript entry id the child was branched at. */
  forkedFromLeafId?: string;
  /** #180: epoch ms of the parent message at the fork point. */
  forkedFromTimestamp?: number;
}

export interface ToolStatus {
  id?: string;
  toolCallId?: string;
  name: string;
  status: 'running' | 'completed' | 'error';
  durationMs?: number;
  summary?: string;
  updatedAt: number;
}

export interface ChatRuntimeRunState {
  runId: string;
  sessionKey?: string;
  status: 'running' | 'completed' | 'error' | 'aborted';
  startedAt?: number;
  endedAt?: number;
  assistantText: string;
  thinkingText: string;
  events: ChatRuntimeEvent[];
}

export type ChatResendUserMessageInput = {
  text: string;
  messageId?: string;
  messageIndex: number;
  sessionKey?: string;
};

/**
 * Options for `sendMessage` (Area 2 §3.2). The options-object form replaces
 * the prior 8-positional-arg signature; callers pass only the fields they need.
 */
export type SendOptions = {
  /** Send a reply to a displayed question immediately through ordinary chat.send. */
  respondToInteraction?: boolean;
  workspaceId?: string | null;
  targetSessionKey?: string;
  expectedSessionGeneration?: string;
  idempotencyKey?: string;
  handoffOperationId?: string;
  attachments?: Array<{
    fileName: string;
    mimeType: string;
    fileSize: number;
    stagedPath: string;
    preview: string | null;
  }>;
  targetAgentId?: string | null;
  knowledgeScope?: WorkspaceKnowledgeScope;
  knowledgeMode?: KnowledgeInvocationMode;
  inputMode?: 'interrupt' | 'guide' | 'queue' | 'revise-goal';
  knowledgeReferences?: ChatKnowledgeReference[];
  activeTaskNodeId?: string | null;
  /**
   * Model used by this send. The composer also saves it to the conversation
   * when persistModelSelection is set; other callers can override one send.
   * Never persisted to Agent.modelRef.
   */
  modelRefOverride?: string | null;
  /** Save the composer's visible choice before sending, including an inherited new-chat choice. */
  persistModelSelection?: boolean;
  /** Per-send reasoning effort; overrides the agent default for this turn only. */
  reasoningEffort?: AgentReasoningEffort;
  /** Per-send linked runtime intensity; when omitted the runtime derives it from reasoning effort. */
  runtimeIntensity?: RuntimeIntensityPreference;
};

/**
 * A send intent queued while a run was active (P0-2). Captures everything
 * `sendMessage` needs to re-dispatch once the run drains, without dropping the
 * user's message silently. `inputMode` is intentionally excluded — queued sends
 * are ordinary chat messages, not long-task interventions.
 */
export type PendingMessage = {
  id: string;
  text: string;
  targetAgentId: string | null;
  targetSessionKey: string | null;
  opts: Omit<SendOptions, 'inputMode'>;
};

export type ChatStartupPhase =
  | 'waiting-for-gateway'
  | 'loading-sessions'
  | 'loading-history'
  | 'ready'
  | 'error';

export interface ChatState {
  // Messages
  messages: RawMessage[];
  loading: boolean;
  historyRefreshing: boolean;
  loadingMoreHistory: boolean;
  hasMoreHistory: boolean;
  error: string | null;
  runError: string | null;
  startupPhase: ChatStartupPhase;
  startupError: string | null;

  // Streaming
  sending: boolean;
  activeRunId: string | null;
  streamingText: string;
  streamingMessage: unknown | null;
  streamingTools: ToolStatus[];
  pendingFinal: boolean;
  lastUserMessageAt: number | null;
  /** Images collected from tool results, attached to the next assistant message */
  pendingToolImages: AttachedFileMeta[];
  runtimeRuns: Record<string, ChatRuntimeRunState>;
  /**
   * Messages the user sent while a run was active (P0-2). Instead of being
   * silently dropped at the store layer, they queue here and are auto-sent when
   * the active run finishes. Each entry is a full send intent (text + options).
   */
  pendingMessages: PendingMessage[];

  // Sessions
  sessions: ChatSession[];
  currentSessionKey: string;
  /** Renderer visit identity, including same-key view resets. */
  viewRevision?: number;
  currentAgentId: string;
  /** First user message text per session key, used as display label */
  sessionLabels: Record<string, string>;
  /** Last message timestamp (ms) per session key, used for sorting */
  sessionLastActivity: Record<string, number>;
  /** Archived sessions (recycle bin) loaded from Main-process archive index */
  archivedSessions: SessionArchiveEntry[];
  pendingSessionMutations: SessionPendingMutation[];
  /** True while `loadArchivedSessions` is in flight */
  archivedSessionsLoading: boolean;

  // Thinking
  thinkingLevel: string | null;

  // Task Ledger
  activeTaskNodeId: string | null;
  taskLedgerSnapshot: TaskLedgerSnapshot | null;
  taskLedgerLoaded: boolean;

  // Actions
  hydrateStartup: () => Promise<void>;
  loadSessions: (options?: { force?: boolean }) => Promise<void>;
  switchSession: (key: string) => void;
  resetSessionView: (key?: string, options?: { deferSessionEntry?: boolean }) => void;
  clearSessionView: () => void;
  newSession: (options?: { deferSessionEntry?: boolean }) => void;
  deleteSession: (key: string) => Promise<void>;
  renameSession: (key: string, label: string) => Promise<void>;
  archiveSession: (key: string, options?: { workspaceId?: string | null; folderId?: string | null }) => Promise<void>;
  restoreSession: (sessionKey: string) => Promise<void>;
  permanentDeleteSession: (sessionKey: string) => Promise<void>;
  loadArchivedSessions: (agentId?: string) => Promise<void>;
  cleanupEmptySession: () => void;
  loadHistory: (quiet?: boolean) => Promise<void>;
  loadMoreHistory: () => Promise<void>;
  sendMessage: (text: string, opts?: SendOptions) => Promise<void>;
  resendUserMessage: (input: ChatResendUserMessageInput) => Promise<void>;
  /**
   * Queue a message while a run is active (P0-2). Replaces the old silent-drop
   * guard in `sendMessage`: the user's send intent is preserved and auto-sent
   * when the run drains.
   */
  queuePendingMessage: (text: string, opts?: SendOptions) => void;
  /**
   * Send all queued messages now that the active run finished. Called from the
   * run-finalization paths that clear `sending`.
   */
  drainPendingMessages: () => void;
  abortRun: () => Promise<boolean>;
  handleChatEvent: (event: Record<string, unknown>) => void;
  handleRuntimeEvent: (event: ChatRuntimeEvent) => void;
  refresh: () => Promise<void>;
  clearError: () => void;
  refreshTaskLedger: () => Promise<void>;
}

export const DEFAULT_CANONICAL_PREFIX = 'agent:main';
export const DEFAULT_SESSION_KEY = `${DEFAULT_CANONICAL_PREFIX}:main`;
