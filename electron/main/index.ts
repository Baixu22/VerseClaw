/**
 * Electron Main Process Entry
 * Manages window creation, system tray, and IPC handlers
 */
import { app, BrowserWindow, nativeImage, session, shell } from 'electron';
import { join } from 'path';
import { GatewayManager } from '../gateway/manager';
import { registerIpcHandlers } from './ipc-handlers';
import { HostApiRegistry } from './ipc/host-invoke';
import { createTray } from './tray';
import { createMenu } from './menu';
import { registerZoomShortcuts } from './zoom-shortcuts';

import { appUpdater, registerUpdateHandlers } from './updater';
import { logger } from '../utils/logger';
import { warmupNetworkOptimization } from '../utils/uv-env';
import { initTelemetry } from '../utils/telemetry';

import { ClawHubService } from '../gateway/clawhub';
import { extensionRegistry } from '../extensions/registry';
import { loadExtensionsFromManifest } from '../extensions/loader';
import { registerAllBuiltinExtensions } from '../extensions/builtin';
import { loadExternalMainExtensions } from '../extensions/_ext-bridge.generated';
import {
  ensureVerseClawContext,
  ensureVerseClawDefaultIdentity,
  repairVerseClawOnlyBootstrapFiles,
} from '../utils/openclaw-workspace';
import { autoInstallCliIfNeeded, generateCompletionCache, installCompletionToProfile } from '../utils/openclaw-cli';
import { isQuitting, setQuitting } from './app-state';
import { getMacTrafficLightPosition, syncMacTrafficLightPosition } from './traffic-light-layout';
import { getSetting } from '../utils/store';
import { applyProxySettings } from './proxy';
import { syncLaunchAtStartupSettingFromStore } from './launch-at-startup';
import {
  clearPendingSecondInstanceFocus,
  consumeMainWindowReady,
  createMainWindowFocusState,
  requestSecondInstanceFocus,
} from './main-window-focus';
import {
  createQuitLifecycleState,
  markQuitCleanupCompleted,
  requestQuitLifecycleAction,
} from './quit-lifecycle';
import { createSignalQuitHandler } from './signal-quit';
import { acquireSingleInstanceLock } from './single-instance-lock';
import { ensureBuiltinSkillsInstalled, ensurePreinstalledSkillsInstalled, trimBundledOpenClawSkillsAndConfigs } from '../utils/skill-config';

import { deviceOAuthManager } from '../utils/device-oauth';
import { browserOAuthManager } from '../utils/browser-oauth';
import { whatsAppLoginManager } from '../utils/whatsapp-login';
import { syncAllProviderAuthToRuntime } from '../services/providers/provider-runtime-sync';
import { applyChatRuntimeEvent, enrichTraceTokenUsage } from '../services/observability-adapter';
import { resolveRemoteDebuggingLaunchPort } from '../utils/remote-control';
import { appendTaskLedgerEvents } from '../services/task-ledger-service';
import type { TaskLedgerEventInput, TaskLedgerNodeStatus } from '../../shared/types/task-ledger';
import type { ClawGraphRunEvent, ClawGraphRunSnapshot } from '../../shared/types/clawgraph';
import type {
  LongConversationControlSignal,
  LongConversationValidationState,
} from '../../shared/types/long-task-control';
import type { MissionLifecycleEvent } from '../../shared/types/mission-control';

const WINDOWS_APP_USER_MODEL_ID = 'app.verse-claw.desktop';
const isE2EMode = process.env.VERSE_CLAW_E2E === '1';
const requestedUserDataDir = process.env.VERSE_CLAW_USER_DATA_DIR?.trim();
const requestedRemoteDebuggingPort = resolveRemoteDebuggingLaunchPort(app);

if (requestedRemoteDebuggingPort != null) {
  app.commandLine.appendSwitch('remote-debugging-port', String(requestedRemoteDebuggingPort));
}

if (requestedUserDataDir) {
  app.setPath('userData', requestedUserDataDir);
}

// Disable GPU hardware acceleration globally for maximum stability across
// all GPU configurations (no GPU, integrated, discrete).
//
// Rationale (following VS Code's philosophy):
// - Page/file loading is async data fetching — zero GPU dependency.
// - The original per-platform GPU branching was added to avoid CPU rendering
//   competing with sync I/O on Windows, but all file I/O is now async
//   (fs/promises), so that concern no longer applies.
// - Software rendering is deterministic across all hardware; GPU compositing
//   behaviour varies between vendors (Intel, AMD, NVIDIA, Apple Silicon) and
//   driver versions, making it the #1 source of rendering bugs in Electron.
//
// Users who want GPU acceleration can pass `--enable-gpu` on the CLI or
// set `"disable-hardware-acceleration": false` in the app config (future).
app.disableHardwareAcceleration();

// On Linux, set CHROME_DESKTOP so Chromium can find the correct .desktop file.
// On Wayland this maps the running window to clawx.desktop (→ icon + app grouping);
// on X11 it supplements the StartupWMClass matching.
// Must be called before app.whenReady() / before any window is created.
if (process.platform === 'linux') {
  const linuxApp = app as typeof app & { setDesktopName?: (desktopName: string) => void };
  linuxApp.setDesktopName?.('verse-claw.desktop');
}

// Prevent multiple instances of the app from running simultaneously.
// Without this, two instances each spawn their own gateway process on the
// same port, then each treats the other's gateway as "orphaned" and kills
// it — creating an infinite kill/restart loop on Windows.
// The losing process must exit immediately so it never reaches Gateway startup.
const singleInstanceLock = acquireSingleInstanceLock({
  isE2EMode,
  userDataDir: app.getPath('userData'),
  lockName: 'verse-claw',
});
const releaseProcessInstanceFileLock = singleInstanceLock.release;
const gotTheLock = singleInstanceLock.gotTheLock;
if (!gotTheLock) {
  app.exit(0);
}

