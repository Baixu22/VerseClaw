/**
 * Self-editing memory interface (Phase 4.4, Letta-inspired).
 *
 * Exposes four tools that an agent can invoke during a conversation to
 * actively manage its own memory:
 *
 * - `memory_recall`: search the memory store for matching facts.
 * - `memory_update`: supersede an existing fact with updated information.
 * - `memory_forget`: actively invalidate (retract) a fact.
 * - `memory_strengthen`: boost a fact's usage signal (user positive feedback).
 *
 * Phase 1: interface + tests only. Not wired into the actual agent tool
 * registration system yet.
 */

import {
  buildEvidenceRefFixture,
  type EvidenceRef,
} from "./evidence.js";
import {
  isRuntimeMemoryRelationType,
  sanitizeRuntimeMemoryInvalidationProposal,
  type RuntimeMemoryFactRelation,
  type RuntimeMemoryInvalidationProposal,
  type RuntimeMemoryRelationType,
  type RuntimeMemorySourceEpisodeRef,
  type RuntimeMemoryTemporalFact,
} from "./memory-context.js";
import type { RuntimeMemoryStore } from "./memory-store.js";
import type { RuntimeMemoryRuntimeIntegrationPort } from "./memory-runtime-integration.js";
import type { RuntimeCoreJsonObject } from "./types.js";

export type MemorySelfEditToolName =
  | "memory_recall"
  | "memory_update"
  | "memory_forget"
  | "memory_strengthen"
  | "memory_find_related";

export type MemorySelfEditToolResult = {
  ok: boolean;
  tool: MemorySelfEditToolName;
  message: string;
  data?: unknown;
};

export type MemorySelfEditToolContext = {
  store: RuntimeMemoryStore;
  now?: number;
  taskId?: string;
  /**
   * Durable persistence port. When present, write operations (update / forget)
   * replay through `appendFact` / `invalidateFact` / `persistRelation` so the
   * changes land in SQLite instead of only the in-memory store snapshot. Read
   * operations (recall / find_related) continue to use `store`.
   */
  persistence?: RuntimeMemoryRuntimeIntegrationPort;
};

export type MemorySelfEditToolHandler = (
  args: unknown,
  context: MemorySelfEditToolContext,
) => Promise<MemorySelfEditToolResult> | MemorySelfEditToolResult;

