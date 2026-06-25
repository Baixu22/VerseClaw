import { describe, expect, it } from "vitest";
import {
  RUNTIME_TASK_EVENT_LOG_SCHEMA_MARKER,
  RuntimeTaskEventLogStore,
  buildCheckpointFixture,
  buildContextItemFixture,
  buildEvidenceRefFixture,
  buildRuntimeTaskEventFixture,
  buildToolCallRequestFixture,
  buildToolCallResultFixture,
  createRuntimeTaskContinueAsNewShadow,
  createRuntimeTaskEventLogEnvelope,
  replayRuntimeTaskEventLogRecords,
  replayRuntimeTaskEvents,
  type Checkpoint,
  type RuntimeCoreJsonObject,
  type RuntimeTaskEvent,
  type RuntimeTaskStatus,
} from "../../openclaw_runtime/src/runtime-core";

const taskId = "task-reducer";

function statusEvent(
  eventId: string,
  status: RuntimeTaskStatus,
  timestamp: number,
  metadata?: RuntimeCoreJsonObject,
): RuntimeTaskEvent {
  const event = buildRuntimeTaskEventFixture({
    eventId,
    taskId,
    kind: status,
    timestamp,
    evidenceRefs: [buildEvidenceRefFixture({ type: "trace", ref: eventId })],
  });
  return metadata
    ? ({
        ...event,
        payload: {
          ...event.payload,
          metadata,
        },
      } as RuntimeTaskEvent)
    : event;
}

function checkpointEvent(
  eventId: string,
  timestamp: number,
  checkpoint: Checkpoint,
): RuntimeTaskEvent {
  return buildRuntimeTaskEventFixture({
    eventId,
    taskId,
    kind: "checkpoint",
    timestamp,
    payload: { checkpoint },
    evidenceRefs: [buildEvidenceRefFixture({ type: "checkpoint", ref: checkpoint.checkpointId })],
  });
}

function lifecycleEvents(): RuntimeTaskEvent[] {
  const toolRequest = buildToolCallRequestFixture({
    callId: "tool-call-reducer",
    taskId,
    toolName: "side_effect_tool",
    args: { command: "do-not-execute-during-replay" },
    idempotencyKey: "tool-call-reducer:side-effect",
  });
  const toolResult = buildToolCallResultFixture({
    callId: toolRequest.callId,
    status: "success",
    structuredData: { reused: true },
    evidence: [buildEvidenceRefFixture({ type: "tool", ref: toolRequest.callId })],
  });
  const checkpoint = buildCheckpointFixture({
    checkpointId: "checkpoint-reducer",
    taskId,
    state: "verifying",
    openObligations: ["Confirm reducer diagnostics.", "Preserve checkpoint evidence."],
    contextSummary: "Checkpoint captures replay state.",
    toolResults: [toolResult],
    fileHashes: {
      "b.ts": "sha256:b",
      "a.ts": "sha256:a",
    },
    evidenceRefs: [
      buildEvidenceRefFixture({ type: "checkpoint", ref: "checkpoint-reducer" }),
      buildEvidenceRefFixture({ type: "test", ref: "vitest:runtime-state-reducer" }),
    ],
  });

  return [
    statusEvent("event-created", "created", 1),
    statusEvent("event-planning", "planning", 2),
    statusEvent("event-assembling", "assembling_context", 3),
    buildRuntimeTaskEventFixture({
      eventId: "event-context",
      taskId,
      kind: "context",
      timestamp: 4,
      payload: {
        contextItems: [
          buildContextItemFixture({
            id: "context-reducer",
            kind: "summary",
            text: "Reducer fixture context.",
            evidenceRefs: [buildEvidenceRefFixture({ type: "file", ref: "fixture.ts" })],
          }),
        ],
      },
      evidenceRefs: [],
    }),
    statusEvent("event-running-1", "running", 5),
    statusEvent("event-waiting-permission", "waiting_permission", 6, {
      openObligations: ["Wait for explicit permission."],
    }),
    statusEvent("event-running-2", "running", 7),
    statusEvent("event-waiting-tool", "waiting_tool", 8),
    buildRuntimeTaskEventFixture({
      eventId: "event-tool-request",
      taskId,
      kind: "tool_call_request",
      timestamp: 9,
      payload: toolRequest,
      evidenceRefs: [],
    }),
    buildRuntimeTaskEventFixture({
      eventId: "event-tool-result",
      taskId,
      kind: "tool_call_result",
      timestamp: 10,
      payload: toolResult,
      evidenceRefs: [buildEvidenceRefFixture({ type: "tool", ref: toolRequest.callId })],
    }),
    statusEvent("event-running-3", "running", 11),
    statusEvent("event-waiting-external", "waiting_external", 12),
    statusEvent("event-running-4", "running", 13),
    statusEvent("event-applying", "applying_changes", 14),
    statusEvent("event-verifying", "verifying", 15),
    checkpointEvent("event-checkpoint", 16, checkpoint),
    statusEvent("event-completed", "completed", 17),
  ];
}

