/**
 * Context discard attribution (TF-0644 / A4).
 *
 * TF-0138 measured the gap precisely: the runtime decides five kinds of drop and
 * already carries a reason for each candidate, but the table lives in an
 * in-memory Map and dies with the attempt. The only persisted carrier is keyed by
 * `turnId` / `attemptIndex` / `modelCallIndex`, so without those three a row
 * cannot be joined to anything.
 *
 * This module therefore does one job: after a decision is already made, write one
 * bounded row that names the class, the reason, the size and the turn identity.
 * It never decides anything, never re-injects, and never writes payload text -
 * counts, enum reasons, ids and the digests already inside `candidateId` only.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import type { ContextCandidateLineage } from "./context-candidate.js";

export const DISCARD_ATTRIBUTION_SCHEMA = "DiscardAttribution/v1" as const;
export const DISCARD_ATTRIBUTION_FILE = "context-discards.jsonl";
/** Kill switch. Explicit off wins; anything else leaves the default (on). */
export const DISCARD_ATTRIBUTION_ENV = "VERSE_CONTEXT_DISCARD_ATTRIBUTION";
/** One turn may not write an unbounded number of rows. */
export const DISCARD_ATTRIBUTION_MAX_ROWS_PER_TURN = 128;
/** Size guard: an audit trail must not become a disk problem. */
export const DISCARD_ATTRIBUTION_MAX_FILE_BYTES = 16 * 1024 * 1024;

/** The five classes TF-0138 could distinguish, in its own vocabulary. */
export type DiscardClass =
  | "compaction"
  | "budget-drop"
  | "limitHistoryTurns"
  | "archived"
  | "skipChannels";

export const DISCARD_CLASSES: readonly DiscardClass[] = [
  "compaction",
  "budget-drop",
  "limitHistoryTurns",
  "archived",
  "skipChannels",
] as const;

/** Where a row came from. Absent fields mean "this producer has no such fact". */
export type DiscardAttributionIdentity = {
  sessionKey?: string;
  sessionId?: string;
  turnId?: string;
  attemptIndex?: number;
  modelCallIndex?: number;
};

export type DiscardAttributionRecord = {
  schema: typeof DISCARD_ATTRIBUTION_SCHEMA;
  discardClass: DiscardClass;
  /** The owner's own reason enum; never free-form text about content. */
  reason: string;
  /** Join key: a candidate id, a boundary id, or a stable synthetic ref. */
  unitRef: string;
  sessionKey?: string;
  sessionId?: string;
  turnId?: string;
  attemptIndex?: number;
  modelCallIndex?: number;
  charsRequested: number;
  charsApplied: number;
  charsDropped: number;
  /** Message/chunk/token counts for the classes that are counted, not charged. */
  counts?: { messages?: number; chunks?: number; tokens?: number };
  /** The history limit that caused the cut, when one applies. */
  limit?: number;
  /** Compaction boundary facts, so the dropped set can be rebuilt later. */
  compactionBoundary?: {
    droppedChunks: number;
    droppedMessages: number;
    droppedTokens: number;
    budgetTokens?: number;
    keptTokens?: number;
    firstKeptEntryId?: string;
  };
  at: string;
};

const CHARS_FIELDS = ["charsRequested", "charsApplied", "charsDropped"] as const;

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/**
 * Reason and unit refs are owner-supplied strings, so they get the same defence
 * as everything else: no unbounded text, and credential-shaped substrings are
 * replaced before they can reach the file.
 */
export function redactAttributionToken(value: string, maxLength = 160): string {
  return value
    .trim()
    .replaceAll(/\s+/g, " ")
    .replaceAll(/sk-[A-Za-z0-9_-]{6,}/gi, "sk-[redacted]")
    .replaceAll(/(bearer)\s+\S+/gi, "$1 [redacted]")
    .replaceAll(/(api[_-]?key|password|passwd|token|secret)\s*[:=]\s*\S+/gi, "$1=[redacted]")
    .slice(0, maxLength);
}

