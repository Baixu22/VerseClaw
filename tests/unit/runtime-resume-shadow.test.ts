import { describe, expect, it, vi } from "vitest";
import {
  RuntimeTaskEventLogStore,
  buildCheckpointFixture,
  buildEvidenceRefFixture,
  buildRuntimeTaskEventFixture,
  buildToolCallRequestFixture,
  buildToolCallResultFixture,
  createRuntimeTaskEventLogEnvelope,
  runRuntimeResumeShadow,
  type Checkpoint,
  type RuntimeTaskEvent,
  type RuntimeTaskStatus,
  type ToolCallRequest,
  type ToolCallResult,
} from "../../openclaw_runtime/src/runtime-core";

const taskId = "task-resume-shadow";

function statusEvent(
  eventId: string,
  status: RuntimeTaskStatus,
  timestamp: number,
): RuntimeTaskEvent {
  return buildRuntimeTaskEventFixture({
    eventId,
    taskId,
    kind: status,
    timestamp,
    evidenceRefs: [buildEvidenceRefFixture({ type: "trace", ref: eventId })],
  });
}

function toolRequestEvent(
  request: ToolCallRequest,
  timestamp: number,
): RuntimeTaskEvent {
  return buildRuntimeTaskEventFixture({
    eventId: `event-${request.callId}-request`,
    taskId,
    kind: "tool_call_request",
    timestamp,
    payload: request,
    evidenceRefs: [],
  });
}

function toolResultEvent(
  result: ToolCallResult,
  timestamp: number,
): RuntimeTaskEvent {
  return buildRuntimeTaskEventFixture({
    eventId: `event-${result.callId}-result`,
    taskId,
    kind: "tool_call_result",
    timestamp,
    payload: result,
    evidenceRefs: result.evidence,
  });
}

function checkpointEvent(
  checkpoint: Checkpoint,
  timestamp: number,
): RuntimeTaskEvent {
  return buildRuntimeTaskEventFixture({
    eventId: `event-${checkpoint.checkpointId}`,
    taskId,
    kind: "checkpoint",
    timestamp,
    payload: { checkpoint },
    evidenceRefs: checkpoint.evidenceRefs,
  });
}

function mutatingRequest(overrides: Partial<ToolCallRequest> = {}): ToolCallRequest {
  return buildToolCallRequestFixture({
    callId: "tool-mutating",
    taskId,
    toolName: "apply_patch",
    args: { patch: "do-not-apply" },
    permissionContext: { mode: "write" },
    idempotencyKey: "task-resume-shadow:apply-patch",
    ...overrides,
  });
}

function successfulResult(callId: string): ToolCallResult {
  return buildToolCallResultFixture({
    callId,
    status: "success",
    evidence: [buildEvidenceRefFixture({ type: "tool", ref: callId })],
    structuredData: { completed: true },
  });
}

function completedLegacyCheckpoint(toolResults: ToolCallResult[] = []): Checkpoint {
  return buildCheckpointFixture({
    checkpointId: "checkpoint-resume-shadow",
    taskId,
    state: "completed",
    openObligations: [],
    contextSummary: "",
    toolResults,
    fileHashes: {},
    evidenceRefs: [buildEvidenceRefFixture({ type: "checkpoint", ref: "checkpoint-resume-shadow" })],
  });
}

function completedEventsWithTool(): {
  events: RuntimeTaskEvent[];
  checkpoint: Checkpoint;
  request: ToolCallRequest;
  result: ToolCallResult;
} {
  const request = mutatingRequest();
  const result = successfulResult(request.callId);
  const checkpoint = completedLegacyCheckpoint([result]);
  return {
    request,
    result,
    checkpoint,
    events: [
      statusEvent("event-created", "created", 1),
      statusEvent("event-running", "running", 2),
      statusEvent("event-waiting-tool", "waiting_tool", 3),
      toolRequestEvent(request, 4),
      toolResultEvent(result, 5),
      statusEvent("event-running-after-tool", "running", 6),
      statusEvent("event-verifying", "verifying", 7),
      checkpointEvent(checkpoint, 8),
      statusEvent("event-completed", "completed", 9),
    ],
  };
}

function runEnabledShadow(events: RuntimeTaskEvent[], checkpoint: Checkpoint) {
  const store = new RuntimeTaskEventLogStore();
  store.appendMany(events.map((event) => createRuntimeTaskEventLogEnvelope(event)));
  return runRuntimeResumeShadow({
    config: { runtime: { resume: { replayShadow: true } } },
    taskId,
    eventLogRecords: store.exportRecords().records,
    legacyState: {
      taskId,
      status: checkpoint.state,
      checkpoint,
    },
  });
}

