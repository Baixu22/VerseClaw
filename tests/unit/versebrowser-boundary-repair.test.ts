import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@electron/services/workspaces-api', () => ({
  getActiveWorkspaceProfile: vi.fn(async () => ({ id: 'audit', rootPath: 'D:/tmp/verse-boundary-test', permissionMode: 'readOnly' })),
}));
vi.mock('@electron/services/permissions-api', () => ({ recordPermissionDecisionEvent: vi.fn(async (event: unknown) => event) }));
vi.mock('@electron/services/sensitive-capture-gate', () => ({ assertSensitiveCaptureAllowed: vi.fn(async () => ({ allowed: true })) }));
vi.mock('@electron/services/session-delete-gate', () => ({ findSessionDeleteGateBySession: vi.fn(async () => undefined) }));
const transportMock = vi.hoisted(() => ({ resolveHost: vi.fn(async (_hostname: string) => ({ endpoints: [{ address: '93.184.216.34', family: 'ipv4' }] })) }));
vi.mock('@electron/services/agent-browser-network-proxy', () => ({ createBrowserNetworkProxy: vi.fn(async (options: { lookupAddresses: (hostname: string) => Promise<unknown> }) => ({ url: 'http://127.0.0.1:18080', credentials: { username: 'fixture', password: 'fixture' }, onClose: vi.fn(), resolveAddresses: options.lookupAddresses, revokeConnections: vi.fn(), close: vi.fn() })) }));
vi.mock('electron', () => ({ app: { getPath: () => 'D:/tmp/verse-boundary-test', on: vi.fn(), off: vi.fn() }, session: { defaultSession: { resolveProxy: vi.fn(async () => 'DIRECT') }, fromPartition: () => ({ resolveHost: transportMock.resolveHost, resolveProxy: vi.fn(async () => 'DIRECT'), setProxy: vi.fn(async () => {}), closeAllConnections: vi.fn(async () => {}) }) } }));

import {
  approveBrowserPrivateNetwork, assertBrowserRequestAllowed, createAgentBrowserApi,
  HostAgentBrowserService, setBrowserFirstPartyOriginProvider,
} from '@electron/services/agent-browser-api';
import { registerAgentBrowserGatewayBridge } from '@electron/gateway/agent-browser-bridge';
import { setSandboxHighRiskPolicyLoader } from '@electron/utils/sandbox-high-risk-gate';
import { createAgentBrowserTool, type AgentBrowserInvoker } from '../../openclaw_runtime/src/agents/tools/agent-browser-tool';

type RequestDetails = { url: string; webContentsId?: number; resourceType: string };
type RequestHandler = (details: RequestDetails, callback: (response: { cancel: boolean }) => void) => void;
type BridgeReply = { ok: boolean; payload?: { success: boolean; sessions?: unknown[] }; error?: { code: string } };
const hosts: HostAgentBrowserService[] = [];
let nextWindowId = 1;

beforeEach(() => {
  transportMock.resolveHost.mockReset().mockResolvedValue({ endpoints: [{ address: '93.184.216.34', family: 'ipv4' }] });
  setSandboxHighRiskPolicyLoader(async () => ({ degraded: false }));
  setBrowserFirstPartyOriginProvider(() => []);
});
afterEach(() => {
  for (const host of hosts.splice(0)) for (const session of host.list()) host.close(session.id);
  setSandboxHighRiskPolicyLoader(null);
  setBrowserFirstPartyOriginProvider(null);
});

function hostFixture(optionalResource?: string) {
  let requestHandler: RequestHandler;
  const session = {
    webRequest: { onBeforeRequest: vi.fn((handler: RequestHandler) => { requestHandler = handler; }) },
    resolveHost: transportMock.resolveHost,
  };
  const windows: ReturnType<typeof makeWindow>[] = [];
  function makeWindow() {
    let currentUrl = '';
    let destroyed = false;
    const webContents = Object.assign(new EventEmitter(), {
      id: nextWindowId++, session,
      setWindowOpenHandler: vi.fn(), getURL: () => currentUrl, getTitle: () => 'Fixture',
      setWebRTCIPHandlingPolicy: vi.fn(),
      executeJavaScript: vi.fn(async () => 'fixture text'),
    });
    const request = (url: string, resourceType = 'xhr') => new Promise<{ cancel: boolean }>((resolve) => {
      requestHandler({ url, resourceType, webContentsId: webContents.id }, resolve);
    });
    return {
      webContents, request, isDestroyed: () => destroyed, show: vi.fn(), setBounds: vi.fn(),
      close: vi.fn(() => webContents.emit('destroyed')),
      destroy: vi.fn(() => { destroyed = true; webContents.emit('destroyed'); }),
      loadURL: async (url: string) => {
        if ((await request(url, 'mainFrame')).cancel) throw new Error('request blocked');
        if (optionalResource) await request(optionalResource, 'image');
        currentUrl = url;
        webContents.emit('did-finish-load');
      },
    };
  }
  const host = new HostAgentBrowserService({ managedEngine: 'browser-window', createWindow: () => {
    const window = makeWindow(); windows.push(window); return window as never;
  } });
  hosts.push(host);
  const api = createAgentBrowserApi(host, {} as never);
  const unattributedRequest = (url: string) => new Promise<{ cancel: boolean }>(resolve => requestHandler({ url, resourceType: 'xhr' }, resolve));
  return { host, api, windows, session, unattributedRequest };
}

