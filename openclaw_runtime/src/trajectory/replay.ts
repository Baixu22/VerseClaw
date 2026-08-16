import type {
  TrajectoryEventV2,
  TrajectoryJsonValue,
  TrajectoryLifecyclePhase,
  TrajectoryLifecycleRole,
} from "./types.js";
import { safeParseTrajectoryEventV2 } from "./schema.js";

export type TrajectoryReplayEntity = {
  role: TrajectoryLifecycleRole;
  phase: TrajectoryLifecyclePhase;
  id: string;
  runId: string;
  loopRunId?: string;
  turnId?: string;
  stepId?: string;
  toolCallId?: string;
  seq: number;
  state: Record<string, TrajectoryJsonValue>;
};

export type TrajectoryReplayState = {
  traceId?: string;
  asOfSeq: number;
  entities: Record<string, TrajectoryReplayEntity>;
};

export type TrajectoryReplayResult = {
  state: TrajectoryReplayState;
  events: TrajectoryEventV2[];
  inputWasNonMonotonic: boolean;
};

export class TrajectoryReplayError extends Error {
  constructor(
    public readonly code: "invalid-event" | "duplicate-seq" | "trace-mismatch" | "out-of-order",
    message: string,
    public readonly eventIndex?: number,
  ) {
    super(message);
    this.name = "TrajectoryReplayError";
  }
}

function cloneJsonValue(value: TrajectoryJsonValue): TrajectoryJsonValue {
  if (Array.isArray(value)) {
    return value.map(cloneJsonValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, cloneJsonValue(child)]),
    );
  }
  return value;
}

function cloneJsonObject(
  value: Record<string, TrajectoryJsonValue>,
): Record<string, TrajectoryJsonValue> {
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, cloneJsonValue(child)]),
  );
}

export function trajectoryEventEntityId(event: TrajectoryEventV2): string {
  switch (event.role) {
    case "run":
      return event.runId;
    case "turn":
      return event.turnId;
    case "step":
      return event.stepId;
    case "tool":
      return event.toolCallId;
  }
}

function normalizeEvents(events: readonly unknown[]): {
  events: TrajectoryEventV2[];
  inputWasNonMonotonic: boolean;
} {
  const parsed = events.map((value, index) => {
    const result = safeParseTrajectoryEventV2(value);
    if (!result.success) {
      throw new TrajectoryReplayError("invalid-event", "Invalid v2 trajectory event", index);
    }
    return result.event;
  });
  const traceId = parsed[0]?.traceId;
  if (traceId && parsed.some((event) => event.traceId !== traceId)) {
    throw new TrajectoryReplayError(
      "trace-mismatch",
      "Trajectory replay events must share a traceId",
    );
  }
  const inputWasNonMonotonic = parsed.some(
    (event, index) => index > 0 && event.seq <= parsed[index - 1].seq,
  );
  const ordered = parsed.toSorted((left, right) => left.seq - right.seq);
  for (let index = 1; index < ordered.length; index += 1) {
    if (ordered[index].seq === ordered[index - 1].seq) {
      throw new TrajectoryReplayError(
        "duplicate-seq",
        `Trajectory replay contains duplicate seq ${ordered[index].seq}`,
      );
    }
  }
  return { events: ordered, inputWasNonMonotonic };
}

function createReplayEntity(event: TrajectoryEventV2): TrajectoryReplayEntity {
  return {
    role: event.role,
    phase: event.phase,
    id: trajectoryEventEntityId(event),
    runId: event.runId,
    loopRunId: event.loopRunId,
    turnId: event.turnId,
    stepId: event.stepId,
    toolCallId: event.toolCallId,
    seq: event.seq,
    state: cloneJsonObject(event.state),
  };
}

export function applyTrajectoryEvent(
  state: TrajectoryReplayState,
  event: TrajectoryEventV2,
): TrajectoryReplayState {
  if (event.seq <= state.asOfSeq) {
    throw new TrajectoryReplayError(
      "out-of-order",
      `Trajectory replay seq ${event.seq} must be greater than ${state.asOfSeq}`,
    );
  }
  const key = `${event.role}:${trajectoryEventEntityId(event)}`;
  return {
    traceId: state.traceId ?? event.traceId,
    asOfSeq: event.seq,
    entities: {
      ...state.entities,
      [key]: createReplayEntity(event),
    },
  };
}

export function replaceTrajectoryState(events: readonly unknown[]): TrajectoryReplayState {
  const { events: ordered } = normalizeEvents(events);
  const state: TrajectoryReplayState = {
    traceId: ordered[0]?.traceId,
    asOfSeq: ordered.at(-1)?.seq ?? 0,
    entities: {},
  };
  for (const event of ordered) {
    const key = `${event.role}:${trajectoryEventEntityId(event)}`;
    state.entities[key] = createReplayEntity(event);
  }
  return state;
}

export function replayTrajectoryEvents(events: readonly unknown[]): TrajectoryReplayResult {
  const normalized = normalizeEvents(events);
  let state: TrajectoryReplayState = {
    traceId: normalized.events[0]?.traceId,
    asOfSeq: 0,
    entities: {},
  };
  for (const event of normalized.events) {
    state = applyTrajectoryEvent(state, event);
  }
  return {
    state,
    events: normalized.events,
    inputWasNonMonotonic: normalized.inputWasNonMonotonic,
  };
}
