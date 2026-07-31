import {
  AGENT_RUN_EVENT_SCHEMA,
  AGENT_RUN_STATE_SCHEMA,
  ARTIFACT_REF_SCHEMA,
  EXECUTION_PLAN_SCHEMA,
  OBSERVATION_V2_SCHEMA,
  POLICY_DECISION_SCHEMA,
  PROCESS_HANDLE_SCHEMA,
  isAgentRunEvent,
  isAgentRunEventActive,
  sanitizeAgentRunEventForPersistence,
  type AgentRunEvent,
  type ArtifactRef,
  type ExecutionPlan,
  type ObservationV2,
  type PolicyDecision,
  type ProcessHandle,
} from "./agent-run-contracts.js";
import {
  isRuntimeTaskEventLogRecord,
  RuntimeTaskEventLogStore,
  type RuntimeTaskEventLogDiagnostic,
  type RuntimeTaskEventLogRecord,
} from "./event-log.js";
import type { RuntimeTaskEvent } from "./events.js";
import { isRecord, type RuntimeCoreJsonObject } from "./types.js";

export const AGENT_RUN_EVENT_METADATA_KEY = "agentRunEvent" as const;

export const AGENT_RUN_REPLAY_DIAGNOSTIC_CODES = [
  "invalid_agent_run_event",
  "duplicate_event_id",
  "duplicate_idempotency_key",
  "identity_mismatch",
  "missing_causation",
  "expired_event",
] as const;

export type AgentRunReplayDiagnosticCode = typeof AGENT_RUN_REPLAY_DIAGNOSTIC_CODES[number];

export type AgentRunReplayDiagnostic = {
  code: AgentRunReplayDiagnosticCode;
  message: string;
  recoverable: true;
  eventId?: string;
  idempotencyKey?: string;
};

export type AgentRunState = {
  schema: typeof AGENT_RUN_STATE_SCHEMA;
  schemaVersion: 1;
  runId?: string;
  taskId?: string;
  traceId?: string;
  sessionId?: string;
  workspaceId?: string;
  eventCount: number;
  eventIds: string[];
  expiredEventIds: string[];
  duplicateEventIds: string[];
  causationGaps: string[];
  turnIds: string[];
  latestEventId?: string;
  latestTimestamp?: number;
  plans: Record<string, ExecutionPlan>;
  processHandles: Record<string, ProcessHandle>;
  observations: Record<string, ObservationV2>;
  artifacts: Record<string, ArtifactRef>;
  policyDecisions: Record<string, PolicyDecision>;
};

export type AgentRunReplayOptions = {
  now?: number;
  runId?: string;
  taskId?: string;
};

export type AgentRunReplayResult = {
  state: AgentRunState;
  diagnostics: AgentRunReplayDiagnostic[];
};

export type AgentRunEventAppendOptions = {
  appendedAt?: number;
  now?: number;
  onFirstAppend?: (event: AgentRunEvent) => void | Promise<void>;
};

export type AgentRunEventAppendResult = {
  event: AgentRunEvent;
  appended: boolean;
  duplicate: boolean;
  effectApplied: boolean;
  record?: RuntimeTaskEventLogRecord;
  state: AgentRunState;
  diagnostics: RuntimeTaskEventLogDiagnostic[];
  replayDiagnostics: AgentRunReplayDiagnostic[];
};

export function projectAgentRunEventToRuntimeTaskEvent(event: AgentRunEvent): RuntimeTaskEvent {
  const sanitized = sanitizeAgentRunEventForPersistence(event);
  return {
    schemaVersion: 1,
    eventId: sanitized.eventId,
    taskId: sanitized.taskId,
    kind: "progress",
    timestamp: sanitized.timestamp,
    payload: {
      message: `UAS contract event: ${sanitized.type}`,
      metadata: {
        [AGENT_RUN_EVENT_METADATA_KEY]: sanitized,
        contractSchema: AGENT_RUN_EVENT_SCHEMA,
        retentionExpiresAt: sanitized.retention.expiresAt,
      },
    },
    traceContext: {
      traceId: sanitized.traceId,
      attributes: {
        runId: sanitized.runId,
        turnId: sanitized.turnId,
        sessionId: sanitized.sessionId,
        workspaceId: sanitized.workspaceId,
        causationId: sanitized.causationId,
      },
    },
    evidenceRefs: [],
  };
}

export function agentRunEventFromRuntimeTaskEvent(
  event: RuntimeTaskEvent,
): AgentRunEvent | undefined {
  if (event.kind !== "progress" || !isRecord(event.payload.metadata)) {
    return undefined;
  }
  const candidate = event.payload.metadata[AGENT_RUN_EVENT_METADATA_KEY];
  return isAgentRunEvent(candidate) ? cloneJson(candidate) : undefined;
}

export function agentRunEventFromLogRecord(
  record: RuntimeTaskEventLogRecord,
): AgentRunEvent | undefined {
  return agentRunEventFromRuntimeTaskEvent(record.event);
}

