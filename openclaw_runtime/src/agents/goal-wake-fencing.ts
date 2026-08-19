// Runtime Lifecycle Governance — mission fencing CAS writers.
//
// Phase 0 foundation. `mission_runs` revision/active_tick_id/last_wake_id
// fencing is the durable effect-owner dedupe used by the Phase 3 goal-wake
// runtime. The active mission-control path stays on the legacy blind upsert
// unless RUNTIME_LIFECYCLE_MISSION_FENCING_ENABLED is truthy.
import type { Selectable } from "kysely";

import { isTruthyEnvValue } from "../infra/env.js";
import {
  executeSqliteQuerySync,
  executeSqliteQueryTakeFirstSync,
  getNodeSqliteKysely,
} from "../infra/kysely-sync.js";
import {
  runOpenClawStateWriteTransaction,
  type OpenClawStateDatabaseOptions,
} from "../state/openclaw-state-db.js";
import type { DB as OpenClawStateKyselyDatabase } from "../state/openclaw-state-db.generated.js";
import type { MissionRunRecord, MissionStatus } from "./mission-control/types.js";
import {
  buildMissionRunInsertValues,
  buildMissionRunUpdateSet,
  getMissionRun,
} from "./mission-control/store.js";

export const RUNTIME_LIFECYCLE_MISSION_FENCING_ENABLED_ENV =
  "RUNTIME_LIFECYCLE_MISSION_FENCING_ENABLED";

type MissionDatabase = Pick<OpenClawStateKyselyDatabase, "mission_runs">;
type MissionRunRow = Selectable<OpenClawStateKyselyDatabase["mission_runs"]>;

export type MissionFencingWriteResult =
  | { ok: true; row: MissionRunRow; revision: number }
  | {
      ok: false;
      reason: "revision-conflict" | "status-conflict" | "duplicate-wake" | "not-found";
      message?: string;
    };

export type MissionTickClaim = {
  missionId: string;
  expectedRevision: number;
  activeTickId: string;
  wakeId?: string;
  allowedStatuses: MissionStatus[];
  /** Goal-wake continuation requires a fully idle mission: no active_tick_id. */
  requireIdle?: boolean;
};

export type MissionTickFinish = {
  missionId: string;
  expectedRevision: number;
  activeTickId: string;
  lastWakeId?: string | null;
  status?: MissionStatus;
};

function normalizeNumber(value: number | bigint | null | undefined): number | undefined {
  if (typeof value === "bigint") return Number(value);
  return typeof value === "number" ? value : undefined;
}

function missionFencingEnabled(): boolean {
  return isTruthyEnvValue(process.env[RUNTIME_LIFECYCLE_MISSION_FENCING_ENABLED_ENV]);
}

export function isMissionFencingEnabled(): boolean {
  return missionFencingEnabled();
}

function assertExpectedRevision(record: MissionRunRecord): number {
  if (typeof record.revision !== "number" || !Number.isInteger(record.revision)) {
    throw new Error(
      `mission fencing requires an integer revision (mission=${record.missionId})`,
    );
  }
  return record.revision;
}

export function saveMissionRunFenced(record: MissionRunRecord): MissionRunRecord {
  let conflict: string | undefined;
  runOpenClawStateWriteTransaction(({ db }) => {
    const query = getNodeSqliteKysely<MissionDatabase>(db);
    const existing = executeSqliteQueryTakeFirstSync(
      db,
      query.selectFrom("mission_runs").selectAll().where("mission_id", "=", record.missionId),
    );

    if (!existing) {
      if (record.revision !== undefined && record.revision !== 0) {
        conflict = `new mission requires revision 0, got ${record.revision}`;
        return;
      }
      const values = {
        ...buildMissionRunInsertValues(record),
        revision: 0,
        active_tick_id: record.activeTickId ?? null,
        last_wake_id: record.lastWakeId ?? null,
      };
      executeSqliteQuerySync(db, query.insertInto("mission_runs").values(values));
      return;
    }

    const expectedRevision = assertExpectedRevision(record);
    const currentRevision = normalizeNumber(existing.revision) ?? 0;
    if (currentRevision !== expectedRevision) {
      conflict = `expected revision ${expectedRevision}, got ${currentRevision}`;
      return;
    }
    const nextRevision = currentRevision + 1;
    const update = {
      ...buildMissionRunUpdateSet(record),
      revision: nextRevision,
    };
    const result = executeSqliteQuerySync(
      db,
      query
        .updateTable("mission_runs")
        .set(update)
        .where("mission_id", "=", record.missionId)
        .where("revision", "=", expectedRevision),
    );
    if (Number(result.numAffectedRows ?? 0n) === 0) {
      conflict = `no mission row updated (revision guard) for ${record.missionId}`;
    }
  });
  if (conflict) throw new Error(conflict);
  return getMissionRun(record.missionId) ?? record;
}

