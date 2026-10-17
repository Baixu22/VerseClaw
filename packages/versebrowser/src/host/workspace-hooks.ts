/**
 * Active workspace profile hook for agent-browser sandbox/permission checks.
 *
 * Original implementation: electron/services/workspaces-api.ts
 * `getActiveWorkspaceProfile` (source lines 453-456). Workspace document
 * persistence is host-app state, so this package exposes an injectable
 * provider with a null default (fail-open on permissionMode only when the
 * host does not supply one).
 */
import type { WorkspaceProfile } from '../types/workspace.ts';

export type ActiveWorkspaceProfileProvider = () =>
  | Promise<WorkspaceProfile | null>
  | WorkspaceProfile
  | null;

let provider: ActiveWorkspaceProfileProvider = () => null;

export function setActiveWorkspaceProfileProvider(next: ActiveWorkspaceProfileProvider | null): void {
  provider = next ?? (() => null);
}

export async function getActiveWorkspaceProfile(): Promise<WorkspaceProfile | null> {
  return provider();
}
