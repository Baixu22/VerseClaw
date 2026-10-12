// Proves the durability contract the 500-question evaluator now depends on:
// a killed process may lose at most the batch it was inside, and a failed
// question must never be mistaken for a judged one.
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendQuestionJournalEntry,
  assertNoQuestionOverlap,
  emptyJournal,
  isRetainableReceipt,
  journalStartedAt,
  mergeJournalReceipts,
  pendingQuestionIds,
  readQuestionJournal,
  replaySucceeded,
  type JournalFailedEntry,
  type JournalModelReceipt,
  type JournalReceiptsEntry,
  type JournalSucceededEntry,
} from "./helpers/locomo-question-journal";

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "locomo-journal-"));
  file = join(dir, "question-journal.jsonl");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function receipt(responseId: string, completedAt = "2026-10-12T00:00:10.000Z"): JournalModelReceipt {
  return {
    completedAt,
    endpoint: "https://api.example.test/v1/chat/completions",
    requestedModel: "step-5-preview",
    returnedModel: "step-5-preview",
    responseId,
    requestSha256: "a".repeat(64),
    responseSha256: "b".repeat(64),
    status: 200,
    attempts: 1,
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };
}

function succeeded(
  questionId: string,
  overrides: Partial<JournalSucceededEntry> = {},
): JournalSucceededEntry {
  return {
    version: 1,
    kind: "succeeded",
    questionId,
    category: "single_hop",
    conversationId: "conv-1",
    recordedAt: "2026-10-12T00:00:20.000Z",
    sourceRevision: "deadbeef",
    result: {
      questionId,
      category: "single_hop",
      conversationId: "conv-1",
      question: "What did they drink?",
      goldEvidence: ["D1:1"],
      recall5: 1,
      retrievedFactSummaries: ["they drank tea"],
      contextRecall: 1,
      judgeScore: 1,
      judgeResponseId: "resp-" + questionId,
      escalationLevel: 0,
      predictedAnswer: "tea",
      groundTruth: "tea",
      assembledContext: "they drank tea",
    },
    ...overrides,
  };
}

function failed(questionId: string, reason: string): JournalFailedEntry {
  return {
    version: 1,
    kind: "failed",
    questionId,
    category: "single_hop",
    conversationId: "conv-1",
    recordedAt: "2026-10-12T00:00:30.000Z",
    sourceRevision: "deadbeef",
    reason,
  };
}

function receiptsEntry(ids: string[], recordedAt = "2026-10-12T00:00:11.000Z"): JournalReceiptsEntry {
  return { version: 1, kind: "receipts", recordedAt, sourceRevision: "deadbeef", receipts: ids.map((id) => receipt(id)) };
}

