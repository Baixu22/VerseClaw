import type {
  SandboxDockerAvailability,
  SandboxEffectivePolicy,
  SandboxNetworkPolicy,
  SandboxOpenClawConfig,
  SandboxProfile,
  SandboxProviderId,
  SandboxProviderStatus,
  SandboxRuntimeLevel,
} from '../types/sandbox.ts';
import type { WorkspacePermissionMode } from '../types/workspace.ts';
import {
  describeSandboxRuntimeLevel,
  mapWorkspacePermissionToSandboxConfig,
  normalizeSandboxProviderId,
} from './workspace-runtime-permissions.ts';

type ResolveSandboxPolicyInput = {
  permissionMode: WorkspacePermissionMode;
  requestedProviderId?: SandboxProviderId;
  profile?: Pick<SandboxProfile, 'providerId' | 'networkPolicy'> | null;
  providers: SandboxProviderStatus[];
  docker?: SandboxDockerAvailability;
};

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
  const openClawConfig: SandboxOpenClawConfig = mapWorkspacePermissionToSandboxConfig(
    input.permissionMode,
    resolvedProvider.effectiveProviderId,
  );
  const runtimeLevel = runtimeLevelFor(resolvedProvider.effectiveProviderId);
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