// Global references
let mainWindow: BrowserWindow | null = null;
let gatewayManager!: GatewayManager;
let clawHubService!: ClawHubService;
const hostApiRegistry = new HostApiRegistry();
const mainWindowFocusState = createMainWindowFocusState();
const quitLifecycleState = createQuitLifecycleState();
const taskLoopLedgerSeen = new Set<string>();
const missionLedgerSeen = new Set<string>();
const clawGraphLedgerSeen = new Set<string>();

type TaskLoopLifecyclePayload = {
  loopRunId?: string;
  sessionKey?: string;
  phase?: string;
  status?: string;
  iteration?: number;
  progress?: number;
  orchestrationRunId?: string;
  selfCheckDecision?: string;
  controlSignals?: LongConversationControlSignal[];
  validationState?: LongConversationValidationState;
  evidenceGate?: {
    status?: string;
    reasons?: string[];
    workerCount?: number;
    failedWorkerCount?: number;
    unverifiableWorkerCount?: number;
  };
  roleQualitySummary?: {
    good?: number;
    needsAttention?: number;
    poorAttempt?: number;
  };
  filesTouched?: string[];
  testsRun?: string[];
  blockedReason?: string;
  error?: string;
  ts?: number;
};

function controlSignalTags(signals?: readonly LongConversationControlSignal[]): string[] {
  return [...new Set((signals ?? []).map((signal) => signal.kind.replace(/_/g, '-')))];
}

function evidenceGateTags(gate?: TaskLoopLifecyclePayload['evidenceGate']): string[] {
  if (!gate?.status) return [];
  return [
    `evidence-gate-${gate.status}`,
    ...((gate.reasons ?? []).map((reason) => `gate-${reason.replace(/[^a-zA-Z0-9-]+/g, '-').toLowerCase()}`)),
  ].slice(0, 8);
}

function hasBlockingControlSignal(signals?: readonly LongConversationControlSignal[]): boolean {
  return (signals ?? []).some((signal) => signal.severity === 'blocking');
}

function longConversationControlMetadata(input: {
  controlSignals?: LongConversationControlSignal[];
  validationState?: LongConversationValidationState;
  evidenceGate?: TaskLoopLifecyclePayload['evidenceGate'];
  roleQualitySummary?: TaskLoopLifecyclePayload['roleQualitySummary'];
  filesTouched?: string[];
  testsRun?: string[];
  blockedReason?: string;
}): Record<string, unknown> {
  return {
    controlSignals: input.controlSignals ?? [],
    ...(input.validationState ? { validationState: input.validationState } : {}),
    ...(input.evidenceGate ? { evidenceGate: input.evidenceGate } : {}),
    ...(input.roleQualitySummary ? { roleQualitySummary: input.roleQualitySummary } : {}),
    ...(input.filesTouched?.length ? { filesTouched: input.filesTouched } : {}),
    ...(input.testsRun?.length ? { testsRun: input.testsRun } : {}),
    ...(input.blockedReason ? { blockedReason: input.blockedReason } : {}),
  };
}

function taskLoopLedgerStatus(status?: string): TaskLedgerNodeStatus {
  if (status === 'complete') return 'done';
  if (status === 'blocked' || status === 'error') return 'blocked';
  return 'doing';
}

function taskLoopLedgerTimestamp(payload: TaskLoopLifecyclePayload): string {
  const ts = typeof payload.ts === 'number' && Number.isFinite(payload.ts) ? payload.ts : Date.now();
  return new Date(ts).toISOString();
}

