import type {
  CompletionView,
  RunScope,
  ScopedRunId,
  SessionKey,
  TaskId,
} from './identity-scope.js';

/**
 * A read-only association view. CodingRun does not own a state machine,
 * persistence, task status, trace storage or permission authority.
 */
export type CodingRunView = {
  codingRunId: string;
  objective: string | null;
  acceptanceContractRef: string | null;
  /** Explicit conversation links; never used to infer workspace or lineage. */
  sessionIds: SessionKey[];
  scope: RunScope | null;
  /** All execution attempts associated by their owners. Empty means unknown, not none. */
  runIds: ScopedRunId[];
  attemptIds: string[];
  taskLedgerRootId: TaskId | null;
  traceId: string | null;
  permissionEnvelopeRef: string | null;
  contextFingerprint: string | null;
  completion: CompletionView | null;
};

export type CodingRunRelation =
  | { kind: 'coding-run'; codingRunId: string }
  | { kind: 'session'; sessionKey: SessionKey }
  | { kind: 'run'; runId: ScopedRunId['runId'] }
  | { kind: 'attempt'; attemptId: string }
  | { kind: 'task-ledger'; taskNodeId: TaskId }
  | { kind: 'trace'; traceId: string };

export type CodingRunResolution =
  | { status: 'resolved'; codingRun: CodingRunView }
  | { status: 'missing'; codingRunId: string | null; message: string }
  | { status: 'unknown'; relation: CodingRunRelation; message: string }
  | {
      status: 'multiple';
      relation: CodingRunRelation;
      codingRunIds: string[];
      message: string;
    }
  | {
      status: 'conflict';
      codingRunId: string | null;
      message: string;
      conflictingCodingRunIds: string[];
    };

export type CodingRunProjectionInput = {
  codingRunId: string;
  objective?: string | null;
  acceptanceContractRef?: string | null;
  sessionIds?: readonly SessionKey[];
  scope?: RunScope | null;
  runIds?: readonly ScopedRunId[];
  attemptIds?: readonly string[];
  taskLedgerRootId?: TaskId | null;
  traceId?: string | null;
  permissionEnvelopeRef?: string | null;
  contextFingerprint?: string | null;
  completion?: CompletionView | null;
};

export type CodingRunResolutionInput = {
  relation: CodingRunRelation;
  codingRuns: readonly CodingRunView[];
};

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`CodingRun contract requires ${field}`);
  }
  return value;
}

function uniqueTexts<T extends string>(values: readonly T[] | undefined, field: string): T[] {
  if (values === undefined) return [];
  const seen = new Set<string>();
  return values.map((value, index) => {
    const text = requiredText(value, `${field}[${index}]`);
    if (seen.has(text)) throw new TypeError(`CodingRun contract contains duplicate ${field}`);
    seen.add(text);
    return text as T;
  });
}

function requiredOptionalText(value: string | null | undefined, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new TypeError(`CodingRun contract requires ${field}`);
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resolveRunIds(runs: readonly ScopedRunId[] | undefined): ScopedRunId[] {
  if (runs === undefined) return [];
  return runs.map((run, index) => {
    const runId = requiredText(run?.runId, `runIds[${index}].runId`);
    const workspaceId = requiredText(run.scope?.workspaceId, `runIds[${index}].scope.workspaceId`);
    const projectId = requiredText(run.scope?.projectId, `runIds[${index}].scope.projectId`);
    const sessionKey = run.scope?.sessionKey;
    return {
      runId,
      scope: {
        workspaceId: workspaceId as RunScope['workspaceId'],
        projectId: projectId as RunScope['projectId'],
        ...(sessionKey === undefined ? {} : { sessionKey: requiredText(sessionKey, `runIds[${index}].scope.sessionKey`) as SessionKey }),
      },
    } as ScopedRunId;
  });
}
/** Normalize owner-supplied associations; this function does not resolve any owner. */
export function createCodingRunView(input: CodingRunProjectionInput): CodingRunView {
  return {
    codingRunId: requiredText(input.codingRunId, 'codingRunId'),
    objective: requiredOptionalText(input.objective, 'objective'),
    acceptanceContractRef: requiredOptionalText(input.acceptanceContractRef, 'acceptanceContractRef'),
    sessionIds: uniqueTexts(input.sessionIds, 'sessionIds'),
    scope: input.scope ?? null,
    runIds: resolveRunIds(input.runIds),
    attemptIds: uniqueTexts(input.attemptIds, 'attemptIds'),
    taskLedgerRootId: input.taskLedgerRootId ?? null,
    traceId: requiredOptionalText(input.traceId, 'traceId'),
    permissionEnvelopeRef: requiredOptionalText(input.permissionEnvelopeRef, 'permissionEnvelopeRef'),
    contextFingerprint: requiredOptionalText(input.contextFingerprint, 'contextFingerprint'),
    completion: input.completion ?? null,
  };
}

function relationMatches(view: CodingRunView, relation: CodingRunRelation): boolean {
  switch (relation.kind) {
    case 'coding-run':
      return view.codingRunId === relation.codingRunId;
    case 'session':
      return view.sessionIds.includes(relation.sessionKey);
    case 'run':
      return view.runIds.some((run) => run.runId === relation.runId);
    case 'attempt':
      return view.attemptIds.includes(relation.attemptId);
    case 'task-ledger':
      return view.taskLedgerRootId === relation.taskNodeId;
    case 'trace':
      return view.traceId === relation.traceId;
  }
}

/**
 * Resolve an owner-supplied relation without guessing. A session is an
 * association only; it never supplies a workspace, run lineage or completion.
 */
export function resolveCodingRun(input: CodingRunResolutionInput): CodingRunResolution {
  const relation = input.relation;
  const matches = input.codingRuns.filter((view) => relationMatches(view, relation));
  if (matches.length === 0) {
    if (relation.kind === 'coding-run') {
      return { status: 'missing', codingRunId: relation.codingRunId, message: 'CodingRun is not present in the projection input' };
    }
    return { status: 'unknown', relation, message: 'No CodingRun owner supplied this relation' };
  }
  const ids = [...new Set(matches.map((view) => view.codingRunId))];
  if (ids.length > 1) {
    return { status: 'multiple', relation, codingRunIds: ids, message: 'Relation points to more than one CodingRun' };
  }
  const selected = matches.filter((view) => view.codingRunId === ids[0]);
  if (selected.length > 1) {
    return {
      status: 'conflict',
      codingRunId: ids[0],
      message: 'Multiple CodingRun records share one ID',
      conflictingCodingRunIds: selected.map((view) => view.codingRunId),
    };
  }
  return { status: 'resolved', codingRun: selected[0] };
}
