import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceProfile } from '@shared/types/workspace';

const activeWorkspace = vi.hoisted(() => ({
  profile: null as WorkspaceProfile | null,
}));

const electronState = vi.hoisted(() => ({
  isPackaged: false,
}));

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return electronState.isPackaged;
    },
  },
}));

vi.mock('@electron/services/workspaces-api', () => ({
  getActiveWorkspaceProfile: vi.fn(async () => activeWorkspace.profile),
}));

vi.mock('@electron/utils/store', () => ({
  getSetting: vi.fn(async () => 'token'),
}));

vi.mock('@electron/utils/control-ui-device-pairing', () => ({
  scheduleControlUiDeviceAutoApproval: vi.fn(),
}));

function workspace(permissionMode: WorkspaceProfile['permissionMode'] = 'fullAccess'): WorkspaceProfile {
  return {
    id: 'workspace-1',
    name: 'Project',
    rootPath: process.cwd(),
    agentId: 'main',
    activeSessionKey: 'agent:main:main',
    permissionMode,
    createdAt: 1,
    updatedAt: 1,
    lastOpenedAt: 1,
    state: {},
  };
}

function restoreEnv(previous: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function setMockEnv({
  enabled = true,
  userData = 'C:/tmp/clawx-mock-userData',
  runtime = 'source',
}: {
  enabled?: boolean;
  userData?: string | null;
  runtime?: string | null;
} = {}): void {
  if (enabled) process.env.OPENCLAW_TEST_ENABLE_MOCK_PROVIDER = '1';
  else delete process.env.OPENCLAW_TEST_ENABLE_MOCK_PROVIDER;
  if (userData === null) delete process.env.CLAWX_USER_DATA_DIR;
  else process.env.CLAWX_USER_DATA_DIR = userData;
  if (runtime === null) delete process.env.CLAWX_OPENCLAW_RUNTIME;
  else process.env.CLAWX_OPENCLAW_RUNTIME = runtime;
}

describe('mock provider', () => {
  let previousEnv: Record<string, string | undefined>;

  beforeEach(() => {
    vi.clearAllMocks();
    activeWorkspace.profile = workspace('fullAccess');
    electronState.isPackaged = false;
    previousEnv = {
      OPENCLAW_TEST_ENABLE_MOCK_PROVIDER: process.env.OPENCLAW_TEST_ENABLE_MOCK_PROVIDER,
      CLAWX_USER_DATA_DIR: process.env.CLAWX_USER_DATA_DIR,
      CLAWX_OPENCLAW_RUNTIME: process.env.CLAWX_OPENCLAW_RUNTIME,
    };
  });

  afterEach(() => {
    restoreEnv(previousEnv);
  });

  it('is enabled only with flag, isolated userData, and source runtime', async () => {
    const { isMockProviderEnabled } = await import('@electron/services/mock-provider');

    setMockEnv();
    expect(isMockProviderEnabled()).toBe(true);

    setMockEnv({ enabled: false });
    expect(isMockProviderEnabled()).toBe(false);

    setMockEnv({ userData: null });
    expect(isMockProviderEnabled()).toBe(false);

    setMockEnv({ runtime: 'npm' });
    expect(isMockProviderEnabled()).toBe(false);

    setMockEnv({ runtime: null });
    expect(isMockProviderEnabled()).toBe(false);

    electronState.isPackaged = true;
    setMockEnv();
    expect(isMockProviderEnabled()).toBe(false);
  });

  it('returns fixed no-cost mock responses for chat.send and sessions.send', async () => {
    setMockEnv();
    const { handleMockChatSend, handleMockSessionSend } = await import('@electron/services/mock-provider');

    for (const response of [
      handleMockChatSend({ message: 'hello' }),
      handleMockSessionSend({ message: 'hello' }),
    ]) {
      expect(response).toMatchObject({
        ok: true,
        testOnly: true,
        source: 'mock',
        runId: expect.stringMatching(/^mock_\d+$/),
        mockProviderId: 'clawx-mock-provider',
        cost: 0,
        hasApiKey: false,
        hasExternalBaseUrl: false,
        fixedLocalResponse: true,
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
        },
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'MOCK_PROVIDER_RESPONSE' }],
        },
      });
    }
  });

  it('returns null for mock handlers when disabled', async () => {
    setMockEnv({ enabled: false });
    const { handleMockChatSend, handleMockSessionSend } = await import('@electron/services/mock-provider');

    expect(handleMockChatSend({ message: 'hello' })).toBeNull();
    expect(handleMockSessionSend({ message: 'hello' })).toBeNull();
  });

  it('intercepts chat.send and sessions.send through gateway.rpc without hitting gateway manager', async () => {
    setMockEnv();
    const gatewayManager = {
      getStatus: vi.fn(() => ({ state: 'running', port: 18789 })),
      rpc: vi.fn(async () => ({ ok: true })),
    };
    const backpressure = {
      run: vi.fn((method, params, timeoutMs, run) => run(method, params, timeoutMs)),
    };
    const { createGatewayApi } = await import('@electron/services/gateway-api');
    const api = createGatewayApi(gatewayManager as never, backpressure as never);

    await expect(api.rpc({
      method: 'chat.send',
      params: { sessionKey: 'agent:main:test', message: 'hello' },
    })).resolves.toMatchObject({
      ok: true,
      source: 'mock',
      cost: 0,
      runId: expect.stringMatching(/^mock_\d+$/),
    });
    await expect(api.rpc({
      method: 'sessions.send',
      params: { key: 'agent:main:test', message: 'hello' },
    })).resolves.toMatchObject({
      ok: true,
      source: 'mock',
      cost: 0,
      runId: expect.stringMatching(/^mock_\d+$/),
    });
    expect(gatewayManager.rpc).not.toHaveBeenCalled();
    expect(backpressure.run).not.toHaveBeenCalled();
  });

  it('falls through for non chat/session send RPCs', async () => {
    setMockEnv();
    const gatewayManager = {
      getStatus: vi.fn(() => ({ state: 'running', port: 18789 })),
      rpc: vi.fn(async () => ({ sessions: [] })),
    };
    const backpressure = {
      run: vi.fn((method, params, timeoutMs, run) => run(method, params, timeoutMs)),
    };
    const { createGatewayApi } = await import('@electron/services/gateway-api');
    const api = createGatewayApi(gatewayManager as never, backpressure as never);

    await expect(api.rpc({
      method: 'sessions.list',
      params: { limit: 1 },
    })).resolves.toEqual({ sessions: [] });
    expect(backpressure.run).toHaveBeenCalledWith(
      'sessions.list',
      { limit: 1 },
      undefined,
      expect.any(Function),
    );
    expect(gatewayManager.rpc).toHaveBeenCalledWith('sessions.list', { limit: 1 }, undefined);
  });

  it('intercepts typed chat.sendWithMedia before the gateway manager', async () => {
    setMockEnv();
    const gatewayManager = {
      rpc: vi.fn(async () => ({ runId: 'real-run' })),
    };
    const { createChatApi } = await import('@electron/services/chat-api');
    const api = createChatApi({ gatewayManager: gatewayManager as never });

    await expect(api.sendWithMedia({
      sessionKey: 'agent:main:test',
      message: 'hello',
      idempotencyKey: 'typed-chat',
    })).resolves.toMatchObject({
      success: true,
      result: {
        source: 'mock',
        cost: 0,
        runId: expect.stringMatching(/^mock_\d+$/),
      },
    });
    expect(gatewayManager.rpc).not.toHaveBeenCalled();
  });
});
