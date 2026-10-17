import type { WorkspacePermissionMode } from '../types/workspace.ts';
import { DEFAULT_WORKSPACE_PERMISSION_MODE } from '../types/workspace.ts';
import type {
  SandboxExecPolicy,
  SandboxOpenClawConfig,
  SandboxProviderId,
  SandboxRuntimeLevel,
} from '../types/sandbox.ts';
import { detectDockerAvailability } from './sandbox-provider-detection.ts';

type ExecApprovalConfig = Pick<SandboxExecPolicy, 'security' | 'ask'>;

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

export function mapWorkspacePermissionToExecApproval(mode: WorkspacePermissionMode): ExecApprovalConfig {
  switch (mode) {
    case 'readOnly':
      return { security: 'allowlist', ask: 'always' };
    case 'plan':
      return { security: 'deny', ask: 'always' };
    case 'fullAccess':
      return { security: 'full', ask: 'off' };
    case 'acceptEdits':
    default:
      return { security: 'allowlist', ask: 'on-miss' };
  }
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
  if (requested === 'docker-strong') return await isDockerStrongAvailable() ? 'docker-strong' : 'policy-light';
  return 'policy-light';
}

export function applyWorkspaceExecApprovalConfig(
  config: Record<string, unknown>,
  mode: WorkspacePermissionMode,
): boolean {
  const toolsConfig = (config.tools && typeof config.tools === 'object' && !Array.isArray(config.tools))
    ? config.tools as Record<string, unknown>
    : {};
  const execConfig = (toolsConfig.exec && typeof toolsConfig.exec === 'object' && !Array.isArray(toolsConfig.exec))
    ? toolsConfig.exec as Record<string, unknown>
    : {};
  const next = mapWorkspacePermissionToExecApproval(mode);
  let modified = false;

  if (execConfig.security !== next.security) {
    execConfig.security = next.security;
    modified = true;
  }
  if (execConfig.ask !== next.ask) {
    execConfig.ask = next.ask;
    modified = true;
  }

  if (toolsConfig.exec !== execConfig) {
    toolsConfig.exec = execConfig;
    modified = true;
  }
  if (config.tools !== toolsConfig) {
    config.tools = toolsConfig;
    modified = true;
  }
  return modified;
}

function ensureRecord(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const current = parent[key];
  if (current && typeof current === 'object' && !Array.isArray(current)) {
    return current as Record<string, unknown>;
  }
  const next: Record<string, unknown> = {};
  parent[key] = next;
  return next;
}

export function mapWorkspacePermissionToSandboxConfig(
  mode: WorkspacePermissionMode,
  providerId: SandboxProviderId = DEFAULT_SANDBOX_PROVIDER,
): SandboxOpenClawConfig {
  const exec = mapWorkspacePermissionToExecApproval(mode);
  const normalizedProvider = normalizeSandboxProviderId(providerId);
  const useDockerSandbox = normalizedProvider === 'docker-strong';
  const useSshSandbox = normalizedProvider === 'ssh-strong';
  const useStrongSandbox = useDockerSandbox || useSshSandbox;
  const backend = useSshSandbox ? 'ssh' : useDockerSandbox ? 'docker' : 'openshell';
  const execHost: SandboxExecPolicy['host'] = useStrongSandbox ? 'auto' : 'gateway';

  const lightSandbox = (): SandboxOpenClawConfig['agents']['defaults']['sandbox'] => ({
    mode: 'off',
    backend,
    scope: 'session',
    workspaceAccess: 'none',
  });

  const strongSandbox = (
    workspaceAccess: SandboxOpenClawConfig['agents']['defaults']['sandbox']['workspaceAccess'],
    sandboxMode: SandboxOpenClawConfig['agents']['defaults']['sandbox']['mode'] = 'all',
  ): SandboxOpenClawConfig['agents']['defaults']['sandbox'] => ({
    mode: sandboxMode,
    backend,
    scope: 'session',
    workspaceAccess,
    ...(useDockerSandbox ? { docker: { network: 'none' as const } } : {}),
  });

  switch (mode) {
    case 'readOnly':
      return {
        agents: {
          defaults: {
            sandbox: useStrongSandbox ? strongSandbox('ro') : lightSandbox(),
          },
        },
        tools: {
          exec: { host: execHost, ...exec },
          sandbox: { tools: { alsoAllow: ['bundle-mcp'] } },
        },
      };
    case 'plan':
      return {
        agents: {
          defaults: {
            sandbox: useStrongSandbox ? strongSandbox('ro') : lightSandbox(),
          },
        },
        tools: {
          exec: { host: execHost, ...exec },
          sandbox: { tools: { alsoAllow: ['bundle-mcp'] } },
        },
      };
    case 'fullAccess':
      return {
        agents: {
          defaults: {
            sandbox: useStrongSandbox ? strongSandbox('rw', 'non-main') : lightSandbox(),
          },
        },
        tools: {
          exec: { host: execHost, ...exec },
          sandbox: { tools: { alsoAllow: ['bundle-mcp'] } },
        },
      };
    case 'acceptEdits':
    default:
      return {
        agents: {
          defaults: {
            sandbox: useStrongSandbox ? strongSandbox('rw') : lightSandbox(),
          },
        },
        tools: {
          exec: { host: execHost, ...exec },
          sandbox: { tools: { alsoAllow: ['bundle-mcp'] } },
        },
      };
  }
}

