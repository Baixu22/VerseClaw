import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const service = {
    open: vi.fn(async () => ({ session: { id: 's1' }, textSample: 'ok' })),
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
  const module = {
    AgentBrowserService: class {
      constructor(options: unknown) { constructService(options); }
      open = service.open; list = service.list; close = service.close;
    },
    createDefaultAgentBrowserCliRunner: vi.fn(() => runner),
    AgentBrowserFacade: class { downloadFile = facade.downloadFile; },
    createAgentBrowserApi: vi.fn(() => moduleApi),
    setPermissionDecisionRecorder: vi.fn(),
    setActiveWorkspaceProfileProvider: vi.fn(),
    setSensitiveCapturePolicyLoader: vi.fn(),
    setDataDirProvider: vi.fn(),
    setWorkspaceRoot: vi.fn(),
  };
  return {
    service,
    moduleApi,
    module,
    runner,
    constructService,
    facade,
    getProfile: vi.fn(async () => ({ id: 'a', rootPath: 'D:/workspace-a', permissionMode: 'readOnly' })),
    recordPermission: vi.fn(async (event: unknown) => event),
    sensitive: vi.fn(async (channel: string) => ({ allowed: true, code: 'allow', reason: 'ok', channel })),
  };
});

vi.mock('@verse-claw/versebrowser', () => mocks.module);
vi.mock('@electron/services/workspaces-api', () => ({ getActiveWorkspaceProfile: mocks.getProfile }));
vi.mock('@electron/services/permissions-api', () => ({ recordPermissionDecisionEvent: mocks.recordPermission }));
vi.mock('@electron/services/sensitive-capture-gate', () => ({ assertSensitiveCaptureAllowed: mocks.sensitive }));

import { setSandboxHighRiskPolicyLoader } from '@electron/utils/sandbox-high-risk-gate';
import { createAgentBrowserApi, getDefaultAgentBrowserService } from '@electron/services/agent-browser-api';

describe('VerseBrowser host adapter ownership', () => {
  beforeEach(() => {
    mocks.service.open.mockClear();
    mocks.service.close.mockClear();
    mocks.moduleApi.open.mockClear();
    mocks.moduleApi.status.mockClear();
    mocks.moduleApi.close.mockClear();
    mocks.module.createAgentBrowserApi.mockClear();
    mocks.getProfile.mockClear();
    mocks.recordPermission.mockClear();
    mocks.sensitive.mockClear();
    mocks.getProfile.mockResolvedValue({ id: 'a', rootPath: 'D:/workspace-a', permissionMode: 'readOnly' });
    mocks.recordPermission.mockImplementation(async (event: unknown) => event);
  });

  it('injects host hooks and routes allowed calls through the module API', async () => {
    setSandboxHighRiskPolicyLoader(async () => ({ degraded: false }));
    try {
      const api = createAgentBrowserApi();
      expect(getDefaultAgentBrowserService()).toBe(getDefaultAgentBrowserService());
      expect(mocks.constructService).toHaveBeenCalledWith({ cliRunner: mocks.runner });
      expect(mocks.module.createDefaultAgentBrowserCliRunner).toHaveBeenCalledTimes(1);
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
});