async function recordTaskLoopLedgerLifecycle(payload: unknown): Promise<void> {
  if (!payload || typeof payload !== 'object') return;
  const event = payload as TaskLoopLifecyclePayload;
  const loopRunId = event.loopRunId?.trim();
  if (!loopRunId) return;

  const createdAt = taskLoopLedgerTimestamp(event);
  const goalId = `task-loop:${loopRunId}:goal`;
  const taskId = `task-loop:${loopRunId}:task`;
  const checkId = `task-loop:${loopRunId}:check`;
  const reviewId = `task-loop:${loopRunId}:review`;
  const status = taskLoopLedgerStatus(event.status);
  const evidenceRefs = event.orchestrationRunId
    ? [{ type: 'trace' as const, ref: event.orchestrationRunId, label: 'Task-loop orchestration trace' }]
    : [];
  const events: TaskLedgerEventInput[] = [];

  if (!taskLoopLedgerSeen.has(loopRunId)) {
    taskLoopLedgerSeen.add(loopRunId);
    events.push(
      {
        id: `task-loop:${loopRunId}:goal-created`,
        type: 'node_created',
        actor: 'system',
        taskId: goalId,
        sessionId: event.sessionKey ?? null,
        payload: {
          node: {
            id: goalId,
            title: `Task loop ${loopRunId}`,
            kind: 'goal',
            status: 'doing',
            owner: 'agent',
            priority: 'normal',
            tags: ['task-loop'],
            description: 'Runtime-controlled agent task loop.',
            evidenceRefs,
            metadata: { loopRunId },
            createdAt,
            updatedAt: createdAt,
          },
        },
      },
      {
        id: `task-loop:${loopRunId}:task-created`,
        type: 'node_created',
        actor: 'system',
        taskId,
        sessionId: event.sessionKey ?? null,
        payload: {
          node: {
            id: taskId,
            title: 'Run bounded orchestration loop',
            kind: 'task',
            parentId: goalId,
            status: 'doing',
            owner: 'agent',
            tags: ['task-loop', ...evidenceGateTags(event.evidenceGate)],
            progress: event.progress ?? 0,
            evidenceRefs,
            metadata: {
              loopRunId,
              phase: event.phase,
              iteration: event.iteration,
              longConversationControl: longConversationControlMetadata(event),
            },
            createdAt,
            updatedAt: createdAt,
          },
        },
      },
      {
        id: `task-loop:${loopRunId}:session-linked`,
        type: 'session_linked',
        actor: 'system',
        taskId,
        sessionId: event.sessionKey ?? null,
        payload: {
          sessionLink: {
            id: `task-loop:${loopRunId}:session`,
            sessionKey: event.sessionKey ?? '',
            nodeId: taskId,
            traceId: event.orchestrationRunId ?? null,
            summary: 'Task-loop runtime evidence',
            createdAt,
          },
        },
      },
    );
  }

  events.push(
    {
      id: `task-loop:${loopRunId}:goal-progress:${event.phase ?? 'unknown'}:${event.iteration ?? 0}:${event.status ?? 'running'}`,
      type: 'progress_changed',
      actor: 'system',
      taskId: goalId,
      sessionId: event.sessionKey ?? null,
      payload: {
        nodeId: goalId,
        progress: event.progress ?? (status === 'done' || status === 'blocked' ? 100 : undefined),
      },
    },
    {
      id: `task-loop:${loopRunId}:goal-status:${event.status ?? 'running'}`,
      type: 'status_changed',
      actor: 'system',
      taskId: goalId,
      sessionId: event.sessionKey ?? null,
      payload: {
        nodeId: goalId,
        status,
      },
    },
    {
      id: `task-loop:${loopRunId}:progress:${event.phase ?? 'unknown'}:${event.iteration ?? 0}:${event.status ?? 'running'}`,
      type: 'progress_changed',
      actor: 'system',
      taskId,
      sessionId: event.sessionKey ?? null,
      payload: {
        nodeId: taskId,
        progress: event.progress ?? (status === 'done' || status === 'blocked' ? 100 : undefined),
      },
    },
    {
      id: `task-loop:${loopRunId}:status:${event.status ?? 'running'}`,
      type: 'status_changed',
      actor: 'system',
      taskId,
      sessionId: event.sessionKey ?? null,
      payload: {
        nodeId: taskId,
        status,
      },
    },
  );

  if (event.phase === 'self_check' || event.selfCheckDecision) {
    events.push({
      id: `task-loop:${loopRunId}:check:${event.iteration ?? 0}`,
      type: 'node_created',
      actor: 'system',
      taskId: checkId,
      sessionId: event.sessionKey ?? null,
      payload: {
        node: {
          id: checkId,
          title: 'Collect self-check evidence',
          kind: 'check',
          parentId: taskId,
          status: event.selfCheckDecision ? 'done' : 'doing',
          owner: 'agent',
          tags: ['task-loop', 'self-check', ...controlSignalTags(event.controlSignals), ...evidenceGateTags(event.evidenceGate)],
          evidenceRefs,
          metadata: {
            loopRunId,
            iteration: event.iteration,
            phase: event.phase,
            selfCheckDecision: event.selfCheckDecision,
            longConversationControl: longConversationControlMetadata(event),
          },
          createdAt,
          updatedAt: createdAt,
        },
      },
    });
  }

  if (event.selfCheckDecision) {
    events.push({
      id: `task-loop:${loopRunId}:review:${event.selfCheckDecision}`,
      type: 'node_created',
      actor: 'system',
      taskId: reviewId,
      sessionId: event.sessionKey ?? null,
      payload: {
        node: {
          id: reviewId,
          title: `Self-check decision: ${event.selfCheckDecision}`,
          kind: 'review',
          parentId: taskId,
          status: event.selfCheckDecision === 'complete' && !hasBlockingControlSignal(event.controlSignals)
            ? 'done'
            : event.selfCheckDecision === 'blocked'
              ? 'blocked'
              : 'review',
          owner: 'agent',
          tags: ['task-loop', 'self-check', ...controlSignalTags(event.controlSignals), ...evidenceGateTags(event.evidenceGate)],
          description: event.error ?? event.blockedReason ?? event.evidenceGate?.reasons?.join('; '),
          evidenceRefs,
          metadata: {
            loopRunId,
            phase: event.phase,
            iteration: event.iteration,
            selfCheckDecision: event.selfCheckDecision,
            longConversationControl: longConversationControlMetadata(event),
          },
          createdAt,
          updatedAt: createdAt,
        },
      },
    });
  }

  await appendTaskLedgerEvents(undefined, events, `task-loop:${loopRunId}`);
}

function missionLedgerStatus(status?: MissionLifecycleEvent['status']): TaskLedgerNodeStatus {
  if (status === 'complete') return 'done';
  if (status === 'ask_user') return 'review';
  if (status === 'blocked' || status === 'error') return 'blocked';
  if (status === 'cancelled') return 'dropped';
  return 'doing';
}

function missionLedgerTimestamp(payload: MissionLifecycleEvent): string {
  const ts = typeof payload.ts === 'number' && Number.isFinite(payload.ts) ? payload.ts : Date.now();
  return new Date(ts).toISOString();
}

