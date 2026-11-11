import { EventEmitter } from 'node:events';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
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
    const workbench = await api.workbenchEvidence();
    expect(workbench).toMatchObject({
      success: true,
      evidence: {
        scenarioCount: expect.any(Number),
        hostApi: {
          missingFacadeActions: [],
          missingServiceActions: [],
        },
        contracts: {
          traceTimeline: true,
          costReport: true,
          skillSandboxReport: true,
          selectorContract: true,
        },
      },
    });
    // R5-2: Workbench evidence 必须暴露审计证据年龄与 deep-test 决策(报告缺失时为 null/空)。
    expect(Object.hasOwn(workbench.evidence, 'evidenceAgeHours')).toBe(true);
    expect(workbench.evidence.evidenceAgeHours === null || typeof workbench.evidence.evidenceAgeHours === 'number').toBe(true);
    expect(workbench.evidence.maxEvidenceAgeHours === null || typeof workbench.evidence.maxEvidenceAgeHours === 'number').toBe(true);
    expect(Array.isArray(workbench.evidence.requiredFullGates)).toBe(true);
    expect(workbench.evidence.decisionStatus === null || typeof workbench.evidence.decisionStatus === 'string').toBe(true);
  });

  it('collects real dispatcher channels and deduplicates message usage against final run totals', async () => {
    process.env.VERSE_CLAW_E2E = '1';
    const { createAgentDevApi } = await import('@electron/services/agent-dev-api');
    const gateway = new GatewayManagerStub();
    const api = createAgentDevApi({ gatewayManager: gateway as never });
    api.resetState();
    const message = { runId: 'run-1', sessionKey: 'agent:main:test', requestId: 'req-1', state: 'final', message: {
      id: 'm1', usage: { input: 100, output: 50, totalTokens: 150 },
    } };
    gateway.emit('chat:message', message);
    gateway.emit('chat:message', message);
    expect((await api.costReport()).report.totals.totalTokens).toBe(150);
    gateway.emit('chat:runtime-event', { type: 'tool.completed', runId: 'run-1', sessionKey: 'agent:main:test', seq: 1,
      toolCallId: 'tool-1', name: 'read', result: 'secret must not enter the trace', isError: false });
    gateway.emit('chat:runtime-event', { type: 'run.ended', runId: 'run-1', sessionKey: 'agent:main:test', seq: 2,
      status: 'completed', tokenUsage: { input: 100, output: 50, total: 150 } });
    expect((await api.traceTimeline({ requestId: 'req-1' })).events).toHaveLength(4);
    expect((await api.traceTimeline({ requestId: 'run-1' })).events).toHaveLength(4);
    expect((await api.costReport()).report.totals.totalTokens).toBe(150);
    expect((await api.costReport()).report.byAgent.main.totalTokens).toBe(150);
    expect((await api.skillSandboxReport()).report.effects).toMatchObject([{ capability: 'filesystem', allowed: true }]);
    expect(JSON.stringify((await api.traceTimeline({})).events)).not.toContain('secret must not enter');
  });

  it('retains distinct model messages and failed tool observations', async () => {
    process.env.VERSE_CLAW_E2E = '1';
    const { createAgentDevApi } = await import('@electron/services/agent-dev-api');
    const gateway = new GatewayManagerStub();
    const api = createAgentDevApi({ gatewayManager: gateway as never });
    api.resetState();
    for (const id of ['one', 'two']) gateway.emit('chat:message', { runId: 'run-2', sessionKey: 'agent:worker:test', message: {
      id, usage: { input: 10, output: 5, cost: { total: 0.01 } },
    } });
    gateway.emit('chat:runtime-event', { type: 'tool.completed', runId: 'run-2', seq: 1, toolCallId: 'web-1', name: 'web_fetch', isError: true });
    expect((await api.costReport()).report.totals).toMatchObject({ inputTokens: 20, outputTokens: 10, totalTokens: 30, estimatedCost: 0.02 });
    gateway.emit('chat:runtime-event', { type: 'run.ended', runId: 'run-2', seq: 2, status: 'completed', tokenUsage: { input: 20, output: 10, total: 30 } });
    expect((await api.costReport()).report.totals).toMatchObject({ totalTokens: 30, estimatedCost: 0.02 });
    expect((await api.skillSandboxReport()).report.effects).toMatchObject([{ capability: 'network', allowed: false }]);
  });

  it('records redacted scenario artifacts with a human promotion checklist', async () => {
    process.env.VERSE_CLAW_E2E = '1';
    const cwd = process.cwd();
    const root = join(cwd, 'artifacts', `agent-dev-recording-test-${Date.now()}`);
    const { createAgentDevApi } = await import('@electron/services/agent-dev-api');
    const api = createAgentDevApi({ gatewayManager: new GatewayManagerStub() as never });

    try {
      await mkdir(root, { recursive: true });
      process.chdir(root);
      await api.seedState({
        scenario: 'doctor-failed',
        metadata: {
          apiKey: 'sk_should_not_survive',
          visible: 'Authorization: Bearer abcdefghijklmnop',
        },
      });
      const result = await api.recordScenario({
        slug: 'redaction-smoke',
        route: '/settings/advanced',
        visibleState: {
          token: 'plain-token',
          note: 'password=super-secret',
        },
      });
      const text = await readFile(result.artifactPath, 'utf8');

      expect(text).toContain('clawx.agent-dev.scenario-recording.v1');
      expect(text).toContain('promotionTargets');
      expect(text).toContain('[redacted]');
      expect(text).not.toContain('sk_should_not_survive');
      expect(text).not.toContain('abcdefghijklmnop');
      expect(text).not.toContain('super-secret');
    } finally {
      process.chdir(cwd);
      await rm(root, { recursive: true, force: true });
    }
  });
});
