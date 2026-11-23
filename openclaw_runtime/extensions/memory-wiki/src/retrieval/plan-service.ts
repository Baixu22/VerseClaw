import { createHash } from "node:crypto";
import {
  createRetrievalPlan,
  runRetrievalPlan,
  type RetrievalHit,
  type RetrievalMode,
  type RetrievalProfile,
  type RetrievalGeneration,
} from "openclaw/plugin-sdk/knowledge-retrieval";
import {
  evaluateOwnerReadSnapshot,
  matchOwnerReadPin,
  type SourceRefV2,
} from "openclaw/plugin-sdk/memory-host-core";
import type { OpenClawConfig } from "../../api.js";
import type { ResolvedMemoryWikiConfig } from "../config.js";
import {
  createMemoryWikiReadContext,
  memoryWikiNamespaceId,
  type MemoryWikiReadIdentity,
} from "../owner-read.js";
import { getMemoryWikiPage, searchMemoryWiki } from "../query.js";
import type { MemoryWikiProjectionService } from "../retrieval-index.js";
import type { MemoryWikiEmbeddingService } from "../retrieval-embeddings.js";
import type { MemoryWikiVectorService } from "./vector-service.js";
import type { MemoryWikiRerankService } from "../retrieval-rerank.js";

type WikiCandidate = {
  lookup: string;
  title: string;
  snippet: string;
  freshnessLevel?: string;
  matchedClaimStatus?: string;
  metadata?: Record<string, unknown>;
  ownerConfirmed?: boolean;
};

