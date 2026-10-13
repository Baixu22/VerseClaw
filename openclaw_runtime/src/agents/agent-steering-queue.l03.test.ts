// @vitest-environment node
// L03: in-run steering accept — lease/ack/release, idempotent and cancel-safe.
import { describe, expect, it } from "vitest";

import type { SubagentRunRecord } from "./subagent-registry.types.js";
import {
  ackLeasedAgentSteeringItemsFromSubagentRuns,
  leasePendingAgentSteeringItemsFromSubagentRuns,
  listPendingAgentSteeringItemsFromSubagentRuns,
  releaseLeasedAgentSteeringItemsFromSubagentRuns,
} from "./agent-steering-queue.js";

const REQUESTER = "agent:main:requester";
const T0 = 1_000_000;

function makeRuns(runId: string, deliveryOverrides: Record<string, unknown> = {}, runOverrides: Record<string, unknown> = {}) {
  const runs = new Map<string, SubagentRunRecord>();
  runs.set(runId, {
    runId,
    childSessionKey: `agent:sub:${runId}`,
    requesterSessionKey: REQUESTER,
    requesterDisplayKey: "requester",
    task: `task-${runId}`,
    cleanup: "keep",
    createdAt: T0,
    delivery: {
      status: "pending",
      enqueuedAt: T0,
      payload: {
        requesterSessionKey: REQUESTER,
        requesterDisplayKey: "requester",
        childSessionKey: `agent:sub:${runId}`,
        childRunId: runId,
        task: `task-${runId}`,
        frozenResultText: `result-${runId}`,
      },
      ...deliveryOverrides,
    },
    ...runOverrides,
  } as never);
  return runs;
}

describe("L03 in-run steering accept", () => {
  it("leases a pending completion and marks it in_progress with the lease id", () => {
    const runs = makeRuns("run-1");
    const batch = leasePendingAgentSteeringItemsFromSubagentRuns({ runs, requesterSessionKey: REQUESTER, leaseId: "lease-a", now: T0 });
    expect(batch?.runIds).toEqual(["run-1"]);
    expect(batch?.prompt).toContain("result-run-1");
    expect(runs.get("run-1")!.delivery).toMatchObject({ status: "in_progress", steeringLeaseId: "lease-a" });
  });

  it("acks only the matching lease and is idempotent (no double delivery)", () => {
    const runs = makeRuns("run-1");
    leasePendingAgentSteeringItemsFromSubagentRuns({ runs, requesterSessionKey: REQUESTER, leaseId: "lease-a", now: T0 });
    expect(ackLeasedAgentSteeringItemsFromSubagentRuns({ runs, runIds: ["run-1"], leaseId: "wrong", now: T0 + 1 })).toBe(0);
    expect(runs.get("run-1")!.delivery!.status).toBe("in_progress");
    expect(ackLeasedAgentSteeringItemsFromSubagentRuns({ runs, runIds: ["run-1"], leaseId: "lease-a", now: T0 + 2 })).toBe(1);
    expect(runs.get("run-1")!.delivery!.status).toBe("delivered");
    // A second ack of the same lease is a no-op.
    expect(ackLeasedAgentSteeringItemsFromSubagentRuns({ runs, runIds: ["run-1"], leaseId: "lease-a", now: T0 + 3 })).toBe(0);
  });

  it("releases on a failed turn so the item is re-leased exactly once (no loss, no double inject)", () => {
    const runs = makeRuns("run-1");
    leasePendingAgentSteeringItemsFromSubagentRuns({ runs, requesterSessionKey: REQUESTER, leaseId: "lease-a", now: T0 });
    expect(releaseLeasedAgentSteeringItemsFromSubagentRuns({ runs, runIds: ["run-1"], leaseId: "lease-a", error: "turn failed" })).toBe(1);
    expect(runs.get("run-1")!.delivery!.status).toBe("pending");
    // A released lease cannot ack.
    expect(ackLeasedAgentSteeringItemsFromSubagentRuns({ runs, runIds: ["run-1"], leaseId: "lease-a", now: T0 + 1 })).toBe(0);
    const again = leasePendingAgentSteeringItemsFromSubagentRuns({ runs, requesterSessionKey: REQUESTER, leaseId: "lease-b", now: T0 + 2 });
    expect(again?.runIds).toEqual(["run-1"]);
  });

  it("does not re-lease a cancelled/discarded or already-delivered completion (cancel stops further effect)", () => {
    for (const status of ["delivered", "discarded", "failed"] as const) {
      const runs = makeRuns(`run-${status}`, { status });
      const batch = leasePendingAgentSteeringItemsFromSubagentRuns({ runs, requesterSessionKey: REQUESTER, leaseId: "lease-x", now: T0 });
      expect(batch, status).toBeUndefined();
      expect(listPendingAgentSteeringItemsFromSubagentRuns({ runs, requesterSessionKey: REQUESTER, now: T0 })).toHaveLength(0);
    }
  });

  it("re-leases a stale in-progress lease so a restarted turn does not strand a completion", () => {
    const staleLeasedAt = T0 - 6 * 60 * 1000;
    const runs = makeRuns("run-1", { status: "in_progress", steeringLeaseId: "lease-old", steeringLeasedAt: staleLeasedAt });
    const batch = leasePendingAgentSteeringItemsFromSubagentRuns({ runs, requesterSessionKey: REQUESTER, leaseId: "lease-new", now: T0 });
    expect(batch?.runIds).toEqual(["run-1"]);
    expect(runs.get("run-1")!.delivery).toMatchObject({ steeringLeaseId: "lease-new" });
  });

  it("ignores completions for a different requester session", () => {
    const runs = makeRuns("run-1");
    const batch = leasePendingAgentSteeringItemsFromSubagentRuns({ runs, requesterSessionKey: "agent:other", leaseId: "lease-a", now: T0 });
    expect(batch).toBeUndefined();
  });
});