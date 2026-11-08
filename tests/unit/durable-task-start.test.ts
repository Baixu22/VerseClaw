// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TaskSystemStore } from "../../shared/task-system/store";
import { resolveTaskDomain } from "../../shared/task-system/identity";
import { createPersistentTaskTool } from "../../openclaw_runtime/src/agents/tools/persistent-task-tool";
import type { TaskContractInput, TaskView } from "../../shared/task-system/types";
const fixture = vi.hoisted(() => ({ root: "" }));
vi.mock("../../electron/services/workspaces-api", () => ({
  getWorkspaceRootPathById: async () => fixture.root,
  getPersistedCoordinatorBinding: async () => null,
}));
import {
  readSessionTask,
  persistentTaskChatContext,
} from "../../electron/services/task-system-service";
let store: TaskSystemStore;
const contract: TaskContractInput = {
  objective: "Fix the duplicate export",
  target: "src/export.ts",
  constraints: ["Keep existing behavior"],
  acceptance: [
    {
      id: "verify",
      description: "Regression test",
      verification: { kind: "owner-receipt", owner: "evidence-verifier", requires: ["test"] },
    },
  ],
};
beforeEach(() => {
  fixture.root = mkdtempSync(join(tmpdir(), "task-conversation-"));
  store = new TaskSystemStore(resolveTaskDomain(fixture.root));
});
afterEach(() => {
  store.close();
  rmSync(fixture.root, { recursive: true, force: true });
});
it("starts and binds an execution task in one tool call and reuses the original attempt on retry", async () => {
  const tool = createPersistentTaskTool({
    workspace: fixture.root,
    sessionKey: "a",
    generation: "g",
  });
  expect(store.sessionSnapshot("a", "g").task).toBeNull();
  const result = await tool.execute("tool-1", { action: "start", contract, requestId: "start-1" });
  const view = result.details as TaskView;
  expect(view.contract.objective).toBe(contract.objective);
  expect(view.claim?.sessionKey).toBe("a");
  const retry = await tool.execute("tool-2", { action: "start", contract, requestId: "start-1" });
  expect((retry.details as TaskView).claim?.attemptId).toBe(view.claim?.attemptId);
  expect(store.list()).toHaveLength(1);
});
it("rolls back a proposed task if the session is already implementing another task", () => {
  store.start({ contract }, "a", "g", "first");
  expect(() =>
    store.start({ contract: { ...contract, objective: "Different work" } }, "a", "g", "second"),
  ).toThrow("SESSION_ALREADY_BOUND");
  expect(store.list()).toHaveLength(1);
  expect(store.sessionSnapshot("a", "g").task?.contract.objective).toBe(contract.objective);
});
it("rejects a duplicate writer through the automatic start path and preserves the first claim", () => {
  const first = store.start({ contract }, "a", "g", "first");
  const other = new TaskSystemStore(resolveTaskDomain(fixture.root));
  try {
    expect(() => other.start({ contract }, "b", "g", "second")).toThrow("ALREADY_CLAIMED");
  } finally {
    other.close();
  }
  expect(store.get(first.contract.taskNodeId).claim).toEqual(first.claim);
  expect(store.sessionSnapshot("b", "g").task).toBeNull();
});
it("reads only the owning session generation, including its cancelled task", async () => {
  const task = store.start({ contract }, "a", "g", "start");
  const gateway = { rpc: async () => ({ session: { sessionId: "g" } }) };
  expect(
    (await readSessionTask("workspace", "a", gateway as never)).task?.contract.taskNodeId,
  ).toBe(task.contract.taskNodeId);
  expect(
    await persistentTaskChatContext("workspace", "a", gateway as never, fixture.root),
  ).toContain(contract.objective);
  expect((await readSessionTask("workspace", "b", gateway as never)).task).toBeNull();
  await expect(
    readSessionTask("workspace", "a", {
      rpc: async () => ({ session: { sessionId: "reset" } }),
    } as never),
  ).rejects.toThrow("GENERATION_STALE");
  store.control(task.claim!, "cancel");
  expect((await readSessionTask("workspace", "a", gateway as never)).task?.contract.state).toBe(
    "cancelled",
  );
  expect(store.sessionSnapshot("a", "reset").task).toBeNull();
});
