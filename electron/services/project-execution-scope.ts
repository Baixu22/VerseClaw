import { AsyncLocalStorage } from 'node:async_hooks';
import type { WorkspaceProfile } from '../../shared/types/workspace';
import { getActiveWorkspaceProfile, getProjectCoordinatorProfiles, readSystemControl } from './workspaces-api';

type ProjectExecutionScope = { workspaceId: string; rootPath: string; permissionMode: WorkspaceProfile['permissionMode'];
  sessionKey: string; generation: string; policyRevision: number };
const scopes = new AsyncLocalStorage<ProjectExecutionScope>();
export const getProjectExecutionScope = () => scopes.getStore();

/** Main-owned scope for one project intent; UI activation remains independent. */
export function runWithProjectExecutionScope<T>(profile: WorkspaceProfile, sessionKey: string, generation: string,
  policyRevision: number, execute: () => T): T {
  return scopes.run({ workspaceId: profile.id, rootPath: profile.rootPath, permissionMode: profile.permissionMode,
    sessionKey, generation, policyRevision }, execute);
}

export async function getExecutionWorkspaceProfile(): Promise<WorkspaceProfile | null> {
  const scope = scopes.getStore();
  if (!scope) return getActiveWorkspaceProfile();
  const policy = await readSystemControl();
  if (policy.paused || policy.revision !== scope.policyRevision) throw new Error('SYSTEM_DISPATCH_PAUSED_OR_CHANGED');
  const profiles = await getProjectCoordinatorProfiles();
  const profile = profiles.find(p => p.id === scope.workspaceId);
  const binding = profile?.coordinatorBindings?.[scope.sessionKey];
  if (!profile || profile.rootPath !== scope.rootPath || profile.permissionMode !== scope.permissionMode
    || profile.projectCoordinatorSessionKey !== scope.sessionKey || profile.archivedSessionKeys?.includes(scope.sessionKey)
    || profiles.filter(p => p.projectCoordinatorSessionKey === scope.sessionKey).length !== 1
    || !binding || binding.state !== 'active' || binding.invalidationReason || binding.sessionGeneration !== scope.generation) {
    throw new Error('SYSTEM_PROJECT_SCOPE_CHANGED');
  }
  return profile;
}
