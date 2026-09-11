/**
 * Regression for the live CDP failure in session s05-t01 (2026-09-11).
 *
 * The loop detector blocked the 21st identical `read` call, but the veto was only
 * returned as a blocked tool result. The model kept re-issuing the same call and
 * the run stayed alive until an operator stopped it (43 read results observed).
 * A critical veto must now notify the host so it can terminate the turn, while a
 * warning-level repeat must stay non-terminal.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetDiagnosticSessionStateForTest } from "../logging/diagnostic-session-state.js";
import {
  wrapToolWithBeforeToolCallHook,
  type HookContext,
} from "./agent-tools.before-tool-call.js";
import type { ToolLoopTerminationInfo } from "./tool-loop-termination.js";
import type { AnyAgentTool } from "./tools/common.js";

afterEach(() => {
  resetDiagnosticSessionStateForTest();
});

const READ_RESULT = {
  content: [{ type: "text" as const, text: "id,status,minutes\nA01,done,12\n" }],
};

function readTool(): AnyAgentTool {
  return {
    name: "read",
    label: "read",
    description: "read",
    parameters: { type: "object", additionalProperties: false },
    execute: async () => READ_RESULT,
  } as unknown as AnyAgentTool;
}

function readParams(): unknown {
  return { path: "data/work-log.csv" };
}

function isBlockedLoopResult(result: unknown): boolean {
  const details = (result as { details?: Record<string, unknown> } | undefined)?.details;
  return details?.status === "blocked" && details?.deniedReason === "tool-loop";
}

describe("critical tool-loop termination", () => {
  it("notifies the host once when an identical call loop turns critical", async () => {
    const terminations: ToolLoopTerminationInfo[] = [];
    const ctx: HookContext = {
      sessionKey: "session-loop-termination",
      runId: "run-loop-termination",
      onToolLoopTermination: (info) => terminations.push(info),
    };
    const tool = wrapToolWithBeforeToolCallHook(readTool(), ctx);

    const results: unknown[] = [];
    for (let i = 0; i < 25; i += 1) {
      results.push(await tool.execute(`call-${i}`, readParams()));
    }

    const blockedIndexes = results
      .map((result, index) => (isBlockedLoopResult(result) ? index : -1))
      .filter((index) => index >= 0);

    // The 21st call is the first one that reaches the critical threshold (20).
    expect(blockedIndexes[0]).toBe(20);
    expect(blockedIndexes.length).toBeGreaterThan(1);
    // Every blocked repeat notifies the host; the host dedupes the abort itself
    // (`toolLoopAbortError ??=`), so the observer stays a pure signal.
    expect(terminations).toHaveLength(blockedIndexes.length);
    expect(terminations[0]).toMatchObject({
      toolName: "read",
      detector: "generic_repeat",
    });
    expect(terminations.every((info) => info.detector === "generic_repeat")).toBe(true);
    expect(terminations[0].count).toBeGreaterThanOrEqual(20);
    expect(terminations[0].message).toContain("identical arguments");
  });

  it("keeps warning-level repeats non-terminal", async () => {
    const onToolLoopTermination = vi.fn();
    const ctx: HookContext = {
      sessionKey: "session-loop-warning",
      runId: "run-loop-warning",
      onToolLoopTermination,
    };
    const tool = wrapToolWithBeforeToolCallHook(readTool(), ctx);

    const results: unknown[] = [];
    for (let i = 0; i < 10; i += 1) {
      results.push(await tool.execute(`call-${i}`, readParams()));
    }

    expect(results.every((result) => !isBlockedLoopResult(result))).toBe(true);
    expect(onToolLoopTermination).not.toHaveBeenCalled();
  });

  it("still returns the blocked result when the host wires no termination observer", async () => {
    const ctx: HookContext = {
      sessionKey: "session-loop-no-observer",
      runId: "run-loop-no-observer",
    };
    const tool = wrapToolWithBeforeToolCallHook(readTool(), ctx);

    const results: unknown[] = [];
    for (let i = 0; i < 21; i += 1) {
      results.push(await tool.execute(`call-${i}`, readParams()));
    }

    expect(isBlockedLoopResult(results[20])).toBe(true);
  });
});
