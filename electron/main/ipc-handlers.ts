/**
 * IPC Handlers
 * Registers all IPC handlers for main-renderer communication
 */
import { BrowserWindow, app } from 'electron';
import { join } from 'node:path';
import { GatewayManager } from '../gateway/manager';
import { registerAgentBrowserGatewayBridge } from '../gateway/agent-browser-bridge';
import { ClawHubService } from '../gateway/clawhub';
import { logger } from '../utils/logger';
import { startCronAgentRepair } from '../services/cron-maintenance';
import { whatsAppLoginManager } from '../utils/whatsapp-login';
import { resourceFabric } from '../services/resource-fabric';
import { HostApiRegistry, registerHostInvokeHandler } from './ipc/host-invoke';
import { createAppApi } from '../services/app-api';
import { createVerseGitApi } from '../services/versegit-api';
import { ensureVerseGitBindingBridge } from '../gateway/versegit-bridge';
import { createOpenClawApi } from '../services/openclaw-api';
import { createShellApi } from '../services/shell-api';
import { createDialogApi } from '../services/dialog-api';
import { createSystemNotificationsApi } from '../services/system-notifications-api';
import { createUpdatesApi } from '../services/updates-api';
import { createUvApi } from '../services/uv-api';
import { createVtokenApi } from '../services/vtoken-api';
import { createDcsProdFlagsApi } from '../services/dcs-prod-flags-api';
import { createGatewayApi } from '../services/gateway-api';
import { createLocalControlPlaneApi } from '../services/local-control-plane-api';
import { createCapabilitiesApi } from '../services/capabilities-api';
import { createAgentDevApi } from '../services/agent-dev-api';
import { createLogsApi } from '../services/logs-api';
import { createSettingsApi } from '../services/settings-api';
import { createEfficiencyApi } from '../services/efficiency-api';
import { createResourceEnvelopeApi } from '../services/resource-envelope-api';
import { createChannelsApi } from '../services/channels-api';
import { createAgentsApi } from '../services/agents-api';
import { createRolesApi } from '../services/roles-api';
import { createChatApi } from '../services/chat-api';
import { createCodeReviewApi } from '../services/code-review-api';
import { createChangeContextApi } from '../services/change-context-api';
import { createRemoteForgeApi } from '../services/remote-forge-api';
import { createWorkProvidersApi } from '../services/work-providers-api';
import { createKnowledgeApi } from '../services/knowledge-api';
import { createCronApi } from '../services/cron-api';
import { createFilesApi } from '../services/files-api';
import { createMediaApi } from '../services/media-api';
import { createProvidersApi } from '../services/providers-api';
import { createSessionsApi } from '../services/sessions-api';
import { createMemoryApi } from '../services/memory-api';
import { createSkillsApi } from '../services/skills-api';
import { createSkillPacksApi } from '../services/skill-packs-api';
import { createOfficeToolsApi } from '../services/office-tools-api';
import { createUsageApi } from '../services/usage-api';
import { createPermissionsApi } from '../services/permissions-api';
import { createRuntimeApprovalsApi } from '../services/runtime-approvals-api';
import { createOrchestrationPresetsApi } from '../services/orchestration-presets-api';
import { createTerminalApi } from '../services/terminal-api';
import { createHostTraceDiagnosticsService } from '../services/host-trace-diagnostics';
import { createSessionActivityApi } from '../services/session-activity-api';
import { createGitApi } from '../services/git-api';
import { createTerminalSessionManager, type TerminalSessionManager } from '../services/terminal-session-manager';
import { createWebPreviewApi } from '../services/web-preview-api';
import { createWebPreviewManager } from '../services/web-preview-manager';
import { createWorkspacesApi } from '../services/workspaces-api';
import { createProjectRulesApi } from '../services/project-rules-api';
import { createRemoteControlApi } from '../services/remote-control-api';
import { createAgentBrowserApi } from '../services/agent-browser-api';
import { createMcpApiWithContext } from '../services/mcp-api';
import { createSandboxApi } from '../services/sandbox-api';
import { createHooksApi } from '../services/hooks-api';
import { createTopicsApi } from '../services/topics-api';
import { createTaskLedgerApi } from '../services/task-ledger-api';
import { createRemoteTasksApi } from '../services/remote-tasks-api';
import { createClawGraphApi } from '../services/clawgraph-api';
import { createObservabilityApi } from '../services/observability-api';
import { recordObservabilityHostDiagnostic } from '../services/observability-service';
import { createResourceTrackerApi } from '../services/resource-tracker-api';
import { HOST_EVENT_CHANNELS } from '@shared/host-events/contract';

