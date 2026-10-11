/**
 * Lightweight sandbox policy snapshot for high-risk gates.
 * Avoids importing the full sandbox host API so unit tests for terminal/gateway
 * can exercise the gate without an Electron binary.
 */

import type { SandboxEffectivePolicy } from '@shared/types/sandbox';
import type { WorkspacePermissionMode } from '@shared/types/workspace';
import { DEFAULT_WORKSPACE_PERMISSION_MODE } from '@shared/types/workspace';
import type { SandboxHighRiskPolicySnapshot } from './sandbox-high-risk-gate';
import {
  resolveSandboxEffectivePolicy,
  SandboxStrengthUnavailableError,
} from './sandbox-policy-resolver';
import { detectSandboxProviderSnapshot } from './sandbox-provider-detection';
import {
  readActiveSandboxProviderIdFromStore,
  readActiveWorkspacePermissionModeFromStore,
} from './workspace-runtime-permissions';

const STRONG_PROVIDER_IDS = new Set<string>(['docker-strong', 'ssh-strong']);

export async function getActiveSandboxHighRiskPolicy(options?: {
  /** Re-detect providers instead of trusting the 15s detection cache. */
  forceRefresh?: boolean;
}): Promise<SandboxHighRiskPolicySnapshot> {
  try {
    const [permissionMode, requestedProviderId] = await Promise.all([
      readActiveWorkspacePermissionModeFromStore().catch(
        () => DEFAULT_WORKSPACE_PERMISSION_MODE as WorkspacePermissionMode,
      ),
      readActiveSandboxProviderIdFromStore().catch(() => 'policy-light' as const),
    ]);

    const strongRequested = STRONG_PROVIDER_IDS.has(requestedProviderId);
    // This runs at the execution boundary. When strong isolation is explicitly
    // requested, re-detect capabilities rather than trust the 15s cache so a
    // provider that disappeared after selection is not reported as still
    // enforcing strong isolation (issue #156). Non-strong profiles keep the
    // cached snapshot and pay no extra detection cost.
    const providerSnapshot = await detectSandboxProviderSnapshot({
      forceRefresh: options?.forceRefresh === true || strongRequested,
    });
    let policy: SandboxEffectivePolicy;
    try {
      // requireStrong is set only when the active profile explicitly asked for a
      // strong provider, so an explicit request fails closed here while
      // automatic/startup resolution keeps degrading as before (issue #156).
      policy = resolveSandboxEffectivePolicy({
        permissionMode,
        requestedProviderId,
        requireStrong: strongRequested,
        profile: {
          providerId: requestedProviderId,
          networkPolicy: 'disabled',
        },
        providers: providerSnapshot.providers,
        docker: providerSnapshot.docker,
      });
    } catch (error) {
      if (error instanceof SandboxStrengthUnavailableError) {
        return {
          degraded: true,
          strengthRequired: true,
          degradeReason: error.message,
          requestedProviderId: error.requestedProviderId,
          effectiveProviderId: error.effectiveProviderId,
          runtimeLevel: error.runtimeLevel,
        };
      }
      throw error;
    }

    return {
      degraded: policy.degraded,
      strengthRequired: strongRequested,
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
