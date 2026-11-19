import { existsSync, statSync } from "node:fs";
import type { WorkspaceProfile } from '../../shared/types/workspace';
import { canonicalWorktreePath, findManagedWorktreeByRoot, worktreeNativeIdentity } from '../../openclaw_runtime/src/agents/worktree-registry';
import { assertCleanupCommitRetained, assertWorktreeIndexVisible, removeNativeGitWorktree } from '../../openclaw_runtime/src/agents/worktree-service';
import type { GitOperationResult } from '../../shared/types/git';
import { checkoutWriterSnapshot } from '../../openclaw_runtime/src/agents/worktree-writer';
import { resolveExecutionDomain } from '../../openclaw_runtime/src/agents/execution-domain';
import { TaskSystemStore } from "../../shared/task-system/store";
import { canonicalPath } from "../../shared/task-system/identity";
import { projectCoordinatorProfile, projectCoordinatorScope } from "../../shared/task-system/project-coordinator";
import { createExecutionTaskAccess, openExecutionTaskStore, inheritExecutionTaskReference, type ExecutionTaskAuthorityBasis } from "../../openclaw_runtime/src/agents/execution-task-authority";
import type {
  TaskSystemCommand,
  TaskView,
  TaskQuery,
  TaskPage,
  TaskSessionSnapshot,
} from "../../shared/task-system/types";
import { getPersistedCoordinatorBinding, getProjectCoordinatorProfiles, getWorkspaceRootPathById } from "./workspaces-api";
import type { GatewayManager } from "../gateway/manager";

type UiWorktreeRemovalRead = { blocked: true; reason: string } | { blocked: false; identity: string };

