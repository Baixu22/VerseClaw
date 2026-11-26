import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { resolveTaskDomain, type TaskDomain } from "../../../shared/task-system/identity.js";
import { executeSqliteQuerySync, executeSqliteQueryTakeFirstSync, getNodeSqliteKysely } from "../infra/kysely-sync.js";
import { requireNodeSqlite } from "../infra/node-sqlite.js";
import type { DB } from "../state/openclaw-state-db.generated.js";
import { openExecutionStateDatabase as openOpenClawStateDatabase, runExecutionStateWriteTransaction as runOpenClawStateWriteTransaction } from "../state/execution-state-db.js";
import { filesystemInstance } from "./worktree-registry.js";
import { TaskSystemStore } from "../../../shared/task-system/store.js";
import { checkoutWriterSnapshot } from "./worktree-writer.js";
import { TASK_SCHEMA_VERSION } from '../../../shared/task-system/store.js';
import { withExecutionTaskBarrier } from './execution-task-barrier.js';
import { resolveExecutionStatePath } from '../state/execution-state-db.js';

type DomainDatabase = Pick<DB, "execution_domain_registrations">;
export type ExecutionDomainRegistration = {
  schema: 1;
  domainId: string;
  domainRootIdentity: string;
  authority: TaskDomain;
  authorityRootIdentity: string;
  authorityDatabaseIdentity: string;
  actor: string;
  registeredAt: number;
  projectRevision: number;
  revision: number;
  operationId: string;
  requestDigest: string;
};
export type ExecutionDomainResolution =
  | { state: "independent"; local: TaskDomain; authority: TaskDomain }
  | { state: "registered"; local: TaskDomain; authority: TaskDomain; registration: ExecutionDomainRegistration }
  | { state: "unavailable"; reason: string };

function readRegistration(domainId: string, readOnly = false): ExecutionDomainRegistration | null {
  const db = readOnly
    ? new (requireNodeSqlite().DatabaseSync)(resolveExecutionStatePath(), { readOnly: true })
    : openOpenClawStateDatabase().db;
  try {
  const query = getNodeSqliteKysely<DomainDatabase>(db);
  const row = executeSqliteQueryTakeFirstSync(db, query.selectFrom("execution_domain_registrations").selectAll().where("domain_id", "=", domainId));
  if (!row) return null;
  const value = JSON.parse(row.registration_json) as ExecutionDomainRegistration;
  if (value.schema !== 1 || value.domainId !== domainId || value.revision !== row.revision
    || !value.authority?.database || !value.authorityDatabaseIdentity || !value.operationId) {
    throw new Error("execution_domain_registration_invalid");
  }
  return value;
  } finally { if (readOnly) db.close(); }
}

/** Read-only probing never creates a task database or upgrades its schema. */
function assertAuthorityDatabase(domain: TaskDomain): void {
  if (!existsSync(domain.database)) throw new Error("execution_task_authority_missing");
  const { DatabaseSync } = requireNodeSqlite();
  const db = new DatabaseSync(domain.database, { readOnly: true });
  try {
    const version = db.prepare("PRAGMA user_version").get() as { user_version: number };
    if (version.user_version !== TASK_SCHEMA_VERSION) throw new Error("execution_task_authority_schema_mismatch");
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('task_contracts','task_claims','task_bindings')").all();
    if (tables.length !== 3) throw new Error("execution_task_authority_invalid");
  } finally { db.close(); }
}

export function resolveExecutionDomain(workspaceRoot: string, expectedProjectRevision?: number, readOnly = false): ExecutionDomainResolution {
  try {
    const local = resolveTaskDomain(workspaceRoot);
    const registration = readRegistration(local.id, readOnly);
    if (!registration) return { state: "independent", local, authority: local };
    if (registration.domainRootIdentity !== filesystemInstance(local.root)) throw new Error("execution_clone_replaced");
    if (expectedProjectRevision !== undefined && registration.projectRevision !== expectedProjectRevision) {
      throw new Error("execution_project_revision_stale");
    }
    const authority = resolveTaskDomain(registration.authority.worktree);
    if (authority.id !== registration.authority.id || authority.database !== registration.authority.database
      || filesystemInstance(authority.root) !== registration.authorityRootIdentity
      || filesystemInstance(authority.database) !== registration.authorityDatabaseIdentity) {
      throw new Error("execution_task_authority_replaced");
    }
    // Only a direct local authority is accepted; registration chains cannot
    // silently redirect a task or form a loop across independent clones.
    if (readRegistration(authority.id, readOnly)) throw new Error("execution_task_authority_indirect");
    assertAuthorityDatabase(authority);
    return { state: "registered", local, authority: { ...authority, worktree: local.worktree }, registration };
  } catch (error) {
    return { state: "unavailable", reason: error instanceof Error ? error.message : "execution_domain_unavailable" };
  }
}

