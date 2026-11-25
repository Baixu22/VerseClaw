import { app, session as electronSession } from 'electron';
import { createHash, randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { createBrowserNetworkProxy } from './agent-browser-network-proxy';
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
import { findSessionDeleteGateBySession } from './session-delete-gate';
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
import {
  browserOriginOf,
  createBrowserPrivateNetworkApproval,
  decideBrowserNavigation,
  type BrowserPrivateNetworkApproval,
} from '@shared/agent-browser/private-network-policy';

/**
 * TF-0503: approvals for private-network navigation, bounded per supervised session+origin.
 * There is no global switch and no implicit bypass; the grant itself is agent-driven
 * (driven_by=agent) and recorded so evidence can prove where it came from.
 */
const privateNetworkApprovals = new Map<string, BrowserPrivateNetworkApproval>();
// Only the host wrapper can reserve an opening grant. It is consumed by the
// first request's real session id, before initial navigation or redirects.
const privateNetworkOpenApprovals = new WeakMap<object, BrowserPrivateNetworkApproval>();
const privateNetworkPreparedApprovals = new WeakMap<BrowserPrivateNetworkApproval, BrowserPrivateNetworkApproval>();

function revokeBrowserPrivateNetworkApprovals(sessionId: string): void {
  for (const [key, approval] of privateNetworkApprovals) {
    if (approval.sessionId === sessionId) privateNetworkApprovals.delete(key);
  }
}

/** Actions whose payload carries a navigation target subject to the private-network guard. */
const NAVIGATION_ACTIONS = new Set<string>(['navigate', 'open', 'createTask']);

function navigationTarget(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const record = payload as Record<string, unknown>;
  const value = record.url;
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function sessionIdOf(payload: unknown, opening = false): string {
  if (!payload || typeof payload !== 'object') return 'unbound';
  const record = payload as Record<string, unknown>;
  for (const key of opening ? ['sessionKey', 'agentSessionKey'] : ['sessionId', 'sessionKey', 'agentSessionKey']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return 'unbound';
}

/**
 * Origins the host itself owns for the active workspace: the preview the user
 * already started. Read from Main-side persisted workspace state, never from the
 * caller payload, so a model cannot widen its own network reach just by naming a
 * localhost URL. A wrong workspace id, missing state or any read failure yields an
 * empty allowlist (fail closed).
 */
export type BrowserFirstPartyOriginContext = {
  workspaceId?: string;
  sessionKey?: string;
  profile: {
    id: string;
    state?: { webPreview?: { targetUrl?: string | null; previewUrl?: string | null; url?: string | null } };
    sessionStates?: Record<
      string,
      { webPreview?: { targetUrl?: string | null; previewUrl?: string | null; url?: string | null } }
    >;
  } | null;
};

export type BrowserFirstPartyOriginProvider = (
  context: BrowserFirstPartyOriginContext,
) => Promise<string[]> | string[];

/**
 * Default provider: the active workspace's own preview origins, matched strictly
 * by workspace id. Sensitive to host state only, so the caller payload cannot
 * manufacture an exception for an arbitrary private address.
 */
const defaultFirstPartyOriginProvider: BrowserFirstPartyOriginProvider = (context) => {
  const { workspaceId, sessionKey, profile } = context;
  if (!profile) return [];
  if (workspaceId && profile.id !== workspaceId) return [];
  const states = [profile.state, sessionKey ? profile.sessionStates?.[sessionKey] : undefined];
  const origins = new Set<string>();
  for (const state of states) {
    const preview = state?.webPreview;
    if (!preview) continue;
    for (const candidate of [preview.targetUrl, preview.previewUrl, preview.url]) {
      const origin = typeof candidate === 'string' ? browserOriginOf(candidate) : undefined;
      if (origin) origins.add(origin);
    }
  }
  return [...origins];
};

let firstPartyOriginProvider: BrowserFirstPartyOriginProvider = defaultFirstPartyOriginProvider;

/** Test/diagnostic seam, mirroring the setActiveWorkspaceProfileProvider pattern. */
export function setBrowserFirstPartyOriginProvider(
  provider: BrowserFirstPartyOriginProvider | null,
): void {
  firstPartyOriginProvider = provider ?? defaultFirstPartyOriginProvider;
}

async function resolveFirstPartyOrigins(payload: unknown): Promise<string[]> {
  if (!payload || typeof payload !== 'object') return [];
  const record = payload as Record<string, unknown>;
  const workspaceId = typeof record.workspaceId === 'string' ? record.workspaceId.trim() : '';
  const sessionKey = typeof record.sessionKey === 'string' ? record.sessionKey.trim() : '';
  try {
    const profile = await getActiveWorkspaceProfile();
    return await firstPartyOriginProvider({ workspaceId, sessionKey, profile });
  } catch {
    // Fail closed: no provider result means no private exception.
    return [];
  }
}

/**
 * Default-deny gate for private-network navigation. Public URLs pass untouched;
 * a private target is allowed only when it is the host's own running preview
 * (loopback only) or a bounded approval exists for this session and origin.
 */
export async function assertBrowserNavigationAllowed(
  action: string,
  payload: unknown,
): Promise<void> {
  await resolveBrowserNavigationApproval(action, payload);
}

export async function assertBrowserRequestAllowed(
  url: string,
  context: { sessionId?: string; sessionKey?: string; workspaceId?: string },
  lookupAddresses: (hostname: string) => Promise<Array<{ address: string }>> = (hostname) => lookup(hostname, { all: true }),
): Promise<void> {
  const target = new URL(url);
  // These resources do not issue a network request. Their subsequent fetches
  // still pass through this guard. WebSocket handshakes use the same origin grant.
  if (['about:', 'data:', 'blob:'].includes(target.protocol)) return;
  if (target.protocol === 'ws:') target.protocol = 'http:';
  if (target.protocol === 'wss:') target.protocol = 'https:';
  const hostname = target.hostname.replace(/^\[|\]$/gu, '');
  const addresses = isIP(hostname) ? [{ address: hostname }] : await lookupAddresses(hostname);
  if (addresses.length === 0 || addresses.some(({ address }) => !isIP(address))) {
    throw Object.assign(new Error('Browser request DNS returned no valid addresses'), { code: 'E_BROWSER_DNS_UNAVAILABLE' });
  }
  const decision = decideBrowserNavigation({
    url: target.href,
    sessionId: context.sessionId ?? 'unbound',
    firstPartyOrigins: context.sessionId ? await resolveFirstPartyOrigins(context) : [],
    approvals: context.sessionId ? [...privateNetworkApprovals.values()] : [],
    resolvedAddresses: addresses.map(({ address }) => address),
  });
  if (!decision.allowed) {
    throw Object.assign(new Error(`Agent browser request blocked: ${decision.reason} (address class ${decision.addressClass})`), {
      code: 'E_BROWSER_PRIVATE_NETWORK_DENIED',
    });
  }
}

async function resolveBrowserNavigationApproval(
  action: string,
  payload: unknown,
): Promise<BrowserPrivateNetworkApproval | undefined> {
  if (!NAVIGATION_ACTIONS.has(action)) return;
  const url = navigationTarget(payload);
  if (!url) return;
  const sessionId = sessionIdOf(payload, action === 'open');
  const firstPartyOrigins = await resolveFirstPartyOrigins(payload);
  const decision = decideBrowserNavigation({
    url,
    sessionId,
    approvals: [...privateNetworkApprovals.values()],
    firstPartyOrigins,
  });
  if (decision.allowed) {
    // A public-looking hostname may resolve privately at request time. Reserve
    // its explicit host grant too, so the real browser session receives it.
    const approval = privateNetworkApprovals.get(`${sessionId}|${browserOriginOf(url)}`);
    return approval && approval.expiresAt > Date.now() ? approval : undefined;
  }
  const error = new Error(
    `Agent browser ${action} blocked: ${decision.reason} (address class ${decision.addressClass})`,
  ) as Error & { code?: string };
  error.name = 'BrowserPrivateNetworkError';
  error.code = 'E_BROWSER_PRIVATE_NETWORK_DENIED';
  throw error;
}

/** Approve one private origin for one supervised session (bounded, never global). */
export function approveBrowserPrivateNetwork(input: { sessionId: string; origin: string; ttlMs?: number }): BrowserPrivateNetworkApproval {
  if (!input.sessionId.trim() || input.sessionId === 'unbound' || browserOriginOf(input.origin) !== input.origin) {
    throw new Error('Private-network approval requires a bound session and an exact origin');
  }
  const approval = createBrowserPrivateNetworkApproval({
    sessionId: input.sessionId,
    origin: input.origin,
    grantedBy: 'agent',
    ...(input.ttlMs !== undefined ? { ttlMs: input.ttlMs } : {}),
  });
  privateNetworkApprovals.set(`${approval.sessionId}|${approval.origin}`, approval);
  return approval;
}

import {
  assertPermissionEffectOwnerCheckpoint,
  permissionEffectBindingFor,
} from '../../shared/permission-effect-contract';

type AgentBrowserPermissionEffectInput = {
  action: string;
  requestId: string;
  sessionKey?: string;
  workspaceId?: string;
  runId?: string;
  taskId?: string;
  sessionId?: string;
};

export function assertAgentBrowserPermissionEffect(
  input: AgentBrowserPermissionEffectInput,
): void {
  const binding = permissionEffectBindingFor('browser');
  if (!binding) throw new Error('permission-effect-binding-missing');
  const nowMs = Date.now();
  const rawSessionKey = input.sessionKey?.trim() || `browser:${input.requestId}`;
  // Receipt actor keys are bounded independently of runtime session identity.
  // Hash, never truncate: distinct owners must not collapse to the same prefix.
  const sessionKey = rawSessionKey.length <= 256 ? rawSessionKey
    : `browser-owner:${createHash('sha256').update(rawSessionKey).digest('hex')}`;
  const workspaceId = input.workspaceId?.trim() || 'workspace-global';
  const sessionId = input.sessionId?.trim();
  const effectDigest = createHash('sha256')
    .update([input.requestId, input.action, workspaceId, sessionKey, sessionId ?? ''].join('\0'))
    .digest('hex');
  const resource = sessionId
    ? `browser-session:${effectDigest.slice(0, 24)}`
    : `browser-action:${input.action}`;
  const policyDigest = `sha256:${createHash('sha256')
    .update([input.action, workspaceId, sessionKey, sessionId ?? ''].join('\0'))
    .digest('hex')}`;
  assertPermissionEffectOwnerCheckpoint({
    componentId: 'browser',
    subject: {
      sessionKey,
      runId: input.runId?.trim() || input.requestId,
      attemptIndex: 0,
      modelCallIndex: 0,
      actorKind: 'principal',
      workspaceId,
      taskBranchId: input.taskId?.trim() || input.runId?.trim() || input.requestId,
    },
    request: {
      requestId: `browser-request-${effectDigest.slice(0, 24)}`,
      action: input.action,
      resource,
      purpose: `execute ${input.action} for the owning runtime session`,
      idempotencyKey: `browser-effect-${effectDigest.slice(0, 32)}`,
    },
    authorityOwner: binding.finalAuthorityOwner,
    decisionRef: `browser-decision-${effectDigest.slice(0, 24)}`,
    policyDigest,
    issuedAtMs: nowMs,
    expiresAtMs: nowMs + 30_000,
    nowMs,
    revocationEpoch: 'browser-session-revocation:v1',
    policyEpoch: policyDigest,
    catalogEpoch: 'agent-browser-action-catalog:v1',
  });
}

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

export class HostAgentBrowserService extends ModuleAgentBrowserService {
  private readonly networkProfiles = new Map<string, Promise<Awaited<ReturnType<typeof createBrowserNetworkProxy>>>>();
  private readonly networkSessions = new Map<string, { profile: string; sessionKey?: string; workspaceId?: string }>();
  private readonly openingNetworkGrants = new Map<string, BrowserPrivateNetworkApproval>();
  private readonly lastProxyUrls = new Map<string, string>();
  protected override async resolveBrowserAddresses(profile: string, hostname: string) {
    const proxy = await this.networkProfiles.get(profile);
    if (!proxy) throw new Error('Browser network owner is unavailable');
    return proxy.resolveAddresses(hostname);
  }

  protected override async fetchBrowserResource(session: ReturnType<ModuleAgentBrowserService['list']>[number], url: string, init?: RequestInit): Promise<Response> {
    const owner = this.networkSessions.get(session.id);
    const pending = owner && this.networkProfiles.get(owner.profile);
    const proxy = await pending;
    if (!owner || !proxy) throw new Error('Browser network owner is unavailable');
    await assertBrowserRequestAllowed(url, { ...owner, sessionId: session.id }, proxy.resolveAddresses);
    if (this.networkSessions.get(session.id) !== owner || this.networkProfiles.get(owner.profile) !== pending) {
      throw new Error('Browser network owner changed');
    }
    return proxy.fetch(url, init);
  }

  protected override browserWindowDestroyed(sessionId: string): void {
    const owner = this.networkSessions.get(sessionId);
    if (owner) void this.networkProfiles.get(owner.profile)?.then(proxy => proxy.revokeConnections()).catch(() => undefined);
  }

  protected override async prepareBrowserSession(session: ReturnType<ModuleAgentBrowserService['list']>[number], partition: string): Promise<void> {
    this.networkSessions.set(session.id, { profile: session.profile, sessionKey: session.sessionKey, workspaceId: session.workspaceId });
    const openingGrant = session.sessionKey ? this.openingNetworkGrants.get(session.sessionKey) : undefined;
    if (openingGrant) {
      this.openingNetworkGrants.delete(session.sessionKey!);
      const preparedApproval = { ...openingGrant, sessionId: session.id };
      privateNetworkPreparedApprovals.set(openingGrant, preparedApproval);
      privateNetworkApprovals.set(`${session.id}|${openingGrant.origin}`, preparedApproval);
    }
    let pending = this.networkProfiles.get(session.profile);
    if (!pending) {
      pending = (async () => {
        const transport = electronSession.fromPartition(partition);
        const upstreamRoute = await transport.resolveProxy('https://example.com');
        const systemRoute = await electronSession.defaultSession.resolveProxy('https://example.com');
        const ownPreviousProxy = this.lastProxyUrls.get(session.profile);
        if (upstreamRoute !== systemRoute && upstreamRoute !== `PROXY ${ownPreviousProxy ? new URL(ownPreviousProxy).host : ''}`) {
          throw new Error('Browser network requires an upstream proxy; direct egress is refused');
        }
        const proxy = await createBrowserNetworkProxy({
          resolveUpstreamProxy: url => electronSession.defaultSession.resolveProxy(url),
          lookupAddresses: async hostname => (await transport.resolveHost(hostname)).endpoints.map(endpoint => ({ address: endpoint.address, family: endpoint.family === 'ipv4' ? 4 : 6 })),
          authorize: async (url, addresses, tunnel) => {
            const owners = [...this.networkSessions].filter(([, owner]) => owner.profile === session.profile);
            if (owners.length === 0) throw new Error('Browser network profile has no live owner');
            let expiresAt: number | undefined;
            // Electron pools connections per persistent profile, not browser tab.
            // A private tunnel is allowed only while every owner of that shared
            // transport permits it; it cannot borrow another session's grant.
            for (const [sessionId, owner] of owners) {
              const firstPartyOrigins = await resolveFirstPartyOrigins(owner);
              const targets = [url];
              if (tunnel) {
                // CONNECT carries no URL scheme and Chromium also uses it for ws.
                // The per-request guard enforces the precise ws/wss origin; here
                // either scheme must authorize this same host and numeric port.
                const target = new URL(url);
                targets.push(`http://${target.hostname}:${target.port || '443'}/`);
              }
              const allowed = targets.map(target => ({ target, decision: decideBrowserNavigation({ url: target, sessionId,
                approvals: [...privateNetworkApprovals.values()], firstPartyOrigins, resolvedAddresses: addresses }) })).find(result => result.decision.allowed);
              if (!allowed) throw new Error('Browser destination denied by profile owners');
              if (allowed.decision.allowed && allowed.decision.reason === 'approved-private') {
                const grant = privateNetworkApprovals.get(`${sessionId}|${browserOriginOf(allowed.target)}`);
                if (!grant) throw new Error('Browser private grant expired');
                expiresAt = Math.min(expiresAt ?? grant.expiresAt, grant.expiresAt);
              }
            }
            return expiresAt;
          },
        });
        const onLogin = (event: Electron.Event, contents: Electron.WebContents, _details: Electron.AuthenticationResponseDetails, authInfo: Electron.AuthInfo, callback: (username?: string, password?: string) => void) => {
          if (!authInfo.isProxy || authInfo.host !== '127.0.0.1' || authInfo.port !== Number(new URL(proxy.url).port) || contents?.session !== transport) return;
          event.preventDefault(); callback(proxy.credentials.username, proxy.credentials.password);
        };
        app.on('login', onLogin);
        proxy.onClose(() => app.off('login', onLogin));
        try {
          await transport.setProxy({ mode: 'fixed_servers', proxyRules: proxy.url, proxyBypassRules: '<-loopback>' });
          this.lastProxyUrls.set(session.profile, proxy.url);
          await transport.closeAllConnections();
          return proxy;
        } catch (error) { proxy.close(); throw error; }
      })();
      this.networkProfiles.set(session.profile, pending);
    }
    try {
      const proxy = await pending;
      proxy.revokeConnections(); // Joining a profile changes its permission intersection.
    } catch (error) {
      if (this.networkProfiles.get(session.profile) === pending) this.networkProfiles.delete(session.profile);
      throw error;
    }
  }

  async open(payload: Parameters<ModuleAgentBrowserService['open']>[0] = {}) {
    const sessionKey = payload.sessionKey?.trim();
    if (sessionKey && await findSessionDeleteGateBySession(sessionKey)) {
      const error = new Error('Session lifecycle mutation is in progress; browser admission is fenced') as Error & { code?: string };
      error.code = 'E_SESSION_LIFECYCLE_FENCED';
      throw error;
    }
    const workspace = await getActiveWorkspaceProfile().catch(() => null);
    if (workspace && payload.workspaceId && payload.workspaceId !== workspace.id) {
      const error = new Error('Browser session workspace does not match the active workspace') as Error & { code?: string };
      error.code = 'E_WORKSPACE_MISMATCH';
      throw error;
    }
    const workspaceId = workspace?.id ?? payload.workspaceId;
    const openingApproval = privateNetworkOpenApprovals.get(payload);
    if (openingApproval && sessionKey) this.openingNetworkGrants.set(sessionKey, openingApproval);
    let result: Awaited<ReturnType<ModuleAgentBrowserService['open']>>;
    try {
      result = await super.open(workspaceId ? { ...payload, workspaceId } : payload, async (url, options) => {
        const proxy = await this.networkProfiles.get(options.profile);
        if (!proxy) throw new Error('Browser network owner is unavailable');
        await assertBrowserRequestAllowed(url, { sessionId: options.sessionId, sessionKey, workspaceId }, proxy.resolveAddresses);
      });
    } finally {
      if (sessionKey) this.openingNetworkGrants.delete(sessionKey);
    }
    if (!super.list().some(session => session.id === result.session.id)) {
      throw Object.assign(new Error('Agent browser session closed while opening'), { code: 'E_BROWSER_SESSION_CLOSED' });
    }
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

  async close(sessionId: string): Promise<void> {
    revokeBrowserPrivateNetworkApprovals(sessionId);
    try {
      await super.close(sessionId);
    } finally {
      // Retain network ownership if native cleanup is still unconfirmed.
      if (!super.list().some(session => session.id === sessionId)) {
        const owner = this.networkSessions.get(sessionId);
        this.networkSessions.delete(sessionId);
        if (owner) {
          const pending = this.networkProfiles.get(owner.profile);
          const profileActive = [...this.networkSessions.values()].some(entry => entry.profile === owner.profile);
          if (!profileActive) this.networkProfiles.delete(owner.profile);
          void pending?.then(proxy => profileActive ? proxy.revokeConnections() : proxy.close()).catch(() => undefined);
        }
        removeResourceEnvelopeEntry(`main:browser-session:${sessionId}`);
        revokeBrowserPrivateNetworkApprovals(sessionId);
      }
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
/**
 * TF-0503: close every live host Browser session so a cancel, timeout or
 * restart cannot leave an orphan session (and its resource-envelope entry)
 * behind. Returns the ids it closed. Never throws: a session that refuses to
 * close is reported in `failed` so the caller can surface it.
 */
type AgentBrowserSessionHost = {
  list?: () => Array<{ id?: string }>;
  close?: (sessionId: string) => void | Promise<void>;
};

export async function closeAllAgentBrowserSessions(
  service: AgentBrowserSessionHost = getDefaultAgentBrowserService() as unknown as AgentBrowserSessionHost,
): Promise<{ closed: string[]; failed: string[] }> {
  const closed: string[] = [];
  const failed: string[] = [];
  let sessions: Array<{ id?: string }>;
  try {
    sessions = service.list?.() ?? [];
  } catch {
    return { closed, failed };
  }
  for (const session of sessions) {
    const id = typeof session?.id === 'string' ? session.id : '';
    if (!id) continue;
    try {
      // Close through the same service that listed the session, so the reaper is
      // coherent and testable: never list from one owner and close through another.
      if (typeof service.close !== 'function') throw new Error('Browser close owner is unavailable');
      await service.close(id);
      removeResourceEnvelopeEntry(`main:browser-session:${id}`);
      closed.push(id);
    } catch {
      failed.push(id);
    }
  }
  return { closed, failed };
}

/**
 * Register the shutdown reaper on Electron's quit lifecycle. Called from the
 * Main process; kept lazy and opt-in so importing this module outside Electron
 * (unit tests, tooling) never touches the `electron` runtime.
 */
let shutdownReaperRegistered = false;

export function registerAgentBrowserShutdownReaper(): void {
  // Outside the Electron main process (unit tests, tooling) `app` is undefined, so
  // registration is a no-op instead of a crash.
  if (!app || typeof app.on !== 'function') return;
  if (shutdownReaperRegistered) return;
  shutdownReaperRegistered = true;
  app.on('will-quit', () => {
    try {
      void closeAllAgentBrowserSessions();
    } catch {
      // best effort: quitting must never block on a browser session
    }
  });
}

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
      if (prop === 'status') return bound;
      const requiresSandboxCheck = classifyAgentBrowserAction(prop) !== null;
      return async (...args: unknown[]) => {
        await prepareHostContext();
        const privateApproval = await resolveBrowserNavigationApproval(prop, args[0]);
        if (requiresSandboxCheck) {
          await assertBrowserAllowedUnderSandbox(prop);
        }
        const payload = args[0] && typeof args[0] === 'object'
          ? args[0] as Record<string, unknown>
          : {};
        const sessionKey = typeof payload.sessionKey === 'string'
          ? payload.sessionKey
          : typeof payload.agentSessionKey === 'string'
            ? payload.agentSessionKey
            : undefined;
        const requestId = typeof payload.requestId === 'string'
          ? payload.requestId
          : `ipc-${randomUUID()}`;
        if (prop !== 'status') {
          assertAgentBrowserPermissionEffect({
            action: prop,
            requestId,
            ...(sessionKey ? { sessionKey } : {}),
            workspaceId: getWorkspaceRoot(),
            ...(typeof payload.runId === 'string' ? { runId: payload.runId } : {}),
            ...(typeof payload.taskId === 'string' ? { taskId: payload.taskId } : {}),
            ...(typeof payload.sessionId === 'string' ? { sessionId: payload.sessionId } : {}),
          });
        }
        if (prop === 'screenshot') {
          await assertSensitiveCaptureAllowed('screenshot', (args[0] as { grantId?: string } | undefined)?.grantId);
        } else if (prop === 'command') {
          await assertSensitiveCaptureAllowed('desktopAutomation', (args[0] as { grantId?: string } | undefined)?.grantId);
        }
        if (prop === 'open' && privateApproval) {
          const approvalKey = `${privateApproval.sessionId}|${privateApproval.origin}`;
          if (privateNetworkApprovals.get(approvalKey) !== privateApproval || privateApproval.expiresAt <= Date.now()) {
            throw Object.assign(new Error('Private-network approval expired or was already consumed'), { code: 'E_BROWSER_PRIVATE_NETWORK_DENIED' });
          }
          privateNetworkApprovals.delete(approvalKey);
          privateNetworkOpenApprovals.set(payload, privateApproval);
        }
        let result: unknown;
        try {
          result = await bound(...args);
        } finally {
          privateNetworkOpenApprovals.delete(payload);
        }
        if (prop === 'open' && privateApproval) {
          const session = result && typeof result === 'object'
            ? (result as { session?: { id?: string } }).session
            : undefined;
          if (session?.id && privateApproval.expiresAt > Date.now()) {
            const prepared = privateNetworkPreparedApprovals.get(privateApproval);
            if (prepared) {
              if (prepared.sessionId !== session.id || privateNetworkApprovals.get(`${session.id}|${prepared.origin}`) !== prepared) {
                throw Object.assign(new Error('Private-network opening approval changed before completion'), { code: 'E_BROWSER_PRIVATE_NETWORK_DENIED' });
              }
            } else {
              privateNetworkApprovals.set(`${session.id}|${privateApproval.origin}`, { ...privateApproval, sessionId: session.id });
            }
          }
        } else if (prop === 'close') {
          revokeBrowserPrivateNetworkApprovals(sessionIdOf(payload));
        }
        return result;
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
  // Build the adapter once per Main process: hook the shutdown reaper so live
  // sessions cannot outlive the app (TF-0503: cancel / timeout / restart clean-up).
  registerAgentBrowserShutdownReaper();
  return withHostGuards(withCapabilityGate(extendedApi, capabilities));
}
