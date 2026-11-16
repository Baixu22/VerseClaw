import type { ChatRuntimeEvent } from '../chat-runtime-events';
import type { OfficecliInstallEvent } from '../host-api/contract';
import type { ClawGraphRunEvent, ClawGraphRunSnapshot } from '../types/clawgraph';
import type {
  LongConversationControlSignal,
  LongConversationValidationState,
} from '../types/long-task-control';
import type { MissionLifecycleEvent } from '../types/mission-control';
import type {
  ObservabilityRuntimeEvent,
  ObservabilityTrajectorySupplyEvent,
} from '../types/observability';
import type { WorkspacePreviewMode, WorkspaceWebPreviewLaunchConfig, WorkspaceWebPreviewStatus } from '../types/workspace';

/** Event fired when a user message is queued or drained (queue input-mode). */
export type ChatQueueStatusEvent = {
  sessionKey: string;
  action: 'enqueue' | 'drain';
  queueCount: number;
  queuedMessageId?: string;
  messageCount?: number;
};
import type {
  GatewayNotification,
  GatewayRuntimePayload,
  GatewayRuntimeRecord,
  GatewayStatus,
} from '../types/gateway';
export type { GatewayRuntimePayload } from '../types/gateway';

export type JsonRecord = Record<string, unknown>;

export type GatewayErrorEvent = string | { message?: string };
export type GatewayChatMessageEvent = GatewayRuntimeRecord & {
  message?: GatewayRuntimePayload;
  runId?: GatewayRuntimePayload;
};
export type GatewayChannelStatusEvent = {
  channelId: string;
  status: string;
};
export type GatewayExitEvent = number | null | { code: number | null };
export type OAuthCodeEvent =
  | {
    provider: string;
    mode: 'manual';
    authorizationUrl: string;
    message?: string;
  }
  | {
    provider: string;
    mode?: 'device';
    verificationUri: string;
    userCode: string;
    expiresIn: number;
  };
export type OAuthSuccessEvent = {
  provider: string;
  accountId: string;
  success?: boolean;
};
export type OAuthErrorEvent = {
  message: string;
};

/**
 * Runtime exec-approval boundary (ClawX bridge). The Gateway broadcasts
 * `exec.approval.requested` / `exec.approval.resolved`; ClawX projects them into
 * these two shapes so the renderer never parses raw gateway frames.
 */
export type RuntimeApprovalRequestedEvent = {
  approvalId: string;
  command: string;
  commandPreview?: string | null;
  cwd?: string | null;
  host?: string | null;
  agentId?: string | null;
  sessionKey?: string | null;
  /** Decisions the runtime will accept for this request, in runtime order. */
  allowedDecisions: string[];
  createdAtMs?: number;
  expiresAtMs?: number;
};

export type RuntimeApprovalResolvedEvent = {
  approvalId: string;
  decision: string;
  resolvedBy?: string | null;
  ts?: number;
};

export type ChannelQrEvent = {
  qr?: string;
  raw?: string;
  sessionKey?: string;
};
export type ChannelSuccessEvent = {
  accountId?: string;
  rawAccountId?: string;
  message?: string;
};
export type ChannelErrorEvent = string | { message?: string };

export type TerminalSessionEvent = {
  expectedSessionId?: string | null;
  workspaceId: string;
  sessionKey: string;
  sessionId: string;
  kind?: 'interactive' | 'webPreviewDevServer';
  cwd?: string | null;
  pid?: number | null;
  cols?: number;
  rows?: number;
  seq?: number;
  ts?: number;
  status?: 'idle' | 'starting' | 'running' | 'exited' | 'blocked';
};

export type TerminalDataEvent = TerminalSessionEvent & {
  data: string;
  seq: number;
};

export type TerminalExitEvent = TerminalSessionEvent & {
  exitCode: number | null;
  reason?: 'user-close' | 'workspace-switch' | 'workspace-delete' | 'permission-change' | 'process-exit' | 'replaced' | 'app-shutdown';
};

