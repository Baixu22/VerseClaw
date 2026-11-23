import { randomUUID } from "node:crypto";
import { setMaxListeners } from "node:events";
import type { RetrievalPolicyV1 } from "../../../../shared/knowledge/observability.js";
import {
  RETRIEVAL_PROFILES,
  defaultRetrievalPolicy,
  normalizeRetrievalPolicy,
  retrievalPolicyDigest,
} from "./policy.js";
import type { SourceRefV2 } from "../../runtime-core/knowledge-owner-read.js";

import type {
  RankSignalsV2,
  RetrievalFilter,
  RetrievalGeneration,
  RetrievalHit,
  RetrievalIntent,
  RetrievalLane,
  RetrievalLaneResult,
  RetrievalMode,
  RetrievalPlanV2,
  RetrievalProfile,
  RetrievalQuery,
  RetrievalResultV2,
} from "../../../../shared/knowledge/retrieval.js";
import type { RerankCandidate, RerankProviderV1 } from "./rerank.js";
export type {
  RankSignalsV2,
  RetrievalBudget,
  RetrievalFilter,
  RetrievalGeneration,
  RetrievalHit,
  RetrievalIntent,
  RetrievalLane,
  RetrievalLaneReceipt,
  RetrievalLaneResult,
  RetrievalMode,
  RetrievalPlanV2,
  RetrievalProfile,
  RetrievalQuery,
  RetrievalResultV2,
} from "../../../../shared/knowledge/retrieval.js";

export { RETRIEVAL_PROFILES } from "./policy.js";

export function createRetrievalPlan(input: {
  query: string;
  mode?: RetrievalMode;
  profile?: RetrievalProfile;
  namespaceIds: readonly string[];
  explicitRefs?: readonly SourceRefV2[];
  queries?: readonly RetrievalQuery[];
  deadlineAtMs?: number;
  now?: number;
  requestId?: string;
  admissionContextId?: string;
  generations?: readonly RetrievalGeneration[];
  intent?: RetrievalIntent;
  policy?: RetrievalPolicyV1;
}): RetrievalPlanV2 {
  const profile = input.profile ?? "local",
    mode = input.mode ?? "suggest";
  if (
    !Object.hasOwn(RETRIEVAL_PROFILES, profile) ||
    !["off", "manual", "suggest", "auto-read"].includes(mode)
  )
    throw new Error("Invalid retrieval policy");
  if (typeof input.query !== "string" || Array.from(input.query).length > 4000)
    throw new Error("Retrieval query exceeds 4000 characters");
  if (
    !input.namespaceIds.length ||
    input.namespaceIds.length > 16 ||
    input.namespaceIds.some((id) => !id || id.length > 256)
  )
    throw new Error("Invalid retrieval owner scope");
  const policy = RETRIEVAL_PROFILES[profile],
    now = input.now ?? Date.now();
  const ranking = input.policy
    ? normalizeRetrievalPolicy(input.policy)
    : defaultRetrievalPolicy(profile);
  if (ranking.profile !== profile) throw new Error("Retrieval policy profile mismatch");
  if (input.deadlineAtMs !== undefined && !Number.isFinite(input.deadlineAtMs))
    throw new Error("Invalid retrieval deadline");
  const queries = input.queries ?? [{ text: input.query.trim(), family: "root" }];
  if (
    queries.length > policy.maxQueries ||
    queries.some(
      (query) =>
        !query.family || typeof query.text !== "string" || Array.from(query.text).length > 4000,
    )
  )
    throw new Error("Retrieval query budget exceeded");
  const explicitRefs = input.explicitRefs ?? [];
  if (explicitRefs.length > policy.candidateK)
    throw new Error("Retrieval reference budget exceeded");
  if (explicitRefs.some((ref) => !input.namespaceIds.includes(ref.namespaceId)))
    throw new Error("Explicit retrieval reference is outside the owner scope");
  const active =
    mode !== "off" &&
    (mode !== "manual" || explicitRefs.length > 0) &&
    Boolean(input.query.trim() || explicitRefs.length);
  return Object.freeze({
    schema: "RetrievalPlan/v2",
    planId: randomUUID(),
    requestId: input.requestId ?? randomUUID(),
    admissionContextId: input.admissionContextId ?? null,
    policyVersion: ranking.version,
    policyDigest: retrievalPolicyDigest(ranking),
    rrfK: ranking.rrfK,
    mode,
    profile,
    intent:
      input.intent ??
      (explicitRefs.length
        ? "lookup"
        : /summary|summari|总结|概览/u.test(input.query.toLowerCase())
          ? "summary"
          : /relationship|depend|关系|依赖/u.test(input.query.toLowerCase())
            ? "relationship"
            : /troubleshoot|error|fail|排障|故障|报错/u.test(input.query.toLowerCase())
              ? "troubleshooting"
              : /decision|why|决定|为什么/u.test(input.query.toLowerCase())
                ? "decision"
                : /procedure|how|步骤|如何/u.test(input.query.toLowerCase())
                  ? "procedure"
                  : "lookup"),
    namespaceIds: Object.freeze([...new Set(input.namespaceIds)]),
    queries: Object.freeze(queries.map((query) => Object.freeze({ ...query }))),
    explicitRefs: Object.freeze(
      explicitRefs.map((ref) =>
        Object.freeze({
          ...ref,
          ...(ref.locator ? { locator: Object.freeze({ ...ref.locator }) } : {}),
        }),
      ),
    ),
    generations: Object.freeze(
      (input.generations ?? []).map((generation) => Object.freeze({ ...generation })),
    ),
    lanes: Object.freeze(
      active
        ? explicitRefs.length
          ? ["exact" as const]
          : ["exact" as const, "lexical" as const, "dense" as const]
        : [],
    ),
    budget: Object.freeze({
      candidateK: ranking.candidateK,
      rerankK: ranking.rerankK,
      finalK: ranking.finalK,
      maxPerParent: ranking.maxPerParent,
      maxTokens: policy.maxTokens,
      maxChars: policy.maxChars,
      maxQueries: policy.maxQueries,
      maxModelCalls: policy.maxModelCalls,
      deadlineAtMs: Math.min(now + policy.deadlineMs, input.deadlineAtMs ?? Infinity),
    }),
  });
}

