import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import {
  executeSqliteQuerySync, executeSqliteQueryTakeFirstSync, getNodeSqliteKysely,
} from "../../infra/kysely-sync.js";
import type { DB } from "../../state/openclaw-state-db.generated.js";
import { openOpenClawStateDatabase, runOpenClawStateWriteTransaction } from "../../state/openclaw-state-db.js";

const SCOPE = "verseshell-process-capacity/v1";
type CapacityDatabase = Pick<DB, "state_leases">;
export type ManagedProcessIdentity = {
  sessionKey: string;
  sessionGeneration: string;
  runId: string;
};

export type ManagedProcessReservation = {
  id: string;
  ownerPid: number;
  owner: string;
  limit?: number;
  ports: number[];
  phase: "reserved" | "dispatched" | "observed" | "terminal" | "unknown";
  failure?: string;
  rootPids?: number[];
  createdAt: number;
  /** Optional so reservations created before task-scope integration remain readable. */
  sessionKey?: string;
  sessionGeneration?: string;
  runId?: string;
};

export function normalizeManagedPorts(ports: readonly number[] = []): number[] {
  if (ports.some(port => !Number.isSafeInteger(port) || port < 1 || port > 65535)) throw new Error("E_PROCESS_PORT_INVALID");
  return [...new Set(ports)].sort((a, b) => a - b);
}

/** Probe external occupancy; the persistent reservation serializes managed launchers. */
export async function assertManagedPortsBindable(ports: readonly number[]): Promise<void> {
  for (const port of normalizeManagedPorts(ports)) {
    await new Promise<void>((resolve, reject) => {
      const server = createServer();
      server.once("error", error => reject(new Error(`E_PROCESS_PORT_UNAVAILABLE:${port}`, { cause: error })));
      server.listen({ port, host: "127.0.0.1", exclusive: true }, () => server.close(error => error ? reject(error) : resolve()));
    });
  }
}

function decode(raw: string | null): ManagedProcessReservation {
  const value = JSON.parse(raw ?? "null") as ManagedProcessReservation | null;
  if (!value?.id || !value.owner || !Number.isSafeInteger(value.ownerPid) || !Array.isArray(value.ports)
    || !["reserved", "dispatched", "observed", "terminal", "unknown"].includes(value.phase)) throw new Error("E_PROCESS_RESERVATION_INVALID");
  return value;
}

export function managedProcessReservations(): ManagedProcessReservation[] {
  const { db } = openOpenClawStateDatabase();
  const query = getNodeSqliteKysely<CapacityDatabase>(db);
  return executeSqliteQuerySync(db, query.selectFrom("state_leases").select("payload_json").where("scope", "=", SCOPE)).rows.map(row => decode(row.payload_json));
}

function normalizeManagedProcessIdentity(identity: ManagedProcessIdentity): ManagedProcessIdentity {
  const values = [identity.sessionKey, identity.sessionGeneration, identity.runId];
  if (values.some(value => typeof value !== "string" || !value.trim() || value.length > 2048))
    throw new Error("E_PROCESS_RESERVATION_IDENTITY_INVALID");
  return { sessionKey: identity.sessionKey, sessionGeneration: identity.sessionGeneration, runId: identity.runId };
}

export function reserveManagedProcess(input: {
  limit?: number;
  ports?: readonly number[];
  owner?: string;
  identity?: ManagedProcessIdentity;
}):
  | { ok: true; reservation: ManagedProcessReservation; live: number; limit?: number }
  | { ok: false; live: number; limit: number; reason: "capacity" }
  | { ok: false; reason: "port"; port: number; owner: string } {
  const ports = normalizeManagedPorts(input.ports);
  const identity = input.identity ? normalizeManagedProcessIdentity(input.identity) : undefined;
  return runOpenClawStateWriteTransaction(({ db }) => {
    const existing = managedProcessReservations();
    const limits = [input.limit, ...existing.map(row => row.limit)].filter((value): value is number => value !== undefined);
    const limit = limits.length ? Math.min(...limits) : undefined;
    const live = existing.length;
    if (limit !== undefined && live >= limit) return { ok: false, reason: "capacity", live, limit };
    const conflict = existing.find(row => row.ports.some(port => ports.includes(port)));
    if (conflict) return { ok: false, reason: "port", port: conflict.ports.find(port => ports.includes(port))!, owner: conflict.owner };
    const now = Date.now();
    const reservation: ManagedProcessReservation = {
      id: randomUUID(), ownerPid: process.pid, owner: input.owner ?? `runtime:${process.pid}`,
      ...(limit !== undefined ? { limit } : {}), ports, phase: "reserved", createdAt: now,
      ...(identity ?? {}),
    };
    const query = getNodeSqliteKysely<CapacityDatabase>(db);
    executeSqliteQuerySync(db, query.insertInto("state_leases").values({
      scope: SCOPE, lease_key: reservation.id, owner: reservation.owner, expires_at: null,
      heartbeat_at: null, payload_json: JSON.stringify(reservation), created_at: now, updated_at: now,
    }));
    return { ok: true, reservation, live: live + 1, ...(limit !== undefined ? { limit } : {}) };
  });
}

