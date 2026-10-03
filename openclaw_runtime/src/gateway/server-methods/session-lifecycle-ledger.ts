// Runtime Lifecycle Governance — TF-0084 owner path 1: read-only lifecycle ledger.
//
// TF-0079..TF-0083 made the lifecycle owners production-reachable, fenced,
// reclaimable, lineage-joined and wake-bounded. Each owner still records its
// transitions in its own store, so nothing could answer "does every transition
// of this session name an owner and a generation?" without reading six stores by
// hand — which is how "the code exists" gets mistaken for "the lifecycle closes".
//
// This module answers that from the shared owner-read layer. It is a projection:
//   - no writer, no table, no reconciler (runtime-lifecycle-governance-boundary),
//   - no second session identity source: every generation is copied from the
//     owner that pinned it and is never derived from another identifier,
//   - owners this projection structurally cannot read are declared rather than
//     silently omitted, so a reader sees the coverage gap instead of a
//     misleadingly complete ledger.
//
// The census exists in order to fail. An entry whose owner records neither a
// generation nor a declared reason counts as unexplained, which is what the
// TF-0084 success metric `unexplainedTransitions=0` actually asserts.
import type { FinishedSession, ProcessSession } from "../../agents/bash-process-registry.js";
import { parseGoalWakeWaitJson } from "../../agents/goal-wake-types.js";
import type { MissionRunRecord } from "../../agents/mission-control/types.js";
import type { SubagentRunRecord } from "../../agents/subagent-registry.js";
import type { ProcessSupervisor, SupervisorSessionRunSnapshot } from "../../process/supervisor/index.js";
import {
  type GoalWakeTaskJoin,
  type SessionActivityLineageRef,
  type SessionLifecycleFlowRow,
  type SessionLifecycleOwnerViews,
  type SessionLifecycleTaskRunRow,
  bashSessionMatches,
  boundedLineageId,
  collectSessionLifecycleOwnerViews,
  finiteNumber,
  goalWakeJoinsByTaskId,
  lineageRef,
  nonEmptyString,
} from "./session-lifecycle-owner-views.js";

/** The single writer behind each ledger entry. */
export type SessionLifecycleLedgerOwner =
  | "sessionStore"
  | "missionRuns"
  | "goalWakeFlow"
  | "goalOwnedTask"
  | "bashRegistry"
  | "processSupervisor"
  | "subagentRegistry";

export type SessionLifecycleLedgerSubject =
  | "session"
  | "mission"
  | "flow"
  | "task"
  | "process"
  | "subagent"
  | "terminal"
  | "helper";

/**
 * Why an entry does or does not carry the session generation.
 *
 * `owner-pinned` is the only value that may accompany a generation. The other
 * two are declared structural facts about the owner, checked against the data
 * so a wrong declaration fails the census instead of silently passing it.
 */
export type SessionLifecycleGenerationSource =
  | "owner-pinned"
  | "legacy-unpinned"
  | "owner-records-no-generation";

export type SessionLifecycleLedgerEntry = {
  id: string;
  owner: SessionLifecycleLedgerOwner;
  subject: SessionLifecycleLedgerSubject;
  /** The owner's own status token. Never a re-worded or UI-facing status. */
  transition: string;
  /** The owner's own reason token, when it records an enum-shaped one. */
  outcome?: string;
  at: number;
  /** Copied from the owner that pinned it; absent unless `owner-pinned`. */
  generation?: string;
  generationSource: SessionLifecycleGenerationSource;
  lineage?: SessionActivityLineageRef;
};

/** An owner this projection cannot read, declared so the gap stays visible. */
export type SessionLifecycleDeclaredGap = {
  owner: "electronTerminal" | "durableHelperRunDir";
  subject: SessionLifecycleLedgerSubject;
  reason: "owner-outside-runtime-process" | "owner-not-session-indexed";
};

export type SessionLifecycleLedgerCensus = {
  total: number;
  byOwner: Partial<Record<SessionLifecycleLedgerOwner, number>>;
  /** Entries carrying a generation the owner pinned. */
  pinnedTransitions: number;
  /** Entries with a declared structural reason for having no generation. */
  explainedTransitions: number;
  /** Entries whose declaration and data disagree. The TF-0084 metric targets 0. */
  unexplainedTransitions: number;
  /** Entries with no correlation ref at all (no owner recorded any identity). */
  unjoinedEntries: number;
};

