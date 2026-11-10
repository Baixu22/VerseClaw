import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { SessionKey, TaskId } from "../types/identity-scope.js";
import {
  canonicalPath,
  resolveTaskDomain,
  type TaskAuthorityAccess,
  type TaskDomain,
} from "./identity.js";
import type {
  TaskCheckpoint,
  TaskClaim,
  TaskContract,
  TaskContractInput,
  TaskCredential,
  TaskEvidence,
  TaskResolution,
  TaskView,
  TaskWriterDelegation,
  TaskQuery,
  TaskPage,
  TaskPlanItem,
} from "./types.js";
import { taskSimilarity } from "./recognition.js";
import { TASK_DELEGATION_DISPATCH_TOOLS } from './types.js';
import { retainTaskArtifact, readRetainedTaskArtifact, type TaskArtifactReference, type TaskArtifactRetentionReceipt } from './artifact-retention.js';

const MAX_CONTEXT = 12_000;
const MAX_CHECKPOINT = 24_000;
const LEASE_MS = 120_000;
function withinPath(root: string, pathname: string): boolean {
  const offset = relative(root, process.platform === 'win32' ? pathname.toLowerCase() : pathname);
  return offset === '' || (offset !== '..' && !offset.startsWith(`..${sep}`) && !isAbsolute(offset));
}
type Row = { json: string };
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const text = (value: unknown, name: string, max = 2_000): string => {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new Error(`TASK_INVALID_${name}`);
  return value.trim();
};
const strings = (value: unknown, name: string): string[] => {
  if (!Array.isArray(value) || value.length > 30) throw new Error(`TASK_INVALID_${name}`);
  return value.map((entry) => text(entry, name, 500));
};

export function normalizeTaskContract(input: TaskContractInput): TaskContractInput {
  if (
    !input ||
    !Array.isArray(input.acceptance) ||
    input.acceptance.length < 1 ||
    input.acceptance.length > 20
  )
    throw new Error("TASK_ACCEPTANCE_REQUIRED");
  const acceptance = input.acceptance.map((c) => {
    const verification = c.verification;
    if (
      !verification ||
      !["file-sha256", "owner-receipt", "tool-result"].includes(verification.kind)
    )
      throw new Error("TASK_VERIFICATION_REQUIRED");
    if (
      verification.kind === "file-sha256" &&
      (!verification.path || !/^[a-f0-9]{64}$/.test(verification.sha256))
    )
      throw new Error("TASK_INVALID_FILE_CRITERION");
    if (verification.kind === "owner-receipt") {
      text(verification.owner, "VERIFICATION_OWNER", 200);
      if (verification.requires !== undefined)
        strings(verification.requires, "VERIFIER_REQUIREMENTS");
      if (verification.files !== undefined) strings(verification.files, "VERIFIER_FILES");
    }
    if (verification.kind === "tool-result") {
      if (verification.tool !== "exec" || !Number.isInteger(verification.exitCode))
        throw new Error("TASK_INVALID_TOOL_CRITERION");
      text(verification.command, "VERIFICATION_COMMAND", 2000);
      if (strings(verification.files, "VERIFICATION_INPUTS").length === 0)
        throw new Error("TASK_VERIFICATION_INPUTS_REQUIRED");
    }
    return {
      id: text(c.id, "CRITERION_ID", 80),
      description: text(c.description, "CRITERION", 500),
      verification,
    };
  });
  if (new Set(acceptance.map((c) => c.id)).size !== acceptance.length)
    throw new Error("TASK_DUPLICATE_CRITERION");
  const result = {
    objective: text(input.objective, "OBJECTIVE", 3_000),
    constraints: strings(input.constraints, "CONSTRAINT"),
    acceptance,
    target: text(input.target, "TARGET", 1_000),
    dependencies: [...new Set(strings(input.dependencies ?? [], "DEPENDENCY"))].sort(),
    ...(input.expectedOutcomes
      ? { expectedOutcomes: strings(input.expectedOutcomes, "OUTCOME") }
      : {}),
    ...(input.businessKey ? { businessKey: text(input.businessKey, "BUSINESS_KEY", 200) } : {}),
    ...(input.occurrenceKey
      ? { occurrenceKey: text(input.occurrenceKey, "OCCURRENCE_KEY", 200) }
      : {}),
  };
  if (JSON.stringify(result).length > MAX_CONTEXT - 2_000)
    throw new Error("TASK_GOAL_BUDGET_EXCEEDED");
  return result;
}

