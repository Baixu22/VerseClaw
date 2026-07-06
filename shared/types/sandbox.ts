import type { WorkspacePermissionMode } from './workspace';

export type SandboxProviderId =
  | 'policy-light'
  | 'windows-light'
  | 'docker-strong'
  | 'ssh-strong'
  | 'openclaw-native'
  | 'container'
  | 'policy-only';
export type SandboxRuntimeLevel = 'policy' | 'light' | 'strong' | 'unavailable';
export type SandboxNetworkPolicy = 'disabled' | 'approvalRequired' | 'enabled';
export type SandboxCapability =
  | 'workspace-readonly'
  | 'workspace-readwrite'
  | 'network-none'
  | 'network-local'
  | 'process-limits'
  | 'restricted-token'
  | 'container-runtime'
  | 'openclaw-sandbox';

export interface SandboxProviderStatus {
  id: SandboxProviderId;
  label: string;
  available: boolean;
  runtimeLevel: SandboxRuntimeLevel;
  reason?: string;
  version?: string;
  capabilities: SandboxCapability[];
}

export interface SandboxDockerAvailability {
  cli: boolean;
  daemon: boolean;
  image: boolean;
}

export interface SandboxExecPolicy {
  host: 'auto' | 'sandbox' | 'gateway' | 'node';
  security: 'deny' | 'allowlist' | 'full';
  ask: 'always' | 'on-miss' | 'off';
}

export interface SandboxOpenClawConfig {
  agents: {
    defaults: {
      sandbox: {
        mode: 'off' | 'non-main' | 'all';
        backend: 'docker' | 'ssh' | 'openshell';
        scope: 'agent' | 'session' | 'shared';
        workspaceAccess: 'none' | 'ro' | 'rw';
        docker?: {
          network?: 'none' | 'host' | 'bridge';
          runtime?: string;
        };
      };
    };
  };
  tools: {
    exec: SandboxExecPolicy;
    sandbox: {
      tools: {
        alsoAllow: string[];
      };
    };
  };
}

export interface SandboxProfile {
  id: string;
  name: string;
  providerId: SandboxProviderId;
  networkPolicy: SandboxNetworkPolicy | 'localOnly';
  createdAt: number;
  updatedAt: number;
}

export interface SandboxEffectivePolicy {
  provider: SandboxProviderStatus;
  runtimeLevel: SandboxRuntimeLevel;
  requestedProviderId: SandboxProviderId;
  effectiveProviderId: SandboxProviderId;
  degraded: boolean;
  degradeReason?: string;
  docker?: SandboxDockerAvailability;
  execPolicy: SandboxExecPolicy;
  networkPolicy: SandboxNetworkPolicy;
  openClawConfig: SandboxOpenClawConfig;
  workspaceAccess: SandboxOpenClawConfig['agents']['defaults']['sandbox']['workspaceAccess'];
  warnings: string[];
}

export interface SandboxStatus extends SandboxEffectivePolicy {
  providers: SandboxProviderStatus[];
  permissionMode: WorkspacePermissionMode;
  summary: string;
  updatedAt: number;
}

export interface SandboxExplainItem {
  key: string;
  label: string;
  value: string;
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
}

export interface SandboxExplanation {
  summary: string;
  items: SandboxExplainItem[];
  warnings: string[];
}
