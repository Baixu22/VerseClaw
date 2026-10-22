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
  setActiveWorkspaceProfileProvider,
  setPermissionDecisionRecorder,
  setDataDirProvider,
  setSensitiveCapturePolicyLoader,
  setWorkspaceRoot,
  getWorkspaceRoot,
  type AgentBrowserHostApi,
} from '@verse-claw/versebrowser';
import {
  modelActionCapabilities,
  modelActionRequiresControl,
  type DriverProfileLike,
  type ModelActionCapabilitySnapshot,
} from './agent-browser-capabilities';

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
    const workspace = await getActiveWorkspaceProfile().catch(() => null);
    if (workspace && payload.workspaceId && payload.workspaceId !== workspace.id) {
      const error = new Error('Browser session workspace does not match the active workspace') as Error & { code?: string };
      error.code = 'E_WORKSPACE_MISMATCH';
      throw error;
    }
    const workspaceId = workspace?.id ?? payload.workspaceId;
    const result = await super.open(workspaceId ? { ...payload, workspaceId } : payload);
    recordResourceEnvelopeEntry({
      id: `main:browser-session:${result.session.id}`,
      // Resource accounting needs an owner-resolved scope. A host-global browser
      // opened before workspace selection is explicit; sessionKey is never an alias.
      workspaceKey: result.session.workspaceId ?? 'global',
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
  // Spec N3/N4 + L120: the desktop host serves managed sessions through the Electron
  // browser-window engine, and the bundled agent-browser CLI stays a *compat* surface
  // (the standalone/MCP facade builds its own service and injects the runner there).
  // Handing a CLI runner to this service flips every managed open() onto the
  // agent-browser-cli engine whenever the binary is bundled - the CLI engine cannot
  // serve takeSnapshot/clickByUid/fillByUid/pressKey, so the packaged app silently
  // lost the observation half of the model loop while status still advertised those
  // actions (N8 F1). Keep this service CLI-free.
  defaultAgentBrowserService ??= new HostAgentBrowserService({ managedEngine: 'browser-window' });
  return defaultAgentBrowserService;
}

/**
 * Real, side-effect-free model-action capability snapshot (spec N3).
 *
 * The profile is derived from the module driver api itself (`profileFromHostApi`), which
 * detects thin-driver refusal stubs by declaration shape and never infers capability from
 * a Proxy's function surface or from the 81-method contract. The facade wrappers in
 * `createAgentBrowserApi` are deliberately not used as the source: they exist for all 13
 * additions even when the driver refuses them.
 */
export function getAgentBrowserCapabilitiesFor(
  driverApi: AgentBrowserHostApi,
): ModelActionCapabilitySnapshot {
  // The facade owns the real DriverProfile: it is built to distinguish thin-driver
  // refusal stubs from genuinely served methods, so this never infers capability
  // from a Proxy's function surface or from the 81-method contract.
  const facade = new AgentBrowserFacade({ api: driverApi });
  // The desktop surface has no CLI session engine (see getDefaultAgentBrowserService),
  // so CLI-dependent actions such as `command` are reported unavailable here rather
  // than advertised and then failing at call time. This matches the verified N3
  // desktop capability receipt (cliAvailable:false, command unavailable).
  return modelActionCapabilities(facade.getDriverProfile() as DriverProfileLike, {
    cliAvailable: false,
  });
}

export function getAgentBrowserCapabilities(
  service: ModuleAgentBrowserService = getDefaultAgentBrowserService(),
): ModelActionCapabilitySnapshot {
  return getAgentBrowserCapabilitiesFor(
    createModuleAgentBrowserApi(service as never, {} as never, {} as never),
  );
}

/**
 * Spec N4 / AC-4: the global browser-control switch is a host-owned run-state
 * grant, never a model argument. When an owned runtime session asks for a
 * control-requiring action, Main grants it here and records the decision as
 * agent-driven; the model cannot pass `setEnabled`/`userApproval` itself.
 */
export async function ensureAgentBrowserControlForOwnedSession(
  service: ModuleAgentBrowserService,
  ownerKey: string,
  action: string,
  sessionId?: string,
): Promise<void> {
  if (!modelActionRequiresControl(action)) return;
  const typed = service as unknown as {
    isEnabled?: () => boolean;
    setEnabled?: (enabled: boolean) => unknown;
    list?: () => Array<{ id?: string; runtimeMode?: string }>;
    requestModeUpgrade?: (payload: Record<string, unknown>) => unknown;
  };
  if (typed.isEnabled?.() !== true) typed.setEnabled?.(true);
  const session = sessionId ? typed.list?.().find((entry) => entry.id === sessionId) : undefined;
  if (session && (session.runtimeMode ?? 'normal_restricted') === 'normal_restricted') {
    await typed.requestModeUpgrade?.({
      sessionId,
      targetMode: 'controlled_enhanced',
      userApproval: true,
      reason: `agent-driven host grant for owned runtime session ${ownerKey}`,
    });
  }
  const workspace = await getActiveWorkspaceProfile().catch(() => undefined);
  await recordPermissionDecisionEvent(createPermissionDecisionEvent({
    workspaceMode: workspace?.permissionMode ?? DEFAULT_WORKSPACE_PERMISSION_MODE,
    tool: `agentBrowser.${action}`,
    boundary: 'gateway-rpc',
    decision: 'allow',
    reason: `agent-driven host grant for owned runtime session ${ownerKey}`,
  })).catch(() => undefined);
}

/**
 * Main-side capability gate (spec N3 / AC-2).
 *
 * Every model-action entry point — the renderer IPC path and the Gateway bridge —
 * goes through this adapter, so an unavailable action is rejected here before the
 * service can produce any browser effect, even if a caller forges the call
 * outside the model schema. `status` gains the snapshot so discovery is
 * side-effect free and comes from the same facts as the rejection.
 */
function withCapabilityGate<T extends object>(
  api: T,
  snapshot: ModelActionCapabilitySnapshot,
): T {
  const verdict = new Map(snapshot.actions.map((entry) => [entry.action as string, entry]));
  return new Proxy(api, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof prop !== 'string' || typeof value !== 'function') return value;
      const entry = verdict.get(prop);
      if (!entry) return value.bind(target);
      const bound = value.bind(target);
      if (!entry.available) {
        return async () => {
          const error = new Error(
            `Agent browser action "${prop}" is not available: ${entry.reason ?? 'unavailable'}`,
          ) as Error & { code?: string };
          error.name = 'AgentBrowserCapabilityError';
          error.code = 'E_CAPABILITY_UNAVAILABLE';
          throw error;
        };
      }
      if (prop !== 'status') return bound;
      return async (...args: unknown[]) => {
        const result = await bound(...args);
        return result && typeof result === 'object'
          ? { ...(result as Record<string, unknown>), capabilities: snapshot }
          : result;
      };
    },
  }) as T;
}

