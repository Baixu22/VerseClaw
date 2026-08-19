/**
 * KS-03: governed target adapter registry. Only memory-wiki, the active
 * memory slot (initially Role Memory), and SEKB may register as writers.
 * Runtime Memory, Dreams, Chat, and file watchers remain candidate producers
 * or read-only sources and can never enter this registry.
 */

import {
  archiveMemoryCard,
  getMemoryCard,
  setMemoryStorePath,
  storeMemoryCard,
  updateMemoryCard,
} from "../memory/memory-store.js";
import { KnowledgeStore } from "./sekb/knowledge-store.js";

export type GovernedOwner = "memory-wiki" | "memory-slot" | "sekb";

export type GovernedMutation = {
  proposalId: string;
  operation: "create" | "update" | "merge" | "archive" | "revoke" | "delete" | "restore";
  subjectId: string;
  expectedRevision?: string;
  contentDigest: string;
  idempotencyKey: string;
  sourceRefs: string[];
  /** KS-06: optional operation payload (e.g. update/merge field edits). */
  payload?: Record<string, unknown>;
};

export interface GovernedTargetAdapter {
  descriptor(): { owner: GovernedOwner; schema: "GovernedTargetAdapter/v1"; activeMemorySlot?: string };
  prepare(proposal: GovernedMutation): Promise<unknown>;
  commit(plan: unknown): Promise<unknown>;
  compensate(receipt: unknown): Promise<unknown>;
  enumerateBySource(sourceRef: string): Promise<Array<{ refId: string; subjectId: string; revision: string }>>;
}

export class GovernedAdapterRegistry {
  readonly #adapters = new Map<GovernedOwner, GovernedTargetAdapter>();
  #activeMemorySlot: string | null = null;

  register(adapter: GovernedTargetAdapter): void {
    const descriptor = adapter.descriptor();
    if (descriptor.owner === "memory-slot") {
      const slot = descriptor.activeMemorySlot ?? "role-memory";
      if (this.#activeMemorySlot && this.#activeMemorySlot !== slot) {
        throw new Error(
          `active memory writer already registered: ${this.#activeMemorySlot}; refusing second active memory writer ${slot}`,
        );
      }
      this.#activeMemorySlot = slot;
    }
    if (this.#adapters.has(descriptor.owner)) {
      throw new Error(`governed target adapter already registered for owner ${descriptor.owner}`);
    }
    this.#adapters.set(descriptor.owner, adapter);
  }

  get(owner: GovernedOwner): GovernedTargetAdapter | undefined {
    return this.#adapters.get(owner);
  }

