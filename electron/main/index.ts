/**
 * Electron Main Process Entry
 * Manages window creation, system tray, and IPC handlers
 */
import { markPerformance } from '../services/performance-metrics';
import { app, BrowserWindow, dialog, nativeTheme, session } from 'electron';
import { registerWindowVisibility } from './window-visibility';
import { appendFileSync } from 'node:fs';
import { join } from 'path';
import { openExternalSafe } from '../utils/safe-open-external';
import { registerWebViewSecurity } from '../utils/register-webview-security';
import { GatewayManager } from '../gateway/manager';
import { getTerminalSessionManager, registerIpcHandlers } from './ipc-handlers';
import { disposeCronMaintenance } from '../services/cron-maintenance';
import { HostApiRegistry } from './ipc/host-invoke';
import { getResourceTracker } from '../services/resource-tracker';
import { closeAllOwnedBrowserSessions } from '../services/long-session-resource-reclamation';
import { createTray, syncTrayIconWithSystemTheme } from './tray';
import { createMenu } from './menu';
import { registerZoomShortcuts } from './zoom-shortcuts';
import { applySystemThemeIcons, getWindowIcon } from './theme-icons';
import { installHtmlPreviewProtocol, registerHtmlPreviewScheme } from './html-preview-protocol';

import { logger } from '../utils/logger';
import { warmupNetworkOptimization } from '../utils/uv-env';
import { initTelemetry, captureTelemetryEvent } from '../utils/telemetry';

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
import {
  handleUncaughtException,
  handleUnhandledRejection,
  installOutputStreamErrorHandlers,
} from './process-error-handlers';
import { getMacTrafficLightPosition, syncMacTrafficLightPosition } from './traffic-light-layout';
import { getSetting } from '../utils/store';
import { reconcileAppVersionRollback } from '../utils/app-version-rollback';
import { startRuntimeEfficiency, stopRuntimeEfficiency } from '../services/efficiency-orchestrator';
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
import { recordPromptCacheObservation } from '../services/usage-api';
import { stopAllOfficeWatches } from '../services/office-tools-api';
import { stopAllKnowledgeSourceWatches } from '../services/knowledge-api';
import { disposeVtokenBridge } from '../services/vtoken-api';
import { resolveRemoteDebuggingLaunchPort } from '../utils/remote-control';
import { appendTaskLedgerEvents } from '../services/task-ledger-service';
import type { TaskLedgerEventInput, TaskLedgerNodeStatus } from '../../shared/types/task-ledger';
import type { ClawGraphRunEvent, ClawGraphRunSnapshot } from '../../shared/types/clawgraph';
import type {
  LongConversationControlSignal,
  LongConversationValidationState,
} from '../../shared/types/long-task-control';
import type { MissionLifecycleEvent } from '../../shared/types/mission-control';
import { GATEWAY_WEB_REQUEST_URL_FILTERS } from '../../shared/gateway-endpoint';

const WINDOWS_APP_USER_MODEL_ID = 'app.verse-claw.desktop';
const isE2EMode = process.env.VERSE_CLAW_E2E === '1';
const requestedUserDataDir = process.env.VERSE_CLAW_USER_DATA_DIR?.trim();
const requestedRemoteDebuggingPort = resolveRemoteDebuggingLaunchPort(app);

function traceStartup(phase: string): void {
  if (process.env.CLAWX_E2E_STARTUP_TRACE !== '1') return;
  const line = `${new Date().toISOString()} ${phase} pid=${process.pid} type=${process.type ?? 'unknown'}`;
  console.log(`[startup-trace] ${line}`);
  const traceFile = process.env.CLAWX_E2E_STARTUP_TRACE_FILE?.trim();
  if (!traceFile) return;
  try {
    appendFileSync(traceFile, `[startup-trace] ${line}\n`, 'utf8');
  } catch {
    // Diagnostics must never affect startup.
  }
}

traceStartup('main-module-loaded');

installOutputStreamErrorHandlers();

if (requestedRemoteDebuggingPort != null) {
  app.commandLine.appendSwitch('remote-debugging-port', String(requestedRemoteDebuggingPort));
}

if (requestedUserDataDir) {
  app.setPath('userData', requestedUserDataDir);
}

