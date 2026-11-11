import type { AgentSummary, RoleContract } from './agent.js';
import type { TrackedResource } from './resource-tracker.js';
import type { TaskLedgerEvidenceRef } from './task-ledger.js';

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

export type AutonomyProjectScope = Pick<RunScope, 'workspaceId' | 'projectId'>;
/** Generation is the existing session owner's opaque token, never parsed from a key. */
export type AutonomySessionScope = AutonomyProjectScope & {
  sessionKey: SessionKey;
  sessionGeneration: string;
};

/** Responsibilities reuse Assistant/RoleContract identity; none is a runtime principal. */
export type AutonomyRoleScope = {
  agentId: AgentSummary['id'];
  roleContract: Pick<RoleContract, 'name' | 'version'>;
} & (
  | { responsibility: 'system' }
  | { responsibility: 'project'; scope: AutonomyProjectScope }
  | { responsibility: 'session'; scope: AutonomySessionScope }
);

// Closed reference shapes, not an authorization/capability registry.
const AUTONOMY_REFERENCE_OWNERS = {
  project: ['workspaces'],
  workspace: ['workspaces'],
  session: ['sessions'],
  run: ['runtime'],
  action: ['host-api', 'coding-execution-backend', 'browser-session-owner'],
  effect: ['runtime', 'coding-execution-backend', 'browser-session-owner'],
  evidence: ['task-ledger', 'task-loop', 'coding-execution-backend', 'browser-session-owner'],
  resource: ['resource-tracker', 'resource-fabric', 'coding-execution-backend', 'browser-session-owner'],
} as const;

type AutonomyObject<Kind extends keyof typeof AUTONOMY_REFERENCE_OWNERS> = {
  kind: Kind;
  owner: (typeof AUTONOMY_REFERENCE_OWNERS)[Kind][number];
  /** Scope of the observation/consumer, not a new object's lifetime or permission. */
  scope: AutonomySessionScope;
};

export type AutonomyObjectReference =
  | AutonomyObject<'project'>
  | AutonomyObject<'workspace'>
  | AutonomyObject<'session'>
  | (AutonomyObject<'run'> & { run: ScopedRunId })
  | (AutonomyObject<'action'> & { actionId: string })
  | (AutonomyObject<'effect'> & { effectId: string; run: ScopedRunId })
  | (AutonomyObject<'evidence'> & { evidenceRef: TaskLedgerEvidenceRef['ref'] })
  | (AutonomyObject<'resource'> & { resourceId: TrackedResource['id'] });

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

function closedRecord(value: unknown, field: string, keys: readonly string[]): Record<string, unknown> {
  const input = record(value, field);
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`Autonomy boundary requires a plain ${field}`);
  }
  if (Object.keys(input).some((key) => !keys.includes(key))) {
    throw new TypeError(`Autonomy boundary forbids mixed or authority fields in ${field}`);
  }
  return input;
}

function readAutonomySessionScope(value: unknown): AutonomySessionScope {
  const scope = closedRecord(value, 'session scope', ['workspaceId', 'projectId', 'sessionKey', 'sessionGeneration']);
  return {
    workspaceId: requiredText(scope.workspaceId, 'workspaceId') as WorkspaceId,
    projectId: requiredText(scope.projectId, 'projectId') as ProjectId,
    sessionKey: requiredText(scope.sessionKey, 'sessionKey') as SessionKey,
    sessionGeneration: requiredText(scope.sessionGeneration, 'sessionGeneration'),
  };
}

/**
 * ownerScope must be read from existing Workspace/Session owners, never from the request.
 * Equality only validates a reference; the actual owner still checks existence and grants.
 */
export function normalizeAutonomySessionScope(
  value: unknown,
  ownerScope: AutonomySessionScope | null,
): AutonomySessionScope {
  if (!ownerScope) throw new TypeError('Autonomy session owner scope is unavailable');
  const scope = readAutonomySessionScope(value);
  const current = readAutonomySessionScope(ownerScope);
  for (const field of ['workspaceId', 'projectId', 'sessionKey', 'sessionGeneration'] as const) {
    if (scope[field] !== current[field]) {
      throw new TypeError(`Autonomy ${field} mismatch with current owner scope`);
    }
  }
  return scope;
}

function readAutonomyRun(value: unknown, scope: AutonomySessionScope): ScopedRunId {
  const input = closedRecord(value, 'run reference', ['runId', 'scope']);
  const runScope = closedRecord(input.scope, 'run scope', ['workspaceId', 'projectId', 'sessionKey']);
  normalizeAutonomySessionScope({ ...runScope, sessionGeneration: scope.sessionGeneration }, scope);
  return normalizeRunScope(input);
}

/** Parse pointers only: no execution, completion decision or resource state is copied. */
export function normalizeAutonomyObjectReference(
  value: unknown,
  ownerScope: AutonomySessionScope | null,
): AutonomyObjectReference {
  const input = record(value, 'autonomy object reference');
  if (typeof input.kind !== 'string' || !Object.hasOwn(AUTONOMY_REFERENCE_OWNERS, input.kind)) {
    throw new TypeError('Autonomy reference requires a known object kind');
  }
  const kind = input.kind as AutonomyObjectReference['kind'];
  if (!(AUTONOMY_REFERENCE_OWNERS[kind] as readonly unknown[]).includes(input.owner)) {
    throw new TypeError(`Autonomy ${kind} reference requires its explicit owner`);
  }
  const fields = kind === 'run' ? ['run']
    : kind === 'action' ? ['actionId']
    : kind === 'effect' ? ['effectId', 'run']
    : kind === 'evidence' ? ['evidenceRef']
    : kind === 'resource' ? ['resourceId'] : [];
  closedRecord(input, `${kind} reference`, ['kind', 'owner', 'scope', ...fields]);
  const scope = normalizeAutonomySessionScope(input.scope, ownerScope);
  const result: Record<string, unknown> = { kind, owner: input.owner, scope };
  for (const field of fields) {
    result[field] = field === 'run' ? readAutonomyRun(input.run, scope) : requiredText(input[field], field);
  }
  return result as AutonomyObjectReference;
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