function identityFields(identity: DiscardAttributionIdentity): DiscardAttributionIdentity {
  const out: DiscardAttributionIdentity = {};
  if (typeof identity.sessionKey === "string" && identity.sessionKey.trim()) {
    out.sessionKey = identity.sessionKey.trim();
  }
  if (typeof identity.sessionId === "string" && identity.sessionId.trim()) {
    out.sessionId = identity.sessionId.trim();
  }
  if (typeof identity.turnId === "string" && identity.turnId.trim()) {
    out.turnId = identity.turnId.trim();
  }
  if (typeof identity.attemptIndex === "number" && Number.isFinite(identity.attemptIndex)) {
    out.attemptIndex = Math.floor(identity.attemptIndex);
  }
  if (typeof identity.modelCallIndex === "number" && Number.isFinite(identity.modelCallIndex)) {
    out.modelCallIndex = Math.floor(identity.modelCallIndex);
  }
  return out;
}

/** One builder for every class, so the five shapes cannot drift apart. */
export function buildDiscardAttributionRecord(input: {
  discardClass: DiscardClass;
  reason: string;
  unitRef: string;
  identity?: DiscardAttributionIdentity;
  charsRequested?: number;
  charsApplied?: number;
  counts?: { messages?: number; chunks?: number; tokens?: number };
  limit?: number;
  compactionBoundary?: DiscardAttributionRecord["compactionBoundary"];
  at: string;
}): DiscardAttributionRecord {
  const charsRequested = count(input.charsRequested);
  const charsApplied = count(input.charsApplied);
  const counts = input.counts
    ? {
        ...(input.counts.messages !== undefined ? { messages: count(input.counts.messages) } : {}),
        ...(input.counts.chunks !== undefined ? { chunks: count(input.counts.chunks) } : {}),
        ...(input.counts.tokens !== undefined ? { tokens: count(input.counts.tokens) } : {}),
      }
    : undefined;
  return {
    schema: DISCARD_ATTRIBUTION_SCHEMA,
    discardClass: input.discardClass,
    reason: redactAttributionToken(input.reason),
    unitRef: redactAttributionToken(input.unitRef),
    ...identityFields(input.identity ?? {}),
    charsRequested,
    charsApplied,
    charsDropped: Math.max(0, charsRequested - charsApplied),
    ...(counts && Object.keys(counts).length > 0 ? { counts } : {}),
    ...(typeof input.limit === "number" ? { limit: count(input.limit) } : {}),
    ...(input.compactionBoundary ? { compactionBoundary: input.compactionBoundary } : {}),
    at: input.at,
  };
}

/**
 * Candidate-lineage rows.
 *
 * Only candidates that lost something produce a row: an applied candidate is not
 * a discard, and a `pending` one has not been decided yet.
 */
export function buildCandidateDiscardRecords(input: {
  lineage: readonly ContextCandidateLineage[];
  identity: DiscardAttributionIdentity;
  at: string;
  maxRows?: number;
}): DiscardAttributionRecord[] {
  const maxRows = input.maxRows ?? DISCARD_ATTRIBUTION_MAX_ROWS_PER_TURN;
  const records: DiscardAttributionRecord[] = [];
  for (const entry of input.lineage) {
    if (records.length >= maxRows) break;
    let discardClass: DiscardClass | null = null;
    if (entry.disposition === "duplicate") discardClass = "skipChannels";
    else if (entry.disposition === "skip") discardClass = "skipChannels";
    else if (entry.disposition === "drop" || entry.disposition === "truncate") {
      discardClass = "budget-drop";
    }
    if (!discardClass) continue;
    records.push(
      buildDiscardAttributionRecord({
        discardClass,
        reason: entry.reason,
        unitRef: entry.candidateId,
        identity: input.identity,
        charsRequested: entry.charsRequested,
        charsApplied: entry.charsApplied,
        at: input.at,
      }),
    );
  }
  return records;
}

/** `limitHistoryTurns` cut the head of the history; nothing else is claimed. */
export function buildHistoryLimitDiscardRecord(input: {
  identity: DiscardAttributionIdentity;
  limit: number | undefined;
  messagesBefore: number;
  messagesAfter: number;
  at: string;
}): DiscardAttributionRecord | null {
  const dropped = Math.max(0, input.messagesBefore - input.messagesAfter);
  if (dropped === 0) return null;
  return buildDiscardAttributionRecord({
    discardClass: "limitHistoryTurns",
    reason: "history-limit",
    unitRef: `history-limit:${count(input.limit)}`,
    identity: input.identity,
    counts: { messages: dropped },
    ...(input.limit !== undefined ? { limit: input.limit } : {}),
    at: input.at,
  });
}

