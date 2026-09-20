import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearTaskStateHandlerConfig,
  runAgentHarnessTaskPhaseChangeHook,
  setTaskStateHandlerConfig,
} from "../../agents/harness/lifecycle-hook-helpers.js";
import type { RuntimeLineage } from "../../runtime-core/lineage.js";
import { closeOpenClawStateDatabaseForTest } from "../../state/openclaw-state-db.js";
import { DistillationTool } from "./distillation-tool.js";
import { installSekbHarnessHooks } from "./harness-integration.js";
import { KnowledgeStore } from "./knowledge-store.js";
import { RetrievalEngine } from "./retrieval-engine.js";
import { TrajectoryCapture } from "./trajectory-capture.js";

const tempRoots: string[] = [];

afterEach(() => {
  clearTaskStateHandlerConfig();
  closeOpenClawStateDatabaseForTest();
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("TF-0073 terminal trajectory candidate gating", () => {
  it("excludes terminal-only and incomplete-lineage trajectories from suggestions", () => {
    const store = createStore();
    const capture = new TrajectoryCapture({ store });
    const completeLineage = lineage("run-real-a", "trace-real-a");

    const terminalOnly = capture.start_trajectory("task complete", "agent/task", ["completed"], {
      runtimeLineage: completeLineage,
      sekbCaptureOrigin: "task_phase_terminal",
      sekbCaptureKey: "task_phase_terminal:session-tf-0073:run-real-a:trace-real-a",
    });
    capture.finish_trajectory(terminalOnly, "success");

    const missingLineage = capture.start_trajectory("legacy runtime", "agent/task", []);
    capture.log_step(missingLineage, "tool.call", {}, { toolName: "read" });
    capture.finish_trajectory(missingLineage, "success");

    const realA = captureRealTrajectory(capture, completeLineage, "real-a");
    const realB = captureRealTrajectory(capture, lineage("run-real-b", "trace-real-b"), "real-b");

    const suggestions = new DistillationTool({ store }).suggest_principles_from_trajectories(
      [terminalOnly, missingLineage, realA, realB],
      2,
    );

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.source_trajectory_ids).toEqual([realA, realB].toSorted());
    expect(store.query_principles({})).toHaveLength(0);
  });

  it("deduplicates replayed terminal capture by runtime lineage", async () => {
    const store = createStore();
    const capture = new TrajectoryCapture({ store });
    const runtimeLineage = lineage("run-replay", "trace-replay");

    const captureTerminal = async () => {
      setTaskStateHandlerConfig({
        runId: "run-replay",
        sessionId: runtimeLineage.sessionId,
        trajectoryCapture: capture,
        objective: "Replay-safe task",
        lineage: runtimeLineage,
      });
      return await runAgentHarnessTaskPhaseChangeHook({
        event: {
          sessionId: runtimeLineage.sessionId,
          taskId: "run-replay",
          fromStatus: "verifying",
          toStatus: "completed",
          lineage: runtimeLineage,
        },
        ctx: { runId: "run-replay", sessionId: runtimeLineage.sessionId },
      });
    };

    const first = await captureTerminal();
    const second = await captureTerminal();

    expect(first.trajectory.status).toBe("captured");
    expect(second.trajectory).toEqual({
      status: "skipped",
      reason: "duplicate_terminal_capture",
      trajectoryId: first.trajectory.trajectoryId,
    });
    expect(store.query_trajectories({})).toHaveLength(1);
  });

  it("deduplicates repeated source ids and keeps deterministic candidate ordering", () => {
    const store = createStore();
    const capture = new TrajectoryCapture({ store });
    const first = captureRealTrajectory(capture, lineage("run-z", "trace-z"), "z");
    const second = captureRealTrajectory(capture, lineage("run-a", "trace-a"), "a");

    const suggestions = new DistillationTool({ store }).suggest_principles_from_trajectories(
      [first, second, first, second],
      2,
    );

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.source_trajectory_ids).toEqual([first, second].toSorted());
  });

  it("marks real agent_end captures with lineage and admits only their tool evidence", async () => {
    const store = createStore();
    const capture = new TrajectoryCapture({ store });
    const injector = new RetrievalEngine({ store }).create_context_injector();
    const target = createHookTarget();
    let runtimeLineage = lineage("run-agent-end", "trace-agent-end");
    const uninstall = installSekbHarnessHooks(target, {
      enabled: true,
      capture,
      injector,
      lineage: () => runtimeLineage,
    });

    for (const runId of ["agent-a", "agent-b"]) {
      await target.emit("before_agent_start", {
        type: "before_agent_start",
        runId,
        prompt: `run ${runId}`,
        systemPrompt: "system",
        resources: {},
      });
      // The task-loop producer binds lineage after the agent-start hook.
      runtimeLineage = lineage(`run-${runId}`, `trace-${runId}`);
      await target.emit("tool_call", {
        type: "tool_call",
        runId,
        toolCallId: `call-${runId}`,
        toolName: "read",
        input: { path: "README.md" },
      });
      await target.emit("tool_result", {
        type: "tool_result",
        runId,
        toolCallId: `call-${runId}`,
        toolName: "read",
        input: { path: "README.md" },
        content: [{ type: "text", text: "ok" }],
        details: {},
        isError: false,
      });
      await target.emit("agent_end", { type: "agent_end", runId, success: true, error: null });
    }
    uninstall();

    const trajectories = store.query_trajectories({});
    expect(trajectories).toHaveLength(2);
    expect(
      trajectories.every((trajectory) => trajectory.metadata.sekbCaptureOrigin === "agent_end"),
    ).toBe(true);
    expect(trajectories.every((trajectory) => trajectory.metadata.runtimeLineage)).toBe(true);
    expect(
      new DistillationTool({ store }).suggest_principles_from_trajectories(null, 2),
    ).toHaveLength(1);
  });

  it("keeps late-bound lineage on custom abort partial captures", async () => {
    const store = createStore();
    const capture = new TrajectoryCapture({ store });
    const injector = new RetrievalEngine({ store }).create_context_injector();
    const target = createHookTarget();
    // Late-bound on purpose: undefined at before_agent_start, then assigned
    // before the tool call. The lineage closure reads it lazily, so this must
    // be `let` — the test reassigns it at line ~185 (a `const` throws
    // "Assignment to constant variable" and the case cannot run).
    let runtimeLineage: RuntimeLineage | undefined = undefined;
    const uninstall = installSekbHarnessHooks(target, {
      enabled: true,
      capture,
      injector,
      lineage: () => runtimeLineage,
    });

    await target.emit("before_agent_start", {
      type: "before_agent_start",
      runId: "abort-run",
      prompt: "abort after a tool call",
      systemPrompt: "system",
      resources: {},
    });
    runtimeLineage = lineage("run-abort", "trace-abort");
    await target.emit("tool_call", {
      type: "tool_call",
      runId: "abort-run",
      toolCallId: "call-abort",
      toolName: "read",
      input: { path: "README.md" },
    });
    await target.emit("abort", { type: "abort", runId: "abort-run" });
    uninstall();

    const [trajectory] = store.query_trajectories({});
    expect(trajectory?.outcome).toBe("partial");
    expect(trajectory?.metadata.runtimeLineage).toEqual(runtimeLineage);
    expect(trajectory?.steps.some((step) => step.action === "tool.call")).toBe(true);
  });
});