/** UI 只删除无产品 owner 的原生检出；受管对象继续由既有 owner 回收。 */
export function inspectUiWorktreeRemoval(repositoryRoot: string, target: string, profiles: WorkspaceProfile[]): UiWorktreeRemovalRead {
  const deny = (code: string, detail: string, owner = 'WorktreeService.cleanup'): UiWorktreeRemovalRead => ({ blocked: true,
    reason: `${code}: ${detail}; owner=${owner}; entry=/settings/storage (originating session / Task Ledger)` });
  try {
    const root = canonicalWorktreePath(target), identity = worktreeNativeIdentity(target, 'git');
    const domain = resolveExecutionDomain(root), repository = resolveExecutionDomain(repositoryRoot);
    if (domain.state === 'unavailable') return deny('UI_CLEANUP_OWNER_UNAVAILABLE', domain.reason);
    if (repository.state === 'unavailable') return deny('UI_CLEANUP_OWNER_UNAVAILABLE', repository.reason);
    // 使用原生 common-dir + backlink，不从相同remote、父目录或名称合并独立clone。
    if (domain.local.id !== repository.local.id) return deny('UI_CLEANUP_FOREIGN_GIT_DOMAIN', root);
    const managed = findManagedWorktreeByRoot(root);
    if (managed) return deny('UI_CLEANUP_MANAGED_CHECKOUT', `${managed.record.id}@${managed.record.generation}`);
    const writer = checkoutWriterSnapshot(root);
    if (writer) return deny('UI_CLEANUP_CHECKOUT_OWNER', `${writer.generation}:${writer.state}`);
    if (process.env.CLAWX_VERSGIT_CLEANUP_ROOT?.trim() || process.env.CLAWX_VERSGIT_BINDING_ENABLED === '1')
      return deny('UI_CLEANUP_VG_OWNER', root, 'VerseGit cleanup seal / WorktreeService.cleanup');
    for (const profile of profiles) {
      const roots = [profile.rootPath, ...Object.values(profile.coordinatorBindings ?? {}).map(b => b.environment.canonicalRoot),
        ...Object.values(profile.executionMigrations ?? {}).flatMap(operation => [operation.sourceRoot, operation.targetRoot])];
      if (roots.some(path => canonicalWorktreePath(path) === root)) return deny('UI_CLEANUP_WORKSPACE_REFERENCE', profile.id, 'Workspace/session lifecycle');
    }
    if (domain.state === 'registered') return deny('UI_CLEANUP_TASK_AUTHORITY', domain.authority.id, 'TaskSystemStore / WorktreeService.cleanup');
    let present = true;
    try { statSync(domain.authority.database); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') present = false; else throw error; }
    if (!present) {
      try { assertWorktreeIndexVisible(root); }
      catch (error) { return deny('UI_CLEANUP_GIT_INDEX', error instanceof Error ? error.message : String(error), 'Git index / WorktreeService.cleanup'); }
      try { assertCleanupCommitRetained({ backend: "git", root, baseRoot: repositoryRoot }); }
      catch (error) { return deny('UI_CLEANUP_COMMIT_RETENTION', error instanceof Error ? error.message : String(error), 'Git refs / WorktreeService.cleanup'); }
      return { blocked: false, identity };
    }
    // The existing database establishes Task ownership; its schema stays with TaskSystemStore.
    return deny('UI_CLEANUP_TASK_AUTHORITY', domain.authority.id, 'TaskSystemStore');
  } catch (error) { return deny('UI_CLEANUP_OWNER_UNAVAILABLE', error instanceof Error ? error.message : String(error)); }
}

/** The final inspection and native effect share the Task first-open/claim barrier. */
export function removeUiWorktree(repositoryRoot: string, target: string, profiles: WorkspaceProfile[], expectedIdentity: string): GitOperationResult {
  try {
    const access = createExecutionTaskAccess(target);
    return access.withWriteBarrier!(() => {
      const current = inspectUiWorktreeRemoval(repositoryRoot, target, profiles);
      if (current.blocked) return { success: false, blocked: true, reason: current.reason };
      if (current.identity !== expectedIdentity) return { success: false, blocked: true,
        reason: 'UI_CLEANUP_TARGET_CHANGED; entry=/settings/storage; refresh the owning session' };
      try {
        return { success: true, stdout: removeNativeGitWorktree(repositoryRoot, target), stderr: '', exitCode: 0 };
      } catch (error) {
        const failure = error as { status?: number; stdout?: string | Buffer; stderr?: string | Buffer };
        return { success: false, exitCode: typeof failure.status === 'number' ? failure.status : 1,
          stdout: String(failure.stdout ?? ''), stderr: String(failure.stderr ?? error) };
      }
    });
  } catch (error) {
    return { success: false, blocked: true,
      reason: `UI_CLEANUP_OWNER_UNAVAILABLE: ${String(error)}; owner=Workspace/session lifecycle; entry=/settings/storage` };
  }
}

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
  const access = createExecutionTaskAccess(root);
  const domain = access.domain;
  if (!create && !existsSync(domain.database)) return null;
  return new TaskSystemStore(domain, undefined, access);
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

export async function readSessionTask(workspaceId:string,sessionKey:string,gateway?:GatewayManager,expectedGeneration?:string):Promise<TaskSessionSnapshot> {
  if (!sessionKey?.trim()) throw new Error('TASK_SESSION_IDENTITY_REQUIRED');
  const store=await openTaskSystem(workspaceId);
  if (!store) return {task:null,children:[]};
  try {
    if (!gateway) throw new Error('TASK_SESSION_OWNER_UNAVAILABLE');
    const described=await gateway.rpc<{session?:{sessionId?:string}}>('sessions.describe',{key:sessionKey});
    const generation=described.session?.sessionId;
    if (expectedGeneration && generation !== expectedGeneration) throw new Error('TASK_GENERATION_STALE');
    if (!generation) return {task:null,children:[]};
    const snapshot=store.sessionSnapshot(sessionKey,generation);
    const verificationReceipts=snapshot.task?store.getTaskEvidence(snapshot.task.contract.taskNodeId):[];
    const profile = projectCoordinatorProfile(await getProjectCoordinatorProfiles(), sessionKey);
    const projectPlan = profile?.id === workspaceId
      ? store.projectPlan(projectCoordinatorScope(profile, sessionKey, generation, store.domain.worktree).workspaceId)
      : undefined;
    if (expectedGeneration) {
      const after=await gateway.rpc<{session?:{sessionId?:string}}>('sessions.describe',{key:sessionKey});
      if (after.session?.sessionId !== generation) throw new Error('TASK_GENERATION_STALE');
    }
    return {...snapshot,verificationReceipts,...(projectPlan ? {projectPlan} : {})};
  } finally {store.close();}
}

export async function assertManagedTaskAdmission(input: {
  workspaceRoot: string;
  taskRef: string;
  sessionKey: string;
  generation: string;
  requestId: string;
}): Promise<'reserved' | 'existing' | void> {
  if (!existsSync(input.workspaceRoot)) return;
  const access = createExecutionTaskAccess(input.workspaceRoot);
  const domain = access.domain;
  if (!existsSync(domain.database)) return;
  const store = new TaskSystemStore(domain, undefined, access);
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
    return store.reserveDelegation(task.claim, input.requestId);
  } finally {
    store.close();
  }
}

