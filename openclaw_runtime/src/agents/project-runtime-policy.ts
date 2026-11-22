import { existsSync, readFileSync } from 'node:fs';
import type { OpenClawConfig } from '../config/types.js';
import { getSessionEntry } from '../config/sessions/store.js';
import { applyWorkspaceSandboxConfig } from '../../../shared/workspace-runtime-permissions.js';
import type { WorkspaceProfile } from '../../../shared/types/workspace.js';
import { isWorkspacePermissionMode } from '../../../shared/types/workspace.js';
import { createExecutionTaskAccess } from './execution-task-authority.js';
import { TaskSystemStore } from '../../../shared/task-system/store.js';

/** Replaces only Main-managed permission defaults for the persisted session's project. */
export function resolveProjectRuntimeConfig(config: OpenClawConfig | undefined, sessionKey: string | undefined,
  generation: string, workspace: string): OpenClawConfig | undefined {
  const path = process.env.CLAWX_WORKSPACE_OWNER_PATH;
  if (!path || !sessionKey) return config;
  const session = getSessionEntry({ sessionKey });
  if (!session?.workspaceId) return config;
  if (session.sessionId !== generation) throw new Error('TASK_GENERATION_STALE');
  const { profiles = [] } = JSON.parse(readFileSync(path, 'utf8')) as { profiles?: WorkspaceProfile[] };
  const matches = profiles.filter(profile => profile.id === session.workspaceId);
  if (matches.length !== 1) throw new Error('TASK_PROJECT_POLICY_UNAVAILABLE');
  const profile = matches[0];
  if (!isWorkspacePermissionMode(profile.permissionMode)) throw new Error('TASK_PROJECT_POLICY_UNAVAILABLE');
  const access = createExecutionTaskAccess(workspace), project = createExecutionTaskAccess(profile.rootPath);
  if (access.domain.id !== project.domain.id) throw new Error('TASK_PROJECT_POLICY_SCOPE_MISMATCH');
  const binding = profile.coordinatorBindings?.[sessionKey];
  if (binding && (binding.sessionGeneration !== generation || binding.workspaceId !== profile.id || binding.state !== 'active')) {
    throw new Error('TASK_PROJECT_POLICY_SCOPE_MISMATCH');
  }
  let authorized = Boolean(binding || profile.activeSessionKey === sessionKey || Object.hasOwn(profile.sessionStates ?? {}, sessionKey)
    || Object.values(profile.agentBindings ?? {}).some(entry => entry.sessionKey === sessionKey));
  if (!authorized && existsSync(access.domain.database)) {
    const store = new TaskSystemStore(access.domain, undefined, access);
    try {
      const task = store.binding(sessionKey, generation);
      authorized = Boolean(task);
    } finally { store.close(); }
  }
  if (!authorized) throw new Error('TASK_PROJECT_POLICY_SCOPE_MISMATCH');
  const next = structuredClone(config ?? {});
  const backend = next.agents?.defaults?.sandbox?.backend;
  applyWorkspaceSandboxConfig(next as Record<string, unknown>, profile.permissionMode,
    backend === 'docker' ? 'docker-strong' : backend === 'ssh' ? 'ssh-strong' : 'policy-light');
  return next;
}
