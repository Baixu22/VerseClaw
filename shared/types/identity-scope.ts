/** Identity vocabulary only: no registry, storage, authorization or ID generation. */
declare const identityKind: unique symbol;
type Identity<Kind extends string> = string & { readonly [identityKind]: Kind };

export type WorkspaceId = Identity<'workspace'>;
export type ProjectId = Identity<'project'>;
export type SessionKey = Identity<'session'>;
export type RunId = Identity<'run'>;
export type TaskId = Identity<'task-ledger'>;

export type RunScope = {
  workspaceId: WorkspaceId;
  projectId: ProjectId;
  sessionKey?: SessionKey;
};

/** Use the whole reference at new persistence/transport boundaries. */
export type ScopedRunId = { runId: RunId; scope: RunScope };

export type TaskIdentityReference =
  | { kind: 'ledger'; taskNodeId: TaskId }
  | { kind: 'runtime'; runtimeTaskId: string }
  | { kind: 'browser'; browserTaskId: string }
  | { kind: 'cron'; cronRunId: string }
  | { kind: 'install'; installTaskId: string };

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`Identity boundary requires ${field}`);
  }
  // Check emptiness without trimming or rewriting an existing identifier.
  return value;
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`Identity boundary requires ${field}`);
  }
  return value as Record<string, unknown>;
}

/** Transitional projection only; equal bytes do not make the two identities aliases. */
export function resolveProjectIdForWorkspace(workspaceId: WorkspaceId): ProjectId {
  return requiredText(workspaceId, 'workspaceId') as ProjectId;
}

/** The owner must supply the workspace; never discover one from an arbitrary project. */
export function resolveWorkspaceIdForProject(
  projectId: ProjectId,
  workspaceId: WorkspaceId,
): WorkspaceId {
  if (requiredText(projectId, 'projectId') !== resolveProjectIdForWorkspace(workspaceId)) {
    throw new TypeError('ProjectId does not match the workspace compatibility mapping');
  }
  return workspaceId;
}

/**
 * Parse an owner-resolved legacy or canonical reference into an in-memory scope.
 * workspaceKey is accepted only as the legacy spelling of that workspace identity.
 * This does not resolve raw paths, validate permissions, or migrate stored payloads.
 */
export function normalizeRunScope(value: unknown): ScopedRunId {
  const input = record(value, 'run reference');
  const scope = record(input.scope, 'run scope');
  if (scope.workspaceId !== undefined && scope.workspaceKey !== undefined
    && scope.workspaceId !== scope.workspaceKey) {
    throw new TypeError('Conflicting workspaceId and workspaceKey');
  }
  const workspaceId = requiredText(
    scope.workspaceId === undefined ? scope.workspaceKey : scope.workspaceId,
    'scope.workspaceId (or owner-resolved workspaceKey)',
  ) as WorkspaceId;
  return {
    runId: requiredText(input.runId, 'runId') as RunId,
    scope: {
      workspaceId,
      projectId: scope.projectId === undefined
        ? resolveProjectIdForWorkspace(workspaceId)
        : requiredText(scope.projectId, 'scope.projectId') as ProjectId,
      ...(scope.sessionKey === undefined
        ? {}
        : { sessionKey: requiredText(scope.sessionKey, 'scope.sessionKey') as SessionKey }),
    },
  };
}

const TASK_REFERENCE_FIELDS = {
  ledger: 'taskNodeId',
  runtime: 'runtimeTaskId',
  browser: 'browserTaskId',
  cron: 'cronRunId',
  install: 'installTaskId',
} as const;

/** Old endpoints must supply their documented owner; a bare taskId is ambiguous. */
export function normalizeTaskReference(value: unknown): TaskIdentityReference {
  const input = record(value, 'task reference');
  if (typeof input.kind !== 'string' || !Object.hasOwn(TASK_REFERENCE_FIELDS, input.kind)) {
    throw new TypeError('Task reference requires an explicit owner kind');
  }
  const kind = input.kind as TaskIdentityReference['kind'];
  const field = TASK_REFERENCE_FIELDS[kind];
  if (Object.keys(input).some((key) => key !== 'kind' && key !== field)) {
    throw new TypeError(`Task reference requires ${field}; bare or mixed task IDs are forbidden`);
  }
  return { kind, [field]: requiredText(input[field], field) } as TaskIdentityReference;
}

export const COMPLETION_AUTHORITIES = ['turn', 'run', 'task-loop-verification', 'task-ledger'] as const;
export const COMPLETION_STATUSES = ['running', 'completed', 'error', 'aborted', 'unavailable'] as const;
export const VERIFICATION_STATUSES = ['passed', 'unavailable', 'failed'] as const;
export type CompletionAuthority = (typeof COMPLETION_AUTHORITIES)[number];
export type CompletionStatus = (typeof COMPLETION_STATUSES)[number];
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

/**
 * The four distinct completion facts the UI may display. They do not imply
 * each other: a turn result is not a task result, and a Task Loop pass is not a
 * verifier pass.
 */
export type CompletionView = {
  turnStatus: CompletionStatus;
  runStatus: CompletionStatus;
  verification: VerificationStatus;
  taskStatus: CompletionStatus;
  completionAuthority: CompletionAuthority | null;
};

/** Presentation-only mapping. It never creates completion authority. */
export function displayCompletionStatus(input: {
  authority?: CompletionAuthority | null;
  status: CompletionStatus;
}): CompletionStatus {
  if (input.status !== "completed") return input.status;
  return input.authority ? "completed" : "unavailable";
}

/**
 * Map owner-supplied facts into one UI vocabulary. This function does not
 * decide whether a task passed; it only prevents the display from upgrading a
 * lower-authority result into a stronger one.
 */
export function completionView(input: {
  turnStatus?: CompletionStatus;
  runStatus?: CompletionStatus;
  verification?: VerificationStatus;
  taskStatus?: CompletionStatus;
  authority?: CompletionAuthority | null;
}): CompletionView {
  const authority = input.authority ?? null;
  const verification = input.verification ?? "unavailable";
  const requestedTaskStatus = input.taskStatus ?? "unavailable";
  const verifiedTaskLoop = authority === "task-loop-verification" && verification === "passed";
  const taskAuthority = authority === "task-ledger" || verifiedTaskLoop;
  return {
    turnStatus: displayCompletionStatus({
      status: input.turnStatus ?? "unavailable",
      authority,
    }),
    runStatus: displayCompletionStatus({
      status: input.runStatus ?? "unavailable",
      authority,
    }),
    verification,
    taskStatus: requestedTaskStatus === "completed"
      ? (taskAuthority ? "completed" : "unavailable")
      : requestedTaskStatus,
    completionAuthority: authority,
  };
}

/** A no-authority Task Loop result is not a completed task. */
export function isTaskLoopPassed(input: { status: string; evidenceGate?: { status: string } | null }): boolean {
  return input.status === "complete" && input.evidenceGate?.status === "pass";
}