async function recordMissionLedgerLifecycle(payload: unknown): Promise<void> {
  if (!payload || typeof payload !== 'object') return;
  const event = payload as MissionLifecycleEvent;
  const missionId = event.missionId?.trim();
  if (!missionId) return;

  const createdAt = missionLedgerTimestamp(event);
  const workspaceId = event.workspaceId?.trim() || undefined;
  const goalId = `mission:${missionId}:goal`;
  const taskId = `mission:${missionId}:task`;
  const checkId = `mission:${missionId}:check`;
  const reviewId = `mission:${missionId}:review`;
  const status = missionLedgerStatus(event.status);
  const evidenceRefs = [
    ...(event.traceId ? [{ type: 'trace' as const, ref: event.traceId, label: 'Mission trace' }] : []),
    ...(event.taskLoopRunId ? [{ type: 'tool' as const, ref: event.taskLoopRunId, label: 'Inner task_loop run' }] : []),
  ];
  const events: TaskLedgerEventInput[] = [];

  if (!missionLedgerSeen.has(missionId)) {
    missionLedgerSeen.add(missionId);
    events.push(
      {
        id: `mission:${missionId}:goal-created`,
        type: 'node_created',
        actor: 'system',
        taskId: goalId,
        sessionId: event.sessionKey,
        payload: {
          node: {
            id: goalId,
            title: `Mission Control ${missionId}`,
            kind: 'goal',
            status: 'doing',
            owner: 'agent',
            priority: 'normal',
            tags: ['mission-control'],
            description: 'Runtime-controlled long-goal Mission Loop.',
            evidenceRefs,
            metadata: { missionId },
            createdAt,
            updatedAt: createdAt,
          },
        },
      },
      {
        id: `mission:${missionId}:task-created`,
        type: 'node_created',
        actor: 'system',
        taskId,
        sessionId: event.sessionKey,
        payload: {
          node: {
            id: taskId,
            title: 'Run Mission Loop ticks',
            kind: 'task',
            parentId: goalId,
            status: 'doing',
            owner: 'agent',
            tags: ['mission-control', 'mission-loop'],
            progress: event.progress ?? 0,
            evidenceRefs,
            metadata: { missionId, phase: event.phase, tick: event.tick },
            createdAt,
            updatedAt: createdAt,
          },
        },
      },
      {
        id: `mission:${missionId}:session-linked`,
        type: 'session_linked',
        actor: 'system',
        taskId,
        sessionId: event.sessionKey,
        payload: {
          sessionLink: {
            id: `mission:${missionId}:session`,
            sessionKey: event.sessionKey,
            nodeId: taskId,
            agentId: event.agentId ?? null,
            traceId: event.traceId ?? null,
            summary: 'Mission Control runtime evidence',
            createdAt,
          },
        },
      },
    );
  }

  events.push(
    {
      id: `mission:${missionId}:goal-progress:${event.phase}:${event.tick}:${event.status}`,
      type: 'progress_changed',
      actor: 'system',
      taskId: goalId,
      sessionId: event.sessionKey,
      payload: {
        nodeId: goalId,
        progress: event.progress ?? (status === 'done' || status === 'blocked' ? 100 : undefined),
      },
    },
    {
      id: `mission:${missionId}:goal-status:${event.status}`,
      type: 'status_changed',
      actor: 'system',
      taskId: goalId,
      sessionId: event.sessionKey,
      payload: { nodeId: goalId, status },
    },
    {
      id: `mission:${missionId}:task-progress:${event.phase}:${event.tick}:${event.status}`,
      type: 'progress_changed',
      actor: 'system',
      taskId,
      sessionId: event.sessionKey,
      payload: {
        nodeId: taskId,
        progress: event.progress ?? (status === 'done' || status === 'blocked' ? 100 : undefined),
      },
    },
    {
      id: `mission:${missionId}:task-status:${event.status}`,
      type: 'status_changed',
      actor: 'system',
      taskId,
      sessionId: event.sessionKey,
      payload: { nodeId: taskId, status },
    },
  );

  if (event.phase === 'checkpoint' || event.phase === 'reflect' || event.reviewerDecision) {
    const isMilestone = event.phase === 'checkpoint';
    events.push({
      id: `mission:${missionId}:check:${event.tick}:${event.phase}`,
      type: 'node_created',
      actor: 'system',
      taskId: checkId,
      sessionId: event.sessionKey,
      payload: {
        node: {
          id: checkId,
          title: isMilestone ? `Mission checkpoint @ tick ${event.tick}` : 'Collect Mission evidence',
          kind: isMilestone ? 'milestone' : 'check',
          parentId: taskId,
          status: event.reviewerDecision ? 'done' : 'doing',
          owner: 'agent',
          tags: ['mission-control', 'evidence', ...controlSignalTags(event.controlSignals)],
          evidenceRefs,
          metadata: {
            missionId,
            phase: event.phase,
            tick: event.tick,
            reviewerDecision: event.reviewerDecision,
            longConversationControl: longConversationControlMetadata(event),
          },
          createdAt,
          updatedAt: createdAt,
        },
      },
    });
  }

  if (event.reviewerDecision || event.blockedReason || event.error) {
    events.push({
      id: `mission:${missionId}:review:${event.tick}:${event.reviewerDecision ?? event.status}`,
      type: 'node_created',
      actor: 'system',
      taskId: reviewId,
      sessionId: event.sessionKey,
      payload: {
        node: {
          id: reviewId,
          title: `Mission decision: ${event.reviewerDecision ?? event.status}`,
          kind: 'review',
          parentId: taskId,
          status: event.reviewerDecision === 'complete' && !hasBlockingControlSignal(event.controlSignals)
            ? 'done'
            : status,
          owner: 'agent',
          tags: ['mission-control', 'review', ...controlSignalTags(event.controlSignals)],
          description: event.blockedReason ?? event.error,
          evidenceRefs,
          metadata: {
            missionId,
            phase: event.phase,
            tick: event.tick,
            reviewerDecision: event.reviewerDecision,
            nextWakeAt: event.nextWakeAt,
            longConversationControl: longConversationControlMetadata(event),
          },
          createdAt,
          updatedAt: createdAt,
        },
      },
    });
  }

  await appendTaskLedgerEvents(workspaceId, events, `mission:${missionId}`);
}

type ClawGraphLifecyclePayload = {
  event?: ClawGraphRunEvent;
  snapshot?: ClawGraphRunSnapshot;
};

function clawGraphLedgerStatus(status?: string): TaskLedgerNodeStatus {
  if (status === 'complete') return 'done';
  if (status === 'review') return 'review';
  if (status === 'blocked' || status === 'failed' || status === 'aborted') return 'blocked';
  return 'doing';
}