export type SessionLifecycleLedger = {
  sessionKey: string;
  /** The session generation currently open, when the session store has one. */
  sessionId: string | null;
  entries: SessionLifecycleLedgerEntry[];
  census: SessionLifecycleLedgerCensus;
  declaredGaps: SessionLifecycleDeclaredGap[];
  capturedAt: number;
  /** Set when the request was refused; entries and census stay empty. */
  reason?: "generation-mismatch";
};

/**
 * What the session store reports for this key.
 *
 * `startedAt` is the store's own `sessionStartedAt` — when this generation first
 * became active — so the session entry carries a transition time the owner
 * recorded rather than the time this projection happened to run.
 */
export type SessionLifecycleLedgerSessionInput = {
  sessionId?: string | null;
  startedAt?: number;
  updatedAt?: number;
};

/**
 * Owners whose transitions exist but cannot be read from this projection.
 *
 * Electron owns terminals in another process (the boundary rule keeps renderer
 * and Electron as projections, not runtime authority). The durable-helper run
 * directory is a file protocol keyed by owner epoch and task, not by session, so
 * its per-session transitions are reached through `task_runs` instead — the
 * `goalOwnedTask` entries above are that join.
 */
const DECLARED_GAPS: readonly SessionLifecycleDeclaredGap[] = [
  { owner: "electronTerminal", subject: "terminal", reason: "owner-outside-runtime-process" },
  { owner: "durableHelperRunDir", subject: "helper", reason: "owner-not-session-indexed" },
];

/** Reason tokens are enum-shaped; anything longer is dropped rather than projected. */
const MAX_OUTCOME_TOKEN_LENGTH = 64;

const LEDGER_ENTRY_LIMIT = 64;

function boundedToken(value: unknown): string | undefined {
  const normalized = nonEmptyString(value);
  return normalized && normalized.length <= MAX_OUTCOME_TOKEN_LENGTH ? normalized : undefined;
}

function withOutcome(value: unknown): { outcome?: string } {
  const outcome = boundedToken(value);
  return outcome ? { outcome } : {};
}

/**
 * Classifies one entry's generation. `pinned` is only claimed when the owner
 * actually produced a bounded id, so a missing pin degrades to the declared
 * legacy reason instead of being reported as pinned-with-no-value.
 */
function pinnedOrLegacy(rawGeneration: unknown): {
  generation?: string;
  generationSource: SessionLifecycleGenerationSource;
} {
  const generation = boundedLineageId(rawGeneration);
  return generation
    ? { generation, generationSource: "owner-pinned" }
    : { generationSource: "legacy-unpinned" };
}

function sessionStoreEntry(
  sessionKey: string,
  sessionId: string,
  at: number,
): SessionLifecycleLedgerEntry {
  return {
    id: `sessionStore:${sessionId}`,
    owner: "sessionStore",
    subject: "session",
    transition: "generation-open",
    at,
    generation: sessionId,
    generationSource: "owner-pinned",
    lineage: lineageRef({ sessionId, parentSessionKey: sessionKey }),
  };
}

function missionEntry(mission: MissionRunRecord): SessionLifecycleLedgerEntry {
  return {
    id: `missionRuns:${mission.missionId}`,
    owner: "missionRuns",
    subject: "mission",
    transition: boundedToken(mission.status) ?? "unknown",
    ...withOutcome(mission.phase),
    at: finiteNumber(mission.updatedAt, finiteNumber(mission.createdAt)),
    ...pinnedOrLegacy(mission.lineage?.sessionId),
    lineage: lineageRef({
      missionId: mission.missionId,
      sessionId: mission.lineage?.sessionId,
      runId: mission.lineage?.loopRunId ?? mission.taskLoopRunId,
    }),
  };
}

/**
 * `flow_runs` is the wait ledger. Its `wait_json` records mission, run and owner
 * epoch but no session generation, so every flow entry declares that instead of
 * borrowing a generation from another owner.
 */
function flowEntry(row: SessionLifecycleFlowRow): SessionLifecycleLedgerEntry {
  const wait = parseGoalWakeWaitJson(row.wait_json);
  return {
    id: `goalWakeFlow:${row.flow_id}`,
    owner: "goalWakeFlow",
    subject: "flow",
    transition: boundedToken(row.status) ?? "unknown",
    ...withOutcome(wait?.dependency?.kind),
    at: finiteNumber(row.updated_at, finiteNumber(row.created_at)),
    generationSource: "owner-records-no-generation",
    lineage: lineageRef({
      missionId: wait?.missionId,
      runId: wait?.runId,
      ownerEpoch: wait?.ownerEpoch,
    }),
  };
}

