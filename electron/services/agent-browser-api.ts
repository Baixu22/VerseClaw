import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import { createPermissionDecisionEvent } from '@shared/product-semantics';
import { DEFAULT_WORKSPACE_PERMISSION_MODE } from '@shared/types/workspace';
import {
  classifyAgentBrowserAction,
  decideSandboxHighRiskAction,
  loadSandboxHighRiskPolicy,
} from '@electron/utils/sandbox-high-risk-gate';
import { createDefaultAgentBrowserCliRunner } from './agent-browser-cli-runner';
import { AgentBrowserService } from './agent-browser-service';
import { AgentBrowserTaskService } from './agent-browser-task-service';
import { AgentBrowserVault } from './agent-browser-vault';
import { recordPermissionDecisionEvent } from './permissions-api';
import { getActiveWorkspaceProfile } from './workspaces-api';

async function assertBrowserAllowedUnderSandbox(action: string): Promise<void> {
  const actionClass = classifyAgentBrowserAction(action);
  if (!actionClass) return;
  const policy = await loadSandboxHighRiskPolicy();
  // Fail-closed on agent-browser host API (no stepwise approval consumer here).
  const decision = decideSandboxHighRiskAction(policy, actionClass, { allowApproval: false });
  if (decision.allowed) return;
  const workspace = await getActiveWorkspaceProfile();
  void recordPermissionDecisionEvent(createPermissionDecisionEvent({
    workspaceMode: workspace?.permissionMode ?? DEFAULT_WORKSPACE_PERMISSION_MODE,
    tool: `agentBrowser.${action}`,
    boundary: 'sandbox-runtime',
    decision: 'deny',
    reason: decision.reason,
  }));
  throw new Error(decision.reason ?? 'Browser action denied under degraded sandbox');
}

function withBrowserSandboxGate<Args extends unknown[], R>(
  action: string,
  fn: (...args: Args) => R | Promise<R>,
): (...args: Args) => Promise<R> {
  return async (...args: Args) => {
    await assertBrowserAllowedUnderSandbox(action);
    return await fn(...args);
  };
}

let defaultAgentBrowserService: AgentBrowserService | undefined;

export function getDefaultAgentBrowserService(): AgentBrowserService {
  defaultAgentBrowserService ??= new AgentBrowserService({
    cliRunner: createDefaultAgentBrowserCliRunner(),
  });
  return defaultAgentBrowserService;
}

