// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildWorkspaceContextProfile } from '../../shared/dcs/workspace-context-profile';
import type { DcsProdFlagStateRow, WorkspaceContextState } from '../../shared/dcs/prod-flags-control';

function state(status: DcsProdFlagStateRow['status'], enabled: boolean, partial = false): WorkspaceContextState {
  return {
    enabled,
    partial,
    comboFlagIds: ['working-memory', 'tool-registry'],
    modelSummary: '',
    flags: [
      { id: 'working-memory', writable: true, enabled, defaultEnabled: true, status },
      { id: 'tool-registry', writable: true, enabled: enabled && !partial, defaultEnabled: true, status },
    ],
  };
}

describe('WorkspaceContextProfile/v1', () => {
  it('reports one model-safe enabled profile without internal flag names', () => {
    const profile = buildWorkspaceContextProfile(state('applied', true));
    expect(profile.schemaVersion).toBe('WorkspaceContextProfile/v1');
    expect(profile.mode).toBe('enabled');
    expect(profile.capabilities.map((entry) => entry.id)).toEqual(['recent-actions', 'tool-catalog']);
    expect(profile.modelSummary).toContain('Workspace context is enabled');
    expect(profile.modelSummary).not.toMatch(/working[-_]memory|tool[-_]registry/iu);
  });

  it('keeps partial, pending, failed, and disabled distinct', () => {
    expect(buildWorkspaceContextProfile(state('applied', true)).mode).toBe('enabled');
    expect(buildWorkspaceContextProfile(state('runtime-acknowledged', true)).mode).toBe('enabled');
    expect(buildWorkspaceContextProfile(state('applied', false, true)).mode).toBe('partial');
    expect(buildWorkspaceContextProfile(state('pending-restart', true)).mode).toBe('pending');
    expect(buildWorkspaceContextProfile(state('failed', true)).mode).toBe('degraded');
    expect(buildWorkspaceContextProfile(state('applied', false)).mode).toBe('disabled');
  });
});