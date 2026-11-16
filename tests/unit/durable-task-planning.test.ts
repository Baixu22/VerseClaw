// @vitest-environment node
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { TaskSystemStore } from "../../shared/task-system/store";
import { resolveTaskDomain } from "../../shared/task-system/identity";
import type { TaskContractInput } from "../../shared/task-system/types";
import type { SessionKey } from "../../shared/types/identity-scope";
let root: string, store: TaskSystemStore;
const sha = createHash("sha256").update("artifact").digest("hex");
const contract = (objective: string): TaskContractInput => ({
  objective,
  target: "artifact.txt",
  constraints: [],
  acceptance: [
    {
      id: "file",
      description: "Exact bytes",
      verification: { kind: "file-sha256", path: "artifact.txt", sha256: sha },
    },
  ],
});
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "task-planning-"));
  store = new TaskSystemStore(resolveTaskDomain(root));
  writeFileSync(join(root, "artifact.txt"), "artifact");
});
afterEach(() => {
  store.close();
  rmSync(root, { recursive: true, force: true });
});
describe("task discovery and goal decomposition", () => {
  it("replays committed changes after a missed acknowledgement and rejects a stale consumer cursor", () => {
    store.create(contract("Persistent notification"), "create");
    const first = store.changes("consumer");
    expect(first.events).toHaveLength(1);
    expect(store.changes("consumer")).toEqual(first);
    store.close();
    store = new TaskSystemStore(resolveTaskDomain(root));
    expect(store.changes("consumer")).toEqual(first);
    store.acknowledge("consumer", 0, first.events[0].sequence);
    expect(store.changes("consumer").events).toHaveLength(0);
    store.create(contract("Second change"), "second");
    expect(() => store.acknowledge("consumer", 0, 2)).toThrow("SEQUENCE_CONFLICT");
    expect(store.changes("other").events).toHaveLength(2);
  });
  it("paginates a frozen insertion window without hiding old tasks behind new arrivals", () => {
    const ids = Array.from(
      { length: 8 },
      (_, i) => store.create(contract(`Task ${i}`), `c${i}`).task.contract.taskNodeId,
    );
    const first = store.page({ limit: 3 });
    store.create(contract("New arrival"), "new");
    const second = store.page({ limit: 3, cursor: first.nextCursor });
    const third = store.page({ limit: 3, cursor: second.nextCursor });
    expect(
      [...first.tasks, ...second.tasks, ...third.tasks].map((x) => x.contract.taskNodeId),
    ).toEqual(ids.toReversed());
    expect(third.nextCursor).toBeUndefined();
    expect(() => store.page({ limit: 3, cursor: first.nextCursor, query: "other" })).toThrow(
      "CURSOR_SCOPE_MISMATCH",
    );
  });
  it("suggests overlapping goals without merging their identities", () => {
    const a = store.create(contract("Add password reset email validation"), "a").task;
    const b = store.create(contract("Add password reset email tests"), "b").task;
    const hints = store.suggest("password reset email", "artifact.txt");
    expect(hints.length).toBe(2);
    expect(hints.every((x) => x.automaticIdentity === false)).toBe(true);
    expect(a.contract.taskNodeId).not.toBe(b.contract.taskNodeId);
  });
  it("decomposes atomically, retains the original goal and gates the parent on accepted children", () => {
    const parent = store.create(
      { ...contract("Ship the full login flow"), constraints: ["Preserve audit records"] },
      "parent",
    ).task;
    const p = store.claim(parent.contract.taskNodeId, "parent", "g", "p").claim!;
    const items = [
      { key: "form", contract: contract("Implement the form") },
      { key: "tests", contract: contract("Verify the form"), dependsOn: ["form"] },
    ];
    const children = store.decompose(p, items, "plan");
    expect(store.decompose(p, items, "plan").map((x) => x.contract.taskNodeId)).toEqual(
      children.map((x) => x.contract.taskNodeId),
    );
    expect(children[1].contract.constraints).toContain("Preserve audit records");
    expect(() => store.claim(parent.contract.taskNodeId, "parent", "g", "p2")).toThrow(
      "DEPENDENCY_UNSATISFIED",
    );
    for (const [i, child] of children.entries()) {
      const c = store.claim(child.contract.taskNodeId, `child-${i}`, "g", `child-${i}`).claim!;
      expect(store.context(c.sessionKey, "g")).toContain("Ship the full login flow");
      store.verifyFile(c, "file", "artifact.txt", sha, "candidate");
      store.submit(c, "candidate");
      store.accept(c, "candidate");
    }
    expect(store.claim(parent.contract.taskNodeId, "parent", "g", "p3").claim?.sessionKey).toBe(
      "parent",
    );
    expect(store.get(parent.contract.taskNodeId).contract.objective).toBe(
      "Ship the full login flow",
    );
  });
  it("rolls back every child when the plan contains an invalid dependency", () => {
    const t = store.create(contract("Parent"), "p").task;
    const c = store.claim(t.contract.taskNodeId, "a", "g", "a").claim!;
    expect(() =>
      store.decompose(
        c,
        [{ key: "bad", contract: contract("Child"), dependsOn: ["missing"] }],
        "bad",
      ),
    ).toThrow("PLAN_DEPENDENCY_MISSING");
    expect(store.list()).toHaveLength(1);
    expect(store.get(t.contract.taskNodeId).claim?.epoch).toBe(c.epoch);
  });
  it("rehydrates the root goal through multiple decompositions and retains valid progress JSON", () => {
    const parent = store.create(
      { ...contract("Root delivery objective"), constraints: ["Root invariant"] },
      "root",
    ).task;
    const c = store.claim(parent.contract.taskNodeId, "root", "g", "root").claim!;
    const [middle] = store.decompose(
      c,
      [{ key: "middle", contract: contract("Middle phase") }],
      "middle-plan",
    );
    const m = store.claim(middle.contract.taskNodeId, "middle", "g", "middle").claim!;
    const [leaf] = store.decompose(
      m,
      [{ key: "leaf", contract: contract("Leaf implementation") }],
      "leaf-plan",
    );
    const l = store.claim(leaf.contract.taskNodeId, "leaf", "g", "leaf").claim!;
    store.checkpoint(l, {
      nextAction: "Execute the original acceptance",
      completed: [],
      unresolved: Array.from({ length: 30 }, (_, i) => `${i}:` + "x".repeat(490)),
      artifacts: [],
    });
    const context = store.context("leaf", "g")!;
    expect(context.length).toBeLessThanOrEqual(12_000);
    expect(context).toContain("Root delivery objective");
    expect(context).toContain("Middle phase");
    const progress = JSON.parse(context.split("\n").at(-1)!);
    expect(progress.nextAction).toBe("Execute the original acceptance");
    expect(progress.omittedUnresolved).toBeGreaterThan(0);
    expect(() =>
      store.revise(parent.contract.taskNodeId, parent.contract.revision, contract("Changed root")),
    ).toThrow("PLAN_CHILDREN_ACTIVE");
    expect(() =>
      store.revise(
        leaf.contract.taskNodeId,
        leaf.contract.revision,
        contract("Drops inherited invariant"),
      ),
    ).toThrow("PARENT_CONSTRAINT_REQUIRED");
  });
  it("cancels a whole plan only after child effects settle and replays the final effect receipt", () => {
    const parent = store.create(contract("Plan cancellation"), "root").task;
    const c = store.claim(parent.contract.taskNodeId, "root", "g", "root").claim!;
    const children = store.decompose(
      c,
      [
        { key: "a", contract: contract("Running child") },
        { key: "b", contract: contract("Waiting child") },
      ],
      "plan",
    );
    const child = store.claim(children[0].contract.taskNodeId, "child", "g", "child").claim!;
    store.beginOperation(child, "pending", "write");
    const coordinator = store.get(parent.contract.taskNodeId).claim!;
    expect(() => store.control({ ...coordinator, sessionKey: "intruder" as SessionKey }, "cancel")).toThrow(
      "STALE_OWNER",
    );
    expect(store.control(coordinator, "cancel").contract.state).toBe("cancelling");
    expect(store.get(children[1].contract.taskNodeId).contract.state).toBe("cancelled");
    expect(() => store.beginOperation(child, "late", "write")).toThrow("EXECUTION_NOT_RUNNING");
    store.finishOperation(child, "pending", "unknown", "lost response");
    const receipt = { id: "owner-readback", outcome: "applied" as const, owner: "test-owner" };
    store.reconcileOperation(child, "pending", receipt);
    expect(store.reconcileOperation(child, "pending", receipt).contract.state).toBe("cancelled");
    expect(store.get(parent.contract.taskNodeId).contract.state).toBe("cancelled");
  });
  it("retires settled children explicitly before revising a parent plan", () => {
    const parent = store.create(contract("Plan rework"), "root").task;
    const c = store.claim(parent.contract.taskNodeId, "root", "g", "root").claim!;
    const [child] = store.decompose(
      c,
      [{ key: "a", contract: contract("Obsolete child") }],
      "plan",
    );
    const cc = store.claim(child.contract.taskNodeId, "child", "g", "child").claim!;
    store.control(cc, "cancel");
    const revised = store.revise(
      parent.contract.taskNodeId,
      parent.contract.revision,
      contract("Replanned goal"),
    );
    expect(revised.childTaskNodeIds).toEqual([]);
    expect(store.history(parent.contract.taskNodeId).some((e) => e.kind === "plan_retired")).toBe(
      true,
    );
    expect(store.claim(parent.contract.taskNodeId, "root", "g", "new").claim?.state).toBe("active");
  });
  it("rejects cycles that cross a parent-child plan edge", () => {
    const t = store.create(contract("Parent goal"), "parent").task;
    const c = store.claim(t.contract.taskNodeId, "a", "g", "a").claim!;
    const [child] = store.decompose(
      c,
      [{ key: "child", contract: contract("Child work") }],
      "plan",
    );
    expect(() =>
      store.revise(child.contract.taskNodeId, child.contract.revision, {
        ...child.contract,
        dependencies: [t.contract.taskNodeId],
      }),
    ).toThrow("DEPENDENCY_CYCLE");
  });
});