/** Called by a trusted owner, never by model-supplied actor or a remote URL match. */
export function registerExecutionDomain(input: {
  workspaceRoot: string; authorityRoot: string; actor: string; operationId: string;
  expectedRevision: number; projectRevision: number;
}): ExecutionDomainRegistration {
  if (!input.actor.trim() || !input.operationId.trim() || !Number.isSafeInteger(input.expectedRevision)
    || input.expectedRevision < 0 || !Number.isSafeInteger(input.projectRevision) || input.projectRevision < 1) {
    throw new Error("execution_domain_registration_input_invalid");
  }
  const local = resolveTaskDomain(input.workspaceRoot);
  const authority = resolveTaskDomain(input.authorityRoot);
  if (local.id === authority.id) throw new Error("execution_domain_already_local");
  assertAuthorityDatabase(authority);
  const requestDigest = createHash("sha256").update(JSON.stringify({
    domainId: local.id, authorityId: authority.id, actor: input.actor,
    projectRevision: input.projectRevision, expectedRevision: input.expectedRevision,
  })).digest("hex");
  const before = readRegistration(local.id);
  const identities = [local.worktree, local.root, authority.root, authority.database].map(filesystemInstance);
  return withExecutionTaskBarrier([local.id, authority.id, ...(before ? [before.authority.id] : [])], () => runOpenClawStateWriteTransaction(({ db }) => {
    if (JSON.stringify([local.worktree, local.root, authority.root, authority.database].map(filesystemInstance)) !== JSON.stringify(identities)
      || resolveTaskDomain(input.workspaceRoot).id !== local.id || resolveTaskDomain(input.authorityRoot).id !== authority.id) {
      throw new Error('execution_domain_registration_stale');
    }
    const old = readRegistration(local.id);
    if (old?.operationId === input.operationId) {
      if (old.requestDigest !== requestDigest) throw new Error("execution_domain_operation_conflict");
      const current = resolveExecutionDomain(input.workspaceRoot, input.projectRevision);
      if (current.state !== "registered") throw new Error("execution_domain_registration_stale");
      return old;
    }
    if ((old?.revision ?? 0) !== input.expectedRevision) throw new Error("execution_domain_revision_conflict");
    if (existsSync(local.database)) {
      const { DatabaseSync } = requireNodeSqlite();
      const localDb = new DatabaseSync(local.database, { readOnly: true });
      try {
        const table = localDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='task_contracts'").get();
        if (!table || Number((localDb.prepare("SELECT COUNT(*) AS count FROM task_contracts").get() as { count: number }).count) > 0)
          throw new Error("execution_clone_has_local_tasks");
      } finally { localDb.close(); }
    }
    const writer = checkoutWriterSnapshot(local.worktree);
    if (writer && writer.state !== 'released') throw new Error('execution_clone_writer_active');
    if (old) {
      const current = resolveExecutionDomain(input.workspaceRoot);
      if (current.state !== 'registered') throw new Error('execution_domain_registration_stale');
      const store = new TaskSystemStore(current.authority);
      try {
        if (store.recordedExecutionWorktrees().some(root => existsSync(root) && resolveTaskDomain(root).id === local.id && store.worktreeTaskReferences(root).length > 0)) {
          throw new Error('execution_clone_has_task_references');
        }
        if (store.worktreeTaskReferences(local.worktree).length) throw new Error('execution_clone_has_task_references');
      } finally { store.close(); }
    }
    if (readRegistration(authority.id)) throw new Error("execution_task_authority_indirect");
    const query = getNodeSqliteKysely<DomainDatabase>(db);
    const references = executeSqliteQuerySync(db, query.selectFrom("execution_domain_registrations").select("registration_json")).rows;
    if (references.some(row => (JSON.parse(row.registration_json) as ExecutionDomainRegistration).authority.id === local.id)) {
      throw new Error("execution_domain_has_dependents");
    }
    const registration: ExecutionDomainRegistration = {
      schema: 1, domainId: local.id, domainRootIdentity: filesystemInstance(local.root), authority,
      authorityRootIdentity: filesystemInstance(authority.root), authorityDatabaseIdentity: filesystemInstance(authority.database),
      actor: input.actor, registeredAt: Date.now(), projectRevision: input.projectRevision,
      revision: (old?.revision ?? 0) + 1, operationId: input.operationId, requestDigest,
    };
    executeSqliteQuerySync(db, query.insertInto("execution_domain_registrations").values({
      domain_id: local.id, revision: registration.revision,
      registration_json: JSON.stringify(registration), updated_at: registration.registeredAt,
    }).onConflict(c => c.column("domain_id").doUpdateSet({
      revision: registration.revision, registration_json: JSON.stringify(registration), updated_at: registration.registeredAt,
    })));
    return registration;
  }));
}
