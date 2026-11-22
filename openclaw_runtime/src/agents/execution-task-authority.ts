import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import type { TaskAuthorityAccess, TaskDomain, TaskAuthorityBasis } from "../../../shared/task-system/identity.js";
import { TaskSystemStore } from "../../../shared/task-system/store.js";
import { inheritPersistentTaskReference, assertTaskWorktreeReleasable } from "../../../shared/task-system/runtime.js";
import { resolveExecutionDomain } from "./execution-domain.js";
import { filesystemInstance } from "./worktree-registry.js";
import { withExecutionTaskBarrier } from './execution-task-barrier.js';
import { canonicalPath } from '../../../shared/task-system/identity.js';
import { checkoutWriterSnapshot } from './worktree-writer.js';

export type ExecutionTaskAuthorityBasis = TaskAuthorityBasis;

function resolveAuthority(workspaceRoot: string) {
  const resolution = resolveExecutionDomain(workspaceRoot);
  if (resolution.state === "unavailable") throw new Error(resolution.reason);
  const registration = resolution.state === "registered" ? resolution.registration : null;
  const basis: ExecutionTaskAuthorityBasis = {
    localDomainId: resolution.local.id,
    authorityId: resolution.authority.id,
    authorityDatabase: resolution.authority.database,
    executionWorktree: resolution.local.worktree,
    registrationRevision: registration?.revision ?? null,
    projectRevision: registration?.projectRevision ?? null,
    worktreeIncarnation: filesystemInstance(resolution.local.worktree),
    identityDigest: createHash("sha256").update(JSON.stringify({
      localRoot: filesystemInstance(resolution.local.root),
      worktree: filesystemInstance(resolution.local.worktree),
      authorityRoot: filesystemInstance(resolution.authority.root),
      registration,
    })).digest("hex"),
  };
  return { domain: resolution.authority, basis };
}

function basisSignature(basis: ExecutionTaskAuthorityBasis): string {
  return JSON.stringify([basis.localDomainId, basis.authorityId, basis.authorityDatabase, basis.executionWorktree,
    basis.registrationRevision, basis.projectRevision, basis.identityDigest]);
}

/** Instance-scoped access: registration changes never redirect a live TaskSystemStore. */
export function createExecutionTaskAccess(workspaceRoot: string, expected?: ExecutionTaskAuthorityBasis): TaskAuthorityAccess & {
  basis: ExecutionTaskAuthorityBasis;
} {
  const resolved = resolveAuthority(workspaceRoot);
  const signature = basisSignature(resolved.basis);
  if (expected && signature !== basisSignature(expected)) throw new Error("TASK_AUTHORITY_STALE");
  let databaseIdentity = existsSync(resolved.domain.database) ? filesystemInstance(resolved.domain.database) : undefined;
  if (expected?.databaseIdentity && databaseIdentity !== expected.databaseIdentity) throw new Error('TASK_AUTHORITY_DATABASE_REPLACED');
  if (databaseIdentity) resolved.basis.databaseIdentity = databaseIdentity;
  const assertCurrent = () => {
    const current = resolveAuthority(workspaceRoot);
    if (signature !== basisSignature(current.basis)) throw new Error("TASK_AUTHORITY_STALE");
    if (existsSync(resolved.domain.database)) {
      const identity = filesystemInstance(resolved.domain.database);
      if (databaseIdentity && identity !== databaseIdentity) throw new Error("TASK_AUTHORITY_DATABASE_REPLACED");
      databaseIdentity ??= identity;
      resolved.basis.databaseIdentity = databaseIdentity;
    } else if (databaseIdentity) throw new Error("TASK_AUTHORITY_DATABASE_MISSING");
  };
  return {
    domain: resolved.domain, basis: resolved.basis, assertCurrent,
    runProvenance(credential, runId) {
      assertCurrent();
      let writer: ReturnType<typeof checkoutWriterSnapshot>;
      try { writer = checkoutWriterSnapshot(workspaceRoot); }
      catch { return { authority: structuredClone(resolved.basis) }; }
      const owner = writer?.owner;
      const matches = owner?.kind === 'run' && owner.run.runId === runId && owner.run.scope.sessionKey === credential.sessionKey &&
        owner.sessionGeneration === credential.generation && (!owner.task || (owner.task.taskNodeId === credential.taskNodeId && owner.task.epoch === credential.epoch));
      return { authority: structuredClone(resolved.basis), ...(matches && writer && owner?.kind === 'run' ? {
        run: owner.run, checkout: { root: writer.root, incarnation: writer.incarnation, generation: writer.generation,
          epoch: writer.epoch, bindingRevision: owner.bindingRevision, effects: writer.operations.flatMap(operation => operation.receipt
            ? [{ operationId: operation.id, ownerReceipt: operation.receipt.ownerReceipt, outcome: operation.receipt.outcome }] : []) },
      } : {}) };
    },
    withWriteBarrier: operation => withExecutionTaskBarrier([resolved.basis.localDomainId, resolved.basis.authorityId], () => {
      assertCurrent();
      return operation();
    }),
    resolveRelated(root: string): TaskDomain {
      assertCurrent();
      return resolveAuthority(root).domain;
    },
  };
}