/**
 * Register all IPC handlers
 */
// R0-3: the terminal manager is created during typed-handler registration;
// the quit path needs a handle on it to reclaim every pty session.
let terminalManagerRef: TerminalSessionManager | null = null;

export function getTerminalSessionManager(): TerminalSessionManager | null {
  return terminalManagerRef;
}

export function registerIpcHandlers(
  gatewayManager: GatewayManager,
  clawHubService: ClawHubService,
  mainWindow: BrowserWindow,
  hostApiRegistry: HostApiRegistry,
): void {
  // Typed host invoke handlers (new renderer facade; legacy channels remain available)
  registerTypedHostHandlers(gatewayManager, clawHubService, mainWindow, hostApiRegistry);

  // Cron task handlers (proxy to Gateway RPC)
  registerCronHandlers(gatewayManager);

  // WhatsApp handlers
  registerWhatsAppHandlers(mainWindow);
}

function registerTypedHostHandlers(
  gatewayManager: GatewayManager,
  clawHubService: ClawHubService,
  mainWindow: BrowserWindow,
  hostApiRegistry: HostApiRegistry,
): void {
  void ensureVerseGitBindingBridge().catch((error) => { logger.warn('VerseGit binding bridge unavailable:', error); });
  // Circular init with terminalManager requires deferred assignment.
  // eslint-disable-next-line prefer-const -- assigned after terminalManager is created
  let webPreviewManager: ReturnType<typeof createWebPreviewManager>;
  const terminalManager = createTerminalSessionManager({
    mainWindow,
    onData: (event) => {
      if (event.kind === 'webPreviewDevServer') {
        webPreviewManager?.handleTerminalOutput(event.workspaceId, event.data);
      }
    },
  });
  terminalManagerRef = terminalManager;
  webPreviewManager = createWebPreviewManager({ mainWindow, terminalManager });
  const agentBrowserApi = createAgentBrowserApi();
  registerAgentBrowserGatewayBridge(gatewayManager, undefined, agentBrowserApi);
  const knowledgeApi = createKnowledgeApi({ gatewayManager });
  const remoteForgeApi = createRemoteForgeApi();
  const gitApi = createGitApi();
  const taskLedgerApi = createTaskLedgerApi();
  const workspacesApi = createWorkspacesApi({
    gatewayManager,
    terminalManager,
    webPreviewManager,
    gitApi,
    taskLedgerApi,
  });
  const traceDiagnostics = createHostTraceDiagnosticsService({
    onSummary: recordObservabilityHostDiagnostic,
  });
  const gatewayApi = createGatewayApi(gatewayManager, resourceFabric, {
    createKnowledgeInboxItem: knowledgeApi.createInboxItem,
  });
  const sessionsApi = createSessionsApi({
    gatewayManager,
    terminalManager,
    coordinatorLifecycle: workspacesApi.coordinatorLifecycle,
    resolveCoordinator: workspacesApi.resolveCoordinator,
    gatewayRpcForDelegation: gatewayApi.rpc,
  });

  hostApiRegistry.registerCoreServices({
    app: createAppApi(),
    versegit: createVerseGitApi(),
    openclaw: createOpenClawApi(),
    shell: createShellApi(),
    dialog: createDialogApi(),
    window: createSystemNotificationsApi(mainWindow),
    updates: createUpdatesApi(),
    uv: createUvApi(),
    vtoken: createVtokenApi(),
    dcsProdFlags: createDcsProdFlagsApi(gatewayManager),
    workspaces: workspacesApi,
    projectRules: createProjectRulesApi(),
    terminal: createTerminalApi({ gatewayManager, terminalManager, traceDiagnostics }),
    sessionActivity: createSessionActivityApi({ gatewayManager, terminalManager }),
    git: gitApi,
    permissions: createPermissionsApi(),
    runtimeApprovals: createRuntimeApprovalsApi(gatewayManager),
    orchestrationPresets: createOrchestrationPresetsApi(),
    webPreview: createWebPreviewApi({ webPreviewManager }),
    settings: createSettingsApi(gatewayManager),
    efficiency: createEfficiencyApi(),
    resourceEnvelope: createResourceEnvelopeApi(),
    gateway: gatewayApi,
    localControlPlane: createLocalControlPlaneApi(gatewayManager),
    capabilities: createCapabilitiesApi({ gatewayManager }),
    agentDev: createAgentDevApi({ gatewayManager }),
    remoteControl: createRemoteControlApi(),
    agentBrowser: agentBrowserApi,
    mcp: createMcpApiWithContext({ gatewayManager, gatewayRpc: gatewayApi.rpc, remoteForgeApi }),
    sandbox: createSandboxApi(),
    hooks: createHooksApi(),
    logs: createLogsApi(),
    channels: createChannelsApi({ gatewayManager, mainWindow }),
    agents: createAgentsApi({ gatewayManager }),
    roles: createRolesApi(),
    providers: createProvidersApi({ gatewayManager, mainWindow }),
    files: createFilesApi(),
    media: createMediaApi(),
    sessions: sessionsApi,
    chat: createChatApi({ gatewayManager }),
    codeReview: createCodeReviewApi({ gatewayManager }),
    changeContext: createChangeContextApi({
      gatewayManager,
      checkpointDiff: sessionsApi.checkpointDiff,
    }),
    remoteForge: remoteForgeApi,
    workProviders: createWorkProvidersApi(),
    knowledge: knowledgeApi,
    cron: createCronApi({ gatewayManager }),
    skills: createSkillsApi({ clawHubService, gatewayManager }),
    skillPacks: createSkillPacksApi(),
    officeTools: createOfficeToolsApi({
      emitInstallEvent: (event) => (
        mainWindow.webContents.send(HOST_EVENT_CHANNELS.officeTools.installEvent, event)
      ),
    }),
    usage: createUsageApi(),
    topics: createTopicsApi(),
    taskLedger: taskLedgerApi,
    remoteTasks: createRemoteTasksApi({ gatewayManager }),
    clawGraph: createClawGraphApi({ gatewayManager }),
    observability: createObservabilityApi({
      gatewayManager,
      onRuntimeEvent: (event) => mainWindow.webContents.send('observability:runtime-event', event),
      onTrajectoryEvent: (event) => (
        mainWindow.webContents.send(HOST_EVENT_CHANNELS.observability.trajectoryEvent, event)
      ),
    }).observability,
    resourceTracker: createResourceTrackerApi(),
    memory: createMemoryApi({
      gatewayManager,
      exportDir: join(app.getPath('userData'), 'exports', 'memory'),
    }),
  });
  registerHostInvokeHandler(hostApiRegistry, {
    senderAuth: {
      allowedWebContentsIds: new Set([mainWindow.webContents.id]),
    },
  });
}


/**
 * Cron maintenance
 */
function registerCronHandlers(gatewayManager: GatewayManager): void {
  // Periodic cron job repair: checks for jobs with undefined agentId and repairs them.
  // R0-3: lives in cron-maintenance.ts — the interval handle is saved/unref'd,
  // disposed on app quit, and failure counts are exposed via diagnostics.
  startCronAgentRepair(gatewayManager);
}



/**
 * WhatsApp Login Handlers
 */
function registerWhatsAppHandlers(mainWindow: BrowserWindow): void {
  // Forward events to renderer
  whatsAppLoginManager.on('qr', (data) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('channel:whatsapp-qr', data);
    }
  });

  whatsAppLoginManager.on('success', (data) => {
    if (!mainWindow.isDestroyed()) {
      logger.info('whatsapp:login-success', data);
      mainWindow.webContents.send('channel:whatsapp-success', data);
    }
  });

  whatsAppLoginManager.on('error', (error) => {
    if (!mainWindow.isDestroyed()) {
      logger.error('whatsapp:login-error', error);
      mainWindow.webContents.send('channel:whatsapp-error', error);
    }
  });
}
