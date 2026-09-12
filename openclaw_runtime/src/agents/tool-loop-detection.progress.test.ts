import { afterEach, describe, expect, it } from "vitest";
import type { ToolLoopDetectionConfig } from "../config/types.tools.js";
import type { SessionState } from "../logging/diagnostic-session-state.js";
import {
  getDiagnosticSessionState,
  resetDiagnosticSessionStateForTest,
} from "../logging/diagnostic-session-state.js";
import {
  CRITICAL_THRESHOLD,
  GLOBAL_CIRCUIT_BREAKER_THRESHOLD,
  TOOL_CALL_HISTORY_SIZE,
  UNKNOWN_TOOL_THRESHOLD,
  WARNING_THRESHOLD,
  detectToolCallLoop,
  recordToolCall,
  recordToolCallOutcome,
} from "./tool-loop-detection.js";

function state(): SessionState {
  return { lastActivity: Date.now(), state: "processing", queueDepth: 0 };
}

afterEach(() => resetDiagnosticSessionStateForTest());

function recordCalls(
  session: SessionState,
  count: number,
  params: {
    toolName?: string;
    toolParams?: unknown;
    config?: ToolLoopDetectionConfig;
    runId?: string;
    result?: unknown;
    error?: unknown;
    idPrefix?: string;
  } = {},
): void {
  const toolName = params.toolName ?? "read";
  const toolParams = params.toolParams ?? {};
  for (let index = 0; index < count; index++) {
    const toolCallId = `${params.idPrefix ?? "call"}-${index}`;
    recordToolCall(session, toolName, toolParams, toolCallId, params.config, {
      runId: params.runId,
    });
    recordToolCallOutcome(session, {
      toolName,
      toolParams,
      toolCallId,
      config: params.config,
      runId: params.runId,
      ...(params.error
        ? { error: params.error }
        : { result: params.result ?? { content: [{ type: "text", text: "unchanged" }] } }),
    });
  }
}

