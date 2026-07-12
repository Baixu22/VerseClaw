import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import { createDefaultAgentBrowserCliRunner } from './agent-browser-cli-runner';
import { AgentBrowserService } from './agent-browser-service';
import { AgentBrowserTaskService } from './agent-browser-task-service';
import { AgentBrowserVault } from './agent-browser-vault';

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

  return {
    open: async (payload = {}) => ({
      success: true,
      ...(await service.open(payload)),
    }),
    status: () => ({
      success: true,
      sessions: service.list(),
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
  };
}