export type WebPreviewStatusEvent = {
  workspaceId: string;
  mode?: WorkspacePreviewMode;
  status: WorkspaceWebPreviewStatus;
  previewId?: string | null;
  previewUrl?: string | null;
  targetUrl?: string | null;
  port?: number | null;
  processSessionId?: string | null;
  launchConfig?: WorkspaceWebPreviewLaunchConfig | null;
  error?: string | null;
};

export type WebPreviewDevServerOutputEvent = WebPreviewStatusEvent & {
  data: string;
  stream?: 'stdout' | 'stderr';
  seq: number;
};

export type SubagentRuntimeLifecycleEvent = {
  runId: string;
  orchestrationRunId?: string;
  taskNodeId?: string;
  roleInstanceId?: string;
  agentId?: string;
  childRunId?: string;
  childSessionKey?: string;
  parentRunId?: string;
  sessionKey?: string;
  roleName?: string;
  task?: string;
  status: 'started' | 'accepted' | 'completed' | 'error' | 'aborted' | 'verified';
  summary?: string;
  error?: string;
  ts?: number;
};

export type TaskLoopLifecycleEvent = {
  loopRunId: string;
  sessionKey: string;
  phase:
    | 'intake'
    | 'plan'
    | 'execute'
    | 'collect_evidence'
    | 'self_check'
    | 'repair'
    | 'verify'
    | 'blocked'
    | 'complete'
    | 'error';
  status: 'running' | 'complete' | 'blocked' | 'error';
  iteration: number;
  progress: number;
  orchestrationRunId?: string;
  activeRoles?: string[];
  selfCheckDecision?: 'complete' | 'repair' | 'blocked';
  controlSignals?: LongConversationControlSignal[];
  validationState?: LongConversationValidationState;
  evidenceGate?: {
    status: 'pass' | 'repair' | 'blocked';
    reasons: string[];
    workerCount: number;
    failedWorkerCount: number;
    unverifiableWorkerCount: number;
  };
  roleQualitySummary?: {
    good: number;
    needsAttention: number;
    poorAttempt: number;
  };
  filesTouched?: string[];
  testsRun?: string[];
  blockedReason?: string;
  error?: string;
  ts: number;
};

export type ClawGraphLifecycleEvent = {
  event: ClawGraphRunEvent;
  snapshot: ClawGraphRunSnapshot;
};

export type HostEventContract = {
  gateway: {
    statusChanged: (payload: GatewayStatus) => void;
    message: (payload: unknown) => void;
    notification: (payload: GatewayNotification) => void;
    healthChanged: (payload: GatewayRuntimePayload) => void;
    presenceChanged: (payload: GatewayRuntimePayload) => void;
    chatMessage: (payload: GatewayChatMessageEvent) => void;
    channelStatus: (payload: GatewayChannelStatusEvent) => void;
    exit: (payload: GatewayExitEvent) => void;
    error: (payload: GatewayErrorEvent) => void;
  };
  chat: {
    runtimeEvent: (payload: ChatRuntimeEvent) => void;
    queueStatus: (payload: ChatQueueStatusEvent) => void;
    workspaceNavigationChanged: () => void;
  };
  subagent: {
    lifecycle: (payload: SubagentRuntimeLifecycleEvent) => void;
  };
  clawGraph: {
    lifecycle: (payload: ClawGraphLifecycleEvent) => void;
  };
  taskLoop: {
    lifecycle: (payload: TaskLoopLifecycleEvent) => void;
  };
  missionControl: {
    lifecycle: (payload: MissionLifecycleEvent) => void;
  };
  observability: {
    runtimeEvent: (payload: ObservabilityRuntimeEvent) => void;
    trajectoryEvent: (payload: ObservabilityTrajectorySupplyEvent) => void;
  };
  officeTools: {
    installEvent: (payload: OfficecliInstallEvent) => void;
  };
  oauth: {
    code: (payload: OAuthCodeEvent) => void;
    success: (payload: OAuthSuccessEvent) => void;
    error: (payload: OAuthErrorEvent) => void;
  };
  channel: {
    qr: (payload: ChannelQrEvent) => void;
    success: (payload: ChannelSuccessEvent) => void;
    error: (payload: ChannelErrorEvent) => void;
  };
  terminal: {
    registered: (payload: TerminalSessionEvent) => void;
    unregistered: (payload: TerminalExitEvent) => void;
    data: (payload: TerminalDataEvent) => void;
    exit: (payload: TerminalExitEvent) => void;
    statusChanged: (payload: TerminalSessionEvent) => void;
  };
  webPreview: {
    statusChanged: (payload: WebPreviewStatusEvent) => void;
    devServerOutput: (payload: WebPreviewDevServerOutputEvent) => void;
  };
  app: {
    windowVisibility: (visible: boolean) => void;
    navigate: (path: string) => void;
    newChat: () => void;
    openClawCliInstalled: (installedPath: string) => void;
  };
  runtimeApprovals: {
    requested: (payload: RuntimeApprovalRequestedEvent) => void;
    resolved: (payload: RuntimeApprovalResolvedEvent) => void;
  };
};

