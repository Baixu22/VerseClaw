import { normalizeSandboxProviderId } from '../../shared/workspace-runtime-permissions';
export { mapWorkspacePermissionToExecApproval, applyWorkspaceExecApprovalConfig, mapWorkspacePermissionToSandboxConfig, normalizeSandboxProviderId, describeSandboxRuntimeLevel, applyWorkspaceSandboxConfig } from '../../shared/workspace-runtime-permissions';
import type { WorkspacePermissionMode } from '@shared/types/workspace';
import { DEFAULT_WORKSPACE_PERMISSION_MODE } from '@shared/types/workspace';
import type {
  SandboxProviderId,
} from '@shared/types/sandbox';
import { detectDockerAvailability } from './sandbox-provider-detection';


type WorkspaceStoreDocument = {
  activeWorkspaceId?: string | null;
  profiles?: Array<{
    id?: string;
    permissionMode?: WorkspacePermissionMode;
  }>;
};

type SandboxStoreDocument = {
  activeProfileId?: string;
  profiles?: Array<{
    id?: string;
    providerId?: SandboxProviderId;
  }>;
};

const DEFAULT_MODE: WorkspacePermissionMode = DEFAULT_WORKSPACE_PERMISSION_MODE;
const DEFAULT_SANDBOX_PROVIDER: SandboxProviderId = 'policy-light';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let workspaceStoreInstance: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sandboxStoreInstance: any = null;

async function getWorkspaceStore() {
  if (!workspaceStoreInstance) {
    const Store = (await import('electron-store')).default;
    workspaceStoreInstance = new Store<WorkspaceStoreDocument>({
      name: 'workspaces',
      defaults: {
        activeWorkspaceId: null,
        profiles: [],
      },
    });
  }
  return workspaceStoreInstance;
}

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

export async function readActiveWorkspacePermissionModeFromStore(): Promise<WorkspacePermissionMode> {
  try {
    const store = await getWorkspaceStore();
    const profiles = Array.isArray(store.get('profiles'))
      ? store.get('profiles') as NonNullable<WorkspaceStoreDocument['profiles']>
      : [];
    const activeWorkspaceId = typeof store.get('activeWorkspaceId') === 'string'
      ? store.get('activeWorkspaceId') as string
      : null;
    const activeProfile = profiles.find((profile) => profile.id === activeWorkspaceId) ?? profiles[0] ?? null;
    const mode = activeProfile?.permissionMode;
    if (mode === 'readOnly' || mode === 'acceptEdits' || mode === 'plan' || mode === 'fullAccess') {
      return mode;
    }
  } catch {
    return DEFAULT_MODE;
  }
  return DEFAULT_MODE;
}

export async function readActiveSandboxProviderIdFromStore(): Promise<SandboxProviderId> {
  try {
    const store = await getSandboxStore();
    const profiles = Array.isArray(store.get('profiles'))
      ? store.get('profiles') as NonNullable<SandboxStoreDocument['profiles']>
      : [];
    const activeProfileId = typeof store.get('activeProfileId') === 'string'
      ? store.get('activeProfileId') as string
      : undefined;
    const activeProfile = profiles.find((profile) => profile.id === activeProfileId) ?? profiles[0] ?? null;
    return normalizeSandboxProviderId(activeProfile?.providerId);
  } catch {
    return DEFAULT_SANDBOX_PROVIDER;
  }
}

async function isDockerStrongAvailable(): Promise<boolean> {
  const docker = await detectDockerAvailability();
  return docker.cli && docker.daemon && docker.image;
}

export async function resolveSandboxProviderIdForRuntime(
  requestedProviderId?: SandboxProviderId,
): Promise<SandboxProviderId> {
  const requested = normalizeSandboxProviderId(requestedProviderId ?? await readActiveSandboxProviderIdFromStore());
  if (requested === 'policy-light') return 'policy-light';
  if (requested === 'windows-light') return process.platform === 'win32' ? 'windows-light' : 'policy-light';
  // Automatic and startup resolution keep the degradable behavior (#156): only an
  // explicit strong request routed through resolveSandboxPolicy({ requireStrong })
  // fails closed. The merge with codex/p1-issues-20261010 had blended this
  // function with that branch's older fail-closed variant, which both used the
  // pre-#156 positional error constructor and would have changed automatic
  // startup behavior; main's accepted version is kept here.
  if (requested === 'docker-strong') return await isDockerStrongAvailable() ? 'docker-strong' : 'policy-light';
  return 'policy-light';
}
