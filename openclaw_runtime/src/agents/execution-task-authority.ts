import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import type { TaskAuthorityAccess, TaskDomain, TaskAuthorityBasis } from "../../../shared/task-system/identity.js";
import { TaskSystemStore } from "../../../shared/task-system/store.js";
import { createTaskRuntimeGuard, inheritPersistentTaskReference, assertTaskWorktreeReleasable } from "../../../shared/task-system/runtime.js";
import { resolveExecutionDomain } from "./execution-domain.js";
import { filesystemInstance } from "./worktree-registry.js";

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
    identityDigest: createHash("sha256").update(JSON.stringify({
      localRoot: filesystemInstance(resolution.local.root),
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

export function createExecutionTaskGuard(workspace: string | undefined, sessionKey: string | undefined, generation: string | undefined, runId?: string) {
  return createTaskRuntimeGuard(workspace, sessionKey, generation, runId,
    workspace && sessionKey && existsSync(workspace) ? createExecutionTaskAccess(workspace) : undefined);
}

export function inheritExecutionTaskReference(workspace: string, sourceSessionKey: string, sourceGeneration: string, sessionKey: string, generation: string) {
  return inheritPersistentTaskReference(workspace, sourceSessionKey, sourceGeneration, sessionKey, generation,
    existsSync(workspace) ? createExecutionTaskAccess(workspace) : undefined);
}

export function assertExecutionTaskWorktreeReleasable(workspace: string) {
  return assertTaskWorktreeReleasable(workspace, existsSync(workspace) ? createExecutionTaskAccess(workspace) : undefined);
}