export type HostEventModule = keyof HostEventContract;
export type HostEventName<M extends HostEventModule> = keyof HostEventContract[M] & string;
export type HostEventHandler<
  M extends HostEventModule,
  E extends HostEventName<M>,
> = HostEventContract[M][E];
export type HostEventArgs<
  M extends HostEventModule,
  E extends HostEventName<M>,
> = HostEventHandler<M, E> extends (...args: infer Args) => void ? Args : never;

export const HOST_EVENT_CHANNELS = {
  gateway: {
    statusChanged: 'gateway:status-changed',
    message: 'gateway:message',
    notification: 'gateway:notification',
    healthChanged: 'gateway:health-changed',
    presenceChanged: 'gateway:presence-changed',
    chatMessage: 'gateway:chat-message',
    channelStatus: 'gateway:channel-status',
    exit: 'gateway:exit',
    error: 'gateway:error',
  },
  chat: {
    runtimeEvent: 'chat:runtime-event',
    queueStatus: 'chat:queue-status',
    workspaceNavigationChanged: 'chat:workspace-navigation-changed',
  },
  subagent: {
    lifecycle: 'agent:subagent-lifecycle',
  },
  clawGraph: {
    lifecycle: 'agent:clawgraph-lifecycle',
  },
  taskLoop: {
    lifecycle: 'agent:task-loop-lifecycle',
  },
  missionControl: {
    lifecycle: 'agent:mission-lifecycle',
  },
  observability: {
    runtimeEvent: 'observability:runtime-event',
    trajectoryEvent: 'observability:trajectory-event',
  },
  officeTools: {
    installEvent: 'office-tools:install-event',
  },
  oauth: {
    code: 'oauth:code',
    success: 'oauth:success',
    error: 'oauth:error',
  },

  terminal: {
    registered: 'terminal:registered',
    unregistered: 'terminal:unregistered',
    data: 'terminal:data',
    exit: 'terminal:exit',
    statusChanged: 'terminal:status-changed',
  },
  webPreview: {
    statusChanged: 'web-preview:status-changed',
    devServerOutput: 'web-preview:dev-server-output',
  },
  app: {
    windowVisibility: 'window:visibility',
    navigate: 'navigate',
    newChat: 'new-chat',
    openClawCliInstalled: 'openclaw:cli-installed',
  },
  runtimeApprovals: {
    requested: 'runtime-approvals:requested',
    resolved: 'runtime-approvals:resolved',
  },
} as const satisfies {
  [M in Exclude<HostEventModule, 'channel'>]: {
    [E in HostEventName<M>]: string;
  };
};

export function buildHostChannelEventName(
  channel: string,
  event: HostEventName<'channel'>,
): string {
  return `channel:${channel}-${event}`;
}
