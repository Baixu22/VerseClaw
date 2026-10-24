import crypto from "node:crypto";
import {
  archiveMemoryCard,
  ensureMemoryCardsLoaded,
  getMemoryCard,
  getMemoryCards,
  isRoleMemoryEnabled,
  listMemoryProposals,
} from "../../memory/memory-store.js";
import { isInjectableMemoryCard } from "../../memory/memory-card.js";
import type { MemoryCard, MemoryProposalRecord } from "../../memory/types.js";

export type MemorySurfaceSource = "role-memory-card" | "runtime-fact";
export type MemorySurfaceEntryState = "accepted" | "candidate";

export type MemorySurfaceEntry = {
  key: string;
  id: string;
  source: MemorySurfaceSource;
  state: MemorySurfaceEntryState;
  stateLabel: string;
  content: string;
  subject?: string;
  predicate?: string;
  objectSummary?: string;
  scope: string;
  scopeKey?: string | null;
  roleTags: string[];
  sourceLabel: string;
  createdAt: string;
  updatedAt?: string | null;
  sensitivity: string;
  confidence?: number | null;
  importance?: number | null;
  evidenceCount: number;
  provenance: string[];
  injectable: boolean;
  retrievable: boolean;
  modelVisible: boolean;
  deletable: boolean;
  proposalId?: string;
  reason?: string | null;
  riskLevel?: string | null;
};

export type MemorySurfaceGate = {
  enabled: boolean;
  readGate: "open" | "closed";
  writeGate: "open" | "closed";
  candidateCapture: boolean;
  candidatePersistence: boolean;
  modelRetrieval: boolean;
  reason?: string;
};

export type MemorySurfaceProjection = {
  schemaVersion: "MemorySurface/v1";
  generatedAt: string;
  accepted: MemorySurfaceEntry[];
  candidates: MemorySurfaceEntry[];
  status: {
    roleMemory: MemorySurfaceGate & { owner: "role-memory-card-governance" };
    runtimeMemory: MemorySurfaceGate & {
      owner: "runtime-memory-store";
      persist: boolean;
      provider: boolean;
      injectionPilotEnabled: boolean;
      injectionProviders: string[];
    };
    legacySources: Array<{
      id: "native-openclaw-memory";
      controlledHere: false;
      mayAffectPrompt: true;
      explanation: string;
    }>;
  };
  model: {
    acceptedOnly: true;
    acceptedKeys: string[];
    candidateKeysExcluded: string[];
    candidateBoundary: string;
  };
  counts: {
    accepted: number;
    candidates: number;
    modelVisible: number;
  };
};

type SurfaceParams = {
  limit?: number;
  getRuntimeConfig: () => unknown;
};

type RuntimeMemoryEntry = {
  factId: string;
  taskId?: string;
  subject: string;
  predicate: string;
  objectSummary: string;
  verificationStatus: string;
  confidence?: number;
  sensitivity?: string;
  source: string;
  sourceEpisodeRefs: Array<{ episodeId: string; taskId?: string }>;
  evidenceRefs: Array<{ ref: string; type?: string }>;
  proposedAt?: number;
  acceptedAt?: number;
  valid_at?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readLimit(value: unknown, fallback = 100): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(200, Math.floor(value)));
}

function isoFrom(value: number | string | null | undefined): string {
  if (typeof value === "string" && value) return value;
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toISOString();
  return new Date(0).toISOString();
}

function resolveInjectionPilot(config: unknown): { enabled: boolean; providers: string[] } {
  const runtime = isRecord(config) && isRecord(config.runtime) ? config.runtime : undefined;
  const memory = isRecord(runtime?.memory) ? runtime.memory : undefined;
  const injectPilot = isRecord(memory?.injectPilot) ? memory.injectPilot : undefined;
  const providers = Array.isArray(injectPilot?.providers)
    ? injectPilot.providers.filter((value): value is string => typeof value === "string")
    : ["role-memory"];
  return { enabled: injectPilot?.enabled === true, providers };
}

function secretLike(sensitivity: string | null | undefined): boolean {
  return sensitivity === "secret" || sensitivity === "secret_adjacent";
}

