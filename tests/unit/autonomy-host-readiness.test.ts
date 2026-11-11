// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { SessionEffectivePolicy } from '@shared/types/session-effective-policy';
import { createEmptySessionActivitySnapshot } from '@shared/types/session-activity';
import { GatewayCapabilityMonitor } from '@electron/gateway/capability-monitor';
import { buildSessionHostReadiness } from '@electron/gateway/session-host-readiness';

vi.mock('@electron/services/git-api', () => ({ createGitApi: () => ({ status: async () => ({ success: false }) }) }));
vi.mock('@electron/services/task-ledger-api', () => ({ createTaskLedgerApi: () => ({ snapshot: async () => ({ success: false }) }) }));
vi.mock('@electron/services/long-session-resource-reclamation', () => ({ collectLongSessionResourceInventory: async () => null }));
import { createSessionActivityApi } from '@electron/services/session-activity-api';

const NOW = Date.parse('2026-11-02T10:00:00Z');
function policy(): SessionEffectivePolicy {
  const unobserved = { value: null, status: 'unverified', source: 'fixture-unobserved', reason: null } as const;
  const axis = { configured: unobserved, effective: unobserved };
  return {
    schemaVersion: 'SessionEffectivePolicy/v1', generatedAt: new Date(NOW).toISOString(),
    scope: { workspaceId: 'workspace-a', sessionKey: 'session-a', sessionId: 'session-generation', agentId: 'main', runId: 'run-a' },
    generation: { state: 'effective', runtimeGeneration: 'runtime-generation', capabilityProfileGeneration: 'runtime-generation', observedAt: new Date(NOW).toISOString(), reason: null },
    backend: { configured: unobserved, effective: { status: 'effective', value: { runtime: 'openclaw', kind: 'openclaw', ownsNativeCompaction: false, provider: 'scripted-local', model: 'fixture' }, source: 'runtime-owner', reason: null } },
    harness: axis, model: axis, grants: axis, context: axis, queue: axis, resources: axis, schedule: axis,
    compatibility: [], sources: ['fixture-unobserved'],
    tools: { status: 'effective', value: { names: ['read'], digest: 'sha256:tools' }, source: 'runtime-effective-capability.observation.effectiveToolNames', reason: null },
  };
}
function input() {
  const monitor = new GatewayCapabilityMonitor();
  return {
    workspaceId: 'workspace-a', sessionKey: 'session-a', sessionId: 'session-generation', policy: policy(),
    gateway: monitor.buildSnapshot({ status: { state: 'running' as const, port: 18789, gatewayReady: true }, transportConnected: true, diagnostics: { consecutiveHeartbeatMisses: 0, consecutiveRpcFailures: 0 } }),
    runtimeGeneration: 'runtime-generation', cronEnabled: true, connectionUnchanged: true, nowMs: NOW,
  };
}

describe('TF-0674 current host capability projection', () => {
  it('projects current owner observations without converting them into permission or measured budgets', () => {
    const result = buildSessionHostReadiness(input());
    expect(result.runtime.state).toBe('supported');
    expect(result.tools).toMatchObject({ state: 'unknown', reason: 'adapter-health-not-probed' });
    expect(result.scheduling).toMatchObject({ state: 'supported', source: 'cron.status', observedAt: new Date(NOW).toISOString() });
    expect(result.budget).toMatchObject({ state: 'unknown', reason: 'budget-owner-not-probed', observedAt: null });
    expect(result.unattendedService).toMatchObject({ state: 'unknown', reason: 'service-owner-not-probed', observedAt: null });
    expect(JSON.stringify(result)).not.toMatch(/grantId|"allowed"|"ready":true|"cost":0/);
  });

  it.each(['workspaceId', 'sessionKey', 'sessionId'] as const)('rejects mismatched %s from another owner scope', (field) => {
    const value = input();
    value.policy.scope[field] = 'different-scope';
    expect(buildSessionHostReadiness(value).runtime).toMatchObject({ state: 'unknown', reason: 'session-scope-mismatch' });
    expect(buildSessionHostReadiness(value).tools.state).toBe('unknown');
  });

  it.each([NOW - 30_001, NOW + 1, NaN])('rejects stale, future or malformed observation time %s', (time) => {
    const value = input();
    value.policy.generation.observedAt = Number.isNaN(time) ? 'invalid' : new Date(time).toISOString();
    expect(buildSessionHostReadiness(value).runtime).toMatchObject({ state: 'unknown', reason: 'capability-observation-missing-or-stale' });
  });

  it.each(['missing', 'stale', 'mismatch', 'unverified'] as const)('does not promote %s generation', (state) => {
    const value = input();
    value.policy.generation.state = state;
    expect(buildSessionHostReadiness(value).runtime.state).toBe('unknown');
  });

  it.each([null, 'different-generation'])('rejects unacknowledged runtime generation %s', (runtimeGeneration) => {
    expect(buildSessionHostReadiness({ ...input(), runtimeGeneration }).runtime.state).toBe('unknown');
  });

  it('does not turn configured descriptors or absent adapter evidence into available tools', () => {
    const value = input();
    value.policy.tools = { status: 'configured', value: { names: ['exec'], digest: 'declared-only' }, source: 'descriptor', reason: null };
    expect(buildSessionHostReadiness(value).tools).toMatchObject({ state: 'unknown', reason: 'runtime-adapter-tools-unverified' });
    delete value.policy.tools;
    expect(buildSessionHostReadiness(value).tools.state).toBe('unknown');
  });

  it('keeps empty effective tools and a disabled scheduler explicitly unsupported', () => {
    const value = input();
    value.policy.tools!.value!.names = [];
    const result = buildSessionHostReadiness({ ...value, cronEnabled: false });
    expect(result.tools).toMatchObject({ state: 'unsupported', reason: 'no-effective-tools' });
    expect(result.scheduling).toMatchObject({ state: 'unsupported', reason: 'cron-owner-disabled' });
  });

  it('rejects disconnected, blocked or replaced connections and missing service probes', () => {
    for (const change of ['transport', 'router', 'epoch'] as const) {
      const value = input();
      if (change === 'transport') value.gateway.core.transport = 'disconnected';
      if (change === 'router') value.gateway.core.rpcRouter = 'blocked';
      if (change === 'epoch') value.connectionUnchanged = false;
      const result = buildSessionHostReadiness(value);
      expect(result.runtime.state).toBe('unknown');
      expect(result.scheduling.state).toBe('unknown');
    }
    expect(buildSessionHostReadiness({ ...input(), cronEnabled: null }).scheduling).toMatchObject({ state: 'unknown', reason: 'cron-owner-unavailable' });
  });

  it('clears all previous connection probes including the method descriptor', () => {
    const monitor = new GatewayCapabilityMonitor();
    monitor.recordOpenClawHealth({ ok: true });
    monitor.recordOpenClawStatus({ ok: true });
    monitor.recordCapabilitySuccess('channels', {});
    monitor.recordCapabilitySuccess('memory', {});
    monitor.recordPresence({ online: true });
    monitor.recordCoreProbe({ ok: true, checkedAt: NOW });
    monitor.recordRuntimeHandshake({ methods: ['exec'] });
    const before = monitor.epoch;
    monitor.reset();
    expect(monitor.epoch).toBeGreaterThan(before);
    const snapshot = monitor.buildSnapshot({ status: { state: 'stopped', port: 18789, gatewayReady: true }, transportConnected: false, diagnostics: { consecutiveHeartbeatMisses: 0, consecutiveRpcFailures: 0 } });
    for (const key of ['openclawHealth', 'openclawStatus', 'channels', 'memory', 'presence'] as const) expect(snapshot[key]).toEqual({ state: 'unknown' });
    expect(snapshot.core.rpcRouter).toBe('unknown');
    expect(snapshot.core.lastProbe).toBeUndefined();
    expect(snapshot.runtimeHandshake).toEqual({});
  });

  it('does not let gatewayReady or an old successful probe hide a disconnected transport', () => {
    const monitor = new GatewayCapabilityMonitor();
    monitor.recordCoreProbe({ ok: true, checkedAt: NOW });
    expect(monitor.buildSnapshot({ status: { state: 'running', port: 18789, gatewayReady: true }, transportConnected: false, diagnostics: { consecutiveHeartbeatMisses: 0, consecutiveRpcFailures: 0 } }).core.rpcRouter).toBe('unknown');
  });
});

