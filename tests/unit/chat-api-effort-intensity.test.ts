// @vitest-environment node
// W2: Main chat-api whitelist-validates reasoning effort / runtime intensity
// and forwards them as untrusted turn metadata without making authority decisions.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@electron/services/task-ledger-service', () => ({
  loadTaskLedgerSnapshot: vi.fn(),
}));

vi.mock('@electron/services/workspaces-api', () => ({
  getWorkspaceRootPathById: vi.fn(),
}));

describe('chat-api reasoning effort and runtime intensity forwarding (W2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function makeApi() {
    const { createChatApi } = await import('@electron/services/chat-api');
    const gatewayManager = {
      rpc: vi.fn(async () => ({ runId: 'run-effort' })),
      getStatus: vi.fn(() => ({ state: 'running', gatewayReady: true })),
    };
    return { api: createChatApi({ gatewayManager: gatewayManager as never }), gatewayManager };
  }

  it('forwards valid reasoning effort and runtime intensity to Gateway', async () => {
    const { api, gatewayManager } = await makeApi();
    const result = await api.sendWithMedia({
      sessionKey: 'agent:main:main',
      message: 'continue',
      idempotencyKey: 'idem-effort-1',
      reasoningEffort: 'high',
      runtimeIntensity: 'high',
    });
    expect(result.success).toBe(true);
    const payload = gatewayManager.rpc.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload.reasoningEffort).toBe('high');
    expect(payload.runtimeIntensity).toBe('high');
  });

  it('rejects invalid reasoning effort before Gateway dispatch', async () => {
    const { api, gatewayManager } = await makeApi();
    const result = await api.sendWithMedia({
      sessionKey: 'agent:main:main',
      message: 'continue',
      idempotencyKey: 'idem-effort-2',
      reasoningEffort: 'ultra' as never,
    });
    expect(result.success).toBe(false);
    expect(gatewayManager.rpc).not.toHaveBeenCalled();
  });

  it('rejects invalid runtime intensity before Gateway dispatch', async () => {
    const { api, gatewayManager } = await makeApi();
    const result = await api.sendWithMedia({
      sessionKey: 'agent:main:main',
      message: 'continue',
      idempotencyKey: 'idem-effort-3',
      runtimeIntensity: 'maximum' as never,
    });
    expect(result.success).toBe(false);
    expect(gatewayManager.rpc).not.toHaveBeenCalled();
  });

  it('omits fields when not requested', async () => {
    const { api, gatewayManager } = await makeApi();
    await api.sendWithMedia({
      sessionKey: 'agent:main:main',
      message: 'plain',
      idempotencyKey: 'idem-effort-4',
    });
    const payload = gatewayManager.rpc.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('reasoningEffort');
    expect(payload).not.toHaveProperty('runtimeIntensity');
  });
});
