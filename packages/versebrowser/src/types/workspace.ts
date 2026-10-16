/**
 * Workspace permission/profile types needed by agent-browser host gate.
 * Extracted verbatim from shared/types/workspace.ts lines 3-21 + WorkspaceProfile shape.
 */

export type WorkspacePermissionMode = 'readOnly' | 'acceptEdits' | 'plan' | 'fullAccess';

/** Safe default for new/untrusted workspaces and invalid/missing stored modes (P2-001 / F-AUTH-001). */
export const DEFAULT_WORKSPACE_PERMISSION_MODE: WorkspacePermissionMode = 'readOnly';

export const WORKSPACE_PERMISSION_MODES: readonly WorkspacePermissionMode[] = [
  'readOnly',
  'plan',
  'acceptEdits',
  'fullAccess',
] as const;

export function isWorkspacePermissionMode(value: unknown): value is WorkspacePermissionMode {
  return typeof value === 'string' && (WORKSPACE_PERMISSION_MODES as readonly string[]).includes(value);
}

export function normalizeWorkspacePermissionMode(value: unknown): WorkspacePermissionMode {
  return isWorkspacePermissionMode(value) ? value : DEFAULT_WORKSPACE_PERMISSION_MODE;
}

/**
 * Minimal workspace profile surface for agent-browser permission checks.
 * Source: shared/types/workspace.ts WorkspaceProfile.
 */
export type WorkspaceProfile = {
  id: string;
  name: string;
  rootPath: string;
  agentId: string;
  permissionMode: WorkspacePermissionMode;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number;
};
