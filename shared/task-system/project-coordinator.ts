import { readFileSync } from "node:fs";
import type { WorkspaceProfile } from "../types/workspace.js";
import type { SessionKey, WorkspaceId } from "../types/identity-scope.js";
import { canonicalPath } from "./identity.js";

export function projectCoordinatorProfile(profiles: WorkspaceProfile[], sessionKey: string) {
  const matches = profiles.filter((profile) => profile.projectCoordinatorSessionKey === sessionKey);
  const profile = matches.length === 1 ? matches[0] : undefined;
  return profile?.archivedSessionKeys?.includes(sessionKey) ? undefined : profile;
}

export function projectCoordinatorScope(profile: WorkspaceProfile | undefined, sessionKey: string, generation: string, workspace: string) {
  const binding = profile?.coordinatorBindings?.[sessionKey];
  if (!profile || (binding && (binding.state !== "active" || binding.workspaceId !== profile.id || binding.sessionKey !== sessionKey)))
    throw new Error("TASK_PROJECT_COORDINATOR_REQUIRED");
  if (binding?.sessionGeneration && binding.sessionGeneration !== generation) throw new Error("TASK_GENERATION_STALE");
  if (binding?.invalidationReason || !profile.rootPath ||
      canonicalPath(binding?.environment.canonicalRoot ?? profile.rootPath) !== canonicalPath(workspace))
    throw new Error("TASK_SESSION_DOMAIN_MISMATCH");
  return { workspaceId: profile.id as WorkspaceId, sessionKey: sessionKey as SessionKey, generation };
}

/** Read the Workspace owner's persisted binding; tool arguments cannot supply scope. */
export function readProjectCoordinator(path: string, sessionKey: string, generation: string, workspace: string, requireActiveProject = false) {
  const { profiles, activeWorkspaceId } = JSON.parse(readFileSync(path, "utf8")) as { profiles: WorkspaceProfile[]; activeWorkspaceId?: string };
  const scope = projectCoordinatorScope(projectCoordinatorProfile(profiles, sessionKey), sessionKey, generation, workspace);
  if (requireActiveProject && scope.workspaceId !== activeWorkspaceId) throw new Error("TASK_PROJECT_INACTIVE");
  return scope;
}
