import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  normalizeRunScope,
} from "../../../shared/types/identity-scope.js";
import type { CheckoutWriterIdentity, CheckoutWriterBasis, CheckoutWriterCredential, CheckoutWriteReceipt, CheckoutWriterTerminalReceipt } from "../../../shared/checkout-ownership.js";
export type { CheckoutWriterIdentity, CheckoutWriterBasis, CheckoutWriterCredential, CheckoutWriteReceipt } from "../../../shared/checkout-ownership.js";
import { taskLedgerOwnIncarnation, taskLedgerOwnerWasReplaced } from "../../../shared/task-ledger-process.js";
import { executeSqliteQuerySync, executeSqliteQueryTakeFirstSync, getNodeSqliteKysely } from "../infra/kysely-sync.js";
import type { DB } from "../state/openclaw-state-db.generated.js";
import { openExecutionStateDatabase as openOpenClawStateDatabase, runExecutionStateWriteTransaction as runOpenClawStateWriteTransaction } from "../state/execution-state-db.js";
import { canonicalWorktreePath, filesystemInstance } from "./worktree-registry.js";

const SCOPE = "worktree-writer/v1";
type WriterDatabase = Pick<DB, "state_leases">;
type WriteOperation = { id: string; digest: string; state: "running" | "unknown" | "settled"; receipt?: CheckoutWriteReceipt };
export type CheckoutWriterState = CheckoutWriterCredential & {
  schema: 1; requestId: string; requestDigest: string; state: "active" | "draining" | "released";
  acquiredAt: number; expiresAt: number | null; operations: WriteOperation[];
  holderPid: number; holderIncarnation: string;
  terminalReceipt?: CheckoutWriterTerminalReceipt;
  requests: Array<{ id: string; digest: string; epoch: number }>;
};
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function text(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.length > 2048) throw new Error("checkout_writer_invalid_identity");
}
function normalizeIdentity(owner: CheckoutWriterIdentity): CheckoutWriterIdentity {
  if (owner.kind === "run") {
    const run = normalizeRunScope(owner.run);
    text(run.scope.sessionKey); text(owner.agentId); text(owner.sessionGeneration);
    if (!Number.isSafeInteger(owner.bindingRevision) || owner.bindingRevision < 1) throw new Error("checkout_writer_invalid_binding_revision");
    if (owner.task) {
      text(owner.task.authorityId); text(owner.task.taskNodeId);
      if (!Number.isSafeInteger(owner.task.epoch) || owner.task.epoch < 1
        || !Number.isSafeInteger(owner.task.contractRevision) || owner.task.contractRevision < 1) throw new Error("checkout_writer_invalid_task_identity");
    }
    return { kind: "run", run, agentId: owner.agentId, sessionGeneration: owner.sessionGeneration, bindingRevision: owner.bindingRevision,
      ...(owner.task ? { task: { authorityId: owner.task.authorityId, taskNodeId: owner.task.taskNodeId,
        epoch: owner.task.epoch, contractRevision: owner.task.contractRevision } } : {}) };
  }
  if (owner.kind !== "maintenance" || !["merge", "freeze", "cleanup"].includes(owner.operation)) throw new Error("checkout_writer_invalid_identity");
  text(owner.operationId);
  return { kind: "maintenance", operation: owner.operation, operationId: owner.operationId };
}

