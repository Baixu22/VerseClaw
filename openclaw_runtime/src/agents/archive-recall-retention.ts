/** Bounded projection retention for verified, session-local archive recall results. */
import { isRecord } from "@openclaw/normalization-core/record-coerce";
import type { AgentMessage } from "./runtime/index.js";

export const ARCHIVE_RECALL_RETENTION_TURNS = 4;
export const ARCHIVE_RECALL_RETENTION_MAX_CHARS = 16_000;

export type ArchiveRecallRetentionOptions = {
  enabled?: boolean;
  sessionId?: string;
  /** A caller may tighten the fixed cap to its existing projection budget. */
  maxChars?: number;
  /** The per-result limit is separate from the combined retained-text cap. */
  maxResultChars?: number;
};

export type RetainedArchiveRecall = {
  index: number;
  chars: number;
  recalledTurn: number;
  ageTurns: number;
  archiveUri: string;
  checksum: string;
  toolCallId: string;
};

/** Derive retention from the current transcript; no timers, durable queues, or re-injection. */
export function getRetainedArchiveRecalls(
  messages: readonly (AgentMessage | undefined)[],
  options: ArchiveRecallRetentionOptions = {},
): RetainedArchiveRecall[] {
  const sessionId = options.sessionId?.trim();
  if (options.enabled !== true || !sessionId) {
    return [];
  }
  const requestedCap = options.maxChars ?? ARCHIVE_RECALL_RETENTION_MAX_CHARS;
  if (!Number.isFinite(requestedCap) || requestedCap <= 0) {
    return [];
  }
  const maxChars = Math.min(ARCHIVE_RECALL_RETENTION_MAX_CHARS, Math.floor(requestedCap));
  const requestedResultCap = options.maxResultChars ?? maxChars;
  if (!Number.isFinite(requestedResultCap) || requestedResultCap <= 0) {
    return [];
  }
  const maxResultChars = Math.min(maxChars, Math.floor(requestedResultCap));
  const assistantTurns = messages.reduce(
    (count, message) => count + Number(message?.role === "assistant"),
    0,
  );
  const retained: RetainedArchiveRecall[] = [];
  const seenPages = new Set<string>();
  let retainedChars = 0;
  let ageTurns = 0;

  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message?.role === "assistant") {
      ageTurns++;
      if (ageTurns >= ARCHIVE_RECALL_RETENTION_TURNS) {
        break;
      }
    }
    if (
      message?.role !== "toolResult" ||
      message.toolName !== "context_archive_recall" ||
      message.isError
    ) {
      continue;
    }
    const details = message.details;
    if (!isRecord(details) || details.ok !== true || !isRecord(details.archiveRecallOrigin)) {
      continue;
    }
    const origin = details.archiveRecallOrigin;
    if (
      origin.source !== "context_archive_recall" ||
      origin.sessionId !== sessionId ||
      typeof origin.toolCallId !== "string" ||
      !origin.toolCallId.trim() ||
      origin.toolCallId !== message.toolCallId ||
      origin.archiveUri !== details.archive_uri ||
      origin.checksum !== details.checksum ||
      typeof origin.offset !== "number" ||
      !Number.isSafeInteger(origin.offset) ||
      origin.offset < 0 ||
      origin.offset !== details.offset ||
      typeof origin.archiveUri !== "string" ||
      !origin.archiveUri.startsWith(`context-archive://${encodeURIComponent(sessionId)}/`) ||
      typeof origin.checksum !== "string" ||
      !/^sha256:[a-f0-9]{64}$/i.test(origin.checksum)
    ) {
      continue;
    }
    const page = `${origin.archiveUri}\0${origin.checksum}\0${origin.offset}`;
    if (seenPages.has(page)) {
      continue;
    }
    // A verified newer recall owns its page even if later projection or budget
    // checks reject it; an older excerpt must not regain protection instead.
    seenPages.add(page);
    // Only the verified tool's text projection is eligible. Hidden details are
    // neither provider-visible evidence nor an extra retained payload budget.
    if (
      !Array.isArray(message.content) ||
      !message.content.every((block) => block?.type === "text" && typeof block.text === "string")
    ) {
      continue;
    }
    const chars = message.content.reduce(
      (sum, block) => sum + (block.type === "text" ? block.text.length : 0),
      0,
    );
    if (chars <= 0 || origin.projectedChars !== chars) {
      continue;
    }
    if (chars > maxResultChars || retainedChars + chars > maxChars) {
      continue;
    }
    retainedChars += chars;
    retained.push({
      index,
      chars,
      recalledTurn: assistantTurns - ageTurns,
      ageTurns,
      archiveUri: origin.archiveUri,
      checksum: origin.checksum,
      toolCallId: message.toolCallId,
    });
  }
  return retained;
}

/** Carry verified lineage through the existing provider-owned call-id rewrite. */
export function preserveArchiveRecallOriginAfterIdRewrite(
  original: Extract<AgentMessage, { role: "toolResult" }>,
  rewritten: Extract<AgentMessage, { role: "toolResult" }>,
): Extract<AgentMessage, { role: "toolResult" }> {
  if (
    original.toolCallId === rewritten.toolCallId ||
    !isRecord(original.details) ||
    !isRecord(original.details.archiveRecallOrigin)
  ) {
    return rewritten;
  }
  const origin = original.details.archiveRecallOrigin;
  const details = { ...(isRecord(rewritten.details) ? rewritten.details : {}) };
  delete details.archiveRecallOrigin;
  // Validate against the old id before changing it. A mismatched origin must
  // never become eligible merely because a normalizer rewrites the result id.
  if (
    typeof origin.sessionId === "string" &&
    getRetainedArchiveRecalls([original], {
      enabled: true,
      sessionId: origin.sessionId,
    }).length === 1
  ) {
    details.archiveRecallOrigin = { ...origin, toolCallId: rewritten.toolCallId };
  }
  return { ...rewritten, details };
}
