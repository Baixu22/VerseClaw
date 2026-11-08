// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaskSystemStore } from "../../shared/task-system/store";
import { resolveTaskDomain } from "../../shared/task-system/identity";
const fixture = vi.hoisted(() => ({ root: "" }));
vi.mock("../../electron/services/workspaces-api", () => ({
  getWorkspaceRootPathById: async () => fixture.root,
  getPersistedCoordinatorBinding: async () => ({
    state: "active",
    environment: { canonicalRoot: fixture.root },
  }),
}));
import { persistentTaskChatContext } from "../../electron/services/task-system-service";
import { createTaskRuntimeGuard, executeTaskGuarded } from "../../shared/task-system/runtime";
let store: TaskSystemStore;
beforeEach(() => {
  fixture.root = mkdtempSync(join(tmpdir(), "task-coordinator-context-"));
  store = new TaskSystemStore(resolveTaskDomain(fixture.root));
});
it("recovers a fork's read reference from owner lineage without copying its parent's writer", async()=>{
  const task=store.create({objective:"Persistent parent goal",target:".",constraints:["Keep original scope"],acceptance:[{id:"v",description:"Verify",verification:{kind:"owner-receipt",owner:"fixture"}}]},"parent-goal").task;
  const claim=store.claim(task.contract.taskNodeId,"parent","pg","claim").claim!;
  const gateway={rpc:async(_method:string,args:{key:string})=>({session:args.key==="fork"?{sessionId:"fg",forkedFromParent:true,parentSessionKey:"parent"}:{sessionId:"pg"}})};
  expect(await persistentTaskChatContext("workspace","fork",gateway as never,fixture.root)).toContain("Persistent parent goal");
  expect(store.binding("fork","fg")?.referenceOnly).toBe(true);
  expect(store.get(claim.taskNodeId).claim).toEqual(claim);
  expect(await persistentTaskChatContext("workspace","fork",gateway as never,fixture.root)).toContain("observer");
  expect(store.history(claim.taskNodeId).filter(e=>e.kind==="reference_inherited")).toHaveLength(1);
  let writes=0;
  await expect(executeTaskGuarded(createTaskRuntimeGuard(fixture.root,"fork","fg"),"attempt","write",async()=>{writes++;})).rejects.toThrow("CLAIM_REQUIRED");
  expect(writes).toBe(0);
  expect(()=>store.inheritReference("parent","reset","other","og")).toThrow("GENERATION_STALE");
});
afterEach(() => {
  store.close();
  rmSync(fixture.root, { recursive: true, force: true });
});
it("rehydrates a coordinator read reference using the parent generation while a child owns the writer", async () => {
  const task = store.create(
    {
      objective: "Original goal",
      target: ".",
      constraints: [],
      acceptance: [
        {
          id: "v",
          description: "Verify",
          verification: { kind: "owner-receipt", owner: "fixture" },
        },
      ],
    },
    "new",
  ).task;
  const claim = store.claim(
    task.contract.taskNodeId,
    "parent",
    "parent-generation",
    "claim",
  ).claim!;
  store.prepareWriterDelegation(claim, {
    delegationId: "child-run",
    childSessionKey: "child",
    childGeneration: "child-generation",
    childWorktree: fixture.root,
    childRunId: "child-run",
    mode: "writer",
  });
  const gateway = { rpc: async () => ({ session: { sessionId: "parent-generation" } }) };
  const context = await persistentTaskChatContext(
    "workspace",
    "parent",
    gateway as never,
    fixture.root,
  );
  expect(context).toContain("Original goal");
  expect(context).toContain("observer");
  expect(store.get(claim.taskNodeId).claim?.sessionKey).toBe("child");
  await expect(
    persistentTaskChatContext(
      "workspace",
      "parent",
      { rpc: async () => ({ session: { sessionId: "reset" } }) } as never,
      fixture.root,
    ),
  ).rejects.toThrow("TASK_GENERATION_STALE");
});
