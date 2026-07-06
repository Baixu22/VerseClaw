import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import { createDefaultAgentBrowserCliRunner } from './agent-browser-cli-runner';
import { AgentBrowserService } from './agent-browser-service';

let defaultAgentBrowserService: AgentBrowserService | undefined;

export function getDefaultAgentBrowserService(): AgentBrowserService {
  defaultAgentBrowserService ??= new AgentBrowserService({
    cliRunner: createDefaultAgentBrowserCliRunner(),
  });
  return defaultAgentBrowserService;
}

export function createAgentBrowserApi(
  service = getDefaultAgentBrowserService(),
): CompleteHostServiceRegistry['agentBrowser'] {
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
    close: (payload) => {
      service.close(payload.sessionId);
      return { success: true };
    },
  };
}