const parentKey = (ref: Pick<SourceRefV2, "namespaceId" | "subjectId">) =>
  JSON.stringify([ref.namespaceId, ref.subjectId]);
const pinKey = (ref: SourceRefV2) =>
  JSON.stringify([
    ref.domain,
    ref.authorityId,
    ref.namespaceId,
    ref.subjectId,
    ref.revision,
    ref.sourceDigest,
    ref.policyEpoch,
    ref.locator
      ? [
          ref.locator.coordinateSpace,
          ref.locator.startByte,
          ref.locator.endByteExclusive,
          ref.locator.startLine,
          ref.locator.endLine,
        ]
      : null,
  ]);

/** Each query family casts at most one vote per owner/lane for a canonical hit. */
export function fuseRetrievalLanes<T>(
  input: Array<{
    lane: RetrievalLane;
    namespaceId: string;
    queryFamily: string;
    hits: RetrievalHit<T>[];
  }>,
  denied: readonly RetrievalFilter[] = [],
  rrfK = 60,
) {
  if (!Number.isSafeInteger(rrfK) || rrfK < 1 || rrfK > 1000)
    throw new Error("Invalid rank fusion constant");
  const blocked = new Set(denied.map(parentKey));
  const filters = [...denied];
  const fused = new Map<string, RetrievalHit<T> & { rankSignals: RankSignalsV2 }>();
  const sourceVersions = new Map<string, string>();
  const identities = new Map<string, SourceRefV2>();
  for (const batch of input) {
    const signalKey = JSON.stringify([batch.namespaceId, batch.lane, batch.queryFamily]);
    const seen = new Set<string>();
    let ordinal = 0;
    for (const hit of batch.hits) {
      if (
        hit.sourceRef.namespaceId !== batch.namespaceId ||
        blocked.has(parentKey(hit.sourceRef)) ||
        !Number.isFinite(hit.rawScore)
      )
        continue;
      const parent = parentKey(hit.sourceRef);
      const version = pinKey({ ...hit.sourceRef, locator: undefined });
      const identityKey = JSON.stringify([batch.namespaceId, hit.id]);
      const previousIdentity = identities.get(identityKey);
      if (
        (sourceVersions.has(parent) && sourceVersions.get(parent) !== version) ||
        (previousIdentity && pinKey(previousIdentity) !== pinKey(hit.sourceRef))
      ) {
        if (previousIdentity) blocked.add(parentKey(previousIdentity));
        blocked.add(parentKey(hit.sourceRef));
        filters.push({
          namespaceId: hit.sourceRef.namespaceId,
          subjectId: hit.sourceRef.subjectId,
          reason: "inconsistent-source-pin",
        });
        continue;
      }
      sourceVersions.set(parent, version);
      identities.set(identityKey, hit.sourceRef);
      const key = pinKey(hit.sourceRef);
      if (seen.has(key)) continue;
      seen.add(key);
      ordinal += 1;
      const entry = fused.get(key) ?? {
        ...hit,
        rankSignals: { schema: "RankSignals/v2" as const, fusionScore: 0, lanes: [] },
      };
      const rank = ordinal;
      const previous = entry.rankSignals.lanes.find(
        (lane) => JSON.stringify([lane.namespaceId, lane.lane, lane.queryFamily]) === signalKey,
      );
      if (!previous || rank < previous.rank) {
        if (previous) entry.rankSignals.lanes.splice(entry.rankSignals.lanes.indexOf(previous), 1);
        entry.rankSignals.lanes.push({
          lane: batch.lane,
          namespaceId: batch.namespaceId,
          queryFamily: batch.queryFamily,
          rank,
          rawScore: hit.rawScore,
          scoreKind: hit.scoreKind,
          contribution: 1 / (rrfK + rank),
        });
      }
      entry.rankSignals.fusionScore = entry.rankSignals.lanes.reduce(
        (sum, lane) => sum + lane.contribution,
        0,
      );
      fused.set(key, entry);
    }
  }
  return {
    filters,
    hits: [...fused.values()]
      .filter((hit) => !blocked.has(parentKey(hit.sourceRef)))
      .sort(
        (a, b) =>
          b.rankSignals.fusionScore - a.rankSignals.fusionScore ||
          a.sourceRef.namespaceId.localeCompare(b.sourceRef.namespaceId) ||
          a.id.localeCompare(b.id),
      ),
  };
}

