import type Store from 'electron-store';
import type { SandboxProfile, SandboxStatus } from '@shared/types/sandbox';
import type { WorkspacePermissionMode } from '@shared/types/workspace';
import { detectSandboxProviderSnapshot } from '../utils/sandbox-provider-detection';
import { resolveSandboxEffectivePolicy } from '../utils/sandbox-policy-resolver';
import { normalizeSandboxProviderId } from '../utils/workspace-runtime-permissions';

type SandboxStoreDocument = {
  profiles: SandboxProfile[];
  activeProfileId?: string;
};

// API mutations and runtime synchronization share this store instance. Keeping
// state below both callers avoids loading either service to resolve a policy.
let sandboxStoreInstance: Store<SandboxStoreDocument> | null = null;

export async function getSandboxStore(): Promise<Store<SandboxStoreDocument>> {
  if (!sandboxStoreInstance) {
    const Store = (await import('electron-store')).default;
    sandboxStoreInstance = new Store<SandboxStoreDocument>({
      name: 'sandbox-profiles',
      defaults: { profiles: [] },
    });
  }
  return sandboxStoreInstance;
}

async function readSandboxProfiles(): Promise<SandboxStoreDocument> {
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
