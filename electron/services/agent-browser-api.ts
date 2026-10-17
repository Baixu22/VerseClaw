import { assertSensitiveCaptureAllowed } from './sensitive-capture-gate';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import { createPermissionDecisionEvent } from '@shared/product-semantics';
import { DEFAULT_WORKSPACE_PERMISSION_MODE } from '@shared/types/workspace';
import { SandboxDenialError } from '@shared/sandbox/errors';
import {
  classifyAgentBrowserAction,
  decideSandboxHighRiskAction,
  loadSandboxHighRiskPolicy,
} from '@electron/utils/sandbox-high-risk-gate';
import { getDataDir as getHostDataDir } from '../utils/paths';
import { recordPermissionDecisionEvent } from './permissions-api';
import { getActiveWorkspaceProfile } from './workspaces-api';
import { recordResourceEnvelopeEntry, removeResourceEnvelopeEntry } from './resource-envelope';
import {
  AgentBrowserFacade,
  AgentBrowserService as ModuleAgentBrowserService,
  createAgentBrowserApi as createModuleAgentBrowserApi,
  createDefaultAgentBrowserCliRunner,
  setActiveWorkspaceProfileProvider,
  setPermissionDecisionRecorder,
  setDataDirProvider,
  setSensitiveCapturePolicyLoader,
  setWorkspaceRoot,
  type AgentBrowserHostApi,
} from '@verse-claw/versebrowser';

export async function assertBrowserAllowedUnderSandbox(action: string): Promise<void> {
  const actionClass = classifyAgentBrowserAction(action);
  if (!actionClass) return;
  const policy = await loadSandboxHighRiskPolicy();
  const decision = decideSandboxHighRiskAction(policy, actionClass, { allowApproval: false });
  if (decision.allowed) return;
  const workspace = await getActiveWorkspaceProfile();
  try {
    await recordPermissionDecisionEvent(createPermissionDecisionEvent({
      workspaceMode: workspace?.permissionMode ?? DEFAULT_WORKSPACE_PERMISSION_MODE,
      tool: `agentBrowser.${action}`,
      boundary: 'sandbox-runtime',
      decision: 'deny',
      reason: decision.reason,
    }));
  } catch (error) {
    throw new SandboxDenialError({
      mechanism: 'sandbox-gate',
      operation: 'browser',
      message: `Permission audit unavailable: ${error instanceof Error ? error.message : String(error)}`,
      requestedProviderId: policy.requestedProviderId,
      effectiveProviderId: policy.effectiveProviderId,
      runtimeLevel: policy.runtimeLevel,
    });
  }
  throw new SandboxDenialError({
    mechanism: 'sandbox-gate',
    operation: 'browser',
    message: decision.reason ?? 'Browser action denied under degraded sandbox',
    requestedProviderId: policy.requestedProviderId,
    effectiveProviderId: policy.effectiveProviderId,
    runtimeLevel: policy.runtimeLevel,
  });
}

setPermissionDecisionRecorder(recordPermissionDecisionEvent as never);
setActiveWorkspaceProfileProvider(getActiveWorkspaceProfile as never);
setSensitiveCapturePolicyLoader(async () => ({
  killSwitch: false,
  retentionMaxHours: 72,
  channels: {
    clipboard: { enabled: true, requireGrant: false },
    screenshot: { enabled: true, requireGrant: false },
    desktopAutomation: { enabled: true, requireGrant: false },
  },
  grants: [],
}));
setDataDirProvider(getHostDataDir);

async function prepareHostContext(): Promise<void> {
  try {
    const profile = await getActiveWorkspaceProfile();
    setWorkspaceRoot(profile?.rootPath);
  } catch {
    setWorkspaceRoot(undefined);
  }
}

class HostAgentBrowserService extends ModuleAgentBrowserService {
  async open(payload: Parameters<ModuleAgentBrowserService['open']>[0] = {}) {
    const result = await super.open(payload);
    recordResourceEnvelopeEntry({
      id: `main:browser-session:${result.session.id}`,
      workspaceKey: result.session.workspaceId ?? result.session.sessionKey ?? result.session.id,
      kind: 'browser-session',
      priority: 'foreground',
      owner: 'main',
      activeSlots: 1,
      queuedCount: 0,
      queueWaitMs: 0,
      processCount: 0,
      treeRssBytes: 0,
      treeCpuPercent: 0,
      reason: 'agent browser session',
    });
    return result;
  }

  close(sessionId: string): void {
    try {
      super.close(sessionId);
    } finally {
      removeResourceEnvelopeEntry(`main:browser-session:${sessionId}`);
    }
  }
}

