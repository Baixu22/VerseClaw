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

export type CodingRunEvidenceEvent =
  | {
      type: 'run';
      codingRunId: string;
      event: 'projected' | 'warning';
      runIds: string[];
      warning?: string;
    }
  | {
      type: 'turn';
      codingRunId: string;
      sessionKey: SessionKey | null;
      status: CompletionView['turnStatus'] | null;
    }
  | {
      type: 'item';
      codingRunId: string;
      itemKind: 'message' | 'tool' | 'artifact';
      itemId: string;
      status: string;
    }
  | {
      type: 'approval';
      codingRunId: string;
      approvalId: string | null;
      decision: string | null;
    }
  | {
      type: 'file';
      codingRunId: string;
      path: string;
      operation: string | null;
    }
  | {
      type: 'test';
      codingRunId: string;
      command: string;
      status: string;
    }
  | {
      type: 'verification';
      codingRunId: string;
      status: CompletionView['verification'];
      authority: CompletionView['completionAuthority'];
    }
  | {
      type: 'loop';
      codingRunId: string;
      phase: string;
      status: string;
      iteration: number | null;
      warning?: string;
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
export const CODING_RUN_PROTOCOL_SCHEMA = 'coding-run/v1' as const;
export const CODING_RUN_PROTOCOL_VERSION = 1 as const;
export type CodingRunProtocolRecordType = 'coding-run' | CodingRunEvidenceEvent['type'];

export type CodingRunProtocolRecord = {
  schema: typeof CODING_RUN_PROTOCOL_SCHEMA;
  sequence: number;
  recordType: CodingRunProtocolRecordType;
  payload: CodingRunView | CodingRunEvidenceEvent;
};

export type CodingRunProtocolError = {
  status: 'error';
  code: 'EMPTY' | 'MALFORMED_JSON' | 'INVALID_SCHEMA' | 'MISSING_FIELD' | 'INVALID_FIELD' | 'UNKNOWN_FIELD' | 'INVALID_SEQUENCE';
  line: number;
  message: string;
  field?: string;
};

export type CodingRunProtocolParseResult =
  | { status: 'ok'; records: CodingRunProtocolRecord[] }
  | CodingRunProtocolError;

const RECORD_TYPES = new Set<CodingRunProtocolRecordType>([
  'coding-run', 'run', 'turn', 'item', 'approval', 'file', 'test', 'verification', 'loop',
]);

const EVENT_FIELDS: Record<CodingRunEvidenceEvent['type'], readonly string[]> = {
  run: ['type', 'codingRunId', 'event', 'runIds', 'warning'],
  turn: ['type', 'codingRunId', 'sessionKey', 'status'],
  item: ['type', 'codingRunId', 'itemKind', 'itemId', 'status'],
  approval: ['type', 'codingRunId', 'approvalId', 'decision'],
  file: ['type', 'codingRunId', 'path', 'operation'],
  test: ['type', 'codingRunId', 'command', 'status'],
  verification: ['type', 'codingRunId', 'status', 'authority'],
  loop: ['type', 'codingRunId', 'phase', 'status', 'iteration', 'warning'],
};

const CODING_RUN_FIELDS = [
  'codingRunId', 'objective', 'acceptanceContractRef', 'sessionIds', 'scope', 'runIds',
  'attemptIds', 'taskLedgerRootId', 'traceId', 'permissionEnvelopeRef',
  'contextFingerprint', 'completion',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function protocolError(
  code: CodingRunProtocolError['code'],
  line: number,
  message: string,
  field?: string,
): CodingRunProtocolError {
  return { status: 'error', code, line, message, ...(field ? { field } : {}) };
}

function assertString(value: unknown, field: string, line: number, nullable = false): string | null {
  if (value === null && nullable) return null;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw protocolError('INVALID_FIELD', line, `${field} must be a non-empty string${nullable ? ' or null' : ''}`, field);
  }
  return value;
}

function assertStringOrNull(value: unknown, field: string, line: number): string | null {
  return assertString(value, field, line, true);
}

function assertStringArray(value: unknown, field: string, line: number): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw protocolError('INVALID_FIELD', line, `${field} must be an array of strings`, field);
  }
  return value as string[];
}

function validateCodingRunPayload(value: unknown, line: number): asserts value is CodingRunView {
  if (!isRecord(value)) throw protocolError('INVALID_FIELD', line, 'coding-run payload must be an object');
  const unknown = Object.keys(value).filter((key) => !(CODING_RUN_FIELDS as readonly string[]).includes(key));
  if (unknown.length > 0) throw protocolError('UNKNOWN_FIELD', line, `Unknown coding-run field: ${unknown[0]}`, unknown[0]);
  for (const field of CODING_RUN_FIELDS) {
    if (!hasOwn(value, field)) throw protocolError('MISSING_FIELD', line, `Missing ${field}`, field);
  }
  assertString(value.codingRunId, 'codingRunId', line);
  assertStringOrNull(value.objective, 'objective', line);
  assertStringOrNull(value.acceptanceContractRef, 'acceptanceContractRef', line);
  assertStringArray(value.sessionIds, 'sessionIds', line);
  assertStringOrNull(value.traceId, 'traceId', line);
  assertStringOrNull(value.permissionEnvelopeRef, 'permissionEnvelopeRef', line);
  assertStringOrNull(value.contextFingerprint, 'contextFingerprint', line);
  assertStringArray(value.attemptIds, 'attemptIds', line);
  if (value.scope !== null && !isRecord(value.scope)) throw protocolError('INVALID_FIELD', line, 'scope must be an object or null', 'scope');
  if (!Array.isArray(value.runIds)) throw protocolError('INVALID_FIELD', line, 'runIds must be an array', 'runIds');
  if (value.completion !== null && !isRecord(value.completion)) throw protocolError('INVALID_FIELD', line, 'completion must be an object or null', 'completion');
}

