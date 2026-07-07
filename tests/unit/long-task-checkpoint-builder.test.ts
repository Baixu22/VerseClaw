import { describe, expect, it } from "vitest";
import {
  buildRuntimeCoreCheckpointFromResumeCheckpoint,
  type RuntimeResumeCheckpoint,
} from "../../openclaw_runtime/src/agents/long-task-control/store";
import type { ToolCallResult } from "../../openclaw_runtime/src/runtime-core";

describe("buildRuntimeCoreCheckpointFromResumeCheckpoint", () => {
  it("accepts supplied tool results and file hashes for checkpoint evidence", () => {
    const toolResult: ToolCallResult = {
      callId: "task_loop.subagent:run_acceptance",
      status: "success",
      contextItems: [],
      structuredData: { roleName: "implementer" },
      startedAt: 1_700_000_000_000,
      finishedAt: 1_700_000_000_100,
      evidence: [{
        type: "tool",
        ref: "task_loop.subagent:run_acceptance",
        label: "TaskLoop implementer result",
      }],
    };
    const resumeCheckpoint: RuntimeResumeCheckpoint = {
      schemaVersion: 1,
      id: "checkpoint-acceptance",
      sessionKey: "agent:main:acceptance",
      trigger: "guide",
      activeTask: "Wire checkpoint evidence into runtime events",
      openBlockers: [],
      decisions: [],
      deviations: [],
      filesTouched: ["src/acceptance.ts"],
      testsRun: ["vitest run tests/unit/acceptance.test.ts"],
      nextAction: "continue",
      reviewNeededItems: [],
      evidenceRefs: [{ type: "trace", ref: "trace-acceptance", label: "Trace" }],
      createdAt: "2026-07-07T00:00:00.000Z",
    };

    const checkpoint = buildRuntimeCoreCheckpointFromResumeCheckpoint({
      checkpointId: "checkpoint-acceptance",
      taskId: "loop_acceptance",
      state: "completed",
      checkpoint: resumeCheckpoint,
      fileHashes: { "src/acceptance.ts": "a".repeat(64) },
      toolResults: [toolResult],
    });

    expect(checkpoint.toolResults).toEqual([toolResult]);
    expect(checkpoint.fileHashes).toEqual({ "src/acceptance.ts": "a".repeat(64) });
    expect(checkpoint.evidenceRefs).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "checkpoint", ref: "checkpoint-acceptance" }),
      expect.objectContaining({ type: "trace", ref: "trace-acceptance" }),
    ]));
  });
});