export function openExecutionTaskStore(workspaceRoot: string, expected?: ExecutionTaskAuthorityBasis): TaskSystemStore {
  const access = createExecutionTaskAccess(workspaceRoot, expected);
  return new TaskSystemStore(access.domain, undefined, access);
}

export function inheritExecutionTaskReference(workspace: string, sourceSessionKey: string, sourceGeneration: string, sessionKey: string, generation: string) {
  return inheritPersistentTaskReference(workspace, sourceSessionKey, sourceGeneration, sessionKey, generation,
    existsSync(workspace) ? createExecutionTaskAccess(workspace) : undefined);
}

export function assertExecutionTaskWorktreeReleasable(workspace: string) {
  return assertTaskWorktreeReleasable(workspace, existsSync(workspace) ? createExecutionTaskAccess(workspace) : undefined);
}

export type TaskWorktreeCleanupBinding = {
  domain: TaskDomain; localDomainId: string; authorityRootIdentity: string; databaseIdentity: string;
  operationId: string; worktree: string;
};

/** The barrier also covers an absent Task DB, so first creation cannot race deletion. */
export function withExecutionTaskWorktreeCleanup<T>(workspace: string, repository: string, operationId: string,
  effect: (binding?: TaskWorktreeCleanupBinding) => T): T {
  const access = createExecutionTaskAccess(workspace);
  return access.withWriteBarrier!(() => {
    if (!existsSync(access.domain.database)) return effect();
    const store = new TaskSystemStore(access.domain, undefined, access);
    const binding: TaskWorktreeCleanupBinding = { domain: access.domain, localDomainId: access.basis.localDomainId,
      authorityRootIdentity: filesystemInstance(access.domain.root), databaseIdentity: filesystemInstance(access.domain.database),
      operationId, worktree: canonicalPath(workspace) };
    let result: T;
    try {
      binding.operationId = store.prepareWorktreeCleanup(workspace, repository, operationId);
      result = store.withWorktreeCleanup(workspace, () => effect(binding));
    } finally { store.close(); }
    finishExecutionTaskWorktreeCleanup(binding);
    return result;
  });
}

/** Recovery uses the pinned authority after the execution path has been removed. */
export function finishExecutionTaskWorktreeCleanup(binding?: TaskWorktreeCleanupBinding): void {
  if (!binding) return;
  const assertCurrent = () => {
    if (filesystemInstance(binding.domain.root) !== binding.authorityRootIdentity
      || filesystemInstance(binding.domain.database) !== binding.databaseIdentity) throw new Error('TASK_CLEANUP_AUTHORITY_REPLACED');
    if (existsSync(binding.worktree)) throw new Error('TASK_CLEANUP_PATH_STILL_EXISTS');
  };
  withExecutionTaskBarrier([binding.localDomainId, binding.domain.id], () => {
    assertCurrent();
    const store = new TaskSystemStore(binding.domain, undefined, { domain: binding.domain, assertCurrent,
      resolveRelated: () => { throw new Error('TASK_CLEANUP_READBACK_ONLY'); } });
    try { store.completeWorktreeCleanup(binding.operationId, binding.worktree); }
    finally { store.close(); }
  });
}
