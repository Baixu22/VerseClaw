/**
 * Permission decision helpers for agent-browser host gate.
 * Extracted verbatim from shared/product-semantics.ts lines 561-609.
 */

import type { WorkspacePermissionMode } from './workspace.ts';

export type PermissionDecisionBoundary =
  | 'user-file'
  | 'system-metadata'
  | 'workspace-command'
  | 'workspace-mode'
  | 'gateway-rpc'
  | 'role-tool'
  | 'provider-call'
  | 'sandbox-runtime'
  | 'webview-security'
  | 'unknown';

export type PermissionDecisionEvent = {
  kind: 'permission-decision';
  workspaceMode: WorkspacePermissionMode | 'unknown';
  role: string | null;
  tool: string | null;
  boundary: PermissionDecisionBoundary;
  decision: 'allow' | 'deny' | 'approval-required';
  reason: string;
  requestId: string | null;
};

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function createPermissionDecisionEvent(input: {
  workspaceMode?: WorkspacePermissionMode | null;
  role?: string | null;
  tool?: string | null;
  boundary?: PermissionDecisionBoundary | null;
  decision: PermissionDecisionEvent['decision'];
  reason?: string | null;
  requestId?: string | null;
}): PermissionDecisionEvent {
  return {
    kind: 'permission-decision',
    workspaceMode: input.workspaceMode ?? 'unknown',
    role: normalizeOptionalText(input.role),
    tool: normalizeOptionalText(input.tool),
    boundary: input.boundary ?? 'unknown',
    decision: input.decision,
    reason: normalizeOptionalText(input.reason) ?? 'No reason recorded',
    requestId: normalizeOptionalText(input.requestId),
  };
}