export async function appendAgentRunEvent(
  store: RuntimeTaskEventLogStore,
  event: AgentRunEvent,
  options: AgentRunEventAppendOptions = {},
): Promise<AgentRunEventAppendResult> {
  const sanitized = sanitizeAgentRunEventForPersistence(event);
  const projection = projectAgentRunEventToRuntimeTaskEvent(sanitized);
  const appendResult = store.append(projection, {
    idempotencyKey: sanitized.idempotencyKey,
    ...(options.appendedAt !== undefined ? { appendedAt: options.appendedAt } : {}),
    metadata: eventLogMetadata(sanitized),
  });

  let effectApplied = false;
  if (appendResult.appended && options.onFirstAppend) {
    await options.onFirstAppend(cloneJson(sanitized));
    effectApplied = true;
  }

  const persistedEvent = appendResult.record
    ? agentRunEventFromLogRecord(appendResult.record)
    : undefined;
  const replay = replayAgentRunEventLogRecords(
    store.exportRecords({ taskId: sanitized.taskId }).records,
    {
      now: options.now ?? sanitized.timestamp,
      runId: sanitized.runId,
      taskId: sanitized.taskId,
    },
  );

  return {
    event: persistedEvent ?? sanitized,
    appended: appendResult.appended,
    duplicate: appendResult.duplicate,
    effectApplied,
    ...(appendResult.record ? { record: appendResult.record } : {}),
    state: replay.state,
    diagnostics: appendResult.diagnostics,
    replayDiagnostics: replay.diagnostics,
  };
}

export function replayAgentRunEventLogRecords(
  records: readonly unknown[],
  options: AgentRunReplayOptions = {},
): AgentRunReplayResult {
  const events: unknown[] = [];
  const diagnostics: AgentRunReplayDiagnostic[] = [];
  for (const value of records) {
    if (!isRuntimeTaskEventLogRecordLike(value)) {
      continue;
    }
    const event = agentRunEventFromLogRecord(value);
    if (event) {
      events.push(event);
      continue;
    }
    if (isAgentRunProjectionCandidate(value.event)) {
      diagnostics.push(replayDiagnostic({
        code: "invalid_agent_run_event",
        message: "RuntimeTaskEvent log record contains an invalid AgentRunEvent projection.",
        eventId: value.event.eventId,
      }));
    }
  }
  const replay = replayAgentRunEvents(events, options);
  return { state: replay.state, diagnostics: [...diagnostics, ...replay.diagnostics] };
}

export function replayAgentRunEvents(
  inputs: readonly unknown[],
  options: AgentRunReplayOptions = {},
): AgentRunReplayResult {
  const state = createInitialAgentRunState(options);
  const diagnostics: AgentRunReplayDiagnostic[] = [];
  const seenEventIds = new Set<string>();
  const seenIdempotencyKeys = new Set<string>();
  const acceptedEventIds = new Set<string>();
  const now = options.now ?? Date.now();

  for (const input of inputs) {
    if (!isAgentRunEvent(input)) {
      diagnostics.push(replayDiagnostic({
        code: "invalid_agent_run_event",
        message: "Value is not a valid AgentRunEvent/v1 contract.",
      }));
      continue;
    }
    const event = sanitizeAgentRunEventForPersistence(input);
    if (seenEventIds.has(event.eventId)) {
      state.duplicateEventIds.push(event.eventId);
      diagnostics.push(replayDiagnostic({
        code: "duplicate_event_id",
        message: `AgentRunEvent id was replayed more than once: ${event.eventId}`,
        eventId: event.eventId,
      }));
      continue;
    }
    if (seenIdempotencyKeys.has(event.idempotencyKey)) {
      diagnostics.push(replayDiagnostic({
        code: "duplicate_idempotency_key",
        message: `AgentRunEvent idempotency key was replayed more than once: ${event.idempotencyKey}`,
        eventId: event.eventId,
        idempotencyKey: event.idempotencyKey,
      }));
      continue;
    }
    seenEventIds.add(event.eventId);
    seenIdempotencyKeys.add(event.idempotencyKey);

    if (!isAgentRunEventActive(event, now)) {
      state.expiredEventIds.push(event.eventId);
      diagnostics.push(replayDiagnostic({
        code: "expired_event",
        message: `AgentRunEvent retention expired: ${event.eventId}`,
        eventId: event.eventId,
      }));
      continue;
    }

    const identityMismatch = detectIdentityMismatch(state, event, options);
    if (identityMismatch) {
      diagnostics.push(identityMismatch);
      continue;
    }

    if (acceptedEventIds.size === 0) {
      if (event.causationId !== null) {
        recordCausationGap(state, diagnostics, event);
      }
    } else if (event.causationId === null || !acceptedEventIds.has(event.causationId)) {
      recordCausationGap(state, diagnostics, event);
    }

    applyAgentRunEvent(state, event);
    acceptedEventIds.add(event.eventId);
  }

  return { state: cloneJson(state), diagnostics };
}

