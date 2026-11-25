import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getNodeSqliteKysely, executeSqliteQuerySync } from "../../infra/kysely-sync.js";
import {
  openExecutionStateDatabase,
  runExecutionStateWriteTransaction,
} from "../../state/execution-state-db.js";
import { closeOpenClawStateDatabaseForTest } from "../../state/openclaw-state-db.js";
import type { DB } from "../../state/openclaw-state-db.generated.js";
import {
  admitManagedProcess,
  configureManagedProcessCapacity,
  resetManagedProcessCapacity,
} from "./managed-process-capacity.js";
import {
  managedProcessHostPressureLimit,
  managedProcessReservations,
  pruneManagedProcessHostPressure,
} from "./managed-process-reservation.js";

const probes = vi.hoisted(() => ({ birth: vi.fn() }));
vi.mock("../../../../shared/task-ledger-process.js", () => ({
  readTaskLedgerProcessIncarnation: probes.birth,
}));
const scope = "verseshell-host-pressure/v1";
let epoch = 0;
function seedPeerPressure() {
  runExecutionStateWriteTransaction(({ db }) => {
    const query = getNodeSqliteKysely<Pick<DB, "state_leases">>(db);
    executeSqliteQuerySync(
      db,
      query.insertInto("state_leases").values({
        scope,
        lease_key: "424242",
        owner: "peer-observer",
        expires_at: null,
        heartbeat_at: null,
        payload_json: JSON.stringify({
          ownerPid: 424242,
          ownerEpoch: `peer-${++epoch}`,
          ownerIncarnation: "1000",
          limit: 1,
        }),
        created_at: Date.now(),
        updated_at: Date.now(),
      }),
    );
  });
}
beforeEach(() => {
  probes.birth.mockReset();
  vi.spyOn(process, "kill").mockReturnValue(true);
  configureManagedProcessCapacity({ maxLiveProcesses: 2 });
});
afterEach(() => {
  resetManagedProcessCapacity();
  const { db } = openExecutionStateDatabase();
  const query = getNodeSqliteKysely<Pick<DB, "state_leases">>(db);
  executeSqliteQuerySync(db, query.deleteFrom("state_leases").where("scope", "=", scope));
  closeOpenClawStateDatabaseForTest();
  vi.restoreAllMocks();
});

describe("pressure observer identity", () => {
  it.each([
    ["1000", 0],
    ["2000", 1],
    [null, 0],
  ] as const)(
    "retains unknown reservations while observing peer birth %s",
    (currentBirth, removed) => {
      const native = admitManagedProcess();
      if (!native.ok) throw new Error("initial native reservation failed");
      native.lease.markUnknown("native-outcome-unavailable");
      seedPeerPressure();
      probes.birth.mockReturnValue(currentBirth);
      expect(pruneManagedProcessHostPressure()).toBe(removed);
      expect(managedProcessHostPressureLimit()).toBe(removed ? undefined : 1);
      expect(managedProcessReservations()).toContainEqual(
        expect.objectContaining({ id: native.lease.reservationId, phase: "unknown" }),
      );
    },
  );
  it("removes a confirmed dead observer without probing birth or clearing native reservations", () => {
    const native = admitManagedProcess();
    if (!native.ok) throw new Error("initial reservation failed");
    seedPeerPressure();
    vi.mocked(process.kill).mockImplementation(() => {
      throw Object.assign(new Error("owner exited"), { code: "ESRCH" });
    });
    expect(pruneManagedProcessHostPressure()).toBe(1);
    expect(probes.birth).not.toHaveBeenCalled();
    expect(managedProcessReservations()).toHaveLength(1);
  });
});