function asRuntimeMemoryEntry(value: unknown): RuntimeMemoryEntry {
  const record = isRecord(value) ? value : {};
  const evidenceRefs = Array.isArray(record.evidenceRefs)
    ? record.evidenceRefs.flatMap((entry) => {
      if (!isRecord(entry) || typeof entry.ref !== "string") return [];
      return [{ ref: entry.ref, ...(typeof entry.type === "string" ? { type: entry.type } : {}) }];
    })
    : [];
  const sourceEpisodeRefs = Array.isArray(record.sourceEpisodeRefs)
    ? record.sourceEpisodeRefs.flatMap((entry) => {
      if (!isRecord(entry) || typeof entry.episodeId !== "string") return [];
      return [{ episodeId: entry.episodeId, ...(typeof entry.taskId === "string" ? { taskId: entry.taskId } : {}) }];
    })
    : [];
  return {
    factId: typeof record.factId === "string" ? record.factId : "",
    ...(typeof record.taskId === "string" ? { taskId: record.taskId } : {}),
    subject: typeof record.subject === "string" ? record.subject : "",
    predicate: typeof record.predicate === "string" ? record.predicate : "",
    objectSummary: typeof record.objectSummary === "string" ? record.objectSummary : "",
    verificationStatus: typeof record.verificationStatus === "string" ? record.verificationStatus : "unknown",
    ...(typeof record.confidence === "number" ? { confidence: record.confidence } : {}),
    ...(typeof record.sensitivity === "string" ? { sensitivity: record.sensitivity } : {}),
    source: typeof record.source === "string" ? record.source : "unknown",
    sourceEpisodeRefs,
    evidenceRefs,
    ...(typeof record.proposedAt === "number" ? { proposedAt: record.proposedAt } : {}),
    ...(typeof record.acceptedAt === "number" ? { acceptedAt: record.acceptedAt } : {}),
    ...(typeof record.valid_at === "number" ? { valid_at: record.valid_at } : {}),
  };
}

function roleCardEntry(card: MemoryCard, modelRetrieval: boolean): MemorySurfaceEntry {
  const redacted = secretLike(card.sensitivity);
  const injectable = isInjectableMemoryCard(card) && !redacted;
  const evidenceRefs = redacted ? [] : card.evidenceRefs?.map((entry) => `${entry.type}:${entry.ref}`) ?? [];
  return {
    key: `role-memory-card:${card.id}`,
    id: card.id,
    source: "role-memory-card",
    state: "accepted",
    stateLabel: card.status,
    content: redacted ? '[redacted secret memory]' : card.content,
    scope: card.scope,
    scopeKey: card.scopeKey ?? null,
    roleTags: card.roleTags ?? [],
    sourceLabel: card.source ?? "role",
    createdAt: isoFrom(card.createdAt),
    updatedAt: card.updatedAt ?? null,
    sensitivity: card.sensitivity ?? "normal",
    confidence: card.confidence,
    importance: card.importance,
    evidenceCount: Math.max(card.evidence?.length ?? 0, evidenceRefs.length),
    provenance: redacted ? [] : [...(card.evidence ?? []), ...evidenceRefs],
    injectable,
    retrievable: injectable,
    modelVisible: modelRetrieval && injectable,
    deletable: true,
  };
}

function roleCandidateEntry(proposal: MemoryProposalRecord): MemorySurfaceEntry {
  const redacted = secretLike(proposal.proposal.sensitivity);
  const evidenceRefs = redacted ? [] : proposal.proposal.evidenceRefs?.map((entry) => `${entry.type}:${entry.ref}`) ?? [];
  return {
    key: `role-memory-card:proposal:${proposal.id}`,
    id: proposal.id,
    source: "role-memory-card",
    state: "candidate",
    stateLabel: proposal.status,
    content: redacted ? '[redacted secret memory candidate]' : proposal.proposal.content,
    scope: proposal.proposal.scope,
    scopeKey: proposal.proposal.scopeKey ?? null,
    roleTags: proposal.proposal.roleTags ?? [],
    sourceLabel: proposal.proposal.source ?? "role",
    createdAt: isoFrom(proposal.createdAt),
    updatedAt: proposal.decidedAt ?? null,
    sensitivity: proposal.proposal.sensitivity ?? "normal",
    confidence: proposal.proposal.confidence ?? null,
    importance: proposal.proposal.importance ?? null,
    evidenceCount: Math.max(proposal.proposal.evidence?.length ?? 0, evidenceRefs.length),
    provenance: redacted ? [] : [...(proposal.proposal.evidence ?? []), ...evidenceRefs],
    injectable: false,
    retrievable: false,
    modelVisible: false,
    deletable: false,
    proposalId: proposal.id,
    reason: proposal.reasonSummary ?? proposal.reviewReason ?? proposal.permissionReason ?? null,
    riskLevel: proposal.riskLevel ?? null,
  };
}

