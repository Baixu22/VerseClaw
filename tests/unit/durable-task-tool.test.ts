// @vitest-environment node
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { createPersistentTaskTool } from "../../openclaw_runtime/src/agents/tools/persistent-task-tool";
import { createTaskRuntimeGuard, executeTaskGuarded } from "../../shared/task-system/runtime";
import { TaskSystemStore } from "../../shared/task-system/store";
import { resolveTaskDomain } from "../../shared/task-system/identity";
import type { TaskResolution, TaskView } from "../../shared/task-system/types";

describe("agent-facing production task tool", () => {
  it("creates, claims, executes a real check, and accepts its owner-produced receipt", async () => {
    const root = mkdtempSync(join(tmpdir(), "task-tool-"));
    let n = 0;
    try {
      writeFileSync(
        join(root, "check.cjs"),
        'const assert=require("node:assert/strict");assert.equal(2+2,4);',
      );
      const tool = createPersistentTaskTool({ workspace: root, sessionKey: "a", generation: "g" });
      const call = async (p: unknown) => (await tool.execute(String(++n), p)).details;
      for (let i = 0; i < 10; i++) expect(await call({ action: "current" })).toBeNull();
      const created = (await call({
        action: "create",
        requestId: "goal",
        contract: {
          objective: "Deliver the tested calculation",
          constraints: [],
          target: "check.cjs",
          acceptance: [
            {
              id: "check",
              description: "Calculation check exits zero",
              verification: {
                kind: "tool-result",
                tool: "exec",
                command: "node check.cjs",
                files: ["check.cjs"],
                exitCode: 0,
              },
            },
          ],
        },
      })) as TaskResolution;
      const claimed = (await call({
        action: "claim",
        requestId: "claim",
        taskNodeId: created.task.contract.taskNodeId,
      })) as TaskView;
      await executeTaskGuarded(
        createTaskRuntimeGuard(root, "a", "g"),
        "real-check",
        "exec",
        async () => {
          execFileSync(process.execPath, ["check.cjs"], { cwd: root, windowsHide: true });
          return { details: { exitCode: 0, status: "completed" } };
        },
        { command: "node check.cjs" },
      );
      await call({ action: "submit", candidate: "calculation-v1" });
      expect(
        ((await call({ action: "accept", candidate: "calculation-v1" })) as TaskView).contract
          .state,
      ).toBe("done");
      const s = new TaskSystemStore(resolveTaskDomain(root));
      try {
        expect(s.get(claimed.contract.taskNodeId).contract.state).toBe("done");
      } finally {
        s.close();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("does not let an old task tool take control of a newer epoch", async () => {
    const root = mkdtempSync(join(tmpdir(), "task-tool-stale-"));
    const s = new TaskSystemStore(resolveTaskDomain(root));
    try {
      const task = s.create(
        {
          objective: "goal",
          constraints: [],
          target: ".",
          acceptance: [
            { id: "v", description: "check", verification: { kind: "owner-receipt", owner: "v" } },
          ],
        },
        "c",
      ).task;
      const c = s.claim(task.contract.taskNodeId, "a", "g", "a").claim!;
      const stale = createPersistentTaskTool({ workspace: root, sessionKey: "a", generation: "g" });
      s.handoff(c, "a", "g");
      await expect(stale.execute("late", { action: "release" })).rejects.toThrow("STALE_OWNER");
    } finally {
      s.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
