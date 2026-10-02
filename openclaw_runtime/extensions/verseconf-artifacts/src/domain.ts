import { createHash } from "node:crypto";
import type { ArtifactKind } from "./types.js";

export type RecordOperation =
  | { op: "insertRecord"; record: Record<string, unknown>; beforeId?: string; afterId?: string }
  | { op: "deleteRecord"; recordId: string }
  | { op: "moveRecord"; recordId: string; beforeId?: string; afterId?: string };

export type RecordOperationResult = {
  candidate: string;
  changed: boolean;
  recordIds: string[];
  touchedRecordIds: string[];
};

function parseDocument(source: string): Record<string, unknown> {
  const value = JSON.parse(source) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("artifact source root must be a JSON object");
  return value as Record<string, unknown>;
}

function recordsOf(document: Record<string, unknown>): Array<Record<string, unknown>> {
  const records = document.records;
  if (!Array.isArray(records) || records.some((record) => !record || typeof record !== "object" || Array.isArray(record))) {
    throw new Error("artifact source records must be an array of objects");
  }
  return records as Array<Record<string, unknown>>;
}

function recordId(record: Record<string, unknown>): string {
  const id = record.id;
  if (typeof id !== "string" || !id.trim()) throw new Error("every record must have a non-empty string id");
  return id;
}

function assertUniqueIds(records: Array<Record<string, unknown>>): string[] {
  const ids = records.map(recordId);
  if (new Set(ids).size !== ids.length) throw new Error("record IDs must be unique");
  return ids;
}

function insertionIndex(records: Array<Record<string, unknown>>, beforeId?: string, afterId?: string): number {
  if (beforeId && afterId) throw new Error("beforeId and afterId are mutually exclusive");
  if (beforeId) {
    const index = records.findIndex((record) => recordId(record) === beforeId);
    if (index < 0) throw new Error(`beforeId not found: ${beforeId}`);
    return index;
  }
  if (afterId) {
    const index = records.findIndex((record) => recordId(record) === afterId);
    if (index < 0) throw new Error(`afterId not found: ${afterId}`);
    return index + 1;
  }
  return records.length;
}

export function applyRecordOperations(source: string, operations: RecordOperation[], kind: ArtifactKind): RecordOperationResult {
  if (operations.length === 0) throw new Error("record operation list cannot be empty");
  if (operations.length > 64) throw new Error("record operation limit exceeded");
  const document = parseDocument(source);
  const records = recordsOf(document).map((record) => ({ ...record }));
  assertUniqueIds(records);
  const touched = new Set<string>();

  for (const operation of operations) {
    if (operation.op === "insertRecord") {
      if (kind !== "research-table" && kind !== "slide-outline") throw new Error("insert is unsupported for this artifact kind");
      const id = recordId(operation.record);
      if (records.some((record) => recordId(record) === id)) throw new Error(`record ID already exists: ${id}`);
      const index = insertionIndex(records, operation.beforeId, operation.afterId);
      records.splice(index, 0, { ...operation.record });
      touched.add(id);
      continue;
    }
    const index = records.findIndex((record) => recordId(record) === operation.recordId);
    if (index < 0) throw new Error(`record not found: ${operation.recordId}`);
    touched.add(operation.recordId);
    if (operation.op === "deleteRecord") {
      records.splice(index, 1);
      continue;
    }
    const [record] = records.splice(index, 1);
    const insertion = insertionIndex(records, operation.beforeId, operation.afterId);
    records.splice(insertion, 0, record);
  }

  const nextDocument = { ...document, records };
  const candidate = `${JSON.stringify(nextDocument, null, 2)}\n`;
  return {
    candidate,
    changed: candidate !== source,
    recordIds: records.map(recordId),
    touchedRecordIds: [...touched],
  };
}

export type ResearchRow = {
  id: string;
  subject: string;
  finding: string;
  evidenceState: string;
  evidenceRefs: string[];
  limitations: string | null;
  notes?: string | null;
};

export function researchRows(source: string): ResearchRow[] {
  const document = parseDocument(source);
  return recordsOf(document).map((record) => ({
    id: recordId(record),
    subject: typeof record.subject === "string" ? record.subject : "",
    finding: typeof record.finding === "string" ? record.finding : "",
    evidenceState: typeof record.evidenceState === "string" ? record.evidenceState : "",
    evidenceRefs: Array.isArray(record.evidenceRefs) ? record.evidenceRefs.filter((value): value is string => typeof value === "string") : [],
    limitations: typeof record.limitations === "string" ? record.limitations : null,
    ...(typeof record.notes === "string" || record.notes === null ? { notes: record.notes } : {}),
  }));
}

export function sourceDigest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