export function normalizeSandboxProviderId(providerId: SandboxProviderId | undefined): SandboxProviderId {
  switch (providerId) {
    case 'openclaw-native':
    case 'container':
      return 'docker-strong';
    case 'policy-only':
      return 'policy-light';
    case 'policy-light':
    case 'windows-light':
    case 'docker-strong':
    case 'ssh-strong':
      return providerId;
    default:
      return DEFAULT_SANDBOX_PROVIDER;
  }
}

export function describeSandboxRuntimeLevel(providerId: SandboxProviderId): SandboxRuntimeLevel {
  const normalizedProvider = normalizeSandboxProviderId(providerId);
  if (normalizedProvider === 'docker-strong' || normalizedProvider === 'ssh-strong') return 'strong';
  if (providerId === 'windows-light') return 'light';
  return 'policy';
}

export function applyWorkspaceSandboxConfig(
  config: Record<string, unknown>,
  mode: WorkspacePermissionMode,
  providerId: SandboxProviderId = DEFAULT_SANDBOX_PROVIDER,
): boolean {
  const next = mapWorkspacePermissionToSandboxConfig(mode, providerId);
  let modified = applyWorkspaceExecApprovalConfig(config, mode);

  const agentsConfig = ensureRecord(config, 'agents');
  const defaultsConfig = ensureRecord(agentsConfig, 'defaults');
  const sandboxConfig = ensureRecord(defaultsConfig, 'sandbox');
  for (const [key, value] of Object.entries(next.agents.defaults.sandbox)) {
    const currentValue = sandboxConfig[key];
    if (JSON.stringify(currentValue) !== JSON.stringify(value)) {
      sandboxConfig[key] = value;
      modified = true;
    }
  }
  if (!('docker' in next.agents.defaults.sandbox) && 'docker' in sandboxConfig) {
    delete sandboxConfig.docker;
    modified = true;
  }

  const toolsConfig = ensureRecord(config, 'tools');
  const execConfig = ensureRecord(toolsConfig, 'exec');
  if (execConfig.host !== next.tools.exec.host) {
    execConfig.host = next.tools.exec.host;
    modified = true;
  }

  const sandboxToolsConfig = ensureRecord(ensureRecord(toolsConfig, 'sandbox'), 'tools');
  const currentAlsoAllow = Array.isArray(sandboxToolsConfig.alsoAllow)
    ? sandboxToolsConfig.alsoAllow.filter((entry): entry is string => typeof entry === 'string')
    : [];
  const alsoAllow = Array.from(new Set([...currentAlsoAllow, ...next.tools.sandbox.tools.alsoAllow]));
  if (JSON.stringify(currentAlsoAllow) !== JSON.stringify(alsoAllow)) {
    sandboxToolsConfig.alsoAllow = alsoAllow;
    modified = true;
  }

  return modified;
}