function createInitialAgentRunState(options: AgentRunReplayOptions): AgentRunState {
  return {
    schema: AGENT_RUN_STATE_SCHEMA,
    schemaVersion: 1,
    ...(options.runId ? { runId: options.runId } : {}),
    ...(options.taskId ? { taskId: options.taskId } : {}),
    eventCount: 0,
    eventIds: [],
    expiredEventIds: [],
    duplicateEventIds: [],
    causationGaps: [],
    turnIds: [],
    plans: {},
    processHandles: {},
    observations: {},
    artifacts: {},
    policyDecisions: {},
  };
}

function detectIdentityMismatch(
  state: AgentRunState,
  event: AgentRunEvent,
  options: AgentRunReplayOptions,
): AgentRunReplayDiagnostic | undefined {
  const expectedRunId = options.runId ?? state.runId;
  const expectedTaskId = options.taskId ?? state.taskId;
  const mismatched = [
    expectedRunId && expectedRunId !== event.runId ? `runId=${event.runId}` : undefined,
    expectedTaskId && expectedTaskId !== event.taskId ? `taskId=${event.taskId}` : undefined,
    state.traceId && state.traceId !== event.traceId ? `traceId=${event.traceId}` : undefined,
    state.sessionId && state.sessionId !== event.sessionId ? `sessionId=${event.sessionId}` : undefined,
    state.workspaceId && state.workspaceId !== event.workspaceId
      ? `workspaceId=${event.workspaceId}`
      : undefined,
  ].filter((item): item is string => Boolean(item));
  if (mismatched.length === 0) {
    return undefined;
  }
  return replayDiagnostic({
    code: "identity_mismatch",
    message: `AgentRunEvent identity does not match replay scope: ${mismatched.join(", ")}`,
    eventId: event.eventId,
  });
}

function recordCausationGap(
  state: AgentRunState,
  diagnostics: AgentRunReplayDiagnostic[],
  event: AgentRunEvent,
): void {
  state.causationGaps.push(event.eventId);
  diagnostics.push(replayDiagnostic({
    code: "missing_causation",
    message: `AgentRunEvent causationId does not reference an earlier event: ${event.eventId}`,
    eventId: event.eventId,
  }));
}

function applyAgentRunEvent(state: AgentRunState, event: AgentRunEvent): void {
  state.runId ??= event.runId;
  state.taskId ??= event.taskId;
  state.traceId ??= event.traceId;
  state.sessionId ??= event.sessionId;
  state.workspaceId ??= event.workspaceId;
  state.eventCount += 1;
  state.eventIds.push(event.eventId);
  state.latestEventId = event.eventId;
  state.latestTimestamp = event.timestamp;
  if (!state.turnIds.includes(event.turnId)) {
    state.turnIds.push(event.turnId);
  }

  switch (event.payload.schema) {
    case EXECUTION_PLAN_SCHEMA:
      state.plans[event.payload.planId] = cloneJson(event.payload);
      break;
    case PROCESS_HANDLE_SCHEMA:
      state.processHandles[event.payload.processId] = cloneJson(event.payload);
      break;
    case OBSERVATION_V2_SCHEMA:
      state.observations[event.payload.observationId] = cloneJson(event.payload);
      event.payload.artifacts.forEach((artifact) => {
        state.artifacts[artifact.artifactId] = cloneJson(artifact);
      });
      break;
    case ARTIFACT_REF_SCHEMA:
      state.artifacts[event.payload.artifactId] = cloneJson(event.payload);
      break;
    case POLICY_DECISION_SCHEMA:
      state.policyDecisions[event.payload.decisionId] = cloneJson(event.payload);
      break;
  }
}

function eventLogMetadata(event: AgentRunEvent): RuntimeCoreJsonObject {
  return {
    source: "uas.agent_run_event_spine",
    contractSchema: AGENT_RUN_EVENT_SCHEMA,
    runId: event.runId,
    turnId: event.turnId,
    sessionKey: event.sessionId,
    workspaceId: event.workspaceId,
    traceId: event.traceId,
    retentionExpiresAt: event.retention.expiresAt,
    redactionStatus: event.redaction.status,
  };
}

function isRuntimeTaskEventLogRecordLike(value: unknown): value is RuntimeTaskEventLogRecord {
  return isRuntimeTaskEventLogRecord(value);
}

function isAgentRunProjectionCandidate(event: RuntimeTaskEvent): boolean {
  return event.kind === "progress"
    && isRecord(event.payload.metadata)
    && AGENT_RUN_EVENT_METADATA_KEY in event.payload.metadata;
}

function replayDiagnostic(
  value: Omit<AgentRunReplayDiagnostic, "recoverable">,
): AgentRunReplayDiagnostic {
  return { ...value, recoverable: true };
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