function read(root: string): CheckoutWriterState | null {
  const { db } = openOpenClawStateDatabase();
  const query = getNodeSqliteKysely<WriterDatabase>(db);
  const row = executeSqliteQueryTakeFirstSync(db, query.selectFrom("state_leases").select("payload_json").where("scope", "=", SCOPE).where("lease_key", "=", root));
  if (!row) return null;
  const value = JSON.parse(row.payload_json ?? "null") as CheckoutWriterState | null;
  if (value?.schema !== 1 || value.root !== root || !Number.isSafeInteger(value.epoch) || value.epoch < 1
    || !["active", "draining", "released"].includes(value.state) || !Array.isArray(value.operations) || !Array.isArray(value.requests)
    || !Number.isSafeInteger(value.acquiredAt) || value.acquiredAt < 0
    || !Number.isSafeInteger(value.holderPid) || value.holderPid < 1 || !value.holderIncarnation
    || (value.expiresAt !== null && (!Number.isSafeInteger(value.expiresAt) || value.expiresAt <= value.acquiredAt))
    || new Set(value.operations.map(op => op.id)).size !== value.operations.length
    || new Set(value.requests.map(request => request.id)).size !== value.requests.length
    || value.requests.some(request => !request.id || !request.digest || !Number.isSafeInteger(request.epoch) || request.epoch > value.epoch || request.epoch < 1)
    || value.operations.some(op => !op.id || !op.digest || !["running", "unknown", "settled"].includes(op.state)
      || (op.state === "settled" && (!op.receipt?.ownerReceipt || !["completed", "not-applied"].includes(op.receipt.outcome))))) throw new Error("checkout_writer_store_invalid");
  if (!value.requests.some(request => request.id === value.requestId && request.epoch === value.epoch && request.digest === value.requestDigest)) throw new Error("checkout_writer_store_invalid");
  normalizeIdentity(value.owner);
  text(value.token); text(value.incarnation); text(value.generation); text(value.requestId); text(value.requestDigest);
  if (value.terminalReceipt) {
    if (value.owner.kind !== 'run' || value.state === 'active' || value.terminalReceipt.runId !== value.owner.run.runId
      || value.terminalReceipt.sessionGeneration !== value.owner.sessionGeneration || !Number.isFinite(value.terminalReceipt.endedAt)
      || value.terminalReceipt.endedAt <= 0) throw new Error('checkout_writer_store_invalid');
    text(value.terminalReceipt.ownerReceipt);
  }
  return value;
}
function save(value: CheckoutWriterState): void {
  const { db } = openOpenClawStateDatabase();
  const query = getNodeSqliteKysely<WriterDatabase>(db);
  const fields = { owner: digest(value.owner), payload_json: JSON.stringify(value), expires_at: value.expiresAt, heartbeat_at: null, created_at: value.acquiredAt, updated_at: Date.now() };
  executeSqliteQuerySync(db, query.insertInto("state_leases").values({ scope: SCOPE, lease_key: value.root, ...fields })
    .onConflict(c => c.columns(["scope", "lease_key"]).doUpdateSet(fields)));
}
function credential(value: CheckoutWriterState): CheckoutWriterCredential {
  const { root, incarnation, generation, epoch, token, owner } = value;
  return structuredClone({ root, incarnation, generation, epoch, token, owner });
}
function current(input: CheckoutWriterCredential): CheckoutWriterState {
  const row = read(input.root);
  if (!row || row.epoch !== input.epoch || row.token !== input.token || row.generation !== input.generation
    || row.incarnation !== input.incarnation || digest(row.owner) !== digest(normalizeIdentity(input.owner))) {
    throw new Error("checkout_writer_stale_credential");
  }
  return row;
}
function assertAdmission(value: CheckoutWriterState): void {
  if (value.state !== "active") throw new Error("checkout_writer_not_active");
  if (Date.now() < value.acquiredAt || (value.expiresAt !== null && Date.now() >= value.expiresAt)) throw new Error("checkout_writer_recovery_required");
  if (filesystemInstance(value.root) !== value.incarnation) throw new Error("checkout_writer_incarnation_changed");
}

function retireAbandonedMaintenance(value: CheckoutWriterState): void {
  if (value.state === "released" || value.owner.kind !== "maintenance" || value.operations.length !== 0) return;
  let exited = false;
  try { process.kill(value.holderPid, 0); }
  catch (error) { exited = (error as NodeJS.ErrnoException).code === "ESRCH"; }
  if (!exited) exited = taskLedgerOwnerWasReplaced({ pid: value.holderPid, incarnation: value.holderIncarnation, publishedAt: value.acquiredAt });
  if (!exited) return;
  // Only a maintenance reservation with no admitted effect is recoverable by
  // process death. Run writers and any in-flight operation remain occupied.
  value.state = "released";
  save(value);
}

