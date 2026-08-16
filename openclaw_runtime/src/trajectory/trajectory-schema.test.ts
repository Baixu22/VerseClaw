import { describe, expect, it } from "vitest";
import {
  parseSerializedTrajectoryEvent,
  safeParseTrajectoryEvent,
  safeParseTrajectoryEventV2,
  serializeTrajectoryEvent,
} from "./schema.js";
import { replayTrajectoryEvents, replaceTrajectoryState, TrajectoryReplayError } from "./replay.js";

const baseEvent = {
  traceSchema: "openclaw-trajectory",
  schemaVersion: 2,
  traceId: "trace-1",
  source: "runtime",
  ts: "2026-08-14T00:00:00.000Z",
  runId: "run-1",
  state: { status: "running" },
} as const;

function makeEvent(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    ...baseEvent,
    ...overrides,
  };
}

function toolEvents(): Record<string, unknown>[] {
  return [
    makeEvent({
      seq: 1,
      type: "tool/start",
      role: "tool",
      phase: "start",
      turnId: "turn-1",
      stepId: "step-1",
      toolCallId: "tool-1",
      state: { status: "running", input: { command: "list" }, stale: true },
    }),
    makeEvent({
      seq: 2,
      type: "tool/update",
      role: "tool",
      phase: "update",
      turnId: "turn-1",
      stepId: "step-1",
      toolCallId: "tool-1",
      state: { status: "running", output: "partial" },
    }),
    makeEvent({
      seq: 3,
      type: "tool/end",
      role: "tool",
      phase: "end",
      turnId: "turn-1",
      stepId: "step-1",
      toolCallId: "tool-1",
      state: { status: "done", output: "complete" },
    }),
  ];
}

describe("openclaw-trajectory v2 schema", () => {
  it("accepts every declared lifecycle role and phase", () => {
    const events = [
      makeEvent({ seq: 1, type: "run/start", role: "run", phase: "start" }),
      makeEvent({ seq: 2, type: "turn/start", role: "turn", phase: "start", turnId: "turn-1" }),
      makeEvent({
        seq: 3,
        type: "step/start",
        role: "step",
        phase: "start",
        turnId: "turn-1",
        stepId: "step-1",
      }),
      ...toolEvents()
        .slice(0, 1)
        .map((event) => ({ ...event, seq: 4 })),
      ...toolEvents()
        .slice(1, 2)
        .map((event) => ({ ...event, seq: 5 })),
      ...toolEvents()
        .slice(2)
        .map((event) => ({ ...event, seq: 6 })),
      makeEvent({
        seq: 7,
        type: "step/end",
        role: "step",
        phase: "end",
        turnId: "turn-1",
        stepId: "step-1",
        state: { status: "done" },
      }),
      makeEvent({
        seq: 8,
        type: "turn/end",
        role: "turn",
        phase: "end",
        turnId: "turn-1",
        state: { status: "done" },
      }),
      makeEvent({ seq: 9, type: "run/end", role: "run", phase: "end", state: { status: "done" } }),
    ];

    for (const event of events) {
      expect(safeParseTrajectoryEventV2(event).success).toBe(true);
    }
  });

  it("rejects invalid lifecycle shapes instead of guessing context", () => {
    const missingToolId = makeEvent({
      seq: 1,
      type: "tool/start",
      role: "tool",
      phase: "start",
      turnId: "turn-1",
      stepId: "step-1",
      toolCallId: undefined,
    });
    const invalidUpdate = makeEvent({
      seq: 2,
      type: "run/update",
      role: "run",
      phase: "update",
    });

    expect(safeParseTrajectoryEventV2(missingToolId).success).toBe(false);
    expect(safeParseTrajectoryEventV2(invalidUpdate).success).toBe(false);
    expect(() => replayTrajectoryEvents([missingToolId])).toThrow(TrajectoryReplayError);
  });

  it("replaces complete snapshots so replay equals full replace", () => {
    const events = toolEvents();
    const replayed = replayTrajectoryEvents(events);
    const replaced = replaceTrajectoryState(events);
    expect(replayed.state).toEqual(replaced);
    expect(replayed.state.entities["tool:tool-1"].state).toEqual({
      status: "done",
      output: "complete",
    });
  });

  it("sorts non-monotonic input deterministically and rejects duplicate seq", () => {
    const events = toolEvents();
    const normal = replayTrajectoryEvents(events);
    const reordered = replayTrajectoryEvents([events[2], events[0], events[1]]);
    expect(reordered.inputWasNonMonotonic).toBe(true);
    expect(reordered.events.map((event) => event.seq)).toEqual([1, 2, 3]);
    expect(reordered.state).toEqual(normal.state);

    expect(() => replayTrajectoryEvents([events[0], { ...events[1], seq: 1 }])).toThrow(
      /duplicate seq 1/,
    );
  });

  it("reads v1 rows and preserves v2 JSON semantics across round trips", () => {
    const v1 = {
      traceSchema: "openclaw-trajectory",
      schemaVersion: 1,
      traceId: "trace-1",
      source: "runtime",
      type: "legacy.event",
      ts: "2026-08-14T00:00:00.000Z",
      seq: 1,
      sourceSeq: 4,
      sessionId: "session-1",
      data: { legacy: true },
    };
    const parsedV1 = safeParseTrajectoryEvent(v1);
    expect(parsedV1).toMatchObject({ success: true, version: 1, event: v1 });

    const v2Result = safeParseTrajectoryEventV2(toolEvents()[0]);
    expect(v2Result.success).toBe(true);
    if (!v2Result.success) {
      return;
    }
    const serialized = serializeTrajectoryEvent(v2Result.event);
    expect(parseSerializedTrajectoryEvent(serialized)).toEqual(v2Result.event);
  });
});
