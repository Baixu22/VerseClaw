import type {
  SandboxExplanation,
  SandboxProfile,
  SandboxProviderId,
  SandboxStatus,
} from '@shared/types/sandbox';
import type { WorkspacePermissionMode } from '@shared/types/workspace';
import { DEFAULT_WORKSPACE_PERMISSION_MODE } from '@shared/types/workspace';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import {
  detectSandboxProviders as detectCachedSandboxProviders,
  detectSandboxProviderSnapshot,
} from '../utils/sandbox-provider-detection';
import { resolveSandboxEffectivePolicy } from '../utils/sandbox-policy-resolver';
import {
  buildForcedDegradedVisibility,
} from '../utils/sandbox-high-risk-gate';
export { getActiveSandboxHighRiskPolicy } from '@electron/utils/active-sandbox-high-risk-policy';
import { normalizeSandboxProviderId } from '../utils/workspace-runtime-permissions';
import { isRecord } from './payload-utils';
import { getActiveWorkspaceProfile } from './workspaces-api';

type SandboxStoreDocument = {
  profiles: SandboxProfile[];
  activeProfileId?: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sandboxStoreInstance: any = null;

async function getSandboxStore() {
  if (!sandboxStoreInstance) {
    const Store = (await import('electron-store')).default;
    sandboxStoreInstance = new Store<SandboxStoreDocument>({
      name: 'sandbox-profiles',
      defaults: {
        profiles: [],
      },
    });
  }
  return sandboxStoreInstance;
}

export const detectSandboxProviders = detectCachedSandboxProviders;

async function readSandboxProfiles(): Promise<{
  profiles: SandboxProfile[];
  activeProfileId?: string;
}> {
  const store = await getSandboxStore();
  const profiles = Array.isArray(store.get('profiles')) ? store.get('profiles') as SandboxProfile[] : [];
  const activeProfileId = typeof store.get('activeProfileId') === 'string'
    ? store.get('activeProfileId') as string
    : undefined;
  return { profiles, activeProfileId };
}

export async function readActiveSandboxProfile(): Promise<SandboxProfile | null> {
  const { profiles, activeProfileId } = await readSandboxProfiles();
  const profile = profiles.find((entry) => entry.id === activeProfileId) ?? profiles[0] ?? null;
  if (!profile) return null;
  const providerId = normalizeSandboxProviderId(profile.providerId);
  if (providerId === profile.providerId) return profile;
  return { ...profile, providerId };
}

export async function resolveActiveSandboxPolicyForMode(permissionMode: WorkspacePermissionMode): Promise<{
  policy: ReturnType<typeof resolveSandboxEffectivePolicy>;
  providers: SandboxStatus['providers'];
}> {
  const [providerSnapshot, profile] = await Promise.all([
    detectSandboxProviderSnapshot(),
    readActiveSandboxProfile(),
  ]);
  return {
    providers: providerSnapshot.providers,
    policy: resolveSandboxEffectivePolicy({
      permissionMode,
      profile,
      providers: providerSnapshot.providers,
      docker: providerSnapshot.docker,
    }),
  };
}

export async function buildSandboxStatus(): Promise<SandboxStatus> {
  const workspace = await getActiveWorkspaceProfile();
  const permissionMode = (workspace?.permissionMode ?? DEFAULT_WORKSPACE_PERMISSION_MODE) as WorkspacePermissionMode;
  const { providers, policy } = await resolveActiveSandboxPolicyForMode(permissionMode);

  return {
    ...policy,
    providers,
    permissionMode,
    executionEnvironment: policy.executionEnvironment,
    summary: `${policy.provider.label} / ${permissionMode} / ${policy.runtimeLevel} / network=${policy.networkPolicy}`,
    updatedAt: Date.now(),
  };
}

function normalizeProfilePayload(payload: unknown): Partial<SandboxProfile> {
  return isRecord(payload) ? payload as Partial<SandboxProfile> : {};
}

function buildSandboxExplanation(status: SandboxStatus): SandboxExplanation {
  const execPolicy = `${status.execPolicy.host}/${status.execPolicy.security}/${status.execPolicy.ask}`;
  const forced = buildForcedDegradedVisibility(status);
  const warnings = Array.from(new Set([
    ...status.warnings,
    ...forced.warnings,
  ]));
  return {
    summary: status.summary,
    warnings,
    items: [
      {
        key: 'degraded',
        label: 'Degraded',
        value: status.degraded ? 'yes' : 'no',
        tone: status.degraded ? 'danger' : 'success',
      },
      { key: 'requestedProvider', label: 'Requested provider', value: status.requestedProviderId },
      {
        key: 'effectiveProvider',
        label: 'Effective provider',
        value: status.effectiveProviderId,
        tone: status.degraded ? 'warning' : 'success',
      },
      { key: 'runtimeLevel', label: 'Runtime level', value: status.runtimeLevel },
      { key: 'permissionMode', label: 'Permission mode', value: status.permissionMode },
      {
        key: 'openClawSandboxMode',
        label: 'OpenClaw sandbox mode',
        value: status.openClawConfig.agents.defaults.sandbox.mode,
      },
      {
        key: 'workspaceAccess',
        label: 'OpenClaw workspaceAccess',
        value: status.openClawConfig.agents.defaults.sandbox.workspaceAccess,
      },
      { key: 'execPolicy', label: 'Exec policy', value: execPolicy },
      { key: 'networkPolicy', label: 'Network policy', value: status.networkPolicy },
      {
        key: 'docker',
        label: 'Docker availability',
        value: status.docker
          ? `cli=${status.docker.cli}; daemon=${status.docker.daemon}; image=${status.docker.image}`
          : 'unknown',
        tone: status.docker?.cli && status.docker.daemon && status.docker.image ? 'success' : 'neutral',
      },
      ...(status.degraded
        ? [{
            key: 'degradeReason',
            label: 'Degraded reason',
            value: status.degradeReason ?? forced.reason ?? 'Strong sandbox unavailable',
            tone: 'danger' as const,
          }]
        : status.degradeReason
          ? [{ key: 'degradeReason', label: 'Degraded reason', value: status.degradeReason, tone: 'warning' as const }]
          : []),
    ],
  };
}

export function createSandboxApi(): CompleteHostServiceRegistry['sandbox'] {
  return {
    status: async () => ({
      success: true,
      ...(await buildSandboxStatus()),
    }),
    detectProviders: async () => ({
      success: true,
      providers: await detectSandboxProviders(),
    }),
    updateProfile: async (payload) => {
      const body = normalizeProfilePayload(payload);
      const store = await getSandboxStore();
      const profiles = Array.isArray(store.get('profiles')) ? store.get('profiles') as SandboxProfile[] : [];
      const now = Date.now();
      const id = typeof body.id === 'string' && body.id.trim() ? body.id.trim() : `sandbox-${now}`;
      const existing = profiles.find((profile) => profile.id === id);
      const profile: SandboxProfile = {
        id,
        name: typeof body.name === 'string' && body.name.trim() ? body.name.trim() : existing?.name ?? 'Default sandbox',
        providerId: normalizeSandboxProviderId((body.providerId as SandboxProviderId | undefined) ?? existing?.providerId ?? 'policy-light'),
        networkPolicy: body.networkPolicy ?? existing?.networkPolicy ?? 'disabled',
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      const next = existing
        ? profiles.map((entry) => (entry.id === id ? profile : entry))
        : [profile, ...profiles];
      store.set('profiles', next);
      store.set('activeProfileId', id);
      return { success: true, profile };
    },
    explain: async () => {
      const status = await buildSandboxStatus();
      const explanation = buildSandboxExplanation(status);
      return {
        success: true,
        status,
        explanation,
        explain: [
          ...explanation.items.map((item) => `${item.label}: ${item.value}`),
          ...status.warnings,
        ],
      };
    },
  };
}
