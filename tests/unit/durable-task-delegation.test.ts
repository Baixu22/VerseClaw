// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { describe, it, expect } from "vitest";
import { TaskSystemStore } from "../../shared/task-system/store";
import { resolveTaskDomain } from "../../shared/task-system/identity";
import {
  createTaskRuntimeGuard,
  executeTaskGuarded,
  restoreTaskModelContext,
  assertTaskWorktreeReleasable,
} from "../../shared/task-system/runtime";
import {
  preparePersistentTaskDelegation,
  capturePersistentTaskDelegationIntent,
  recordPersistentTaskDispatch,
  returnPersistentTaskWriter,
} from "../../openclaw_runtime/src/agents/persistent-task-delegation";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "task-delegation-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, windowsHide: true, stdio: "pipe" });
  git("init");
  git(
    "-c",
    "user.name=Agent",
    "-c",
    "user.email=agent@example.invalid",
    "commit",
    "--allow-empty",
    "-m",
    "fixture",
  );
  const childRoot = join(root, "child");
  git("worktree", "add", "--detach", childRoot);
  const store = new TaskSystemStore(resolveTaskDomain(root));
  const task = store.create(
    {
      objective: "Keep this goal across parent and child",
      target: "result.txt",
      constraints: ["one writer"],
      acceptance: [
        {
          id: "verify",
          description: "Verify result",
          verification: { kind: "owner-receipt", owner: "fixture" },
        },
      ],
    },
    "create",
  ).task;
  const claim = store.claim(
    task.contract.taskNodeId,
    "parent",
    "parent-generation",
    "claim",
  ).claim!;
  const input = {
    workspace: root,
    childWorkspace: childRoot,
    parentSessionKey: "parent",
    parentGeneration: "parent-generation",
    childSessionKey: "child",
    childGeneration: "child-generation",
    childRunId: "child-run",
  };
  return {
    root,
    childRoot,
    store,
    claim,
    input,
    close() {
      store.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

describe("durable production delegation protocol", () => {
  it('does not transfer queued work until dispatch and rejects changed parent ownership',()=>{
    const f=fixture();try{const intent=capturePersistentTaskDelegationIntent(f.input)!;expect(f.store.get(f.claim.taskNodeId).claim?.sessionKey).toBe('parent');f.store.handoff(f.claim,'parent','parent-generation');expect(()=>preparePersistentTaskDelegation(intent)).toThrow('PARENT_CHANGED_WHILE_QUEUED');}finally{f.close();}
  });
  it("transfers before dispatch, preserves read-only parent context and returns from terminal owner evidence", async () => {
    const f = fixture();
    try {
      const parentGuard = createTaskRuntimeGuard(f.root, "parent", "parent-generation");
      const result = await executeTaskGuarded(
        parentGuard,
        "spawn-call",
        "sessions_spawn",
        async () => {
          const prepared = preparePersistentTaskDelegation(f.input)!;
          expect(f.store.get(f.claim.taskNodeId).claim?.sessionKey).toBe("child");
          expect(f.store.binding("parent", "parent-generation")?.referenceOnly).toBe(true);
          recordPersistentTaskDispatch(prepared, "dispatched", "child-run");
          return { status: "accepted", childSessionKey: "child", runId: "child-run" };
        },
      );
      expect(result.status).toBe("accepted");
      expect(restoreTaskModelContext(parentGuard, "system")).toContain("Keep this goal");
      await expect(executeTaskGuarded(parentGuard, "late", "write", async () => 1)).rejects.toThrow(
        "REFERENCE_READ_ONLY",
      );
      const childGuard = createTaskRuntimeGuard(f.childRoot, "child", "child-generation");
      await executeTaskGuarded(childGuard, "child-write", "write", async () => {
        writeFileSync(join(f.childRoot, "result.txt"), "child result");
        return { ok: true };
      });
      expect(readFileSync(join(f.childRoot, "result.txt"), "utf8")).toBe("child result");
      const returned = returnPersistentTaskWriter({
        workspace: f.childRoot,
        childSessionKey: "child",
        runId: "child-run",
        endedAt: Date.now(),
        outcome: "ok",
        parentGeneration: "parent-generation",
      });
      expect(returned?.phase).toBe("returned");
      expect(()=>assertTaskWorktreeReleasable(f.childRoot)).toThrow('UNFINISHED_TASKS');
      expect(f.store.get(f.claim.taskNodeId).claim?.sessionKey).toBe("parent");
      expect(f.store.get(f.claim.taskNodeId).contract.state).toBe("doing");
      await expect(
        executeTaskGuarded(childGuard, "late-child", "write", async () => 1),
      ).rejects.toThrow("REFERENCE_READ_ONLY");
      await expect(
        executeTaskGuarded(parentGuard, "old-parent", "write", async () => 1),
      ).rejects.toThrow("STALE_OWNER");
      expect(
        returnPersistentTaskWriter({
          workspace: f.root,
          childSessionKey: "child",
          runId: "child-run",
          endedAt: Date.now(),
          outcome: "ok",
          parentGeneration: "parent-generation",
        })?.phase,
      ).toBe("returned");
    } finally {
      f.close();
    }
  });
  it("retains ownership after lost dispatch acknowledgement and rejects a second writer", () => {
    const f = fixture();
    try {
      const p = preparePersistentTaskDelegation(f.input)!;
      recordPersistentTaskDispatch(p, "unknown", "child-run");
      expect(preparePersistentTaskDelegation(f.input)?.record.phase).toBe("unknown");
      expect(() =>
        preparePersistentTaskDelegation({
          ...f.input,
          childSessionKey: "duplicate",
          childRunId: "run-2",
        }),
      ).toThrow("PARENT_NOT_WRITER");
      expect(() =>
        returnPersistentTaskWriter({
          workspace: f.childRoot,
          childSessionKey: "child",
          runId: "wrong",
          endedAt: Date.now(),
          outcome: "ok",
          parentGeneration: "parent-generation",
        }),
      ).toThrow("TERMINAL_MISMATCH");
      expect(f.store.get(f.claim.taskNodeId).claim?.sessionKey).toBe("child");
      expect(f.store.delegationForChild("child")?.phase).toBe("unknown");
    } finally {
      f.close();
    }
  });
  it("restores the delegation from disk and keeps unknown effects as a return barrier", () => {
    const f = fixture();
    try {
      preparePersistentTaskDelegation(f.input);
      const child = new TaskSystemStore(resolveTaskDomain(f.childRoot));
      try {
        const c = child.get(f.claim.taskNodeId).claim!;
        child.beginOperation(c, "external", "exec");
        child.finishOperation(c, "external", "unknown", "lost");
      } finally {
        child.close();
      }
      const reopened = new TaskSystemStore(resolveTaskDomain(f.root));
      try {
        expect(reopened.delegationForChild("child")?.childRunId).toBe("child-run");
      } finally {
        reopened.close();
      }
      expect(
        returnPersistentTaskWriter({
          workspace: f.childRoot,
          childSessionKey: "child",
          runId: "child-run",
          endedAt: Date.now(),
          outcome: "ok",
          parentGeneration: "parent-generation",
        })?.phase,
      ).toBe("recovery_required");
      expect(f.store.get(f.claim.taskNodeId).claim?.sessionKey).toBe("child");
    } finally {
      f.close();
    }
  });
  it("gives a verifier a read reference without transferring writer or blocking the parent", () => {
    const f = fixture();
    try {
      preparePersistentTaskDelegation({ ...f.input, observer: true });
      expect(f.store.get(f.claim.taskNodeId).claim?.sessionKey).toBe("parent");
      expect(f.store.binding("child", "child-generation")?.referenceOnly).toBe(true);
      expect(
        returnPersistentTaskWriter({
          workspace: f.childRoot,
          childSessionKey: "child",
          runId: "child-run",
          endedAt: Date.now(),
          outcome: "ok",
          parentGeneration: "parent-generation",
        })?.phase,
      ).toBe("returned");
    } finally {
      f.close();
    }
  });
  it("does not return writing authority to a reset parent generation", () => {
    const f = fixture();
    try {
      preparePersistentTaskDelegation(f.input);
      expect(
        returnPersistentTaskWriter({
          workspace: f.childRoot,
          childSessionKey: "child",
          runId: "child-run",
          endedAt: Date.now(),
          outcome: "ok",
          parentGeneration: "new-generation",
        })?.phase,
      ).toBe("recovery_required");
    } finally {
      f.close();
    }
  });
});