export function createAgentBrowserApi(
  service = getDefaultAgentBrowserService(),
  taskService = new AgentBrowserTaskService({
    execute: async (task, signal) => {
      signal.throwIfAborted();
      await assertBrowserAllowedUnderSandbox('runTask');
      const opened = await service.open({
        url: task.url,
        profile: task.profile,
        mode: task.mode,
      });
      signal.throwIfAborted();
      return { sessionId: opened.session.id, runId: task.id };
    },
  }),
  vault?: AgentBrowserVault,
): CompleteHostServiceRegistry['agentBrowser'] {
  let vaultService = vault;
  const getVault = () => {
    vaultService ??= new AgentBrowserVault();
    return vaultService;
  };

  const api = {
    open: async (payload = {}) => ({
      success: true,
      ...(await service.open(payload)),
    }),
    status: () => ({
      success: true,
      sessions: service.list(),
      browserControlEnabled: service.isEnabled(),
    }),
    setEnabled: (payload) => ({
      success: true,
      ...service.setEnabled(payload.enabled),
    }),
    profiles: async () => ({
      success: true,
      profiles: await service.listProfiles(),
    }),
    saveProfile: async (payload) => ({
      success: true,
      profile: await service.saveProfile(payload),
    }),
    validate: async (payload = {}) => service.validate(payload),
    navigate: async (payload) => ({
      success: true,
      session: await service.navigate(payload),
    }),
    focus: async (payload) => ({
      success: true,
      session: await service.focus(payload.sessionId),
    }),
    waitForSelector: async (payload) => ({
      success: true,
      session: await service.waitForSelector(payload),
    }),
    click: async (payload) => ({
      success: true,
      session: await service.click(payload),
    }),
    type: async (payload) => ({
      success: true,
      session: await service.type(payload),
    }),
    evaluate: async (payload) => ({
      success: true,
      ...(await service.evaluate(payload)),
    }),
    screenshot: async (payload) => ({
      success: true,
      ...(await service.screenshot(payload)),
    }),
    command: async (payload) => ({
      success: true,
      ...(await service.command(payload)),
    }),
    tasks: () => ({
      success: true,
      tasks: taskService.list(),
    }),
    createTask: (payload) => ({
      success: true,
      task: taskService.create(payload),
    }),
    runTask: async (payload) => ({
      success: true,
      task: await taskService.run(payload.taskId),
    }),
    retryTask: async (payload) => ({
      success: true,
      task: await taskService.retry(payload.taskId),
    }),
    cancelTask: (payload) => ({
      success: true,
      task: taskService.cancel(payload.taskId),
    }),
    show: async (payload) => ({
      success: true,
      session: await service.show(payload.sessionId),
    }),
    hide: async (payload) => ({
      success: true,
      session: await service.hide(payload.sessionId),
    }),
    vault: async () => ({
      success: true,
      credentials: await getVault().list(),
    }),
    saveCredential: async (payload) => ({
      success: true,
      credential: await getVault().save(payload),
    }),
    deleteCredential: async (payload) => {
      await getVault().delete(payload.credentialId);
      return { success: true };
    },
    close: (payload) => {
      service.close(payload.sessionId);
      return { success: true };
    },
    takeSnapshot: async (payload) => ({
      success: true,
      ...(await service.takeSnapshot(payload)),
    }),
    clickByUid: async (payload) => ({
      success: true,
      session: await service.clickByUid(payload),
    }),
    fillByUid: async (payload) => ({
      success: true,
      session: await service.fillByUid(payload),
    }),
    pressKey: async (payload) => ({
      success: true,
      session: await service.pressKey(payload),
    }),
    requestModeUpgrade: async (payload) => ({
      success: true,
      ...(await service.requestModeUpgrade(payload)),
    }),
    respondBoundaryChoice: (payload) => ({
      success: true,
      accepted: service.respondBoundaryChoice(
        payload.sessionId,
        payload.requestId,
        { selectedChoiceIds: payload.selectedChoiceIds, otherText: payload.otherText },
      ),
    }),
    networkListRequests: async (payload) => ({
      success: true,
      ...(await service.networkListRequests(payload)),
    }),
    networkGetRequestDetails: async (payload) => ({
      success: true,
      ...(await service.networkGetRequestDetails(payload)),
    }),
    networkClearRequests: async (payload) => ({
      success: true,
      ...(await service.networkClearRequests(payload)),
    }),
    networkWaitForRequests: async (payload) => ({
      success: true,
      ...(await service.networkWaitForRequests(payload)),
    }),
    networkCompareRequests: async (payload) => ({
      success: true,
      ...(await service.networkCompareRequests(payload)),
    }),
    networkFindParameterCandidates: async (payload) => ({
      success: true,
      ...(await service.networkFindParameterCandidates(payload)),
    }),
    networkExtractJsCandidates: async (payload) => ({
      success: true,
      ...(await service.networkExtractJsCandidates(payload)),
    }),
    newPage: async (payload) => service.newPage(payload),
    listPages: async (payload) => service.listPages(payload),
    selectPage: async (payload) => service.selectPage(payload),
    closePage: async (payload) => service.closePage(payload),
    navigatePage: async (payload) => service.navigatePage(payload),
    jsListResources: async (payload) => ({
      success: true,
      ...(await service.jsListResources(payload)),
    }),
    jsSearchSources: async (payload) => ({
      success: true,
      ...(await service.jsSearchSources(payload)),
    }),
    jsExtractContext: async (payload) => ({
      success: true,
      ...(await service.jsExtractContext(payload)),
    }),
    sourceMapListCandidates: async (payload) => ({
      success: true,
      ...(await service.sourceMapListCandidates(payload)),
    }),
    sourceMapResolveLocation: async (payload) => ({
      success: true,
      ...(await service.sourceMapResolveLocation(payload)),
    }),
    sourceMapExtractOriginalContext: async (payload) => ({
      success: true,
      ...(await service.sourceMapExtractOriginalContext(payload)),
    }),
    runtimeInspectGlobals: async (payload) => ({
      success: true,
      ...(await service.runtimeInspectGlobals(payload)),
    }),
    runtimeSearchModules: async (payload) => ({
      success: true,
      ...(await service.runtimeSearchModules(payload)),
    }),
    runtimeDescribeFunction: async (payload) => ({
      success: true,
      ...(await service.runtimeDescribeFunction(payload)),
    }),
    replayPrepareRequest: async (payload) => ({
      success: true,
      ...(await service.replayPrepareRequest(payload)),
    }),
    replaySendRequest: async (payload) => ({
      success: true,
      ...(await service.replaySendRequest(payload)),
    }),
    replayCompareResponses: async (payload) => ({
      success: true,
      ...(await service.replayCompareResponses(payload)),
    }),
    getConsoleMessages: async (payload) => ({
      success: true,
      ...(await service.getConsoleMessages(payload)),
    }),
    fullAccessExecuteScript: async (payload) => ({
      success: true,
      ...(await service.fullAccessExecuteScript(payload)),
    }),
    fullAccessFetch: async (payload) => ({
      success: true,
      ...(await service.fullAccessFetch(payload)),
    }),
    fullAccessGetNetworkDetails: async (payload) => ({
      success: true,
      ...(await service.fullAccessGetNetworkDetails(payload)),
    }),
    fullAccessReadStorage: async (payload) => ({
      success: true,
      ...(await service.fullAccessReadStorage(payload)),
    }),
    fullAccessRevoke: (payload) => ({
      success: true,
      ...service.fullAccessRevoke(payload),
    }),
    extractPageText: async (payload) => ({
      success: true,
      ...(await service.extractPageText(payload)),
    }),
    validateExtractionRule: (payload) => ({
      success: true,
      ...service.validateExtractionRule(payload),
    }),
  };

  // P2-004: fail-closed high-risk browser actions when sandbox is degraded.
  return new Proxy(api, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof prop !== 'string' || typeof value !== 'function') {
        return value;
      }
      const bound = value.bind(target);
      return withBrowserSandboxGate(prop, bound as (...args: unknown[]) => unknown);
    },
  }) as CompleteHostServiceRegistry['agentBrowser'];
}