/** `task_runs(runtime="process")` records requester key and run id, no generation. */
function taskEntry(
  row: SessionLifecycleTaskRunRow,
  join?: GoalWakeTaskJoin,
): SessionLifecycleLedgerEntry {
  return {
    id: `goalOwnedTask:${row.task_id}`,
    owner: "goalOwnedTask",
    subject: "task",
    transition: boundedToken(row.status) ?? "unknown",
    ...withOutcome(row.delivery_status),
    at: finiteNumber(row.last_event_at, finiteNumber(row.ended_at, finiteNumber(row.created_at))),
    generationSource: "owner-records-no-generation",
    lineage: lineageRef({
      runId: nonEmptyString(row.run_id) ?? join?.runId,
      parentSessionKey: row.requester_session_key,
      missionId: join?.missionId,
      ownerEpoch: join?.ownerEpoch,
    }),
  };
}

function bashEntry(session: ProcessSession | FinishedSession): SessionLifecycleLedgerEntry {
  // Only the retained finished summary carries the owner's own status token; a
  // live session reports its raw exited flag instead of a derived label.
  const transition = "status" in session ? session.status : session.exited ? "exited" : "running";
  return {
    id: `bashRegistry:${session.id}`,
    owner: "bashRegistry",
    subject: "process",
    transition: boundedToken(transition) ?? "unknown",
    ...withOutcome(session.exitReason),
    at:
      "endedAt" in session
        ? finiteNumber(session.endedAt, finiteNumber(session.startedAt))
        : finiteNumber(session.startedAt),
    ...pinnedOrLegacy(session.lifecycleExpectedSessionId),
    lineage: lineageRef({ sessionId: session.lifecycleExpectedSessionId }),
  };
}

function supervisorEntry(run: SupervisorSessionRunSnapshot): SessionLifecycleLedgerEntry {
  return {
    id: `processSupervisor:${run.runId}`,
    owner: "processSupervisor",
    subject: "process",
    transition: boundedToken(run.state) ?? "unknown",
    at: finiteNumber(run.updatedAtMs, finiteNumber(run.startedAtMs)),
    ...pinnedOrLegacy(run.lifecycleExpectedSessionId),
    lineage: lineageRef({ runId: run.runId, sessionId: run.lifecycleExpectedSessionId }),
  };
}

function subagentEntry(run: SubagentRunRecord): SessionLifecycleLedgerEntry {
  // A yielded run keeps endedAt but clears outcome and endedReason, so it must be
  // matched before the terminal branch or a normal parent yield reads as an end.
  const transition = !run.endedAt
    ? "started"
    : run.pauseReason === "sessions_yield"
      ? "yielded"
      : "ended";
  return {
    id: `subagentRegistry:${run.runId}`,
    owner: "subagentRegistry",
    subject: "subagent",
    transition,
    ...withOutcome(run.outcome?.status ?? run.endedReason),
    at: finiteNumber(run.endedAt, finiteNumber(run.startedAt, finiteNumber(run.createdAt))),
    ...pinnedOrLegacy(run.requesterSessionId),
    lineage: lineageRef({
      runId: run.runId,
      parentSessionKey: run.requesterSessionKey,
      sessionId: run.requesterSessionId,
    }),
  };
}

/**
 * Counts the census over already-built entries.
 *
 * Exported so the invariant can be tested directly: an entry that claims
 * `owner-pinned` without a generation, or declares "no generation" while
 * carrying one, is counted as unexplained rather than quietly accepted.
 */
export function buildSessionLifecycleLedgerCensus(
  entries: readonly SessionLifecycleLedgerEntry[],
): SessionLifecycleLedgerCensus {
  const byOwner: Partial<Record<SessionLifecycleLedgerOwner, number>> = {};
  let pinnedTransitions = 0;
  let explainedTransitions = 0;
  let unexplainedTransitions = 0;
  let unjoinedEntries = 0;

  for (const entry of entries) {
    byOwner[entry.owner] = (byOwner[entry.owner] ?? 0) + 1;
    const hasGeneration = Boolean(boundedLineageId(entry.generation));
    if (entry.generationSource === "owner-pinned") {
      if (hasGeneration) {
        pinnedTransitions += 1;
      } else {
        unexplainedTransitions += 1;
      }
    } else if (hasGeneration) {
      // The owner was declared as recording no generation yet one is present:
      // the declaration is wrong, so the entry is not explained.
      unexplainedTransitions += 1;
    } else {
      explainedTransitions += 1;
    }
    if (!entry.lineage) {
      unjoinedEntries += 1;
    }
  }

  return {
    total: entries.length,
    byOwner,
    pinnedTransitions,
    explainedTransitions,
    unexplainedTransitions,
    unjoinedEntries,
  };
}

