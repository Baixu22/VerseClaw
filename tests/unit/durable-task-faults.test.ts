// @vitest-environment node
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { TaskSystemStore } from "../../shared/task-system/store";
import { resolveTaskDomain } from "../../shared/task-system/identity";
import { createTaskRuntimeGuard, executeTaskGuarded } from "../../shared/task-system/runtime";
const input = {
  objective: "Keep the original goal during faults",
  target: ".",
  constraints: ["Retain evidence"],
  acceptance: [
    {
      id: "v",
      description: "Owner acceptance",
      verification: { kind: "owner-receipt" as const, owner: "fixture" },
    },
  ],
};

describe("task owner fault boundaries", () => {
  it("rejects a busy claim transaction then resumes the same request without a partial owner", () => {
    const root = mkdtempSync(join(tmpdir(), "task-busy-"));
    const domain = resolveTaskDomain(root),
      store = new TaskSystemStore(domain);
    const blocker = new DatabaseSync(domain.database);
    try {
      const task = store.create(input, "create").task;
      blocker.exec("BEGIN IMMEDIATE");
      expect(() => store.claim(task.contract.taskNodeId, "a", "g", "request")).toThrow(
        /locked|busy/,
      );
      expect(store.get(task.contract.taskNodeId).claim).toBeNull();
      blocker.exec("ROLLBACK");
      expect(store.claim(task.contract.taskNodeId, "a", "g", "request").claim?.sessionKey).toBe(
        "a",
      );
      expect(
        store.history(task.contract.taskNodeId).filter((e) => e.kind === "claimed"),
      ).toHaveLength(1);
    } finally {
      if (blocker.isTransaction) blocker.exec("ROLLBACK");
      blocker.close();
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("blocks writes on a corrupt database while preserving its bytes for recovery", async () => {
    const root = mkdtempSync(join(tmpdir(), "task-corrupt-"));
    const domain = resolveTaskDomain(root),
      store = new TaskSystemStore(domain);
    try {
      const task = store.create(input, "create").task;
      store.claim(task.contract.taskNodeId, "a", "g", "claim");
      const guard = createTaskRuntimeGuard(root, "a", "g");
      store.close();
      writeFileSync(domain.database, "corrupt database fixture");
      let executed = false;
      await expect(
        executeTaskGuarded(guard, "op", "write", async () => {
          executed = true;
        }),
      ).rejects.toThrow();
      expect(executed).toBe(false);
      expect(() => new TaskSystemStore(domain)).toThrow();
    } finally {
      try {
        store.close();
      } catch {
        /* Already closed before corruption. */
      }
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("handles clock rollback conservatively without losing the task or admitting a second owner", () => {
    const root = mkdtempSync(join(tmpdir(), "task-clock-"));
    let now = 1_000_000;
    const store = new TaskSystemStore(resolveTaskDomain(root), () => now);
    try {
      const task = store.create(input, "create").task;
      const c = store.claim(task.contract.taskNodeId, "a", "g", "claim").claim!;
      now -= 300_000;
      expect(store.get(c.taskNodeId).claim?.state).toBe("recovery_required");
      expect(() => store.assertOwner(c)).toThrow("NOT_ACTIVE");
      expect(() => store.claim(c.taskNodeId, "b", "g", "other")).toThrow("ALREADY_CLAIMED");
      expect(store.get(c.taskNodeId).contract.objective).toBe(input.objective);
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
