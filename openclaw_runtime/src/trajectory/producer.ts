import type { TrajectoryRuntimeRecorder } from "./runtime.js";

type JsonRecord = Record<string, unknown>;

export type TrajectoryProducerAgentEvent = {
  stream: string;
  data: JsonRecord;
};

export type TrajectoryProducerMissingIdentity = {
  stream: string;
  phase?: string;
  toolCallId?: string;
  reason: "missing-step-id" | "missing-tool-id" | "unknown-tool-id";
};

export type TrajectoryLifecycleProducer = {
  startRun: (state: JsonRecord, data?: JsonRecord) => boolean;
  endRun: (state: JsonRecord, data?: JsonRecord) => boolean;
  startTurn: (state: JsonRecord, data?: JsonRecord) => boolean;
  endTurn: (state: JsonRecord, data?: JsonRecord) => boolean;
  startStep: (stepId: string | undefined, state: JsonRecord, data?: JsonRecord) => boolean;
  updateStep: (stepId: string | undefined, state: JsonRecord) => boolean;
  endStep: (stepId: string | undefined, state?: JsonRecord, data?: JsonRecord) => boolean;
  recordAgentEvent: (event: TrajectoryProducerAgentEvent) => boolean;
  currentStepId: () => string | undefined;
};

function normalizeId(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function cloneRecord(value: JsonRecord): JsonRecord {
  return { ...value };
}

function phaseForStreamEvent(value: unknown): "start" | "update" | "end" | undefined {
  if (value === "start" || value === "update" || value === "end") {
    return value;
  }
  if (value === "result") {
    return "end";
  }
  if (value === "error") {
    return "end";
  }
  return undefined;
}

function lifecycleType(role: "run" | "turn" | "step" | "tool", phase: "start" | "update" | "end") {
  return `${role}/${phase}` as
    | "run/start"
    | "run/end"
    | "turn/start"
    | "turn/end"
    | "step/start"
    | "step/end"
    | "tool/start"
    | "tool/update"
    | "tool/end";
}

export function createTrajectoryLifecycleProducer(params: {
  recorder: TrajectoryRuntimeRecorder;
  runId: string;
  turnId: string;
  loopRunId?: string;
  onMissingIdentity?: (info: TrajectoryProducerMissingIdentity) => void;
}): TrajectoryLifecycleProducer {
  let runActive = false;
  let runEnded = false;
  let turnActive = false;
  let turnEnded = false;
  let activeStepId: string | undefined;
  const stepStates = new Map<string, JsonRecord>();
  const finishedSteps = new Set<string>();
  const toolStepIds = new Map<string, string>();
  const toolStates = new Map<string, JsonRecord>();

  const reportMissing = (info: TrajectoryProducerMissingIdentity): false => {
    params.onMissingIdentity?.(info);
    return false;
  };

  const record = (input: {
    role: "run" | "turn" | "step" | "tool";
    phase: "start" | "update" | "end";
    state: JsonRecord;
    data?: JsonRecord;
    turnId?: string;
    stepId?: string;
    toolCallId?: string;
  }): void => {
    params.recorder.recordEventV2({
      type: lifecycleType(input.role, input.phase),
      role: input.role,
      phase: input.phase,
      runId: params.runId,
      ...(params.loopRunId ? { loopRunId: params.loopRunId } : {}),
      ...(input.turnId ? { turnId: input.turnId } : {}),
      ...(input.stepId ? { stepId: input.stepId } : {}),
      ...(input.toolCallId ? { toolCallId: input.toolCallId } : {}),
      state: cloneRecord(input.state),
      ...(input.data ? { data: cloneRecord(input.data) } : {}),
    });
  };

  const producer: TrajectoryLifecycleProducer = {
    startRun: (state, data) => {
      if (runActive || runEnded) {
        return false;
      }
      runActive = true;
      record({ role: "run", phase: "start", state, data });
      return true;
    },
    endRun: (state, data) => {
      if (runEnded || !runActive) {
        return false;
      }
      if (turnActive && !turnEnded) {
        producer.endTurn(state, data);
      }
      runEnded = true;
      record({ role: "run", phase: "end", state, data });
      return true;
    },
    startTurn: (state, data) => {
      if (turnActive || turnEnded) {
        return false;
      }
      if (!runActive || runEnded) {
        return reportMissing({ stream: "lifecycle", phase: "start", reason: "missing-step-id" });
      }
      turnActive = true;
      record({ role: "turn", phase: "start", state, data, turnId: params.turnId });
      return true;
    },
    endTurn: (state, data) => {
      if (turnEnded || !turnActive) {
        return false;
      }
      if (activeStepId) {
        producer.endStep(activeStepId, state, data);
      }
      turnEnded = true;
      record({ role: "turn", phase: "end", state, data, turnId: params.turnId });
      return true;
    },
    startStep: (stepId, state, data) => {
      const normalizedStepId = normalizeId(stepId);
      if (!normalizedStepId) {
        return reportMissing({ stream: "model", phase: "start", reason: "missing-step-id" });
      }
      if (!turnActive || turnEnded || finishedSteps.has(normalizedStepId)) {
        return false;
      }
      if (activeStepId && activeStepId !== normalizedStepId) {
        producer.endStep(activeStepId, { status: "completed" });
      }
      activeStepId = normalizedStepId;
      stepStates.set(normalizedStepId, cloneRecord(state));
      record({
        role: "step",
        phase: "start",
        state,
        data,
        turnId: params.turnId,
        stepId: normalizedStepId,
      });
      return true;
    },
    updateStep: (stepId, state) => {
      const normalizedStepId = normalizeId(stepId);
      if (!normalizedStepId || !stepStates.has(normalizedStepId)) {
        return reportMissing({ stream: "model", phase: "update", reason: "missing-step-id" });
      }
      stepStates.set(normalizedStepId, {
        ...stepStates.get(normalizedStepId),
        ...cloneRecord(state),
      });
      return true;
    },
    endStep: (stepId, state, data) => {
      const normalizedStepId = normalizeId(stepId);
      if (!normalizedStepId) {
        return reportMissing({ stream: "model", phase: "end", reason: "missing-step-id" });
      }
      const previous = stepStates.get(normalizedStepId);
      if (!previous || finishedSteps.has(normalizedStepId)) {
        return false;
      }
      const finalState = { ...previous, ...cloneRecord(state ?? {}) };
      stepStates.set(normalizedStepId, finalState);
      finishedSteps.add(normalizedStepId);
      if (activeStepId === normalizedStepId) {
        activeStepId = undefined;
      }
      record({
        role: "step",
        phase: "end",
        state: finalState,
        data,
        turnId: params.turnId,
        stepId: normalizedStepId,
      });
      return true;
    },
    recordAgentEvent: (event) => {
      if (event.stream === "lifecycle") {
        const phase = phaseForStreamEvent(event.data.phase);
        if (phase === "end") {
          producer.endTurn(
            {
              status: event.data.phase === "error" ? "error" : "completed",
              ...event.data,
            },
            event.data,
          );
        }
        return true;
      }
      if (event.stream !== "tool") {
        return false;
      }
      const phase = phaseForStreamEvent(event.data.phase);
      const toolCallId = normalizeId(
        typeof event.data.toolCallId === "string" ? event.data.toolCallId : undefined,
      );
      if (!phase) {
        return false;
      }
      if (!toolCallId) {
        return reportMissing({ stream: event.stream, phase, reason: "missing-tool-id" });
      }
      if (phase === "start") {
        const stepId = normalizeId(activeStepId);
        if (!stepId) {
          return reportMissing({ stream: event.stream, phase, toolCallId, reason: "missing-step-id" });
        }
        const state = { status: "running", ...event.data, toolCallId };
        toolStepIds.set(toolCallId, stepId);
        toolStates.set(toolCallId, state);
        record({
          role: "tool",
          phase,
          state,
          data: event.data,
          turnId: params.turnId,
          stepId,
          toolCallId,
        });
        return true;
      }
      const stepId = toolStepIds.get(toolCallId);
      if (!stepId) {
        return reportMissing({ stream: event.stream, phase, toolCallId, reason: "unknown-tool-id" });
      }
      const previous = toolStates.get(toolCallId) ?? {};
      const state = {
        ...previous,
        ...event.data,
        toolCallId,
        status: phase === "end" ? event.data.isError === true ? "failed" : "completed" : "running",
      };
      toolStates.set(toolCallId, state);
      record({
        role: "tool",
        phase,
        state,
        data: event.data,
        turnId: params.turnId,
        stepId,
        toolCallId,
      });
      if (phase === "end") {
        toolStepIds.delete(toolCallId);
        toolStates.delete(toolCallId);
      }
      return true;
    },
    currentStepId: () => activeStepId,
  };

  return producer;
}