/**
 * Builds the ledger from already-read owner views. Ownership filters mirror the
 * activity projection exactly, so the two read models cannot disagree about
 * which records belong to a session.
 */
export function buildSessionLifecycleLedger(input: {
  views: SessionLifecycleOwnerViews;
  session?: SessionLifecycleLedgerSessionInput;
  capturedAt?: number;
}): SessionLifecycleLedger {
  const key = nonEmptyString(input.views.sessionKey);
  const sessionId = boundedLineageId(input.session?.sessionId) ?? null;
  const capturedAt = finiteNumber(input.capturedAt, Date.now());
  if (!key) {
    return {
      sessionKey: "",
      sessionId,
      entries: [],
      census: buildSessionLifecycleLedgerCensus([]),
      declaredGaps: [...DECLARED_GAPS],
      capturedAt,
    };
  }

  const views = input.views;
  const sessionOpenedAt = finiteNumber(
    input.session?.startedAt,
    finiteNumber(input.session?.updatedAt, capturedAt),
  );
  const ownedFlows = views.flows.filter((row) => row.owner_key === key);
  const joins = goalWakeJoinsByTaskId(ownedFlows);
  const entries: SessionLifecycleLedgerEntry[] = [
    ...(sessionId ? [sessionStoreEntry(key, sessionId, sessionOpenedAt)] : []),
    ...(views.mission?.sessionKey === key ? [missionEntry(views.mission)] : []),
    ...ownedFlows.map(flowEntry),
    ...views.tasks
      .filter((row) => row.runtime === "process" && row.owner_key === key)
      .map((row) => taskEntry(row, joins.get(row.task_id))),
    ...views.bashProcesses.filter((session) => bashSessionMatches(session, key)).map(bashEntry),
    ...views.supervisorRuns
      .filter((run) => run.lifecycleCanonicalSessionKey === key)
      .map(supervisorEntry),
    ...views.lineageRuns
      .filter((run) => run.requesterSessionKey === key && nonEmptyString(run.childSessionKey))
      .map(subagentEntry),
    ...(views.parentRun?.childSessionKey === key &&
    nonEmptyString(views.parentRun.requesterSessionKey)
      ? [subagentEntry(views.parentRun)]
      : []),
  ];

  // Keep the newest transitions when the owners report more than the bound, then
  // present them oldest-first so a reader follows the lifecycle forward.
  const ordered = [...entries]
    .sort((left, right) => right.at - left.at || right.id.localeCompare(left.id))
    .slice(0, LEDGER_ENTRY_LIMIT)
    .reverse();

  return {
    sessionKey: key,
    sessionId,
    entries: ordered,
    census: buildSessionLifecycleLedgerCensus(ordered),
    declaredGaps: [...DECLARED_GAPS],
    capturedAt,
  };
}

export type CollectSessionLifecycleLedgerOptions = {
  /** What the session store reports; `sessionId: null` means no open generation. */
  session?: SessionLifecycleLedgerSessionInput;
  /** Caller's expected generation; a mismatch refuses before any owner read. */
  expectedSessionId?: string;
  mission?: MissionRunRecord;
  supervisor?: Pick<ProcessSupervisor, "snapshotRunsForSession">;
  capturedAt?: number;
};

/**
 * Collects the ledger for one session.
 *
 * Fails closed exactly like `sessions.queueDrain` and `sessions.yieldState`: a
 * generation mismatch returns an empty ledger without reading a single owner, so
 * a stale caller can never be shown another generation's lifecycle.
 */
export function collectSessionLifecycleLedger(
  sessionKey: string,
  options: CollectSessionLifecycleLedgerOptions = {},
): SessionLifecycleLedger {
  const key = nonEmptyString(sessionKey) ?? "";
  const sessionId = boundedLineageId(options.session?.sessionId) ?? null;
  const capturedAt = finiteNumber(options.capturedAt, Date.now());
  const expected = nonEmptyString(options.expectedSessionId);
  if (expected && sessionId !== expected) {
    return {
      sessionKey: key,
      sessionId,
      entries: [],
      census: buildSessionLifecycleLedgerCensus([]),
      declaredGaps: [...DECLARED_GAPS],
      capturedAt,
      reason: "generation-mismatch",
    };
  }
  const views = collectSessionLifecycleOwnerViews(key, {
    mission: options.mission,
    supervisor: options.supervisor,
    goalLimit: LEDGER_ENTRY_LIMIT,
    processLimit: LEDGER_ENTRY_LIMIT,
  });
  return buildSessionLifecycleLedger({
    views,
    ...(options.session ? { session: options.session } : {}),
    capturedAt,
  });
}