async function recordClawGraphLedgerLifecycle(payload: unknown): Promise<void> {
  if (!payload || typeof payload !== 'object') return;
  const { event, snapshot } = payload as ClawGraphLifecyclePayload;
  const runId = snapshot?.runId?.trim() || event?.runId?.trim();
  if (!runId || !snapshot || !event) return;

  const createdAt = new Date(
    typeof event.createdAt === 'number' && Number.isFinite(event.createdAt)
      ? event.createdAt
      : Date.now(),
  ).toISOString();
  const workspaceId = snapshot.workspaceId ?? undefined;
  const goalId = `clawgraph:${runId}:goal`;
  const status = clawGraphLedgerStatus(snapshot.status);
  const evidenceRefs = [
    { type: 'other' as const, ref: runId, label: 'ClawGraph run' },
    ...(snapshot.sourcePath ? [{ type: 'file' as const, ref: snapshot.sourcePath, label: 'Workflow YAML' }] : []),
  ];
  const events: TaskLedgerEventInput[] = [];

  if (!clawGraphLedgerSeen.has(runId)) {
    clawGraphLedgerSeen.add(runId);
    events.push(
      {
        id: `clawgraph:${runId}:goal-created`,
        type: 'node_created',
        actor: 'system',
        taskId: goalId,
        sessionId: snapshot.sessionKey ?? null,
        payload: {
          node: {
            id: goalId,
            title: snapshot.title || `ClawGraph ${snapshot.workflowId}`,
            kind: 'goal',
            status: 'doing',
            owner: 'agent',
            priority: 'normal',
            tags: ['clawgraph', snapshot.workflowId],
            description: snapshot.objective,
            progress: snapshot.progress,
            evidenceRefs,
            metadata: {
              runId,
              workflowId: snapshot.workflowId,
              sourcePath: snapshot.sourcePath,
            },
            createdAt,
            updatedAt: createdAt,
          },
        },
      },
      {
        id: `clawgraph:${runId}:session-linked`,
        type: 'session_linked',
        actor: 'system',
        taskId: goalId,
        sessionId: snapshot.sessionKey ?? null,
        payload: {
          sessionLink: {
            id: `clawgraph:${runId}:session`,
            sessionKey: snapshot.sessionKey ?? '',
            nodeId: goalId,
            traceId: runId,
            summary: 'ClawGraph runtime evidence',
            createdAt,
          },
        },
      },
    );
  }

  events.push(
    {
      id: `clawgraph:${runId}:progress:${event.id}`,
      type: 'progress_changed',
      actor: 'system',
      taskId: goalId,
      sessionId: snapshot.sessionKey ?? null,
      payload: { nodeId: goalId, progress: snapshot.progress },
    },
    {
      id: `clawgraph:${runId}:status:${event.id}`,
      type: 'status_changed',
      actor: 'system',
      taskId: goalId,
      sessionId: snapshot.sessionKey ?? null,
      payload: { nodeId: goalId, status },
    },
  );

  if (event.type === 'review_requested') {
    const review = snapshot.reviewItems.find((item) => item.nodeId === event.nodeId && item.status === 'open')
      ?? snapshot.reviewItems.find((item) => item.status === 'open');
    const reviewId = `clawgraph:${runId}:review:${review?.id ?? event.id}`;
    events.push(
      {
        id: `${reviewId}:node-created`,
        type: 'node_created',
        actor: 'system',
        taskId: reviewId,
        sessionId: snapshot.sessionKey ?? null,
        payload: {
          node: {
            id: reviewId,
            title: review?.title ?? `Review ${event.nodeId ?? runId}`,
            kind: 'review',
            parentId: goalId,
            status: 'review',
            owner: 'agent',
            priority: 'high',
            tags: ['clawgraph', 'review'],
            description: review?.reason ?? event.message,
            evidenceRefs,
            metadata: {
              runId,
              reviewId: review?.id,
              nodeId: event.nodeId,
              kind: review?.kind,
            },
            createdAt,
            updatedAt: createdAt,
          },
        },
      },
      {
        id: `${reviewId}:requested`,
        type: 'review_requested',
        actor: 'system',
        taskId: reviewId,
        sessionId: snapshot.sessionKey ?? null,
        payload: { nodeId: reviewId, reviewReason: review?.reason ?? event.message },
      },
    );
  }

  await appendTaskLedgerEvents(workspaceId, events, `clawgraph:${runId}:${event.id}`);
}

function sendMainWindowEvent(channel: string, payload: unknown): void {
  const win = mainWindow;
  if (!win || win.isDestroyed()) return;
  win.webContents.send(channel, payload);
}

/**
 * Resolve the icons directory path (works in both dev and packaged mode)
 */
function getIconsDir(): string {
  if (app.isPackaged) {
    // Packaged: icons are in extraResources → process.resourcesPath/resources/icons
    return join(process.resourcesPath, 'resources', 'icons');
  }
  // Development: relative to dist-electron/main/
  return join(__dirname, '../../resources/icons');
}

/**
 * Get the app icon for the current platform
 */
function getAppIcon(): Electron.NativeImage | undefined {
  if (process.platform === 'darwin') return undefined; // macOS uses the app bundle icon

  const iconsDir = getIconsDir();
  const iconPath =
    process.platform === 'win32'
      ? join(iconsDir, 'icon.ico')
      : join(iconsDir, 'icon.png');
  const icon = nativeImage.createFromPath(iconPath);
  return icon.isEmpty() ? undefined : icon;
}

/**
 * Create the main application window
 */
