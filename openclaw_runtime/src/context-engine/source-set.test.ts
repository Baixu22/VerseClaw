import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createContextCandidate,
  collectContextCandidate,
  finalizeContextCandidates,
} from "./context-candidate.js";
import { beginTurnInjectionBudget } from "./turn-injection-budget.js";
import {
  createResolvedChatKnowledgeRef,
  type ResolvedChatKnowledgeRef,
} from "./chat-knowledge-intent.js";
import {
  packSourceSetForDcs,
  resolveSourceSetCitation,
  retrieveSourceSet,
  sourceSetSourceFromResolvedChatKnowledgeRef,
  SOURCE_SET_SCHEMA,
  type SourceSetCandidate,
  type SourceSetQuery,
  type SourceSetResult,
} from "./source-set.js";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function ref(input: {
  refId: string;
  owner?: SourceSetCandidate["ref"]["owner"];
  subjectKind?: SourceSetCandidate["ref"]["subjectKind"];
  subjectId: string;
  revision?: string;
  content: string;
  sensitivity?: SourceSetCandidate["ref"]["sensitivity"];
  acl?: string[];
  workspaceId?: string;
  roleTags?: string[];
  indexedAt?: string;
  status?: SourceSetCandidate["status"];
  claims?: SourceSetCandidate["claims"];
  conflictKeys?: string[];
}): SourceSetCandidate {
  return {
    ref: {
      refId: input.refId,
      owner: input.owner ?? "memory-wiki",
      subjectKind: input.subjectKind ?? "wiki-page",
      subjectId: input.subjectId,
      revision: input.revision ?? "rev-1",
      contentDigest: `sha256:${sha256(input.content)}`,
      ...(input.workspaceId || input.roleTags
        ? {
            scope: {
              ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
              ...(input.roleTags ? { roleTags: input.roleTags } : {}),
            },
          }
        : {}),
      trust: "advisory",
      sensitivity: input.sensitivity ?? "workspace",
      acl: { read: input.acl ?? [] },
      provenance: { sourceRefs: [`${input.owner ?? "memory-wiki"}:${input.subjectId}`], evidenceRefs: [] },
    },
    content: input.content,
    status: input.status ?? "active",
    indexedAt: input.indexedAt ?? "2026-08-18T10:00:00.000Z",
    ...(input.claims ? { claims: input.claims } : {}),
    ...(input.conflictKeys ? { conflictKeys: input.conflictKeys } : {}),
  };
}

const FIXED_NOW = new Date("2026-08-18T12:00:00.000Z");

const DEPLOY_RUNBOOK = ref({
  refId: "wiki:deploy-runbook",
  subjectId: "deploy-runbook",
  revision: "rev-2",
  content:
    "Production gateway deploy runbook: bind the gateway to localhost, run health checks, and roll back before retrying. The gateway control port is 8080.",
  claims: [
    { claimId: "port", statement: "Gateway control port", stance: "8080" },
    { claimId: "deploy-order", statement: "Deploy order", stance: "health-check-before-rollback" },
  ],
  conflictKeys: ["gateway-deploy-port"],
});

const DEPLOY_LEGACY = ref({
  refId: "wiki:deploy-legacy",
  subjectId: "deploy-legacy",
  revision: "rev-1",
  content: "Legacy deployment notes still describe the gateway control port as 9090.",
  claims: [{ claimId: "port", statement: "Gateway control port", stance: "9090" }],
  conflictKeys: ["gateway-deploy-port"],
});

const SESSION_PINNING = ref({
  refId: "memory-slot:session-pinning",
  owner: "memory-slot",
  subjectKind: "memory-card",
  subjectId: "session-pinning",
  revision: "7",
  content: "Pin sessions to the primary agent and keep the Task Ledger projection durable.",
  claims: [{ claimId: "pinning", statement: "Session pinning policy", stance: "primary-agent" }],
});

const RETRY_PRINCIPLE = ref({
  refId: "sekb:retry-idempotent",
  owner: "sekb",
  subjectKind: "experience-principle",
  subjectId: "retry-idempotent",
  revision: "2026-08-17T10:00:00.000Z",
  content: "Retry only idempotent writes before reporting a task as failed.",
  claims: [{ claimId: "retry", statement: "Retry policy", stance: "idempotent-only" }],
});

