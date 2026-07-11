import {
  createPermissionDecisionEvent,
  type PermissionDecisionEvent,
} from "../../../shared/product-semantics.js";

export function buildRolePermissionDecisionEvents(input: {
  roleName: string;
  deniedTools: readonly string[];
  requestId?: string | null;
  reason: string;
}): PermissionDecisionEvent[] {
  return input.deniedTools.map((tool) => createPermissionDecisionEvent({
    role: input.roleName,
    tool,
    boundary: 'role-tool',
    decision: 'deny',
    reason: input.reason,
    requestId: input.requestId,
  }));
}
