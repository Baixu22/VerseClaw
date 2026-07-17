import { readOpenClawConfig, writeOpenClawConfig } from '../utils/channel-config';
import { applyWorkspaceSandboxConfig } from '../utils/workspace-runtime-permissions';
import { resolveActiveSandboxPolicyForMode } from './sandbox-api';
import { getActiveWorkspaceProfile } from './workspaces-api';
import { DEFAULT_WORKSPACE_PERMISSION_MODE } from '@shared/types/workspace';

export async function syncActiveWorkspacePermissionToRuntime(
  _gatewayManager?: unknown,
): Promise<void> {
  const workspace = await getActiveWorkspaceProfile();
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