const STALE_PAGE = ref({
  refId: "wiki:stale-page",
  subjectId: "stale-page",
  status: "stale",
  content: "Stale gateway deploy notes that must never ground an answer.",
});

const ARCHIVED_PAGE = ref({
  refId: "wiki:archived-page",
  subjectId: "archived-page",
  status: "archived",
  content: "Archived gateway deploy notes.",
});

const REVOKED_PAGE = ref({
  refId: "wiki:revoked-page",
  subjectId: "revoked-page",
  status: "revoked",
  content: "Revoked gateway deploy notes.",
});

const DELETED_PAGE = ref({
  refId: "wiki:deleted-page",
  subjectId: "deleted-page",
  status: "deleted",
  content: "Deleted gateway deploy notes.",
});

const DENIED_PAGE = ref({
  refId: "wiki:denied-page",
  subjectId: "denied-page",
  status: "denied",
  content: "Denied gateway deploy notes.",
});

const SECRET_PAGE = ref({
  refId: "wiki:secret-page",
  subjectId: "secret-page",
  sensitivity: "secret",
  content: "Secret gateway deploy notes.",
});

const ACL_PAGE = ref({
  refId: "wiki:acl-page",
  subjectId: "acl-page",
  acl: ["ops-agent"],
  content: "ACL-gated gateway deploy notes.",
});

function noRuntimeMemory(result: SourceSetResult): Omit<SourceSetResult, "runtimeMemoryShadow"> {
  const { runtimeMemoryShadow: _runtimeMemoryShadow, ...rest } = result;
  return rest;
}

describe("retrieveSourceSet filtering and evidence status", () => {
  const query: SourceSetQuery = {
    text: "How do I deploy the gateway and choose the control port?",
    taskContext: {
      taskId: "task-deploy",
      taskIntent: "deploy gateway safely",
      taskType: "deploy",
      roleTags: ["ops"],
    },
    aclSubjects: ["chat-user"],
    sensitivityCeiling: "workspace",
  };

  it("rejects archived/revoked/deleted/denied/stale/sensitivity/ACL sources and never grounds them", async () => {
    const result = await retrieveSourceSet({
      query,
      sources: [
        DEPLOY_RUNBOOK,
        DEPLOY_LEGACY,
        STALE_PAGE,
        ARCHIVED_PAGE,
        REVOKED_PAGE,
        DELETED_PAGE,
        DENIED_PAGE,
        SECRET_PAGE,
        ACL_PAGE,
      ],
      now: () => FIXED_NOW,
    });

    const rejectedRefIds = new Set(result.rejections.map((entry) => entry.refId));
    expect(rejectedRefIds.has(STALE_PAGE.ref.refId)).toBe(true);
    expect(rejectedRefIds.has(ARCHIVED_PAGE.ref.refId)).toBe(true);
    expect(rejectedRefIds.has(REVOKED_PAGE.ref.refId)).toBe(true);
    expect(rejectedRefIds.has(DELETED_PAGE.ref.refId)).toBe(true);
    expect(rejectedRefIds.has(DENIED_PAGE.ref.refId)).toBe(true);
    expect(rejectedRefIds.has(SECRET_PAGE.ref.refId)).toBe(true);
    expect(rejectedRefIds.has(ACL_PAGE.ref.refId)).toBe(true);

    const groundedRefIds = new Set(
      result.claims.flatMap((claim) => claim.citations.map((citation) => citation.refId)),
    );
    for (const refId of rejectedRefIds) {
      expect(groundedRefIds.has(refId)).toBe(false);
    }
    for (const retrieved of result.retrieved) {
      expect(retrieved.status).toBe("active");
    }
  });

  it("returns missing_sources with zero claims, zero citations, and explicit unknowns", async () => {
    const result = await retrieveSourceSet({
      query: { text: "zqxxwvy" },
      sources: [DEPLOY_RUNBOOK, SESSION_PINNING],
      now: () => FIXED_NOW,
    });
    expect(result.evidenceStatus).toBe("missing_sources");
    expect(result.retrieved).toHaveLength(0);
    expect(result.claims).toHaveLength(0);
    expect(result.conflictSet).toHaveLength(0);
    expect(result.unknowns.length).toBeGreaterThan(0);
    expect(result.suggestedNextActions.length).toBeGreaterThan(0);
    expect(result.semanticLane).toEqual({ status: "unavailable", reason: "embedding-provider-unavailable" });
  });

  it("returns partial when one pinned ref resolves and one is missing", async () => {
    const result = await retrieveSourceSet({
      query: {
        text: "deploy gateway",
        pinnedRefs: [
          { owner: "memory-wiki", subjectId: "deploy-runbook", revision: "rev-2" },
          { owner: "memory-wiki", subjectId: "does-not-exist", revision: "rev-1" },
        ],
      },
      sources: [DEPLOY_RUNBOOK],
      now: () => FIXED_NOW,
    });
    expect(result.evidenceStatus).toBe("partial");
    expect(result.retrieved.map((entry) => entry.ref.refId)).toEqual(["wiki:deploy-runbook"]);
    expect(result.unresolvedPinnedRefs).toHaveLength(1);
    expect(result.unresolvedPinnedRefs[0]?.reason).toBe("not_found");
  });

  it("discloses annotated claim and source conflicts instead of silently picking one side", async () => {
    const result = await retrieveSourceSet({
      query: { text: "gateway control port" },
      sources: [DEPLOY_RUNBOOK, DEPLOY_LEGACY],
      now: () => FIXED_NOW,
    });
    expect(result.evidenceStatus).toBe("partial");
    const conflictKeys = result.conflictSet.map((entry) => entry.key);
    expect(conflictKeys).toContain("claim:port");
    expect(conflictKeys).toContain("source:gateway-deploy-port");
    const portConflict = result.conflictSet.find((entry) => entry.key === "claim:port");
    expect(portConflict?.citations.map((citation) => citation.refId).sort()).toEqual([
      "wiki:deploy-legacy",
      "wiki:deploy-runbook",
    ]);
    expect(result.claims.map((claim) => claim.claimId)).not.toContain("port");
    expect(result.claims.map((claim) => claim.claimId)).toContain("deploy-order");
  });

  it("returns grounded for active non-conflicting sources with no unresolved pinned refs", async () => {
    const result = await retrieveSourceSet({
      query: { text: "pin sessions task ledger" },
      sources: [SESSION_PINNING, RETRY_PRINCIPLE],
      now: () => FIXED_NOW,
    });
    expect(result.evidenceStatus).toBe("grounded");
    expect(result.claims.map((claim) => claim.claimId)).toContain("pinning");
  });

  it("never emits a fixed confidence field", async () => {
    const result = await retrieveSourceSet({
      query: { text: "pin sessions task ledger" },
      sources: [SESSION_PINNING],
      now: () => FIXED_NOW,
    });
    expect(JSON.stringify(result)).not.toContain("confidence");
    expect(result.schema).toBe(SOURCE_SET_SCHEMA);
  });
});