/** This resource credential does not grant Task Ledger, session or permission authority. */
export function claimCheckoutWriter(basis: CheckoutWriterBasis, owner: CheckoutWriterIdentity, requestId: string, expiresAt: number | null = null): CheckoutWriterCredential {
  const root = canonicalWorktreePath(basis.root);
  text(basis.generation); text(basis.incarnation); text(requestId);
  if (filesystemInstance(root) !== basis.incarnation) throw new Error("checkout_writer_incarnation_changed");
  if (expiresAt !== null && (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now())) throw new Error("checkout_writer_invalid_expiry");
  const normalized = normalizeIdentity(owner);
  const holderIncarnation = taskLedgerOwnIncarnation();
  const requestDigest = digest({ root, incarnation: basis.incarnation, generation: basis.generation, owner: normalized, expiresAt });
  return runOpenClawStateWriteTransaction(() => {
    const previous = read(root);
    if (previous) retireAbandonedMaintenance(previous);
    const priorRequest = previous?.requests.find(request => request.id === requestId);
    if (priorRequest && previous) {
      if (priorRequest.digest !== requestDigest) throw new Error("checkout_writer_request_conflict");
      if (priorRequest.epoch !== previous.epoch) throw new Error("checkout_writer_request_retired");
      assertAdmission(previous);
      return credential(previous);
    }
    if (previous && previous.state !== "released") throw new Error("checkout_writer_busy");
    const next: CheckoutWriterState = { schema: 1, root, incarnation: basis.incarnation, generation: basis.generation,
      epoch: (previous?.epoch ?? 0) + 1, token: randomUUID(), owner: normalized, requestId, requestDigest,
      state: "active", acquiredAt: Date.now(), expiresAt, operations: [], requests: previous?.requests ?? [],
      holderPid: process.pid, holderIncarnation };
    if (!Number.isSafeInteger(next.epoch)) throw new Error("checkout_writer_epoch_exhausted");
    next.requests.push({ id: requestId, digest: requestDigest, epoch: next.epoch });
    save(next); return credential(next);
  });
}

export function checkoutWriterSnapshot(root: string): CheckoutWriterState | null {
  if (existsSync(root)) return read(canonicalWorktreePath(root));
  const normalized = path.resolve(root.replace(/^\\\\\?\\UNC\\/u, "\\\\").replace(/^\\\\\?\\/u, ""));
  return read(process.platform === "win32" ? normalized.toLowerCase() : normalized);
}

export function checkoutWritersForRun(runId: string, sessionKey: string, sessionGeneration: string): CheckoutWriterState[] {
  const { db } = openOpenClawStateDatabase();
  const query = getNodeSqliteKysely<WriterDatabase>(db);
  const rows = executeSqliteQuerySync(db, query.selectFrom('state_leases').select('lease_key').where('scope', '=', SCOPE)).rows;
  return rows.map(row => read(row.lease_key)).filter((row): row is CheckoutWriterState => Boolean(row
    && row.state !== 'released' && row.owner.kind === 'run' && row.owner.run.runId === runId
    && row.owner.run.scope.sessionKey === sessionKey && row.owner.sessionGeneration === sessionGeneration));
}

