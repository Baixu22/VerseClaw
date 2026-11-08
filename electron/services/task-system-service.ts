import { existsSync } from "node:fs";
import { TaskSystemStore } from "../../shared/task-system/store";
import { resolveTaskDomain } from "../../shared/task-system/identity";
import { inheritPersistentTaskReference } from "../../shared/task-system/runtime";
import type {
  TaskSystemCommand,
  TaskView,
  TaskQuery,
  TaskPage,
  TaskSessionSnapshot,
} from "../../shared/task-system/types";
import { getPersistedCoordinatorBinding, getWorkspaceRootPathById } from "./workspaces-api";
import type { GatewayManager } from "../gateway/manager";

export async function openTaskSystem(
  workspaceId: string,
  create = false,
): Promise<TaskSystemStore | null> {
  if (!workspaceId?.trim()) throw new Error("TASK_WORKSPACE_REQUIRED");
  const root = await getWorkspaceRootPathById(workspaceId);
  if (!root) {
    if (create) throw new Error("TASK_WORKSPACE_NOT_FOUND");
    return null;
  }
  if (!existsSync(root)) {
    if (create) throw new Error("TASK_WORKSPACE_NOT_FOUND");
    return null;
  }
  const domain = resolveTaskDomain(root);
  if (!create && !existsSync(domain.database)) return null;
  return new TaskSystemStore(domain);
}

export async function listManagedTasks(workspaceId?: string | null): Promise<TaskView[]> {
  if (!workspaceId) return [];
  const store = await openTaskSystem(workspaceId);
  try {
    if (!store) return [];
    const tasks: TaskView[] = [];
    let cursor: string | undefined;
    do {
      const page = store.page({ limit: 100, cursor });
      tasks.push(...page.tasks);
      cursor = page.nextCursor;
    } while (cursor);
    return tasks;
  } finally {
    store?.close();
  }
}
export async function pageManagedTasks(
  workspaceId: string | null | undefined,
  query: TaskQuery = {},
): Promise<TaskPage> {
  if (!workspaceId) return { tasks: [] };
  const store = await openTaskSystem(workspaceId);
  try {
    return store?.page(query) ?? { tasks: [] };
  } finally {
    store?.close();
  }
}

export async function readSessionTask(workspaceId:string,sessionKey:string,gateway?:GatewayManager):Promise<TaskSessionSnapshot> {
  if (!sessionKey?.trim()) throw new Error('TASK_SESSION_IDENTITY_REQUIRED');
  const store=await openTaskSystem(workspaceId);
  if (!store) return {task:null,children:[]};
  try {
    if (!gateway) throw new Error('TASK_SESSION_OWNER_UNAVAILABLE');
    const described=await gateway.rpc<{session?:{sessionId?:string}}>('sessions.describe',{key:sessionKey},10_000);
    const generation=described.session?.sessionId;
    if (!generation) return {task:null,children:[]};
    return store.sessionSnapshot(sessionKey,generation);
  } finally {store.close();}
}

export async function assertManagedTaskAdmission(input: {
  workspaceRoot: string;
  taskRef: string;
  sessionKey: string;
  generation: string;
  requestId: string;
}): Promise<void> {
  if (!existsSync(input.workspaceRoot)) return;
  const domain = resolveTaskDomain(input.workspaceRoot);
  if (!existsSync(domain.database)) return;
  const store = new TaskSystemStore(domain);
  try {
    const task = store.get(input.taskRef);
    if (
      !task.claim ||
      task.claim.sessionKey !== input.sessionKey ||
      task.claim.generation !== input.generation
    )
      throw new Error("TASK_DELEGATION_OWNER_MISMATCH");
    store.assertOwner(task.claim);
    // One logical dispatch per task epoch. A repair or another writer needs a
    // new task/attempt instead of another request key for the same work.
    store.reserveDelegation(task.claim, input.requestId);
  } finally {
    store.close();
  }
}

