import type { SandboxNetworkPolicy, SandboxProviderStatus } from './sandbox.js';

export type ExecutionBackend = 'host' | 'node' | 'docker' | 'ssh' | 'verseshell' | 'codex-native';
export type ExecutionGuarantee = 'policy' | 'process' | 'container' | 'vm' | 'os';
export type ExecutionStatus = 'available' | 'unavailable' | 'degraded';
export type ExecutionNetworkPolicy = 'disabled' | 'approval-required' | 'enabled' | 'local-only';

export type ExecutionEnvironment = {
  backend: ExecutionBackend;
  /** Explicit owner-supplied guarantee; never derived from a provider name alone. */
  guarantee: ExecutionGuarantee;
  network: ExecutionNetworkPolicy;
  writableRoots: string[];
  status: ExecutionStatus;
  reason: string | null;
};

export type ExecutionEnvironmentInput = {
  backend?: ExecutionBackend;
  guarantee?: ExecutionGuarantee;
  network?: ExecutionNetworkPolicy;
  writableRoots?: readonly string[];
  status?: ExecutionStatus;
  reason?: string | null;
};

const BACKENDS: readonly ExecutionBackend[] = ['host', 'node', 'docker', 'ssh', 'verseshell', 'codex-native'];
const GUARANTEES: readonly ExecutionGuarantee[] = ['policy', 'process', 'container', 'vm', 'os'];
const STATUSES: readonly ExecutionStatus[] = ['available', 'unavailable', 'degraded'];
const NETWORKS: readonly ExecutionNetworkPolicy[] = ['disabled', 'approval-required', 'enabled', 'local-only'];

function enumValue<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new TypeError(`ExecutionEnvironment requires a valid ${field}`);
  }
  return value as T;
}

function optionalText(value: string | null | undefined, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new TypeError(`ExecutionEnvironment requires ${field} to be a string or null`);
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function createExecutionEnvironment(input: ExecutionEnvironmentInput = {}): ExecutionEnvironment {
  const writableRoots = input.writableRoots ?? [];
  if (!Array.isArray(writableRoots) || writableRoots.some((root) => typeof root !== 'string' || root.trim().length === 0)) {
    throw new TypeError('ExecutionEnvironment requires non-empty writableRoots entries');
  }
  return {
    backend: enumValue(input.backend ?? 'host', BACKENDS, 'backend'),
    guarantee: enumValue(input.guarantee ?? 'policy', GUARANTEES, 'guarantee'),
    network: enumValue(input.network ?? 'disabled', NETWORKS, 'network'),
    writableRoots: [...writableRoots],
    status: enumValue(input.status ?? 'available', STATUSES, 'status'),
    reason: optionalText(input.reason, 'reason'),
  };
}

export function sandboxNetworkToExecutionNetwork(policy: SandboxNetworkPolicy | 'localOnly'): ExecutionNetworkPolicy {
  switch (policy) {
    case 'disabled': return 'disabled';
    case 'approvalRequired': return 'approval-required';
    case 'enabled': return 'enabled';
    case 'localOnly': return 'local-only';
  }
}

/** Map only owner-supplied provider facts; provider names never imply guarantee. */
export function executionEnvironmentFromSandbox(
  provider: SandboxProviderStatus,
  input: { writableRoots?: readonly string[] } = {},
): ExecutionEnvironment {
  if (!provider || typeof provider !== 'object') throw new TypeError('ExecutionEnvironment requires a sandbox provider record');
  const backend: ExecutionBackend = provider.id === 'docker-strong'
    ? 'docker'
    : provider.id === 'ssh-strong'
      ? 'ssh'
      : 'host';
  const guarantee: ExecutionGuarantee = provider.runtimeLevel === 'strong'
    ? (provider.id === 'ssh-strong' ? 'vm' : 'container')
    : provider.runtimeLevel === 'light'
      ? 'process'
      : 'policy';
  const status: ExecutionStatus = !provider.available
    ? 'unavailable'
    : provider.runtimeLevel === 'unavailable'
      ? 'degraded'
      : 'available';
  return createExecutionEnvironment({
    backend,
    guarantee,
    writableRoots: input.writableRoots,
    status,
    reason: optionalText(provider.reason, 'reason'),
  });
}
