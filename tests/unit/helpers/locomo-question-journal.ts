// Per-question durability journal for the LoCoMo 500-question evaluation.
//
// Why this exists: the report used to be written only after the whole loop
// finished, and every judged answer lived in memory. Any interruption -- the
// watchdog, an external kill, a stalled HTTP call -- discarded *every* answered
// question (run-09 died at 60/500 and left an empty reports/ directory). The
// journal makes each answered question durable the moment its batch finishes, so
// a later segment can continue the same logical run without re-paying for work
// that already produced a real generation + judge receipt.
//
// Boundaries:
//   - The journal is progress state, not evidence on its own. A `succeeded`
//     entry only ever holds a question whose answer came back from a real model
//     call with a receipt. A failed question is recorded as `failed` and never
//     becomes a result row.
//   - Receipts are run-level facts, not per-question facts: one question can make
//     several calls (generation, self-ask, judge) and the client does not label
//     them. They are journaled as their own `receipts` record so the final report
//     can be rebuilt and re-verified by scripts/check-locomo-evidence.mjs without
//     re-calling the model, and without inventing a question attribution.
//   - A torn trailing line (process killed mid-append) is ignored; a corrupt line
//     anywhere else is a hard error rather than silently dropped evidence.

import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, writeSync } from "node:fs";
import { dirname } from "node:path";

export const QUESTION_JOURNAL_FILE = "question-journal.jsonl";

/** The subset of a model receipt the journal retains so a report can be rebuilt. */
export type JournalModelReceipt = {
  completedAt: string;
  endpoint: string;
  requestedModel: string;
  returnedModel: string | null;
  responseId: string | null;
  requestSha256: string;
  responseSha256: string;
  status: 200;
  attempts: number;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  judgeEvidence?: { temperature: number; maxTokens: number; content: string };
};

/** A question result row, exactly as it appears in report.questionResults. */
export type JournalQuestionResult = {
  questionId: string;
  category: string;
  conversationId: string;
  question: string;
  goldEvidence: string[];
  recall5: number;
  retrievedFactSummaries: string[];
  contextRecall: number;
  judgeScore: number;
  judgeResponseId: string;
  escalationLevel: number;
  predictedAnswer: string;
  groundTruth: string;
  assembledContext: string;
};

export type JournalSucceededEntry = {
  version: 1;
  kind: "succeeded";
  questionId: string;
  category: string;
  conversationId: string;
  recordedAt: string;
  sourceRevision: string | null;
  result: JournalQuestionResult;
};

export type JournalFailedEntry = {
  version: 1;
  kind: "failed";
  questionId: string;
  category: string;
  conversationId: string;
  recordedAt: string;
  sourceRevision: string | null;
  reason: string;
};

/** One batch's worth of real model receipts, retained for run-level replay. */
export type JournalReceiptsEntry = {
  version: 1;
  kind: "receipts";
  recordedAt: string;
  sourceRevision: string | null;
  receipts: JournalModelReceipt[];
};

export type JournalEntry = JournalSucceededEntry | JournalFailedEntry | JournalReceiptsEntry;

export type LocomoQuestionJournal = {
  file: string;
  succeeded: Map<string, JournalSucceededEntry>;
  failed: Map<string, JournalFailedEntry>;
  /** Run-level receipts retained by earlier segments, deduped by response id. */
  receipts: JournalModelReceipt[];
  /** Questions appended more than once; the last entry wins and the clash is reported. */
  conflicts: string[];
  /** True when the final line was cut off mid-write and ignored. */
  tornTail: boolean;
};

