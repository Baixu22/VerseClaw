import {
  createPermissionDecisionEvent,
  type PermissionDecisionBoundary,
  type PermissionDecisionEvent,
} from '@shared/product-semantics';
import type { WorkspacePermissionMode } from '@shared/types/workspace';
import type { WorkspacePermissionDecision } from './workspace-permissions';

export function decisionLabel(decision: WorkspacePermissionDecision): PermissionDecisionEvent['decision'] {
  if (decision.allowed) return 'allow';
  if (decision.requiresApproval) return 'approval-required';
  return 'deny';
}

export function createWorkspacePermissionDecisionEvent(input: {
  workspaceMode: WorkspacePermissionMode;
  tool: string;
  boundary: PermissionDecisionBoundary;
  requestId?: string | null;
  decision: WorkspacePermissionDecision;
}): PermissionDecisionEvent {
  return createPermissionDecisionEvent({
    workspaceMode: input.workspaceMode,
    role: null,
    tool: input.tool,
    boundary: input.boundary,
    decision: decisionLabel(input.decision),
    reason: input.decision.reason ?? `risk:${input.decision.risk}`,
    requestId: input.requestId,
  });
}