function createWindow(): BrowserWindow {
  const isMac = process.platform === 'darwin';
  const isWindows = process.platform === 'win32';
  const useCustomTitleBar = isWindows;
  const shouldSkipSetupForE2E = process.env.VERSE_CLAW_E2E_SKIP_SETUP === '1';

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    icon: getAppIcon(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webviewTag: true, // Enable <webview> for embedding OpenClaw Control UI
    },
    titleBarStyle: isMac ? 'hiddenInset' : useCustomTitleBar ? 'hidden' : 'default',
    trafficLightPosition: isMac
      ? getMacTrafficLightPosition(false)
      : undefined,
    frame: isMac || !useCustomTitleBar,
    show: false,
  });

  registerZoomShortcuts(win);
  if (app.isPackaged) {
    win.webContents.closeDevTools();
    win.webContents.on('before-input-event', (event, input) => {
      if (input.key === 'F12' || (input.control && input.shift && input.key?.toUpperCase() === 'I')) {
        event.preventDefault();
      }
    });
  }

  // Handle external links — only allow safe protocols to prevent arbitrary
  // command execution via shell.openExternal() (e.g. file://, ms-msdt:, etc.)
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        shell.openExternal(url);
      } else {
        logger.warn(`Blocked openExternal for disallowed protocol: ${parsed.protocol}`);
      }
    } catch {
      logger.warn(`Blocked openExternal for malformed URL: ${url}`);
    }
    return { action: 'deny' };
  });

  // Load the app
  if (process.env.VITE_DEV_SERVER_URL) {
    const rendererUrl = new URL(process.env.VITE_DEV_SERVER_URL);
    if (shouldSkipSetupForE2E) {
      rendererUrl.searchParams.set('e2eSkipSetup', '1');
    }
    win.loadURL(rendererUrl.toString());
    if (!isE2EMode) {
      win.webContents.openDevTools();
    }
  } else {
    win.loadFile(join(__dirname, '../../dist/index.html'), {
      query: shouldSkipSetupForE2E
        ? { e2eSkipSetup: '1' }
        : undefined,
    });
  }

  return win;
}

function focusWindow(win: BrowserWindow): void {
  if (win.isDestroyed()) {
    return;
  }

  if (win.isMinimized()) {
    win.restore();
  }

  win.show();
  win.focus();
}

function focusMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  clearPendingSecondInstanceFocus(mainWindowFocusState);
  focusWindow(mainWindow);
}

function createMainWindow(): BrowserWindow {
  const win = createWindow();

  win.once('ready-to-show', () => {
    if (mainWindow !== win) {
      return;
    }

    if (process.platform === 'darwin') {
      void getSetting('sidebarCollapsed').then((sidebarCollapsed) => {
        syncMacTrafficLightPosition(win, sidebarCollapsed);
      });
    }

    const action = consumeMainWindowReady(mainWindowFocusState);
    if (action === 'focus') {
      focusWindow(win);
      return;
    }

    win.show();
  });

  win.on('close', (event) => {
    if (!isQuitting() && !isE2EMode) {
      event.preventDefault();
      win.hide();
    }
  });

  win.on('closed', () => {
    if (mainWindow === win) {
      mainWindow = null;
    }
  });

  mainWindow = win;
  return win;
}

/**
 * Initialize the application
 */