type ManagedSessionEffectInput = {
  workspaceRoot: string;
  sessionKey: string;
  generation: string;
  taskNodeId?: string;
  fallbackTaskNodeId?: string;
};

/** Read a persisted session reference without acquiring execution ownership. */
export function readManagedSessionReference(workspaceRoot: string, sessionKey: string, generation: string): TaskView | null {
  const access = createExecutionTaskAccess(workspaceRoot);
  if (!existsSync(access.domain.database)) return null;
  const store = new TaskSystemStore(access.domain, undefined, access);
  try { return store.binding(sessionKey, generation); }
  finally { store.close(); }
}

function resolveManagedSessionEffectTask(store: TaskSystemStore, input: ManagedSessionEffectInput): TaskView {
  const bound = store.binding(input.sessionKey, input.generation);
  if (bound && input.taskNodeId && bound.contract.taskNodeId !== input.taskNodeId) throw new Error('TASK_SCOPE_TASK_SELECTION_CONFLICT');
  if (bound?.referenceOnly && !store.isSelectedReference(input.sessionKey, input.generation)) throw new Error('TASK_REFERENCE_READ_ONLY');
  const taskNodeId = bound?.contract.taskNodeId ?? input.taskNodeId ?? input.fallbackTaskNodeId;
  if (!taskNodeId) throw new Error('TASK_CLAIM_REQUIRED');
  if (!store.has(taskNodeId)) throw new Error('TASK_LEGACY_CONTRACT_REQUIRED');
  return store.get(taskNodeId);
}

/** Resolve admission against the task owner without claiming a selected task. */
export function readManagedSessionEffect(input: ManagedSessionEffectInput): TaskView & { authorityBasis: ExecutionTaskAuthorityBasis } {
  const access = createExecutionTaskAccess(input.workspaceRoot);
  const domain = access.domain;
  if (!existsSync(domain.database)) throw new Error('TASK_CLAIM_REQUIRED');
  const store = new TaskSystemStore(domain, undefined, access);
  try { return { ...resolveManagedSessionEffectTask(store, input), authorityBasis: access.basis }; }
  finally { store.close(); }
}

/** Claim only after the session, environment and previous run have been checked. */
export function startManagedSessionEffect(input: ManagedSessionEffectInput & {
  requestId: string; expectedContract?: Pick<TaskView['contract'], 'revision' | 'digest'>;
  expectedAuthority?: ExecutionTaskAuthorityBasis;
}): TaskView {
  const access = createExecutionTaskAccess(input.workspaceRoot, input.expectedAuthority);
  const domain = access.domain;
  if (!existsSync(domain.database)) throw new Error('TASK_CLAIM_REQUIRED');
  const store = new TaskSystemStore(domain, undefined, access);
  try {
    const task = resolveManagedSessionEffectTask(store, input);
    const view = store.start({ taskNodeId: task.contract.taskNodeId, expectedContract: input.expectedContract },
      input.sessionKey, input.generation, input.requestId);
    if (!view.claim) throw new Error('TASK_CLAIM_REQUIRED');
    return store.assertOwner(view.claim);
  } finally {
    store.close();
  }
}

