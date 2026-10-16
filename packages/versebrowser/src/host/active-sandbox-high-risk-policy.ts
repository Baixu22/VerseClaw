/**
 * Lightweight sandbox policy snapshot for high-risk gates.
 * Avoids importing the full sandbox host API so unit tests for terminal/gateway
 * can exercise the gate without an Electron binary.
 */

import type { WorkspacePermissionMode } from '../types/workspace.ts';
import { DEFAULT_WORKSPACE_PERMISSION_MODE } from '../types/workspace.ts';
import type { SandboxHighRiskPolicySnapshot } from './sandbox-high-risk-gate.ts';
import { resolveSandboxEffectivePolicy } from './sandbox-policy-resolver.ts';
import { detectSandboxProviderSnapshot } from './sandbox-provider-detection.ts';
import {
  readActiveSandboxProviderIdFromStore,
  readActiveWorkspacePermissionModeFromStore,
} from './workspace-runtime-permissions.ts';

export async function getActiveSandboxHighRiskPolicy(): Promise<SandboxHighRiskPolicySnapshot> {
  try {
    const [permissionMode, providerSnapshot, requestedProviderId] = await Promise.all([
      readActiveWorkspacePermissionModeFromStore().catch(
        () => DEFAULT_WORKSPACE_PERMISSION_MODE as WorkspacePermissionMode,
      ),
      detectSandboxProviderSnapshot(),
      readActiveSandboxProviderIdFromStore().catch(() => 'policy-light' as const),
    ]);

    const policy = resolveSandboxEffectivePolicy({
      permissionMode,
      requestedProviderId,
      profile: {
        providerId: requestedProviderId,
        networkPolicy: 'disabled',
      },
      providers: providerSnapshot.providers,
      docker: providerSnapshot.docker,
    });

    return {
      degraded: policy.degraded,
      ...(policy.degradeReason ? { degradeReason: policy.degradeReason } : {}),
      requestedProviderId: policy.requestedProviderId,
      effectiveProviderId: policy.effectiveProviderId,
      runtimeLevel: policy.runtimeLevel,
    };
  } catch {
    // Fail-closed: if we cannot resolve sandbox status, treat as degraded policy-light.
    return {
      degraded: true,
      degradeReason: 'Unable to resolve sandbox status; treating runtime as degraded policy-light.',
      requestedProviderId: 'policy-light',
      effectiveProviderId: 'policy-light',
      runtimeLevel: 'policy',
    };
  }
}