export async function persistentTaskChatContext(
  workspaceId: string,
  sessionKey: string,
  gateway: GatewayManager,
  workspaceRoot?: string,
): Promise<string | null> {
  if (!workspaceRoot || !existsSync(workspaceRoot)) return null;
  const resolved = resolveTaskDomain(workspaceRoot);
  if (!existsSync(resolved.database)) return null;
  const store = new TaskSystemStore(resolved);
  try {
    let bound = store.binding(sessionKey);
    const described = await gateway.rpc<{ session?: { sessionId?: string;parentSessionKey?:string;forkedFromParent?:boolean } }>(
      "sessions.describe", { key: sessionKey }, 10_000,
    );
    const liveGeneration = described?.session?.sessionId;
    if (!bound && described.session?.forkedFromParent && described.session.parentSessionKey && liveGeneration) {
      const parent=await gateway.rpc<{session?:{sessionId?:string}}>("sessions.describe",{key:described.session.parentSessionKey},10_000);
      if(parent.session?.sessionId) bound=inheritPersistentTaskReference(workspaceRoot,described.session.parentSessionKey,parent.session.sessionId,sessionKey,liveGeneration);
    }
    if (!bound?.claim) return null;
    if (!liveGeneration) throw new Error("TASK_GENERATION_STALE");
    store.binding(sessionKey, liveGeneration);
    if (bound.referenceOnly) return store.context(sessionKey,liveGeneration);
    const coordinator = await getPersistedCoordinatorBinding(workspaceId, sessionKey);
    if (coordinator && coordinator.state !== "active")
      throw new Error("TASK_COORDINATOR_REQUIRED");
    const domain = coordinator ? resolveTaskDomain(coordinator.environment.canonicalRoot) : resolved;
    if (domain.id !== store.domain.id) throw new Error("TASK_SESSION_DOMAIN_MISMATCH");
    // The coordinator keeps its own generation while a child owns the writer.
    // binding() checks either the writer binding or the read reference.
    store.binding(sessionKey, liveGeneration);
    const scoped = new TaskSystemStore(domain);
    try {
      if (!bound.referenceOnly && bound.claim.state === "active") {
        scoped.assertOwner(bound.claim);
        scoped.control(bound.claim, "renew");
      }
      return scoped.context(sessionKey, liveGeneration);
    } finally {
      scoped.close();
    }
  } finally {
    store.close();
  }
}