function runtimeFactEntry(
  fact: RuntimeMemoryEntry,
  state: MemorySurfaceEntryState,
  injectable: boolean,
  modelVisible: boolean,
): MemorySurfaceEntry {
  const redacted = secretLike(fact.sensitivity);
  const ownerEligible = state === "accepted" && !redacted;
  const createdAt = state === "candidate"
    ? isoFrom(fact.proposedAt)
    : isoFrom(fact.acceptedAt ?? fact.valid_at);
  return {
    key: `runtime-fact:${fact.factId}`,
    id: fact.factId,
    source: "runtime-fact",
    state,
    stateLabel: fact.verificationStatus,
    content: redacted ? '[redacted secret runtime memory]' : `${fact.subject} ${fact.predicate}: ${fact.objectSummary}`,
    subject: redacted ? '[redacted]' : fact.subject,
    predicate: redacted ? '[redacted]' : fact.predicate,
    objectSummary: redacted ? '[redacted]' : fact.objectSummary,
    scope: fact.taskId ? "task" : "workspace",
    scopeKey: fact.taskId ?? null,
    roleTags: [],
    sourceLabel: fact.source,
    createdAt,
    updatedAt: null,
    sensitivity: fact.sensitivity ?? "normal",
    confidence: fact.confidence ?? null,
    importance: null,
    evidenceCount: fact.evidenceRefs?.length ?? 0,
    provenance: redacted ? [] : (fact.evidenceRefs ?? []).map((entry) => `${entry.type ?? "evidence"}:${entry.ref}`),
    injectable: ownerEligible && injectable,
    retrievable: ownerEligible && injectable,
    modelVisible: ownerEligible && modelVisible,
    deletable: state === "accepted",
  };
}

export async function buildMemorySurface(params: SurfaceParams): Promise<MemorySurfaceProjection> {
  const limit = readLimit(params.limit);
  const config = params.getRuntimeConfig();
  const roleEnabled = isRoleMemoryEnabled();
  const injectionPilot = resolveInjectionPilot(config);
  const roleModelRetrieval = roleEnabled
    && injectionPilot.enabled
    && injectionPilot.providers.includes("role-memory");

  let roleCards: MemoryCard[] = [];
  let roleProposals: MemoryProposalRecord[] = [];
  if (roleEnabled) {
    ensureMemoryCardsLoaded();
    roleCards = getMemoryCards({ status: "all" })
      .filter((card) => card.status === "active" || card.status === "cold")
      .slice(0, limit);
    roleProposals = listMemoryProposals({ limit })
      .filter((proposal) => proposal.status === "pending" || proposal.status === "needs_review");
  }

  const runtimeMemory = await import("../../runtime-core/memory-context.js");
  const integrationModule = await import("../../runtime-core/memory-runtime-integration.js");
  const flags = runtimeMemory.resolveRuntimeMemoryFeatureFlags(config);
  const runtimeInjectionEnabled = injectionPilot.enabled && injectionPilot.providers.includes("runtime-memory");
  const runtimeModelRetrieval = flags.provider && runtimeInjectionEnabled;

  let runtimeFacts: RuntimeMemoryEntry[] = [];
  let runtimeCandidates: RuntimeMemoryEntry[] = [];
  let runtimeStoreReadable = false;
  if (flags.persist || (flags.shadow && flags.proposeFacts)) {
    try {
      const integration = integrationModule.createRuntimeMemoryRuntimeIntegration({ config });
      const { store } = integration.loadStore();
      runtimeStoreReadable = flags.persist;
      if (flags.persist) {
        runtimeFacts = [...store.queryFacts({ limit })].map(asRuntimeMemoryEntry);
      }
      if (flags.shadow && flags.proposeFacts) {
        runtimeCandidates = [...store.queryFacts({ verificationStatus: "candidate", limit })].map(asRuntimeMemoryEntry);
      }
    } catch {
      runtimeStoreReadable = false;
    }
  }

  const accepted = [
    ...roleCards.map((card) => roleCardEntry(card, roleModelRetrieval)),
    ...runtimeFacts
      .map((fact) => runtimeFactEntry(fact, "accepted", runtimeModelRetrieval, runtimeModelRetrieval)),
  ].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  const candidates = [
    ...roleProposals.map(roleCandidateEntry),
    ...runtimeCandidates
      .map((fact) => runtimeFactEntry(fact, "candidate", false, false)),
  ].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));

  return {
    schemaVersion: "MemorySurface/v1",
    generatedAt: new Date().toISOString(),
    accepted,
    candidates,
    status: {
      roleMemory: {
        owner: "role-memory-card-governance",
        enabled: roleEnabled,
        readGate: roleEnabled ? "open" : "closed",
        writeGate: roleEnabled ? "open" : "closed",
        candidateCapture: roleEnabled,
        candidatePersistence: roleEnabled,
        modelRetrieval: roleModelRetrieval,
        ...(roleEnabled ? {} : { reason: "Role Memory is disabled in Settings." }),
      },
      runtimeMemory: {
        owner: "runtime-memory-store",
        enabled: flags.persist || flags.shadow || flags.proposeFacts,
        readGate: flags.persist ? "open" : "closed",
        writeGate: flags.persist ? "open" : "closed",
        candidateCapture: flags.shadow && flags.proposeFacts,
        candidatePersistence: flags.persist && flags.shadow && flags.proposeFacts,
        modelRetrieval: runtimeModelRetrieval,
        persist: flags.persist,
        provider: flags.provider,
        injectionPilotEnabled: injectionPilot.enabled,
        injectionProviders: injectionPilot.providers,
        ...(!runtimeStoreReadable && (flags.persist || (flags.shadow && flags.proposeFacts))
          ? { reason: "Runtime Memory store is unavailable." }
          : {}),
      },
      legacySources: [{
        id: "native-openclaw-memory",
        controlledHere: false,
        mayAffectPrompt: true,
        explanation: "Native OpenClaw memory sources have separate read-only owners; this Memory panel does not disable or claim control over them.",
      }],
    },
    model: {
      acceptedOnly: true,
      acceptedKeys: accepted.filter((entry) => entry.modelVisible).map((entry) => entry.key),
      candidateKeysExcluded: candidates.map((entry) => entry.key),
      candidateBoundary: "Candidates are persisted review-queue records. They are not retrievable, injectable, or model-visible until an owning approval path accepts them.",
    },
    counts: {
      accepted: accepted.length,
      candidates: candidates.length,
      modelVisible: accepted.filter((entry) => entry.modelVisible).length,
    },
  };
}

