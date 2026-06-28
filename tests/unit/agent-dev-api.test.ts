import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@electron/utils/store', () => ({
  getAllSettings: vi.fn(async () => ({
    theme: 'light',
    language: 'en',
    devModeUnlocked: true,
    gatewayAutoStart: true,
    roleMemoryEnabled: true,
  })),
  setSetting: vi.fn(async () => undefined),
}));

vi.mock('@electron/utils/logger', () => ({
  logger: {
    readLogFile: vi.fn(async () => 'log-tail'),
  },
}));

vi.mock('@electron/services/sandbox-api', () => ({
  buildSandboxStatus: vi.fn(async () => ({ available: true })),
}));

class GatewayManagerStub extends EventEmitter {
  getStatus() {
    return { state: 'running', port: 18789, gatewayReady: true };
  }

  getDiagnostics() {
    return { consecutiveHeartbeatMisses: 0, consecutiveRpcFailures: 0 };
  }

  getCapabilitySnapshot() {
    return { status: 'ready' };
  }
}

describe('agent dev api', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('exposes read-only status when agent dev mode is not enabled', async () => {
    delete process.env.VERSE_CLAW_E2E;
    delete process.env.CLAWX_AGENT_DEV;
    delete process.env.VERSE_CLAW_AGENT_DEV;
    process.env.NODE_ENV = 'production';
    const { createAgentDevApi } = await import('@electron/services/agent-dev-api');
    const api = createAgentDevApi({ gatewayManager: new GatewayManagerStub() as never });

    expect(api.status()).toMatchObject({ success: true, enabled: false });
    expect(() => api.resetState()).toThrow(/available only in dev/);
  });

  it('seeds scenarios and feature flags in E2E mode', async () => {
    process.env.VERSE_CLAW_E2E = '1';
    process.env.CLAWX_FLAGS = 'doctor-ui,doctor-ui,visual';
    const { createAgentDevApi } = await import('@electron/services/agent-dev-api');
    const api = createAgentDevApi({ gatewayManager: new GatewayManagerStub() as never });

    const seeded = await api.seedState({
      scenario: 'doctor-failed',
      settings: { theme: 'dark' },
      featureFlags: ['beta', 'alpha', 'beta'],
    });

    expect(seeded).toMatchObject({
      success: true,
      enabled: true,
      state: {
        scenario: 'doctor-failed',
        featureFlags: ['alpha', 'beta'],
      },
      applied: ['settings.theme'],
    });
    expect(api.featureFlags()).toEqual({ success: true, flags: ['alpha', 'beta'] });
  });

  it('creates in-memory conversations and provider seeds', async () => {
    process.env.VERSE_CLAW_E2E = '1';
    const { createAgentDevApi } = await import('@electron/services/agent-dev-api');
    const api = createAgentDevApi({ gatewayManager: new GatewayManagerStub() as never });

    const conversation = api.createConversation({ id: 'conv-1', title: 'Seeded', messages: [] });
    const provider = api.createProviderConfig({
      provider: { id: 'provider-1', name: 'Provider', type: 'custom', model: 'model-a' },
      apiKey: 'sk-test',
    });

    expect(conversation).toMatchObject({ success: true, conversation: { id: 'conv-1', title: 'Seeded' } });
    expect(provider).toMatchObject({
      success: true,
      provider: { id: 'provider-1', hasApiKey: true },
      state: { providers: [expect.objectContaining({ id: 'provider-1' })] },
    });
  });

  it('returns diagnostics, transport trace, and selector contracts', async () => {
    process.env.VERSE_CLAW_E2E = '1';
    const gatewayManager = new GatewayManagerStub();
    const { createAgentDevApi } = await import('@electron/services/agent-dev-api');
    const api = createAgentDevApi({ gatewayManager: gatewayManager as never });

    gatewayManager.emit('status', { state: 'starting', port: 18789 });

    await expect(api.diagnosticsSnapshot()).resolves.toMatchObject({
      success: true,
      snapshot: {
        gateway: { status: { state: 'running' } },
        recentTransportTrace: [expect.objectContaining({ label: 'status:starting' })],
      },
    });
    expect(api.transportTrace({ limit: 1 })).toMatchObject({
      success: true,
      events: [expect.objectContaining({ label: 'status:starting' })],
    });
    expect(api.selectorContract()).toMatchObject({
      success: true,
      requiredAttributes: ['data-testid'],
    });
  });
});