export async function taskSystemCommand(
  workspaceId: string,
  command: TaskSystemCommand,
  gateway?: GatewayManager,
): Promise<unknown> {
  const store = await openTaskSystem(workspaceId, true);
  if (!store) throw new Error("TASK_STORE_UNAVAILABLE");
  const generationFor = async (sessionKey: string, bindingWorkspaceId = workspaceId) => {
    if (!gateway) throw new Error("TASK_SESSION_OWNER_UNAVAILABLE");
    const binding = await getPersistedCoordinatorBinding(bindingWorkspaceId, sessionKey);
    if (!binding || binding.state !== "active") throw new Error("TASK_COORDINATOR_REQUIRED");
    const described = await gateway.rpc<{ session?: { sessionId?: string } }>(
      "sessions.describe",
      { key: sessionKey },
      10_000,
    );
    if (!described?.session?.sessionId) throw new Error("TASK_SESSION_MISSING");
    if (binding.sessionGeneration && binding.sessionGeneration !== described.session.sessionId)
      throw new Error("TASK_GENERATION_STALE");
    if (resolveTaskDomain(binding.environment.canonicalRoot).id !== store.domain.id)
      throw new Error("TASK_SESSION_DOMAIN_MISMATCH");
    return { generation: described.session.sessionId, worktree: binding.environment.canonicalRoot };
  };
  try {
    if (command.action === "changes") return store.changes(command.consumer, command.limit);
    if (command.action === "acknowledge") {
      store.acknowledge(command.consumer, command.expectedSequence, command.throughSequence);
      return { acknowledged: true };
    }
    if (command.action === "suggest")
      return store.suggest(command.query, command.target, command.limit);
    if (command.action === "create")
      return store.create(command.contract, command.requestId, undefined, {
        source: "host-task-api",
      });
    if (command.action === "adopt") {
      const { loadTaskLedgerSnapshot } = await import("./task-ledger-service");
      const snapshot = await loadTaskLedgerSnapshot(workspaceId);
      const existing = snapshot.nodes.find((node) => node.id === command.taskNodeId);
      if (!existing || existing.kind !== "task" || ["done", "dropped"].includes(existing.status))
        throw new Error("TASK_ADOPTION_INELIGIBLE");
      return store.create(command.contract, command.requestId, command.taskNodeId, {
        source: "legacy-adoption",
      });
    }
    if (command.action === "revise")
      return store.revise(command.taskNodeId, command.expectedRevision, command.contract);
    if (command.action === "claim") {
      const owner = await generationFor(command.sessionKey);
      const scoped = new TaskSystemStore(resolveTaskDomain(owner.worktree));
      try {
        return scoped.claim(
          command.taskNodeId,
          command.sessionKey,
          owner.generation,
          command.requestId,
        );
      } finally {
        scoped.close();
      }
    }
    if (command.action === "recover") {
      const next = await generationFor(command.targetSessionKey);
      const view = store.get(command.taskNodeId);
      if (!view.claim) throw new Error("TASK_CLAIM_REQUIRED");
      const original = new TaskSystemStore(resolveTaskDomain(view.claim.worktree));
      try {
        return original.recover(
          command.taskNodeId,
          command.targetSessionKey,
          next.generation,
          next.worktree,
        );
      } finally {
        original.close();
      }
    }
    const credential = command.credential;
    const current = await generationFor(credential.sessionKey);
    if (current.generation !== credential.generation) throw new Error("TASK_GENERATION_STALE");
    const scoped = new TaskSystemStore(resolveTaskDomain(current.worktree));
    try {
      if (command.action === "decompose")
        return scoped.decompose(credential, command.children, command.requestId);
      if (command.action === "reconcile") {
        if (!gateway) throw new Error("TASK_EFFECT_OWNER_UNAVAILABLE");
        return gateway.rpc(
          "tasks.contract.reconcile",
          {
            workspaceDir: current.worktree,
            credential,
            operationId: command.operationId,
            effectReceiptId: command.effectReceiptId,
          },
          15_000,
        );
      }
      if (command.action === "checkpoint") return scoped.checkpoint(credential, command.checkpoint);
      if (command.action === "handoff") {
        const next = await generationFor(
          command.targetSessionKey,
          command.targetWorkspaceId ?? workspaceId,
        );
        return scoped.handoff(credential, command.targetSessionKey, next.generation, next.worktree);
      }
      if (command.action === "submit") return scoped.submit(credential, command.candidate);
      if (command.action === "verifyFile")
        return scoped.verifyFile(
          credential,
          command.criterionId,
          command.path,
          command.expectedSha256,
          command.candidate,
        );
      if (command.action === "accept") {
        if (!gateway) throw new Error("TASK_VERIFIER_OWNER_UNAVAILABLE");
        const receipt = await gateway.rpc<{ success: boolean; task?: TaskView }>(
          "tasks.contract.accept",
          { workspaceDir: current.worktree, credential, candidate: command.candidate },
          30_000,
        );
        if (!receipt.success || !receipt.task) throw new Error("TASK_ACCEPTANCE_RECEIPT_MISSING");
        return receipt.task;
      }
      if (command.action === "cancel") {
        const cancelled = scoped.control(credential, "cancel");
        if (cancelled.contract.state === "cancelling" && gateway)
          await gateway.rpc("sessions.stop", { key: credential.sessionKey }, 20_000);
        return scoped.get(credential.taskNodeId);
      }
      return scoped.control(credential, command.action);
    } finally {
      scoped.close();
    }
  } finally {
    store.close();
  }
}