describe("tool-loop progress evidence", () => {
  it("TF-0188 merges session aliases in chronological order so old outcomes cannot hide progress", () => {
    const idOnly = getDiagnosticSessionState({ sessionId: "alias-id" });
    const keyOnly = getDiagnosticSessionState({ sessionKey: "alias-key" });
    const config = { warningThreshold: 2, criticalThreshold: 4, globalCircuitBreakerThreshold: 5 };
    recordCalls(idOnly, 4, { config, runId: "alias-run", idPrefix: "old" });
    idOnly.toolCallHistory!.forEach((record, index) => {
      record.timestamp = index + 1;
    });
    recordCalls(keyOnly, 1, {
      config,
      runId: "alias-run",
      idPrefix: "new",
      result: { content: [{ type: "text", text: "actual progress" }] },
    });
    keyOnly.toolCallHistory![0].timestamp = 10;
    const merged = getDiagnosticSessionState({ sessionId: "alias-id", sessionKey: "alias-key" });
    const detection = detectToolCallLoop(merged, "read", {}, config, { runId: "alias-run" });
    expect(detection.stuck && detection.level === "critical").toBe(false);
    expect(merged.toolCallHistory!.map((record) => record.timestamp)).toEqual([1, 2, 3, 4, 10]);
  });

  it.each(["generic_repeat", "global_circuit_breaker", "unknown_tool_repeat"] as const)(
    "retains enough bounded history to reach %s",
    (detector) => {
      const session = state();
      const config: ToolLoopDetectionConfig = {
        historySize: 5,
        warningThreshold: 2,
        criticalThreshold: detector === "generic_repeat" ? 12 : 3,
        globalCircuitBreakerThreshold: detector === "global_circuit_breaker" ? 12 : 4,
        unknownToolThreshold: detector === "unknown_tool_repeat" ? 12 : 3,
        detectors: { genericRepeat: detector === "generic_repeat" },
      };
      const threshold =
        detector === "generic_repeat" ? 12 : detector === "global_circuit_breaker" ? 12 : 12;
      for (let index = 0; index < threshold; index++) {
        const params = detector === "unknown_tool_repeat" ? { attempt: index } : {};
        const toolCallId = `large-threshold-${index}`;
        recordToolCall(session, "read", params, toolCallId, config);
        recordToolCallOutcome(session, {
          toolName: "read",
          toolParams: params,
          toolCallId,
          config,
          ...(detector === "unknown_tool_repeat"
            ? { error: new Error("Unknown tool: unavailable_reader") }
            : { result: { content: [{ type: "text", text: "unchanged" }] } }),
        });
      }
      expect(detectToolCallLoop(session, "read", {}, config)).toMatchObject({
        stuck: true,
        level: "critical",
        detector,
      });
      expect(session.toolCallHistory!.length).toBeLessThanOrEqual(12);
    },
  );

  it("keeps default termination thresholds unchanged", () => {
    const session = state();
    recordCalls(session, CRITICAL_THRESHOLD);
    expect(detectToolCallLoop(session, "read", {})).toMatchObject({
      stuck: true,
      level: "critical",
      detector: "generic_repeat",
    });
    expect(session.toolCallHistory!.length).toBeLessThanOrEqual(TOOL_CALL_HISTORY_SIZE);
    expect(WARNING_THRESHOLD).toBe(10);
    expect(UNKNOWN_TOOL_THRESHOLD).toBe(10);
    expect(CRITICAL_THRESHOLD).toBe(20);
    expect(GLOBAL_CIRCUIT_BREAKER_THRESHOLD).toBe(30);
    expect(TOOL_CALL_HISTORY_SIZE).toBe(30);
  });

  it("does not let another run evict the current run's termination evidence", () => {
    const session = state();
    const config: ToolLoopDetectionConfig = {
      historySize: 5,
      warningThreshold: 2,
      criticalThreshold: 6,
      globalCircuitBreakerThreshold: 7,
      unknownToolThreshold: 3,
    };
    recordCalls(session, 8, { config, runId: "other-run", idPrefix: "other" });
    recordCalls(session, 6, { config, runId: "current-run", idPrefix: "current" });
    expect(detectToolCallLoop(session, "read", {}, config, { runId: "current-run" })).toMatchObject(
      {
        stuck: true,
        level: "critical",
        detector: "generic_repeat",
      },
    );
    const currentCount = session.toolCallHistory!.filter(
      (record) => record.runId === "current-run",
    ).length;
    const otherCount = session.toolCallHistory!.filter(
      (record) => record.runId === "other-run",
    ).length;
    expect(currentCount).toBeGreaterThanOrEqual(6);
    expect(otherCount).toBeLessThanOrEqual(7);
  });

  it.each(["poll", "log"] as const)(
    "ignores changing process %s idle duration when judging no progress",
    (action) => {
      const session = state();
      const config: ToolLoopDetectionConfig = {
        warningThreshold: 2,
        criticalThreshold: 4,
        globalCircuitBreakerThreshold: 5,
        detectors: { genericRepeat: false, knownPollNoProgress: true },
      };
      const params = { action, sessionId: "proc-1" };
      for (let index = 0; index < 4; index++) {
        const toolCallId = `${action}-${index}`;
        recordToolCall(session, "process", params, toolCallId, config);
        recordToolCallOutcome(session, {
          toolName: "process",
          toolParams: params,
          toolCallId,
          config,
          result: {
            content: [
              {
                type: "text",
                text:
                  "(no new output)\n\nNo new output for " +
                  `${index + 1}s; this session may be waiting for input. Use process write, send-keys, submit, or paste to provide input.`,
              },
            ],
            details: {
              status: "running",
              aggregated: "seed",
              idleMs: (index + 1) * 1000,
              lastOutputAt: 1,
              retryInMs: 250 * (index + 1),
            },
          },
        });
      }
      expect(detectToolCallLoop(session, "process", params, config)).toMatchObject({
        stuck: true,
        level: "critical",
        detector: "known_poll_no_progress",
      });
    },
  );

  it.each(["image", "audio", "resource"])(
    "distinguishes changing %s content from a repeated outcome",
    (type) => {
      for (const changing of [true, false]) {
        const session = state();
        for (let index = 0; index < 20; index++) {
          const data = `private-media-${changing ? index : 0}`;
          const content =
            type === "resource"
              ? { type, resource: { uri: "test://resource", text: data } }
              : { type, mimeType: `${type}/test`, data };
          const toolCallId = `media-${index}`;
          recordToolCall(session, "read", { path: "result" }, toolCallId);
          recordToolCallOutcome(session, {
            toolName: "read",
            toolParams: { path: "result" },
            toolCallId,
            result: { content: [content] },
          });
        }
        const detection = detectToolCallLoop(session, "read", { path: "result" });
        expect(detection.stuck && detection.level === "critical").toBe(!changing);
        expect(JSON.stringify(session)).not.toContain("private-media");
      }
    },
  );
});
