/**
 * Session hard-delete cascade + TTL (P3-004 / F-DATA-005).
 *
 * Cascades delete across SEKB principles/trajectories, session-scoped memory,
 * and DCS experience journal entries. Returns a structured report so partial
 * failures are retriable and visible.
 */
import type { KnowledgeStore } from "./knowledge-store.js";
import type { Principle, Trajectory } from "./types.js";
import type { MemoryCard } from "../../memory/types.js";

export type CascadeTargetKind =
  | "sekb_principle"
  | "sekb_trajectory"
  | "memory_card"
  | "dcs_experience_journal"
  | "dcs_experience_block"
  | "session_file";

export type CascadeTarget = {
  kind: CascadeTargetKind;
  id: string;
  lineage: string[];
};

export type CascadeError = {
  kind: CascadeTargetKind;
  id: string;
  error: string;
  retryable: boolean;
};

export type SessionCascadeReport = {
  schema: "session-cascade-delete.v1";
  sessionId: string;
  success: boolean;
  removed: CascadeTarget[];
  errors: CascadeError[];
  remainingCanaryHits: number;
  retryable: boolean;
  taskId: "P3-004";
  findingIds: ["F-DATA-005"];
};

export type SessionCascadeStores = {
  listPrinciples: () => Principle[];
  deletePrinciple: (id: string) => void;
  listTrajectories: () => Trajectory[];
  deleteTrajectory: (id: string) => void;
  listMemoryCards: () => MemoryCard[];
  deleteMemoryCard: (id: string) => void;
  listDcsExperienceJournalIds: () => string[];
  deleteDcsExperienceJournal: (id: string) => void;
  /** KS-02 optional real BlockStore projection owner API. */
  listDcsExperienceBlockIds?: () => string[];
  deleteDcsExperienceBlock?: (id: string) => void;
  /** Optional probe for canary residual search across serialized stores. */
  searchPlaintext?: (canary: string) => string[];
};

function principleSessionId(principle: Principle): string | undefined {
  const provenance = principle.metadata?.confirmProvenance as
    | { sessionId?: string }
    | undefined;
  if (typeof provenance?.sessionId === "string" && provenance.sessionId.trim()) {
    return provenance.sessionId.trim();
  }
  const direct = principle.metadata?.sessionId;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  return undefined;
}

function trajectorySessionId(trajectory: Trajectory): string | undefined {
  const meta = trajectory.metadata ?? {};
  if (typeof meta.sessionId === "string" && meta.sessionId.trim()) {
    return meta.sessionId.trim();
  }
  const provenance = meta.confirmProvenance as { sessionId?: string } | undefined;
  if (typeof provenance?.sessionId === "string" && provenance.sessionId.trim()) {
    return provenance.sessionId.trim();
  }
  return undefined;
}

/**
 * A session is addressable by more than one identifier: the write side stamps
 * SEKB rows with the transcript session id (`options.sessionId` at tool time,
 * an opaque uuid), while the host delete cascade historically passed the
 * canonical session KEY. Matching only one of them silently leaves the other
 * set of rows behind, so accept every identifier the caller supplies.
 */
function memoryMatchesSession(card: MemoryCard, sessionIds: readonly string[]): boolean {
  for (const sessionId of sessionIds) {
    if (card.scope === "session" && (card.scopeKey === sessionId || !card.scopeKey)) {
      if (card.scopeKey === sessionId || card.content.includes(sessionId)) return true;
      continue;
    }
    if (card.scopeKey === sessionId) return true;
    const labels = card.retentionLabels ?? [];
    if (labels.includes(`session:${sessionId}`)) return true;
  }
  return false;
}

