import type {
  SandboxDockerAvailability,
  SandboxEffectivePolicy,
  SandboxNetworkPolicy,
  SandboxOpenClawConfig,
  SandboxProfile,
  SandboxProviderId,
  SandboxProviderStatus,
  SandboxRuntimeLevel,
} from '@shared/types/sandbox';
import type { WorkspacePermissionMode } from '@shared/types/workspace';
import {
  describeSandboxRuntimeLevel,
  mapWorkspacePermissionToSandboxConfig,
  normalizeSandboxProviderId,
} from './workspace-runtime-permissions';

type ResolveSandboxPolicyInput = {
  permissionMode: WorkspacePermissionMode;
  /**
   * When true, a requested strong provider that cannot actually be provided is
   * an error, never a silent fallback to policy-light. Execution boundaries set
   * this when strong isolation was explicitly requested (issue #156). Automatic
   * and startup resolution leave it unset and keep the existing degradable
   * behavior.
   */
  requireStrong?: boolean;
  requestedProviderId?: SandboxProviderId;
  profile?: Pick<SandboxProfile, 'providerId' | 'networkPolicy'> | null;
  providers: SandboxProviderStatus[];
  docker?: SandboxDockerAvailability;
};

/**
 * Raised when a caller explicitly required a strong sandbox and it could not be
 * provided. Callers must surface this as a fail-closed result instead of
 * continuing on the host/policy-light path (issue #156).
 */
export class SandboxStrengthUnavailableError extends Error {
  readonly requestedProviderId: SandboxProviderId;
  readonly effectiveProviderId: SandboxProviderId;
  readonly runtimeLevel: SandboxRuntimeLevel;

  constructor(input: {
    requestedProviderId: SandboxProviderId;
    effectiveProviderId: SandboxProviderId;
    runtimeLevel: SandboxRuntimeLevel;
    reason: string;
  }) {
    super(input.reason);
    this.name = 'SandboxStrengthUnavailableError';
    this.requestedProviderId = input.requestedProviderId;
    this.effectiveProviderId = input.effectiveProviderId;
    this.runtimeLevel = input.runtimeLevel;
  }
}

function isStrongProviderId(providerId: SandboxProviderId): boolean {
  return describeSandboxRuntimeLevel(providerId) === 'strong';
}

function providerAvailable(providers: SandboxProviderStatus[], providerId: SandboxProviderId): boolean {
  return providers.some((provider) => normalizeSandboxProviderId(provider.id) === providerId && provider.available);
}

function normalizeNetworkPolicy(value: SandboxProfile['networkPolicy'] | undefined): SandboxNetworkPolicy {
  if (value === 'enabled') return 'enabled';
  if (value === 'approvalRequired' || value === 'localOnly') return 'approvalRequired';
  return 'disabled';
}

function fallbackReason(providerId: SandboxProviderId): string {
  switch (providerId) {
    case 'docker-strong':
      return 'Docker strong sandbox is unavailable; using policy-light controls.';
    case 'ssh-strong':
      return 'SSH strong sandbox is not configured; using policy-light controls.';
    case 'windows-light':
      return 'Windows light isolation is unavailable on this platform; using policy-light controls.';
    default:
      return 'Requested sandbox provider is unavailable; using policy-light controls.';
  }
}

function resolveEffectiveProvider(input: {
  requestedProviderId: SandboxProviderId;
  providers: SandboxProviderStatus[];
}): {
  effectiveProviderId: SandboxProviderId;
  degraded: boolean;
  degradeReason?: string;
} {
  const requested = normalizeSandboxProviderId(input.requestedProviderId);
  if (requested === 'policy-light') {
    return { effectiveProviderId: 'policy-light', degraded: false };
  }
  if (providerAvailable(input.providers, requested)) {
    return { effectiveProviderId: requested, degraded: false };
  }
  return {
    effectiveProviderId: 'policy-light',
    degraded: true,
    degradeReason: fallbackReason(requested),
  };
}

function runtimeLevelFor(providerId: SandboxProviderId): SandboxRuntimeLevel {
  return describeSandboxRuntimeLevel(providerId);
}

function findProvider(providers: SandboxProviderStatus[], providerId: SandboxProviderId): SandboxProviderStatus {
  const normalized = normalizeSandboxProviderId(providerId);
  return providers.find((provider) => normalizeSandboxProviderId(provider.id) === normalized)
    ?? {
      id: normalized,
      label: normalized,
      available: normalized === 'policy-light',
      runtimeLevel: runtimeLevelFor(normalized),
      capabilities: ['workspace-readonly'],
    };
}

export function resolveSandboxEffectivePolicy(input: ResolveSandboxPolicyInput): SandboxEffectivePolicy {
  const requestedProviderId = normalizeSandboxProviderId(
    input.requestedProviderId ?? input.profile?.providerId ?? 'policy-light',
  );
  const resolvedProvider = resolveEffectiveProvider({
    requestedProviderId,
    providers: input.providers,
  });
  const effectiveRuntimeLevel = runtimeLevelFor(resolvedProvider.effectiveProviderId);
  // Explicit strong requests must not silently degrade to the host/policy-light
  // path. Only automatic selection (requireStrong unset) keeps the fallback.
  if (
    input.requireStrong &&
    isStrongProviderId(requestedProviderId) &&
    effectiveRuntimeLevel !== 'strong'
  ) {
    throw new SandboxStrengthUnavailableError({
      requestedProviderId,
      effectiveProviderId: resolvedProvider.effectiveProviderId,
      runtimeLevel: effectiveRuntimeLevel,
      reason: resolvedProvider.degradeReason
        ?? `Strong sandbox ${requestedProviderId} is unavailable; refusing to run on policy-light controls.`,
    });
  }
  const openClawConfig: SandboxOpenClawConfig = mapWorkspacePermissionToSandboxConfig(
    input.permissionMode,
    resolvedProvider.effectiveProviderId,
  );
  const runtimeLevel = effectiveRuntimeLevel;
  const warnings: string[] = [];
  if (runtimeLevel === 'policy') {
    warnings.push('Policy-light mode relies on Verse Claw/Main permissions and approvals; it is not a container or VM sandbox.');
  }
  if (runtimeLevel === 'light') {
    warnings.push('Windows-light mode adds lightweight process constraints where available; it is not equivalent to Docker, gVisor, or a VM.');
  }
  if (resolvedProvider.degradeReason) {
    warnings.push(resolvedProvider.degradeReason);
  }
  if (input.permissionMode === 'readOnly' && runtimeLevel !== 'strong') {
    warnings.push('Read-only mode blocks writes and mutating Gateway requests through policy controls without strong runtime isolation.');
  }

  return {
    requestedProviderId,
    effectiveProviderId: resolvedProvider.effectiveProviderId,
    provider: findProvider(input.providers, resolvedProvider.effectiveProviderId),
    runtimeLevel,
    degraded: resolvedProvider.degraded,
    ...(resolvedProvider.degradeReason ? { degradeReason: resolvedProvider.degradeReason } : {}),
    networkPolicy: normalizeNetworkPolicy(input.profile?.networkPolicy),
    openClawConfig,
    execPolicy: openClawConfig.tools.exec,
    workspaceAccess: openClawConfig.agents.defaults.sandbox.workspaceAccess,
    docker: input.docker,
    warnings,
  };
}
