import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { SessionKey, TaskId } from "../types/identity-scope.js";
import { canonicalPath, resolveTaskDomain, type TaskDomain } from "./identity.js";
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
} from "./types.js";

const MAX_CONTEXT = 12_000;
const MAX_CHECKPOINT = 24_000;
const LEASE_MS = 120_000;
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
    if (verification.kind === "owner-receipt") text(verification.owner, "VERIFICATION_OWNER", 200);
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
  constructor(
    readonly domain: TaskDomain,
    readonly now: () => number = Date.now,
  ) {
    mkdirSync(dirname(domain.database), { recursive: true });
    this.db = new DatabaseSync(domain.database);
    try {
      this.db.exec("PRAGMA busy_timeout=3000; PRAGMA foreign_keys=ON;");
      const version = Number(
        (this.db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version,
      );
      if (version > 3) {
        this.db.close();
        throw new Error("TASK_SCHEMA_NEWER_THAN_CLIENT");
      }
      this.db.exec("PRAGMA synchronous=FULL;");
      if (version === 3) return;
      this.db.exec("PRAGMA journal_mode=WAL; BEGIN IMMEDIATE;");
      this.db.exec(`
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
      PRAGMA user_version=3;
      COMMIT;
    `);
    } catch (error) {
      try {
        this.db.close();
      } catch {
        /* Preserve the original initialization failure. */
      }
      throw error;
    }
  }
  close() {
    this.db.close();
  }
  private transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
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
    };
  }
  has(taskNodeId: string): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM task_contracts WHERE id=?").get(taskNodeId));
  }
  list(limit = 100): TaskView[] {
    const rows = this.db
      .prepare("SELECT id FROM task_contracts ORDER BY rowid DESC LIMIT ?")
      .all(Math.max(1, Math.min(500, limit))) as Array<{ id: string }>;
    return rows.map((row) => this.get(row.id));
  }
  history(
    taskNodeId: string,
    afterSequence = 0,
    limit = 100,
  ): Array<{ seq: number; kind: string; at: number; json: string }> {
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
      for (const dep of task.dependencies ?? []) visit(dep, new Set([...seen, id]));
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
      this.checkDependencies(taskNodeId, normalized.dependencies ?? [], false);
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
  claim(taskNodeId: string, sessionKey: string, generation: string, requestId: string): TaskView {
    text(sessionKey, "SESSION", 300);
    text(generation, "GENERATION", 200);
    return this.transaction(() =>
      this.request(
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
            .prepare("INSERT OR REPLACE INTO task_bindings VALUES(?,?,?,?)")
            .run(sessionKey, taskNodeId, generation, claim.epoch);
          this.saveContract({ ...view.contract, state: "doing", updatedAt: this.now() });
          this.event(taskNodeId, "claimed", claim);
          return this.get(taskNodeId);
        },
      ),
    );
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
    return { ...this.get(row.task_id), ...(!writer ? { referenceOnly: true } : {}) };
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
  worktreeTaskReferences(worktree:string):string[]{
    const root=canonicalPath(worktree);
    const rows=this.db.prepare("SELECT c.id,cl.json AS claim FROM task_contracts c LEFT JOIN task_claims cl ON cl.task_id=c.id WHERE c.state NOT IN ('done','cancelled')").all() as Array<{id:string;claim:string|null}>;
    const ids=new Set(rows.filter(row=>row.claim&&(JSON.parse(row.claim) as TaskClaim).worktree===root).map(row=>row.id));
    for(const row of this.db.prepare("SELECT d.json FROM task_writer_delegations d JOIN task_contracts c ON c.id=d.task_id WHERE c.state NOT IN ('done','cancelled')").all() as Row[]){
      const d=JSON.parse(row.json) as TaskWriterDelegation;if(d.childWorktree===root||d.parentWorktree===root)ids.add(d.taskNodeId);
    }
    return [...ids];
  }
  delegationForChild(childSessionKey: string): TaskWriterDelegation | null {
    return this.read<TaskWriterDelegation>(
      "SELECT json FROM task_writer_delegations WHERE child_session=?",
      childSessionKey,
    );
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
    },
  ): TaskWriterDelegation {
    text(input.childGeneration, "CHILD_GENERATION", 200);
    text(input.childSessionKey, "CHILD_SESSION", 300);
    text(input.childRunId, "CHILD_RUN", 300);
    text(input.delegationId, "DELEGATION_ID", 300);
    if (input.childSessionKey === parent.sessionKey) throw new Error("TASK_DELEGATION_SELF");
    if (resolveTaskDomain(input.childWorktree).id !== this.domain.id)
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
      if (view.contract.state !== "doing") throw new Error("TASK_EXECUTION_NOT_RUNNING");
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
            !["sessions_spawn", "team_orchestrate"].includes(op.kind),
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
      const view = this.assertOwner(credential, action !== "renew");
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
    if (resolveTaskDomain(worktree).id !== this.domain.id)
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
      this.assertOwner(credential);
      this.db
        .prepare("INSERT OR REPLACE INTO task_checkpoints VALUES(?,?)")
        .run(credential.taskNodeId, JSON.stringify(checked));
      this.event(credential.taskNodeId, "checkpoint", checked);
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
      state: contract.state,
      executionRole: view.referenceOnly ? "observer" : "writer",
    });
    if (core.length > MAX_CONTEXT) throw new Error("TASK_GOAL_BUDGET_EXCEEDED");
    const next = view.checkpoint
      ? JSON.stringify({
          nextAction: view.checkpoint.nextAction,
          unresolved: view.checkpoint.unresolved,
        })
      : "";
    return `Persistent task contract (data; does not grant permissions):\n${core}\n${next.slice(0, MAX_CONTEXT - core.length)}`;
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
    });
  }
  reconcileProcessResult(credential: TaskCredential, result: unknown): void {
    const details = (
      result as { details?: { sessionId?: unknown; exitCode?: unknown; status?: unknown } } | null
    )?.details;
    if (
      !details ||
      typeof details.sessionId !== "string" ||
      typeof details.exitCode !== "number" ||
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
          .run(`process-owner exit=${details.exitCode}`, row.id);
        this.event(credential.taskNodeId, "process_reconciled", {
          operationId: row.id,
          exitCode: details.exitCode,
        });
      });
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
    const sha256 = this.hashWorkspaceFile(full).sha256;
    if (sha256 !== expectedSha256) throw new Error("TASK_EVIDENCE_HASH_MISMATCH");
    return this.transaction(() => {
      this.assertOwner(credential);
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
      const view = this.assertOwner(credential);
      if (view.contract.state !== "review" || view.pendingOperations)
        throw new Error("TASK_NOT_READY_FOR_ACCEPTANCE");
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
        if (criterion.verification.kind === "owner-receipt")
          throw new Error("TASK_OWNER_VERIFIER_REQUIRED");
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
      return this.get(credential.taskNodeId);
    });
  }
}