export function claimMissionTick(
  input: MissionTickClaim,
  options: OpenClawStateDatabaseOptions = {},
): MissionFencingWriteResult {
  let result: MissionFencingWriteResult | undefined;
  runOpenClawStateWriteTransaction(({ db }) => {
    const query = getNodeSqliteKysely<MissionDatabase>(db);
    const existing = executeSqliteQueryTakeFirstSync(
      db,
      query.selectFrom("mission_runs").selectAll().where("mission_id", "=", input.missionId),
    );
    if (!existing) {
      result = { ok: false, reason: "not-found" };
      return;
    }
    const currentRevision = normalizeNumber(existing.revision) ?? 0;
    if (currentRevision !== input.expectedRevision) {
      result = {
        ok: false,
        reason: "revision-conflict",
        message: `expected revision ${input.expectedRevision}, got ${currentRevision}`,
      };
      return;
    }
    if (input.wakeId && existing.last_wake_id === input.wakeId) {
      result = { ok: false, reason: "duplicate-wake", message: `wake already consumed: ${input.wakeId}` };
      return;
    }
    const currentStatus = existing.status as MissionStatus;
    if (!input.allowedStatuses.includes(currentStatus)) {
      result = {
        ok: false,
        reason: "status-conflict",
        message: `mission ${currentStatus} is not claimable`,
      };
      return;
    }
    if (input.requireIdle === true && existing.active_tick_id != null) {
      result = {
        ok: false,
        reason: "status-conflict",
        message: `mission ${input.missionId} still has active tick ${existing.active_tick_id}`,
      };
      return;
    }
    const nextRevision = currentRevision + 1;
    const now = Date.now();
    const updateResult = executeSqliteQuerySync(
      db,
      query
        .updateTable("mission_runs")
        .set({
          status: "running",
          tick_count: (normalizeNumber(existing.tick_count) ?? 0) + 1,
          active_tick_id: input.activeTickId,
          last_wake_id: input.wakeId ?? existing.last_wake_id,
          revision: nextRevision,
          updated_at: now,
        })
        .where("mission_id", "=", input.missionId)
        .where("revision", "=", input.expectedRevision),
    );
    if (Number(updateResult.numAffectedRows ?? 0n) === 0) {
      result = { ok: false, reason: "revision-conflict", message: "no row updated (revision guard)" };
      return;
    }
    const updated = executeSqliteQueryTakeFirstSync(
      db,
      query.selectFrom("mission_runs").selectAll().where("mission_id", "=", input.missionId),
    );
    result = updated
      ? { ok: true, row: updated, revision: nextRevision }
      : { ok: false, reason: "not-found" };
  }, options);
  return result ?? { ok: false, reason: "not-found" };
}

export function finishMissionTick(
  input: MissionTickFinish,
  options: OpenClawStateDatabaseOptions = {},
): MissionFencingWriteResult {
  let result: MissionFencingWriteResult | undefined;
  runOpenClawStateWriteTransaction(({ db }) => {
    const query = getNodeSqliteKysely<MissionDatabase>(db);
    const existing = executeSqliteQueryTakeFirstSync(
      db,
      query.selectFrom("mission_runs").selectAll().where("mission_id", "=", input.missionId),
    );
    if (!existing) {
      result = { ok: false, reason: "not-found" };
      return;
    }
    const currentRevision = normalizeNumber(existing.revision) ?? 0;
    if (currentRevision !== input.expectedRevision) {
      result = {
        ok: false,
        reason: "revision-conflict",
        message: `expected revision ${input.expectedRevision}, got ${currentRevision}`,
      };
      return;
    }
    if (existing.active_tick_id !== input.activeTickId) {
      result = {
        ok: false,
        reason: "revision-conflict",
        message: `active_tick_id mismatch for ${input.missionId}`,
      };
      return;
    }
    const nextRevision = currentRevision + 1;
    const now = Date.now();
    const updateResult = executeSqliteQuerySync(
      db,
      query
        .updateTable("mission_runs")
        .set({
          status: input.status ?? (existing.status as MissionStatus),
          active_tick_id: null,
          last_wake_id: input.lastWakeId === undefined ? existing.last_wake_id : input.lastWakeId,
          revision: nextRevision,
          updated_at: now,
        })
        .where("mission_id", "=", input.missionId)
        .where("revision", "=", input.expectedRevision)
        .where("active_tick_id", "=", input.activeTickId),
    );
    if (Number(updateResult.numAffectedRows ?? 0n) === 0) {
      result = { ok: false, reason: "revision-conflict", message: "no row updated (revision guard)" };
      return;
    }
    const updated = executeSqliteQueryTakeFirstSync(
      db,
      query.selectFrom("mission_runs").selectAll().where("mission_id", "=", input.missionId),
    );
    result = updated
      ? { ok: true, row: updated, revision: nextRevision }
      : { ok: false, reason: "not-found" };
  }, options);
  return result ?? { ok: false, reason: "not-found" };
}


export const missionFencingController = {
  isMissionFencingEnabled,
  saveMissionRunFenced,
  claimMissionTick,
  finishMissionTick,
};
