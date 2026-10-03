import { describe, expect, it } from "vitest";

import { normalizeCronJobCreate } from "./normalize.js";
import { getInvalidPersistedCronJobReason } from "./persisted-shape.js";
import { bindPayloadColumns, payloadFromRow } from "./store/payload-codec.js";
import type { CronJobRow } from "./store/schema.js";
import type { CronPayload } from "./types.js";

/**
 * A `missionContinuation` payload is how a mission timer reuses the single Cron
 * scheduler instead of standing up a second timer loop. It must survive the
 * persist/load round-trip intact, or the job is quarantined on reload and the
 * mission parks forever.
 */
const CONTINUATION: CronPayload = {
  kind: "missionContinuation",
  taskId: "task-timer-1",
  missionId: "mission-timer-1",
};

function rowFrom(payload: CronPayload): CronJobRow {
  return bindPayloadColumns(payload) as unknown as CronJobRow;
}

describe("cron missionContinuation payload", () => {
  it("round-trips through the SQLite column codec", () => {
    const columns = bindPayloadColumns(CONTINUATION);
    expect(columns.payload_kind).toBe("missionContinuation");
    // The payload must never carry an instruction-shaped field.
    expect(columns.payload_model).toBeNull();
    expect(columns.payload_tools_allow_json).toBeNull();
    expect(columns.payload_timeout_seconds).toBeNull();

    expect(payloadFromRow(rowFrom(CONTINUATION))).toEqual(CONTINUATION);
  });

  it("refuses a row whose ledger identity is missing", () => {
    expect(
      payloadFromRow({
        payload_kind: "missionContinuation",
        payload_message: JSON.stringify({ taskId: "", missionId: "mission-1" }),
      } as unknown as CronJobRow),
    ).toBeNull();
    expect(
      payloadFromRow({
        payload_kind: "missionContinuation",
        payload_message: null,
      } as unknown as CronJobRow),
    ).toBeNull();
    expect(
      payloadFromRow({
        payload_kind: "missionContinuation",
        payload_message: "not json",
      } as unknown as CronJobRow),
    ).toBeNull();
  });

  it("passes the persisted-shape gate only with a complete identity", () => {
    const base = {
      id: "cron-timer-1",
      schedule: { kind: "at", at: "2026-08-23T12:00:00.000Z" },
    };
    expect(
      getInvalidPersistedCronJobReason({ ...base, payload: { ...CONTINUATION } }),
    ).toBeNull();
    expect(
      getInvalidPersistedCronJobReason({
        ...base,
        payload: { kind: "missionContinuation", missionId: "mission-1" },
      }),
    ).toBe("invalid-payload");
    expect(
      getInvalidPersistedCronJobReason({
        ...base,
        payload: { kind: "missionContinuation", taskId: "task-1", missionId: "   " },
      }),
    ).toBe("invalid-payload");
    // An unknown kind is still quarantined.
    expect(
      getInvalidPersistedCronJobReason({ ...base, payload: { kind: "somethingElse" } }),
    ).toBe("invalid-payload");
  });

  it("canonicalizes the kind and strips instruction fields on normalize", () => {
    const normalized = normalizeCronJobCreate({
      name: "mission timer",
      schedule: { kind: "at", at: "2026-08-23T12:00:00.000Z" },
      payload: {
        kind: "missioncontinuation",
        taskId: "task-timer-1",
        missionId: "mission-timer-1",
        // Anything instruction-shaped must be dropped, not carried.
        message: "do something",
        argv: ["rm", "-rf", "/"],
        toolsAllow: ["bash"],
        timeoutSeconds: 99,
      },
    });
    expect(normalized).not.toBeNull();
    const payload = (normalized as { payload: Record<string, unknown> }).payload;
    expect(payload.kind).toBe("missionContinuation");
    expect(payload.taskId).toBe("task-timer-1");
    expect(payload.missionId).toBe("mission-timer-1");
    expect(payload.message).toBeUndefined();
    expect(payload.argv).toBeUndefined();
    expect(payload.toolsAllow).toBeUndefined();
    expect(payload.timeoutSeconds).toBeUndefined();
  });
});