describe("retrieveSourceSet lanes", () => {
  it("resolves exact pinned refs directly by owner/subjectId/revision", async () => {
    const result = await retrieveSourceSet({
      query: {
        text: "irrelevant query text",
        pinnedRefs: [
          { owner: "memory-wiki", subjectId: "deploy-runbook", revision: "rev-2" },
          { owner: "memory-slot", subjectId: "session-pinning", revision: "7" },
        ],
      },
      sources: [DEPLOY_RUNBOOK, SESSION_PINNING, RETRY_PRINCIPLE],
      now: () => FIXED_NOW,
    });
    expect(result.retrieved.map((entry) => entry.ref.refId)).toEqual([
      "wiki:deploy-runbook",
      "memory-slot:session-pinning",
    ]);
    expect(result.retrieved.every((entry) => entry.lane === "exact")).toBe(true);
    expect(result.unresolvedPinnedRefs).toHaveLength(0);
  });

  it("rejects pinned refs with revision or digest mismatch", async () => {
    const revisionMismatch = await retrieveSourceSet({
      query: {
        text: "deploy",
        pinnedRefs: [{ owner: "memory-wiki", subjectId: "deploy-runbook", revision: "rev-999" }],
      },
      sources: [DEPLOY_RUNBOOK],
      now: () => FIXED_NOW,
    });
    expect(revisionMismatch.retrieved).toHaveLength(0);
    expect(revisionMismatch.unresolvedPinnedRefs[0]?.reason).toBe("revision_mismatch");
    expect(revisionMismatch.evidenceStatus).toBe("missing_sources");

    const digestMismatch = await retrieveSourceSet({
      query: {
        text: "deploy",
        pinnedRefs: [
          {
            owner: "memory-wiki",
            subjectId: "deploy-runbook",
            revision: "rev-2",
            contentDigest: "sha256:deadbeef",
          },
        ],
      },
      sources: [DEPLOY_RUNBOOK],
      now: () => FIXED_NOW,
    });
    expect(digestMismatch.retrieved).toHaveLength(0);
    expect(digestMismatch.unresolvedPinnedRefs[0]?.reason).toBe("digest_mismatch");
  });

  it("is deterministic for the same query, fixture, and clock", async () => {
    const options = {
      query: { text: "gateway control port" },
      sources: [DEPLOY_RUNBOOK, DEPLOY_LEGACY, SESSION_PINNING, RETRY_PRINCIPLE],
      now: () => FIXED_NOW,
    };
    const first = await retrieveSourceSet(options);
    const second = await retrieveSourceSet(options);
    expect(second).toEqual(first);
  });

  it("freshness reranks equal lexical scores deterministically", async () => {
    const older = ref({
      refId: "wiki:metrics-older",
      subjectId: "metrics-older",
      content: "gateway metrics notes",
      indexedAt: "2026-08-01T10:00:00.000Z",
    });
    const fresher = ref({
      refId: "wiki:metrics-fresher",
      subjectId: "metrics-fresher",
      content: "gateway metrics notes",
      indexedAt: "2026-08-18T10:00:00.000Z",
    });
    const result = await retrieveSourceSet({
      query: { text: "gateway metrics" },
      sources: [older, fresher],
      now: () => FIXED_NOW,
    });
    expect(result.retrieved.map((entry) => entry.ref.refId)).toEqual([
      "wiki:metrics-fresher",
      "wiki:metrics-older",
    ]);
  });

  it("reports semantic:unavailable and degrades to lexical when no provider is supplied", async () => {
    const result = await retrieveSourceSet({
      query: { text: "gateway control port" },
      sources: [DEPLOY_RUNBOOK, DEPLOY_LEGACY],
      now: () => FIXED_NOW,
    });
    expect(result.semanticLane).toEqual({ status: "unavailable", reason: "embedding-provider-unavailable" });
    expect(result.retrieved.length).toBeGreaterThan(0);
  });

  it("uses the embedding provider boundary when available", async () => {
    const provider = {
      id: "deterministic-test-provider",
      dimension: 3,
      embedQuery: async (text: string) => [
        text.includes("gateway") ? 1 : 0,
        text.includes("metrics") ? 1 : 0,
        text.includes("control") ? 1 : 0,
      ],
      embedBatch: async (texts: string[]) =>
        texts.map((text) => [
          text.includes("gateway") ? 1 : 0,
          text.includes("metrics") ? 1 : 0,
          text.includes("control") ? 1 : 0,
        ]),
    };
    const result = await retrieveSourceSet({
      query: { text: "gateway metrics control" },
      sources: [
        ref({ refId: "wiki:no-match", subjectId: "no-match", content: "unrelated pinning policy" }),
        DEPLOY_RUNBOOK,
      ],
      embeddingProvider: provider,
      now: () => FIXED_NOW,
    });
    expect(result.semanticLane.status).toBe("available");
    expect(result.semanticLane).toMatchObject({ providerId: "deterministic-test-provider", dimension: 3 });
    expect(result.retrieved[0]?.ref.refId).toBe("wiki:deploy-runbook");
  });

  it("falls back to lexical when the embedding provider throws", async () => {
    const provider = {
      id: "broken-provider",
      dimension: 2,
      embedQuery: async () => {
        throw new Error("provider down");
      },
      embedBatch: async () => {
        throw new Error("provider down");
      },
    };
    const result = await retrieveSourceSet({
      query: { text: "gateway control port" },
      sources: [DEPLOY_RUNBOOK, DEPLOY_LEGACY],
      embeddingProvider: provider,
      now: () => FIXED_NOW,
    });
    expect(result.semanticLane.status).toBe("error");
    expect(result.retrieved.length).toBeGreaterThan(0);
  });
});