function withHostGuards<T extends object>(api: T): T {
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
  }) as T;
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
  // Spec N4 / AC-2: refs, observation baselines and re-observe state must survive
  // across calls. One facade per adapter instance (i.e. per Main process) keeps
  // that state; rebuilding a facade per call silently dropped it.
  let sharedFacade: AgentBrowserFacade | undefined;
  let sharedFacadeRoot: string | undefined;
  const getFacade = (): AgentBrowserFacade => {
    // Reuse within one workspace so refs/baselines survive across calls, but
    // rebuild when the workspace changes so two workspaces never share state.
    const root = getWorkspaceRoot();
    if (!sharedFacade || sharedFacadeRoot !== root) {
      sharedFacade = new AgentBrowserFacade({ api });
      sharedFacadeRoot = root;
    }
    return sharedFacade;
  };
  const withFacade = async <Args extends unknown[]>(method: (facade: AgentBrowserFacade, ...args: Args) => Promise<unknown>, ...args: Args) => {
    return fromToolResult(await method(getFacade(), ...args) as { ok: boolean; content: string; data?: unknown; evidence?: unknown[]; error?: unknown });
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
    verifyFlow: (payload: Parameters<AgentBrowserFacade['verifyFlow']>[0]) => withFacade((facade, input) => facade.verifyFlow(input), payload),
  } as unknown as CompleteHostServiceRegistry['agentBrowser'];
  // The gate reads the REAL module driver api (not the facade wrappers) so the 13
  // additions stay unavailable even though `extendedApi` defines a wrapper for each.
  const capabilities = getAgentBrowserCapabilitiesFor(api as unknown as AgentBrowserHostApi);
  return withHostGuards(withCapabilityGate(extendedApi, capabilities));
}
