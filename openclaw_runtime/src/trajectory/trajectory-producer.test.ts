import { describe, expect, it } from "vitest";
import { createTrajectoryLifecycleProducer } from "./producer.js";
import {
  createTrajectoryRuntimeRecorder,
  type TrajectoryRuntimeRecorder,
} from "./runtime.js";

function createRecorder(events: Array<Record<string, unknown>>): TrajectoryRuntimeRecorder {
  return {
    enabled: true,
    filePath: "trajectory.jsonl",
    recordEvent: () => undefined,
    recordEventV2: (event) => {
      events.push(event as unknown as Record<string, unknown>);
      return true;
    },
    flush: async () => undefined,
    describeFlushState: () => undefined,
  };
}

describe("trajectory lifecycle producer", () => {
  it("writes explicit run, turn, step, and tool lifecycle rows with full tool state", () => {
    const events: Array<Record<string, unknown>> = [];
    const producer = createTrajectoryLifecycleProducer({
      recorder: createRecorder(events),
      runId: "run-1",
      turnId: "turn-1",
    });

    expect(producer.startRun({ status: "running" })).toBe(true);
    expect(producer.startTurn({ status: "running" })).toBe(true);
    expect(producer.startStep("step-1", { status: "running", callId: "step-1" })).toBe(true);
    expect(
      producer.recordAgentEvent({
        stream: "tool",
        data: { phase: "start", toolCallId: "tool-1", name: "read", args: { path: "a" } },
      }),
    ).toBe(true);
    expect(
      producer.recordAgentEvent({
        stream: "tool",
        data: { phase: "update", toolCallId: "tool-1", progressText: "reading" },
      }),
    ).toBe(true);
    expect(
      producer.recordAgentEvent({
        stream: "tool",
        data: { phase: "result", toolCallId: "tool-1", result: { ok: true } },
      }),
    ).toBe(true);
    expect(producer.endTurn({ status: "completed" })).toBe(true);
    expect(producer.endRun({ status: "completed" })).toBe(true);

    expect(events.map((event) => event.type)).toEqual([
      "run/start",
      "turn/start",
      "step/start",
      "tool/start",
      "tool/update",
      "tool/end",
      "step/end",
      "turn/end",
      "run/end",
    ]);
    expect(events[4]?.state).toMatchObject({
      status: "running",
      toolCallId: "tool-1",
      name: "read",
      args: { path: "a" },
      progressText: "reading",
    });
    expect(events[5]?.state).toMatchObject({
      status: "completed",
      toolCallId: "tool-1",
      name: "read",
      args: { path: "a" },
      progressText: "reading",
      result: { ok: true },
    });
    expect(events.every((event) => event.runId === "run-1")).toBe(true);
    expect(events.filter((event) => event.role === "tool").every((event) => event.stepId === "step-1")).toBe(
      true,
    );
  });

  it("refuses tool events without an explicit step or stable tool id", () => {
    const events: Array<Record<string, unknown>> = [];
    const missing: Array<{ reason: string; toolCallId?: string }> = [];
    const producer = createTrajectoryLifecycleProducer({
      recorder: createRecorder(events),
      runId: "run-2",
      turnId: "turn-2",
      onMissingIdentity: (info) => missing.push(info),
    });

    producer.startRun({ status: "running" });
    producer.startTurn({ status: "running" });
    expect(
      producer.recordAgentEvent({
        stream: "tool",
        data: { phase: "start", toolCallId: "tool-without-step" },
      }),
    ).toBe(false);
    expect(producer.startStep("step-2", { status: "running" })).toBe(true);
    expect(
      producer.recordAgentEvent({
        stream: "tool",
        data: { phase: "update", toolCallId: "unknown-tool" },
      }),
    ).toBe(false);
    expect(
      producer.recordAgentEvent({
        stream: "tool",
        data: { phase: "start" },
      }),
    ).toBe(false);

    expect(events.filter((event) => event.role === "tool")).toHaveLength(0);
    expect(missing).toMatchObject([
      { reason: "missing-step-id", toolCallId: "tool-without-step" },
      { reason: "unknown-tool-id", toolCallId: "unknown-tool" },
      { reason: "missing-tool-id" },
    ]);
  });

  it("shares one monotonic sequence across v1 and v2 rows", () => {
    const lines: string[] = [];
    let seq = 0;
    let sourceSeq = 0;
    const writer = {
      filePath: "trajectory.jsonl",
      write: (line: string) => {
        lines.push(line);
        return "queued" as const;
      },
      flush: async () => undefined,
      describeQueue: () => undefined,
      nextSeq: () => (seq += 1),
      nextSourceSeq: () => (sourceSeq += 1),
    } as unknown as Parameters<typeof createTrajectoryRuntimeRecorder>[0]["writer"];
    const recorder = createTrajectoryRuntimeRecorder({
      env: { OPENCLAW_TRAJECTORY: "1" },
      sessionId: "session-1",
      writer,
    });

    recorder?.recordEvent("legacy.event");
    recorder?.recordEventV2({
      type: "run/start",
      role: "run",
      phase: "start",
      runId: "run-1",
      state: { status: "running" },
    });

    expect(lines.map((line) => (JSON.parse(line) as { seq: number }).seq)).toEqual([1, 2]);
    expect(lines.map((line) => (JSON.parse(line) as { schemaVersion: number }).schemaVersion)).toEqual([
      1,
      2,
    ]);
  });
});
