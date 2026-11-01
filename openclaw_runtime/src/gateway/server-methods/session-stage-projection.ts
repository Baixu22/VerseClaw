/**
 * Read-only SessionStage projection for the activity snapshot.
 *
 * This module has no write path. It reads the session entry the gateway already
 * loaded plus the transcript activity the caller already knows about, and hands
 * the result to `deriveSessionStage`. It must never be consulted by prompt
 * assembly, the injection budget, compaction timing, or storage.
 */
import type { SessionStageFacts, SessionStageProjection } from "../../../../shared/types/session-stage.js";
import { deriveSessionStage } from "../../../../shared/types/session-stage.js";

/** The subset of the session entry this projection is allowed to read. */
export type SessionStageEntryFacts = {
  sessionId?: string | null;
  forkedFromParent?: boolean | null;
  forkedFromLeafId?: string | null;
  forkedFromTimestamp?: number | null;
  parentSessionKey?: string | null;
  spawnedBy?: string | null;
  usageFamilyKey?: string | null;
  usageFamilySessionIds?: string[] | null;
  compactionCount?: number | null;
  compactionCheckpoints?: unknown[] | null;
  sessionStartedAt?: number | null;
};

export type SessionStageProjectionInput = {
  sessionKey?: string | null;
  entry?: SessionStageEntryFacts | null;
  /** True when the transcript has at least one recorded entry. */
  hasTranscriptActivity?: boolean | null;
  /** Epoch ms of the newest transcript entry, when the caller already read it. */
  lastTranscriptActivityAt?: number | null;
};

/**
 * Project the stage for one session.
 *
 * `entry === null` is not "no stage": it means the session entry was not found,
 * so the answer degrades to `unknown` with the missing fact named rather than
 * reporting `fresh` for a session that may not exist.
 */
export function projectSessionStage(input: SessionStageProjectionInput): SessionStageProjection {
  const entry = input.entry ?? null;
  const facts: SessionStageFacts = {
    sessionKey: input.sessionKey ?? null,
    sessionId: entry?.sessionId ?? null,
    forkedFromParent: entry?.forkedFromParent ?? null,
    forkedFromLeafId: entry?.forkedFromLeafId ?? null,
    forkedFromTimestamp: entry?.forkedFromTimestamp ?? null,
    parentSessionKey: entry?.parentSessionKey ?? null,
    spawnedBy: entry?.spawnedBy ?? null,
    usageFamilyKey: entry?.usageFamilyKey ?? null,
    usageFamilySessionIds: entry?.usageFamilySessionIds ?? null,
    compactionCount: entry?.compactionCount ?? null,
    hasCompactionCheckpoint: Array.isArray(entry?.compactionCheckpoints)
      ? entry.compactionCheckpoints.length > 0
      : null,
    sessionStartedAt: entry?.sessionStartedAt ?? null,
    hasTranscriptActivity: input.hasTranscriptActivity ?? null,
    lastTranscriptActivityAt: input.lastTranscriptActivityAt ?? null,
    sessionEntryMissing: entry === null,
  };
  return deriveSessionStage(facts);
}