/** The plugin supplies source bytes; the shared planner owns bounded rank fusion. */
export async function retrieveMemoryWiki(input: {
  config: ResolvedMemoryWikiConfig;
  appConfig?: OpenClawConfig;
  identity: MemoryWikiReadIdentity;
  query: string;
  profile?: RetrievalProfile;
  mode?: RetrievalMode;
  explicitRefs?: SourceRefV2[];
  deadlineAtMs?: number;
  /** A caller may tighten the owner policy when no remote retrieval tariff is available. */
  allowRemote?: boolean;
  signal?: AbortSignal;
  projection?: MemoryWikiProjectionService;
  embedding?: MemoryWikiEmbeddingService;
  vector?: MemoryWikiVectorService;
  rerank?: MemoryWikiRerankService;
  requestId?: string;
}) {
  const context = () =>
    createMemoryWikiReadContext({
      config: input.config,
      appConfig: input.appConfig,
      identity: input.identity,
    });
  const initialRerankStatus = input.rerank?.status(input.identity);
  const remoteRerankDenied = input.allowRemote === false && initialRerankStatus?.mode === "remote";
  const initialContext = context();
  const namespaceId = memoryWikiNamespaceId(input.config);
  const generations = (): RetrievalGeneration[] => {
    const result: RetrievalGeneration[] = [];
    try {
      const index = input.projection?.status(input.identity);
      if (index && "sources" in index) {
        for (const source of index.sources) {
          if (source.eligible && source.activeGeneration)
            result.push({ namespaceId, lane: "lexical", generation: source.activeGeneration });
        }
      }
    } catch {
      /* Unavailable owner scope has no active generation. */
    }
    try {
      const vector = input.vector?.snapshot(input.identity);
      if (vector)
        result.push({
          namespaceId,
          lane: "dense",
          generation: vector.generationId,
          spaceId: vector.spaceId,
          credentialEpoch: vector.credentialEpoch,
        });
    } catch {
      /* Provider availability is returned by the dense lane. */
    }
    return result.sort(
      (a, b) => a.lane.localeCompare(b.lane) || a.generation.localeCompare(b.generation),
    );
  };
  const initialGenerations = generations();
  const scopeKey = (value: typeof initialContext) =>
    JSON.stringify([
      value.principalId,
      value.sessionId,
      value.sessionKey,
      value.workspaceId,
      value.workspaceRootDigest,
      value.policyDigest,
    ]);
  const plan = createRetrievalPlan({
    query: input.query,
    profile: input.profile ?? input.config.retrieval.profile,
    mode: input.mode,
    explicitRefs: input.explicitRefs,
    namespaceIds: [memoryWikiNamespaceId(input.config)],
    deadlineAtMs: input.deadlineAtMs,
    requestId: input.requestId,
    admissionContextId: initialContext.contextId,
    generations: initialGenerations,
  });
  const rerankProviderRef =
    !remoteRerankDenied && initialRerankStatus?.mode === "remote"
      ? initialRerankStatus.providerRef
      : undefined;
  const read = (lookup: string, signal: AbortSignal, sourceRef?: SourceRefV2) =>
    getMemoryWikiPage({
      config: input.config,
      appConfig: input.appConfig,
      lookup,
      sourceRef,
      searchCorpus: "wiki",
      readIdentity: input.identity,
      lineCount: Number.MAX_SAFE_INTEGER,
      signal,
    });
  let rerank:
    | {
        provider: Awaited<ReturnType<MemoryWikiRerankService["provider"]>>;
        candidates: (hit: RetrievalHit<WikiCandidate>) => { id: string; text: string };
      }
    | undefined;
  let rerankUnavailable: string | undefined = remoteRerankDenied
    ? "remote-retrieval-cost-unquoted"
    : undefined;
  if (input.rerank && !remoteRerankDenied && !plan.explicitRefs.length && plan.budget.rerankK) {
    try {
      rerank = {
        provider: await input.rerank.provider(input.identity),
        candidates: (hit) => ({ id: hit.id, text: hit.data.snippet }),
      };
    } catch (error) {
      rerankUnavailable = error instanceof Error ? error.message : String(error);
    }
  }
  const result = await runRetrievalPlan<WikiCandidate>({
    plan,
    signal: input.signal,
    retrieve: async ({ lane, query, signal }) => {
      signal.throwIfAborted();
      if (lane === "exact") {
        const refs = plan.explicitRefs;
        // A path query resolves the exact canonical path. Prose does not become a fuzzy pin.
        const lookups = refs.length
          ? refs.map((ref) => ref.subjectId)
          : /^[^\n<>?]{1,256}\.md$/u.test(query.text)
            ? [query.text]
            : [];
        const hits: RetrievalHit<WikiCandidate>[] = [],
          denied = [];
        for (const [index, lookup] of lookups.entries()) {
          const page = await read(lookup, signal, refs[index]);
          if (!page?.ownerSnapshot || page.status === "denied" || page.path !== lookup) {
            denied.push({
              namespaceId: plan.namespaceIds[0],
              subjectId: lookup,
              reason: page?.reason ?? "exact-ref-unavailable",
            });
            continue;
          }
          const sourceRef = page.ownerSnapshot.source;
          const id = createHash("sha256").update(JSON.stringify(sourceRef)).digest("hex");
          hits.push({
            id,
            sourceRef,
            rawScore: 1,
            scoreKind: "exact-ref",
            data: { lookup, title: page.title, snippet: page.ownerSnapshot.content },
          });
        }
        return { status: "available", hits, denied };
      }
      if (lane === "lexical") {
        const found = await input.projection
          ?.search(input.identity, query.text, Math.min(100, plan.budget.candidateK))
          .catch(() => undefined);
        if (!found || found.status === "unavailable") {
          // The ADR keeps the owner page reader as the missing-index compatibility path.
          const rows = await searchMemoryWiki({
            config: input.config,
            appConfig: input.appConfig,
            query: query.text,
            searchCorpus: "wiki",
            searchBackend: "local",
            maxResults: plan.budget.candidateK,
            readIdentity: input.identity,
          });
          const hits: RetrievalHit<WikiCandidate>[] = [],
            denied = [];
          for (const row of rows) {
            signal.throwIfAborted();
            if (!row.sourceRef) continue;
            const page = await read(row.sourceRef.subjectId, signal, row.sourceRef);
            if (!page?.ownerSnapshot || page.status === "denied") {
              denied.push({
                namespaceId: row.sourceRef.namespaceId,
                subjectId: row.sourceRef.subjectId,
                reason: page?.reason ?? "page-read-unavailable",
              });
              continue;
            }
            hits.push({
              id: createHash("sha256").update(JSON.stringify(row.sourceRef)).digest("hex"),
              sourceRef: row.sourceRef,
              rawScore: row.score,
              scoreKind: "page-lexical",
              data: {
                lookup: row.sourceRef.subjectId,
                title: page.title,
                snippet: page.ownerSnapshot.content,
              },
            });
          }
          return { status: "available", reason: "page-lexical-fallback", hits, denied };
        }
        return {
          status: found.status,
          ...("reason" in found ? { reason: found.reason } : {}),
          denied: "denied" in found ? found.denied : [],
          hits: found.candidates.map((hit) => ({
            id: hit.chunkId,
            sourceRef: hit.sourceRef,
            rawScore: hit.lexicalRank,
            scoreKind: "bm25",
            data: {
              lookup: hit.sourceRef.subjectId,
              title: hit.sourceRef.subjectId,
              snippet: hit.quote,
            },
          })),
        };
      }
      if (!input.vector)
        return { status: "unavailable", reason: "vector-index-unavailable", hits: [] };
      if (input.allowRemote === false && input.embedding?.status(input.identity).mode === "remote")
        return { status: "unavailable", reason: "remote-retrieval-cost-unquoted", hits: [] };
      if (plan.profile === "local" && input.embedding?.status(input.identity).mode === "remote")
        return { status: "unavailable", reason: "remote-provider-not-in-local-profile", hits: [] };
      const found = await input.vector.search(input.identity, query.text, plan.budget.candidateK, {
        signal,
        deadlineAt: plan.budget.deadlineAtMs,
      });
      return {
        status: found.status === "available" ? "available" : "unavailable",
        ...("reason" in found ? { reason: found.reason } : {}),
        denied: "denied" in found ? found.denied : [],
        hits: found.candidates.map((hit) => ({
          id: hit.chunkId,
          sourceRef: hit.sourceRef,
          rawScore: hit.distance,
          scoreKind: "cosine-distance",
          data: {
            lookup: hit.sourceRef.subjectId,
            title: hit.sourceRef.subjectId,
            snippet: hit.quote,
          },
        })),
      };
    },
    verify: async (hit, signal) => {
      const page = await read(hit.sourceRef.subjectId, signal, hit.sourceRef);
      if (!page?.ownerSnapshot || page.status === "denied")
        return page?.reason ?? "owner-read-unavailable";
      const currentContext = context();
      if (scopeKey(currentContext) !== scopeKey(initialContext)) return "identity-changed";
      const reason =
        matchOwnerReadPin(page.ownerSnapshot, hit.sourceRef) ??
        evaluateOwnerReadSnapshot(page.ownerSnapshot, currentContext, { signal }) ??
        (rerank && rerankProviderRef
          ? evaluateOwnerReadSnapshot(page.ownerSnapshot, currentContext, {
              stage: "rerank",
              providerRef: rerankProviderRef,
              signal,
            })
          : undefined);
      if (reason) return reason;
      if (page.ownerSnapshot.content !== hit.data.snippet) return "chunk-content-changed";
      hit.data.title = page.title;
      const freshnessKnown = [
        page.ownerSnapshot.policy.verifiedAt,
        page.ownerSnapshot.policy.updatedAt,
      ].some((value) => Number.isFinite(Date.parse(value ?? "")));
      hit.data.freshnessLevel = freshnessKnown ? "fresh" : "unknown";
      hit.data.matchedClaimStatus = page.hasConflicts ? "contradicted" : undefined;
      hit.data.ownerConfirmed =
        ["confirmed", "high-trust"].includes(page.ownerSnapshot.policy.trust) && freshnessKnown;
      hit.data.metadata = {
        type: page.pageType ?? page.kind,
        knowledgeKind: page.pageType ?? page.kind,
      };
      return undefined;
    },
    ...(rerank ? { rerank } : {}),
  });
  if (rerankUnavailable) {
    result.fallbackReasons.push(`rerank-unavailable:${rerankUnavailable}`);
    if (result.status === "complete") result.status = "partial";
  }
  if (
    scopeKey(context()) !== scopeKey(initialContext) ||
    JSON.stringify(generations()) !== JSON.stringify(initialGenerations)
  ) {
    result.snapshotStatus = "changed";
    result.status = "unavailable";
    result.effectiveProfile = "none";
    result.results = [];
    result.fallbackReasons.push("owner-or-index-generation-changed");
  }
  const exactParents = new Set(
    result.results
      .filter((hit) => hit.rankSignals.lanes.some((lane) => lane.lane === "exact"))
      .map((hit) => hit.sourceRef.subjectId),
  );
  return {
    ...result,
    results: result.results.map((hit) => {
      const { ownerConfirmed, ...data } = hit.data;
      const eligible =
        exactParents.size === 1 &&
        hit.rankSignals.lanes.some((lane) => lane.lane === "exact") &&
        ownerConfirmed === true &&
        hit.data.freshnessLevel === "fresh" &&
        Boolean(hit.data.snippet?.trim()) &&
        hit.data.matchedClaimStatus !== "contradicted";
      return {
        ...data,
        id: hit.id,
        pagePath: hit.sourceRef.subjectId,
        sourceRef: hit.sourceRef,
        revision: hit.sourceRef.revision,
        corpus: "wiki" as const,
        rank: hit.rank,
        score: hit.rankSignals.fusionScore,
        scoreKind: "rrf",
        rankSignals: hit.rankSignals,
        autoReadAdmission: {
          eligible,
          contextId: initialContext.contextId,
          reason: eligible
            ? "owner-confirmed-exact-ref"
            : !ownerConfirmed
              ? "source-confirmation-or-freshness-unavailable"
              : hit.data.matchedClaimStatus === "contradicted"
                ? "source-conflict"
                : "relevance-calibration-unavailable",
        },
      };
    }),
  };
}
