Review the supplied final commit and full current function below. The nested shell tool has failed in this desktop environment; its feature is disabled for this read-only review. All relevant source is included. Do not call unavailable inspection tools or enumerate the repository. Return the required structured JSON from this supplied code. This is a final-commit review, not a full-branch acceptance claim.

Review commit HEAD (16da6fdf22b0bda023becffa4272373be610ab54) in the supplied patch. Return the required structured JSON. Use read-only inspection only when the patch leaves a concrete dependency question; do not enumerate the repository, run tests, start another review, or audit old global release records.

This final change validates previously trusted recall lineage before retention and call-id rewriting: toolCallId must be a nonempty, non-whitespace string; the page offset must be a nonnegative safe integer. The shared getRetainedArchiveRecalls selector is the validation authority used by preserveArchiveRecallOriginAfterIdRewrite. Failed validation removes origin metadata rather than creating a valid binding with the rewritten ID. Source session, archive URI/checksum, text-only projection, per-result/aggregate limits and ageTurns < 4 remain required. Retention is opt-in, default off, capped at 16000 visible characters, without a new store, queue or timer.

The new regressions start with the actual recall tool's verified receipt, clone it, and corrupt both message/origin call-id fields or both offset fields. Both tests failed before the change; all 175 retention/provider/pruner/config tests passed afterward, alongside 20 reference regressions, uncached node/web/test typecheck, contract and comms checks. A separate guarded JSONL replay confirms malformed records are ineligible and cannot be healed. Current deterministic/live four-arm evaluation passed; the live model is the owner's space-bunny provider. No formal two-role acceptance, release approval or whole-repository passing claim is made.

Verify the commit's concrete correctness, regression and trust-boundary effects. The prior whole-branch review was interrupted and has no usable conclusion; this run is explicitly a final-commit review, not a replacement claim that the entire branch passed independent acceptance. Reject speculative rewrites. Use repository-relative code_location.file_path values. Stop once your structured result is ready.


## Current source openclaw_runtime/src/agents/archive-recall-retention.ts
```ts
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

```


## Current source openclaw_runtime/src/agents/tool-call-id.ts
```ts
  });

  if (!changed) {
    return params.message;
  }
  return { ...params.message, content: next as typeof params.message.content };
}

function rewriteToolResultIds(params: {
  message: Extract<AgentMessage, { role: "toolResult" }>;
  resolveId: (id: string) => string;
}): Extract<AgentMessage, { role: "toolResult" }> {
  const toolCallId =
    typeof params.message.toolCallId === "string" && params.message.toolCallId
      ? params.message.toolCallId
      : undefined;
  const toolUseId = (params.message as { toolUseId?: unknown }).toolUseId;
  const toolUseIdStr = typeof toolUseId === "string" && toolUseId ? toolUseId : undefined;
  const sharedRawId =
    toolCallId && toolUseIdStr && toolCallId === toolUseIdStr ? toolCallId : undefined;

  const sharedResolvedId = sharedRawId ? params.resolveId(sharedRawId) : undefined;
  const nextToolCallId =
    sharedResolvedId ?? (toolCallId ? params.resolveId(toolCallId) : undefined);
  const nextToolUseId =
    sharedResolvedId ?? (toolUseIdStr ? params.resolveId(toolUseIdStr) : undefined);

  if (nextToolCallId === toolCallId && nextToolUseId === toolUseIdStr) {
    return params.message;
  }

  return preserveArchiveRecallOriginAfterIdRewrite(params.message, {
    ...params.message,
    ...(nextToolCallId && { toolCallId: nextToolCallId }),
    ...(nextToolUseId && { toolUseId: nextToolUseId }),
  } as Extract<AgentMessage, { role: "toolResult" }>);
}

/**
 * Sanitize tool call IDs for provider compatibility.
 *
 * @param messages - The messages to sanitize
 * @param mode - "strict" (alphanumeric only) or "strict9" (alphanumeric length 9)
 */
```
