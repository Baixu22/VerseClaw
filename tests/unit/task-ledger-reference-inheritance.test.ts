import { describe, expect, it } from "vitest";
import {
  TASK_LEDGER_REFERENCE_INHERITANCE,
  applyTaskLedgerReferenceInheritance,
  isTaskLedgerReferenceInheritedField,
  isTaskLedgerReferenceNonInheritedField,
} from "../../shared/types/task-ledger-reference";

describe("TaskLedgerReference inheritance table (TF-0449)", () => {
  it("declares a closed, explicit inheritance table", () => {
    expect(TASK_LEDGER_REFERENCE_INHERITANCE.inherits).toEqual(["priority", "tags", "owner"]);
    expect(TASK_LEDGER_REFERENCE_INHERITANCE.doesNotInherit).toEqual([
      "status",
      "projectId",
      "assignee",
    ]);
  });

  it("never lets status cross the one-way reference", () => {
    // The Ledger owns task status; a Workboard scheduling state must not
    // overwrite it. This is the single most important row of the table.
    expect(isTaskLedgerReferenceNonInheritedField("status")).toBe(true);
    expect(isTaskLedgerReferenceInheritedField("status")).toBe(false);
  });

  it("classifies each field into exactly one side of the table", () => {
    const all = [
      ...TASK_LEDGER_REFERENCE_INHERITANCE.inherits,
      ...TASK_LEDGER_REFERENCE_INHERITANCE.doesNotInherit,
    ];
    for (const field of all) {
      const inherited = isTaskLedgerReferenceInheritedField(field);
      const nonInherited = isTaskLedgerReferenceNonInheritedField(field);
      expect(inherited !== nonInherited).toBe(true);
    }
  });

  it("treats unknown fields as non-inherited (fail closed)", () => {
    expect(isTaskLedgerReferenceInheritedField("somethingElse")).toBe(false);
    expect(isTaskLedgerReferenceNonInheritedField("somethingElse")).toBe(false);
  });

  it("apply drops non-inherited fields from a scheduling patch", () => {
    const patch = applyTaskLedgerReferenceInheritance({
      priority: "high",
      tags: ["networking"],
      owner: "agent",
      status: "done",
      projectId: "p-123",
      assignee: "someone",
    });
    expect(patch).toEqual({ priority: "high", tags: ["networking"], owner: "agent" });
    expect("status" in patch).toBe(false);
    expect("projectId" in patch).toBe(false);
  });

  it("apply passes unknown fields through as dropped, not as inherited", () => {
    const patch = applyTaskLedgerReferenceInheritance({ unknownField: 1 });
    expect(patch).toEqual({});
  });

  it("apply preserves falsy-but-valid inherited values", () => {
    // priority 'low' and an empty tag list are real values, not absence.
    const patch = applyTaskLedgerReferenceInheritance({ priority: "low", tags: [] });
    expect(patch).toEqual({ priority: "low", tags: [] });
  });
});