async function initialize(): Promise<void> {
  // Initialize logger first
  logger.init();
  logger.info('=== Verse Claw Application Starting ===');
  logger.debug(
    `Runtime: platform=${process.platform}/${process.arch}, electron=${process.versions.electron}, node=${process.versions.node}, packaged=${app.isPackaged}, pid=${process.pid}, ppid=${process.ppid}`
  );

  if (!isE2EMode) {
    // Warm up network optimization (non-blocking)
    void warmupNetworkOptimization();

    // Initialize Telemetry early
    await initTelemetry();

    // Apply persisted proxy settings before creating windows or network requests.
    await applyProxySettings();
    await syncLaunchAtStartupSettingFromStore();
  } else {
    logger.info('Running in E2E mode: startup side effects minimized');
  }

  // Set application menu
  await createMenu();

  // Create the main window
  const window = createMainWindow();

  // Create system tray
  if (!isE2EMode) {
    createTray(window);
  }

  // Override security headers ONLY for the OpenClaw Gateway Control UI.
  // The URL filter ensures this callback only fires for gateway requests,
  // avoiding unnecessary overhead on every other HTTP response.
  session.defaultSession.webRequest.onHeadersReceived(
    { urls: ['http://127.0.0.1:18789/*', 'http://localhost:18789/*'] },
    (details, callback) => {
      const headers = { ...details.responseHeaders };
      delete headers['X-Frame-Options'];
      delete headers['x-frame-options'];
      if (headers['Content-Security-Policy']) {
        headers['Content-Security-Policy'] = headers['Content-Security-Policy'].map(
          (csp) => csp.replace(/frame-ancestors\s+'none'/g, "frame-ancestors 'self' *")
        );
      }
      if (headers['content-security-policy']) {
        headers['content-security-policy'] = headers['content-security-policy'].map(
          (csp) => csp.replace(/frame-ancestors\s+'none'/g, "frame-ancestors 'self' *")
        );
      }
      callback({ responseHeaders: headers });
    },
  );

  // Register IPC handlers
  registerIpcHandlers(gatewayManager, clawHubService, window, hostApiRegistry);

  // Initialize extension system
  await extensionRegistry.initialize({
    gatewayManager,
    getMainWindow: () => mainWindow,
    hostApi: {
      register: (extensionId, contributions) => (
        hostApiRegistry.registerExtensionContributions(extensionId, contributions)
      ),
    },
  });

  // Wire marketplace provider to ClawHubService if an extension provides one
  const marketplaceProvider = extensionRegistry.getMarketplaceProvider();
  if (marketplaceProvider) {
    clawHubService.setMarketplaceProvider(marketplaceProvider);
  }

  // Register update handlers
  registerUpdateHandlers(appUpdater, window);

  // Note: Auto-check for updates is driven by the renderer (update store init)
  // so it respects the user's "Auto-check for updates" setting.

  // Seed a stable default IDENTITY.md before the Gateway initializes the
  // workspace so Verse Claw desktop sessions skip OpenClaw's chat-first bootstrap.
  if (!isE2EMode) {
    void ensureVerseClawDefaultIdentity().catch((error) => {
      logger.warn('Failed to seed default Verse Claw identity:', error);
    });
  }

  // Repair any bootstrap files that only contain Verse Claw markers (no OpenClaw
  // template content). This fixes a race condition where ensureVerseClawContext()
  // previously created the file before the gateway could seed the full template.
  if (!isE2EMode) {
    void repairVerseClawOnlyBootstrapFiles().catch((error) => {
      logger.warn('Failed to repair bootstrap files:', error);
    });
  }

  // Pre-deploy built-in skills (feishu-doc, feishu-drive, feishu-perm, feishu-wiki)
  // to ~/.openclaw/skills/ so they are immediately available without manual install.
  if (!isE2EMode) {
    void ensureBuiltinSkillsInstalled().catch((error) => {
      logger.warn('Failed to install built-in skills:', error);
    });
  }

  // Keep community builds aligned with Clawx-biz by physically trimming
  // bundled OpenClaw consumer skills on startup (dev + packaged), keeping only
  // `skill-creator`. This also prunes stale openclaw.json entries for trimmed
  // bundled skills so we do not keep `enabled: false` config for skills that no
  // longer exist.
  if (!isE2EMode) {
    void trimBundledOpenClawSkillsAndConfigs().then(({ removed, removedConfigs, kept }) => {
      if (removed > 0 || removedConfigs > 0) {
        logger.info(
          `Trimmed bundled OpenClaw skills: removed ${removed}, pruned configs ${removedConfigs}, kept ${kept.join(', ')}`,
        );
      }
    });
  }

  // Pre-deploy bundled third-party skills from resources/preinstalled-skills.
  // This installs full skill directories (not only SKILL.md) in an idempotent,
  // non-destructive way and never blocks startup.
  if (!isE2EMode) {
    void ensurePreinstalledSkillsInstalled().catch((error) => {
      logger.warn('Failed to install preinstalled skills:', error);
    });
  }

  // Plugin installation is now configuration-driven:
  // - When a channel is added via UI: ensureXxxPluginInstalled() in IPC handlers
  // - When Gateway starts: ensureConfiguredPluginsUpgraded() in config-sync.ts
  // No need to pre-install all bundled plugins at app startup.

  // Bridge gateway and host-side events before any auto-start logic runs, so
  // renderer subscribers observe the full startup lifecycle.
  gatewayManager.on('status', (status: { state: string }) => {
    sendMainWindowEvent('gateway:status-changed', status);
    if (status.state === 'running' && !isE2EMode) {
      void ensureVerseClawContext().catch((error) => {
        logger.warn('Failed to re-merge Verse Claw context after gateway reconnect:', error);
      });
    }
  });

  gatewayManager.on('error', (error) => {
    sendMainWindowEvent('gateway:error', { message: error.message });
  });

  gatewayManager.on('notification', (notification) => {
    sendMainWindowEvent('gateway:notification', notification);
  });

  gatewayManager.on('gateway:health', (data) => {
    sendMainWindowEvent('gateway:health-changed', data);
  });

  gatewayManager.on('gateway:presence', (data) => {
    sendMainWindowEvent('gateway:presence-changed', data);
  });

  gatewayManager.on('chat:message', (data) => {
    sendMainWindowEvent('gateway:chat-message', data);
  });

  gatewayManager.on('chat:runtime-event', (data) => {
    const observabilityEvent = applyChatRuntimeEvent(data);
    sendMainWindowEvent('chat:runtime-event', data);
    if (observabilityEvent) {
      sendMainWindowEvent('observability:runtime-event', observabilityEvent);
    }
    if (data && typeof data === 'object' && 'type' in data && data.type === 'run.ended') {
      enrichTraceTokenUsage(data as any).then((enrichedEvent) => {
        if (enrichedEvent) sendMainWindowEvent('observability:runtime-event', enrichedEvent);
      }).catch(() => {});
    }
  });

  gatewayManager.on('channel:status', (data) => {
    sendMainWindowEvent('gateway:channel-status', data);
  });

  gatewayManager.on('subagent:lifecycle', (data) => {
    sendMainWindowEvent('agent:subagent-lifecycle', data);
  });

  gatewayManager.on('clawgraph:lifecycle', (data) => {
    sendMainWindowEvent('agent:clawgraph-lifecycle', data);
    recordClawGraphLedgerLifecycle(data).catch((error) => {
      logger.warn('clawgraph: failed to write task ledger lifecycle evidence', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  });

  gatewayManager.on('task-loop:lifecycle', (data) => {
    sendMainWindowEvent('agent:task-loop-lifecycle', data);
    recordTaskLoopLedgerLifecycle(data).catch((error) => {
      logger.warn('task-loop: failed to write task ledger lifecycle evidence', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  });

  gatewayManager.on('mission:lifecycle', (data) => {
    sendMainWindowEvent('agent:mission-lifecycle', data);
    recordMissionLedgerLifecycle(data).catch((error) => {
      logger.warn('mission-control: failed to write task ledger lifecycle evidence', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  });

  gatewayManager.on('chat:queue-status', (data) => {
    sendMainWindowEvent('chat:queue-status', data);
  });

  gatewayManager.on('exit', (code) => {
    sendMainWindowEvent('gateway:exit', { code });
  });

  deviceOAuthManager.on('oauth:code', (payload) => {
    sendMainWindowEvent('oauth:code', payload);
  });

  deviceOAuthManager.on('oauth:success', (payload) => {
    sendMainWindowEvent('oauth:success', { ...payload, success: true });
  });

  deviceOAuthManager.on('oauth:error', (error) => {
    sendMainWindowEvent('oauth:error', error);
  });

  browserOAuthManager.on('oauth:code', (payload) => {
    sendMainWindowEvent('oauth:code', payload);
  });

  browserOAuthManager.on('oauth:success', (payload) => {
    sendMainWindowEvent('oauth:success', { ...payload, success: true });
  });

  browserOAuthManager.on('oauth:error', (error) => {
    sendMainWindowEvent('oauth:error', error);
  });

  whatsAppLoginManager.on('qr', (data) => {
    sendMainWindowEvent('channel:whatsapp-qr', data);
  });

  whatsAppLoginManager.on('success', (data) => {
    sendMainWindowEvent('channel:whatsapp-success', data);
  });

  whatsAppLoginManager.on('error', (error) => {
    sendMainWindowEvent('channel:whatsapp-error', error);
  });

  // Start Gateway automatically (this seeds missing bootstrap files with full templates)
  const gatewayAutoStart = await getSetting('gatewayAutoStart');
  if (!isE2EMode && gatewayAutoStart) {
    try {
      await syncAllProviderAuthToRuntime();
      logger.debug('Auto-starting Gateway...');
      await gatewayManager.start();
      logger.info('Gateway auto-start succeeded');
    } catch (error) {
      logger.error('Gateway auto-start failed:', error);
      mainWindow?.webContents.send('gateway:error', String(error));
    }
  } else if (isE2EMode) {
    logger.info('Gateway auto-start skipped in E2E mode');
  } else {
    logger.info('Gateway auto-start disabled in settings');
  }

  // Merge Verse Claw context snippets into the workspace bootstrap files.
  // The gateway seeds workspace files asynchronously after its HTTP server
  // is ready, so ensureVerseClawContext will retry until the target files appear.
  if (!isE2EMode) {
    void ensureVerseClawContext().catch((error) => {
      logger.warn('Failed to merge Verse Claw context into workspace:', error);
    });
  }

  // Auto-install openclaw CLI and shell completions (non-blocking).
  if (!isE2EMode) {
    void autoInstallCliIfNeeded((installedPath) => {
      mainWindow?.webContents.send('openclaw:cli-installed', installedPath);
    }).then(() => {
      generateCompletionCache();
      installCompletionToProfile();
    }).catch((error) => {
      logger.warn('CLI auto-install failed:', error);
    });
  }
}

if (gotTheLock) {
  const requestQuitOnSignal = createSignalQuitHandler({
    logInfo: (message) => logger.info(message),
    requestQuit: () => app.quit(),
  });

  process.on('exit', () => {
    releaseProcessInstanceFileLock();
  });

  process.once('SIGINT', () => requestQuitOnSignal('SIGINT'));
  process.once('SIGTERM', () => requestQuitOnSignal('SIGTERM'));

  app.on('will-quit', () => {
    releaseProcessInstanceFileLock();
  });

  if (process.platform === 'win32') {
    app.setAppUserModelId(WINDOWS_APP_USER_MODEL_ID);
  }

  gatewayManager = new GatewayManager();
  clawHubService = new ClawHubService();

  // Register builtin extensions and load manifest
  registerAllBuiltinExtensions();
  loadExternalMainExtensions();
  void loadExtensionsFromManifest().catch((err) => {
    logger.warn('Failed to load extensions from manifest:', err);
  });

  // When a second instance is launched, focus the existing window instead.
  app.on('second-instance', () => {
    logger.info('Second Verse Claw instance detected; redirecting to the existing window');

    const focusRequest = requestSecondInstanceFocus(
      mainWindowFocusState,
      Boolean(mainWindow && !mainWindow.isDestroyed()),
    );

    if (focusRequest === 'focus-now') {
      focusMainWindow();
      return;
    }

    logger.debug('Main window is not ready yet; deferring second-instance focus until ready-to-show');
  });

  // Application lifecycle
  app.whenReady().then(() => {
    void initialize().catch((error) => {
      logger.error('Application initialization failed:', error);
    });

    // Register activate handler AFTER app is ready to prevent
    // "Cannot create BrowserWindow before app is ready" on macOS.
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      } else {
        focusMainWindow();
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' || isE2EMode) {
      app.quit();
    }
  });

  app.on('before-quit', (event) => {
    setQuitting();
    const action = requestQuitLifecycleAction(quitLifecycleState);

    if (action === 'allow-quit') {
      return;
    }

    event.preventDefault();

    if (action === 'cleanup-in-progress') {
      logger.debug('Quit requested while cleanup already in progress; waiting for shutdown task to finish');
      return;
    }

    void extensionRegistry.teardownAll();

    const stopPromise = gatewayManager.stop().catch((err) => {
      logger.warn('gatewayManager.stop() error during quit:', err);
    });
    const timeoutPromise = new Promise<'timeout'>((resolve) => {
      setTimeout(() => resolve('timeout'), 5000);
    });

    void Promise.race([stopPromise.then(() => 'stopped' as const), timeoutPromise]).then((result) => {
      if (result === 'timeout') {
        logger.warn('Gateway shutdown timed out during app quit; proceeding with forced quit');
        void gatewayManager.forceTerminateOwnedProcessForQuit().then((terminated) => {
          if (terminated) {
            logger.warn('Forced gateway process termination completed after quit timeout');
          }
        }).catch((err) => {
          logger.warn('Forced gateway termination failed after quit timeout:', err);
        });
      }
      markQuitCleanupCompleted(quitLifecycleState);
      app.quit();
    });
  });

  // Best-effort Gateway cleanup on unexpected crashes.
  // These handlers attempt to terminate the Gateway child process within a
  // short timeout before force-exiting, preventing orphaned processes.
  const emergencyGatewayCleanup = (reason: string, error: unknown): void => {
    logger.error(`${reason}:`, error);
    try {
      void gatewayManager?.stop().catch(() => { /* ignore */ });
    } catch {
      // ignore — stop() may not be callable if state is corrupted
    }
    // Give Gateway stop a brief window, then force-exit.
    setTimeout(() => {
      process.exit(1);
    }, 3000).unref();
  };

  process.on('uncaughtException', (error) => {
    emergencyGatewayCleanup('Uncaught exception in main process', error);
  });

  process.on('unhandledRejection', (reason) => {
    emergencyGatewayCleanup('Unhandled promise rejection in main process', reason);
  });
}

// Export for testing
export { mainWindow, gatewayManager };
