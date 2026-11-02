import type { SessionEffectivePolicy, SessionHostCapabilityFact, SessionHostReadiness } from '@shared/types/session-effective-policy';
import type { GatewayCapabilitySnapshot } from './capability-monitor';

/** Matches the runtime capability owner's observation TTL; diagnostic only. */
const OBSERVATION_TTL_MS = 30_000;

export function buildSessionHostReadiness(input: {
  workspaceId: string;
  sessionKey: string;
  sessionId: string | null;
  policy: SessionEffectivePolicy;
  gateway: GatewayCapabilitySnapshot;
  runtimeGeneration: string | null;
  cronEnabled: boolean | null;
  connectionUnchanged: boolean;
  nowMs?: number;
}): SessionHostReadiness {
  const now = input.nowMs ?? Date.now();
  const observedAt = new Date(now).toISOString();
  const fact = (state: SessionHostCapabilityFact['state'], source: string, reason: string | null, at: string | null = null): SessionHostCapabilityFact => ({ state, source, reason, observedAt: at });
  const policy = input.policy;
  const observedMs = policy.generation.observedAt ? Date.parse(policy.generation.observedAt) : NaN;
  const scopeMatches = Boolean(input.workspaceId && input.sessionId)
    && policy.scope.workspaceId === input.workspaceId
    && policy.scope.sessionKey === input.sessionKey
    && policy.scope.sessionId === input.sessionId;
  const connected = input.connectionUnchanged
    && input.gateway.core.process === 'running'
    && input.gateway.core.transport === 'connected'
    && input.gateway.core.rpcRouter === 'ready';
  const fresh = Number.isFinite(observedMs) && observedMs <= now && now - observedMs <= OBSERVATION_TTL_MS;
  const generationMatches = Boolean(input.runtimeGeneration)
    && policy.generation.state === 'effective'
    && policy.generation.runtimeGeneration === input.runtimeGeneration
    && policy.generation.capabilityProfileGeneration === input.runtimeGeneration;
  const reason = !scopeMatches ? 'session-scope-mismatch'
    : !connected ? 'gateway-connection-unavailable-or-replaced'
      : !fresh ? 'capability-observation-missing-or-stale'
        : !generationMatches ? 'runtime-generation-unverified-or-mismatch'
          : policy.backend.effective.status !== 'effective' ? 'runtime-backend-unverified' : null;
  const runtime = fact(reason ? 'unknown' : 'supported', 'runtime.flags.ack + runtime-effective-capability.observation', reason, reason ? null : policy.generation.observedAt);
  const tools = runtime.state !== 'supported'
    ? fact('unknown', 'runtime-effective-capability.observation.effectiveToolNames', runtime.reason)
    : policy.tools?.status !== 'effective' || !policy.tools.value?.digest
      ? fact('unknown', 'runtime-effective-capability.observation.effectiveToolNames', 'runtime-adapter-tools-unverified')
      : fact(policy.tools.value.names.length ? 'supported' : 'unsupported', policy.tools.source, policy.tools.value.names.length ? null : 'no-effective-tools', policy.generation.observedAt);
  const scheduling = !scopeMatches || !connected || input.cronEnabled === null
    ? fact('unknown', 'cron.status', !scopeMatches ? 'session-scope-mismatch' : !connected ? 'gateway-connection-unavailable-or-replaced' : 'cron-owner-unavailable')
    : fact(input.cronEnabled ? 'supported' : 'unsupported', 'cron.status', input.cronEnabled ? null : 'cron-owner-disabled', observedAt);
  return {
    owner: 'electron-gateway', observedAt,
    runtimeGeneration: connected ? input.runtimeGeneration : null,
    runtime, tools, scheduling,
    budget: fact('unknown', 'resource-fabric', 'budget-owner-not-probed'),
    unattendedService: fact('unknown', 'service-owner', 'service-owner-not-probed'),
  };
}