export function collectSessionCascadeTargets(
  sessionId: string,
  stores: SessionCascadeStores,
  options: { aliasSessionIds?: readonly string[] } = {},
): CascadeTarget[] {
  const sessionIds = [
    ...new Set(
      [sessionId, ...(options.aliasSessionIds ?? [])]
        .map((id) => (typeof id === "string" ? id.trim() : ""))
        .filter((id) => id.length > 0),
    ),
  ];
  const matchesSessionId = (candidate: string | undefined): boolean =>
    candidate !== undefined && sessionIds.includes(candidate);
  const targets: CascadeTarget[] = [];
  const principleIds = new Set<string>();
  const trajectoryIds = new Set<string>();

  for (const principle of stores.listPrinciples()) {
    if (matchesSessionId(principleSessionId(principle))) {
      principleIds.add(principle.principle_id);
      targets.push({
        kind: "sekb_principle",
        id: principle.principle_id,
        lineage: [
          `session:${sessionId}`,
          `principle:${principle.principle_id}`,
          ...principle.source_trajectories.map((id) => `trajectory:${id}`),
        ],
      });
      for (const trajectoryId of principle.source_trajectories) {
        trajectoryIds.add(trajectoryId);
      }
    }
  }

  for (const trajectory of stores.listTrajectories()) {
    if (
      matchesSessionId(trajectorySessionId(trajectory)) ||
      trajectoryIds.has(trajectory.trajectory_id)
    ) {
      trajectoryIds.add(trajectory.trajectory_id);
      targets.push({
        kind: "sekb_trajectory",
        id: trajectory.trajectory_id,
        lineage: [`session:${sessionId}`, `trajectory:${trajectory.trajectory_id}`],
      });
    }
  }

  for (const card of stores.listMemoryCards()) {
    if (memoryMatchesSession(card, sessionIds)) {
      targets.push({
        kind: "memory_card",
        id: card.id,
        lineage: [`session:${sessionId}`, `memory:${card.id}`, `scope:${card.scope}`],
      });
    }
  }

  for (const journalId of stores.listDcsExperienceJournalIds()) {
    if (
      sessionIds.some(
        (id) => journalId.includes(id) || journalId.includes(id.replace(/[:/\\]/g, "_")),
      )
    ) {
      targets.push({
        kind: "dcs_experience_journal",
        id: journalId,
        lineage: [`session:${sessionId}`, `dcs-journal:${journalId}`],
      });
    }
  }

  if (stores.listDcsExperienceBlockIds && stores.deleteDcsExperienceBlock) {
    for (const blockId of stores.listDcsExperienceBlockIds()) {
      if (sessionIds.some((id) => blockId.includes(id))) {
        targets.push({
          kind: "dcs_experience_block",
          id: blockId,
          lineage: [`session:${sessionId}`, `dcs-block:${blockId}`],
        });
      }
    }
  }

  return targets;
}

export function executeSessionCascadeDelete(
  sessionId: string,
  stores: SessionCascadeStores,
  options: { canary?: string; aliasSessionIds?: readonly string[] } = {},
): SessionCascadeReport {
  const targets = collectSessionCascadeTargets(sessionId, stores, {
    ...(options.aliasSessionIds ? { aliasSessionIds: options.aliasSessionIds } : {}),
  });
  const removed: CascadeTarget[] = [];
  const errors: CascadeError[] = [];

  for (const target of targets) {
    try {
      switch (target.kind) {
        case "sekb_principle":
          stores.deletePrinciple(target.id);
          break;
        case "sekb_trajectory":
          stores.deleteTrajectory(target.id);
          break;
        case "memory_card":
          stores.deleteMemoryCard(target.id);
          break;
        case "dcs_experience_journal":
          stores.deleteDcsExperienceJournal(target.id);
          break;
        case "dcs_experience_block":
          stores.deleteDcsExperienceBlock?.(target.id);
          break;
        default:
          break;
      }
      removed.push(target);
    } catch (error) {
      errors.push({
        kind: target.kind,
        id: target.id,
        error: error instanceof Error ? error.message : String(error),
        retryable: true,
      });
    }
  }

  const remainingCanaryHits =
    options.canary && stores.searchPlaintext
      ? stores.searchPlaintext(options.canary).length
      : 0;

  const success = errors.length === 0 && remainingCanaryHits === 0;
  return {
    schema: "session-cascade-delete.v1",
    sessionId,
    success,
    removed,
    errors,
    remainingCanaryHits,
    retryable: errors.some((entry) => entry.retryable),
    taskId: "P3-004",
    findingIds: ["F-DATA-005"],
  };
}

/**
 * TTL purge for SEKB trajectories past expires_at.
 * Returns deleted ids and retryable failures.
 */
export function purgeExpiredSekbTrajectories(
  trajectories: Trajectory[],
  now: Date,
  deleteTrajectory: (id: string) => void,
): { deleted: string[]; errors: CascadeError[] } {
  const deleted: string[] = [];
  const errors: CascadeError[] = [];
  const nowMs = now.getTime();
  for (const trajectory of trajectories) {
    if (!trajectory.expires_at) continue;
    const exp = Date.parse(trajectory.expires_at);
    if (!Number.isFinite(exp) || exp > nowMs) continue;
    try {
      deleteTrajectory(trajectory.trajectory_id);
      deleted.push(trajectory.trajectory_id);
    } catch (error) {
      errors.push({
        kind: "sekb_trajectory",
        id: trajectory.trajectory_id,
        error: error instanceof Error ? error.message : String(error),
        retryable: true,
      });
    }
  }
  return { deleted, errors };
}