// GPU hardware acceleration is disabled unconditionally, on every platform and
// on every launch. This is a recorded, product-locked default, not a gap: there
// is no CLI flag, environment variable, config key or settings toggle that
// re-enables GPU compositing, and this comment must not imply otherwise.
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
// Changing this default is a publisher decision that requires an opt-in surface,
// schema, i18n, E2E coverage, a measured before/after artifact and a rollback
// path. Decision record and machine check: docs/dev/hardware-acceleration-policy.md
// and `pnpm docs:policy:validate`.
// Privileged custom scheme for sandboxed HTML Preview documents.
// Must be registered before app.whenReady().
registerHtmlPreviewScheme();

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
let systemThemeIconListenerRegistered = false;
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

type RendererBootTheme = 'light' | 'dark';

const BOOT_BACKGROUND_COLORS: Record<RendererBootTheme, string> = {
  light: '#faf9f5',
  dark: '#1b1b1d',
};

async function resolveRendererBootTheme(): Promise<RendererBootTheme> {
  try {
    const theme = await getSetting('theme');
    if (theme === 'light' || theme === 'dark') return theme;
  } catch (error) {
    logger.warn('Failed to read persisted theme for renderer startup:', error);
  }
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
}

function getE2EDelayQuery(envName: string): string | undefined {
  if (!isE2EMode) return undefined;
  const value = Number(process.env[envName]);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return String(Math.min(Math.floor(value), 30_000));
}

/**
 * Create the main application window
 */