/** Durable execution contract extension of the product Task Ledger owner. */
export class TaskSystemStore {
  readonly db: DatabaseSync;
  private transactionDepth = 0;
  constructor(
    readonly domain: TaskDomain,
    readonly now: () => number = Date.now,
    private readonly access?: TaskAuthorityAccess,
  ) {
    if (
      access &&
      (access.domain.id !== domain.id ||
        access.domain.root !== domain.root ||
        access.domain.database !== domain.database ||
        access.domain.worktree !== domain.worktree)
    )
      throw new Error("TASK_AUTHORITY_DOMAIN_MISMATCH");
    const initialize = () => {
      this.assertAuthorityCurrent();
      mkdirSync(dirname(domain.database), { recursive: true });
      const db = new DatabaseSync(domain.database);
      try {
        db.exec("PRAGMA busy_timeout=3000; PRAGMA foreign_keys=ON;");
        const version = Number(
          (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version,
        );
        if (version > 6) {
          db.close();
          throw new Error("TASK_SCHEMA_NEWER_THAN_CLIENT");
        }
        db.exec("PRAGMA synchronous=FULL;");
        if (version === 6) return db;
        db.exec("PRAGMA journal_mode=WAL; BEGIN IMMEDIATE;");
        db.exec(`
        CREATE TABLE IF NOT EXISTS task_contracts(id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, business_key TEXT, state TEXT NOT NULL, revision INTEGER NOT NULL, json TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS task_fingerprint ON task_contracts(fingerprint,state);
        CREATE UNIQUE INDEX IF NOT EXISTS task_business_key ON task_contracts(business_key) WHERE business_key IS NOT NULL;
        CREATE TABLE IF NOT EXISTS task_claims(task_id TEXT PRIMARY KEY REFERENCES task_contracts(id), session_key TEXT NOT NULL, generation TEXT NOT NULL, epoch INTEGER NOT NULL, state TEXT NOT NULL, json TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS task_bindings(session_key TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES task_contracts(id), generation TEXT NOT NULL, epoch INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS task_requests(id TEXT PRIMARY KEY, hash TEXT NOT NULL, result TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS task_checkpoints(task_id TEXT PRIMARY KEY REFERENCES task_contracts(id), json TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS task_operations(id TEXT PRIMARY KEY, task_id TEXT NOT NULL, epoch INTEGER NOT NULL, kind TEXT NOT NULL, state TEXT NOT NULL, result TEXT);
        CREATE INDEX IF NOT EXISTS task_operations_pending ON task_operations(task_id,state);
        CREATE TABLE IF NOT EXISTS task_evidence(id TEXT PRIMARY KEY, task_id TEXT NOT NULL, json TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS task_events(seq INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL, kind TEXT NOT NULL, at INTEGER NOT NULL, json TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS task_submissions(task_id TEXT PRIMARY KEY, candidate TEXT NOT NULL, revision INTEGER NOT NULL, epoch INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS task_operation_owners(id TEXT PRIMARY KEY, pid INTEGER NOT NULL, started_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS task_active_runs(task_id TEXT PRIMARY KEY, epoch INTEGER NOT NULL, run_id TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS task_delegations(task_id TEXT NOT NULL,epoch INTEGER NOT NULL,request_id TEXT NOT NULL,PRIMARY KEY(task_id,epoch));
        CREATE TABLE IF NOT EXISTS task_operation_handles(id TEXT PRIMARY KEY,handle TEXT NOT NULL,json TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS task_references(session_key TEXT PRIMARY KEY,task_id TEXT NOT NULL,generation TEXT NOT NULL,role TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS task_writer_delegations(id TEXT PRIMARY KEY,task_id TEXT NOT NULL,child_session TEXT NOT NULL UNIQUE,json TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS task_plan_children(parent_id TEXT NOT NULL REFERENCES task_contracts(id),child_id TEXT NOT NULL UNIQUE REFERENCES task_contracts(id),ordinal INTEGER NOT NULL,PRIMARY KEY(parent_id,child_id));
        CREATE INDEX IF NOT EXISTS task_event_page ON task_events(task_id,seq);
        CREATE TABLE IF NOT EXISTS task_event_consumers(id TEXT PRIMARY KEY,sequence INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS task_claim_session ON task_claims(session_key,generation);
        PRAGMA user_version=6;
        COMMIT;
      `);
      } catch (error) {
        try {
          db.close();
        } catch {
          /* Preserve the original initialization failure. */
        }
        throw error;
      }
      return db;
    };
    this.db = access?.withWriteBarrier ? access.withWriteBarrier(initialize) : initialize();
  }
  private assertAuthorityCurrent(): void {
    this.access?.assertCurrent();
  }
  private assertReadCurrent(): void {
    if (this.transactionDepth === 0) this.assertAuthorityCurrent();
  }
  private relatedDomain(workspaceRoot: string): TaskDomain {
    return this.access
      ? this.access.resolveRelated(workspaceRoot)
      : resolveTaskDomain(workspaceRoot);
  }
  close() {
    this.db.close();
  }
  private transaction<T>(fn: () => T): T {
    return this.transactionDepth === 0 && this.access?.withWriteBarrier
      ? this.access.withWriteBarrier(() => this.transactionBody(fn))
      : this.transactionBody(fn);
  }
  private transactionBody<T>(fn: () => T): T {
    this.assertAuthorityCurrent();
    const depth = this.transactionDepth++;
    const name = `task_nested_${depth}`;
    try {
      this.db.exec(depth === 0 ? "BEGIN IMMEDIATE" : `SAVEPOINT ${name}`);
      this.assertAuthorityCurrent();
      const result = fn();
      this.db.exec(depth === 0 ? "COMMIT" : `RELEASE SAVEPOINT ${name}`);
      return result;
    } catch (error) {
      if (depth === 0) {
        if (this.db.isTransaction) this.db.exec("ROLLBACK");
      } else this.db.exec(`ROLLBACK TO SAVEPOINT ${name}; RELEASE SAVEPOINT ${name};`);
      throw error;
    } finally {
      this.transactionDepth--;
    }
  }
  private event(taskNodeId: string, kind: string, value: unknown) {
    this.db
      .prepare("INSERT INTO task_events(task_id,kind,at,json) VALUES(?,?,?,?)")
      .run(taskNodeId, kind, this.now(), JSON.stringify(value));
  }
  private read<T>(sql: string, ...params: Array<string | number>): T | null {
    const row = this.db.prepare(sql).get(...params) as Row | undefined;
    return row ? (JSON.parse(row.json) as T) : null;
  }
  private saveContract(contract: TaskContract) {
    this.db
      .prepare("UPDATE task_contracts SET revision=?,state=?,json=? WHERE id=?")
      .run(contract.revision, contract.state, JSON.stringify(contract), contract.taskNodeId);
  }
  private saveClaim(claim: TaskClaim) {
    this.db
      .prepare(
        `INSERT INTO task_claims VALUES(?,?,?,?,?,?) ON CONFLICT(task_id) DO UPDATE SET session_key=excluded.session_key,generation=excluded.generation,epoch=excluded.epoch,state=excluded.state,json=excluded.json`,
      )
      .run(
        claim.taskNodeId,
        claim.sessionKey,
        claim.generation,
        claim.epoch,
        claim.state,
        JSON.stringify(claim),
      );
  }
  get(taskNodeId: string): TaskView {
    this.assertReadCurrent();
    return this.view(taskNodeId);
  }
  private view(taskNodeId: string): TaskView {
    const contract = this.read<TaskContract>(
      "SELECT json FROM task_contracts WHERE id=?",
      taskNodeId,
    );
    if (!contract) throw new Error("TASK_NOT_FOUND");
    const claim = this.read<TaskClaim>("SELECT json FROM task_claims WHERE task_id=?", taskNodeId);
    if (
      claim?.state === "active" &&
      (claim.expiresAt <= this.now() || this.now() < claim.expiresAt - LEASE_MS * 2)
    )
      claim.state = "recovery_required";
    const pending = this.db
      .prepare(
        "SELECT count(*) AS n FROM task_operations WHERE task_id=? AND state IN ('started','unknown')",
      )
      .get(taskNodeId) as { n: number };
    return {
      contract,
      claim,
      checkpoint: this.read<TaskCheckpoint>(
        "SELECT json FROM task_checkpoints WHERE task_id=?",
        taskNodeId,
      ),
      pendingOperations: Number(pending.n),
      pendingOperationDetails:(this.db.prepare("SELECT o.id AS operationId,o.kind AS tool,o.state,p.started_at AS startedAt FROM task_operations o JOIN task_operation_owners p ON p.id=o.id WHERE o.task_id=? AND o.state IN ('started','unknown') ORDER BY p.started_at LIMIT 20").all(taskNodeId) as Array<{operationId:string;tool:string;state:string;startedAt:number}>),
      parentTaskNodeId: (
        this.db
          .prepare("SELECT parent_id FROM task_plan_children WHERE child_id=?")
          .get(taskNodeId) as { parent_id: string } | undefined
      )?.parent_id,
      childTaskNodeIds: (
        this.db
          .prepare("SELECT child_id FROM task_plan_children WHERE parent_id=? ORDER BY ordinal")
          .all(taskNodeId) as Array<{ child_id: string }>
      ).map((row) => row.child_id),
    };
  }
  has(taskNodeId: string): boolean {
    this.assertReadCurrent();
    return Boolean(this.db.prepare("SELECT 1 FROM task_contracts WHERE id=?").get(taskNodeId));
  }
  list(limit = 100): TaskView[] {
    this.assertReadCurrent();
    const rows = this.db
      .prepare("SELECT id FROM task_contracts ORDER BY rowid DESC LIMIT ?")
      .all(Math.max(1, Math.min(500, limit))) as Array<{ id: string }>;
    return rows.map((row) => this.view(row.id));
  }
  page(query: TaskQuery = {}): TaskPage {
    this.assertReadCurrent();
    const limit = Math.max(1, Math.min(100, Number.isSafeInteger(query.limit) ? query.limit! : 50));
    const filter = {
      query: query.query?.trim().slice(0, 500) ?? "",
      state: query.state ?? "",
      sessionKey: query.sessionKey ?? "",
    };
    const fingerprint = digest(filter);
    let before = Number.MAX_SAFE_INTEGER;
    let upper = Number(
      (
        this.db.prepare("SELECT coalesce(max(rowid),0) AS n FROM task_contracts").get() as {
          n: number;
        }
      ).n,
    );
    if (query.cursor) {
      if (query.cursor.length > 2048) throw new Error("TASK_CURSOR_INVALID");
      let c: { domain: string; filter: string; before: number; upper: number };
      try {
        c = JSON.parse(Buffer.from(query.cursor, "base64url").toString("utf8"));
      } catch {
        throw new Error("TASK_CURSOR_INVALID");
      }
      if (
        c.domain !== this.domain.id ||
        c.filter !== fingerprint ||
        ![c.before, c.upper].every((n) => Number.isSafeInteger(n) && n >= 0)
      )
        throw new Error("TASK_CURSOR_SCOPE_MISMATCH");
      before = c.before;
      upper = c.upper;
    }
    const rows = this.db
      .prepare(`SELECT t.id,t.rowid AS sequence FROM task_contracts t LEFT JOIN task_claims c ON c.task_id=t.id
      WHERE t.rowid<=? AND t.rowid<? AND (?='' OR t.state=?) AND (?='' OR c.session_key=?)
      AND (?='' OR instr(lower(json_extract(t.json,'$.objective')),lower(?))>0 OR instr(lower(json_extract(t.json,'$.target')),lower(?))>0)
      ORDER BY t.rowid DESC LIMIT ?`)
      .all(
        upper,
        before,
        filter.state,
        filter.state,
        filter.sessionKey,
        filter.sessionKey,
        filter.query,
        filter.query,
        filter.query,
        limit + 1,
      ) as Array<{ id: string; sequence: number }>;
    const selected = rows.slice(0, limit);
    return {
      tasks: selected.map((r) => this.view(r.id)),
      ...(rows.length > limit
        ? {
            nextCursor: Buffer.from(
              JSON.stringify({
                domain: this.domain.id,
                filter: fingerprint,
                before: selected.at(-1)!.sequence,
                upper,
              }),
            ).toString("base64url"),
          }
        : {}),
    };
  }
  suggest(
    query: string,
    target?: string,
    limit = 5,
  ): Array<{
    task: TaskView;
    score: number;
    reason: "similar-objective" | "same-target";
    automaticIdentity: false;
  }> {
    this.assertReadCurrent();
    text(query, "QUERY", 3000);
    // ponytail: bound suggestions to 500 active tasks; use FTS when larger active queues need recall.
    const candidates = this.db
      .prepare(
        "SELECT id,json FROM task_contracts WHERE state NOT IN ('done','cancelled') ORDER BY rowid DESC LIMIT 500",
      )
      .all() as Array<Row & { id: string }>;
    return candidates
      .map((row) => {
        const c = JSON.parse(row.json) as TaskContract;
        const same = Boolean(target && target === c.target);
        return {
          id: row.id,
          score: taskSimilarity(query, c.objective) + (same ? 0.15 : 0),
          reason: same ? ("same-target" as const) : ("similar-objective" as const),
        };
      })
      .filter((x) => x.score >= 0.2)
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
      .slice(0, Math.max(1, Math.min(20, limit)))
      .map((x) => ({
        task: this.view(x.id),
        score: x.score,
        reason: x.reason,
        automaticIdentity: false,
      }));
  }
  decompose(credential: TaskCredential, items: TaskPlanItem[], requestId: string): TaskView[] {
    if (!Array.isArray(items) || !items.length || items.length > 30)
      throw new Error("TASK_PLAN_SIZE_INVALID");
    const keys = items.map((i) => text(i.key, "PLAN_KEY", 80));
    if (new Set(keys).size !== keys.length) throw new Error("TASK_PLAN_DUPLICATE_KEY");
    return this.transaction(() =>
      this.request(`plan:${requestId}`, { credential, items }, () => {
        const parent = this.assertOwner(credential);
        if (parent.pendingOperations || parent.childTaskNodeIds?.length)
          throw new Error("TASK_PLAN_NOT_EDITABLE");
        const ids = new Map<string, string>();
        for (const [ordinal, item] of items.entries()) {
          const child = this.create(
            {
              ...item.contract,
              constraints: [
                ...new Set([...parent.contract.constraints, ...item.contract.constraints]),
              ],
              businessKey: `parent:${credential.taskNodeId}:${keys[ordinal]}`,
            },
            `${requestId}:${keys[ordinal]}`,
            undefined,
            { source: "task-decomposition", sessionKey: credential.sessionKey },
          ).task;
          ids.set(keys[ordinal], child.contract.taskNodeId);
          this.db
            .prepare("INSERT INTO task_plan_children VALUES(?,?,?)")
            .run(credential.taskNodeId, child.contract.taskNodeId, ordinal);
        }
        for (const [ordinal, item] of items.entries()) {
          const deps = (item.dependsOn ?? []).map((key) => {
            const id = ids.get(key);
            if (!id) throw new Error("TASK_PLAN_DEPENDENCY_MISSING");
            return id;
          });
          const id = ids.get(keys[ordinal])!,
            child = this.get(id).contract;
          this.revise(id, child.revision, {
            ...child,
            dependencies: [...new Set([...(child.dependencies ?? []), ...deps])],
          });
        }
        this.saveClaim({ ...parent.claim!, epoch: parent.claim!.epoch + 1, state: "released" });
        this.db.prepare("DELETE FROM task_bindings WHERE task_id=?").run(credential.taskNodeId);
        this.db
          .prepare("INSERT OR REPLACE INTO task_references VALUES(?,?,?,?)")
          .run(credential.sessionKey, credential.taskNodeId, credential.generation, "coordinator");
        this.saveContract({ ...parent.contract, state: "ready", updatedAt: this.now() });
        this.event(credential.taskNodeId, "decomposed", { children: [...ids.values()] });
        return [...ids.values()].map((id) => this.get(id));
      }),
    );
  }
  history(
    taskNodeId: string,
    afterSequence = 0,
    limit = 100,
  ): Array<{ seq: number; kind: string; at: number; json: string }> {
    this.assertReadCurrent();
    return this.db
      .prepare(
        "SELECT seq,kind,at,json FROM task_events WHERE task_id=? AND seq>? ORDER BY seq LIMIT ?",
      )
      .all(taskNodeId, Math.max(0, afterSequence), Math.min(500, Math.max(1, limit))) as Array<{
      seq: number;
      kind: string;
      at: number;
      json: string;
    }>;
  }
  changes(
    consumer: string,
    limit = 100,
  ): {
    sequence: number;
    events: Array<{
      sequence: number;
      taskNodeId: string;
      kind: string;
      at: number;
      payload: unknown;
    }>;
  } {
    this.assertReadCurrent();
    text(consumer, "CONSUMER", 200);
    const sequence =
      (
        this.db.prepare("SELECT sequence FROM task_event_consumers WHERE id=?").get(consumer) as
          | { sequence: number }
          | undefined
      )?.sequence ?? 0;
    const rows = this.db
      .prepare("SELECT seq,task_id,kind,at,json FROM task_events WHERE seq>? ORDER BY seq LIMIT ?")
      .all(sequence, Math.max(1, Math.min(500, limit))) as Array<{
      seq: number;
      task_id: string;
      kind: string;
      at: number;
      json: string;
    }>;
    return {
      sequence,
      events: rows.map((row) => ({
        sequence: row.seq,
        taskNodeId: row.task_id,
        kind: row.kind,
        at: row.at,
        payload: JSON.parse(row.json),
      })),
    };
  }
  acknowledge(consumer: string, expectedSequence: number, throughSequence: number): void {
    text(consumer, "CONSUMER", 200);
    if (
      ![expectedSequence, throughSequence].every((n) => Number.isSafeInteger(n) && n >= 0) ||
      throughSequence < expectedSequence
    )
      throw new Error("TASK_EVENT_SEQUENCE_INVALID");
    this.transaction(() => {
      const current =
        (
          this.db.prepare("SELECT sequence FROM task_event_consumers WHERE id=?").get(consumer) as
            | { sequence: number }
            | undefined
        )?.sequence ?? 0;
      if (current === throughSequence) return;
      if (current !== expectedSequence) throw new Error("TASK_EVENT_SEQUENCE_CONFLICT");
      if (
        throughSequence > 0 &&
        !this.db.prepare("SELECT 1 FROM task_events WHERE seq=?").get(throughSequence)
      )
        throw new Error("TASK_EVENT_SEQUENCE_MISSING");
      this.db
        .prepare("INSERT OR REPLACE INTO task_event_consumers VALUES(?,?)")
        .run(consumer, throughSequence);
    });
  }
  private request<T>(id: string, payload: unknown, fn: () => T): T {
    text(id, "REQUEST_ID", 300);
    const hash = digest(payload);
    const old = this.db.prepare("SELECT hash,result FROM task_requests WHERE id=?").get(id) as
      | { hash: string; result: string }
      | undefined;
    if (old) {
      if (old.hash !== hash) throw new Error("TASK_IDEMPOTENCY_CONFLICT");
      return JSON.parse(old.result) as T;
    }
    const result = fn();
    this.db
      .prepare("INSERT INTO task_requests VALUES(?,?,?)")
      .run(id, hash, JSON.stringify(result));
    return result;
  }
  private checkDependencies(taskId: string, dependencies: string[], mustBeDone: boolean) {
    const visit = (id: string, seen: Set<string>) => {
      if (id === taskId || seen.has(id)) throw new Error("TASK_DEPENDENCY_CYCLE");
      const task = this.get(id).contract;
      const children = (
        this.db
          .prepare("SELECT child_id FROM task_plan_children WHERE parent_id=?")
          .all(id) as Array<{ child_id: string }>
      ).map((row) => row.child_id);
      for (const dep of [...(task.dependencies ?? []), ...children])
        visit(dep, new Set([...seen, id]));
    };
    for (const id of dependencies) {
      visit(id, new Set());
      if (mustBeDone && this.get(id).contract.state !== "done")
        throw new Error("TASK_DEPENDENCY_UNSATISFIED");
    }
  }
  create(
    input: TaskContractInput,
    requestId: string,
    existingNodeId?: string,
    origin: { source: string; sessionKey?: string } = { source: "task-ledger-core" },
  ): TaskResolution {
    const normalized = normalizeTaskContract(input);
    return this.transaction(() =>
      this.request(`create:${requestId}`, { normalized, existingNodeId }, () => {
        const fingerprint = digest(normalized);
        const key = normalized.businessKey
          ? JSON.stringify([normalized.businessKey, normalized.occurrenceKey ?? ""])
          : null;
        const row = (
          key
            ? this.db.prepare("SELECT id FROM task_contracts WHERE business_key=?").get(key)
            : this.db
                .prepare(
                  "SELECT id FROM task_contracts WHERE fingerprint=? AND state NOT IN ('done','cancelled') LIMIT 1",
                )
                .get(fingerprint)
        ) as { id: string } | undefined;
        if (row) {
          const existing = this.get(row.id);
          if (existingNodeId && existingNodeId !== row.id)
            throw new Error("TASK_ADOPTION_DUPLICATE_REQUIRES_LINK");
          if (key && existing.contract.digest !== fingerprint)
            throw new Error("TASK_BUSINESS_KEY_CONTRACT_CONFLICT");
          return { kind: "duplicate", task: existing };
        }
        const taskNodeId = (
          existingNodeId ? text(existingNodeId, "NODE_ID", 200) : randomUUID()
        ) as TaskId;
        this.checkDependencies(taskNodeId, normalized.dependencies ?? [], false);
        const at = this.now();
        const contract: TaskContract = {
          ...normalized,
          origin: { ...origin, requestId },
          taskNodeId,
          domain: this.domain.id,
          revision: 1,
          digest: fingerprint,
          state: "ready",
          createdAt: at,
          updatedAt: at,
        };
        this.db
          .prepare("INSERT INTO task_contracts VALUES(?,?,?,?,?,?)")
          .run(taskNodeId, fingerprint, key, contract.state, 1, JSON.stringify(contract));
        this.event(taskNodeId, "created", contract);
        return { kind: "created", task: this.get(taskNodeId) };
      }),
    );
  }
  revise(taskNodeId: string, expectedRevision: number, input: TaskContractInput): TaskView {
    const normalized = normalizeTaskContract(input);
    return this.transaction(() => {
      const view = this.get(taskNodeId);
      if (view.contract.revision !== expectedRevision) throw new Error("TASK_REVISION_CONFLICT");
      if (["done", "cancelled"].includes(view.contract.state)) throw new Error("TASK_TERMINAL");
      if (view.pendingOperations) throw new Error("TASK_OPERATIONS_PENDING");
      if (view.childTaskNodeIds?.some((id) => !["done", "cancelled"].includes(this.get(id).contract.state)))
        throw new Error("TASK_PLAN_CHILDREN_ACTIVE");
      if (view.parentTaskNodeId) {
        const inherited = this.get(view.parentTaskNodeId).contract.constraints;
        if (inherited.some((constraint) => !normalized.constraints.includes(constraint)))
          throw new Error("TASK_PARENT_CONSTRAINT_REQUIRED");
      }
      this.checkDependencies(taskNodeId, normalized.dependencies ?? [], false);
      if (view.childTaskNodeIds?.length) {
        this.event(taskNodeId, "plan_retired", { children: view.childTaskNodeIds });
        this.db.prepare("DELETE FROM task_plan_children WHERE parent_id=?").run(taskNodeId);
      }
      const updated: TaskContract = {
        ...view.contract,
        ...normalized,
        revision: expectedRevision + 1,
        digest: digest(normalized),
        state: "ready",
        updatedAt: this.now(),
      };
      this.db
        .prepare("UPDATE task_contracts SET fingerprint=?,business_key=? WHERE id=?")
        .run(
          updated.digest,
          normalized.businessKey
            ? JSON.stringify([normalized.businessKey, normalized.occurrenceKey ?? ""])
            : null,
          taskNodeId,
        );
      this.saveContract(updated);
      if (view.claim)
        this.saveClaim({ ...view.claim, epoch: view.claim.epoch + 1, state: "released" });
      this.db.prepare("DELETE FROM task_bindings WHERE task_id=?").run(taskNodeId);
      this.event(taskNodeId, "revised", updated);
      return this.get(taskNodeId);
    });
  }
  claim(taskNodeId: string, sessionKey: string, generation: string, requestId: string, expected?: TaskCredential): TaskView {
    text(sessionKey, "SESSION", 300);
    text(generation, "GENERATION", 200);
    return this.transaction(() => {
      if (expected) {
        if (expected.taskNodeId !== taskNodeId) throw new Error("TASK_RESTART_RUN_AFTER_HANDOFF");
        this.assertOwner(expected);
      }
      return this.request(
        `claim:${requestId}`,
        { taskNodeId, sessionKey, generation, worktree: this.domain.worktree },
        () => {
          const view = this.get(taskNodeId);
          if (!["ready", "doing"].includes(view.contract.state))
            throw new Error("TASK_NOT_CLAIMABLE");
          if (view.claim && view.claim.state !== "released") {
            if (
              view.claim.sessionKey === sessionKey &&
              view.claim.generation === generation &&
              view.claim.state === "active" &&
              view.claim.worktree === this.domain.worktree
            )
              return view;
            throw new Error(`TASK_ALREADY_CLAIMED:${view.claim.sessionKey}`);
          }
          const binding = this.db
            .prepare("SELECT task_id FROM task_bindings WHERE session_key=?")
            .get(sessionKey) as { task_id: string } | undefined;
          if (binding && binding.task_id !== taskNodeId)
            throw new Error("TASK_SESSION_ALREADY_BOUND");
          this.checkDependencies(taskNodeId, view.contract.dependencies ?? [], true);
          this.checkDependencies(taskNodeId, view.childTaskNodeIds ?? [], true);
          const claim: TaskClaim = {
            taskNodeId: view.contract.taskNodeId,
            sessionKey: sessionKey as SessionKey,
            generation,
            epoch: (view.claim?.epoch ?? 0) + 1,
            attemptId: randomUUID(),
            worktree: this.domain.worktree,
            contractRevision: view.contract.revision,
            expiresAt: this.now() + LEASE_MS,
            state: "active",
          };
          this.saveClaim(claim);
          this.db
            .prepare("DELETE FROM task_references WHERE session_key=? AND task_id=?")
            .run(sessionKey, taskNodeId);
          this.db
            .prepare("INSERT OR REPLACE INTO task_bindings VALUES(?,?,?,?)")
            .run(sessionKey, taskNodeId, generation, claim.epoch);
          this.saveContract({ ...view.contract, state: "doing", updatedAt: this.now() });
          this.event(taskNodeId, "claimed", claim);
          return this.get(taskNodeId);
        },
      );
    });
  }
  start(input: {taskNodeId?: string; contract?: TaskContractInput; expectedContract?: Pick<TaskContract, "revision" | "digest">}, sessionKey: string, generation: string, requestId: string, expected?: TaskCredential): TaskView {
    if (Boolean(input.taskNodeId) === Boolean(input.contract)) throw new Error("TASK_START_ONE_TARGET_REQUIRED");
    return this.transaction(() => {
      const resolved = input.taskNodeId ?? this.create(input.contract!, `${requestId}:create`, undefined, {source:"runtime-task-tool",sessionKey}).task.contract.taskNodeId;
      if (input.expectedContract) {
        const current = this.get(resolved).contract;
        if (current.revision !== input.expectedContract.revision || current.digest !== input.expectedContract.digest)
          throw new Error("TASK_CONTRACT_STALE");
      }
      return this.claim(resolved,sessionKey,generation,`${requestId}:claim`,expected);
    });
  }
  sessionSnapshot(sessionKey: string, generation: string) {
    let task = this.binding(sessionKey,generation);
    if (!task) {
      const recent=this.db.prepare("SELECT c.task_id FROM task_claims c JOIN task_contracts t ON t.id=c.task_id WHERE c.session_key=? AND c.generation=? ORDER BY json_extract(t.json,'$.updatedAt') DESC,c.rowid DESC LIMIT 1").get(sessionKey,generation) as {task_id:string}|undefined;
      if (recent) task=this.view(recent.task_id);
    }
    return {task,children:(task?.childTaskNodeIds??[]).map(id=>this.view(id))};
  }
  assertOwner(credential: TaskCredential, allowPaused = false): TaskView {
    const view = this.get(credential.taskNodeId);
    const c = view.claim;
    if (
      !c ||
      c.epoch !== credential.epoch ||
      c.sessionKey !== credential.sessionKey ||
      c.generation !== credential.generation ||
      c.contractRevision !== view.contract.revision ||
      c.worktree !== this.domain.worktree
    )
      throw new Error("TASK_STALE_OWNER");
    if (
      !(c.state === "active" || (allowPaused && ["paused", "recovery_required"].includes(c.state)))
    )
      throw new Error("TASK_OWNER_NOT_ACTIVE");
    if (["done", "cancelled"].includes(view.contract.state)) throw new Error("TASK_TERMINAL");
    return view;
  }
  binding(sessionKey: string, generation?: string): TaskView | null {
    this.assertReadCurrent();
    const writer = this.db
      .prepare("SELECT task_id,generation FROM task_bindings WHERE session_key=?")
      .get(sessionKey) as { task_id: string; generation: string } | undefined;
    const row =
      writer ??
      (this.db
        .prepare("SELECT task_id,generation FROM task_references WHERE session_key=?")
        .get(sessionKey) as { task_id: string; generation: string } | undefined);
    if (!row) return null;
    if (generation && row.generation !== generation) throw new Error("TASK_GENERATION_STALE");
    return { ...this.view(row.task_id), ...(!writer ? { referenceOnly: true } : {}) };
  }
  inheritReference(sourceSessionKey: string, sourceGeneration: string, sessionKey: string, generation: string): TaskView | null {
    text(sessionKey, "SESSION", 300); text(generation, "GENERATION", 200);
    if (sourceSessionKey === sessionKey) throw new Error("TASK_REFERENCE_SELF");
    return this.transaction(() => {
      const source = this.binding(sourceSessionKey, sourceGeneration);
      if (!source || ["done", "cancelled"].includes(source.contract.state)) return null;
      const existing = this.binding(sessionKey, generation);
      if (existing) {
        if (!existing.referenceOnly || existing.contract.taskNodeId !== source.contract.taskNodeId) throw new Error("TASK_REFERENCE_CONFLICT");
        return existing;
      }
      this.db.prepare("INSERT INTO task_references VALUES(?,?,?,?)").run(sessionKey, source.contract.taskNodeId, generation, "observer");
      this.event(source.contract.taskNodeId,"reference_inherited",{sourceSessionKey,sourceGeneration,sessionKey,generation});
      return this.binding(sessionKey,generation);
    });
  }
  isSelectedReference(sessionKey: string, generation: string): boolean {
    this.assertReadCurrent();
    return Boolean(this.db.prepare("SELECT 1 FROM task_references WHERE session_key=? AND generation=? AND role='selected'").get(sessionKey, generation));
  }
  selectReference(taskNodeId: string, sessionKey: string, generation: string, requestId: string): TaskView {
    text(sessionKey, "SESSION", 300); text(generation, "GENERATION", 200);
    this.transaction(() => this.request(`select:${requestId}`, {taskNodeId,sessionKey,generation}, () => {
      this.get(taskNodeId);
      const current = this.binding(sessionKey, generation);
      if (current?.contract.taskNodeId === taskNodeId && (!current.referenceOnly || this.isSelectedReference(sessionKey, generation))) return current;
      if (current?.claim && !current.referenceOnly) {
        if (this.db.prepare("SELECT 1 FROM task_active_runs WHERE task_id=? AND epoch=?").get(current.claim.taskNodeId, current.claim.epoch))
          throw new Error("TASK_RUN_ALREADY_ACTIVE");
        this.control(current.claim, "release");
      }
      this.db.prepare("INSERT OR REPLACE INTO task_references VALUES(?,?,?,?)").run(sessionKey, taskNodeId, generation, "selected");
      this.event(taskNodeId, "selected", {sessionKey,generation});
      return this.binding(sessionKey, generation)!;
    }));
    return this.binding(sessionKey, generation)!;
  }
  private saveWriterDelegation(delegation: TaskWriterDelegation): void {
    this.db
      .prepare(
        "INSERT INTO task_writer_delegations VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json",
      )
      .run(
        delegation.delegationId,
        delegation.taskNodeId,
        delegation.child.sessionKey,
        JSON.stringify(delegation),
      );
  }
  worktreeTaskReferences(worktree: string): string[] {
    return [...new Set([...this.worktreeLiveTaskReferences(worktree), ...this.worktreeArtifactReferences(worktree).map(ref => ref.taskNodeId)])];
  }
  recordedExecutionWorktrees(): string[] {
    this.assertReadCurrent();
    const roots = (this.db.prepare('SELECT json FROM task_claims')
      .all() as Row[]).map(row => (JSON.parse(row.json) as TaskClaim).worktree);
    for (const row of this.db.prepare('SELECT json FROM task_writer_delegations').all() as Row[]) {
      const value = JSON.parse(row.json) as TaskWriterDelegation;
      roots.push(value.parentWorktree, value.childWorktree);
    }
    for (const row of this.db.prepare("SELECT json FROM task_events WHERE kind IN ('claimed','handoff','checkpoint')").all() as Row[]) {
      const value = JSON.parse(row.json) as { worktree?: string };
      if (value.worktree) roots.push(value.worktree);
    }
    return [...new Set(roots)];
  }
  private worktreeLiveTaskReferences(worktree: string): string[] {
    this.assertReadCurrent();
    const root = canonicalPath(worktree);
    const rows = this.db
      .prepare(
        "SELECT c.id,cl.json AS claim FROM task_contracts c LEFT JOIN task_claims cl ON cl.task_id=c.id WHERE c.state NOT IN ('done','cancelled') OR cl.state != 'released' OR EXISTS (SELECT 1 FROM task_operations o WHERE o.task_id=c.id AND o.state IN ('started','unknown'))",
      )
      .all() as Array<{ id: string; claim: string | null }>;
    const ids = new Set(
      rows
        .filter((row) => row.claim && (JSON.parse(row.claim) as TaskClaim).worktree === root)
        .map((row) => row.id),
    );
    for (const row of this.db
      .prepare(
        "SELECT d.json,c.state FROM task_writer_delegations d JOIN task_contracts c ON c.id=d.task_id",
      )
      .all() as Array<Row & { state: string }>) {
      const d = JSON.parse(row.json) as TaskWriterDelegation;
      if ((d.phase !== 'returned' || !['done', 'cancelled'].includes(row.state)) && (d.childWorktree === root || d.parentWorktree === root)) ids.add(d.taskNodeId);
    }
    return [...ids];
  }
  /** Historical references are resolved against their recorded writer, never the current claim. */
  worktreeArtifactReferences(worktree: string): TaskArtifactReference[] {
    this.assertReadCurrent();
    const root = canonicalPath(worktree), references = new Map<string, TaskArtifactReference>();
    const writers = new Map<string, string>(), checkpoints = new Set<string>(), evidenceEvents = new Set<string>();
    type Artifact = { path: string; sha256: string };
    const retain = (taskNodeId: string, kind: TaskArtifactReference['kind'], key: string, artifacts: Artifact[] | undefined, origin?: string) => {
      for (const [index, artifact] of (artifacts ?? []).entries()) {
        if (!isAbsolute(artifact.path) && !origin) throw new Error('TASK_ARTIFACT_ORIGIN_UNKNOWN');
        const full = resolve(origin ?? root, artifact.path);
        if (!withinPath(root, full) && !(existsSync(full) && withinPath(root, canonicalPath(full)))) continue;
        if (!/^[a-f0-9]{64}$/.test(artifact.sha256)) throw new Error('TASK_INVALID_ARTIFACTS');
        const sourceKey = `${key}:${index}`;
        references.set(`${taskNodeId}:${sourceKey}`, { taskNodeId, sourceKey, kind, worktree: root,
          path: (process.platform === 'win32' ? full.toLowerCase() : full).replace(/\\/g, '/'), sha256: artifact.sha256 });
      }
    };
    const evidence = (taskId: string, value: TaskEvidence, origin?: string) => {
      const artifacts = [...new Map([{ path: value.path, sha256: value.sha256 }, ...(value.inputArtifacts ?? [])]
        .map(artifact => [JSON.stringify(artifact), artifact])).values()];
      retain(taskId, 'evidence', `evidence:${value.receiptId}`, artifacts, origin);
    };
    for (const row of this.db.prepare("SELECT seq,task_id,kind,json FROM task_events WHERE kind IN ('claimed','handoff','delegation_prepared','writer_returned','checkpoint','evidence','owner_verified') ORDER BY seq")
      .all() as Array<{ seq: number; task_id: string; kind: string; json: string }>) {
      const value = JSON.parse(row.json);
      if ((row.kind === 'claimed' || row.kind === 'handoff') && value.worktree) writers.set(row.task_id, value.worktree);
      if (row.kind === 'delegation_prepared') {
        retain(row.task_id, 'delegation_candidate', `delegation:${value.delegationId}`, value.candidateArtifacts, value.parentWorktree);
        if (value.mode === 'writer' && value.childWorktree) writers.set(row.task_id, value.childWorktree);
      }
      if (row.kind === 'writer_returned' && value.to?.worktree) writers.set(row.task_id, value.to.worktree);
      if (row.kind === 'checkpoint') {
        checkpoints.add(row.task_id);
        retain(row.task_id, 'checkpoint', `checkpoint:${row.seq}`, value.artifacts, value.worktree ?? writers.get(row.task_id));
      }
      if (row.kind === 'evidence' || row.kind === 'owner_verified') {
        evidenceEvents.add(`${row.task_id}:${value.receiptId}`);
        evidence(row.task_id, value, writers.get(row.task_id));
      }
    }
    for (const row of this.db.prepare('SELECT task_id,json FROM task_checkpoints').all() as Array<Row & { task_id: string }>) {
      if (!checkpoints.has(row.task_id)) retain(row.task_id, 'checkpoint', 'checkpoint:legacy', JSON.parse(row.json).artifacts, writers.get(row.task_id));
    }
    for (const row of this.db.prepare('SELECT task_id,json FROM task_evidence').all() as Array<Row & { task_id: string }>) {
      const value = JSON.parse(row.json) as TaskEvidence;
      if (!evidenceEvents.has(`${row.task_id}:${value.receiptId}`)) evidence(row.task_id, value, writers.get(row.task_id));
    }
    return [...references.values()];
  }
  retentionReceipts(taskNodeId: string): TaskArtifactRetentionReceipt[] {
    this.assertReadCurrent();
    return (this.db.prepare("SELECT json FROM task_events WHERE task_id=? AND kind='artifact_retained' ORDER BY seq").all(taskNodeId) as Row[])
      .map(row => JSON.parse(row.json) as TaskArtifactRetentionReceipt);
  }
  readRetainedArtifact(taskNodeId: string, receiptId: string): Buffer {
    const receipt = this.retentionReceipts(taskNodeId).find(item => item.receiptId === receiptId);
    if (!receipt || receipt.source.taskNodeId !== taskNodeId) throw new Error('TASK_RETENTION_RECEIPT_NOT_FOUND');
    return readRetainedTaskArtifact(receipt);
  }
  readRetainedArtifactPage(taskNodeId: string, receiptId: string, offset = 0, length = 16_384) {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 1 || length > 65_536)
      throw new Error('TASK_ARTIFACT_RANGE_INVALID');
    const receipt = this.retentionReceipts(taskNodeId).find(item => item.receiptId === receiptId);
    if (!receipt || receipt.source.taskNodeId !== taskNodeId) throw new Error('TASK_RETENTION_RECEIPT_NOT_FOUND');
    const bytes = readRetainedTaskArtifact(receipt);
    if (offset > bytes.length) throw new Error('TASK_ARTIFACT_RANGE_INVALID');
    const end = Math.min(bytes.length, offset + length);
    return { receipt, offset, sizeBytes: bytes.length, nextOffset: end < bytes.length ? end : null,
      encoding: 'base64' as const, content: bytes.subarray(offset, end).toString('base64') };
  }
  /** Receipts commit before deletion so a crash cannot erase the only recovery locator. */
  prepareWorktreeCleanup(worktree: string, repository: string, operationId: string): string {
    text(operationId, 'CLEANUP_OPERATION', 300);
    return this.transaction(() => {
      const root = canonicalPath(worktree);
      if (withinPath(root, resolve(this.domain.database))) throw new Error('TASK_WORKTREE_CONTAINS_AUTHORITY_DATABASE');
      if (this.worktreeLiveTaskReferences(root).length) throw new Error('TASK_WORKTREE_HAS_UNFINISHED_TASKS');
      const references = this.worktreeArtifactReferences(root);
      const cleanupId = `${operationId}:${digest(references)}`;
      for (const source of references) {
        const existing = this.retentionReceipts(source.taskNodeId).find(receipt => receipt.source.sourceKey === source.sourceKey);
        if (existing) {
          if (JSON.stringify(existing.source) !== JSON.stringify(source)) throw new Error('TASK_RETENTION_RECEIPT_CONFLICT');
          readRetainedTaskArtifact(existing);
        } else {
          const receipt = retainTaskArtifact(repository, source);
          this.request(`retain:${source.taskNodeId}:${source.sourceKey}`, source, () => {
            this.event(source.taskNodeId, 'artifact_retained', receipt);
            return receipt;
          });
        }
      }
      for (const taskNodeId of new Set(references.map(ref => ref.taskNodeId))) {
        const receiptIds = this.retentionReceipts(taskNodeId).filter(receipt => receipt.source.worktree === root).map(receipt => receipt.receiptId);
        this.request(`cleanup-prepared:${cleanupId}:${taskNodeId}`, { worktree: root, receiptIds }, () => {
          this.event(taskNodeId, 'worktree_cleanup_prepared', { operationId: cleanupId, worktree: root, receiptIds, actor: 'agent' });
          return true;
        });
      }
      return cleanupId;
    });
  }
  withWorktreeCleanup<T>(worktree: string, effect: () => T): T {
    return this.transaction(() => {
      if (this.worktreeLiveTaskReferences(worktree).length) throw new Error('TASK_WORKTREE_HAS_UNFINISHED_TASKS');
      for (const source of this.worktreeArtifactReferences(worktree)) {
        const receipt = this.retentionReceipts(source.taskNodeId).find(item => item.source.sourceKey === source.sourceKey);
        if (!receipt || JSON.stringify(receipt.source) !== JSON.stringify(source)) throw new Error('TASK_WORKTREE_REFERENCES_RETAINED');
        readRetainedTaskArtifact(receipt);
      }
      const result = effect();
      if (result && typeof (result as { then?: unknown }).then === 'function') throw new Error('TASK_RETENTION_REQUIRES_SYNC_EFFECT');
      return result;
    });
  }
  completeWorktreeCleanup(operationId: string, worktree: string): void {
    this.transaction(() => {
      if (existsSync(worktree)) throw new Error('TASK_CLEANUP_PATH_STILL_EXISTS');
      for (const row of this.db.prepare("SELECT task_id,json FROM task_events WHERE kind='worktree_cleanup_prepared'").all() as Array<Row & { task_id: string }>) {
        const value = JSON.parse(row.json) as { operationId: string; worktree: string; receiptIds: string[] };
        if (value.operationId !== operationId || value.worktree !== worktree) continue;
        for (const id of value.receiptIds) this.readRetainedArtifact(row.task_id, id);
        this.request(`cleanup-completed:${operationId}:${row.task_id}`, value, () => {
          this.event(row.task_id, 'worktree_cleanup_completed', { ...value, actor: 'agent' });
          return true;
        });
      }
    });
  }
  delegationForChild(childSessionKey: string): TaskWriterDelegation | null {
    this.assertReadCurrent();
    return this.read<TaskWriterDelegation>(
      "SELECT json FROM task_writer_delegations WHERE child_session=?",
      childSessionKey,
    );
  }
  markDelegationRecoveryRequired(childSessionKey: string, receipt: NonNullable<TaskWriterDelegation['terminalReceipt']>, reason: string): TaskWriterDelegation {
    return this.transaction(() => {
      const delegation = this.delegationForChild(childSessionKey);
      if (!delegation || delegation.childRunId !== receipt.runId) throw new Error('TASK_DELEGATION_TERMINAL_MISMATCH');
      if (delegation.phase === 'returned') return delegation;
      delegation.phase = 'recovery_required'; delegation.terminalReceipt = receipt;
      this.saveWriterDelegation(delegation);
      this.event(delegation.taskNodeId, 'delegation_recovery_required', { delegationId: delegation.delegationId, reason });
      return delegation;
    });
  }
  prepareWriterDelegation(
    parent: TaskCredential,
    input: {
      delegationId: string;
      childSessionKey: string;
      childGeneration: string;
      childWorktree: string;
      childRunId: string;
      mode: "writer" | "observer";
      authorityBasis?: TaskWriterDelegation['authorityBasis'];
    },
  ): TaskWriterDelegation {
    text(input.childGeneration, "CHILD_GENERATION", 200);
    text(input.childSessionKey, "CHILD_SESSION", 300);
    text(input.childRunId, "CHILD_RUN", 300);
    text(input.delegationId, "DELEGATION_ID", 300);
    if (input.childSessionKey === parent.sessionKey) throw new Error("TASK_DELEGATION_SELF");
    this.assertAuthorityCurrent();
    if (this.relatedDomain(input.childWorktree).id !== this.domain.id)
      throw new Error("TASK_DELEGATION_DOMAIN_MISMATCH");
    return this.transaction(() => {
      const prior = this.delegationForChild(input.childSessionKey);
      if (prior) {
        if (
          prior.delegationId !== input.delegationId ||
          prior.parent.epoch !== parent.epoch ||
          prior.parent.sessionKey !== parent.sessionKey ||
          prior.child.generation !== input.childGeneration ||
          prior.childRunId !== input.childRunId ||
          prior.mode !== input.mode
        )
          throw new Error("TASK_DELEGATION_IDENTITY_CONFLICT");
        return prior;
      }
      const view = this.assertOwner(parent);
      if (
        view.contract.state !== "doing" &&
        !(input.mode === "observer" && view.contract.state === "review")
      )
        throw new Error("TASK_EXECUTION_NOT_RUNNING");
      if (this.binding(input.childSessionKey)) throw new Error("TASK_SESSION_ALREADY_BOUND");
      const pending = this.db
        .prepare(
          "SELECT id,kind,epoch,state FROM task_operations WHERE task_id=? AND state IN ('started','unknown')",
        )
        .all(parent.taskNodeId) as Array<{
        id: string;
        kind: string;
        epoch: number;
        state: string;
      }>;
      if (
        input.mode === "writer" &&
        pending.some(
          (op) =>
            op.epoch !== parent.epoch ||
            op.state !== "started" ||
            !TASK_DELEGATION_DISPATCH_TOOLS.includes(op.kind),
        )
      )
        throw new Error("TASK_OPERATIONS_PENDING");
      const child: TaskClaim = {
        ...view.claim!,
        sessionKey: input.childSessionKey as SessionKey,
        generation: input.childGeneration,
        epoch: view.claim!.epoch + 1,
        worktree: canonicalPath(input.childWorktree),
        attemptId: randomUUID(),
        expiresAt: this.now() + LEASE_MS,
        state: "active",
      };
      const delegation: TaskWriterDelegation = {
        delegationId: input.delegationId,
        taskNodeId: parent.taskNodeId,
        parent: {
          taskNodeId: parent.taskNodeId,
          sessionKey: parent.sessionKey,
          generation: parent.generation,
          epoch: parent.epoch,
        },
        parentWorktree: this.domain.worktree,
        child: {
          taskNodeId: child.taskNodeId,
          sessionKey: child.sessionKey,
          generation: child.generation,
          epoch: child.epoch,
        },
        childWorktree: child.worktree,
        childRunId: input.childRunId,
        mode: input.mode,
        phase: "prepared",
        dispatchOperationIds: input.mode === "writer" ? pending.map((op) => op.id) : [],
        contractRevision: view.contract.revision,
        ...(input.authorityBasis ? { authorityBasis: input.authorityBasis } : {}),
        candidateArtifacts: input.mode === "observer" ? this.candidateArtifacts(parent) : undefined,
      };
      if (input.mode === "writer") {
        for (const op of pending)
          this.db.prepare("UPDATE task_operations SET state='delegated' WHERE id=?").run(op.id);
        this.saveClaim(child);
        this.db.prepare("DELETE FROM task_bindings WHERE task_id=?").run(parent.taskNodeId);
        this.db
          .prepare("INSERT INTO task_bindings VALUES(?,?,?,?)")
          .run(child.sessionKey, child.taskNodeId, child.generation, child.epoch);
        this.db
          .prepare("INSERT OR REPLACE INTO task_references VALUES(?,?,?,?)")
          .run(parent.sessionKey, parent.taskNodeId, parent.generation, "coordinator");
      } else
        this.db
          .prepare("INSERT INTO task_references VALUES(?,?,?,?)")
          .run(child.sessionKey, child.taskNodeId, child.generation, "observer");
      this.saveWriterDelegation(delegation);
      this.event(parent.taskNodeId, "delegation_prepared", delegation);
      return delegation;
    });
  }
  recordDelegationDispatch(
    childSessionKey: string,
    runId: string,
    phase: "dispatched" | "unknown",
  ): void {
    this.transaction(() => {
      const d = this.delegationForChild(childSessionKey);
      if (!d) throw new Error("TASK_DELEGATION_NOT_FOUND");
      if (d.phase === "returned") return;
      if (d.childRunId !== runId) throw new Error("TASK_DELEGATION_RUN_MISMATCH");
      d.phase = phase;
      this.saveWriterDelegation(d);
      this.event(d.taskNodeId, "delegation_dispatch", {
        delegationId: d.delegationId,
        phase,
        runId,
      });
    });
  }
  returnDelegatedWriter(
    childSessionKey: string,
    receipt: { runId: string; endedAt: number; outcome: string; parentGeneration: string },
  ): TaskWriterDelegation | null {
    return this.transaction(() => {
      const d = this.delegationForChild(childSessionKey);
      if (!d) return null;
      if (
        d.childRunId !== receipt.runId ||
        !Number.isFinite(receipt.endedAt) ||
        receipt.endedAt <= 0
      )
        throw new Error("TASK_DELEGATION_TERMINAL_MISMATCH");
      if (d.phase === "returned") return d;
      const view = this.get(d.taskNodeId);
      if (view.contract.state === "cancelling" && !view.pendingOperations) {
        this.settleCancellation(d.taskNodeId);
        d.phase = "returned";
        d.terminalReceipt = receipt;
        this.saveWriterDelegation(d);
        return d;
      }
      const parentBinding = this.db
        .prepare("SELECT task_id FROM task_bindings WHERE session_key=?")
        .get(d.parent.sessionKey) as { task_id: string } | undefined;
      if (
        receipt.parentGeneration !== d.parent.generation ||
        (d.mode === "writer" &&
          (view.pendingOperations || (parentBinding && parentBinding.task_id !== d.taskNodeId)))
      ) {
        d.phase = "recovery_required";
        d.terminalReceipt = receipt;
        this.saveWriterDelegation(d);
        this.event(d.taskNodeId, "delegation_recovery_required", {
          delegationId: d.delegationId,
          pending: view.pendingOperations,
        });
        return d;
      }
      if (d.mode === "writer" && !["done", "cancelled"].includes(view.contract.state)) {
        const c = view.claim;
        if (
          !c ||
          c.sessionKey !== d.child.sessionKey ||
          c.generation !== d.child.generation ||
          c.epoch !== d.child.epoch
        )
          throw new Error("TASK_DELEGATION_STALE_CHILD");
        const parentWorktree = canonicalPath(d.parentWorktree);
        const returned: TaskClaim = {
          ...c,
          sessionKey: d.parent.sessionKey,
          generation: d.parent.generation,
          worktree: parentWorktree,
          epoch: c.epoch + 1,
          expiresAt: this.now() + LEASE_MS,
          state: "active",
          attemptId: randomUUID(),
        };
        this.saveClaim(returned);
        this.db.prepare("DELETE FROM task_bindings WHERE task_id=?").run(d.taskNodeId);
        this.db
          .prepare("INSERT INTO task_bindings VALUES(?,?,?,?)")
          .run(returned.sessionKey, returned.taskNodeId, returned.generation, returned.epoch);
        this.db.prepare("DELETE FROM task_references WHERE session_key=?").run(returned.sessionKey);
        this.db
          .prepare("INSERT OR REPLACE INTO task_references VALUES(?,?,?,?)")
          .run(c.sessionKey, c.taskNodeId, c.generation, "observer");
        this.event(d.taskNodeId, "writer_returned", { from: d.child, to: returned, receipt });
      }
      d.phase = "returned";
      d.terminalReceipt = receipt;
      this.saveWriterDelegation(d);
      return d;
    });
  }
  control(credential: TaskCredential, action: "renew" | "pause" | "release" | "cancel"): TaskView {
    return this.transaction(() => {
      if (action === "cancel") {
        const planned = this.get(credential.taskNodeId);
        if (planned.childTaskNodeIds?.length) {
          const c = planned.claim;
          const reference = this.db.prepare("SELECT task_id,generation,role FROM task_references WHERE session_key=?").get(credential.sessionKey) as {task_id:string;generation:string;role:string}|undefined;
          if (c?.state === "released" && c.epoch === credential.epoch && c.sessionKey === credential.sessionKey && c.generation === credential.generation && c.worktree === this.domain.worktree && reference?.task_id === c.taskNodeId && reference.generation === c.generation && reference.role === "coordinator") {
            this.cancelPlan(planned.contract.taskNodeId);
            return this.get(credential.taskNodeId);
          }
        }
      }
      const view = this.assertOwner(credential, action !== "renew");
      if (action === "cancel" && view.childTaskNodeIds?.length) {
        this.cancelPlan(credential.taskNodeId);
        return this.get(credential.taskNodeId);
      }
      if (action === "cancel" && view.pendingOperations) {
        this.saveContract({ ...view.contract, state: "cancelling", updatedAt: this.now() });
        this.event(credential.taskNodeId, "cancel_requested", {
          epoch: credential.epoch,
          pendingOperations: view.pendingOperations,
        });
        return this.get(credential.taskNodeId);
      }
      if (action !== "renew" && view.pendingOperations) throw new Error("TASK_OPERATIONS_PENDING");
      const claim = view.claim!;
      if (action === "renew") this.saveClaim({ ...claim, expiresAt: this.now() + LEASE_MS });
      else {
        this.saveClaim({
          ...claim,
          state: action === "pause" ? "paused" : "released",
          epoch: claim.epoch + 1,
        });
        if (action !== "pause")
          this.db.prepare("DELETE FROM task_bindings WHERE task_id=?").run(credential.taskNodeId);
        this.saveContract({
          ...view.contract,
          state: action === "cancel" ? "cancelled" : action === "pause" ? "paused" : "ready",
          updatedAt: this.now(),
        });
        this.event(credential.taskNodeId, action, { epoch: claim.epoch });
        if (action === "cancel" && view.parentTaskNodeId) this.settleCancellation(view.parentTaskNodeId);
      }
      return this.get(credential.taskNodeId);
    });
  }
  handoff(
    credential: TaskCredential,
    sessionKey: string,
    generation: string,
    worktree = this.domain.worktree,
  ): TaskView {
    text(sessionKey, "SESSION", 300);
    text(generation, "GENERATION", 200);
    this.assertAuthorityCurrent();
    if (this.relatedDomain(worktree).id !== this.domain.id)
      throw new Error("TASK_HANDOFF_DOMAIN_MISMATCH");
    return this.transaction(() => {
      const view = this.assertOwner(credential, true);
      if (view.pendingOperations) throw new Error("TASK_OPERATIONS_PENDING");
      const existing = this.binding(sessionKey);
      if (existing && existing.contract.taskNodeId !== credential.taskNodeId)
        throw new Error("TASK_SESSION_ALREADY_BOUND");
      const c: TaskClaim = {
        ...view.claim!,
        sessionKey: sessionKey as SessionKey,
        generation,
        worktree: canonicalPath(worktree),
        epoch: view.claim!.epoch + 1,
        attemptId: randomUUID(),
        expiresAt: this.now() + LEASE_MS,
        state: "active",
      };
      this.saveClaim(c);
      this.db.prepare("DELETE FROM task_bindings WHERE task_id=?").run(c.taskNodeId);
      this.db
        .prepare("INSERT INTO task_bindings VALUES(?,?,?,?)")
        .run(c.sessionKey, c.taskNodeId, c.generation, c.epoch);
      this.saveContract({ ...view.contract, state: "doing", updatedAt: this.now() });
      this.event(c.taskNodeId, "handoff", c);
      return this.get(c.taskNodeId);
    });
  }
  checkpoint(credential: TaskCredential, checkpoint: TaskCheckpoint): TaskView {
    if (JSON.stringify(checkpoint).length > MAX_CHECKPOINT)
      throw new Error("TASK_CHECKPOINT_TOO_LARGE");
    const checked = {
      nextAction: text(checkpoint.nextAction, "NEXT_ACTION"),
      completed: strings(checkpoint.completed, "COMPLETED"),
      unresolved: strings(checkpoint.unresolved, "UNRESOLVED"),
      artifacts: checkpoint.artifacts,
    };
    if (
      !Array.isArray(checked.artifacts) ||
      checked.artifacts.length > 50 ||
      checked.artifacts.some((a) => !a.path || !/^[a-f0-9]{64}$/.test(a.sha256))
    )
      throw new Error("TASK_INVALID_ARTIFACTS");
    return this.transaction(() => {
      const owner = this.assertOwner(credential);
      const retained = { ...checked, artifacts: checked.artifacts.map(artifact => {
        const full = canonicalPath(resolve(owner.claim!.worktree, artifact.path));
        if (!withinPath(owner.claim!.worktree, full) && this.relatedDomain(dirname(full)).id !== this.domain.id) throw new Error('TASK_ARTIFACT_AUTHORITY_MISMATCH');
        const info = statSync(full);
        if (!info.isFile() || info.size > 32 * 1024 * 1024) throw new Error('TASK_EVIDENCE_SIZE_LIMIT');
        if (createHash('sha256').update(readFileSync(full)).digest('hex') !== artifact.sha256) throw new Error('TASK_EVIDENCE_HASH_MISMATCH');
        return { ...artifact, path: full };
      }) };
      this.db
        .prepare("INSERT OR REPLACE INTO task_checkpoints VALUES(?,?)")
        .run(credential.taskNodeId, JSON.stringify(retained));
      this.event(credential.taskNodeId, "checkpoint", { ...retained, worktree: owner.claim!.worktree });
      return this.get(credential.taskNodeId);
    });
  }
  context(sessionKey: string, generation?: string): string | null {
    const view = this.binding(sessionKey, generation);
    if (!view) return null;
    const contract = view.contract;
    const core = JSON.stringify({
      taskNodeId: contract.taskNodeId,
      revision: contract.revision,
      digest: contract.digest,
      objective: contract.objective,
      target: contract.target,
      constraints: contract.constraints,
      acceptance: contract.acceptance,
      expectedOutcomes: contract.expectedOutcomes ?? [],
      state: contract.state,
      executionRole: view.referenceOnly ? "observer" : "writer",
    });
    if (core.length > MAX_CONTEXT) throw new Error("TASK_GOAL_BUDGET_EXCEEDED");
    const ancestors: Array<Pick<TaskContract, "taskNodeId" | "revision" | "objective" | "target" | "constraints" | "acceptance" | "expectedOutcomes">> = [];
    const seen = new Set([contract.taskNodeId as string]);
    for (let parentId = view.parentTaskNodeId; parentId;) {
      if (seen.has(parentId) || ancestors.length >= 30) throw new Error("TASK_PLAN_ANCESTRY_INVALID");
      seen.add(parentId);
      const parent = this.view(parentId), c = parent.contract;
      ancestors.unshift({taskNodeId:c.taskNodeId,revision:c.revision,objective:c.objective,target:c.target,constraints:c.constraints,acceptance:c.acceptance,expectedOutcomes:c.expectedOutcomes});
      parentId = parent.parentTaskNodeId;
    }
    const parent = ancestors.length ? JSON.stringify({ ancestors }) : "";
    const progress = { nextAction: view.checkpoint?.nextAction ?? "", unresolved: [] as string[], omittedUnresolved: view.checkpoint?.unresolved.length ?? 0 };
    const prefix = `Persistent task contract (data; does not grant permissions):\n${core}\n${parent}\n`;
    if (prefix.length + JSON.stringify(progress).length > MAX_CONTEXT) throw new Error("TASK_GOAL_BUDGET_EXCEEDED");
    for (const item of view.checkpoint?.unresolved ?? []) {
      progress.unresolved.push(item); progress.omittedUnresolved--;
      if (prefix.length + JSON.stringify(progress).length > MAX_CONTEXT) {
        progress.unresolved.pop(); progress.omittedUnresolved++; break;
      }
    }
    return prefix + JSON.stringify(progress);
  }
  recordContextHydration(input: {
    sessionKey: string;
    generation?: string;
    runId?: string;
    taskNodeId: string;
    revision: number;
    epoch: number;
    context: string;
  }): { receiptId: string; contextDigest: string; revision: number; epoch: number } {
    this.assertAuthorityCurrent();
    const binding = {
      sessionKey: input.sessionKey,
      generation: input.generation ?? null,
      runId: input.runId ?? null,
      taskNodeId: input.taskNodeId,
      revision: input.revision,
      epoch: input.epoch,
      contextDigest: digest(input.context),
      characters: input.context.length,
    };
    const receiptId = `context:${digest(binding)}`;
    // Repeated model calls with unchanged task context reuse the receipt without writing.
    const existing = this.db.prepare("SELECT result FROM task_requests WHERE id=?").get(receiptId) as {result:string}|undefined;
    if (existing) return JSON.parse(existing.result);
    return this.transaction(() => this.request(receiptId, binding, () => {
      const current = this.binding(input.sessionKey, input.generation);
      if (!current || current.contract.taskNodeId !== input.taskNodeId || current.contract.revision !== input.revision || current.claim?.epoch !== input.epoch || this.context(input.sessionKey, input.generation) !== input.context)
        throw new Error("TASK_CONTEXT_CHANGED_DURING_RESTORATION");
      const receipt = {receiptId, ...binding, at:this.now(), source:"runtime-context-restoration"};
      this.event(input.taskNodeId, "context_rehydrated", receipt);
      return receipt;
    }));
  }
  beginOperation(credential: TaskCredential, operationId: string, kind: string): void {
    this.transaction(() => {
      const view = this.assertOwner(credential);
      if (view.contract.state !== "doing") throw new Error("TASK_EXECUTION_NOT_RUNNING");
      this.saveClaim({ ...view.claim!, expiresAt: this.now() + LEASE_MS });
      if (
        this.db
          .prepare("SELECT 1 FROM task_operations WHERE task_id=? AND state='unknown' LIMIT 1")
          .get(credential.taskNodeId)
      )
        throw new Error("TASK_RECONCILIATION_REQUIRED");
      const old = this.db.prepare("SELECT id FROM task_operations WHERE id=?").get(operationId);
      if (old) throw new Error("TASK_OPERATION_ALREADY_RECORDED");
      this.db
        .prepare("INSERT INTO task_operations VALUES(?,?,?,?,?,NULL)")
        .run(operationId, credential.taskNodeId, credential.epoch, kind, "started");
      this.db
        .prepare("INSERT INTO task_operation_owners VALUES(?,?,?)")
        .run(operationId, process.pid, this.now());
    });
  }
  beginRun(credential: TaskCredential, runId: string): void {
    this.transaction(() => {
      this.assertOwner(credential);
      const prior = this.db
        .prepare("SELECT epoch,run_id FROM task_active_runs WHERE task_id=?")
        .get(credential.taskNodeId) as { epoch: number; run_id: string } | undefined;
      if (prior && prior.epoch === credential.epoch && prior.run_id !== runId)
        throw new Error("TASK_RUN_ALREADY_ACTIVE");
      if (prior && prior.epoch === credential.epoch && prior.run_id === runId) return;
      this.db
        .prepare("INSERT OR REPLACE INTO task_active_runs VALUES(?,?,?)")
        .run(credential.taskNodeId, credential.epoch, runId);
    });
  }
  reserveDelegation(credential: TaskCredential, requestId: string): void {
    this.transaction(() => {
      this.assertOwner(credential);
      const existing = this.db
        .prepare("SELECT request_id FROM task_delegations WHERE task_id=? AND epoch=?")
        .get(credential.taskNodeId, credential.epoch) as { request_id: string } | undefined;
      if (existing && existing.request_id !== requestId)
        throw new Error("TASK_DELEGATION_ALREADY_RESERVED");
      if (!existing) {
        this.db
          .prepare("INSERT INTO task_delegations VALUES(?,?,?)")
          .run(credential.taskNodeId, credential.epoch, requestId);
        this.event(credential.taskNodeId, "delegation_reserved", {
          requestId,
          epoch: credential.epoch,
        });
      }
    });
  }
  endRun(credential: TaskCredential, runId: string): void {
    this.assertAuthorityCurrent();
    this.db
      .prepare("DELETE FROM task_active_runs WHERE task_id=? AND epoch=? AND run_id=?")
      .run(credential.taskNodeId, credential.epoch, runId);
  }
  recover(
    taskNodeId: string,
    sessionKey: string,
    generation: string,
    targetWorktree: string,
  ): TaskView {
    const original = this.get(taskNodeId);
    if (!original.claim || !["paused", "recovery_required"].includes(original.claim.state))
      throw new Error("TASK_RECOVERY_NOT_REQUIRED");
    this.transaction(() => {
      const pending = this.db
        .prepare(
          "SELECT o.id,o.kind,p.pid FROM task_operations o LEFT JOIN task_operation_owners p ON p.id=o.id WHERE o.task_id=? AND o.state IN ('started','unknown')",
        )
        .all(taskNodeId) as Array<{ id: string; kind: string; pid: number | null }>;
      for (const op of pending) {
        if (!["write", "edit", "apply_patch"].includes(op.kind) || !op.pid)
          throw new Error("TASK_EFFECT_OWNER_RECONCILIATION_REQUIRED");
        let dead = false;
        try {
          process.kill(op.pid, 0);
        } catch (error) {
          dead = (error as NodeJS.ErrnoException).code === "ESRCH";
        }
        if (!dead) throw new Error("TASK_OLD_PROCESS_STILL_ALIVE");
        this.db
          .prepare(
            "UPDATE task_operations SET state='reconciled',result='Old in-process writer exited; partial files require review' WHERE id=?",
          )
          .run(op.id);
        this.event(taskNodeId, "operation_reconciled", {
          operationId: op.id,
          outcome: "unknown",
          producer: "process-owner",
        });
        const checkpoint = this.get(taskNodeId).checkpoint ?? {
          nextAction: "Inspect partial writes before continuing",
          completed: [],
          unresolved: [],
          artifacts: [],
        };
        checkpoint.unresolved = [
          ...checkpoint.unresolved,
          `Operation ${op.id} ended without an effect receipt; inspect its files before retrying.`,
        ].slice(-30);
        this.db
          .prepare("INSERT OR REPLACE INTO task_checkpoints VALUES(?,?)")
          .run(taskNodeId, JSON.stringify(checkpoint));
      }
    });
    return this.handoff(original.claim, sessionKey, generation, targetWorktree);
  }
  finishOperation(
    credential: TaskCredential,
    operationId: string,
    state: "completed" | "unknown",
    result: string,
    background?: {
      handle: string;
      params: unknown;
      inputs: Array<{ path: string; sha256: string }>;
    },
  ): void {
    this.transaction(() => {
      // An operation may finish after lease expiry, but never after ownership changed.
      const delegated = this.db
        .prepare("SELECT json FROM task_writer_delegations WHERE task_id=?")
        .all(credential.taskNodeId) as Row[];
      const dispatch = delegated
        .map((row) => JSON.parse(row.json) as TaskWriterDelegation)
        .find(
          (d) =>
            d.parent.epoch === credential.epoch &&
            d.parent.sessionKey === credential.sessionKey &&
            d.parent.generation === credential.generation &&
            d.dispatchOperationIds.includes(operationId),
        );
      if (dispatch) {
        this.db
          .prepare(
            "UPDATE task_operations SET state=?,result=? WHERE id=? AND epoch=? AND state='delegated'",
          )
          .run(
            state === "completed" ? "completed" : "delegation_unknown",
            result.slice(0, 1000),
            operationId,
            credential.epoch,
          );
        return;
      }
      this.assertOwner(credential, true);
      const changes = this.db
        .prepare(
          "UPDATE task_operations SET state=?,result=? WHERE id=? AND task_id=? AND epoch=? AND state='started'",
        )
        .run(
          state,
          result.slice(0, 1000),
          operationId,
          credential.taskNodeId,
          credential.epoch,
        ).changes;
      if (Number(changes) !== 1) throw new Error("TASK_OPERATION_STATE_CONFLICT");
      if (background)
        this.db
          .prepare("INSERT OR REPLACE INTO task_operation_handles VALUES(?,?,?)")
          .run(operationId, background.handle, JSON.stringify(background));
      this.settleCancellation(credential.taskNodeId);
    });
  }
  private cancelPlan(taskNodeId: string): void {
    const view = this.get(taskNodeId);
    if (["done", "cancelled"].includes(view.contract.state)) return;
    this.saveContract({ ...view.contract, state: "cancelling", updatedAt: this.now() });
    this.event(taskNodeId, "cancel_requested", { source: "plan-coordinator", pendingOperations: view.pendingOperations });
    for (const childId of view.childTaskNodeIds ?? []) this.cancelPlan(childId);
    this.settleCancellation(taskNodeId);
  }
  private settleCancellation(taskNodeId: string): void {
    const view = this.get(taskNodeId);
    if (view.contract.state !== "cancelling" || view.pendingOperations || view.childTaskNodeIds?.some((id) => !["done", "cancelled"].includes(this.get(id).contract.state))) return;
    this.saveContract({ ...view.contract, state: "cancelled", updatedAt: this.now() });
    if (view.claim) this.saveClaim({ ...view.claim, state: "released", epoch: view.claim.epoch + 1 });
    this.db.prepare("DELETE FROM task_bindings WHERE task_id=?").run(taskNodeId);
    this.event(taskNodeId, "cancelled", { reason: "owned-operations-settled" });
    if (view.parentTaskNodeId) this.settleCancellation(view.parentTaskNodeId);
  }
  operation(
    credential: TaskCredential,
    operationId: string,
  ): { id: string; kind: string; state: string; epoch: number; startedAt: number;
    receipt?: { id: string; outcome: "applied" | "not_applied"; owner: string } } {
    const view = this.get(credential.taskNodeId), c = view.claim;
    const row = this.db
      .prepare(
        "SELECT o.id,o.kind,o.state,o.epoch,o.result,p.started_at AS startedAt FROM task_operations o JOIN task_operation_owners p ON p.id=o.id WHERE o.id=? AND o.task_id=? AND o.epoch=?",
      )
      .get(operationId, credential.taskNodeId, credential.epoch) as
      | { id: string; kind: string; state: string; epoch: number; startedAt: number; result: string | null }
      | undefined;
    if (!row) throw new Error("TASK_OPERATION_NOT_FOUND");
    const terminalReplay = ["completed", "reconciled"].includes(row.state)
      && (view.contract.state === "cancelled" || c?.state === "paused")
      && c?.epoch === credential.epoch + 1 && c.sessionKey === credential.sessionKey
      && c.generation === credential.generation && c.worktree === this.domain.worktree;
    if (!terminalReplay) this.assertOwner(credential, true);
    const { result, ...operation } = row;
    if (row.state !== 'reconciled') return operation;
    const receipt = JSON.parse(result ?? 'null') as { id: string; outcome: "applied" | "not_applied"; owner: string } | null;
    if (!receipt?.id || !receipt.owner || !['applied','not_applied'].includes(receipt.outcome)) throw new Error('TASK_EFFECT_RECEIPT_INVALID');
    return { ...operation, receipt };
  }
  reconcileOperation(
    credential: TaskCredential,
    operationId: string,
    receipt: { id: string; outcome: "applied" | "not_applied"; owner: string },
  ): TaskView {
    return this.transaction(() => {
      const op = this.operation(credential, operationId);
      if (op.state === "reconciled") {
        const prior = this.db.prepare("SELECT result FROM task_operations WHERE id=?").get(operationId) as { result: string };
        if (prior.result !== JSON.stringify(receipt)) throw new Error("TASK_EFFECT_RECEIPT_CONFLICT");
        return this.get(credential.taskNodeId);
      }
      if (!["unknown", "started"].includes(op.state)) throw new Error("TASK_OPERATION_NOT_PENDING");
      this.db
        .prepare(
          "UPDATE task_operations SET state='reconciled',result=? WHERE id=? AND state IN ('unknown','started')",
        )
        .run(JSON.stringify(receipt), operationId);
      this.event(credential.taskNodeId, "effect_reconciled", { operationId, receipt });
      this.settleCancellation(credential.taskNodeId);
      return this.get(credential.taskNodeId);
    });
  }
  reconcileProcessResult(credential: TaskCredential, result: unknown): void {
    this.assertAuthorityCurrent();
    const details = (
      result as { details?: { sessionId?: unknown; exitCode?: unknown; exitSignal?: unknown; status?: unknown } } | null
    )?.details;
    if (
      !details ||
      typeof details.sessionId !== "string" ||
      !(typeof details.exitCode === "number" && Number.isFinite(details.exitCode)
        || typeof details.exitSignal === 'string' && /^SIG[A-Z0-9]+$/.test(details.exitSignal)) ||
      !["completed", "failed", "killed"].includes(String(details.status))
    )
      return;
    const rows = this.db
      .prepare(
        "SELECT o.id,h.json FROM task_operations o JOIN task_operation_handles h ON h.id=o.id WHERE o.task_id=? AND o.epoch=? AND o.state='unknown' AND h.handle=?",
      )
      .all(credential.taskNodeId, credential.epoch, details.sessionId) as Array<{
      id: string;
      json: string;
    }>;
    for (const row of rows) {
      const handle = JSON.parse(row.json) as {
        params: unknown;
        inputs: Array<{ path: string; sha256: string }>;
      };
      this.transaction(() => {
        this.assertOwner(credential, true);
        this.db
          .prepare(
            "UPDATE task_operations SET state='completed',result=? WHERE id=? AND state='unknown'",
          )
          .run(`process-owner exit=${details.exitCode ?? details.exitSignal}`, row.id);
        this.event(credential.taskNodeId, "process_reconciled", {
          operationId: row.id,
          exitCode: details.exitCode,
          ...(details.exitSignal ? { exitSignal: details.exitSignal } : {}),
        });
      });
      this.transaction(() => this.settleCancellation(credential.taskNodeId));
      if (this.get(credential.taskNodeId).contract.state !== "cancelled")
        this.recordToolVerification(credential, "exec", handle.params, result, handle.inputs);
    }
  }
  submit(credential: TaskCredential, candidate: string): TaskView {
    text(candidate, "CANDIDATE", 200);
    return this.transaction(() => {
      const view = this.assertOwner(credential);
      if (view.pendingOperations) throw new Error("TASK_OPERATIONS_PENDING");
      this.db
        .prepare("INSERT OR REPLACE INTO task_submissions VALUES(?,?,?,?)")
        .run(credential.taskNodeId, candidate, view.contract.revision, credential.epoch);
      this.saveContract({ ...view.contract, state: "review", updatedAt: this.now() });
      this.event(credential.taskNodeId, "submitted", {
        candidate,
        revision: view.contract.revision,
        epoch: credential.epoch,
      });
      return this.get(credential.taskNodeId);
    });
  }
  recordToolVerification(
    credential: TaskCredential,
    tool: string,
    params: unknown,
    result: unknown,
    inputArtifacts: Array<{ path: string; sha256: string }>,
  ): void {
    if (
      tool !== "exec" ||
      !params ||
      typeof params !== "object" ||
      !result ||
      typeof result !== "object"
    )
      return;
    const args = params as { command?: unknown };
    const details = (result as { details?: { exitCode?: unknown; status?: unknown } }).details;
    if (!details || typeof details.exitCode !== "number" || details.status === "running") return;
    this.transaction(() => {
      const view = this.assertOwner(credential, true);
      for (const criterion of view.contract.acceptance) {
        const v = criterion.verification;
        if (
          v.kind !== "tool-result" ||
          v.tool !== tool ||
          v.command !== args.command ||
          v.exitCode !== details.exitCode
        )
          continue;
        const artifacts = v.files.map((path) => this.hashWorkspaceFile(path));
        if (
          artifacts.some(
            (a) =>
              !inputArtifacts.some(
                (before) => before.path === a.path && before.sha256 === a.sha256,
              ),
          )
        )
          continue;
        const receipt: TaskEvidence = {
          receiptId: randomUUID(),
          taskNodeId: credential.taskNodeId,
          revision: view.contract.revision,
          epoch: credential.epoch,
          candidate: "tool-inputs",
          criterionId: criterion.id,
          path: artifacts[0].path,
          sha256: artifacts[0].sha256,
          inputArtifacts: artifacts,
          verifier: "runtime-tool-owner",
          createdAt: this.now(),
        };
        this.db
          .prepare("INSERT INTO task_evidence VALUES(?,?,?)")
          .run(receipt.receiptId, receipt.taskNodeId, JSON.stringify(receipt));
        this.event(receipt.taskNodeId, "evidence", receipt);
      }
    });
  }
  private hashWorkspaceFile(pathname: string): { path: string; sha256: string } {
    const full = canonicalPath(resolve(this.domain.worktree, pathname));
    const rel = relative(this.domain.worktree, full);
    if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("TASK_EVIDENCE_OUTSIDE_WORKTREE");
    const info = statSync(full);
    if (!info.isFile() || info.size > 32 * 1024 * 1024) throw new Error("TASK_EVIDENCE_SIZE_LIMIT");
    return { path: full, sha256: createHash("sha256").update(readFileSync(full)).digest("hex") };
  }
  verificationInputs(
    credential: TaskCredential,
    tool: string,
    params: unknown,
  ): Array<{ path: string; sha256: string }> {
    const view = this.assertOwner(credential);
    const command = (params as { command?: unknown } | null)?.command;
    return view.contract.acceptance.flatMap((c) =>
      c.verification.kind === "tool-result" &&
      c.verification.tool === tool &&
      c.verification.command === command
        ? c.verification.files.map((p) => this.hashWorkspaceFile(p))
        : [],
    );
  }
  candidateArtifacts(credential: TaskCredential): Array<{ path: string; sha256: string }> {
    const view = this.assertOwner(credential);
    const paths = view.contract.acceptance.flatMap((c) =>
      c.verification.kind === "file-sha256"
        ? [c.verification.path]
        : c.verification.kind === "tool-result"
          ? c.verification.files
          : (c.verification.files ?? []),
    );
    return [...new Set(paths)].sort().map((p) => this.hashWorkspaceFile(p));
  }
  getTaskEvidence(taskNodeId: string): TaskEvidence[] {
    this.get(taskNodeId);
    return (
      this.db
        .prepare("SELECT json FROM task_evidence WHERE task_id=? ORDER BY rowid")
        .all(taskNodeId) as Row[]
    ).map((row) => JSON.parse(row.json) as TaskEvidence);
  }
  replayCompletedTask(
    taskNodeId: string,
    sessionKey: string,
    generation: string,
    candidate: string,
  ): TaskView {
    const view = this.get(taskNodeId);
    const claim = view.claim;
    const submitted = this.db
      .prepare("SELECT epoch FROM task_submissions WHERE task_id=?")
      .get(taskNodeId) as { epoch: number } | undefined;
    if (
      view.contract.state !== "done" ||
      !claim ||
      !submitted ||
      claim.sessionKey !== sessionKey ||
      claim.generation !== generation
    )
      throw new Error("TASK_COMPLETION_REPLAY_MISMATCH");
    return this.accept({ ...claim, epoch: submitted.epoch }, candidate);
  }
  validatedEvidence(
    credential: TaskCredential,
    candidate: string,
    criterionIds?: string[],
  ): TaskEvidence[] {
    const view = this.assertOwner(credential);
    const receipts = this.getTaskEvidence(credential.taskNodeId).toReversed();
    return view.contract.acceptance
      .filter((c) => !criterionIds || criterionIds.includes(c.id))
      .map((criterion) => {
        const receipt = receipts.find(
          (r) =>
            r.criterionId === criterion.id &&
            r.revision === view.contract.revision &&
            r.epoch === credential.epoch &&
            (r.candidate === candidate ||
              (criterion.verification.kind === "tool-result" &&
                r.verifier === "runtime-tool-owner")),
        );
        if (!receipt)
          throw new Error(
            criterion.verification.kind === "owner-receipt"
              ? "TASK_OWNER_VERIFIER_REQUIRED"
              : `TASK_EVIDENCE_MISSING:${criterion.id}`,
          );
        if (
          criterion.verification.kind === "owner-receipt" &&
          (!receipt.ownerProof || receipt.verifier !== `owner:${criterion.verification.owner}`)
        )
          throw new Error("TASK_OWNER_VERIFIER_REQUIRED");
        if (this.hashWorkspaceFile(receipt.path).sha256 !== receipt.sha256)
          throw new Error("TASK_EVIDENCE_STALE");
        for (const a of receipt.inputArtifacts ?? [])
          if (this.hashWorkspaceFile(a.path).sha256 !== a.sha256)
            throw new Error("TASK_EVIDENCE_STALE");
        return receipt;
      });
  }
  recordOwnerEvidence(
    credential: TaskCredential,
    criterionId: string,
    candidate: string,
    proof: {
      owner: string;
      verifierReceiptId: string;
      effectReceiptId: string;
      evidenceDigest: string;
      proposalDigest?: string;
      artifacts: Array<{ path: string; sha256: string }>;
    },
  ): TaskEvidence {
    return this.transaction(() => {
      const view = this.assertOwner(credential);
      const criterion = view.contract.acceptance.find((c) => c.id === criterionId);
      if (
        criterion?.verification.kind !== "owner-receipt" ||
        criterion.verification.owner !== proof.owner ||
        !proof.artifacts.length
      )
        throw new Error("TASK_OWNER_EVIDENCE_SCOPE_MISMATCH");
      for (const a of proof.artifacts)
        if (this.hashWorkspaceFile(a.path).sha256 !== a.sha256)
          throw new Error("TASK_EVIDENCE_STALE");
      const receipt: TaskEvidence = {
        receiptId: proof.verifierReceiptId,
        taskNodeId: credential.taskNodeId,
        revision: view.contract.revision,
        epoch: credential.epoch,
        candidate,
        criterionId,
        path: proof.artifacts[0].path,
        sha256: proof.artifacts[0].sha256,
        inputArtifacts: proof.artifacts,
        verifier: `owner:${proof.owner}`,
        ownerProof: {
          verifierReceiptId: proof.verifierReceiptId,
          effectReceiptId: proof.effectReceiptId,
          evidenceDigest: proof.evidenceDigest,
          proposalDigest: proof.proposalDigest,
        },
        createdAt: this.now(),
      };
      const old = this.read<TaskEvidence>(
        "SELECT json FROM task_evidence WHERE id=?",
        receipt.receiptId,
      );
      if (old) {
        if (
          JSON.stringify({ ...old, createdAt: 0 }) !== JSON.stringify({ ...receipt, createdAt: 0 })
        )
          throw new Error("TASK_OWNER_RECEIPT_CONFLICT");
        return old;
      }
      this.db
        .prepare("INSERT INTO task_evidence VALUES(?,?,?)")
        .run(receipt.receiptId, receipt.taskNodeId, JSON.stringify(receipt));
      this.event(receipt.taskNodeId, "owner_verified", receipt);
      return receipt;
    });
  }
  verifyFile(
    credential: TaskCredential,
    criterionId: string,
    pathname: string,
    expectedSha256: string,
    candidate: string,
  ): TaskEvidence {
    const view = this.assertOwner(credential);
    const criterion = view.contract.acceptance.find((a) => a.id === criterionId);
    if (!criterion) throw new Error("TASK_CRITERION_NOT_FOUND");
    if (criterion.verification.kind !== "file-sha256")
      throw new Error("TASK_OWNER_VERIFIER_REQUIRED");
    const full = canonicalPath(resolve(this.domain.worktree, pathname));
    const rel = relative(this.domain.worktree, full);
    if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("TASK_EVIDENCE_OUTSIDE_WORKTREE");
    if (
      canonicalPath(resolve(this.domain.worktree, criterion.verification.path)) !== full ||
      criterion.verification.sha256 !== expectedSha256
    )
      throw new Error("TASK_EVIDENCE_CRITERION_MISMATCH");
    return this.transaction(() => {
      this.assertOwner(credential);
      const sha256 = this.hashWorkspaceFile(full).sha256;
      if (sha256 !== expectedSha256) throw new Error("TASK_EVIDENCE_HASH_MISMATCH");
      const receipt: TaskEvidence = {
        receiptId: randomUUID(),
        taskNodeId: credential.taskNodeId,
        revision: view.contract.revision,
        epoch: credential.epoch,
        candidate,
        criterionId,
        path: full,
        sha256,
        verifier: "host-file-verifier",
        createdAt: this.now(),
      };
      this.db
        .prepare("INSERT INTO task_evidence VALUES(?,?,?)")
        .run(receipt.receiptId, receipt.taskNodeId, JSON.stringify(receipt));
      this.event(receipt.taskNodeId, "evidence", receipt);
      return receipt;
    });
  }
  accept(credential: TaskCredential, candidate: string): TaskView {
    return this.transaction(() => {
      const completed = this.get(credential.taskNodeId);
      if (completed.contract.state === "done") {
        const submission = this.db
          .prepare("SELECT candidate,epoch FROM task_submissions WHERE task_id=?")
          .get(credential.taskNodeId) as { candidate: string; epoch: number } | undefined;
        if (
          submission?.candidate === candidate &&
          submission.epoch === credential.epoch &&
          completed.claim?.sessionKey === credential.sessionKey &&
          completed.claim?.generation === credential.generation
        )
          return completed;
        throw new Error("TASK_COMPLETION_REPLAY_MISMATCH");
      }
      const view = this.assertOwner(credential);
      if (view.contract.state !== "review" || view.pendingOperations)
        throw new Error("TASK_NOT_READY_FOR_ACCEPTANCE");
      this.checkDependencies(credential.taskNodeId, view.childTaskNodeIds ?? [], true);
      const sub = this.db
        .prepare("SELECT candidate,revision,epoch FROM task_submissions WHERE task_id=?")
        .get(credential.taskNodeId) as
        | { candidate: string; revision: number; epoch: number }
        | undefined;
      if (
        !sub ||
        sub.candidate !== candidate ||
        sub.revision !== view.contract.revision ||
        sub.epoch !== credential.epoch
      )
        throw new Error("TASK_SUBMISSION_STALE");
      const receipts = (
        this.db
          .prepare("SELECT json FROM task_evidence WHERE task_id=?")
          .all(credential.taskNodeId) as Row[]
      ).map((r) => JSON.parse(r.json) as TaskEvidence);
      for (const criterion of view.contract.acceptance) {
        if (criterion.verification.kind === "owner-receipt") {
          this.validatedEvidence(credential, candidate, [criterion.id]);
          continue;
        }
        const receipt = receipts
          .toReversed()
          .find(
            (r) =>
              r.criterionId === criterion.id &&
              (r.candidate === candidate ||
                (criterion.verification.kind === "tool-result" &&
                  r.verifier === "runtime-tool-owner")) &&
              r.revision === sub.revision &&
              r.epoch === sub.epoch,
          );
        if (!receipt) throw new Error(`TASK_EVIDENCE_MISSING:${criterion.id}`);
        if (this.hashWorkspaceFile(receipt.path).sha256 !== receipt.sha256)
          throw new Error("TASK_EVIDENCE_STALE");
        for (const artifact of receipt.inputArtifacts ?? []) {
          if (this.hashWorkspaceFile(artifact.path).sha256 !== artifact.sha256)
            throw new Error("TASK_EVIDENCE_STALE");
        }
      }
      this.saveContract({ ...view.contract, state: "done", updatedAt: this.now() });
      this.saveClaim({ ...view.claim!, state: "released", epoch: credential.epoch + 1 });
      this.db.prepare("DELETE FROM task_bindings WHERE task_id=?").run(credential.taskNodeId);
      this.event(credential.taskNodeId, "accepted", { candidate, revision: sub.revision });
      if (view.parentTaskNodeId) this.settleCancellation(view.parentTaskNodeId);
      return this.get(credential.taskNodeId);
    });
  }
}
