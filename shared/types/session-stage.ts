/**
 * SessionStage — one auditable answer to "what kind of session is this".
 *
 * This is a projection over facts the runtime already persists. It owns no
 * state, mutates nothing, and is not an execution decision: no prompt,
 * injection budget, compaction timing, or storage write may branch on it.
 *
 * Stage precedence is "stronger proof wins", not "oldest event wins":
 * a fork triple outranks a parent key, a parent key outranks a usage-family
 * rotation, and a compaction count outranks mere activity. A stage that cannot
 * be proven from the recorded facts is `unknown` — never guessed from a title,
 * label, model name, or message text.
 */
import { classifyDerivation, type SessionDerivationKind } from './session-derivation.js';

export const SESSION_STAGE_SCHEMA = 'SessionStage/v1' as const;

export type SessionStage =
  | 'fresh'
  | 'continued'
  | 'compacted'
  | 'forked'
  | 'handedOff'
  | 'restored'
  | 'resumed'
  | 'unknown';

export const SESSION_STAGES: readonly SessionStage[] = [
  'fresh',
  'continued',
  'compacted',
  'forked',
  'handedOff',
  'restored',
  'resumed',
  'unknown',
] as const;

/**
 * The persisted facts the projection is allowed to read.
 *
 * Every field mirrors an existing session-store field; nothing here is a new
 * source of truth and nothing is derived from another field in this type.
 */
export type SessionStageFacts = {
  sessionKey?: string | null;
  sessionId?: string | null;
  /** Fork proof: a child branched from a parent transcript. */
  forkedFromParent?: boolean | null;
  forkedFromLeafId?: string | null;
  forkedFromTimestamp?: number | null;
  parentSessionKey?: string | null;
  spawnedBy?: string | null;
  /** Usage-family rotation: earlier physical generations of this logical key. */
  usageFamilyKey?: string | null;
  usageFamilySessionIds?: readonly string[] | null;
  /** Compaction proof. */
  compactionCount?: number | null;
  hasCompactionCheckpoint?: boolean | null;
  /** Activity proof. */
  sessionStartedAt?: number | null;
  /** Newest recorded transcript timestamp, epoch ms, when known. */
  lastTranscriptActivityAt?: number | null;
  hasTranscriptActivity?: boolean | null;
  /** True when the caller looked for the session entry and found none. */
  sessionEntryMissing?: boolean | null;
};

/** Why the stage came out the way it did, in the order the rules were applied. */
export type SessionStageReason =
  | 'fork-triple'
  | 'fork-flag'
  | 'handoff-parent-key'
  | 'spawn-parent-key'
  | 'usage-family-rotation'
  | 'compaction-count'
  | 'compaction-checkpoint'
  | 'resumed-after-idle'
  | 'transcript-activity'
  | 'no-goal-state'
  | 'missing-session-entry'
  | 'no-session-identity'
  | 'conflicting-fork-facts'
  | 'contradictory-stage-facts';

export type SessionStageProjection = {
  schema: typeof SESSION_STAGE_SCHEMA;
  stage: SessionStage;
  /** Facts that produced the answer, so a reader can re-check it. */
  stageEvidence: {
    reasons: SessionStageReason[];
    /** Input fields the projection actually consumed. */
    usedFacts: string[];
    /** Facts that were missing and would have made the answer stronger. */
    missingFacts: string[];
    /** The exact relation within the coarser continuity-stage vocabulary. */
    derivationKind?: SessionDerivationKind;
  };
  /** Identity the projection was computed for; never `scopeKey`. */
  identity: {
    sessionKey?: string;
    sessionId?: string;
  };
};

const RESUME_IDLE_MS = 6 * 60 * 60 * 1000;

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function finitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Derive one stage from persisted facts.
 *
 * Pure: same facts in, same projection out; no I/O, no clock reads, no caching.
 */
