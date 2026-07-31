type Approval = {
  id: string;
  workspaceId: string;
  sessionKey: string;
  source: string;
  status: 'pending' | 'approved' | 'denied' | 'expired';
  risk?: unknown;
  command?: string;
  paths?: string[];
  requestHash?: string;
  reason?: string;
  requestedAt: number;
  resolvedAt?: number;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value != null && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asPaths(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? [...value] : undefined;
}

export function createPermissionsApiTestDouble() {
  const approvals: Approval[] = [];
  const decisionEvents: unknown[] = [];

  const matches = (approval: Approval, input: Record<string, unknown>) => (
    approval.workspaceId === asString(input.workspaceId)
    && approval.source === asString(input.source)
    && (approval.command ?? undefined) === asString(input.command)
    && (approval.requestHash ?? undefined) === asString(input.requestHash)
    && JSON.stringify(approval.paths ?? []) === JSON.stringify(asPaths(input.paths) ?? [])
  );

  const createPermissionApproval = async (input: Record<string, unknown>) => {
    const workspace = asRecord(input.workspace);
    const workspaceId = asString(workspace.id) ?? '';
    const source = asString(input.source) ?? '';
    const command = asString(input.command);
    const paths = asPaths(input.paths);
    const requestHash = asString(input.requestHash);
    const existing = approvals.find((approval) => (
      approval.status === 'pending'
      && approval.workspaceId === workspaceId
      && approval.source === source
      && (approval.command ?? undefined) === command
      && (approval.requestHash ?? undefined) === requestHash
      && JSON.stringify(approval.paths ?? []) === JSON.stringify(paths ?? [])
    ));
    if (existing) return { ...existing, paths: existing.paths ? [...existing.paths] : undefined };

    const approval: Approval = {
      id: `approval-${approvals.length + 1}`,
      workspaceId,
      sessionKey: asString(workspace.activeSessionKey) ?? '',
      source,
      status: 'pending',
      risk: input.risk,
      command,
      paths,
      requestHash,
      reason: asString(input.reason),
      requestedAt: Date.now(),
    };
    approvals.unshift(approval);
    return { ...approval, paths: approval.paths ? [...approval.paths] : undefined };
  };

  const consumeApprovedPermissionApproval = async (input: Record<string, unknown>) => {
    const approval = approvals.find((candidate) => candidate.id === asString(input.id));
    if (!approval || approval.status !== 'approved' || !matches(approval, input)) return null;
    const consumed = { ...approval, paths: approval.paths ? [...approval.paths] : undefined };
    approval.status = 'expired';
    approval.resolvedAt = Date.now();
    return consumed;
  };

  const recordPermissionDecisionEvent = async (event: unknown) => {
    decisionEvents.unshift(event);
    return event;
  };

  const listPermissionDecisionEvents = async (limit = 200) => decisionEvents.slice(0, limit);

  const recordPermissionAudit = async (input: Record<string, unknown>) => {
    const approval = await createPermissionApproval(input);
    const stored = approvals.find((candidate) => candidate.id === approval.id);
    if (stored) {
      stored.status = 'approved';
      stored.resolvedAt = Date.now();
    }
    return { ...approval, status: 'approved' as const };
  };

  return {
    reset: () => {
      approvals.splice(0);
      decisionEvents.splice(0);
    },
    module: () => ({
      consumeApprovedPermissionApproval,
      createPermissionApproval,
      createPermissionsApi: () => ({
        approvals: async () => ({ success: true, approvals: approvals.map((approval) => ({ ...approval })) }),
        decisionEvents: async () => ({ success: true, events: await listPermissionDecisionEvents() }),
        decideApproval: async (payload: unknown) => {
          const body = asRecord(payload);
          const approval = approvals.find((candidate) => candidate.id === asString(body.id));
          if (!approval || approval.status !== 'pending') {
            return { success: false, approval };
          }
          approval.status = body.decision === 'approved' ? 'approved' : 'denied';
          approval.resolvedAt = Date.now();
          return { success: true, approval: { ...approval } };
        },
      }),
      listPermissionDecisionEvents,
      recordPermissionAudit,
      recordPermissionDecisionEvent,
    }),
  };
}

export const permissionsApiTestDouble = createPermissionsApiTestDouble();
