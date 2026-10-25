import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const service = {
    open: vi.fn(async (_payload?: unknown) => ({ session: { id: 's1' }, textSample: 'ok' })),
    list: vi.fn(() => []),
    close: vi.fn(),
  };
  const moduleApi = {
    open: vi.fn(async (payload: unknown) => ({ success: true, session: { id: 's1' }, payload })),
    status: vi.fn(() => ({ success: true, sessions: [] })),
    close: vi.fn(() => ({ success: true })),
  };
  const facadeResult = { ok: false, content: 'stale ref', data: { recoveryRef: 'r2' }, evidence: [{ id: 'e1' }], error: { code: 'STALE_REF', message: 'ref invalid' } };
  const facade = { downloadFile: vi.fn(async () => facadeResult) };
  const runner = { isAvailable: vi.fn(() => true) };
  const constructService = vi.fn();
  let currentRoot = 'D:/workspace-a';
  const module = {
    AgentBrowserService: class {
      constructor(options: unknown) { constructService(options); }
      open(payload: unknown) { return service.open(payload); }
      list() { return service.list(); }
      close(sessionId: string) { return service.close(sessionId); }
    },
    createDefaultAgentBrowserCliRunner: vi.fn(() => runner),
    AgentBrowserFacade: class { downloadFile = facade.downloadFile; getDriverProfile = () => ({ kind: 'injected', methods: null }); },
    createAgentBrowserApi: vi.fn(() => moduleApi),
    setPermissionDecisionRecorder: vi.fn(),
    setActiveWorkspaceProfileProvider: vi.fn(),
    setSensitiveCapturePolicyLoader: vi.fn(),
    setDataDirProvider: vi.fn(),
    setWorkspaceRoot: vi.fn((root: string) => { currentRoot = root; }),
    getWorkspaceRoot: vi.fn(() => currentRoot),
  };
  return {
    service,
    moduleApi,
    module,
    runner,
    constructService,
    facade,
    getProfile: vi.fn(async (): Promise<{ id: string; rootPath: string; permissionMode: string } | null> => ({ id: 'a', rootPath: 'D:/workspace-a', permissionMode: 'readOnly' })),
    recordPermission: vi.fn(async (event: unknown) => event),
    sensitive: vi.fn(async (channel: string) => ({ allowed: true, code: 'allow', reason: 'ok', channel })),
    findSessionGate: vi.fn(async (_sessionKey: string): Promise<{ operationId: string } | undefined> => undefined),
  };
});

vi.mock('@verse-claw/versebrowser', () => mocks.module);
vi.mock('@electron/services/workspaces-api', () => ({ getActiveWorkspaceProfile: mocks.getProfile }));
vi.mock('@electron/services/permissions-api', () => ({ recordPermissionDecisionEvent: mocks.recordPermission }));
vi.mock('@electron/services/sensitive-capture-gate', () => ({ assertSensitiveCaptureAllowed: mocks.sensitive }));
vi.mock('@electron/services/session-delete-gate', () => ({ findSessionDeleteGateBySession: mocks.findSessionGate }));

import { setSandboxHighRiskPolicyLoader } from '@electron/utils/sandbox-high-risk-gate';
import { createAgentBrowserApi, getDefaultAgentBrowserService } from '@electron/services/agent-browser-api';

