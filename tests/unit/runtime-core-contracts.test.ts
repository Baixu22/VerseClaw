import { describe, expect, it } from "vitest";
import {
  RUNTIME_TASK_EVENT_KINDS,
  RUNTIME_TASK_STATUSES,
  buildCheckpointFixture,
  buildContextItemFixture,
  buildEvidenceRefFixture,
  buildRuntimeTaskEventFixture,
  buildToolCallRequestFixture,
  buildToolCallResultFixture,
  isCheckpoint,
  isContextItem,
  isEvidenceRef,
  isRuntimeTaskEvent,
  isRuntimeTaskEventKind,
  isRuntimeTaskStatus,
  isToolCallRequest,
  isToolCallResult,
  mapLegacyRuntimeTaskStatus,
  parseRuntimeTaskEvent,
  serializeRuntimeTaskEvent,
} from "../../openclaw_runtime/src/runtime-core";

describe("runtime-core contracts", () => {
  it("defines the canonical runtime task status and event vocabularies", () => {
    expect(RUNTIME_TASK_STATUSES).toEqual([
      "created",
      "planning",
      "assembling_context",
      "running",
      "waiting_permission",
      "waiting_tool",
      "waiting_external",
      "applying_changes",
      "verifying",
      "completed",
      "failed",
      "blocked",
      "cancelled",
    ]);
    expect(RUNTIME_TASK_EVENT_KINDS).toEqual([
      "created",
      "planning",
      "assembling_context",
      "running",
      "waiting_permission",
      "waiting_tool",
      "waiting_external",
      "applying_changes",
      "verifying",
      "completed",
      "failed",
      "blocked",
      "cancelled",
      "progress",
      "context",
      "tool_call_request",
      "tool_call_result",
      "evidence",
      "checkpoint",
      "error",
    ]);

    expect(isRuntimeTaskStatus("assembling_context")).toBe(true);
    expect(isRuntimeTaskStatus("queued")).toBe(false);
    expect(isRuntimeTaskEventKind("tool_call_result")).toBe(true);
    expect(isRuntimeTaskEventKind("task_loop")).toBe(false);
  });

  it("validates the canonical contract shapes", () => {
    const evidence = buildEvidenceRefFixture({
      type: "file",
      ref: "openclaw_runtime/src/runtime-core/types.ts",
    });
    const contextItem = buildContextItemFixture({
      evidenceRefs: [evidence],
      metadata: { sourceRun: "run_1", retained: true },
    });
    const request = buildToolCallRequestFixture({
      args: { path: "README.md", maxBytes: 1024 },
      traceContext: { traceId: "trace_1", attributes: { lane: "runtime-core" } },
    });
    const result = buildToolCallResultFixture({
      contextItems: [contextItem],
      structuredData: { bytes: 12 },
      evidence: [buildEvidenceRefFixture({ type: "tool", ref: request.callId })],
    });
    const checkpoint = buildCheckpointFixture({
      state: "waiting_tool",
      toolResults: [result],
      evidenceRefs: [evidence],
    });
    const event = buildRuntimeTaskEventFixture({
      kind: "tool_call_result",
      payload: result,
      evidenceRefs: [evidence],
    });

    expect(isEvidenceRef(evidence)).toBe(true);
    expect(isContextItem(contextItem)).toBe(true);
    expect(isToolCallRequest(request)).toBe(true);
    expect(isToolCallResult(result)).toBe(true);
    expect(isCheckpoint(checkpoint)).toBe(true);
    expect(isRuntimeTaskEvent(event)).toBe(true);
    expect(event).toMatchObject({
      schemaVersion: 1,
      eventId: "event_1",
      taskId: "task_1",
      kind: "tool_call_result",
      timestamp: 1,
      payload: { callId: "tool_call_1", status: "success" },
      evidenceRefs: [{ type: "file" }],
    });
  });

  it("builds a valid fixture for every runtime task event kind", () => {
    for (const kind of RUNTIME_TASK_EVENT_KINDS) {
      const event = buildRuntimeTaskEventFixture({ kind });

      expect(isRuntimeTaskEvent(event)).toBe(true);
      expect(event.schemaVersion).toBe(1);
      expect(event.kind).toBe(kind);
      if (isRuntimeTaskStatus(kind)) {
        expect((event.payload as { status: string }).status).toBe(kind);
      }
    }
  });

  it("round-trips runtime task events through JSON serialization", () => {
    const event = buildRuntimeTaskEventFixture({
      kind: "error",
      payload: {
        error: {
          type: "tool",
          message: "permission denied",
          retryable: false,
          evidenceRefs: [{ type: "tool", ref: "tool_call_1" }],
        },
      },
    });

    const serialized = serializeRuntimeTaskEvent(event);
    const parsed = parseRuntimeTaskEvent(serialized);

    expect(parsed).toEqual(event);
  });

  it("rejects malformed contract values", () => {
    const request = buildToolCallRequestFixture();
    const statusEvent = buildRuntimeTaskEventFixture({ kind: "running" });
    const mismatchedStatus = {
      ...statusEvent,
      payload: { status: "failed" },
    };
    const malformedToolResult = {
      ...buildRuntimeTaskEventFixture({ kind: "tool_call_result" }),
      payload: {
        callId: "",
        status: "success",
        contextItems: [],
        startedAt: 1,
        finishedAt: 2,
        evidence: [],
      },
    };

    expect(isEvidenceRef({ type: "file", ref: "" })).toBe(false);
    expect(isToolCallRequest({ ...request, args: { value: Number.NaN } })).toBe(false);
    expect(isRuntimeTaskEvent(mismatchedStatus)).toBe(false);
    expect(isRuntimeTaskEvent(malformedToolResult)).toBe(false);
    expect(() => parseRuntimeTaskEvent(JSON.stringify(malformedToolResult))).toThrow(
      "Invalid runtime task event contract",
    );
    expect(() => parseRuntimeTaskEvent("{")).toThrow("Invalid runtime task event JSON");
  });

  it("maps legacy runtime task statuses explicitly", () => {
    expect(mapLegacyRuntimeTaskStatus("queued")).toBe("created");
    expect(mapLegacyRuntimeTaskStatus("ready")).toBe("planning");
    expect(mapLegacyRuntimeTaskStatus("succeeded")).toBe("completed");
    expect(mapLegacyRuntimeTaskStatus("timed_out")).toBe("failed");
    expect(mapLegacyRuntimeTaskStatus("cancelled")).toBe("cancelled");
    expect(mapLegacyRuntimeTaskStatus("waiting_tool")).toBe("waiting_tool");
    expect(mapLegacyRuntimeTaskStatus("unknown")).toBeUndefined();
    expect(mapLegacyRuntimeTaskStatus(null)).toBeUndefined();
  });
});