export type MemorySelfEditTool = {
  name: MemorySelfEditToolName;
  description: string;
  parameters: Record<string, unknown>;
  execute: MemorySelfEditToolHandler;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArg(args: unknown, key: string): string | undefined {
  if (!isRecord(args)) return undefined;
  const value = args[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function numberArg(args: unknown, key: string): number | undefined {
  if (!isRecord(args)) return undefined;
  const value = args[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function clampNumber(
  value: number | undefined,
  min: number,
  max: number,
  fallback: number,
): number {
  if (value === undefined) return fallback;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function resolveNow(context: MemorySelfEditToolContext): number {
  return context.now ?? Date.now();
}

type PersistWriteOutcome = { ok: true } | { ok: false; message: string };

function persistFact(
  context: MemorySelfEditToolContext,
  fact: RuntimeMemoryTemporalFact,
): PersistWriteOutcome {
  if (context.persistence !== undefined) {
    const result = context.persistence.appendFact(fact);
    if (result.status === "persisted") {
      return { ok: true };
    }
    if (result.status === "rejected") {
      return { ok: false, message: result.message };
    }
    return { ok: false, message: `persistence skipped (${result.reason})` };
  }
  const result = context.store.appendFact(fact);
  if (!result.accepted) {
    return { ok: false, message: result.message };
  }
  return { ok: true };
}

function persistInvalidation(
  context: MemorySelfEditToolContext,
  invalidation: RuntimeMemoryInvalidationProposal,
): PersistWriteOutcome {
  if (context.persistence !== undefined) {
    const result = context.persistence.invalidateFact(invalidation);
    if (result.status === "persisted") {
      return { ok: true };
    }
    if (result.status === "rejected") {
      return { ok: false, message: result.message };
    }
    return { ok: false, message: `persistence skipped (${result.reason})` };
  }
  const result = context.store.invalidateFact(invalidation);
  if (!result.accepted) {
    return { ok: false, message: result.message };
  }
  return { ok: true };
}

function persistSupersedesRelation(
  context: MemorySelfEditToolContext,
  newFactId: string,
  oldFactId: string,
): PersistWriteOutcome {
  if (context.persistence !== undefined) {
    const result = context.persistence.persistRelation({
      sourceFactId: newFactId,
      targetFactId: oldFactId,
      relationType: "supersedes",
      confidence: 1.0,
    });
    if (result.status === "persisted") {
      return { ok: true };
    }
    if (result.status === "rejected") {
      return { ok: false, message: result.message };
    }
    return { ok: false, message: `persistence skipped (${result.reason})` };
  }
  context.store.appendRelation({
    sourceFactId: newFactId,
    targetFactId: oldFactId,
    relationType: "supersedes",
    confidence: 1.0,
  });
  return { ok: true };
}

function selfEditEvidenceRef(now: number): EvidenceRef {
  return buildEvidenceRefFixture({
    type: "human",
    ref: "memory_self_edit",
    label: "Memory self-edit tool",
    summary: `Self-edit action at ${now}.`,
  });
}

function cloneEvidenceRef(ref: {
  readonly type: EvidenceRef["type"];
  readonly ref: string;
  readonly label?: string;
  readonly summary?: string;
  readonly metadata?: unknown;
}): EvidenceRef {
  const cloned: EvidenceRef = {
    type: ref.type,
    ref: ref.ref,
  };
  if (ref.label !== undefined) {
    cloned.label = ref.label;
  }
  if (ref.summary !== undefined) {
    cloned.summary = ref.summary;
  }
  if (ref.metadata !== undefined) {
    cloned.metadata = cloneRuntimeCoreJsonObject(ref.metadata);
  }
  return cloned;
}

function cloneSourceEpisodeRef(
  ref: RuntimeMemorySourceEpisodeRef,
): RuntimeMemorySourceEpisodeRef {
  return {
    episodeId: ref.episodeId,
    ...(ref.taskId !== undefined ? { taskId: ref.taskId } : {}),
    ...(ref.kind !== undefined ? { kind: ref.kind } : {}),
    ...(ref.idempotencyKey !== undefined ? { idempotencyKey: ref.idempotencyKey } : {}),
    ...(ref.reference_time !== undefined ? { reference_time: ref.reference_time } : {}),
  };
}

function cloneRuntimeCoreJsonObject(value: unknown): RuntimeCoreJsonObject {
  return JSON.parse(JSON.stringify(value)) as RuntimeCoreJsonObject;
}

// ---------------------------------------------------------------------------
// memory_recall
// ---------------------------------------------------------------------------

export const memoryRecallTool: MemorySelfEditTool = {
  name: "memory_recall",
  description:
    "Search the runtime memory store for facts matching the given query. Returns matching facts with their metadata.",
  parameters: {
    type: "object",
    properties: {
      subject: { type: "string", description: "Filter by subject." },
      predicate: { type: "string", description: "Filter by predicate." },
      limit: { type: "number", description: "Maximum facts to return." },
    },
  },
  execute(args, context) {
    const subject = stringArg(args, "subject");
    const predicate = stringArg(args, "predicate");
    const limit = numberArg(args, "limit");

    const facts = context.store.queryFacts({
      ...(subject !== undefined ? { subject } : {}),
      ...(predicate !== undefined ? { predicate } : {}),
      ...(limit !== undefined ? { limit } : {}),
    });

    return {
      ok: true,
      tool: "memory_recall",
      message: `Found ${facts.length} fact(s).`,
      data: facts.map((fact) => ({
        factId: fact.factId,
        subject: fact.subject,
        predicate: fact.predicate,
        objectSummary: fact.objectSummary,
        verificationStatus: fact.verificationStatus,
        memoryType: fact.memoryType,
        valid_at: fact.valid_at,
      })),
    };
  },
};

// ---------------------------------------------------------------------------
// memory_update
// ---------------------------------------------------------------------------

export const memoryUpdateTool: MemorySelfEditTool = {
  name: "memory_update",
  description:
    "Update an existing fact by superseding it with new information. Creates a new fact and invalidates the old one with reason 'superseded'.",
  parameters: {
    type: "object",
    properties: {
      factId: { type: "string", description: "ID of the fact to update." },
      subject: { type: "string", description: "New subject (optional)." },
      predicate: { type: "string", description: "New predicate (optional)." },
      objectSummary: { type: "string", description: "New object summary (optional)." },
      confidence: { type: "number", description: "New confidence (optional)." },
    },
    required: ["factId"],
  },
  execute(args, context) {
    const factId = stringArg(args, "factId");
    if (factId === undefined) {
      return {
        ok: false,
        tool: "memory_update",
        message: "Missing required argument: factId.",
      };
    }

    const existing = context.store.getFactById(factId);
    if (existing === undefined) {
      return {
        ok: false,
        tool: "memory_update",
        message: `Fact not found: ${factId}.`,
      };
    }

    const now = resolveNow(context);
    const newFactId = `${factId}_superseded_${now}`;
    const subject = stringArg(args, "subject") ?? existing.subject;
    const predicate = stringArg(args, "predicate") ?? existing.predicate;
    const objectSummary = stringArg(args, "objectSummary") ?? existing.objectSummary;
    const confidence = numberArg(args, "confidence") ?? existing.confidence;

    const sourceEpisodeRefs: RuntimeMemorySourceEpisodeRef[] =
      existing.sourceEpisodeRefs.length > 0
        ? existing.sourceEpisodeRefs.map(cloneSourceEpisodeRef)
        : [
            {
              episodeId: "memory_self_edit",
              taskId: context.taskId ?? "memory_self_edit",
              kind: "human_confirmation",
              idempotencyKey: `memory_self_edit:${factId}:${now}`,
              reference_time: now,
            },
          ];

    const evidenceRefs: EvidenceRef[] = [
      ...existing.evidenceRefs.map(cloneEvidenceRef),
      selfEditEvidenceRef(now),
    ];

    const newFact: RuntimeMemoryTemporalFact = {
      schemaVersion: 1,
      factId: newFactId,
      ...(existing.taskId !== undefined ? { taskId: existing.taskId } : {}),
      subject,
      predicate,
      objectSummary,
      confidence,
      source: "human_confirmation",
      sourceEpisodeRefs,
      evidenceRefs,
      valid_at: now,
      reference_time: now,
      acceptedAt: now,
      verificationStatus: "human_approved",
      ...(existing.memoryType !== undefined ? { memoryType: existing.memoryType } : {}),
      promotion: {
        promotedBy: "human",
        evidenceRefs: [selfEditEvidenceRef(now)],
      },
    };

    const appendResult = persistFact(context, newFact);
    if (!appendResult.ok) {
      return {
        ok: false,
        tool: "memory_update",
        message: `Failed to persist new fact: ${appendResult.message}.`,
      };
    }

    const invalidation: RuntimeMemoryInvalidationProposal = {
      schemaVersion: 1,
      invalidationId: `invalidation_${factId}_${now}`,
      factId,
      reason: "superseded",
      invalid_at: now,
      reference_time: now,
      proposedBy: "human_confirmation",
      verificationStatus: "human_approved",
      sourceEpisodeRefs,
      evidenceRefs: [selfEditEvidenceRef(now)],
      replacementFactId: newFactId,
    };

    const sanitizedInvalidation = sanitizeRuntimeMemoryInvalidationProposal(invalidation);
    if (!sanitizedInvalidation.accepted) {
      return {
        ok: false,
        tool: "memory_update",
        message: `Failed to create invalidation: ${sanitizedInvalidation.message}.`,
      };
    }

    const invalidationResult = persistInvalidation(context, sanitizedInvalidation.value);
    if (!invalidationResult.ok) {
      return {
        ok: false,
        tool: "memory_update",
        message: `Failed to persist invalidation: ${invalidationResult.message}.`,
      };
    }

    const relationResult = persistSupersedesRelation(context, newFactId, factId);
    if (!relationResult.ok) {
      return {
        ok: false,
        tool: "memory_update",
        message: `Failed to persist supersedes relation: ${relationResult.message}.`,
      };
    }

    return {
      ok: true,
      tool: "memory_update",
      message: `Fact ${factId} superseded by ${newFactId}.`,
      data: {
        oldFactId: factId,
        newFactId,
        updatedFields: {
          ...(subject !== existing.subject ? { subject } : {}),
          ...(predicate !== existing.predicate ? { predicate } : {}),
          ...(objectSummary !== existing.objectSummary ? { objectSummary } : {}),
          ...(confidence !== existing.confidence ? { confidence } : {}),
        },
      },
    };
  },
};

// ---------------------------------------------------------------------------
// memory_forget
// ---------------------------------------------------------------------------

export const memoryForgetTool: MemorySelfEditTool = {
  name: "memory_forget",
  description:
    "Actively forget (invalidate) a fact. Marks the fact as invalidated with the given reason.",
  parameters: {
    type: "object",
    properties: {
      factId: { type: "string", description: "ID of the fact to forget." },
      reason: {
        type: "string",
        enum: ["retracted", "human_rejected"],
        description: "Reason for forgetting. Defaults to 'retracted'.",
      },
    },
    required: ["factId"],
  },
  execute(args, context) {
    const factId = stringArg(args, "factId");
    if (factId === undefined) {
      return {
        ok: false,
        tool: "memory_forget",
        message: "Missing required argument: factId.",
      };
    }

    const existing = context.store.getFactById(factId);
    if (existing === undefined) {
      return {
        ok: false,
        tool: "memory_forget",
        message: `Fact not found: ${factId}.`,
      };
    }

    const now = resolveNow(context);
    const reason = (stringArg(args, "reason") as "retracted" | "human_rejected" | undefined) ?? "retracted";

    const sourceEpisodeRefs: RuntimeMemorySourceEpisodeRef[] =
      existing.sourceEpisodeRefs.length > 0
        ? [...existing.sourceEpisodeRefs]
        : [
            {
              episodeId: "memory_self_edit",
              taskId: context.taskId ?? "memory_self_edit",
              kind: "human_confirmation",
              idempotencyKey: `memory_self_edit_forget:${factId}:${now}`,
              reference_time: now,
            },
          ];

    const invalidation: RuntimeMemoryInvalidationProposal = {
      schemaVersion: 1,
      invalidationId: `invalidation_${factId}_${now}`,
      factId,
      reason,
      invalid_at: now,
      reference_time: now,
      proposedBy: "human_confirmation",
      verificationStatus: "human_approved",
      sourceEpisodeRefs,
      evidenceRefs: [selfEditEvidenceRef(now)],
    };

    const sanitizedInvalidation = sanitizeRuntimeMemoryInvalidationProposal(invalidation);
    if (!sanitizedInvalidation.accepted) {
      return {
        ok: false,
        tool: "memory_forget",
        message: `Failed to create invalidation: ${sanitizedInvalidation.message}.`,
      };
    }

    const invalidationResult = persistInvalidation(context, sanitizedInvalidation.value);
    if (!invalidationResult.ok) {
      return {
        ok: false,
        tool: "memory_forget",
        message: `Failed to persist invalidation: ${invalidationResult.message}.`,
      };
    }

    return {
      ok: true,
      tool: "memory_forget",
      message: `Fact ${factId} forgotten (reason: ${reason}).`,
      data: { factId, reason },
    };
  },
};

// ---------------------------------------------------------------------------
// memory_strengthen
// ---------------------------------------------------------------------------

export const memoryStrengthenTool: MemorySelfEditTool = {
  name: "memory_strengthen",
  description:
    "Strengthen a fact's retention signal by recording a usage access. This boosts the fact's eviction score, making it less likely to be evicted under capacity pressure.",
  parameters: {
    type: "object",
    properties: {
      factId: { type: "string", description: "ID of the fact to strengthen." },
    },
    required: ["factId"],
  },
  execute(args, context) {
    const factId = stringArg(args, "factId");
    if (factId === undefined) {
      return {
        ok: false,
        tool: "memory_strengthen",
        message: "Missing required argument: factId.",
      };
    }

    const existing = context.store.getFactById(factId);
    if (existing === undefined) {
      return {
        ok: false,
        tool: "memory_strengthen",
        message: `Fact not found: ${factId}.`,
      };
    }

    if (context.persistence !== undefined) {
      const accessResult = context.persistence.recordFactAccess(factId);
      if (accessResult.status !== "persisted") {
        const message = accessResult.status === "rejected"
          ? accessResult.message
          : `persistence skipped (${accessResult.reason})`;
        return {
          ok: false,
          tool: "memory_strengthen",
          message: `Failed to persist usage access: ${message}`,
        };
      }
      context.store.recordFactAccess(factId);
      return {
        ok: true,
        tool: "memory_strengthen",
        message: `Fact ${factId} strengthened (usage count: ${accessResult.accessCount}).`,
        data: { factId, usageCount: accessResult.accessCount },
      };
    }

    context.store.recordFactAccess(factId);

    const usageStats = context.store.getUsageStats();
    const stat = usageStats.find((s) => s.factId === factId);
    const newCount = stat?.count ?? 0;

    return {
      ok: true,
      tool: "memory_strengthen",
      message: `Fact ${factId} strengthened (usage count: ${newCount}).`,
      data: { factId, usageCount: newCount },
    };
  },
};

// ---------------------------------------------------------------------------
// memory_find_related
// ---------------------------------------------------------------------------

export const memoryFindRelatedTool: MemorySelfEditTool = {
  name: "memory_find_related",
  description:
    "Find facts related to a given fact via the relation chain (1-hop or 2-hop). Useful for exploring memory connections such as superseded facts, contradictions, or semantically related facts.",
  parameters: {
    type: "object",
    properties: {
      factId: { type: "string", description: "The fact ID to find relations for." },
      relationType: {
        type: "string",
        enum: ["supersedes", "contradicts", "related_to"],
        description: "Optional filter by relation type.",
      },
      hops: {
        type: "number",
        minimum: 1,
        maximum: 2,
        default: 1,
        description: "Number of hops (1 or 2).",
      },
      limit: {
        type: "number",
        minimum: 1,
        maximum: 20,
        default: 10,
        description: "Maximum number of related facts to return.",
      },
    },
    required: ["factId"],
  },
  execute(args, context) {
    const factId = stringArg(args, "factId");
    if (factId === undefined) {
      return {
        ok: false,
        tool: "memory_find_related",
        message: "Missing required argument: factId.",
      };
    }

    const rawRelationType = stringArg(args, "relationType");
    const relationType: RuntimeMemoryRelationType | undefined =
      rawRelationType !== undefined && isRuntimeMemoryRelationType(rawRelationType)
        ? rawRelationType
        : undefined;

    const hops = clampNumber(numberArg(args, "hops"), 1, 2, 1);
    const limit = clampNumber(numberArg(args, "limit"), 1, 20, 10);

    const sourceFact = context.store.getFactById(factId);
    if (sourceFact === undefined) {
      return {
        ok: false,
        tool: "memory_find_related",
        message: `Fact not found: ${factId}.`,
      };
    }

    const visited = new Set<string>([factId]);
    const collectedRelations: RuntimeMemoryFactRelation[] = [];
    let frontier: string[] = [factId];

    for (let hop = 0; hop < hops; hop++) {
      const nextFrontier: string[] = [];
      for (const currentId of frontier) {
        const outgoing = context.store.queryRelations(currentId, relationType);
        const incoming = context.store.queryReverseRelations(currentId, relationType);
        const allRelations = [...outgoing, ...incoming];
        for (const rel of allRelations) {
          collectedRelations.push(rel);
          const otherId = rel.sourceFactId === currentId
            ? rel.targetFactId
            : rel.targetFactId === currentId
              ? rel.sourceFactId
              : undefined;
          if (otherId === undefined) continue;
          if (visited.has(otherId)) continue;
          visited.add(otherId);
          nextFrontier.push(otherId);
        }
      }
      frontier = nextFrontier;
    }

    const relatedFactIds = [...visited].filter((id) => id !== factId);
    const facts = relatedFactIds
      .slice(0, limit)
      .map((id) => context.store.getFactById(id))
      .filter((f): f is NonNullable<typeof f> => f !== undefined);

    const seenRelationIds = new Set<string>();
    const uniqueRelations = collectedRelations.filter((r) => {
      if (seenRelationIds.has(r.relationId)) return false;
      seenRelationIds.add(r.relationId);
      return true;
    });

    return {
      ok: true,
      tool: "memory_find_related",
      message: `Found ${facts.length} related fact(s) within ${hops} hop(s).`,
      data: {
        facts: facts.map((fact) => ({
          factId: fact.factId,
          subject: fact.subject,
          predicate: fact.predicate,
          objectSummary: fact.objectSummary,
          verificationStatus: fact.verificationStatus,
          memoryType: fact.memoryType,
          valid_at: fact.valid_at,
        })),
        relations: uniqueRelations.map((rel) => ({
          relationId: rel.relationId,
          sourceFactId: rel.sourceFactId,
          targetFactId: rel.targetFactId,
          relationType: rel.relationType,
          confidence: rel.confidence,
        })),
        hops,
      },
    };
  },
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const MEMORY_SELF_EDIT_TOOLS: readonly MemorySelfEditTool[] = [
  memoryRecallTool,
  memoryUpdateTool,
  memoryForgetTool,
  memoryStrengthenTool,
  memoryFindRelatedTool,
];

export function getMemorySelfEditTool(
  name: MemorySelfEditToolName,
): MemorySelfEditTool | undefined {
  return MEMORY_SELF_EDIT_TOOLS.find((tool) => tool.name === name);
}

export function executeMemorySelfEditTool(
  name: MemorySelfEditToolName,
  args: unknown,
  context: MemorySelfEditToolContext,
): Promise<MemorySelfEditToolResult> | MemorySelfEditToolResult {
  const tool = getMemorySelfEditTool(name);
  if (tool === undefined) {
    return Promise.resolve({
      ok: false,
      tool: name,
      message: `Unknown tool: ${name}.`,
    });
  }
  return tool.execute(args, context);
}
