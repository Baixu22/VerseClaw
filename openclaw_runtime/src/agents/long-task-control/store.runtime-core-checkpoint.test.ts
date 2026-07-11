import { describe, expect, it } from "vitest";
import { buildToolCallResultFixture } from "../../runtime-core/types.js";
import {
  buildRuntimeCoreCheckpointFromResumeCheckpoint,
  type RuntimeResumeCheckpoint,
} from "./store.js";

describe("buildRuntimeCoreCheckpointFromResumeCheckpoint", () => {
  it("preserves supplied tool results in the runtime checkpoint", () => {
    const toolResult = buildToolCallResultFixture({
      callId: "task_loop.subagent:reviewer",
    });
    const checkpoint: RuntimeResumeCheckpoint = {
      schemaVersion: 1,
      trigger: "guide",
      activeTask: "Verify the implementation",
      openBlockers: [],
      decisions: [],
      deviations: [],
      filesTouched: [],
      testsRun: [],
      reviewNeededItems: [],
      evidenceRefs: [],
      createdAt: "2026-07-11T00:00:00.000Z",
    };

    const runtimeCheckpoint = buildRuntimeCoreCheckpointFromResumeCheckpoint({
      checkpointId: "checkpoint-1",
      taskId: "task-1",
      state: "verifying",
      checkpoint,
      toolResults: [toolResult],
    });

    expect(runtimeCheckpoint.toolResults).toEqual([toolResult]);
  });
});