  owners(): GovernedOwner[] {
    return [...this.#adapters.keys()].sort();
  }

  activeMemorySlot(): string | null {
    return this.#activeMemorySlot;
  }

  clearForTests(): void {
    this.#adapters.clear();
    this.#activeMemorySlot = null;
  }
}

export const governedAdapterRegistry = new GovernedAdapterRegistry();

/** KS-03: Role Memory is the first and only active memory writer. */
export function createRoleMemoryGovernedAdapter(options: {
  activeMemorySlot?: string;
  prepare?: GovernedTargetAdapter["prepare"];
  commit?: GovernedTargetAdapter["commit"];
  compensate?: GovernedTargetAdapter["compensate"];
  enumerateBySource?: GovernedTargetAdapter["enumerateBySource"];
} = {}): GovernedTargetAdapter {
  return {
    descriptor() {
      return { owner: "memory-slot", schema: "GovernedTargetAdapter/v1", activeMemorySlot: options.activeMemorySlot ?? "role-memory" };
    },
    prepare: options.prepare ?? (async () => ({ adapter: "role-memory", prepared: true })),
    commit: options.commit ?? (async () => ({ success: true })),
    compensate: options.compensate ?? (async (receipt) => ({ status: "compensated", receipt })),
    enumerateBySource: options.enumerateBySource ?? (async () => []),
  };
}

export function createSekbGovernedAdapter(options: {
  prepare?: GovernedTargetAdapter["prepare"];
  commit?: GovernedTargetAdapter["commit"];
  compensate?: GovernedTargetAdapter["compensate"];
  enumerateBySource?: GovernedTargetAdapter["enumerateBySource"];
} = {}): GovernedTargetAdapter {
  return {
    descriptor() {
      return { owner: "sekb", schema: "GovernedTargetAdapter/v1" };
    },
    prepare: options.prepare ?? (async () => ({ adapter: "sekb", prepared: true })),
    commit: options.commit ?? (async () => ({ success: true })),
    compensate: options.compensate ?? (async (receipt) => ({ status: "compensated", receipt })),
    enumerateBySource: options.enumerateBySource ?? (async () => []),
  };
}

/** Role Memory governed adapter backed by the real role-memory.sqlite store. */
export function createRoleMemoryKnowledgeStoreGovernedAdapter(options: {
  storePath?: string;
} = {}): GovernedTargetAdapter {
  if (options.storePath) setMemoryStorePath(options.storePath);
  return {
    descriptor() {
      return { owner: "memory-slot", schema: "GovernedTargetAdapter/v1", activeMemorySlot: "role-memory" };
    },
    async prepare(proposal) {
      const card = getMemoryCard(proposal.subjectId);
      if (!card) throw new Error(`Unknown memory card: ${proposal.subjectId}`);
      if (proposal.expectedRevision && String(card.version) !== proposal.expectedRevision) {
        throw new Error(`stale_revision for ${proposal.subjectId}: expected ${proposal.expectedRevision}, actual ${card.version}`);
      }
      return { adapter: "memory-slot", proposal, card };
    },
    async commit(plan) {
      const { proposal, card } = plan as {
        proposal: GovernedMutation;
        card: ReturnType<typeof getMemoryCard>;
      };
      if (!card) return { success: false, conflict: { code: "not_found", reason: `Unknown memory card: ${proposal.subjectId}` } };
      const payload = proposal.payload ?? {};
      switch (proposal.operation) {
        case "archive":
        case "revoke": {
          const decision = archiveMemoryCard(proposal.subjectId, proposal.operation === "revoke" ? "tombstone" : "archived", {
            reason: proposal.operation,
          });
          return decision.accepted ? { success: true } : { success: false, conflict: { code: "memory_gatekeeper", reason: decision.reason } };
        }
        case "delete": {
          const decision = archiveMemoryCard(proposal.subjectId, "tombstone", { reason: "delete" });
          return decision.accepted ? { success: true } : { success: false, conflict: { code: "memory_gatekeeper", reason: decision.reason } };
        }
        case "update": {
          const decision = updateMemoryCard(proposal.subjectId, {
            content: typeof payload.content === "string" ? payload.content : card.content,
            reason: "governed update",
          });
          return decision.accepted ? { success: true } : { success: false, conflict: { code: "memory_gatekeeper", reason: decision.reason } };
        }
        case "restore": {
          storeMemoryCard({
            ...card,
            status: "active",
            version: card.version + 1,
            updatedAt: new Date().toISOString(),
          }, { reason: "governed restore" });
          return { success: true };
        }
        case "merge": {
          const decision = updateMemoryCard(proposal.subjectId, {
            content: typeof payload.content === "string" ? payload.content : card.content,
            evidenceRefs: [
              ...(card.evidenceRefs ?? []),
              ...proposal.sourceRefs.map((ref) => ({ type: "manual" as const, ref })),
            ],
            reason: "governed merge",
          });
          return decision.accepted ? { success: true } : { success: false, conflict: { code: "memory_gatekeeper", reason: decision.reason } };
        }
        case "create":
          return { success: false, conflict: { code: "operation_unavailable", reason: "Role Memory cards are created through proposeMemoryCard" } };
      }
    },
    async compensate(receipt) {
      if (receipt && typeof receipt === "object" && (receipt as { operation?: string }).operation === "delete") {
        return { status: "unrecoverable", receipt, reason: "Role Memory tombstone is not automatically reversible" };
      }
      return { status: "compensated", receipt };
    },
    async enumerateBySource(sourceRef) {
      const { getMemoryCards } = await import("../memory/memory-store.js");
      return getMemoryCards({}).filter((card) => (card.evidenceRefs ?? []).some((ref) => ref.ref === sourceRef))
        .map((card) => ({ refId: `memory-slot:${card.id}`, subjectId: card.id, revision: String(card.version) }));
    },
  };
}

/**
 * KS-06: SEKB governed adapter backed by a real KnowledgeStore. Supports
 * update/merge/archive/revoke/delete/restore for canonical experience
 * principles. memory-wiki remains host-owned (Main RPC) and Role Memory stays
 * slot-owned; this adapter is intentionally runtime-testable on SQLite.
 */
export function createSekbKnowledgeStoreGovernedAdapter(options: {
  store?: KnowledgeStore;
} = {}): GovernedTargetAdapter {
  const store = options.store ?? new KnowledgeStore();
  return {
    descriptor() {
      return { owner: "sekb", schema: "GovernedTargetAdapter/v1" };
    },
    async prepare(proposal) {
      const principle = store.get_principle(proposal.subjectId);
      if (proposal.expectedRevision && principle.updated_at !== proposal.expectedRevision) {
        throw new Error(`stale_revision for ${proposal.subjectId}: expected ${proposal.expectedRevision}, actual ${principle.updated_at}`);
      }
      return { adapter: "sekb", proposal, principle };
    },
    async commit(plan) {
      const { proposal, principle } = plan as {
        proposal: GovernedMutation;
        principle: ReturnType<KnowledgeStore["get_principle"]>;
      };
      const payload = proposal.payload ?? {};
      switch (proposal.operation) {
        case "archive":
        case "revoke":
          store.update_principle(proposal.subjectId, {
            status: "archived",
            metadata: { ...principle.metadata, sekbRevoked: proposal.operation === "revoke" },
          });
          return { success: true };
        case "delete":
          store.delete_principle(proposal.subjectId);
          return { success: true };
        case "restore":
          store.update_principle(proposal.subjectId, {
            status: "active",
            metadata: { ...principle.metadata, sekbRevoked: false },
          });
          return { success: true };
        case "update":
          store.update_principle(proposal.subjectId, {
            ...(typeof payload.title === "string" ? { title: payload.title } : {}),
            ...(typeof payload.condition === "string" ? { condition: payload.condition } : {}),
            ...(typeof payload.action === "string" ? { action: payload.action } : {}),
            ...(typeof payload.reason === "string" ? { reason: payload.reason } : {}),
          });
          return { success: true };
        case "merge":
          store.update_principle(proposal.subjectId, {
            source_trajectories: [...new Set([...principle.source_trajectories, ...proposal.sourceRefs])].toSorted(),
            metadata: { ...principle.metadata, mergedFrom: proposal.sourceRefs },
          });
          return { success: true };
        case "create":
          return { success: false, conflict: { code: "operation_unavailable", reason: "SEKB principles are created through confirm_and_save" } };
      }
    },
    async compensate(receipt) {
      // delete is unrecoverable; other operations are restored by the caller
      // through a new governed mutation. Keep this explicit.
      if (receipt && typeof receipt === "object" && (receipt as { operation?: string }).operation === "delete") {
        return { status: "unrecoverable", receipt, reason: "SEKB principle delete is not recoverable without a restore source" };
      }
      return { status: "compensated", receipt };
    },
    async enumerateBySource(sourceRef) {
      const principles = store.query_principles({});
      return principles
        .filter((principle) => principle.source_trajectories.includes(sourceRef))
        .map((principle) => ({
          refId: `sekb:${principle.principle_id}`,
          subjectId: principle.principle_id,
          revision: principle.updated_at,
        }));
    },
  };
}

/** memory-wiki adapter is host-owned because wiki.apply runs through Main RPC. */
export function createMemoryWikiGovernedAdapter(options: {
  prepare?: GovernedTargetAdapter["prepare"];
  commit?: GovernedTargetAdapter["commit"];
  compensate?: GovernedTargetAdapter["compensate"];
  enumerateBySource?: GovernedTargetAdapter["enumerateBySource"];
} = {}): GovernedTargetAdapter {
  return {
    descriptor() {
      return { owner: "memory-wiki", schema: "GovernedTargetAdapter/v1" };
    },
    prepare: options.prepare ?? (async () => ({ adapter: "memory-wiki", prepared: true })),
    commit: options.commit ?? (async () => ({ success: true })),
    compensate: options.compensate ?? (async (receipt) => ({ status: "compensated", receipt })),
    enumerateBySource: options.enumerateBySource ?? (async () => []),
  };
}