export function deriveSessionStage(facts: SessionStageFacts): SessionStageProjection {
  const reasons: SessionStageReason[] = [];
  const usedFacts: string[] = [];
  const missingFacts: string[] = [];
  const derivation = classifyDerivation(facts);

  const identity = {
    ...(nonEmpty(facts.sessionKey) ? { sessionKey: facts.sessionKey.trim() } : {}),
    ...(nonEmpty(facts.sessionId) ? { sessionId: facts.sessionId.trim() } : {}),
  };

  const build = (stage: SessionStage): SessionStageProjection => ({
    schema: SESSION_STAGE_SCHEMA,
    stage,
    stageEvidence: { reasons, usedFacts, missingFacts,
      ...(derivation.kind !== 'unknown' ? { derivationKind: derivation.kind } : {}) },
    identity,
  });

  // A caller that looked for the entry and found none must not be answered
  // "fresh": an unread session is a gap in the facts, not an empty session.
  if (facts.sessionEntryMissing === true) {
    reasons.push('missing-session-entry');
    missingFacts.push('sessionEntry');
    return build('unknown');
  }

  const hasIdentity = Boolean(identity.sessionKey || identity.sessionId);
  const forkLeaf = nonEmpty(facts.forkedFromLeafId);
  const forkStamp = finitePositive(facts.forkedFromTimestamp);
  const parentKey = nonEmpty(facts.parentSessionKey);
  if (derivation.diagnostics?.length) reasons.push('contradictory-stage-facts');

  // A fork triple that disagrees with itself is contradictory, not a fork:
  // a leaf id with no parent key names no branch to have come from.
  if (forkLeaf && !parentKey && !facts.forkedFromParent) {
    reasons.push('conflicting-fork-facts');
    usedFacts.push('forkedFromLeafId');
    missingFacts.push('parentSessionKey', 'forkedFromParent');
    return build('unknown');
  }

  if (derivation.kind === 'fork') {
    reasons.push(forkLeaf || forkStamp ? 'fork-triple' : 'fork-flag');
    usedFacts.push('forkedFromParent');
    if (forkLeaf) usedFacts.push('forkedFromLeafId');
    if (forkStamp) usedFacts.push('forkedFromTimestamp');
    if (parentKey) usedFacts.push('parentSessionKey');
    return build('forked');
  }

  if (derivation.kind === 'spawn') {
    reasons.push('spawn-parent-key');
    usedFacts.push('spawnedBy');
    if (parentKey) usedFacts.push('parentSessionKey');
    return build('handedOff');
  }

  if (derivation.kind === 'handoff') {
    reasons.push('handoff-parent-key');
    usedFacts.push('parentSessionKey');
    return build('handedOff');
  }

  const familyIds = Array.isArray(facts.usageFamilySessionIds)
    ? facts.usageFamilySessionIds.filter(nonEmpty)
    : [];
  const currentId = identity.sessionId;
  const rotatedPriorIds = currentId ? familyIds.filter((id) => id !== currentId) : familyIds;
  if (rotatedPriorIds.length > 0) {
    reasons.push('usage-family-rotation');
    usedFacts.push('usageFamilySessionIds');
    if (nonEmpty(facts.usageFamilyKey)) usedFacts.push('usageFamilyKey');
    return build('restored');
  }

  if (finitePositive(facts.compactionCount) && (facts.compactionCount as number) > 0) {
    reasons.push('compaction-count');
    usedFacts.push('compactionCount');
    return build('compacted');
  }

  if (facts.hasCompactionCheckpoint === true) {
    reasons.push('compaction-checkpoint');
    usedFacts.push('hasCompactionCheckpoint');
    return build('compacted');
  }

  const startedAt = finitePositive(facts.sessionStartedAt) ? (facts.sessionStartedAt as number) : null;
  const lastActivity = finitePositive(facts.lastTranscriptActivityAt)
    ? (facts.lastTranscriptActivityAt as number)
    : null;
  if (startedAt != null) usedFacts.push('sessionStartedAt');
  if (lastActivity != null) usedFacts.push('lastTranscriptActivityAt');

  // A session that started, went quiet for longer than the resume window, then
  // produced new activity was picked back up rather than continued in one go.
  if (startedAt != null && lastActivity != null) {
    if (lastActivity - startedAt > RESUME_IDLE_MS) {
      reasons.push('resumed-after-idle');
      return build('resumed');
    }
  }

  if (facts.hasTranscriptActivity === true || lastActivity != null) {
    reasons.push('transcript-activity');
    if (facts.hasTranscriptActivity === true) usedFacts.push('hasTranscriptActivity');
    return build('continued');
  }

  if (!hasIdentity) {
    reasons.push('no-session-identity');
    missingFacts.push('sessionKey', 'sessionId');
    return build('unknown');
  }

  // Nothing proves any rotation and nothing proves activity: a session that
  // exists but has never run is genuinely fresh, and that is a fact, not a gap.
  reasons.push('no-goal-state');
  if (startedAt == null) missingFacts.push('sessionStartedAt');
  if (lastActivity == null) missingFacts.push('lastTranscriptActivityAt');
  return build('fresh');
}
