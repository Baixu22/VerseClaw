// @vitest-environment node
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveTaskDomain } from "../../shared/task-system/identity";
import { TaskSystemStore } from "../../shared/task-system/store";
import {
  createTaskRuntimeGuard,
  executeTaskGuarded,
  readPersistentTaskContext,
  restoreTaskModelContext,
  finishPersistentTaskRun,
} from "../../shared/task-system/runtime";

describe("production task runtime guard", () => {
  it("requires a task before the first write even when no task database exists yet", async () => {
    const root = mkdtempSync(join(tmpdir(), "task-first-write-"));
    try {
      const guard = createTaskRuntimeGuard(root, "a", "g");
      let mutations = 0;
      await expect(
        executeTaskGuarded(guard, "write", "write", async () => {
          mutations++;
        }),
      ).rejects.toThrow("TASK_CLAIM_REQUIRED");
      expect(mutations).toBe(0);
      expect(await executeTaskGuarded(guard, "read", "read", async () => 1)).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("records cancellation immediately and waits for the in-flight owner before releasing the task", async () => {
    const root = mkdtempSync(join(tmpdir(), "task-cancel-"));
    const s = new TaskSystemStore(resolveTaskDomain(root));
    try {
      const t = s.create(
        {
          objective: "cancel safely",
          target: ".",
          constraints: [],
          acceptance: [
            { id: "v", description: "verify", verification: { kind: "owner-receipt", owner: "v" } },
          ],
        },
        "c",
      ).task;
      const c = s.claim(t.contract.taskNodeId, "a", "g", "a").claim!;
      const guard = createTaskRuntimeGuard(root, "a", "g");
      let finish!: () => void;
      const wait = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const operation = executeTaskGuarded(guard, "op", "write", async () => {
        await wait;
        return { ok: true };
      });
      expect(s.control(c, "cancel").contract.state).toBe("cancelling");
      await expect(executeTaskGuarded(guard, "new", "write", async () => 1)).rejects.toThrow(
        "EXECUTION_NOT_RUNNING",
      );
      finish();
      await operation;
      expect(s.get(c.taskNodeId).contract.state).toBe("cancelled");
      expect(s.get(c.taskNodeId).claim?.state).toBe("released");
    } finally {
      s.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("blocks retries after a background effect until the real process owner reports completion", async () => {
    const root = mkdtempSync(join(tmpdir(), "task-process-"));
    const s = new TaskSystemStore(resolveTaskDomain(root));
    try {
      const task = s.create(
        {
          objective: "one process",
          target: ".",
          constraints: [],
          acceptance: [
            { id: "v", description: "verify", verification: { kind: "owner-receipt", owner: "v" } },
          ],
        },
        "c",
      ).task;
      s.claim(task.contract.taskNodeId, "a", "g", "a");
      const guard = createTaskRuntimeGuard(root, "a", "g");
      await executeTaskGuarded(
        guard,
        "exec",
        "exec",
        async () => ({ details: { sessionId: "owned-process", status: "running" } }),
        { command: "work" },
      );
      await expect(
        executeTaskGuarded(guard, "duplicate", "exec", async () => ({ details: { exitCode: 0 } }), {
          command: "work",
        }),
      ).rejects.toThrow("RECONCILIATION_REQUIRED");
      await executeTaskGuarded(
        guard,
        "poll",
        "process",
        async () => ({ details: { sessionId: "owned-process", status: "completed", exitCode: 0 } }),
        { action: "poll", sessionId: "owned-process" },
      );
      expect(s.get(task.contract.taskNodeId).pendingOperations).toBe(0);
    } finally {
      s.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("restores a goal created during the run after ten compacted contexts without duplicating it", () => {
    const root = mkdtempSync(join(tmpdir(), "task-model-context-"));
    const guard = createTaskRuntimeGuard(root, "a", "g", "run");
    const s = new TaskSystemStore(resolveTaskDomain(root));
    try {
      const task = s.create(
        {
          objective: "Complete all three requirements",
          constraints: ["Keep the red lines"],
          target: ".",
          acceptance: [
            {
              id: "v",
              description: "All requirements verified",
              verification: { kind: "owner-receipt", owner: "v" },
            },
          ],
        },
        "c",
      ).task;
      s.claim(task.contract.taskNodeId, "a", "g", "a");
      for (let i = 0; i < 10; i++) {
        const restored = restoreTaskModelContext(guard, "System rules. Transcript was compacted.");
        expect(restored).toContain("Complete all three requirements");
        expect(restored).toContain("Keep the red lines");
        expect(restored).toContain("All requirements verified");
        expect(() => restoreTaskModelContext(guard, "rules", 10)).toThrow(
          "MODEL_CONTEXT_BUDGET_EXCEEDED",
        );
        expect(
          restoreTaskModelContext(guard, restored).split("<PERSISTENT_TASK_CONTRACT>"),
        ).toHaveLength(2);
      }
    } finally {
      finishPersistentTaskRun(root, "a", "run");
      s.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("does not grant a fork or unbound session write access in a managed repository", async () => {
    const root = mkdtempSync(join(tmpdir(), "task-unbound-"));
    const s = new TaskSystemStore(resolveTaskDomain(root));
    try {
      const guard = createTaskRuntimeGuard(root, "fork", "generation");
      let writes = 0;
      await expect(
        executeTaskGuarded(guard, "op", "write", async () => {
          writes++;
        }),
      ).rejects.toThrow("CLAIM_REQUIRED");
      expect(writes).toBe(0);
      expect(await executeTaskGuarded(guard, "read", "read", async () => 1)).toBe(1);
    } finally {
      s.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("adopts only a new initial binding, then keeps its epoch pinned", async () => {
    const root = mkdtempSync(join(tmpdir(), "task-first-"));
    const guard = createTaskRuntimeGuard(root, "a", "g");
    const s = new TaskSystemStore(resolveTaskDomain(root));
    try {
      const task = s.create(
        {
          objective: "goal",
          target: ".",
          constraints: [],
          acceptance: [
            { id: "v", description: "verify", verification: { kind: "owner-receipt", owner: "v" } },
          ],
        },
        "c",
      ).task;
      const c = s.claim(task.contract.taskNodeId, "a", "g", "a").claim!;
      expect(await executeTaskGuarded(guard, "op1", "write", async () => ({ ok: true }))).toEqual({
        ok: true,
      });
      s.handoff(c, "a", "g");
      await expect(
        executeTaskGuarded(guard, "op2", "write", async () => ({ ok: true })),
      ).rejects.toThrow("STALE_OWNER");
    } finally {
      s.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("captures the old epoch and refuses execution after handoff", async () => {
    const root = mkdtempSync(join(tmpdir(), "task-guard-"));
    const s = new TaskSystemStore(resolveTaskDomain(root));
    try {
      const task = s.create(
        {
          objective: "keep goal",
          constraints: [],
          target: ".",
          acceptance: [
            {
              id: "verify",
              description: "check",
              verification: { kind: "owner-receipt", owner: "verifier" },
            },
          ],
        },
        "create",
      ).task;
      const claim = s.claim(task.contract.taskNodeId, "a", "g", "a").claim!;
      const guard = createTaskRuntimeGuard(root, "a", "g");
      expect(readPersistentTaskContext(root, "a", "g")).toContain("keep goal");
      expect(await executeTaskGuarded(guard, "op1", "read", async () => ({ text: "ok" }))).toEqual({
        text: "ok",
      });
      s.handoff(claim, "b", "g2");
      let effects = 0;
      await expect(
        executeTaskGuarded(guard, "op2", "write", async () => {
          effects++;
        }),
      ).rejects.toThrow("STALE_OWNER");
      expect(effects).toBe(0);
    } finally {
      s.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("binds a real tool result to unchanged verification inputs", async () => {
    const root = mkdtempSync(join(tmpdir(), "task-verify-"));
    const s = new TaskSystemStore(resolveTaskDomain(root));
    try {
      writeFileSync(join(root, "test.js"), "// approved test fixture");
      const task = s.create(
        {
          objective: "Pass the specified check",
          target: ".",
          constraints: [],
          acceptance: [
            {
              id: "test",
              description: "Registered check succeeds",
              verification: {
                kind: "tool-result",
                tool: "exec",
                command: "node test.js",
                files: ["test.js"],
                exitCode: 0,
              },
            },
          ],
        },
        "create",
      ).task;
      const c = s.claim(task.contract.taskNodeId, "a", "g", "a").claim!;
      const guard = createTaskRuntimeGuard(root, "a", "g");
      await executeTaskGuarded(
        guard,
        "exec1",
        "exec",
        async () => ({ details: { exitCode: 0, status: "completed" } }),
        { command: "node other.js" },
      );
      s.submit(c, "candidate");
      expect(() => s.accept(c, "candidate")).toThrow("EVIDENCE_MISSING");
      // A rejected submission retains its claim; release and reclaim starts a new attempt.
      s.control(c, "release");
      const current = s.claim(c.taskNodeId, "a", "g", "next").claim!;
      await executeTaskGuarded(
        createTaskRuntimeGuard(root, "a", "g"),
        "exec2",
        "exec",
        async () => ({ details: { exitCode: 0, status: "completed" } }),
        { command: "node test.js" },
      );
      s.submit(current, "candidate");
      writeFileSync(join(root, "test.js"), "// changed after checking");
      expect(() => s.accept(current, "candidate")).toThrow("EVIDENCE_STALE");
    } finally {
      s.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