describe("runtime resume shadow", () => {
  it("is a flag-off no-op and does not read shadow or legacy state", () => {
    const eventLogReader = vi.fn<() => RuntimeTaskEvent[]>(() => {
      throw new Error("event log reader should not run");
    });
    const legacyStateReader = vi.fn(() => {
      throw new Error("legacy state reader should not run");
    });

    const result = runRuntimeResumeShadow({
      config: {},
      taskId,
      eventLogReader,
      legacyStateReader,
    });

    expect(result.enabled).toBe(false);
    expect(result.status).toBe("disabled");
    expect(result.legacyAuthoritative).toBe(true);
    expect(result.diagnostics).toEqual([]);
    expect(eventLogReader).not.toHaveBeenCalled();
    expect(legacyStateReader).not.toHaveBeenCalled();
  });

  it("reuses a completed side-effect tool result by idempotency key without executing side effects", () => {
    const executeTool = vi.fn();
    const callGatewayOrMainTransport = vi.fn();
    const writeFile = vi.fn();
    const sendMessage = vi.fn();
    const applyPatch = vi.fn();
    const { events, checkpoint, request, result: toolResult } = completedEventsWithTool();

    const result = runEnabledShadow(events, checkpoint);

    expect(result.enabled).toBe(true);
    expect(result.status).toBe("compared");
    expect(result.comparison).toMatchObject({ matches: true });
    expect(result.toolReuses).toEqual([
      expect.objectContaining({
        callId: request.callId,
        idempotencyKey: request.idempotencyKey,
        status: "reused_completed",
        result: expect.objectContaining({ callId: toolResult.callId }),
      }),
    ]);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "completed_tool_result_reused",
        idempotencyKey: request.idempotencyKey,
      }),
    );
    expect(executeTool).not.toHaveBeenCalled();
    expect(callGatewayOrMainTransport).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(applyPatch).not.toHaveBeenCalled();
  });

  it("returns a waiting verification diagnostic for a missing mutating tool result instead of completing", () => {
    const request = mutatingRequest({ callId: "tool-missing" });
    const checkpoint = completedLegacyCheckpoint();
    const events = [
      statusEvent("event-created", "created", 1),
      statusEvent("event-running", "running", 2),
      statusEvent("event-waiting-tool", "waiting_tool", 3),
      toolRequestEvent(request, 4),
    ];

    const result = runEnabledShadow(events, checkpoint);

    expect(result.status).toBe("waiting_verification");
    expect(result.replay?.state.status).toBe("waiting_tool");
    expect(result.toolReuses).toEqual([
      expect.objectContaining({
        callId: "tool-missing",
        status: "waiting_verification",
      }),
    ]);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "missing_mutating_tool_result",
        callId: "tool-missing",
      }),
    );
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "state_mismatch",
        field: "status",
        expected: "completed",
        actual: "waiting_tool",
      }),
    );
    expect(result.legacyAuthoritative).toBe(true);
  });

  it("reports ambiguous mutating tool results instead of choosing a replay side effect", () => {
    const firstRequest = mutatingRequest({ callId: "tool-ambiguous-a" });
    const secondRequest = mutatingRequest({ callId: "tool-ambiguous-b" });
    const firstResult = successfulResult(firstRequest.callId);
    const secondResult = successfulResult(secondRequest.callId);
    const checkpoint = completedLegacyCheckpoint([firstResult, secondResult]);

    const events = [
      statusEvent("event-created", "created", 1),
      statusEvent("event-running", "running", 2),
      statusEvent("event-waiting-tool", "waiting_tool", 3),
      toolRequestEvent(firstRequest, 4),
      toolRequestEvent(secondRequest, 5),
      toolResultEvent(firstResult, 6),
      toolResultEvent(secondResult, 7),
      statusEvent("event-running-after-tools", "running", 8),
      checkpointEvent(checkpoint, 9),
      statusEvent("event-completed", "completed", 10),
    ];
    const result = runRuntimeResumeShadow({
      config: { runtime: { resume: { replayShadow: true } } },
      taskId,
      eventLogRecords: events.map((event) => createRuntimeTaskEventLogEnvelope(event)),
      legacyState: {
        taskId,
        status: checkpoint.state,
        checkpoint,
      },
    });

    expect(result.status).toBe("waiting_verification");
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "ambiguous_mutating_tool_result",
        idempotencyKey: firstRequest.idempotencyKey,
      }),
    );
  });

  it.each(["completed", "blocked", "failed"] as const)(
    "compares replayed %s state against legacy checkpoint state",
    (status) => {
      const checkpoint = buildCheckpointFixture({
        checkpointId: `checkpoint-${status}`,
        taskId,
        state: status,
        openObligations: [],
        contextSummary: "",
        toolResults: [],
        fileHashes: {},
      });
      const result = runEnabledShadow([
        statusEvent(`event-${status}-created`, "created", 1),
        statusEvent(`event-${status}-running`, "running", 2),
        checkpointEvent(checkpoint, 3),
        statusEvent(`event-${status}`, status, 4),
      ], checkpoint);

      expect(result.replay?.state.status).toBe(status);
      expect(result.legacyState?.checkpoint?.state).toBe(status);
      expect(result.comparison).toMatchObject({
        matches: true,
        mismatchedFields: [],
      });
    },
  );

  it("keeps the legacy checkpoint authoritative when replay comparison mismatches", () => {
    const replayCheckpoint = completedLegacyCheckpoint();
    const legacyCheckpoint = buildCheckpointFixture({
      checkpointId: "checkpoint-legacy-failed",
      taskId,
      state: "failed",
      openObligations: [],
      contextSummary: "",
      toolResults: [],
      fileHashes: {},
    });

    const result = runEnabledShadow([
      statusEvent("event-created", "created", 1),
      statusEvent("event-running", "running", 2),
      checkpointEvent(replayCheckpoint, 3),
      statusEvent("event-completed", "completed", 4),
    ], legacyCheckpoint);

    expect(result.replay?.state.status).toBe("completed");
    expect(result.legacyState?.checkpoint?.state).toBe("failed");
    expect(result.legacyAuthoritative).toBe(true);
    expect(result.comparison).toMatchObject({
      matches: false,
      mismatchedFields: expect.arrayContaining(["status"]),
    });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "state_mismatch",
        field: "status",
        expected: "failed",
        actual: "completed",
      }),
    );
  });
});
