import { describe, expect, it } from "vitest";
import {
  RUNTIME_LINEAGE_SCHEMA,
  isRuntimeLineage,
  mergeRuntimeLineage,
  normalizeRuntimeLineage,
} from "./lineage.js";

describe("runtime lineage", () => {
  it("normalizes known IDs without inferring missing fields", () => {
    const lineage = normalizeRuntimeLineage({
      sessionId: " session-a ",
      missionId: "mission-a",
      missionTick: 2,
      loopRunId: "loop-a",
      traceId: "trace-a",
      taskLedgerRootId: "ledger-a",
      unknown: "ignored",
    });
    expect(lineage).toEqual({
      schema: RUNTIME_LINEAGE_SCHEMA,
      sessionId: "session-a",
      missionId: "mission-a",
      missionTick: 2,
      loopRunId: "loop-a",
      traceId: "trace-a",
      taskLedgerRootId: "ledger-a",
    });
    expect(lineage?.sessionId).not.toBe(lineage?.missionId);
  });

  it("fails closed for missing or invalid session identity", () => {
    expect(normalizeRuntimeLineage({ missionId: "mission-a" })).toBeUndefined();
    expect(normalizeRuntimeLineage({ sessionId: "session-a", missionTick: -1 })).toEqual({
      schema: RUNTIME_LINEAGE_SCHEMA,
      sessionId: "session-a",
    });
    expect(normalizeRuntimeLineage({ sessionId: "x".repeat(257) })).toBeUndefined();
  });

  it("accepts only the canonical serialized shape", () => {
    const lineage = normalizeRuntimeLineage({ sessionId: "session-a", missionTick: 0 });
    expect(isRuntimeLineage(lineage)).toBe(true);
    expect(isRuntimeLineage({ ...lineage, extra: "nope" })).toBe(false);
    expect(isRuntimeLineage({ ...lineage, missionTick: "0" })).toBe(false);
  });

  it("merges explicit fields while preserving the parent session", () => {
    expect(
      mergeRuntimeLineage(
        { sessionId: "session-a", missionId: "mission-a" },
        { loopRunId: "loop-a", traceId: "trace-a" },
      ),
    ).toEqual({
      schema: RUNTIME_LINEAGE_SCHEMA,
      sessionId: "session-a",
      missionId: "mission-a",
      loopRunId: "loop-a",
      traceId: "trace-a",
    });
  });
});