function createStore(): KnowledgeStore {
  const root = mkdtempSync(path.join(os.tmpdir(), "openclaw-sekb-tf0073-"));
  tempRoots.push(root);
  return new KnowledgeStore({ database: { path: path.join(root, "openclaw.sqlite") } });
}

function lineage(loopRunId: string, traceId: string): RuntimeLineage {
  return {
    schema: "runtime-lineage.v1",
    sessionId: "session-tf-0073",
    loopRunId,
    traceId,
  };
}

function captureRealTrajectory(
  capture: TrajectoryCapture,
  runtimeLineage: RuntimeLineage,
  suffix: string,
): string {
  const id = capture.start_trajectory(`real trajectory ${suffix}`, "agent/task", ["runtime"], {
    runtimeLineage,
    sekbCaptureOrigin: "agent_end",
  });
  capture.log_step(id, "tool.call", {}, { toolName: "read", toolCallId: `call-${suffix}` });
  capture.log_step(
    id,
    "tool.result",
    {},
    { toolName: "read", toolCallId: `call-${suffix}`, ok: true },
  );
  capture.finish_trajectory(id, "success");
  return id;
}

function createHookTarget() {
  const handlers = new Map<string, Array<(event: unknown, context?: unknown) => unknown>>();
  const subscribers = new Set<(event: unknown) => unknown>();
  return {
    on(type: string, handler: (event: unknown, context?: unknown) => unknown) {
      const entries = handlers.get(type) ?? [];
      entries.push(handler);
      handlers.set(type, entries);
      return () =>
        handlers.set(
          type,
          (handlers.get(type) ?? []).filter((entry) => entry !== handler),
        );
    },
    subscribe(listener: (event: unknown) => unknown) {
      subscribers.add(listener);
      return () => subscribers.delete(listener);
    },
    async emit(type: string, event: unknown) {
      let result: unknown;
      for (const handler of handlers.get(type) ?? []) {
        result = await handler(event, event);
      }
      for (const listener of subscribers) {
        result = await listener(event);
      }
      return result;
    },
  };
}
