import { readOpenClawConfig, writeOpenClawConfig } from '../utils/channel-config';
import { applyWorkspaceSandboxConfig } from '../utils/workspace-runtime-permissions';
import { resolveActiveSandboxPolicyForMode } from './sandbox-state';
import type { WorkspaceProfile } from '@shared/types/workspace';
import { DEFAULT_WORKSPACE_PERMISSION_MODE } from '@shared/types/workspace';

type ReadActiveWorkspace = () => Promise<WorkspaceProfile | null>;

export async function syncActiveWorkspacePermissionToRuntime(
  readActiveWorkspace: ReadActiveWorkspace,
): Promise<void> {
  const workspace = await readActiveWorkspace();
  const permissionMode = workspace?.permissionMode ?? DEFAULT_WORKSPACE_PERMISSION_MODE;
  const { policy } = await resolveActiveSandboxPolicyForMode(permissionMode);
  const config = await readOpenClawConfig() as Record<string, unknown>;
  const modified = applyWorkspaceSandboxConfig(
    config,
    permissionMode,
    policy.effectiveProviderId,
  );
  if (!modified) return;
  // Keep OpenClaw's persisted exec policy aligned for the next Gateway start.
  // Live permission decisions are enforced by Verse Claw Main services, so changing
  // the workspace mode must not interrupt the active Gateway session.
  await writeOpenClawConfig(config);
}

/**
 * FP-P1-02: make the ACTIVE Electron workspace the single workspace authority.
 *
 * Historically the gateway agents ran in `agents.defaults.workspace`
 * (falling back to ~/.openclaw/workspace) while the UI tracked its own
 * WorkspaceProfile.rootPath — two disconnected workspace systems, with the
 * child's cwd acting as a second authority. This sync writes the active
 * profile's rootPath into the gateway config so agent-side reads/writes and
 * UI-side permission decisions judge the same boundary.
 */
export async function syncActiveWorkspaceRootToRuntime(readActiveWorkspace: ReadActiveWorkspace): Promise<boolean> {
  const workspace = await readActiveWorkspace();
  const rootPath = workspace?.rootPath?.trim();
  if (!rootPath) return false;
  const config = await readOpenClawConfig() as Record<string, unknown>;
  const agents = (config.agents && typeof config.agents === 'object'
    ? config.agents
    : (config.agents = {})) as Record<string, unknown>;
  const defaults = (agents.defaults && typeof agents.defaults === 'object'
    ? agents.defaults
    : (agents.defaults = {})) as Record<string, unknown>;
  if (defaults.workspace === rootPath) return false;
  defaults.workspace = rootPath;
  await writeOpenClawConfig(config);
  return true;
}
