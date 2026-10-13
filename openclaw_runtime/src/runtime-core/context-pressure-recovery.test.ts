// @vitest-environment node
// L02: bounded context-pressure recovery projection.
import { describe, expect, it } from "vitest";

import type { TaskLedgerEvent, TaskLedgerEventInput } from "../../../shared/types/task-ledger";
import {
  createTaskLedgerWorkingContextDecision,
  createTaskLedgerWorkingContextProposal,
  projectTaskLedgerWorkingContext,
  STAGE3_WORKING_CONTEXT_POLICY_DIGEST,
} from "../../../shared/task-ledger-working-context";
import { buildContextPressureRecovery } from "./context-pressure-recovery.js";

const workspaceId = "ws-l02";
const taskId = "task-l02";
const t0 = "2026-10-13T00:00:00.000Z";
const t1 = "2026-10-13T00:01:00.000Z";

function toEvent(event: TaskLedgerEventInput, id: string): TaskLedgerEvent {
  return { ...event, id, workspaceId, taskId: event.taskId ?? taskId, sessionId: null, createdAt: event.createdAt ?? t0 } as TaskLedgerEvent;
}

function accept(id: string, field: Parameters<typeof createTaskLedgerWorkingContextDecision>[0]["field"]) {
  const created = createTaskLedgerWorkingContextDecision({
    proposalId: id,
    field,
    version: 1,
    decision: "accepted",
    actor: "user",
    taskId,
    policyDigest: STAGE3_WORKING_CONTEXT_POLICY_DIGEST,
    createdAt: t1,
  });
  if (!created.ok) throw new Error(created.reason);
  return toEvent(created.event, `a-${id}`);
}

function acceptedSnapshot() {
  const events: TaskLedgerEvent[] = [];
  const fields: Array<[string, Parameters<typeof createTaskLedgerWorkingContextProposal>[0]["field"], unknown]> = [
    ["p-obj", "Objective", "Ship L02 context-pressure recovery"],
    ["p-next", "NextAction", "Run the recovery projection"],
    ["p-con", "Constraints", ["Do not drop the objective silently"]],
    ["p-evi", "Evidence", [{ type: "tool", ref: "tool:recovery-fixture" }]],
  ];
  for (const [id, field, value] of fields) {
    const built = createTaskLedgerWorkingContextProposal({ proposalId: id, field, value, version: 1, actor: "assistant", taskId, evidenceRefs: [{ type: "file", ref: `file:${id}` }], createdAt: t0 });
    if (!built.ok) throw new Error(built.reason);
    events.push(toEvent(built.event, `p-${id}`), accept(id, field));
  }
  return projectTaskLedgerWorkingContext(events);
}

describe("L02 context-pressure recovery", () => {
  it("recovers objective, unfinished work, dependencies and recent evidence in one deterministic projection", () => {
    const snapshot = acceptedSnapshot();
    const a = buildContextPressureRecovery({ snapshot, budgetChars: 10_000 });
    const b = buildContextPressureRecovery({ snapshot, budgetChars: 10_000 });
    expect(a.status).toBe("recovered");
    expect(a.sections.objective.join(" ")).toContain("Ship L02");
    expect(a.sections.unfinished.join(" ")).toContain("Run the recovery projection");
    expect(a.sections.dependencies.join(" ")).toContain("Do not drop");
    expect(a.sections.recentEvidence.join(" ")).toContain("tool:recovery-fixture");
    expect(a.truncated).toBe(false);
    expect(a.digest).toBe(b.digest);
    expect(a.digest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("never silently drops: a small budget truncates and counts every drop", () => {
    const snapshot = acceptedSnapshot();
    const full = buildContextPressureRecovery({ snapshot, budgetChars: 10_000 });
    const totalLines = Object.values(full.sections).flat().length;
    const tiny = buildContextPressureRecovery({ snapshot, budgetChars: 20 });
    expect(tiny.truncated).toBe(true);
    const kept = Object.values(tiny.sections).flat().length;
    const dropped = Object.values(tiny.dropped).reduce((sum, n) => sum + n, 0);
    expect(kept + dropped).toBe(totalLines);
    expect(tiny.usedChars).toBeLessThanOrEqual(20);
  });

  it("never fakes completion: the result is complete:false and an empty snapshot is unknown", () => {
    const recovered = buildContextPressureRecovery({ snapshot: acceptedSnapshot(), budgetChars: 10_000 });
    expect(recovered.complete).toBe(false);
    const unknown = buildContextPressureRecovery({ snapshot: projectTaskLedgerWorkingContext([]), budgetChars: 1_000 });
    expect(unknown.status).toBe("unknown");
    expect(unknown.sections.objective).toHaveLength(0);
    expect(unknown.complete).toBe(false);
  });

  it("has no silent recursion: exceeding maxDepth is refused explicitly", () => {
    const result = buildContextPressureRecovery({ snapshot: acceptedSnapshot(), budgetChars: 1_000, depth: 4, maxDepth: 3 });
    expect(result.status).toBe("depth-exceeded");
    expect(result.reason).toContain("exceeds maxDepth");
    expect(result.sections.objective).toHaveLength(0);
  });
});