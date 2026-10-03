import { describe, expect, it } from "vitest";
import { applyRecordOperations, researchRows } from "./domain.js";

const source = JSON.stringify({
  schemaVersion: "research-comparison/v1",
  title: "研究表",
  sources: [{ id: "src-a", locator: "fixture://a", label: "A" }],
  records: [
    { id: "rec-a", subject: "A", finding: "旧", evidenceState: "unlinked", evidenceRefs: [], limitations: null },
    { id: "rec-b", subject: "B", finding: "乙", evidenceState: "unlinked", evidenceRefs: [], limitations: null },
  ],
}, null, 2) + "\n";

describe("structured artifact record operations", () => {
  it("uses stable IDs for insert, move, and delete", () => {
    const result = applyRecordOperations(source, [
      { op: "insertRecord", record: { id: "rec-c", subject: "C", finding: "丙", evidenceState: "unlinked", evidenceRefs: [], limitations: null }, afterId: "rec-a" },
      { op: "moveRecord", recordId: "rec-b", beforeId: "rec-a" },
      { op: "deleteRecord", recordId: "rec-c" },
    ], "research-table");
    expect(result.changed).toBe(true);
    expect(result.recordIds).toEqual(["rec-b", "rec-a"]);
    expect(researchRows(result.candidate).map((row) => row.id)).toEqual(["rec-b", "rec-a"]);
  });

  it("rejects invalid adjacency and duplicate IDs", () => {
    expect(() => applyRecordOperations(source, [{ op: "moveRecord", recordId: "rec-a", beforeId: "missing" }], "research-table")).toThrow(/beforeId not found/);
    expect(() => applyRecordOperations(source, [{ op: "insertRecord", record: { id: "rec-a" } }], "research-table")).toThrow(/already exists/);
  });
});