let defaultAgentBrowserService: HostAgentBrowserService | undefined;

export function getDefaultAgentBrowserService(): ModuleAgentBrowserService {
  defaultAgentBrowserService ??= new HostAgentBrowserService({
    cliRunner: createDefaultAgentBrowserCliRunner(),
  });
  return defaultAgentBrowserService;
}

function withHostGuards(api: AgentBrowserHostApi): AgentBrowserHostApi {
  return new Proxy(api, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof prop !== 'string' || typeof value !== 'function') return value;
      const bound = value.bind(target);
      if (!classifyAgentBrowserAction(prop)) return bound;
      return async (...args: unknown[]) => {
        await prepareHostContext();
        await assertBrowserAllowedUnderSandbox(prop);
        if (prop === 'screenshot') {
          await assertSensitiveCaptureAllowed('screenshot', (args[0] as { grantId?: string } | undefined)?.grantId);
        } else if (prop === 'command') {
          await assertSensitiveCaptureAllowed('desktopAutomation', (args[0] as { grantId?: string } | undefined)?.grantId);
        }
        return await bound(...args);
      };
    },
  });
}

type ModuleMethod<K extends keyof AgentBrowserHostApi> = NonNullable<AgentBrowserHostApi[K]>;
type ModulePayload<K extends keyof AgentBrowserHostApi> = Parameters<ModuleMethod<K>>[0];

function fromToolResult(result: { ok: boolean; content: string; data?: unknown; evidence?: unknown[]; error?: unknown }) {
  return { success: result.ok, ...result };
}

export function createAgentBrowserApi(
  service: ModuleAgentBrowserService = getDefaultAgentBrowserService(),
  taskService?: Parameters<typeof createModuleAgentBrowserApi>[1],
  vault?: Parameters<typeof createModuleAgentBrowserApi>[2],
): CompleteHostServiceRegistry['agentBrowser'] {
  const api = createModuleAgentBrowserApi(service as never, taskService, vault);
  const withFacade = async <Args extends unknown[]>(method: (facade: AgentBrowserFacade, ...args: Args) => Promise<unknown>, ...args: Args) => {
    const facade = new AgentBrowserFacade({ api });
    return fromToolResult(await method(facade, ...args) as { ok: boolean; content: string; data?: unknown; evidence?: unknown[]; error?: unknown });
  };
  const extendedApi = {
    ...api,
    downloadFile: (payload: ModulePayload<'downloadFile'>) => withFacade((facade, input) => facade.downloadFile(input), payload),
    uploadFiles: (payload: ModulePayload<'uploadFiles'>) => withFacade((facade, input) => facade.uploadFiles(input), payload),
    pointer: (payload: ModulePayload<'pointer'>) => withFacade((facade, input) => facade.pointer(input), payload),
    drag: (payload: ModulePayload<'drag'>) => withFacade((facade, input) => facade.drag(input), payload),
    selectOption: (payload: ModulePayload<'selectOption'>) => withFacade((facade, input) => facade.selectOption(input.sessionId, input.selector, input.label, input.timeoutMs), payload),
    selectValues: (payload: ModulePayload<'selectValues'>) => withFacade((facade, input) => facade.selectValues(input.sessionId, input.selector, input.values, input.timeoutMs), payload),
    appendText: (payload: ModulePayload<'appendText'>) => withFacade((facade, input) => facade.appendText(input.sessionId, input.selector, input.text, input.timeoutMs), payload),
    setChecked: (payload: ModulePayload<'setChecked'>) => withFacade((facade, input) => facade.setChecked(input.sessionId, input.selector, input.checked, input.timeoutMs), payload),
    findElement: (payload: ModulePayload<'findElement'>) => withFacade((facade, input) => facade.findElement(input), payload),
    semanticRead: (payload: ModulePayload<'semanticRead'>, options?: { signal?: AbortSignal }) => withFacade((facade, input, readOptions) => facade.semanticRead(input, readOptions), payload, options),
    readForms: (payload: ModulePayload<'readForms'>) => withFacade((facade, input) => facade.readForms(input.sessionId, input.selector), payload),
    readDialogs: (payload: ModulePayload<'readDialogs'>) => withFacade((facade, input) => facade.readDialogs(input.sessionId), payload),
    respondDialog: (payload: ModulePayload<'respondDialog'>) => withFacade((facade, input) => facade.respondDialog(input.sessionId, input.dialogId, { accept: input.accept, promptText: input.promptText }), payload),
  } as unknown as AgentBrowserHostApi;
  return withHostGuards(extendedApi) as CompleteHostServiceRegistry['agentBrowser'];
}