/** The composition owner proves task transfer and process drain; this transaction never exposes an unowned gap. */
export function transferCheckoutWriter(input: CheckoutWriterCredential, owner: CheckoutWriterIdentity, requestId: string): CheckoutWriterCredential {
  text(requestId);
  const normalized = normalizeIdentity(owner);
  if (input.owner.kind !== "run" || normalized.kind !== "run") throw new Error("checkout_writer_transfer_run_required");
  const requestDigest = digest({ from: input, owner: normalized });
  return runOpenClawStateWriteTransaction(() => {
    const existing = read(input.root);
    const prior = existing?.requests.find(request => request.id === requestId);
    if (prior && existing) {
      if (prior.digest !== requestDigest) throw new Error("checkout_writer_request_conflict");
      if (prior.epoch !== existing.epoch) throw new Error("checkout_writer_request_retired");
      assertAdmission(existing);
      return credential(existing);
    }
    const row = current(input);
    if (row.state !== "draining") throw new Error("checkout_writer_transfer_requires_drain");
    if (row.operations.some(operation => operation.state !== "settled")) throw new Error("checkout_writer_operations_pending");
    if (filesystemInstance(row.root) !== row.incarnation) throw new Error("checkout_writer_incarnation_changed");
    if (Date.now() < row.acquiredAt || (row.expiresAt !== null && Date.now() >= row.expiresAt)) throw new Error("checkout_writer_recovery_required");
    const epoch = row.epoch + 1;
    if (!Number.isSafeInteger(epoch)) throw new Error("checkout_writer_epoch_exhausted");
    const next: CheckoutWriterState = { ...row, epoch, token: randomUUID(), owner: normalized,
      requestId, requestDigest, state: "active", acquiredAt: Date.now(), expiresAt: null, operations: [],
      terminalReceipt: undefined,
      holderPid: process.pid, holderIncarnation: taskLedgerOwnIncarnation(),
      requests: [...row.requests, { id: requestId, digest: requestDigest, epoch }],
    };
    save(next);
    return credential(next);
  });
}

/** A persisted cleanup plus observed absence can finish its own receipt after a crash. */
export function finishRemovedCheckoutCleanup(basis: CheckoutWriterBasis): void {
  if (existsSync(basis.root)) throw new Error("checkout_cleanup_still_present");
  const row = checkoutWriterSnapshot(basis.root);
  if (!row || row.state === "released") return;
  if (row.generation !== basis.generation || row.incarnation !== basis.incarnation
    || row.owner.kind !== "maintenance" || row.owner.operation !== "cleanup" || row.operations.length !== 1) {
    throw new Error("checkout_cleanup_writer_mismatch");
  }
  const operation = row.operations[0];
  if (operation.state !== "settled") settleCheckoutWrite(row, operation.id, { outcome: "completed", ownerReceipt: `cleanup-absence:${row.owner.operationId}` });
  releaseCheckoutWriter(row);
}
export function beginCheckoutWrite(input: CheckoutWriterCredential, operationId: string, requestDigest: string): { state: "started" } | { state: "replayed"; receipt: CheckoutWriteReceipt } {
  text(operationId); text(requestDigest);
  return runOpenClawStateWriteTransaction(() => {
    const row = current(input); assertAdmission(row);
    const prior = row.operations.find(op => op.id === operationId);
    if (prior) {
      if (prior.digest !== requestDigest) throw new Error("checkout_write_request_conflict");
      if (prior.state === "settled") return { state: "replayed", receipt: structuredClone(prior.receipt!) };
      throw new Error("checkout_write_outcome_pending");
    }
    if (row.operations.some(op => op.state !== "settled")) throw new Error("checkout_write_outcome_pending");
    row.operations.push({ id: operationId, digest: requestDigest, state: "running" }); save(row);
    return { state: "started" };
  });
}
export function settleCheckoutWrite(input: CheckoutWriterCredential, operationId: string, receipt: CheckoutWriteReceipt | null): void {
  if (receipt) { text(receipt.ownerReceipt); if (!["completed", "not-applied"].includes(receipt.outcome)) throw new Error("checkout_write_invalid_receipt"); }
  runOpenClawStateWriteTransaction(() => {
    const row = current(input);
    const operation = row.operations.find(op => op.id === operationId);
    if (!operation) throw new Error("checkout_write_unknown_operation");
    if (operation.state === "settled") {
      if (digest(operation.receipt) !== digest(receipt)) throw new Error("checkout_write_receipt_conflict");
      return;
    }
    if (row.state === "released") throw new Error("checkout_writer_not_active");
    if (receipt) { operation.state = "settled"; operation.receipt = { ...receipt }; }
    else { operation.state = "unknown"; row.state = "draining"; }
    save(row);
  });
}
export function drainCheckoutWriter(input: CheckoutWriterCredential): void {
  runOpenClawStateWriteTransaction(() => {
    const row = current(input);
    if (row.state === "released") return;
    row.state = "draining"; save(row);
  });
}
/** Only the originating run owner records this fact; timeouts and process lookup do not call it. */
export function endCheckoutWriter(input: CheckoutWriterCredential, receipt: CheckoutWriterTerminalReceipt): void {
  text(receipt.ownerReceipt);
  if (input.owner.kind !== "run" || receipt.runId !== input.owner.run.runId
    || receipt.sessionGeneration !== input.owner.sessionGeneration || !Number.isFinite(receipt.endedAt) || receipt.endedAt <= 0)
    throw new Error("checkout_writer_terminal_mismatch");
  runOpenClawStateWriteTransaction(() => {
    const row = current(input);
    if (row.terminalReceipt) {
      if (digest(row.terminalReceipt) !== digest(receipt)) throw new Error("checkout_writer_terminal_conflict");
      return;
    }
    row.terminalReceipt = { ...receipt };
    if (row.state !== "released") row.state = "draining";
    save(row);
  });
}
export function releaseCheckoutWriter(input: CheckoutWriterCredential): void {
  runOpenClawStateWriteTransaction(() => {
    const row = current(input);
    if (row.operations.some(op => op.state !== "settled")) throw new Error("checkout_writer_operations_pending");
    row.state = "released"; save(row);
  });
}
/** Compensate a new reservation only while no effect has ever consumed it. */
export function releaseUnusedCheckoutWriter(input: CheckoutWriterCredential): void {
  runOpenClawStateWriteTransaction(() => {
    const row = current(input);
    if (row.operations.length) throw new Error("checkout_writer_already_used");
    row.state = "released"; save(row);
  });
}