/** Locate lineage strings for a derivative id (A3). */
export function locateDerivativeLineage(
  targets: CascadeTarget[],
  derivativeId: string,
): string[] {
  const match = targets.find((target) => target.id === derivativeId);
  return match?.lineage ?? [];
}

/**
 * In-memory store adapter for unit tests / dry-run probes.
 */
export function createInMemoryCascadeStores(seed: {
  principles?: Principle[];
  trajectories?: Trajectory[];
  memoryCards?: MemoryCard[];
  dcsJournalIds?: string[];
  plaintextBlobs?: string[];
}): SessionCascadeStores & {
  principles: Principle[];
  trajectories: Trajectory[];
  memoryCards: MemoryCard[];
  dcsJournalIds: string[];
  plaintextBlobs: string[];
} {
  const state = {
    principles: [...(seed.principles ?? [])],
    trajectories: [...(seed.trajectories ?? [])],
    memoryCards: [...(seed.memoryCards ?? [])],
    dcsJournalIds: [...(seed.dcsJournalIds ?? [])],
    plaintextBlobs: [...(seed.plaintextBlobs ?? [])],
  };

  return {
    ...state,
    listPrinciples: () => state.principles,
    deletePrinciple: (id) => {
      state.principles = state.principles.filter((p) => p.principle_id !== id);
    },
    listTrajectories: () => state.trajectories,
    deleteTrajectory: (id) => {
      state.trajectories = state.trajectories.filter((t) => t.trajectory_id !== id);
    },
    listMemoryCards: () => state.memoryCards,
    deleteMemoryCard: (id) => {
      state.memoryCards = state.memoryCards.filter((c) => c.id !== id);
    },
    listDcsExperienceJournalIds: () => state.dcsJournalIds,
    deleteDcsExperienceJournal: (id) => {
      state.dcsJournalIds = state.dcsJournalIds.filter((entry) => entry !== id);
    },
    searchPlaintext: (canary) =>
      state.plaintextBlobs.filter((blob) => blob.includes(canary)).concat(
        ...state.principles.map((p) => JSON.stringify(p)).filter((s) => s.includes(canary)),
        ...state.trajectories.map((t) => JSON.stringify(t)).filter((s) => s.includes(canary)),
        ...state.memoryCards.map((c) => JSON.stringify(c)).filter((s) => s.includes(canary)),
        ...state.dcsJournalIds.filter((id) => id.includes(canary)),
      ),
  };
}

/** Adapter over KnowledgeStore when delete methods exist / via update stubs. */
export function createKnowledgeStoreCascadeAdapter(
  store: KnowledgeStore,
  extras: {
    listMemoryCards?: () => MemoryCard[];
    deleteMemoryCard?: (id: string) => void;
    listDcsExperienceJournalIds?: () => string[];
    deleteDcsExperienceJournal?: (id: string) => void;
    listDcsExperienceBlockIds?: () => string[];
    deleteDcsExperienceBlock?: (id: string) => void;
  } = {},
): SessionCascadeStores {
  return {
    listPrinciples: () => store.query_principles({}),
    deletePrinciple: (id) => {
      if (typeof (store as { delete_principle?: (id: string) => void }).delete_principle === "function") {
        (store as { delete_principle: (id: string) => void }).delete_principle(id);
        return;
      }
      // Fallback: archive so it leaves active index / high-trust retrieval.
      store.archive_principle(id);
    },
    listTrajectories: () => store.query_trajectories({}),
    deleteTrajectory: (id) => {
      if (typeof (store as { delete_trajectory?: (id: string) => void }).delete_trajectory === "function") {
        (store as { delete_trajectory: (id: string) => void }).delete_trajectory(id);
        return;
      }
      throw new Error(`delete_trajectory not available for ${id}`);
    },
    listMemoryCards: () => extras.listMemoryCards?.() ?? [],
    deleteMemoryCard: (id) => {
      extras.deleteMemoryCard?.(id);
    },
    listDcsExperienceJournalIds: () => extras.listDcsExperienceJournalIds?.() ?? [],
    deleteDcsExperienceJournal: (id) => {
      extras.deleteDcsExperienceJournal?.(id);
    },
    listDcsExperienceBlockIds: () => extras.listDcsExperienceBlockIds?.() ?? [],
    deleteDcsExperienceBlock: (id) => {
      extras.deleteDcsExperienceBlock?.(id);
    },
  };
}