async function createWindow(): Promise<BrowserWindow> {
  traceStartup('create-window-enter');
  const isMac = process.platform === 'darwin';
  const isWindows = process.platform === 'win32';
  const useCustomTitleBar = isWindows;
  const shouldSkipSetupForE2E = process.env.VERSE_CLAW_E2E_SKIP_SETUP === '1';
  traceStartup('create-window-theme-start');
  const bootTheme = await resolveRendererBootTheme();
  traceStartup('create-window-theme-done:' + bootTheme);
  const rendererQuery: Record<string, string> = { bootTheme };
  const e2eBootHoldMs = getE2EDelayQuery('CLAWX_E2E_BOOT_HOLD_MS');
  const e2eSettingsSectionDelayMs = getE2EDelayQuery('CLAWX_E2E_SETTINGS_SECTION_DELAY_MS');
  if (shouldSkipSetupForE2E) rendererQuery.e2eSkipSetup = '1';
  if (e2eBootHoldMs) rendererQuery.e2eBootHoldMs = e2eBootHoldMs;
  if (e2eSettingsSectionDelayMs) {
    rendererQuery.e2eSettingsSectionDelayMs = e2eSettingsSectionDelayMs;
  }

  traceStartup('create-window-browser-window-start');
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    icon: getWindowIcon(),
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
    backgroundColor: BOOT_BACKGROUND_COLORS[bootTheme],
    show: false,
  });

  traceStartup('create-window-browser-window-done');
  registerZoomShortcuts(win);
  markPerformance('window-created');
  registerWindowVisibility(win);
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
    void openExternalSafe(url).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`Blocked openExternal: ${message} (${url})`);
    });
    return { action: 'deny' };
  });

  installRendererCrashRecovery(win);

  // Load the app
  if (process.env.VITE_DEV_SERVER_URL) {
    const rendererUrl = new URL(process.env.VITE_DEV_SERVER_URL);
    for (const [key, value] of Object.entries(rendererQuery)) {
      rendererUrl.searchParams.set(key, value);
    }
    win.loadURL(rendererUrl.toString()).catch((error) => {
      showFatalLoadErrorDialog(error);
    });
    if (!isE2EMode) {
      win.webContents.openDevTools();
    }
  } else {
    win.loadFile(join(__dirname, '../../dist/index.html'), {
      query: rendererQuery,
    }).catch((error) => {
      showFatalLoadErrorDialog(error);
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

const DEGRADED_RENDERER_PAGE = 'data:text/html;charset=utf-8,' + encodeURIComponent(
  '<!doctype html><html><body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#1b1b1d;color:#e4e4e7"><div style="text-align:center"><h2 style="font-weight:600">The app interface became unresponsive.</h2><p style="color:#a1a1aa">Restart the app to continue. The process is still running, so your data is safe.</p></div></body></html>',
);

/**
 * Show a native fatal-error dialog. `dialog.showErrorBox` is synchronous and
 * safe to call even while the main process is in a degraded state (e.g. a
 * renderer load failure), so it never risks an unhandled rejection itself.
 */
function showFatalLoadErrorDialog(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  logger.error('Fatal renderer load failure:', error);
  const logPath = logger.getLogFilePath() ?? '(log file unavailable)';
  dialog.showErrorBox(
    'Verse Claw failed to load',
    `The app window could not be loaded.\n\n${message}\n\nLog file: ${logPath}`,
  );
}

/**
 * Recover from a crashed or hung renderer process:
 * - On the first crash/hang, reload once.
 * - On a subsequent failure, show a degraded page instead of a blank window
 *   (the app process itself stays alive, so user data is not lost).
 */
function installRendererCrashRecovery(win: BrowserWindow): void {
  let rendererFailureCount = 0;

  const showDegradedPage = (reason: string): void => {
    logger.warn(`Renderer ${reason}; showing degraded page (failures: ${rendererFailureCount})`);
    void win.loadURL(DEGRADED_RENDERER_PAGE).catch(() => {});
  };

  const reloadOrDegrade = (reason: string): void => {
    rendererFailureCount += 1;
    if (rendererFailureCount === 1) {
      logger.warn(`Renderer ${reason}; attempting one automatic reload`);
      win.webContents.reload();
      return;
    }
    showDegradedPage(reason);
  };

  win.webContents.on('render-process-gone', (_event, details) => {
    reloadOrDegrade(`render-process-gone (${details.reason})`);
  });

  win.webContents.on('unresponsive', () => {
    reloadOrDegrade('unresponsive');
  });
}

function focusMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  clearPendingSecondInstanceFocus(mainWindowFocusState);
  focusWindow(mainWindow);
}

async function createMainWindow(): Promise<BrowserWindow> {
  const win = await createWindow();
  applySystemThemeIcons(win);

  win.once('ready-to-show', () => {
    markPerformance('ready-to-show');
    if (mainWindow !== win) {
      return;
    }

    if (process.platform === 'darwin') {
      void getSetting('sidebarCollapsed').then((sidebarCollapsed) => {
        syncMacTrafficLightPosition(win, sidebarCollapsed);
      }).catch((error) => {
        logger.warn('Failed to read sidebarCollapsed setting:', error);
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

async function startGatewayAfterFirstPaint(): Promise<void> {
  markPerformance('gateway-start');
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
}

/**
 * Initialize the application
 */
async function initialize(): Promise<void> {
  traceStartup('initialize-enter');
  // Initialize logger first
  logger.init();
  traceStartup('initialize-logger-ready');
  logger.info('=== Verse Claw Application Starting ===');

  // FP-P1-05: reconcile a persisted newer-version marker before a gateway
  // child can observe any preview flags from settings or openclaw.json.
  traceStartup('initialize-version-reconcile-start');
  await reconcileAppVersionRollback();
  traceStartup('initialize-version-reconcile-done');

  // P2-004 / F-ISO-002: install WebView attach/permission/navigation controls
  // before any BrowserWindow or guest <webview> is created.
  registerWebViewSecurity();

  // Start resource tracker for port/heartbeat monitoring and auto-cleanup
  getResourceTracker().start();

  logger.debug(
    `Runtime: platform=${process.platform}/${process.arch}, electron=${process.versions.electron}, node=${process.versions.node}, packaged=${app.isPackaged}, pid=${process.pid}, ppid=${process.ppid}`
  );

  if (!isE2EMode) {
    // Warm up network optimization (non-blocking)
    void warmupNetworkOptimization().catch((error) => {
      logger.warn('Network optimization warmup failed:', error);
    });

    // Apply persisted proxy settings before creating windows or network requests.
    await applyProxySettings();
  } else {
    logger.info('Running in E2E mode: startup side effects minimized');
  }

  // Create the main window
  traceStartup('initialize-main-window-create-start');
  const window = await createMainWindow();
  traceStartup('initialize-main-window-create-done');
  window.once('ready-to-show', () => {
    setImmediate(() => {
      void startGatewayAfterFirstPaint();
    });
  });


  if (!systemThemeIconListenerRegistered) {
    systemThemeIconListenerRegistered = true;
    nativeTheme.on('updated', () => {
      applySystemThemeIcons(mainWindow);
      syncTrayIconWithSystemTheme();
    });
  }

  // Override security headers ONLY for the OpenClaw Gateway Control UI.
  // The URL filter ensures this callback only fires for gateway requests,
  // avoiding unnecessary overhead on every other HTTP response.
  session.defaultSession.webRequest.onHeadersReceived(
    { urls: [...GATEWAY_WEB_REQUEST_URL_FILTERS] },
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

  // Keep the first-paint critical path free of menu/tray/telemetry/extension
  // work. These services are still initialized locally, but only after the
  // window has had a chance to emit ready-to-show.
  setImmediate(() => {
    if (!isE2EMode) {
      void syncLaunchAtStartupSettingFromStore().catch((error) => {
        logger.warn('Launch-at-startup sync failed after first paint:', error);
      });
      void initTelemetry().catch((error) => {
        logger.warn('Telemetry initialization failed after first paint:', error);
      });
    }
    void createMenu().catch((error) => {
      logger.warn('Application menu initialization failed after first paint:', error);
    });
    if (!isE2EMode) {
      createTray(window);
    }
    applySystemThemeIcons(window);
    syncTrayIconWithSystemTheme();
    void extensionRegistry.initialize({
      gatewayManager,
      getMainWindow: () => mainWindow,
      hostApi: {
        register: (extensionId, contributions) => (
          hostApiRegistry.registerExtensionContributions(extensionId, contributions)
        ),
      },
    }).then(() => {
      const marketplaceProvider = extensionRegistry.getMarketplaceProvider();
      if (marketplaceProvider) {
        clawHubService.setMarketplaceProvider(marketplaceProvider);
      }
    }).catch((error) => {
      logger.warn('Extension initialization failed after first paint:', error);
    });
  });

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
    }).catch((error) => {
      logger.warn('Failed to trim bundled OpenClaw skills:', error);
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

  // Prompt-cache break attribution → existing Main-owned ledger. The runtime
  // frame is projected by the gateway dispatcher into bounded metadata; Main is
  // the only writer, and the renderer reads it back through the typed usage API.
  gatewayManager.on('prompt-cache:break', (data) => {
    recordPromptCacheObservation(data).catch((error) => {
      logger.warn('prompt-cache: failed to record observed cache break', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
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

  // Runtime exec-approval boundary → renderer modal. The renderer answers through
  // hostApi.runtimeApprovals.resolve, which re-enters the Gateway as
  // exec.approval.resolve; nothing here decides anything on the user's behalf.
  gatewayManager.on('approval:requested', (data) => {
    sendMainWindowEvent('runtime-approvals:requested', data);
  });

  gatewayManager.on('approval:resolved', (data) => {
    sendMainWindowEvent('runtime-approvals:resolved', data);
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
    disposeVtokenBridge();
    stopAllOfficeWatches();
    stopAllKnowledgeSourceWatches();
    // R0-3: reclaim every live pty session and stop tracked resources
    // (shutdown() = stop timers + kill tracked processes, best-effort).
    getTerminalSessionManager()?.shutdownAll();
    closeAllOwnedBrowserSessions();
    void getResourceTracker().shutdown();
    disposeCronMaintenance();
    // Release the efficiency sampling timer so quit never waits on it.
    stopRuntimeEfficiency();
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
    traceStartup('app-ready-callback');
    markPerformance('app-ready');
    installHtmlPreviewProtocol();
    // Runtime efficiency sampling (P2 #161); cheap unref'd timer, local only.
    // Honour the persisted opt-out: start only when enabled (default true).
    void getSetting('efficiencySamplingEnabled')
      .then((efficiencySamplingEnabled) => {
        if (efficiencySamplingEnabled !== false) startRuntimeEfficiency();
      })
      .catch((error) => {
        logger.warn('Failed to read efficiency sampling setting; defaulting to enabled', error);
        startRuntimeEfficiency();
      });
    void initialize().catch((error) => {
      logger.error('Application initialization failed:', error);
    });

    // Register activate handler AFTER app is ready to prevent
    // "Cannot create BrowserWindow before app is ready" on macOS.
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        void createMainWindow().catch((error) => {
          logger.error('Failed to recreate main window:', error);
        });
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

    void extensionRegistry.teardownAll().catch((error) => {
      logger.warn('extensionRegistry.teardownAll() failed during quit:', error);
    });

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
    // Fail-closed on truly fatal errors: surface a native dialog with the log
    // path BEFORE the best-effort gateway cleanup and forced exit, so the user
    // is not left with a silent quit.
    const disposition = handleUncaughtException(
      {
        logger,
        captureTelemetry: captureTelemetryEvent,
        showErrorBox: (title, content) => dialog.showErrorBox(title, content),
      },
      error,
    );
    if (disposition === 'ignored') return;
    emergencyGatewayCleanup('Uncaught exception in main process', error);
  });

  process.on('unhandledRejection', (reason) => {
    // A rejected promise is not necessarily fatal — log and report it (visible
    // in the diagnostics panel log tail and telemetry) instead of exiting.
    handleUnhandledRejection(
      {
        logger,
        captureTelemetry: captureTelemetryEvent,
        showErrorBox: (title, content) => dialog.showErrorBox(title, content),
      },
      reason,
    );
  });
}

// Export for testing
export { mainWindow, gatewayManager };
export { approveBrowserPrivateNetwork } from '../services/agent-browser-api';