/** The compaction safeguard dropped chunks before summarising them. */
export function buildCompactionDiscardRecord(input: {
  identity: DiscardAttributionIdentity;
  droppedChunks: number;
  droppedMessages: number;
  droppedTokens: number;
  budgetTokens?: number;
  keptTokens?: number;
  firstKeptEntryId?: string;
  reason?: string;
  at: string;
}): DiscardAttributionRecord | null {
  if (count(input.droppedChunks) === 0 && count(input.droppedMessages) === 0) return null;
  return buildDiscardAttributionRecord({
    discardClass: "compaction",
    reason: input.reason ?? "compaction-prune",
    unitRef: `compaction:${count(input.droppedChunks)}:${count(input.droppedMessages)}`,
    identity: input.identity,
    counts: { messages: input.droppedMessages, chunks: input.droppedChunks, tokens: input.droppedTokens },
    compactionBoundary: {
      droppedChunks: count(input.droppedChunks),
      droppedMessages: count(input.droppedMessages),
      droppedTokens: count(input.droppedTokens),
      ...(input.budgetTokens !== undefined ? { budgetTokens: count(input.budgetTokens) } : {}),
      ...(input.keptTokens !== undefined ? { keptTokens: count(input.keptTokens) } : {}),
      ...(input.firstKeptEntryId ? { firstKeptEntryId: input.firstKeptEntryId } : {}),
    },
    at: input.at,
  });
}

/**
 * Default on outside a test runner; the env switch overrides either way.
 *
 * Test runners are excluded by default so a suite that exercises the orchestrator
 * cannot append rows into the developer's real state dir. An explicit `1` still
 * forces it on when a test wants to prove the sink works.
 */
export function isDiscardAttributionEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env[DISCARD_ATTRIBUTION_ENV];
  const value = raw?.trim().toLowerCase();
  if (value === "0" || value === "false" || value === "no" || value === "off") return false;
  if (value === "1" || value === "true" || value === "yes" || value === "on") return true;
  if (env.VITEST || env.NODE_ENV === "test") return false;
  return true;
}

export function resolveDiscardAttributionPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveStateDir(env), DISCARD_ATTRIBUTION_FILE);
}

/**
 * Append rows, bounded, fail-safe.
 *
 * Returns how many rows were actually written. A failure to write is swallowed:
 * an audit trail must never be the reason a turn fails.
 */
export function appendDiscardAttributionRecords(params: {
  records: readonly DiscardAttributionRecord[];
  env?: NodeJS.ProcessEnv;
  pathname?: string;
}): number {
  const env = params.env ?? process.env;
  if (!isDiscardAttributionEnabled(env)) return 0;
  const rows = params.records.slice(0, DISCARD_ATTRIBUTION_MAX_ROWS_PER_TURN);
  if (rows.length === 0) return 0;
  try {
    const pathname = params.pathname ?? resolveDiscardAttributionPath(env);
    if (existsSync(pathname) && statSync(pathname).size > DISCARD_ATTRIBUTION_MAX_FILE_BYTES) {
      return 0;
    }
    mkdirSync(path.dirname(pathname), { recursive: true });
    appendFileSync(pathname, rows.map((row) => JSON.stringify(row)).join("\n") + "\n", "utf8");
    return rows.length;
  } catch {
    return 0;
  }
}

/** Read back the rows; malformed lines are skipped rather than thrown. */
export function readDiscardAttribution(params: {
  env?: NodeJS.ProcessEnv;
  pathname?: string;
} = {}): DiscardAttributionRecord[] {
  const pathname = params.pathname ?? resolveDiscardAttributionPath(params.env ?? process.env);
  try {
    if (!existsSync(pathname)) return [];
    const raw = readFileSync(pathname, "utf8");
    const rows: DiscardAttributionRecord[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as DiscardAttributionRecord;
        if (parsed?.schema === DISCARD_ATTRIBUTION_SCHEMA) rows.push(parsed);
      } catch {
        // A half-written line is not worth failing a reader over.
      }
    }
    return rows;
  } catch {
    return [];
  }
}

/** Fields a row is allowed to carry, so a writer cannot smuggle payload text. */
export const DISCARD_ATTRIBUTION_FIELDS: readonly string[] = [
  "schema",
  "discardClass",
  "reason",
  "unitRef",
  "sessionKey",
  "sessionId",
  "turnId",
  "attemptIndex",
  "modelCallIndex",
  ...CHARS_FIELDS,
  "counts",
  "limit",
  "compactionBoundary",
  "at",
] as const;