export function selectManagedSessionTask(input: {
  workspaceRoot: string; taskNodeId: string; sessionKey: string; generation: string; requestId: string;
}): void {
  const access = createExecutionTaskAccess(input.workspaceRoot);
  const domain = access.domain;
  if (!existsSync(domain.database)) return;
  const store = new TaskSystemStore(domain, undefined, access);
  try {
    if (!store.has(input.taskNodeId)) {
      if (store.binding(input.sessionKey, input.generation)) throw new Error('TASK_LEGACY_CONTRACT_REQUIRED');
      return;
    }
    store.selectReference(input.taskNodeId, input.sessionKey, input.generation, input.requestId);
  } finally { store.close(); }
}

export function handoffManagedSessionTask(input: {
  workspaceRoot: string;
  sourceSessionKey: string;
  sourceGeneration: string;
  sessionKey: string;
  generation: string;
}): TaskView | null {
  const access = createExecutionTaskAccess(input.workspaceRoot);
  const domain = access.domain;
  if (!existsSync(domain.database)) return null;
  const store = new TaskSystemStore(domain, undefined, access);
  try {
    const source = store.binding(input.sourceSessionKey, input.sourceGeneration);
    if (!source?.claim || source.referenceOnly) return null;
    return store.handoff(source.claim, input.sessionKey, input.generation);
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
  const access = createExecutionTaskAccess(workspaceRoot);
  const resolved = access.domain;
  if (!existsSync(resolved.database)) return null;
  const store = new TaskSystemStore(resolved, undefined, access);
  try {
    let bound = store.binding(sessionKey);
    const described = await gateway.rpc<{ session?: { sessionId?: string;parentSessionKey?:string;forkedFromParent?:boolean } }>(
      "sessions.describe", { key: sessionKey }, 10_000,
    );
    const liveGeneration = described?.session?.sessionId;
    if (!bound && described.session?.forkedFromParent && described.session.parentSessionKey && liveGeneration) {
      const parent=await gateway.rpc<{session?:{sessionId?:string}}>("sessions.describe",{key:described.session.parentSessionKey},10_000);
      if(parent.session?.sessionId) bound=inheritExecutionTaskReference(workspaceRoot,described.session.parentSessionKey,parent.session.sessionId,sessionKey,liveGeneration);
    }
    if (!bound?.claim) return null;
    if (!liveGeneration) throw new Error("TASK_GENERATION_STALE");
    store.binding(sessionKey, liveGeneration);
    if (bound.referenceOnly) return store.context(sessionKey,liveGeneration);
    const coordinator = await getPersistedCoordinatorBinding(workspaceId, sessionKey);
    if (coordinator && coordinator.state !== "active")
      throw new Error("TASK_COORDINATOR_REQUIRED");
    const domain = coordinator ? createExecutionTaskAccess(coordinator.environment.canonicalRoot).domain : resolved;
    if (domain.id !== store.domain.id) throw new Error("TASK_SESSION_DOMAIN_MISMATCH");
    // The coordinator keeps its own generation while a child owns the writer.
    // binding() checks either the writer binding or the read reference.
    store.binding(sessionKey, liveGeneration);
    const scoped = openExecutionTaskStore(domain.worktree);
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
  const store = await openTaskSystem(workspaceId, !['history', 'readRetainedArtifact'].includes(command.action));
  if (!store) throw new Error("TASK_STORE_UNAVAILABLE");
  const generationFor = async (sessionKey: string, bindingWorkspaceId = workspaceId, allowUserPaused = false) => {
    if (!gateway) throw new Error("TASK_SESSION_OWNER_UNAVAILABLE");
    const binding = await getPersistedCoordinatorBinding(bindingWorkspaceId, sessionKey);
    if (!binding || (binding.state !== "active" && !(allowUserPaused && binding.state === "paused" && binding.invalidationReason === "user-paused")))
      throw new Error("TASK_COORDINATOR_REQUIRED");
    const described = await gateway.rpc<{ session?: { sessionId?: string } }>(
      "sessions.describe",
      { key: sessionKey },
      10_000,
    );
    if (!described?.session?.sessionId) throw new Error("TASK_SESSION_MISSING");
    if (binding.sessionGeneration && binding.sessionGeneration !== described.session.sessionId)
      throw new Error("TASK_GENERATION_STALE");
    if (createExecutionTaskAccess(binding.environment.canonicalRoot).domain.id !== store.domain.id)
      throw new Error("TASK_SESSION_DOMAIN_MISMATCH");
    return { generation: described.session.sessionId, worktree: binding.environment.canonicalRoot };
  };
  try {
    if (command.action === 'history') return store.history(command.taskNodeId, command.afterSequence, command.limit);
    if (command.action === 'readRetainedArtifact')
      return store.readRetainedArtifactPage(command.taskNodeId, command.receiptId, command.offset, command.length);
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
      const scoped = openExecutionTaskStore(owner.worktree);
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
      const original = openExecutionTaskStore(view.claim.worktree);
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
    const controlOnly = command.action === "cancel" || command.action === "reconcile";
    const worker = controlOnly ? store.writerDelegationFor(credential) : null;
    const coordinator = worker?.parent ?? credential;
    const current = await generationFor(coordinator.sessionKey, workspaceId, controlOnly);
    if (current.generation !== coordinator.generation) throw new Error("TASK_GENERATION_STALE");
    if (worker) {
      if (worker.parentWorktree !== canonicalPath(current.worktree)) throw new Error("TASK_SESSION_DOMAIN_MISMATCH");
      const described = await gateway!.rpc<{ session?: { sessionId?: string } }>(
        "sessions.describe", { key: credential.sessionKey }, 10_000,
      );
      if (described.session?.sessionId !== credential.generation) throw new Error("TASK_GENERATION_STALE");
    }
    const worktree = worker?.childWorktree ?? current.worktree;
    const scoped = openExecutionTaskStore(worktree);
    try {
      if (command.action === "decompose")
        return scoped.decompose(credential, command.children, command.requestId);
      if (command.action === "reconcile") {
        if (!gateway) throw new Error("TASK_EFFECT_OWNER_UNAVAILABLE");
        return gateway.rpc(
          "tasks.contract.reconcile",
          {
            workspaceDir: worktree,
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
        if (cancelled.contract.state === "cancelling" && gateway) {
          const stopOwned = async (view: TaskView) => {
            const claim = view.claim;
            if (view.contract.state !== "cancelling") return;
            for (const id of view.childTaskNodeIds ?? []) await stopOwned(scoped.get(id));
            if (!claim || claim.state === "released") return;
            const delegation = scoped.writerDelegationFor(claim);
            if (delegation?.phase === "returned") return;
            const stopped = await gateway.rpc<{ ok: boolean; sessionId: string }>(
              "sessions.stop", { key: claim.sessionKey, expectedSessionId: claim.generation }, 20_000,
            );
            if (!stopped.ok || stopped.sessionId !== claim.generation) throw new Error("TASK_CANCEL_STOP_UNCONFIRMED");
            if (delegation) scoped.returnDelegatedWriter(claim.sessionKey, {
              runId: delegation.childRunId, parentGeneration: delegation.parent.generation,
              endedAt: Date.now(), outcome: "cancelled",
            });
          };
          await stopOwned(cancelled);
        }
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