/** Acquire all roots before the first effect; compensations release only unused claims. */
export function withCheckoutMaintenance<T>(bases: readonly CheckoutWriterBasis[], operation: "merge" | "freeze" | "cleanup", effect: () => T, prepare?: () => void): T {
  const operationId = randomUUID();
  const claims: CheckoutWriterCredential[] = [];
  try {
    for (const basis of [...new Map(bases.map(b => [canonicalWorktreePath(b.root), b])).values()].sort((a, b) => a.root.localeCompare(b.root))) {
      claims.push(claimCheckoutWriter(basis, { kind: "maintenance", operation, operationId }, operationId));
    }
  } catch (error) { for (const claim of claims) releaseCheckoutWriter(claim); throw error; }
  try {
    // Preparation records metadata only. A failure here cannot have reached the
    // filesystem effect, so its reserved claims can be safely returned.
    prepare?.();
    for (const claim of claims) beginCheckoutWrite(claim, operationId, digest({ operation, roots: claims.map(c => [c.root, c.incarnation, c.generation]) }));
  } catch (error) {
    // No filesystem action has started. Settle only successfully admitted permits.
    for (const claim of claims) {
      if (current(claim).operations.some(op => op.id === operationId)) settleCheckoutWrite(claim, operationId, { outcome: "not-applied", ownerReceipt: `preflight:${operationId}` });
      releaseCheckoutWriter(claim);
    }
    throw error;
  }
  let result: T;
  try {
    result = effect();
    if (result && typeof (result as { then?: unknown }).then === "function") throw new Error("checkout_maintenance_requires_sync_effect");
  } catch (error) { for (const claim of claims) settleCheckoutWrite(claim, operationId, null); throw error; }
  for (const claim of claims) settleCheckoutWrite(claim, operationId, { outcome: "completed", ownerReceipt: `${operation}:${operationId}` });
  for (const claim of claims) releaseCheckoutWriter(claim);
  return result;
}