describe("locomo question journal", () => {
  it("treats a missing journal as empty progress", () => {
    const journal = readQuestionJournal(file);
    expect(journal.succeeded.size).toBe(0);
    expect(journal.failed.size).toBe(0);
    expect(journal.receipts).toEqual([]);
    expect(journal.tornTail).toBe(false);
  });

  it("round-trips a succeeded question", () => {
    appendQuestionJournalEntry(file, succeeded("q1"));
    const journal = readQuestionJournal(file);
    expect(journal.succeeded.get("q1")?.result.judgeScore).toBe(1);
    expect(journal.succeeded.get("q1")?.result.judgeResponseId).toBe("resp-q1");
    // The append is durable immediately, not merely buffered in the process.
    expect(readFileSync(file, "utf8").endsWith("\n")).toBe(true);
  });

  it("keeps every earlier question when the last append was cut off", () => {
    appendQuestionJournalEntry(file, succeeded("q1"));
    appendQuestionJournalEntry(file, succeeded("q2"));
    appendFileSync(file, '{"version":1,"kind":"succeeded","questionId":"q3"', "utf8");
    const journal = readQuestionJournal(file);
    expect([...journal.succeeded.keys()]).toEqual(["q1", "q2"]);
    expect(journal.tornTail).toBe(true);
    expect(pendingQuestionIds(journal, ["q1", "q2", "q3"])).toEqual(["q3"]);
  });

  it("refuses to silently drop a corrupt line that is not the tail", () => {
    appendQuestionJournalEntry(file, succeeded("q1"));
    writeFileSync(
      file,
      readFileSync(file, "utf8") + "{not json}\n" + JSON.stringify(succeeded("q2")) + "\n",
      "utf8",
    );
    expect(() => readQuestionJournal(file)).toThrow(/Corrupt question journal at line 2/);
  });

  it("records a failure as pending rather than as a judged question", () => {
    appendQuestionJournalEntry(file, succeeded("q1"));
    appendQuestionJournalEntry(file, failed("q2", "Runtime memory LLM API 429"));
    const journal = readQuestionJournal(file);
    expect(journal.succeeded.has("q2")).toBe(false);
    expect(journal.failed.get("q2")?.reason).toContain("429");
    expect(pendingQuestionIds(journal, ["q1", "q2", "q3"])).toEqual(["q2", "q3"]);
    expect(replaySucceeded(journal, ["q1", "q2", "q3"]).map((entry) => entry.questionId)).toEqual(["q1"]);
  });

  it("lets a later success for a retried question replace the earlier failure", () => {
    appendQuestionJournalEntry(file, failed("q2", "429"));
    appendQuestionJournalEntry(file, succeeded("q2"));
    const journal = readQuestionJournal(file);
    expect(journal.failed.has("q2")).toBe(false);
    expect(journal.succeeded.get("q2")?.result.judgeScore).toBe(1);
    expect(pendingQuestionIds(journal, ["q2"])).toEqual([]);
  });

  it("reports a duplicate question id instead of hiding the clash", () => {
    appendQuestionJournalEntry(file, succeeded("q1"));
    appendQuestionJournalEntry(file, succeeded("q1"));
    const journal = readQuestionJournal(file);
    expect(journal.conflicts).toEqual(["q1"]);
    expect(journal.succeeded.size).toBe(1);
  });

  it("retains run-level receipts and dedupes them across segments", () => {
    appendQuestionJournalEntry(file, receiptsEntry(["resp-a", "resp-b"]));
    appendQuestionJournalEntry(file, receiptsEntry(["resp-b", "resp-c"]));
    const journal = readQuestionJournal(file);
    expect(journal.receipts.map((entry) => entry.responseId)).toEqual(["resp-a", "resp-b", "resp-c"]);
    // A live segment must not re-count a receipt an earlier segment already kept.
    const merged = mergeJournalReceipts(journal.receipts, [receipt("resp-c"), receipt("resp-d")]);
    expect(merged.map((entry) => entry.responseId)).toEqual(["resp-a", "resp-b", "resp-c", "resp-d"]);
  });

  it("only retains receipts that can be evidence", () => {
    expect(isRetainableReceipt(receipt("resp-a"))).toBe(true);
    expect(isRetainableReceipt({ ...receipt("resp-a"), responseId: null })).toBe(false);
  });

  it("starts the logical run at the earliest retained answer", () => {
    const replayed = [
      succeeded("q1", { recordedAt: "2026-10-11T20:00:00.000Z" }),
      succeeded("q2", { recordedAt: "2026-10-12T06:00:00.000Z" }),
    ];
    expect(journalStartedAt(replayed, "2026-10-12T09:00:00.000Z")).toBe("2026-10-11T20:00:00.000Z");
    expect(journalStartedAt([], "2026-10-12T09:00:00.000Z")).toBe("2026-10-12T09:00:00.000Z");
  });

  it("refuses a logical run that answered the same question twice", () => {
    expect(() => assertNoQuestionOverlap(new Set(["q1"]), ["q2", "q1"])).toThrow(/answered twice/);
    expect(() => assertNoQuestionOverlap(new Set(["q1"]), ["q2"])).not.toThrow();
    expect(emptyJournal(file).succeeded.size).toBe(0);
  });
});