describe('TF-0674 existing Main sessionActivity integration', () => {
  it.each([true, false])('reads actual owner probes, preserves policy and reports scheduler enabled=%s', async (enabled) => {
    const snapshot = createEmptySessionActivitySnapshot('session-a');
    snapshot.session.sessionId = 'session-generation';
    snapshot.policy = policy();
    // Live timestamps are used at this Main boundary, not the pure projection clock.
    snapshot.policy.generation.observedAt = new Date().toISOString();
    const current = input();
    const rpc = vi.fn(async (method: string) => {
      if (method === 'runtime.flags.ack') return { gatewayGeneration: 'runtime-generation', childPid: 42 };
      if (method === 'cron.status') return { enabled, storePath: 'PRIVATE-CRON-PATH' };
      return { snapshot: { ...snapshot, ownerRead: 'known' } };
    });
    const api = createSessionActivityApi({ gatewayManager: { rpc, getStatus: () => ({ connectedAt: 1 }), getCapabilitySnapshot: () => current.gateway }, terminalManager: { list: () => [] } } as never);
    const result = await api.snapshot({ workspaceId: 'workspace-a', sessionKey: 'session-a' });
    expect(result.snapshot?.policy?.host?.runtime.state).toBe('supported');
    expect(result.snapshot?.policy?.host?.scheduling.state).toBe(enabled ? 'supported' : 'unsupported');
    expect(result.snapshot?.policy?.scope).toEqual(snapshot.policy.scope);
    expect(JSON.stringify(result.snapshot?.policy?.host)).not.toContain('PRIVATE-CRON-PATH');
    expect(rpc.mock.calls.map(([method]) => method)).toEqual(['session.activitySnapshot', 'runtime.flags.ack', 'cron.status']);
  });

  it('keeps absent runtime probes unknown instead of treating configured policy as success', async () => {
    const snapshot = createEmptySessionActivitySnapshot('session-a');
    snapshot.session.sessionId = 'session-generation';
    snapshot.policy = policy();
    snapshot.policy.generation.observedAt = new Date().toISOString();
    const rpc = vi.fn(async (method: string) => {
      if (method !== 'session.activitySnapshot') throw new Error('service not available');
      return { snapshot: { ...snapshot, ownerRead: 'known' } };
    });
    const api = createSessionActivityApi({ gatewayManager: { rpc, getStatus: () => ({ connectedAt: 1 }), getCapabilitySnapshot: () => input().gateway }, terminalManager: { list: () => [] } } as never);
    const result = await api.snapshot({ workspaceId: 'workspace-a', sessionKey: 'session-a' });
    expect(result.snapshot?.policy?.host?.runtime.state).toBe('unknown');
    expect(result.snapshot?.policy?.host?.scheduling.state).toBe('unknown');
    expect(result.runtimeAvailable).toBe(true);
  });
});
