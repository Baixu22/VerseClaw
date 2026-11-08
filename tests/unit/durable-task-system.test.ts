// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { TaskSystemStore } from "../../shared/task-system/store";
import { resolveTaskDomain } from "../../shared/task-system/identity";
import type { TaskContractInput, TaskCredential } from "../../shared/task-system/types";

let root: string;
let store: TaskSystemStore;
let now: number;
const sha = createHash("sha256").update("accepted artifact").digest("hex");
function contract(extra: Partial<TaskContractInput> = {}): TaskContractInput {
  return {
    objective: "Deliver the approved artifact",
    constraints: ["Preserve existing user work"],
    target: "artifact.txt",
    acceptance: [
      {
        id: "artifact",
        description: "Exact approved bytes",
        verification: { kind: "file-sha256", path: "artifact.txt", sha256: sha },
      },
    ],
    ...extra,
  };
}
function setupOwner(extra: Partial<TaskContractInput> = {}) {
  const task = store.create(contract(extra), "create").task;
  return store.claim(task.contract.taskNodeId, "session-a", "generation-a", "claim").claim!;
}
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "durable-task-"));
  now = 1_000_000;
  store = new TaskSystemStore(resolveTaskDomain(root), () => now);
});
afterEach(() => {
  store.close();
  rmSync(root, { recursive: true, force: true });
});