export type MemoryDeleteInput = {
  source: MemorySurfaceSource;
  id: string;
  reason?: string;
  getRuntimeConfig: () => unknown;
};

export type MemoryDeleteOutcome =
  | { ok: true; deleted: true; source: MemorySurfaceSource; id: string; state: string }
  | { ok: false; error: string; reviewRequired?: boolean; proposalId?: string };

export async function deleteMemorySurfaceEntry(input: MemoryDeleteInput): Promise<MemoryDeleteOutcome> {
  if (input.source === "role-memory-card") {
    if (!isRoleMemoryEnabled()) {
      return { ok: false, error: "Role Memory is disabled in Settings." };
    }
    const decision = archiveMemoryCard(input.id, "tombstone", {
      reason: input.reason ?? "Deleted from the Memory panel",
    });
    if (!decision.accepted) {
      return {
        ok: false,
        error: decision.reason ?? "Role Memory deletion requires review.",
        reviewRequired: decision.action === "needs_review",
        ...(decision.proposal?.id ? { proposalId: decision.proposal.id } : {}),
      };
    }
    const readback = getMemoryCard(input.id);
    if (!readback || readback.status !== "tombstone") {
      return { ok: false, error: "Role Memory tombstone was not readable after the mutation." };
    }
    return { ok: true, deleted: true, source: input.source, id: input.id, state: readback.status };
  }

  const config = input.getRuntimeConfig();
  const runtimeMemory = await import("../../runtime-core/memory-context.js");
  const integrationModule = await import("../../runtime-core/memory-runtime-integration.js");
  const flags = runtimeMemory.resolveRuntimeMemoryFeatureFlags(config);
  if (!flags.persist) {
    return { ok: false, error: "Runtime Memory persistence is disabled." };
  }
  const integration = integrationModule.createRuntimeMemoryRuntimeIntegration({ config });
  const { store } = integration.loadStore();
  const fact = store.getFactById(input.id);
  if (!fact || fact.verificationStatus === "invalidated") {
    return { ok: false, error: `Runtime Memory fact not found: ${input.id}` };
  }
  const now = Date.now();
  const result = integration.invalidateFact({
    schemaVersion: 1,
    invalidationId: `invalidation_${input.id}_${crypto.randomUUID()}`,
    factId: input.id,
    reason: "retracted",
    invalid_at: now,
    reference_time: now,
    proposedBy: "human_confirmation",
    verificationStatus: "human_approved",
    sourceEpisodeRefs: JSON.parse(JSON.stringify(fact.sourceEpisodeRefs)),
    evidenceRefs: JSON.parse(JSON.stringify(fact.evidenceRefs)),
    metadata: { reason: input.reason ?? "Deleted from the Memory panel", actor: "agent" },
  });
  if (result.status !== "persisted") {
    return {
      ok: false,
      error: result.status === "rejected" ? result.message : "Runtime Memory persistence is disabled.",
    };
  }
  const readback = integration.loadStore().store.getFactById(input.id);
  if (!readback || readback.verificationStatus !== "invalidated") {
    return { ok: false, error: "Runtime Memory invalidation was not readable after the mutation." };
  }
  return { ok: true, deleted: true, source: input.source, id: input.id, state: readback.verificationStatus };
}