export function emptyJournal(file: string): LocomoQuestionJournal {
  return { file, succeeded: new Map(), failed: new Map(), receipts: [], conflicts: [], tornTail: false };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isReceipt(value: unknown): value is JournalModelReceipt {
  return isRecord(value) && typeof value.responseId === "string" && value.status === 200;
}

function isJournalEntry(value: unknown): value is JournalEntry {
  if (!isRecord(value)) return false;
  if (value.version !== 1) return false;
  if (typeof value.recordedAt !== "string" || !value.recordedAt) return false;
  if (value.kind === "receipts") {
    return Array.isArray(value.receipts) && value.receipts.length > 0 && value.receipts.every(isReceipt);
  }
  if (typeof value.questionId !== "string" || !value.questionId) return false;
  if (typeof value.category !== "string" || typeof value.conversationId !== "string") return false;
  if (value.kind === "failed") return typeof value.reason === "string";
  if (value.kind !== "succeeded") return false;
  if (!isRecord(value.result) || value.result.questionId !== value.questionId) return false;
  return (
    typeof value.result.judgeScore === "number" &&
    typeof value.result.judgeResponseId === "string" &&
    typeof value.result.predictedAnswer === "string"
  );
}

/** Reads a journal, tolerating only a torn final line (a killed mid-append). */
export function readQuestionJournal(file: string): LocomoQuestionJournal {
  if (!existsSync(file)) return emptyJournal(file);
  const journal = emptyJournal(file);
  const seenReceipts = new Set<string>();
  const lines = readFileSync(file, "utf8").split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    if (raw.trim() === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      const trailing = lines.slice(index + 1).every((line) => line.trim() === "");
      if (trailing) {
        journal.tornTail = true;
        break;
      }
      throw new Error(`Corrupt question journal at line ${index + 1}: ${(error as Error).message}`, {
        cause: error,
      });
    }
    if (!isJournalEntry(parsed)) {
      throw new Error(`Corrupt question journal at line ${index + 1}: not a journal entry`);
    }
    if (parsed.kind === "receipts") {
      for (const receipt of parsed.receipts) {
        const responseId = receipt.responseId;
        if (responseId === null || seenReceipts.has(responseId)) continue;
        seenReceipts.add(responseId);
        journal.receipts.push(receipt);
      }
      continue;
    }
    const already = journal.succeeded.get(parsed.questionId) ?? journal.failed.get(parsed.questionId);
    if (already) journal.conflicts.push(parsed.questionId);
    if (parsed.kind === "succeeded") {
      journal.succeeded.set(parsed.questionId, parsed);
      journal.failed.delete(parsed.questionId);
    } else {
      journal.failed.set(parsed.questionId, parsed);
      journal.succeeded.delete(parsed.questionId);
    }
  }
  return journal;
}

/**
 * Appends one entry and fsyncs before returning. A plain append can sit in the OS
 * buffer, which defeats the point: the question must be on disk before the process
 * risks dying.
 */
export function appendQuestionJournalEntry(file: string, entry: JournalEntry): void {
  mkdirSync(dirname(file), { recursive: true });
  const line = JSON.stringify(entry) + "\n";
  const fd = openSync(file, "a");
  try {
    writeSync(fd, line);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** Questions that still need a real model answer: never answered, or last attempt failed. */
export function pendingQuestionIds(
  journal: LocomoQuestionJournal,
  allQuestionIds: readonly string[],
): string[] {
  return allQuestionIds.filter((questionId) => !journal.succeeded.has(questionId));
}

/** Succeeded entries in the order the caller lists the questions. */
export function replaySucceeded(
  journal: LocomoQuestionJournal,
  allQuestionIds: readonly string[],
): JournalSucceededEntry[] {
  return allQuestionIds.flatMap((questionId) => {
    const entry = journal.succeeded.get(questionId);
    return entry ? [entry] : [];
  });
}

/**
 * Concatenates retained and live receipts, dropping any duplicate `responseId`.
 * The verifier rejects a duplicate response id, and a resumed segment must never
 * re-count a receipt it already retained.
 */
export function mergeJournalReceipts(
  retained: readonly JournalModelReceipt[],
  liveReceipts: readonly JournalModelReceipt[],
): JournalModelReceipt[] {
  const merged: JournalModelReceipt[] = [];
  const seen = new Set<string>();
  for (const receipt of [...retained, ...liveReceipts]) {
    const responseId = receipt.responseId;
    if (responseId === null || seen.has(responseId)) continue;
    seen.add(responseId);
    merged.push(receipt);
  }
  return merged;
}

/** True when a receipt can be retained as run evidence at all. */
export function isRetainableReceipt(receipt: JournalModelReceipt): boolean {
  return receipt.status === 200 && typeof receipt.responseId === "string" && receipt.responseId.length > 0;
}

/**
 * The logical run starts when its earliest retained evidence did, so receipts from
 * every segment fall inside [startedAt, generatedAt] and the verifier can accept a
 * report assembled across bounded segments.
 *
 * Retained receipts are included, not just retained questions: a resumed segment
 * carries every receipt the journal kept, and the extraction calls that produced the
 * reused fact cache precede the first judged question (observed: 124 s earlier). A
 * window widened by questions alone rejects those receipts with "Receipt outside this
 * run" even though they belong to the same logical run.
 */
export function journalStartedAt(
  replayed: readonly JournalSucceededEntry[],
  fallback: string,
  retainedReceipts: readonly JournalModelReceipt[] = [],
): string {
  let earliest = Date.parse(fallback);
  if (!Number.isFinite(earliest)) return fallback;
  const consider = (when: number) => {
    if (Number.isFinite(when) && when < earliest) earliest = when;
  };
  for (const entry of replayed) consider(Date.parse(entry.recordedAt));
  for (const receipt of retainedReceipts) consider(Date.parse(receipt.completedAt));
  return new Date(earliest).toISOString();
}

/** A duplicate question id across segments is a hard error; the report must not guess. */
export function assertNoQuestionOverlap(
  retainedIds: ReadonlySet<string>,
  newlyAnsweredIds: readonly string[],
): void {
  const clash = newlyAnsweredIds.find((questionId) => retainedIds.has(questionId));
  if (clash) throw new Error(`Question answered twice in one logical run: ${clash}`);
}