describe("durable product task ownership", () => {
  it("migrates the prior task schema without changing task identity and rejects future schemas", () => {
    const c = setupOwner();
    store.db.exec("PRAGMA user_version=1");
    const migrated = new TaskSystemStore(resolveTaskDomain(root), () => now);
    try {
      expect(migrated.get(c.taskNodeId).claim!.epoch).toBe(c.epoch);
      expect(
        (migrated.db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version,
      ).toBe(5);
    } finally {
      migrated.close();
    }
    store.db.exec("PRAGMA user_version=99");
    expect(() => new TaskSystemStore(resolveTaskDomain(root))).toThrow("SCHEMA_NEWER_THAN_CLIENT");
  });
  it("prevents two runs in the same owning session from implementing one task concurrently", () => {
    const c = setupOwner();
    store.beginRun(c, "run-a");
    store.beginRun(c, "run-a");
    expect(() => store.beginRun(c, "run-b")).toThrow("RUN_ALREADY_ACTIVE");
    store.endRun(c, "run-other");
    expect(() => store.beginRun(c, "run-b")).toThrow("RUN_ALREADY_ACTIVE");
    store.endRun(c, "run-a");
    expect(() => store.beginRun(c, "run-b")).not.toThrow();
  });
  it("keeps identity across retries, detects exact duplicates, and separates different goals", () => {
    const a = store.create(contract(), "request-1");
    expect(store.create(contract(), "request-1").task.contract.taskNodeId).toBe(
      a.task.contract.taskNodeId,
    );
    expect(store.create(contract(), "request-2").kind).toBe("duplicate");
    expect(() => store.create(contract({ objective: "Another goal" }), "request-1")).toThrow(
      "IDEMPOTENCY_CONFLICT",
    );
    expect(
      store.create(contract({ target: "other.txt" }), "request-3").task.contract.taskNodeId,
    ).not.toBe(a.task.contract.taskNodeId);
  });
  it("refuses a changed contract for the same business key", () => {
    store.create(contract({ businessKey: "ticket:123" }), "1");
    expect(() =>
      store.create(contract({ businessKey: "ticket:123", objective: "different" }), "2"),
    ).toThrow("BUSINESS_KEY_CONTRACT_CONFLICT");
    expect(
      store.create(contract({ businessKey: "ticket:123", occurrenceKey: "next" }), "3").kind,
    ).toBe("created");
  });
  it("persists the goal and checkpoint independently of chat compression and process connections", () => {
    const c = setupOwner();
    store.checkpoint(c, {
      nextAction: "Verify the artifact",
      completed: ["created"],
      unresolved: [],
      artifacts: [],
    });
    store.close();
    store = new TaskSystemStore(resolveTaskDomain(root), () => now);
    for (let i = 0; i < 10; i++) {
      const context = store.context("session-a", "generation-a");
      expect(context).toContain("Deliver the approved artifact");
      expect(context).toContain("Exact approved bytes");
      expect(context).toContain("Verify the artifact");
    }
  });
  it("rejects a second owner and a stale revision", () => {
    const c = setupOwner();
    expect(() => store.claim(c.taskNodeId, "session-b", "generation-b", "b")).toThrow(
      "ALREADY_CLAIMED",
    );
    expect(() => store.revise(c.taskNodeId, 0, contract())).toThrow("REVISION_CONFLICT");
    store.revise(c.taskNodeId, 1, contract({ objective: "Revised objective" }));
    expect(() => store.assertOwner(c)).toThrow("STALE_OWNER");
  });
  it("does not convert lease expiration into automatic reassignment", () => {
    const c = setupOwner();
    now += 120_001;
    expect(store.get(c.taskNodeId).claim?.state).toBe("recovery_required");
    expect(() => store.claim(c.taskNodeId, "session-b", "generation-b", "b")).toThrow(
      "ALREADY_CLAIMED",
    );
    const next = store.handoff(c, "session-b", "generation-b").claim!;
    expect(next.epoch).toBeGreaterThan(c.epoch);
    expect(() => store.control(c, "renew")).toThrow("STALE_OWNER");
  });
  it("keeps in-flight and unknown operations as a handoff barrier", () => {
    const c = setupOwner();
    store.beginOperation(c, "op", "write");
    expect(() => store.handoff(c, "b", "g")).toThrow("OPERATIONS_PENDING");
    store.finishOperation(c, "op", "unknown", "lost acknowledgement");
    expect(() => store.control(c, "release")).toThrow("OPERATIONS_PENDING");
  });
  it("enforces dependencies and rejects cycles", () => {
    const a = store.create(contract(), "a").task.contract.taskNodeId;
    const b = store.create(contract({ objective: "dependent", dependencies: [a] }), "b").task
      .contract.taskNodeId;
    expect(() => store.claim(b, "b", "g", "b")).toThrow("DEPENDENCY_UNSATISFIED");
    expect(() => store.revise(a, 1, contract({ dependencies: [b] }))).toThrow("DEPENDENCY_CYCLE");
  });
  it("accepts only the contract-bound artifact after submitting the same candidate", () => {
    const c = setupOwner();
    writeFileSync(join(root, "artifact.txt"), "accepted artifact");
    store.submit(c, "candidate-1");
    expect(() => store.accept(c, "candidate-1")).toThrow("EVIDENCE_MISSING");
    store.verifyFile(c, "artifact", "artifact.txt", sha, "candidate-1");
    expect(() => store.accept(c, "other-candidate")).toThrow("SUBMISSION_STALE");
    writeFileSync(join(root, "artifact.txt"), "changed");
    expect(() => store.accept(c, "candidate-1")).toThrow("EVIDENCE_STALE");
    writeFileSync(join(root, "artifact.txt"), "accepted artifact");
    expect(store.accept(c, "candidate-1").contract.state).toBe("done");
  });
  it("does not let a file hash satisfy a business verification requirement", () => {
    const c = setupOwner({
      acceptance: [
        {
          id: "business",
          description: "Works end to end",
          verification: { kind: "owner-receipt", owner: "existing-verifier" },
        },
      ],
    });
    writeFileSync(join(root, "artifact.txt"), "accepted artifact");
    store.submit(c, "candidate-1");
    expect(() => store.verifyFile(c, "business", "artifact.txt", sha, "candidate-1")).toThrow(
      "OWNER_VERIFIER_REQUIRED",
    );
    expect(() => store.accept(c, "candidate-1")).toThrow("OWNER_VERIFIER_REQUIRED");
  });
  it("uses one task domain for two real Git worktrees", () => {
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
    const linked = join(root, "linked");
    git("worktree", "add", "--detach", linked);
    const mainDomain = resolveTaskDomain(root),
      otherDomain = resolveTaskDomain(linked);
    expect(otherDomain.id).toBe(mainDomain.id);
    expect(otherDomain.database).toBe(mainDomain.database);
    const a = new TaskSystemStore(mainDomain),
      b = new TaskSystemStore(otherDomain);
    try {
      const t = a.create(contract(), "a").task.contract.taskNodeId;
      a.claim(t, "a", "g", "a");
      expect(() => b.claim(t, "b", "g", "b")).toThrow("ALREADY_CLAIMED");
    } finally {
      a.close();
      b.close();
    }
  });
  it("rejects forged generation and same-session calls from another worktree", () => {
    const c = setupOwner();
    expect(() => store.assertOwner({ ...c, generation: "wrong" } as TaskCredential)).toThrow(
      "STALE_OWNER",
    );
  });
  it("preserves the goal while paused, and fences the previous writer on resume", () => {
    const c = setupOwner();
    const paused = store.control(c, "pause");
    expect(store.context("session-a", "generation-a")).toContain("Deliver the approved artifact");
    expect(() => store.assertOwner(c)).toThrow("STALE_OWNER");
    const resumed = store.recover(c.taskNodeId, "session-a", "generation-a", root);
    expect(resumed.claim!.epoch).toBeGreaterThan(paused.claim!.epoch);
    expect(resumed.contract.state).toBe("doing");
  });
  it("refuses recovery while an unknown external operation lacks its owner receipt", () => {
    const c = setupOwner();
    store.beginOperation(c, "shell", "exec");
    store.finishOperation(c, "shell", "unknown", "timeout");
    now += 120_001;
    expect(() => store.recover(c.taskNodeId, "b", "new", root)).toThrow(
      "EFFECT_OWNER_RECONCILIATION_REQUIRED",
    );
    expect(store.get(c.taskNodeId).pendingOperations).toBe(1);
  });
  it("keeps a lost-response retry tied to the original attempt after ownership changes", () => {
    const c = setupOwner();
    store.handoff(c, "b", "g");
    const replay = store.claim(c.taskNodeId, "session-a", "generation-a", "claim");
    expect(replay.claim!.epoch).toBe(c.epoch);
    expect(() => store.assertOwner(replay.claim!)).toThrow("STALE_OWNER");
  });
  it("refuses oversize goals and does not infer uniqueness from the title", () => {
    expect(() => store.create(contract({ objective: "x".repeat(3001) }), "long")).toThrow(
      "INVALID_OBJECTIVE",
    );
    const a = store.create(contract({ constraints: ["scope one"] }), "a");
    const b = store.create(contract({ constraints: ["scope two"] }), "b");
    expect(a.task.contract.taskNodeId).not.toBe(b.task.contract.taskNodeId);
  });
});
