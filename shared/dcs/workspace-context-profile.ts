import type { WorkspaceContextState } from './prod-flags-control';

export const WORKSPACE_CONTEXT_PROFILE_SCHEMA = 'WorkspaceContextProfile/v1' as const;

export type WorkspaceContextEffectiveMode =
  | 'enabled'
  | 'disabled'
  | 'partial'
  | 'pending'
  | 'degraded';

export type WorkspaceContextProfile = {
  schemaVersion: typeof WORKSPACE_CONTEXT_PROFILE_SCHEMA;
  profileId: 'workspace-context';
  enabled: boolean;
  mode: WorkspaceContextEffectiveMode;
  capabilities: Array<{
    id: 'recent-actions' | 'tool-catalog';
    enabled: boolean;
    status: string;
  }>;
  modelSummary: string;
};

export function buildWorkspaceContextProfile(state: WorkspaceContextState): WorkspaceContextProfile {
  const capabilities = state.flags.map((flag) => ({
    id: flag.id === 'working-memory' ? 'recent-actions' as const : 'tool-catalog' as const,
    enabled: flag.enabled,
    status: flag.status,
  }));
  const failed = state.flags.some((flag) => flag.status === 'failed' || flag.status === 'error');
  const pending = state.flags.some(
    (flag) =>
      flag.status === 'pending-restart' ||
      flag.status === 'saved' ||
      flag.status === 'restarting',
  );
  const mode: WorkspaceContextEffectiveMode = failed
    ? 'degraded'
    : state.partial
      ? 'partial'
      : !state.enabled
        ? 'disabled'
        : pending
          ? 'pending'
          : 'enabled';
  const modelSummary =
    mode === 'enabled'
      ? 'Workspace context is enabled: recent tool actions and the available-tool summary may be included.'
      : mode === 'pending'
        ? 'Workspace context is saved but not yet confirmed by the runtime; do not claim it is active.'
        : mode === 'degraded'
          ? 'Workspace context is degraded or failed; do not claim recent-action or tool-catalog memory.'
          : mode === 'partial'
            ? 'Workspace context is partially configured; do not claim both recent actions and the tool catalog.'
            : 'Workspace context is off; do not claim recent-action or tool-catalog memory.';
  return {
    schemaVersion: WORKSPACE_CONTEXT_PROFILE_SCHEMA,
    profileId: 'workspace-context',
    enabled: state.enabled,
    mode,
    capabilities,
    modelSummary,
  };
}