describe('VerseBrowser host adapter ownership', () => {
  beforeEach(() => {
    mocks.service.open.mockClear();
    mocks.service.close.mockClear();
    mocks.moduleApi.open.mockReset().mockImplementation(async (payload: unknown) => ({ success: true, session: { id: 's1' }, payload }));
    mocks.moduleApi.status.mockClear();
    mocks.moduleApi.close.mockClear();
    mocks.module.createAgentBrowserApi.mockClear();
    mocks.getProfile.mockClear();
    mocks.recordPermission.mockClear();
    mocks.sensitive.mockClear();
    mocks.findSessionGate.mockReset().mockResolvedValue(undefined);
    mocks.getProfile.mockResolvedValue({ id: 'a', rootPath: 'D:/workspace-a', permissionMode: 'readOnly' });
    mocks.recordPermission.mockImplementation(async (event: unknown) => event);
  });

  it('injects host hooks and routes allowed calls through the module API', async () => {
    setSandboxHighRiskPolicyLoader(async () => ({ degraded: false }));
    try {
      const api = createAgentBrowserApi();
      expect(getDefaultAgentBrowserService()).toBe(getDefaultAgentBrowserService());
      // The desktop host must not hand the bundled CLI to the session engine (N8 F1):
      // whenever a CLI runner is injected, the package picks the agent-browser-cli engine
      // and loses takeSnapshot/clickByUid/fillByUid/pressKey.
      expect(mocks.constructService).toHaveBeenCalledTimes(1);
      const [serviceOptions] = mocks.constructService.mock.calls[0] as [ { cliRunner?: unknown } | undefined ];
      expect(serviceOptions?.cliRunner).toBeUndefined();
      expect(mocks.module.createDefaultAgentBrowserCliRunner).not.toHaveBeenCalled();
      await expect(api.open({ url: 'https://example.com' })).resolves.toMatchObject({ success: true, session: { id: 's1' } });
      expect(mocks.module.createAgentBrowserApi).toHaveBeenCalledTimes(1);
      expect(mocks.module.setPermissionDecisionRecorder).toHaveBeenCalledWith(mocks.recordPermission);
      expect(mocks.module.setActiveWorkspaceProfileProvider).toHaveBeenCalledWith(mocks.getProfile);
      expect(mocks.module.setDataDirProvider).toHaveBeenCalled();
      expect(mocks.module.setWorkspaceRoot).toHaveBeenCalledWith('D:/workspace-a');
    } finally {
      setSandboxHighRiskPolicyLoader(null);
    }
  });

  it('keeps the desktop capability snapshot free of CLI-dependent actions (N8 F1)', async () => {
    setSandboxHighRiskPolicyLoader(async () => ({ degraded: false }));
    try {
      const api = createAgentBrowserApi();
      const status = await api.status();
      const snapshot = (status as {
        capabilities?: { cliAvailable?: boolean; actions?: Array<{ action: string; available: boolean; reason?: string }> };
      }).capabilities;
      expect(snapshot?.cliAvailable).toBe(false);
      const command = snapshot?.actions?.find((entry) => entry.action === 'command');
      expect(command?.available).toBe(false);
      expect(command?.reason).toMatch(/agent-browser CLI/);
      // Everything the browser-window engine serves stays advertised.
      expect(snapshot?.actions?.find((entry) => entry.action === 'takeSnapshot')?.available).toBe(true);
    } finally {
      setSandboxHighRiskPolicyLoader(null);
    }
  });

  it('fails closed when the embedded module cannot be created', () => {
    mocks.module.createAgentBrowserApi.mockImplementationOnce(() => {
      throw Object.assign(new Error('Cannot find module @verse-claw/versebrowser'), { code: 'ERR_MODULE_NOT_FOUND' });
    });
    setSandboxHighRiskPolicyLoader(async () => ({ degraded: false }));
    try {
      expect(() => createAgentBrowserApi()).toThrow('Cannot find module @verse-claw/versebrowser');
      expect(mocks.service.open).not.toHaveBeenCalled();
    } finally {
      setSandboxHighRiskPolicyLoader(null);
    }
  });

  it('raises typed denial before the module call and records the deny decision', async () => {
    setSandboxHighRiskPolicyLoader(async () => ({
      degraded: true,
      requestedProviderId: 'docker-strong',
      effectiveProviderId: 'policy-light',
      runtimeLevel: 'policy',
    }));
    try {
      const api = createAgentBrowserApi();
      await expect(api.open({ url: 'https://example.com' })).rejects.toMatchObject({
        name: 'SandboxDenialError',
        code: 'SANDBOX_DENIED',
        mechanism: 'sandbox-gate',
        operation: 'browser',
      });
      expect(mocks.moduleApi.open).not.toHaveBeenCalled();
      expect(mocks.recordPermission).toHaveBeenCalledWith(expect.objectContaining({ decision: 'deny', tool: 'agentBrowser.open' }));
    } finally {
      setSandboxHighRiskPolicyLoader(null);
    }
  });

  it('fails closed when permission audit recording is unavailable', async () => {
    setSandboxHighRiskPolicyLoader(async () => ({
      degraded: true,
      requestedProviderId: 'docker-strong',
      effectiveProviderId: 'policy-light',
      runtimeLevel: 'policy',
    }));
    mocks.recordPermission.mockRejectedValueOnce(new Error('audit store unavailable'));
    try {
      const api = createAgentBrowserApi();
      await expect(api.open({ url: 'https://example.com' })).rejects.toMatchObject({
        name: 'SandboxDenialError',
        message: expect.stringContaining('Permission audit unavailable'),
      });
      expect(mocks.moduleApi.open).not.toHaveBeenCalled();
    } finally {
      setSandboxHighRiskPolicyLoader(null);
    }
  });

  it('preserves ToolResult content, evidence, recovery data, and error details', async () => {
    setSandboxHighRiskPolicyLoader(async () => ({ degraded: false }));
    try {
      const api = createAgentBrowserApi();
      await expect(api.downloadFile({ sessionId: 's1', selector: '#f', path: 'D:/tmp/f.bin' })).resolves.toMatchObject({
        success: false,
        ok: false,
        content: 'stale ref',
        data: { recoveryRef: 'r2' },
        evidence: [{ id: 'e1' }],
        error: { code: 'STALE_REF', message: 'ref invalid' },
      });
      expect(mocks.facade.downloadFile).toHaveBeenCalledWith({ sessionId: 's1', selector: '#f', path: 'D:/tmp/f.bin' });
    } finally {
      setSandboxHighRiskPolicyLoader(null);
    }
  });

it('rejects browser admission while a session lifecycle gate is open', async () => {
    setSandboxHighRiskPolicyLoader(async () => ({ degraded: false }));
    try {
      mocks.findSessionGate.mockResolvedValueOnce({ operationId: 'delete-e2' });
      const service = getDefaultAgentBrowserService();
      await expect(service.open({
        url: 'https://example.com',
        sessionKey: 'agent:main:long',
      })).rejects.toMatchObject({ code: 'E_SESSION_LIFECYCLE_FENCED' });
      expect(mocks.service.open).not.toHaveBeenCalled();
    } finally {
      setSandboxHighRiskPolicyLoader(null);
    }
  });

  it('requires an explicit agent approval for loopback and binds it to the request origin', async () => {
    setSandboxHighRiskPolicyLoader(async () => ({ degraded: false }));
    try {
      const api = createAgentBrowserApi();
      await expect(api.open({ url: 'http://127.0.0.1:4567/' })).rejects.toMatchObject({
        code: 'E_BROWSER_PRIVATE_NETWORK_DENIED',
      });
      expect(mocks.moduleApi.open).not.toHaveBeenCalled();
      await expect(api.open({
        url: 'http://127.0.0.1:4567/',
        privateNetworkApprovedBy: 'agent',
        privateNetworkOrigin: 'http://127.0.0.1:4567',
      })).resolves.toBeTruthy();
      expect(mocks.moduleApi.open).toHaveBeenCalledTimes(1);
      await expect(api.open({
        url: 'http://127.0.0.1:9999/',
        privateNetworkApprovedBy: 'agent',
        privateNetworkOrigin: 'http://127.0.0.1:9999',
      })).resolves.toBeTruthy();
    } finally {
      setSandboxHighRiskPolicyLoader(null);
    }
  });

  it('refreshes the workspace root between calls so separate workspaces do not share state', async () => {
    setSandboxHighRiskPolicyLoader(async () => ({ degraded: false }));
    try {
      const api = createAgentBrowserApi();
      await api.open({ url: 'https://example.com/a' });
      mocks.getProfile.mockResolvedValueOnce({ id: 'b', rootPath: 'D:/workspace-b', permissionMode: 'readWrite' });
      await api.open({ url: 'https://example.com/b' });
      expect(mocks.module.setWorkspaceRoot).toHaveBeenNthCalledWith(1, 'D:/workspace-a');
      expect(mocks.module.setWorkspaceRoot).toHaveBeenNthCalledWith(2, 'D:/workspace-b');
    } finally {
      setSandboxHighRiskPolicyLoader(null);
    }
  });

  it('resolves the browser resource scope from the active workspace, never from sessionKey', async () => {
    setSandboxHighRiskPolicyLoader(async () => ({ degraded: false }));
    try {
      const service = getDefaultAgentBrowserService();
      await service.open({ url: 'https://example.com/a', sessionKey: 'agent:main:one' });
      expect(mocks.service.open).toHaveBeenLastCalledWith(expect.objectContaining({
        workspaceId: 'a',
        sessionKey: 'agent:main:one',
      }));
      service.close('s1');

      mocks.getProfile.mockResolvedValueOnce(null);
      await service.open({ url: 'https://example.com/global', sessionKey: 'agent:main:two' });
      const globalCall = mocks.service.open.mock.calls.at(-1) as unknown[] | undefined;
      const globalPayload = globalCall?.[0] as { workspaceId?: string; sessionKey?: string } | undefined;
      expect(globalPayload?.workspaceId).toBeUndefined();
      expect(globalPayload?.sessionKey).toBe('agent:main:two');
      service.close('s1');
    } finally {
      setSandboxHighRiskPolicyLoader(null);
    }
  });

  it('rejects a caller-selected workspace that differs from the active workspace', async () => {
    setSandboxHighRiskPolicyLoader(async () => ({ degraded: false }));
    try {
      const service = getDefaultAgentBrowserService();
      await expect(service.open({ url: 'https://example.com', workspaceId: 'b' })).rejects.toMatchObject({
        code: 'E_WORKSPACE_MISMATCH',
      });
      expect(mocks.service.open).not.toHaveBeenCalled();
    } finally {
      setSandboxHighRiskPolicyLoader(null);
    }
  });});