function validateEventPayload(value: unknown, line: number): asserts value is CodingRunEvidenceEvent {
  if (!isRecord(value)) throw protocolError('INVALID_FIELD', line, 'event payload must be an object');
  const type = value.type;
  if (typeof type !== 'string' || !Object.prototype.hasOwnProperty.call(EVENT_FIELDS, type)) {
    throw protocolError('INVALID_FIELD', line, 'event type is invalid', 'type');
  }
  const allowed = EVENT_FIELDS[type as CodingRunEvidenceEvent['type']];
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) throw protocolError('UNKNOWN_FIELD', line, `Unknown ${type} field: ${unknown[0]}`, unknown[0]);
  for (const field of allowed) {
    if (!hasOwn(value, field)) throw protocolError('MISSING_FIELD', line, `Missing ${type}.${field}`, field);
  }
  assertString(value.codingRunId, 'codingRunId', line);
}

/** Stable versioned JSONL serialization for display and CI consumption. */
export function serializeCodingRunJsonl(codingRun: CodingRunView, events: readonly CodingRunEvidenceEvent[] = []): string {
  const records: CodingRunProtocolRecord[] = [
    { schema: CODING_RUN_PROTOCOL_SCHEMA, sequence: 0, recordType: 'coding-run', payload: codingRun },
    ...events.map((event, index) => ({
      schema: CODING_RUN_PROTOCOL_SCHEMA,
      sequence: index + 1,
      recordType: event.type,
      payload: event,
    })),
  ];
  return records.map((record) => JSON.stringify(record)).join('\n');
}

/** Parse strict v1 JSONL; any invalid record fails closed. */
export function parseCodingRunJsonl(input: string): CodingRunProtocolParseResult {
  const lines = input.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return protocolError('EMPTY', 0, 'CodingRun JSONL is empty');
  const records: CodingRunProtocolRecord[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return protocolError('MALFORMED_JSON', index + 1, 'Record is not valid JSON');
    }
    if (!isRecord(parsed)) return protocolError('INVALID_FIELD', index + 1, 'Record must be an object');
    const allowed = ['schema', 'sequence', 'recordType', 'payload'];
    const unknown = Object.keys(parsed).filter((key) => !allowed.includes(key));
    if (unknown.length > 0) return protocolError('UNKNOWN_FIELD', index + 1, `Unknown record field: ${unknown[0]}`, unknown[0]);
    for (const field of allowed) {
      if (!hasOwn(parsed, field)) return protocolError('MISSING_FIELD', index + 1, `Missing ${field}`, field);
    }
    if (parsed.schema !== CODING_RUN_PROTOCOL_SCHEMA) {
      return protocolError('INVALID_SCHEMA', index + 1, `Expected schema ${CODING_RUN_PROTOCOL_SCHEMA}`, 'schema');
    }
    if (!Number.isInteger(parsed.sequence) || parsed.sequence !== index) {
      return protocolError('INVALID_SEQUENCE', index + 1, `Expected sequence ${index}`, 'sequence');
    }
    if (typeof parsed.recordType !== 'string' || !RECORD_TYPES.has(parsed.recordType as CodingRunProtocolRecordType)) {
      return protocolError('INVALID_FIELD', index + 1, 'Unknown recordType', 'recordType');
    }
    if (index === 0 && parsed.recordType !== 'coding-run') {
      return protocolError('INVALID_FIELD', index + 1, 'First record must be coding-run', 'recordType');
    }
    if (index > 0) {
      try {
        validateEventPayload(parsed.payload, index + 1);
      } catch (error) {
        return error as CodingRunProtocolError;
      }
      if ((parsed.payload as CodingRunEvidenceEvent).type !== parsed.recordType) {
        return protocolError('INVALID_FIELD', index + 1, 'recordType must match payload.type', 'recordType');
      }
    } else {
      try {
        validateCodingRunPayload(parsed.payload, index + 1);
      } catch (error) {
        return error as CodingRunProtocolError;
      }
    }
    records.push(parsed as CodingRunProtocolRecord);
  }
  return { status: 'ok', records };
}

export type CodingRunSummary = {
  codingRunId: string;
  records: number;
  turns: number;
  approvals: number;
  files: number;
  tests: number;
  verification: string | null;
  finalStatus: string | null;
};

export function summarizeCodingRunJsonl(input: string): CodingRunSummary | CodingRunProtocolError {
  const parsed = parseCodingRunJsonl(input);
  if (parsed.status !== 'ok') return parsed;
  const codingRun = parsed.records[0].payload as CodingRunView;
  const events = parsed.records.slice(1).map((record) => record.payload as CodingRunEvidenceEvent);
  const verification = events.findLast((event) => event.type === 'verification');
  return {
    codingRunId: codingRun.codingRunId,
    records: parsed.records.length,
    turns: events.filter((event) => event.type === 'turn').length,
    approvals: events.filter((event) => event.type === 'approval').length,
    files: events.filter((event) => event.type === 'file').length,
    tests: events.filter((event) => event.type === 'test').length,
    verification: verification?.type === 'verification' ? verification.status : null,
    finalStatus: codingRun.completion?.taskStatus ?? codingRun.completion?.runStatus ?? null,
  };
}