export async function runRetrievalPlan<T>(options: {
  plan: RetrievalPlanV2;
  signal?: AbortSignal;
  retrieve: (input: {
    lane: RetrievalLane;
    namespaceId: string;
    query: RetrievalQuery;
    plan: RetrievalPlanV2;
    signal: AbortSignal;
  }) => Promise<RetrievalLaneResult<T>>;
  verify: (hit: RetrievalHit<T>, signal: AbortSignal) => Promise<string | undefined>;
  rerank?: {
    provider: RerankProviderV1;
    candidates: (hit: RetrievalHit<T>) => RerankCandidate;
  };
}): Promise<RetrievalResultV2<T>> {
  const { plan } = options;
  const result: RetrievalResultV2<T> = {
    schema: "RetrievalResult/v2",
    plan,
    status: "disabled",
    effectiveProfile: "none",
    results: [],
    lanes: [],
    filters: [],
    fallbackReasons: [],
    snapshotStatus: "current",
  };
  if (!plan.lanes.length) return result;
  const deadline = new AbortController();
  const signal = options.signal
    ? AbortSignal.any([options.signal, deadline.signal])
    : deadline.signal;
  const remaining = plan.budget.deadlineAtMs - Date.now();
  if (remaining <= 0)
    deadline.abort(new DOMException("Retrieval deadline exceeded", "TimeoutError"));
  const timer =
    remaining > 0
      ? setTimeout(
          () => deadline.abort(new DOMException("Retrieval deadline exceeded", "TimeoutError")),
          remaining,
        )
      : undefined;
  timer?.unref();
  // Lane waits leave time for a current owner read; fallback never starts a new deadline.
  const laneDeadline = new AbortController();
  const laneSignal = AbortSignal.any([signal, laneDeadline.signal]);
  const laneTimer =
    remaining > 0
      ? setTimeout(
          () =>
            laneDeadline.abort(
              new DOMException("Retrieval lane deadline exceeded", "TimeoutError"),
            ),
          Math.floor(remaining * 0.7),
        )
      : undefined;
  laneTimer?.unref();
  setMaxListeners(
    Math.max(10, plan.namespaceIds.length * plan.queries.length * plan.lanes.length + 1),
    signal,
    laneSignal,
  );
  const bounded = async <R>(work: () => Promise<R>, waitSignal = signal): Promise<R> => {
    waitSignal.throwIfAborted();
    let onAbort!: () => void;
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(waitSignal.reason);
      waitSignal.addEventListener("abort", onAbort, { once: true });
    });
    try {
      return await Promise.race([work(), aborted]);
    } finally {
      waitSignal.removeEventListener("abort", onAbort);
    }
  };
  try {
    const batches = await Promise.all(
      plan.namespaceIds.flatMap((namespaceId) =>
        plan.queries.flatMap((query) =>
          plan.lanes.map(async (lane) => {
            const started = performance.now();
            let response: RetrievalLaneResult<T>;
            try {
              response = await bounded(
                () => options.retrieve({ lane, namespaceId, query, plan, signal: laneSignal }),
                laneSignal,
              );
            } catch (error) {
              response = {
                status: "unavailable",
                reason: error instanceof Error ? error.message : String(error),
                hits: [],
              };
            }
            const hits = response.hits
              .filter((hit) => {
                if (hit.sourceRef.namespaceId === namespaceId) return true;
                result.filters.push({
                  namespaceId: hit.sourceRef.namespaceId,
                  subjectId: hit.sourceRef.subjectId,
                  reason: "owner-scope-mismatch",
                });
                return false;
              })
              .slice(0, plan.budget.candidateK);
            result.filters.push(...(response.denied ?? []));
            result.lanes.push({
              lane,
              namespaceId,
              queryFamily: query.family,
              status: laneSignal.aborted ? "cancelled" : response.status,
              ...(response.reason ? { reason: response.reason } : {}),
              candidateCount: hits.length,
              elapsedMs: performance.now() - started,
            });
            return { lane, namespaceId, queryFamily: query.family, hits };
          }),
        ),
      ),
    );
    if (laneTimer) clearTimeout(laneTimer);
    result.lanes.sort(
      (a, b) =>
        a.namespaceId.localeCompare(b.namespaceId) ||
        a.queryFamily.localeCompare(b.queryFamily) ||
        plan.lanes.indexOf(a.lane) - plan.lanes.indexOf(b.lane),
    );
    const fused = fuseRetrievalLanes(batches, result.filters, plan.rrfK ?? 60);
    result.filters = fused.filters;
    const pool = fused.hits.slice(0, plan.budget.candidateK);
    let ranked: typeof pool | undefined;
    const verified: typeof pool = [];
    for (const hit of pool) {
      if (signal.aborted) break;
      try {
        const reason = await bounded(() => options.verify(hit, signal));
        if (reason)
          result.filters.push({
            namespaceId: hit.sourceRef.namespaceId,
            subjectId: hit.sourceRef.subjectId,
            reason,
          });
        else verified.push(hit);
      } catch (error) {
        result.filters.push({
          namespaceId: hit.sourceRef.namespaceId,
          subjectId: hit.sourceRef.subjectId,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (plan.budget.rerankK && !plan.explicitRefs.length && verified.length) {
      if (!options.rerank) result.fallbackReasons.push("rerank-unavailable");
      else {
        const candidates = verified.slice(0, plan.budget.rerankK);
        try {
          const receipt = await bounded(() =>
            options.rerank!.provider.rerank(
              plan.queries[0].text,
              candidates.map((hit) => options.rerank!.candidates(hit)),
              {
                signal,
                deadlineAtMs: plan.budget.deadlineAtMs,
                batchSize: 16,
                batchChars: 16000,
              },
            ),
          );
          result.rerank = receipt;
          if (receipt.status !== "complete") throw new Error(`rerank-${receipt.status}`);
          const byId = new Map(candidates.map((hit) => [hit.id, hit]));
          if (
            receipt.candidateCount !== candidates.length ||
            receipt.results.length !== candidates.length ||
            new Set(receipt.results.map((row) => row.id)).size !== candidates.length ||
            receipt.results.some((row) => !byId.has(row.id) || !Number.isFinite(row.score))
          ) {
            throw new Error("Rerank result does not match the admitted candidate set");
          }
          const ordered = receipt.results.map((row) => byId.get(row.id)!);
          const checked: typeof pool = [];
          for (const hit of ordered) {
            const reason = await bounded(() => options.verify(hit, signal));
            if (reason) throw new Error(`Rerank owner verification failed: ${reason}`);
            checked.push(hit);
          }
          ranked = [...checked, ...verified.slice(candidates.length)];
        } catch (error) {
          result.fallbackReasons.push(
            `rerank-failed:${error instanceof Error ? error.message : String(error)}`.slice(0, 240),
          );
        }
      }
    }
    const denied = new Set(result.filters.map(parentKey)),
      counts = new Map<string, number>();
    for (const hit of ranked ?? verified) {
      const parent = parentKey(hit.sourceRef),
        count = counts.get(parent) ?? 0;
      if (denied.has(parent)) continue;
      if (count >= plan.budget.maxPerParent) {
        result.filters.push({
          namespaceId: hit.sourceRef.namespaceId,
          subjectId: hit.sourceRef.subjectId,
          reason: "parent-quota",
        });
        continue;
      }
      result.results.push({ ...hit, rank: result.results.length + 1 });
      counts.set(parent, count + 1);
      if (result.results.length === plan.budget.finalK) break;
    }
    result.filters.sort(
      (a, b) =>
        a.namespaceId.localeCompare(b.namespaceId) ||
        a.subjectId.localeCompare(b.subjectId) ||
        a.reason.localeCompare(b.reason),
    );
    result.fallbackReasons = [
      ...result.fallbackReasons,
      ...result.lanes
        .filter((lane) => lane.status !== "available" || lane.reason)
        .map((lane) => `${lane.lane}:${lane.reason ?? lane.status}`),
    ].filter((reason, index, all) => all.indexOf(reason) === index);
    if (
      plan.budget.rerankK &&
      !plan.explicitRefs.length &&
      !ranked &&
      !result.fallbackReasons.includes("rerank-unavailable")
    )
      result.fallbackReasons.push("rerank-unavailable");
    if (signal.aborted)
      result.fallbackReasons.push(deadline.signal.aborted ? "deadline-exceeded" : "cancelled");
    const hasDense = result.lanes.some(
      (lane) => lane.lane === "dense" && lane.status === "available",
    );
    result.effectiveProfile =
      plan.explicitRefs.length && result.lanes.some((lane) => lane.status === "available")
        ? "exact"
        : hasDense
          ? plan.profile === "local"
            ? "local"
            : "hybrid"
          : result.lanes.some((lane) => lane.status === "available")
            ? "lexical"
            : "none";
    result.status =
      signal.aborted && !deadline.signal.aborted
        ? "cancelled"
        : result.fallbackReasons.length
          ? "partial"
          : "complete";
    if (result.status === "cancelled") result.results = [];
    if (result.effectiveProfile === "none" && result.status !== "cancelled")
      result.status = "unavailable";
    return result;
  } finally {
    if (timer) clearTimeout(timer);
    if (laneTimer) clearTimeout(laneTimer);
  }
}
