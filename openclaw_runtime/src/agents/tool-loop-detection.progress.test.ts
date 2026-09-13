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
  it.each([false, true])(
    "TF-0207 replay after history trimming stays ignored across alias merge=%s",
    (merge) => {
      const session = merge ? getDiagnosticSessionState({ sessionId: "dedup-alias-id" }) : state();
      recordCalls(session, 1, { runId: "trimmed-run", idPrefix: "completed" });
      recordCalls(session, TOOL_CALL_HISTORY_SIZE + 5, {
        runId: "trimmed-run",
        idPrefix: "new-progress",
        toolParams: { path: "new-file" },
      });
      let target = session;
      if (merge) {
        getDiagnosticSessionState({ sessionKey: "dedup-alias-key" });
        target = getDiagnosticSessionState({
          sessionId: "dedup-alias-id",
          sessionKey: "dedup-alias-key",
        });
      }
      const retained = [...target.toolCallHistory!];
      expect(retained.some((call) => call.toolCallId === "completed-0")).toBe(false);
      expect(
        recordToolCallOutcome(target, {
          toolName: "read",
          toolParams: {},
          toolCallId: "completed-0",
          runId: "trimmed-run",
          result: { content: [{ type: "text", text: "unchanged" }] },
        }),
      ).toBeUndefined();
      expect(target.toolCallHistory).toEqual(retained);
    },
  );

  it("TF-0207 still observes the first result-only delivery when general loop detection is disabled", () => {
    const session = state();
    const outcome = {
      toolName: "read",
      toolParams: {},
      toolCallId: "result-only",
      runId: "observer-run",
      config: { enabled: false },
      result: { content: [{ type: "text", text: "done" }] },
    };
    expect(recordToolCallOutcome(session, outcome)).toBeDefined();
    expect(recordToolCallOutcome(session, outcome)).toBeUndefined();
    expect(session.toolCallHistory).toHaveLength(1);
  });

  it("TF-0208 retains four completed calls even when every configured threshold fits three", () => {
    const session = state();
    const config: ToolLoopDetectionConfig = {
      historySize: 3,
      warningThreshold: 1,
      criticalThreshold: 2,
      globalCircuitBreakerThreshold: 3,
      unknownToolThreshold: 3,
      detectors: { genericRepeat: false, knownPollNoProgress: false, pingPong: true },
    };
    for (let index = 0; index < 8; index++) {
      recordCalls(session, 1, {
        config,
        toolName: index % 2 === 0 ? "read" : "list",
        idPrefix: "small-window-" + index,
      });
    }
    expect(detectToolCallLoop(session, "read", {}, config)).toMatchObject({
      stuck: true,
      level: "critical",
      detector: "ping_pong",
    });
    expect(session.toolCallHistory).toHaveLength(4);
  });

  it("TF-0207 duplicate terminal delivery does not inflate one run's loop history", () => {
    const session = state();
    const config = { warningThreshold: 2, criticalThreshold: 4, globalCircuitBreakerThreshold: 5 };
    recordCalls(session, 2, { config, runId: "dedup-run" });
    const originalHashes = session.toolCallHistory!.map((call) => call.resultHash);
    for (let i = 0; i < 2; i++) {
      expect(
        recordToolCallOutcome(session, {
          toolName: "read",
          toolParams: {},
          toolCallId: "call-" + i,
          runId: "dedup-run",
          config,
          result: { content: [{ type: "text", text: "unchanged" }] },
        }),
      ).toBeUndefined();
    }
    expect(session.toolCallHistory).toHaveLength(2);
    expect(session.toolCallHistory!.map((call) => call.resultHash)).toEqual(originalHashes);
    const detection = detectToolCallLoop(session, "read", {}, config, { runId: "dedup-run" });
    expect(detection.stuck && detection.level === "critical").toBe(false);
    recordCalls(session, 1, { config, runId: "separate-run" });
    expect(session.toolCallHistory).toHaveLength(3);
  });

  it("TF-0208 ping-pong requires repeated outcomes on both sides", () => {
    const session = state();
    const config = {
      warningThreshold: 2,
      criticalThreshold: 3,
      globalCircuitBreakerThreshold: 6,
      detectors: { genericRepeat: false, knownPollNoProgress: false, pingPong: true },
    };
    for (let i = 0; i < 4; i++) {
      const toolName = i % 2 === 0 ? "read" : "list";
      const before = detectToolCallLoop(session, toolName, {}, config);
      expect(before.stuck).toBe(false);
      recordCalls(session, 1, { config, toolName, idPrefix: "alternating-" + i });
    }
    expect(detectToolCallLoop(session, "read", {}, config)).toMatchObject({
      stuck: true,
      level: "critical",
      detector: "ping_pong",
    });
  });

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

  it("TF-0195 does not warn on ping-pong that is still making progress", () => {
    const session = state();
    const config: ToolLoopDetectionConfig = {
      warningThreshold: 4,
      criticalThreshold: 8,
      detectors: { genericRepeat: false, pingPong: true },
    };
    for (let index = 0; index < 6; index++) {
      const toolName = index % 2 === 0 ? "read" : "write";
      const toolParams = { path: toolName };
      const toolCallId = `ping-pong-${index}`;
      recordToolCall(session, toolName, toolParams, toolCallId, config);
      recordToolCallOutcome(session, {
        toolName,
        toolParams,
        toolCallId,
        config,
        result: { content: [{ type: "text", text: `progress-${index}` }] },
      });
    }
    expect(detectToolCallLoop(session, "read", { path: "read" }, config)).toEqual({ stuck: false });
  });

  it("TF-0197 alias merge keeps existing stuck and long-running warn timestamps", () => {
    const now = Date.now();
    const idOnly = getDiagnosticSessionState({ sessionId: "warn-id" });
    idOnly.state = "processing";
    idOnly.lastStuckWarnAgeMs = 100;
    idOnly.lastLongRunningWarnAgeMs = 200;
    idOnly.lastActivity = now;
    const keyOnly = getDiagnosticSessionState({ sessionKey: "warn-key" });
    keyOnly.state = "processing";
    keyOnly.lastActivity = now + 1;
    const merged = getDiagnosticSessionState({ sessionId: "warn-id", sessionKey: "warn-key" });
    expect(merged.lastStuckWarnAgeMs).toBe(100);
    expect(merged.lastLongRunningWarnAgeMs).toBe(200);
    expect(merged.lastActivity).toBe(now);
  });

  it.each([
    { newer: "id", warning: undefined },
    { newer: "key", warning: undefined },
    { newer: "id", warning: 1000 },
    { newer: "key", warning: 1000 },
  ])("TF-0197 newer $newer activity keeps its warning cycle ($warning)", ({ newer, warning }) => {
    const idOnly = getDiagnosticSessionState({ sessionId: "progress-warn-id" });
    const keyOnly = getDiagnosticSessionState({ sessionKey: "progress-warn-key" });
    const previous = newer === "id" ? keyOnly : idOnly;
    const progressed = newer === "id" ? idOnly : keyOnly;
    const now = Date.now();
    previous.state = "processing";
    previous.generation = 20;
    previous.lastActivity = now - 600_000;
    previous.lastStuckWarnAgeMs = 600_000;
    previous.lastLongRunningWarnAgeMs = 600_000;
    // Alias generations are independent; the newer activity can have the lower counter.
    progressed.state = "processing";
    progressed.generation = 1;
    progressed.lastActivity = now;
    progressed.lastStuckWarnAgeMs = warning;
    progressed.lastLongRunningWarnAgeMs = warning;
    const merged = getDiagnosticSessionState({
      sessionId: "progress-warn-id",
      sessionKey: "progress-warn-key",
    });
    expect(merged.lastActivity).toBe(now);
    expect(merged.lastStuckWarnAgeMs).toBe(warning);
    expect(merged.lastLongRunningWarnAgeMs).toBe(warning);
  });

  it("TF-0197 the same activity cycle keeps the later warning backoff", () => {
    const idOnly = getDiagnosticSessionState({ sessionId: "same-cycle-id" });
    const keyOnly = getDiagnosticSessionState({ sessionKey: "same-cycle-key" });
    for (const alias of [idOnly, keyOnly]) {
      alias.state = "processing";
      alias.generation = 1;
      alias.lastActivity = 1000;
    }
    idOnly.lastStuckWarnAgeMs = 100;
    idOnly.lastLongRunningWarnAgeMs = 400;
    keyOnly.lastStuckWarnAgeMs = 200;
    keyOnly.lastLongRunningWarnAgeMs = 300;
    const merged = getDiagnosticSessionState({
      sessionId: "same-cycle-id",
      sessionKey: "same-cycle-key",
    });
    expect(merged.lastStuckWarnAgeMs).toBe(200);
    expect(merged.lastLongRunningWarnAgeMs).toBe(400);
  });
});