describe("RuntimeTaskEvent replay reducer", () => {
  it("replays canonical lifecycle, checkpoint, obligations, tools, files, and evidence", () => {
    const events = lifecycleEvents();
    const checkpointReplay = replayRuntimeTaskEvents(events.slice(0, -1));
    const completedReplay = replayRuntimeTaskEvents(events);

    expect(checkpointReplay.diagnostics).toEqual([]);
    expect(checkpointReplay.state.state).toBe("checkpoint");
    expect(checkpointReplay.state.status).toBe("verifying");
    expect(checkpointReplay.state.latestCheckpoint?.checkpointId).toBe("checkpoint-reducer");
    expect(checkpointReplay.state.openObligations).toEqual([
      "Confirm reducer diagnostics.",
      "Preserve checkpoint evidence.",
    ]);
    expect(checkpointReplay.state.contextSummary).toBe("Checkpoint captures replay state.");
    expect(checkpointReplay.state.toolResultRefs).toEqual(["tool-call-reducer"]);
    expect(checkpointReplay.state.fileHashes).toEqual({
      "a.ts": "sha256:a",
      "b.ts": "sha256:b",
    });
    expect(checkpointReplay.state.evidenceRefs.map((ref) => `${ref.type}:${ref.ref}`))
      .toContain("test:vitest:runtime-state-reducer");

    expect(completedReplay.diagnostics).toEqual([]);
    expect(completedReplay.state.state).toBe("completed");
    expect(completedReplay.state.status).toBe("completed");
    expect(completedReplay.state.pendingToolCallIds).toEqual([]);
  });

  it("replays Lane A event-log records with the same deterministic state as raw events", () => {
    const events = lifecycleEvents();
    const store = new RuntimeTaskEventLogStore();
    store.appendMany(events.map((event) => createRuntimeTaskEventLogEnvelope(event)));

    const fromEvents = replayRuntimeTaskEvents(events);
    const fromRecords = replayRuntimeTaskEventLogRecords(store.exportRecords().records);

    expect(fromRecords.diagnostics).toEqual([]);
    expect(fromRecords.state).toEqual(fromEvents.state);
    expect(JSON.stringify(replayRuntimeTaskEvents(events).state)).toBe(
      JSON.stringify(replayRuntimeTaskEvents(events).state),
    );
  });

  it("keeps waiting tool state pure and does not execute side-effect tool requests", () => {
    const request = buildToolCallRequestFixture({
      callId: "tool-call-pending",
      taskId,
      toolName: "mutating_shell",
      args: { command: "echo should-not-run > touched.txt" },
      idempotencyKey: "tool-call-pending:mutating-shell",
    });
    const events = [
      statusEvent("event-created", "created", 1),
      statusEvent("event-running", "running", 2),
      statusEvent("event-waiting-tool", "waiting_tool", 3),
      buildRuntimeTaskEventFixture({
        eventId: "event-pending-tool-request",
        taskId,
        kind: "tool_call_request",
        timestamp: 4,
        payload: request,
        evidenceRefs: [],
      }),
    ];

    const firstReplay = replayRuntimeTaskEvents(events);
    const secondReplay = replayRuntimeTaskEvents(events);

    expect(firstReplay.state.state).toBe("waiting_tool");
    expect(firstReplay.state.pendingToolCallIds).toEqual(["tool-call-pending"]);
    expect(firstReplay.state.toolResults).toEqual([]);
    expect(firstReplay).toEqual(secondReplay);
  });

  it("classifies failed, blocked, and cancelled terminal states", () => {
    for (const terminal of ["failed", "blocked", "cancelled"] as const) {
      const replay = replayRuntimeTaskEvents([
        statusEvent(`${terminal}-created`, "created", 1),
        statusEvent(`${terminal}-running`, "running", 2),
        statusEvent(`${terminal}-terminal`, terminal, 3),
      ]);

      expect(replay.diagnostics).toEqual([]);
      expect(replay.state.state).toBe(terminal);
      expect(replay.state.status).toBe(terminal);
    }
  });

  it("emits structured diagnostics for invalid and nondeterministic histories", () => {
    const malformedCheckpoint = {
      schemaVersion: 1,
      eventId: "event-missing-checkpoint",
      taskId,
      kind: "checkpoint",
      timestamp: 7,
      payload: {},
      evidenceRefs: [],
    };
    const mismatchedEnvelope = {
      schemaVersion: 1,
      schemaMarker: "runtime.task-event-log.v0",
      event: statusEvent("event-schema-mismatch", "created", 1),
    };
    const replay = replayRuntimeTaskEvents([
      statusEvent("event-created", "created", 1),
      statusEvent("event-running", "running", 2),
      statusEvent("event-running", "verifying", 1),
      statusEvent("event-waiting-tool-out-of-order", "waiting_tool", 1),
      statusEvent("event-running-2", "running", 5),
      malformedCheckpoint,
      mismatchedEnvelope,
      statusEvent("event-terminal", "completed", 8),
      statusEvent("event-after-terminal", "running", 9),
    ]);

    expect(replay.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "duplicate_event_id",
      "invalid_event_order",
      "missing_checkpoint_payload",
      "schema_marker_mismatch",
      "terminal_event_continuation",
    ]);
    expect(replay.state.state).toBe("completed");
    expect(replay.state.duplicateEventIds).toEqual(["event-running"]);
  });

  it("allows explicit continue-as-new compaction markers after terminal events", () => {
    const compaction = createRuntimeTaskContinueAsNewShadow({
      parentTaskId: taskId,
      nextTaskId: "task-reducer-next",
      checkpointId: "checkpoint-compacted",
      reason: "history_compaction",
      openObligations: ["Carry compacted obligation."],
      evidenceRefs: [buildEvidenceRefFixture({ type: "checkpoint", ref: "checkpoint-compacted" })],
    });
    const checkpoint = buildCheckpointFixture({
      checkpointId: "checkpoint-compacted",
      taskId,
      state: "completed",
      openObligations: compaction.openObligations,
      evidenceRefs: compaction.evidenceRefs,
    });
    const compactionEvent = createRuntimeTaskEventLogEnvelope(
      checkpointEvent("event-compaction", 3, checkpoint),
      { metadata: { continueAsNew: compaction } },
    );

    const replay = replayRuntimeTaskEvents([
      statusEvent("event-created", "created", 1),
      statusEvent("event-running-before-compaction", "running", 2),
      statusEvent("event-completed", "completed", 3),
      compactionEvent,
    ]);

    expect(replay.diagnostics).toEqual([]);
    expect(replay.state.compaction).toEqual(compaction);
    expect(replay.state.latestCheckpoint?.checkpointId).toBe("checkpoint-compacted");
    expect(RUNTIME_TASK_EVENT_LOG_SCHEMA_MARKER).toBe("runtime.task-event-log.v1");
  });
});