async function dispatch(fixture: ReturnType<typeof hostFixture>, action: string, payload: Record<string, unknown>, owner?: string) {
  const manager = Object.assign(new EventEmitter(), { rpc: vi.fn(async () => undefined) });
  const dispose = registerAgentBrowserGatewayBridge(manager as never, fixture.host, fixture.api);
  try {
    manager.emit('notification', { method: 'agentBrowser.invoke.request', params: {
      requestId: 'boundary-test', action, payload, ...(owner === undefined ? {} : { correlation: { sessionKey: owner } }),
    } });
    await vi.waitFor(() => expect(manager.rpc).toHaveBeenCalledOnce());
    return (manager.rpc.mock.calls[0] as unknown[])[1] as BridgeReply;
  } finally { dispose(); }
}

describe('Verse browser authority through the production Main API', () => {
  it.each(['click', 'type'] as const)('preserves owner correlation through the model %s preflight and actual Main action', async (action) => {
    const f = hostFixture();
    const opened = await f.api.open({ sessionKey: 'model-owner' });
    const calls: Array<{ action: string; owner?: string }> = [];
    const invoke: AgentBrowserInvoker = async (action, payload, correlation) => {
      calls.push({ action, owner: correlation?.sessionKey });
      const reply = await dispatch(f, action, payload, correlation?.sessionKey);
      if (!reply.ok) throw new Error(reply.error?.code);
      return reply.payload;
    };
    const tool = createAgentBrowserTool({ invoke, correlation: { sessionKey: 'model-owner' }, availableActions: ['status', action] });
    await tool!.execute('model-action', { action, sessionId: opened.session.id, selector: '#target', text: 'fixture' });
    expect(calls).toEqual([{ action: 'status', owner: 'model-owner' }, { action, owner: 'model-owner' }]);
  });

  it.each(['requestModeUpgrade', 'setEnabled', 'fullAccessRevoke', 'newPage'])('rejects host-only action %s before service effects', async (action) => {
    const f = hostFixture();
    const opened = await f.api.open({ sessionKey: 'owner' });
    const reply = await dispatch(f, action, { sessionId: opened.session.id }, 'owner');
    expect(reply).toMatchObject({ ok: false, error: { code: 'E_CAPABILITY_UNAVAILABLE' } });
    expect(f.host.list()[0].runtimeMode).toBe('normal_restricted');
    expect(f.windows).toHaveLength(1);
  });

  it.each([{ userApproval: true }, { runtimeMode: 'full_access' }, { privateNetworkApprovedBy: 'agent' }])('refuses model-authored authority on open: %j', async (authority) => {
    const f = hostFixture();
    expect(await dispatch(f, 'open', authority, 'owner')).toMatchObject({ ok: false, error: { code: 'E_HOST_AUTHORITY_REQUIRED' } });
    expect(f.windows).toHaveLength(0);
  });

  it('rejects absent/mismatched owners and payload impersonation, but allows the owning caller', async () => {
    const f = hostFixture();
    const opened = await f.api.open({ sessionKey: 'owner-b' });
    const payload = { sessionId: opened.session.id };
    expect(await dispatch(f, 'close', payload)).toMatchObject({ ok: false, error: { code: 'E_OWNER_MISSING' } });
    expect(await dispatch(f, 'close', payload, 'owner-a')).toMatchObject({ ok: false, error: { code: 'E_OWNER_MISMATCH' } });
    expect(await dispatch(f, 'open', { sessionKey: 'owner-b' }, 'owner-a')).toMatchObject({ ok: false, error: { code: 'E_OWNER_MISMATCH' } });
    expect(f.host.list()).toHaveLength(1);
    expect(await dispatch(f, 'status', {})).toMatchObject({ ok: true, payload: { sessions: [] } });
    expect(await dispatch(f, 'close', payload, 'owner-b')).toMatchObject({ ok: true });
    expect(f.host.list()).toHaveLength(0);
  });

  it('guards ordinary-session requests, DNS resolution and additional tabs with the same owner', async () => {
    const f = hostFixture();
    const opened = await f.api.open({ sessionKey: 'owner' });
    expect(f.session.webRequest.onBeforeRequest).toHaveBeenCalledOnce();
    expect(await f.windows[0].request('https://example.com/public')).toEqual({ cancel: false });
    expect(await f.windows[0].request('http://127.0.0.1:8765/private')).toEqual({ cancel: true });
    f.session.resolveHost.mockResolvedValueOnce({ endpoints: [{ address: '192.168.1.2', family: 'ipv4' }] });
    expect(await f.windows[0].request('https://example.com/rebound')).toEqual({ cancel: true });
    approveBrowserPrivateNetwork({ sessionId: opened.session.id, origin: 'http://127.0.0.1:8765' });
    expect(await f.windows[0].request('http://127.0.0.1:8765/approved')).toEqual({ cancel: false });
    await f.host.newPage({ sessionId: opened.session.id, background: true });
    expect(await f.windows[1].request('http://127.0.0.1:8765/approved')).toEqual({ cancel: false });
    expect(await f.windows[1].request('http://127.0.0.1:8766/other')).toEqual({ cancel: true });
    const popupHandler = f.windows[0].webContents.setWindowOpenHandler.mock.calls[0][0] as () => { action: string };
    expect(popupHandler()).toEqual({ action: 'deny' });
  });

  it('consumes an opening grant exactly once and transfers it to the created session before navigation', async () => {
    const f = hostFixture();
    approveBrowserPrivateNetwork({ sessionId: 'opening-owner', origin: 'http://127.0.0.1:8767' });
    const payload = { sessionKey: 'opening-owner', url: 'http://127.0.0.1:8767/' };
    const results = await Promise.allSettled([f.api.open({ ...payload }), f.api.open({ ...payload })]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(f.windows).toHaveLength(1);
    const id = f.host.list()[0].id;
    expect(await f.windows[0].request(payload.url)).toEqual({ cancel: false });
    f.host.close(id);
    await expect(assertBrowserRequestAllowed(payload.url, { sessionId: id })).rejects.toMatchObject({ code: 'E_BROWSER_PRIVATE_NETWORK_DENIED' });
  });

  it('transfers an explicit opening grant for a hostname whose DNS destination is private', async () => {
    const f = hostFixture();
    f.session.resolveHost.mockResolvedValue({ endpoints: [{ address: '192.168.1.2', family: 'ipv4' }] });
    approveBrowserPrivateNetwork({ sessionId: 'dns-owner', origin: 'http://intranet.example' });
    const opened = await f.api.open({ sessionKey: 'dns-owner', url: 'http://intranet.example/' });
    expect(opened.success).toBe(true);
    expect(await f.windows[0].request('http://intranet.example/next')).toEqual({ cancel: false });
    await expect(f.api.open({ sessionKey: 'dns-owner', url: 'http://intranet.example/' })).rejects.toThrow();
    expect(f.host.list()).toHaveLength(1);
  });

  it('destroys owned tabs and sessions even when a page would cancel ordinary close', async () => {
    const f = hostFixture();
    const opened = await f.api.open({ sessionKey: 'close-owner' });
    const extra = await f.host.newPage({ sessionId: opened.session.id, background: true });
    for (const window of f.windows) window.close.mockImplementation(() => false);
    await f.host.closePage({ sessionId: opened.session.id, pageId: extra.pages[1].pageId });
    expect(f.windows[1].isDestroyed()).toBe(true);
    expect(f.windows[0].isDestroyed()).toBe(false);
    await f.api.close({ sessionId: opened.session.id });
    expect(f.windows[0].isDestroyed()).toBe(true);
    expect(f.host.list()).toHaveLength(0);
    expect(await f.windows[0].request('http://127.0.0.1:9901/background')).toEqual({ cancel: true });
    expect(f.windows.every(window => window.close.mock.calls.length === 0)).toBe(true);
  });

  it('destroys a new tab whose initial private request is denied before registration', async () => {
    const f = hostFixture();
    const opened = await f.api.open({ sessionKey: 'tab-owner' });
    await expect(f.host.newPage({ sessionId: opened.session.id, url: 'http://127.0.0.1:9901/unapproved', background: true })).rejects.toThrow();
    expect(f.windows[1].isDestroyed()).toBe(true);
    expect((await f.host.listPages({ sessionId: opened.session.id })).pages).toHaveLength(1);
    expect(await f.windows[0].request('https://example.com/still-owned')).toEqual({ cancel: false });
  });

  it('retires a session and its grants when its main window is closed outside the host API', async () => {
    const f = hostFixture();
    const opened = await f.api.open({ sessionKey: 'native-close' });
    await f.host.newPage({ sessionId: opened.session.id, background: true });
    approveBrowserPrivateNetwork({ sessionId: opened.session.id, origin: 'http://127.0.0.1:9966' });
    f.windows[0].destroy();
    expect(f.host.list()).toHaveLength(0);
    expect(f.windows[1].isDestroyed()).toBe(true);
    await expect(assertBrowserRequestAllowed('http://127.0.0.1:9966/', { sessionId: opened.session.id })).rejects.toThrow();
  });

  it('preserves long runtime owners and disables direct WebRTC UDP on every managed window', async () => {
    const f = hostFixture();
    const owner = 'agent:' + 'a'.repeat(300);
    const opened = await f.api.open({ sessionKey: owner });
    expect(opened.session.sessionKey).toBe(owner);
    expect(await dispatch(f, 'close', { sessionId: opened.session.id }, owner.slice(0, 200))).toMatchObject({ ok: false });
    await f.host.newPage({ sessionId: opened.session.id, background: true });
    expect(f.windows.every(window => window.webContents.setWebRTCIPHandlingPolicy.mock.calls[0][0] === 'disable_non_proxied_udp')).toBe(true);
  });

  it('never lends another live session grant to an unattributed request in a shared profile', async () => {
    const f = hostFixture();
    const first = await f.api.open({ sessionKey: 'first' });
    const second = await f.api.open({ sessionKey: 'second' });
    const url = 'http://127.0.0.1:9902/';
    approveBrowserPrivateNetwork({ sessionId: second.session.id, origin: 'http://127.0.0.1:9902' });
    f.host.close(first.session.id);
    expect(await f.unattributedRequest(url)).toEqual({ cancel: true });
    expect(await f.unattributedRequest('https://example.com/public')).toEqual({ cancel: false });
    expect(await f.windows[1].request(url)).toEqual({ cancel: false });
    f.host.close(second.session.id);
    expect(await f.unattributedRequest('https://example.com/public')).toEqual({ cancel: true });
  });

  it('blocks a failed optional resource without destroying an otherwise loaded ordinary page', async () => {
    const f = hostFixture('https://missing.invalid/image');
    f.session.resolveHost.mockImplementation(async hostname => {
      if (hostname === 'missing.invalid') throw new Error('DNS unavailable');
      return { endpoints: [{ address: '93.184.216.34', family: 'ipv4' }] };
    });
    const result = await f.api.open({ sessionKey: 'ordinary', url: 'https://example.com/' });
    expect(result.success).toBe(true);
    expect(f.windows[0].isDestroyed()).toBe(false);
    expect(f.host.list()).toHaveLength(1);
    expect(await f.windows[0].request('https://missing.invalid/image')).toEqual({ cancel: true });
  });

  it.each(['owned', 'unattributed'])('revokes a pending %s request when its window closes during DNS lookup', async kind => {
    const f = hostFixture();
    const opened = await f.api.open({ sessionKey: 'pending' });
    let resolveDns!: (value: { endpoints: Array<{ address: string; family: string }> }) => void;
    f.session.resolveHost.mockReturnValue(new Promise(resolve => { resolveDns = resolve; }));
    const pending = kind === 'owned'
      ? f.windows[0].request('https://example.com/pending')
      : f.unattributedRequest('https://example.com/pending');
    await vi.waitFor(() => expect(f.session.resolveHost).toHaveBeenCalledOnce());
    f.host.close(opened.session.id);
    resolveDns({ endpoints: [{ address: '93.184.216.34', family: 'ipv4' }] });
    expect(await pending).toEqual({ cancel: true });
  });
});

describe('Request-time network policy', () => {
  it('rejects expired grants, mapped private IPv6, failed DNS and cross-session reuse', async () => {
    const url = 'http://127.0.0.1:8877/';
    approveBrowserPrivateNetwork({ sessionId: 'expired', origin: 'http://127.0.0.1:8877', ttlMs: -1 });
    await expect(assertBrowserRequestAllowed(url, { sessionId: 'expired' })).rejects.toMatchObject({ code: 'E_BROWSER_PRIVATE_NETWORK_DENIED' });
    approveBrowserPrivateNetwork({ sessionId: 'right', origin: 'http://127.0.0.1:8877' });
    await expect(assertBrowserRequestAllowed(url, { sessionId: 'wrong' })).rejects.toMatchObject({ code: 'E_BROWSER_PRIVATE_NETWORK_DENIED' });
    await expect(assertBrowserRequestAllowed('https://example.com', { sessionId: 'right' }, async () => [{ address: '::ffff:7f00:1' }])).rejects.toMatchObject({ code: 'E_BROWSER_PRIVATE_NETWORK_DENIED' });
    await expect(assertBrowserRequestAllowed('https://example.com', { sessionId: 'right' }, async () => [])).rejects.toMatchObject({ code: 'E_BROWSER_DNS_UNAVAILABLE' });
  });
});