export function updateManagedProcessReservation(id: string, update: Partial<Pick<ManagedProcessReservation, "phase" | "rootPids" | "failure">>): void {
  runOpenClawStateWriteTransaction(({ db }) => {
    const query = getNodeSqliteKysely<CapacityDatabase>(db);
    const row = executeSqliteQueryTakeFirstSync(db, query.selectFrom("state_leases").selectAll().where("scope", "=", SCOPE).where("lease_key", "=", id));
    if (!row) return; // Native exit may have settled while OS observation was in flight.
    const current = decode(row.payload_json);
    if (current.ownerPid !== process.pid) throw new Error("E_PROCESS_RESERVATION_OWNER");
    executeSqliteQuerySync(db, query.updateTable("state_leases").set({ payload_json: JSON.stringify({ ...current, ...update }), updated_at: Date.now() }).where("scope", "=", SCOPE).where("lease_key", "=", id));
  });
}

export async function observeManagedProcessReservation(id: string, pid: number): Promise<void> {
  if (!Number.isSafeInteger(pid) || pid < 1) throw new Error("E_PROCESS_PID_UNKNOWN");
  // PID is diagnostic only; release is still driven by the native owner receipt.
  // A restart must never kill or release a reservation by testing this PID alone.
  updateManagedProcessReservation(id, { phase: "observed", rootPids: [pid] });
}

export function releaseManagedProcessReservation(id: string): boolean {
  return runOpenClawStateWriteTransaction(({ db }) => {
    const query = getNodeSqliteKysely<CapacityDatabase>(db);
    const record = managedProcessReservations().find(row => row.id === id);
    if (!record) return false;
    if (record.ownerPid !== process.pid) throw new Error("E_PROCESS_RESERVATION_OWNER");
    return executeSqliteQuerySync(db, query.deleteFrom("state_leases").where("scope", "=", SCOPE).where("lease_key", "=", id)).numAffectedRows === 1n;
  });
}

/** Reconcile only facts that prove no native effect remains; unknown starts stay visible. */
export async function reconcileManagedProcessReservations(): Promise<Array<{ id: string; outcome: "released" | "retained"; reason: string }>> {
  const results: Array<{ id: string; outcome: "released" | "retained"; reason: string }> = [];
  for (const record of managedProcessReservations()) {
    let ownerGone = false;
    try { process.kill(record.ownerPid, 0); }
    catch (error) { ownerGone = (error as NodeJS.ErrnoException).code === "ESRCH"; }
    if (record.phase !== "terminal" && !(record.phase === "reserved" && ownerGone)) {
      results.push({ id: record.id, outcome: "retained", reason: ownerGone ? "native-outcome-unknown" : "owner-active-or-unavailable" });
      continue;
    }
    try { await assertManagedPortsBindable(record.ports); }
    catch { results.push({ id: record.id, outcome: "retained", reason: "port-still-occupied" }); continue; }
    const removed = runOpenClawStateWriteTransaction(({ db }) => {
      const query = getNodeSqliteKysely<CapacityDatabase>(db);
      return executeSqliteQuerySync(db, query.deleteFrom("state_leases").where("scope", "=", SCOPE)
        .where("lease_key", "=", record.id).where("payload_json", "=", JSON.stringify(record))).numAffectedRows === 1n;
    });
    results.push({ id: record.id, outcome: removed ? "released" : "retained", reason: removed ? "confirmed-terminal-or-never-dispatched" : "owner-state-changed" });
  }
  return results;
}