describe("citation resolution and DCS single path", () => {
  it("every grounded claim citation resolves to owner/subjectId/revision/digest", async () => {
    const result = await retrieveSourceSet({
      query: { text: "pin sessions task ledger gateway deploy" },
      sources: [SESSION_PINNING, DEPLOY_RUNBOOK],
      now: () => FIXED_NOW,
    });
    expect(result.claims.length).toBeGreaterThan(0);
    for (const claim of result.claims) {
      for (const citation of claim.citations) {
        expect(citation.owner).toBeTruthy();
        expect(citation.subjectId).toBeTruthy();
        expect(citation.revision).toBeTruthy();
        expect(citation.contentDigest.startsWith("sha256:")).toBe(true);
        const resolved = resolveSourceSetCitation(result, citation);
        expect(resolved).toBeTruthy();
        expect(resolved?.ref.refId).toBe(citation.refId);
        expect(resolved?.ref.contentDigest).toBe(citation.contentDigest);
      }
    }
  });

  it("packSourceSetForDcs travels through the dcs-knowledge ContextCandidate path", async () => {
    const result = await retrieveSourceSet({
      query: { text: "gateway control port" },
      sources: [DEPLOY_RUNBOOK, DEPLOY_LEGACY],
      now: () => FIXED_NOW,
    });
    const turnId = "turn-ks07-source-set";
    const packed = packSourceSetForDcs(result);
    collectContextCandidate(
      turnId,
      createContextCandidate({
        authorityObjectId: `source-set:${turnId}`,
        authorityVersion: "1",
        sourceId: "dcs-knowledge",
        channel: "knowledge",
        target: "message",
        text: packed,
      }),
    );
    const projection = finalizeContextCandidates({
      turnId,
      ledger: beginTurnInjectionBudget({ turnId }),
    });
    expect(projection.messages).toHaveLength(1);
    expect(projection.messages[0]?.content).toContain("SourceSet/v1");
    expect(projection.messages[0]?.content).toContain("evidenceStatus=partial");
    expect(projection.messages[0]?.content).toContain("citation: owner=memory-wiki");
    expect(projection.lineage[0]?.sourceId).toBe("dcs-knowledge");
  });

  it("converts KS-04 resolved refs into exact SourceSet sources", async () => {
    const resolved: ResolvedChatKnowledgeRef = createResolvedChatKnowledgeRef({
      owner: "memory-wiki",
      subjectKind: "wiki-page",
      subjectId: "deploy-runbook",
      revision: "rev-2",
      title: "Deploy Runbook",
      lookup: "deploy-runbook",
      content: DEPLOY_RUNBOOK.content,
      trust: "advisory",
      sensitivity: "workspace",
    });
    const source = sourceSetSourceFromResolvedChatKnowledgeRef(resolved, {
      indexedAt: "2026-08-18T10:00:00.000Z",
    });
    const result = await retrieveSourceSet({
      query: {
        text: "deploy",
        pinnedRefs: [{ owner: "memory-wiki", subjectId: "deploy-runbook", revision: "rev-2" }],
      },
      sources: [source],
      now: () => FIXED_NOW,
    });
    expect(result.retrieved.map((entry) => entry.ref.refId)).toEqual(["memory-wiki:deploy-runbook"]);
    expect(result.retrieved[0]?.lane).toBe("exact");
  });
});

describe("Runtime Memory shadow-only comparison", () => {
  it("shadow-compares Runtime Memory candidates without letting them enter the active answer", async () => {
    const baseline = await retrieveSourceSet({
      query: { text: "pin sessions task ledger" },
      sources: [SESSION_PINNING],
      now: () => FIXED_NOW,
    });
    const withShadow = await retrieveSourceSet({
      query: { text: "pin sessions task ledger" },
      sources: [SESSION_PINNING],
      now: () => FIXED_NOW,
      runtimeMemoryShadow: [
        { refId: "runtime-memory:shadow-pinning", text: "Pin sessions to the primary agent." },
      ],
    });
    expect(withShadow.runtimeMemoryShadow).toMatchObject({
      status: "shadow-only",
      comparedCandidates: 1,
      runtimeMemoryEnteredActiveAnswer: false,
    });
    expect(withShadow.runtimeMemoryShadow?.candidateRefIds).toEqual([
      "runtime-memory:shadow-pinning",
    ]);
    expect(noRuntimeMemory(withShadow)).toEqual(baseline);
    expect(JSON.stringify(noRuntimeMemory(withShadow))).not.toContain(
      "runtime-memory:shadow-pinning",
    );
  });
});
