import { createHash } from "node:crypto";
import { posix } from "node:path";
import type {
  EvidenceGapV1,
  ResearchBudget,
  ResearchEvidence,
  ResearchPlanV1,
  ResearchResultV1,
  ResearchReview,
  ResearchScope,
  ResearchStopReason,
} from "../../../../shared/knowledge/research.js";
import type { RetainedEvidenceManifestV1 } from "../../../../shared/knowledge/packing.js";
import { RETRIEVAL_PROFILES } from "./plan.js";
import { waitForRetrievalOperation } from "./embedding-session.js";

const LIMITS = Object.freeze({
  maxRounds: 3,
  maxQueries: 8,
  maxPlanningModelCalls: 2,
  maxPlanningTokens: 16000,
  maxCostUsd: 0.05,
  maxEvidenceTokens: RETRIEVAL_PROFILES.research.maxTokens,
  maxEvidenceChars: RETRIEVAL_PROFILES.research.maxChars,
  maxSources: RETRIEVAL_PROFILES.research.finalK,
  graphMaxHops: 2,
  graphMaxNodes: 32,
  graphMaxEdges: 128,
});
const digest = (value: string) =>
  "sha256:" + createHash("sha256").update(value, "utf8").digest("hex");
const parent = (source: ResearchEvidence) =>
  JSON.stringify([
    source.sourceRef.domain,
    source.sourceRef.namespaceId,
    source.sourceRef.subjectId,
  ]);
const pin = (source: ResearchEvidence) => JSON.stringify(source.sourceRef);
const queryKey = (text: string) =>
  text.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
const tokens = (text: string) => Math.ceil(Buffer.byteLength(text, "utf8") / 4);

/** Freeze ceilings and owner identity before the first retrieval or planning call. */
export function createResearchPlan(input: {
  requestId: string;
  query: string;
  scope: ResearchScope;
  now?: number;
  budget?: Partial<ResearchBudget>;
}): ResearchPlanV1 {
  const query = input.query.trim(),
    now = input.now ?? Date.now();
  if (
    !query ||
    Array.from(query).length > 4000 ||
    !input.requestId ||
    input.requestId.length > 128 ||
    !input.scope.fingerprint ||
    !["wiki", "memory", "all"].includes(input.scope.corpus)
  )
    throw new TypeError("Invalid research request");
  const values: { -readonly [Key in keyof typeof LIMITS]: number } = { ...LIMITS };
  for (const key of Object.keys(values) as Array<keyof typeof LIMITS>) {
    const value = input.budget?.[key];
    if (value === undefined) continue;
    if (
      !Number.isFinite(value) ||
      value < 0 ||
      value > LIMITS[key] ||
      (key !== "maxCostUsd" && !Number.isSafeInteger(value))
    )
      throw new TypeError("Research budget may only tighten the fixed ceilings");
    values[key] = value;
  }
  if (!values.maxRounds || !values.maxQueries || !values.maxSources)
    throw new TypeError("Research requires a positive retrieval budget");
  const deadlineAtMs = Math.min(
    now + RETRIEVAL_PROFILES.research.deadlineMs,
    input.budget?.deadlineAtMs ?? Infinity,
  );
  if (!Number.isFinite(deadlineAtMs)) throw new TypeError("Invalid research deadline");
  const questions = query
    .split(/(?:[;；\n]+|\s+and\s+|以及|并且)/iu)
    .map((text) => text.trim())
    .filter(Boolean);
  return Object.freeze({
    schema: "ResearchPlan/v1",
    requestId: input.requestId,
    query,
    scope: Object.freeze({ ...input.scope }),
    budget: Object.freeze({ ...values, deadlineAtMs }),
    questions: Object.freeze([...new Set(questions)].slice(0, 8)),
  });
}

export function emptyResearchResult(plan: ResearchPlanV1): ResearchResultV1 {
  return {
    schema: "ResearchResult/v1",
    actor: "knowledge-research",
    driven_by: "agent",
    realHumanEvidence: false,
    plan,
    status: "running",
    phase: "retrieving",
    steps: [],
    evidence: [],
    coverage: [],
    inferences: [],
    conflicts: [],
    gaps: plan.questions.map((question) => ({
      schema: "EvidenceGap/v1",
      question,
      reason: "not-covered",
    })),
    graph: { nodes: [], edges: [], truncated: false },
    usage: {
      queries: 0,
      rounds: 0,
      planningModelCalls: 0,
      reservedPlanningTokens: 0,
      reservedCostUsd: 0,
      actualPlanningTokens: 0,
      actualCostUsd: 0,
      evidenceTokens: 0,
      evidenceChars: 0,
    },
    retainedEvidence: [],
  };
}

/** Recompute quoted coverage from the final DCS manifest after complete-unit budget cuts. */
export function recomputeResearchCoverage(
  input: ResearchResultV1,
  retained: RetainedEvidenceManifestV1,
): ResearchResultV1 {
  const result = structuredClone(input),
    citations = retained.units.flatMap((unit) => unit.citations);
  const admitted = new Set(
    result.evidence
      .filter((source) =>
        citations.some(
          (citation) =>
            (citation.intentId ?? citation.refId) === source.id &&
            citation.chunkDigest === source.contentDigest &&
            citation.sourceDigest === source.sourceRef.sourceDigest,
        ),
      )
      .map((source) => source.id),
  );
  const groups = new Map<string, ResearchEvidence[]>();
  for (const source of result.evidence)
    if (source.conflictGroupId)
      groups.set(source.conflictGroupId, [...(groups.get(source.conflictGroupId) ?? []), source]);
  for (const group of groups.values())
    if (group.some((source) => !admitted.has(source.id)))
      group.forEach((source) => admitted.delete(source.id));
  const dropped = result.evidence.some((source) => !admitted.has(source.id));
  result.evidence = result.evidence.filter((source) => admitted.has(source.id));
  result.coverage = result.coverage.filter(
    (row) =>
      admitted.has(row.sourceId) &&
      result.evidence.some(
        (source) => source.id === row.sourceId && source.content.includes(row.quote),
      ),
  );
  result.conflicts = result.conflicts.filter((conflict) =>
    conflict.citations.every((citation) => admitted.has(citation.sourceId)),
  );
  if (dropped) {
    result.inferences = [];
    result.gaps = result.gaps.filter((gap) => gap.reason !== "not-covered");
    const missing = result.plan.questions.filter(
      (question) => !result.coverage.some((row) => row.question === question),
    );
    for (const question of new Set([...missing, result.plan.query])) {
      if (
        !result.gaps.some(
          (gap) => gap.question === question && gap.reason === "dcs-evidence-not-retained",
        )
      ) {
        result.gaps.push({
          schema: "EvidenceGap/v1",
          question,
          reason: "dcs-evidence-not-retained",
        });
      }
    }
    result.status = result.evidence.length ? "partial" : "unavailable";
  }
  result.graph.edges = result.graph.edges.filter((edge) => admitted.has(edge.sourceId));
  result.graph.nodes = [
    ...new Set([
      ...result.evidence.map((source) => source.lookup),
      ...result.graph.edges.map((edge) => edge.lookup),
    ]),
  ];
  result.usage.evidenceChars = result.evidence.reduce(
    (sum, source) => sum + source.content.length,
    0,
  );
  result.usage.evidenceTokens = result.evidence.reduce(
    (sum, source) => sum + tokens(source.content),
    0,
  );
  result.retainedEvidence = [retained];
  return result;
}

/** Model text supplies proposals. Only exact quotes in current DCS-retained evidence may cover a question. */
export function validateResearchReview(
  raw: string,
  plan: ResearchPlanV1,
  evidence: ResearchEvidence[],
): ResearchReview {
  if (raw.length > 32000) throw new TypeError("Research planning output exceeds its limit");
  const value = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as ResearchReview;
  if (
    !value ||
    !Array.isArray(value.queries) ||
    value.queries.length > 8 ||
    !Array.isArray(value.coverage) ||
    value.coverage.length > 16 ||
    !Array.isArray(value.inferences) ||
    value.inferences.length > 8 ||
    !Array.isArray(value.conflicts) ||
    value.conflicts.length > 8 ||
    !Array.isArray(value.gaps) ||
    value.gaps.length > 16
  )
    throw new TypeError("Invalid research planning output");
  const validText = (text: unknown, limit: number) =>
    typeof text === "string" && Boolean(text.trim()) && text.length <= limit;
  for (const text of value.queries)
    if (!validText(text, 4000)) throw new TypeError("Invalid research subquery");
  for (const text of [...value.inferences, ...value.gaps])
    if (!validText(text, 1500)) throw new TypeError("Invalid research explanation");
  const quote = (citation: { sourceId: string; quote: string }) => {
    const source = evidence.find((source) => source.id === citation?.sourceId);
    if (
      !source ||
      !validText(citation.quote, 4000) ||
      citation.quote.trim().length < 2 ||
      !source.content.includes(citation.quote)
    )
      throw new TypeError("Research quotation is outside retained owner evidence");
  };
  for (const coverage of value.coverage) {
    if (!plan.questions.includes(coverage.question))
      throw new TypeError("Research question is outside the frozen plan");
    quote(coverage);
  }
  for (const conflict of value.conflicts) {
    if (
      !validText(conflict.description, 1500) ||
      !Array.isArray(conflict.citations) ||
      conflict.citations.length > 8 ||
      new Set(conflict.citations.map((citation) => citation.sourceId)).size < 2
    )
      throw new TypeError("Invalid research conflict");
    conflict.citations.forEach(quote);
  }
  return value;
}

export async function runResearchPlan(options: {
  plan: ResearchPlanV1;
  signal?: AbortSignal;
  assertScope: (signal: AbortSignal) => Promise<void>;
  retrieve: (
    query: string,
    signal: AbortSignal,
  ) => Promise<{
    evidence: ResearchEvidence[];
    partial: boolean;
    gaps?: string[];
    conflicts?: ResearchReview["conflicts"];
    denied?: Array<{ domain: string; namespaceId: string; subjectId: string }>;
  }>;
  verify: (source: ResearchEvidence, signal: AbortSignal) => Promise<boolean>;
  planNext: (input: {
    plan: ResearchPlanV1;
    evidence: ResearchEvidence[];
    gaps: EvidenceGapV1[];
    round: number;
    maxTokens: number;
    maxCostUsd: number;
    signal: AbortSignal;
  }) => Promise<{
    review: ResearchReview;
    retainedEvidence?: RetainedEvidenceManifestV1;
    actualTokens: number | null;
    actualCostUsd: number | null;
  }>;
  onUpdate?: (result: ResearchResultV1) => void;
}): Promise<ResearchResultV1> {
  const { plan } = options,
    budget = plan.budget,
    result = emptyResearchResult(plan);
  const deadline = new AbortController(),
    remaining = budget.deadlineAtMs - Date.now();
  const timer =
    remaining > 0
      ? setTimeout(
          () => deadline.abort(new DOMException("Research deadline exceeded", "TimeoutError")),
          remaining,
        )
      : undefined;
  timer?.unref();
  if (remaining <= 0)
    deadline.abort(new DOMException("Research deadline exceeded", "TimeoutError"));
  const signal = options.signal
    ? AbortSignal.any([options.signal, deadline.signal])
    : deadline.signal;
  const bounded = <T>(work: Promise<T>) => waitForRetrievalOperation(work, signal);
  const assertScope = async () => {
    signal.throwIfAborted();
    try {
      await bounded(options.assertScope(signal));
    } catch (error) {
      if (signal.aborted) throw error;
      throw Object.assign(new Error("Research owner scope changed"), {
        code: "RESEARCH_OWNER_CHANGED",
      });
    }
  };
  const publish = () => options.onUpdate?.(structuredClone(result));
  const blocked = new Set<string>(),
    seenQueries = new Set<string>(),
    covered = new Set<string>();
  const notes = new Set<string>();
  let planningNotes: string[] = [];
  let partial = false,
    stop: ResearchStopReason | undefined;
  type Query = { text: string; depth: number; sourceId?: string };
  let pending: Query[] = [
    { text: plan.query, depth: 0 },
    ...plan.questions
      .filter((question) => queryKey(question) !== queryKey(plan.query))
      .map((text) => ({ text, depth: 0 })),
  ];
  const refreshGaps = () => {
    result.gaps = [
      ...plan.questions
        .filter((question) => !covered.has(question))
        .map((question) => ({
          schema: "EvidenceGap/v1" as const,
          question,
          reason: "not-covered",
        })),
      ...[...notes, ...planningNotes].map((reason) => ({
        schema: "EvidenceGap/v1" as const,
        question: plan.query,
        reason,
      })),
    ];
    result.usage.evidenceChars = result.evidence.reduce(
      (sum, source) => sum + source.content.length,
      0,
    );
    result.usage.evidenceTokens = result.evidence.reduce(
      (sum, source) => sum + tokens(source.content),
      0,
    );
  };
  const invalidate = (source: ResearchEvidence) => {
    blocked.add(parent(source));
    notes.add("owner-evidence-changed");
    throw Object.assign(new Error("Research owner evidence changed"), {
      code: "RESEARCH_OWNER_CHANGED",
    });
  };
  const reverify = async () => {
    await assertScope();
    for (const source of [...result.evidence]) {
      signal.throwIfAborted();
      const admitted = await bounded(options.verify(source, signal));
      signal.throwIfAborted();
      if (!admitted) invalidate(source);
    }
  };
  const addLinks = (source: ResearchEvidence, depth: number) => {
    if (source.sourceRef.domain !== "wiki" || depth >= budget.graphMaxHops) return;
    let candidates = 0;
    for (const match of source.content.matchAll(
      /\[[^\]\n]{0,256}\]\(([^)\s]+\.md)(?:#[^)\s]*)?\)/gu,
    )) {
      if (++candidates > 512) {
        result.graph.truncated = true;
        break;
      }
      const raw = match[1];
      if (!raw || /^[a-z][a-z0-9+.-]*:|^[/\\]/iu.test(raw)) continue;
      const lookup = posix.normalize(
        posix.join(posix.dirname(source.lookup.replaceAll("\\", "/")), raw),
      );
      if (lookup.startsWith("../") || lookup.includes("\\") || lookup === source.lookup) continue;
      if (result.graph.edges.some((edge) => edge.sourceId === source.id && edge.lookup === lookup))
        continue;
      const addedNodes = [source.lookup, lookup].filter(
        (node) => !result.graph.nodes.includes(node),
      );
      if (
        result.graph.edges.length >= budget.graphMaxEdges ||
        result.graph.nodes.length + addedNodes.length > budget.graphMaxNodes
      ) {
        result.graph.truncated = true;
        break;
      }
      result.graph.nodes = [...new Set([...result.graph.nodes, source.lookup, lookup])];
      result.graph.edges.push({ sourceId: source.id, lookup, depth: depth + 1 });
      pending.push({ text: lookup, depth: depth + 1, sourceId: source.id });
    }
  };
  try {
    publish();
    for (let round = 1; round <= budget.maxRounds && !stop; round++) {
      await reverify();
      const queries: Query[] = [];
      while (
        pending.length &&
        queries.length < 3 &&
        seenQueries.size + queries.length < budget.maxQueries
      ) {
        const query = pending.shift()!,
          key = queryKey(query.text);
        if (!seenQueries.has(key) && !queries.some((row) => queryKey(row.text) === key))
          queries.push(query);
      }
      if (!queries.length) {
        stop = seenQueries.size >= budget.maxQueries ? "query-budget" : "repeated-query";
        break;
      }
      result.usage.rounds = round;
      let additions = 0;
      for (const query of queries) {
        await reverify();
        signal.throwIfAborted();
        const key = queryKey(query.text);
        seenQueries.add(key);
        result.usage.queries = seenQueries.size;
        result.phase = "retrieving";
        publish();
        const response = await bounded(options.retrieve(query.text, signal));
        await assertScope();
        signal.throwIfAborted();
        partial ||= response.partial;
        for (const reason of response.gaps ?? []) notes.add(reason);
        for (const ref of response.denied ?? []) {
          blocked.add(JSON.stringify([ref.domain, ref.namespaceId, ref.subjectId]));
          const previous = result.evidence.find(
            (source) =>
              parent(source) === JSON.stringify([ref.domain, ref.namespaceId, ref.subjectId]),
          );
          if (previous) invalidate(previous);
        }
        const fresh: ResearchEvidence[] = [];
        for (const source of response.evidence) {
          if (blocked.has(parent(source))) continue;
          if (
            !source.id ||
            !source.sourceRef.locator ||
            source.contentDigest !== digest(source.content) ||
            source.sourceRef.locator.endByteExclusive - source.sourceRef.locator.startByte !==
              Buffer.byteLength(source.content) ||
            !(await bounded(options.verify(source, signal)))
          ) {
            invalidate(source);
            continue;
          }
          const previous = result.evidence.find((row) => parent(row) === parent(source));
          if (
            previous &&
            (previous.sourceRef.revision !== source.sourceRef.revision ||
              previous.sourceRef.sourceDigest !== source.sourceRef.sourceDigest ||
              previous.sourceRef.policyEpoch !== source.sourceRef.policyEpoch)
          ) {
            invalidate(source);
            continue;
          }
          if (
            !result.evidence.some((row) => pin(row) === pin(source)) &&
            !fresh.some((row) => pin(row) === pin(source))
          )
            fresh.push(source);
        }
        const groups = new Map<string, ResearchEvidence[]>();
        for (const source of fresh) {
          const group = source.conflictGroupId ?? pin(source);
          groups.set(group, [...(groups.get(group) ?? []), source]);
        }
        let added = 0;
        for (const group of groups.values()) {
          const chars = group.reduce((sum, source) => sum + source.content.length, 0),
            estimated = group.reduce((sum, source) => sum + tokens(source.content), 0);
          if (
            result.evidence.length + group.length > budget.maxSources ||
            result.usage.evidenceChars + chars > budget.maxEvidenceChars ||
            result.usage.evidenceTokens + estimated > budget.maxEvidenceTokens
          ) {
            notes.add("evidence-budget");
            partial = true;
            stop = "evidence-budget";
            continue;
          }
          result.evidence.push(...group);
          added += group.length;
          group.forEach((source) => addLinks(source, query.depth));
          refreshGaps();
        }
        additions += added;
        for (const conflict of response.conflicts ?? []) {
          if (
            conflict.citations.every((citation) =>
              result.evidence.some(
                (source) =>
                  source.id === citation.sourceId && source.content.includes(citation.quote),
              ),
            )
          )
            result.conflicts.push(conflict);
          else notes.add("conflict-group-not-retained");
        }
        result.conflicts = result.conflicts.filter(
          (conflict, index, conflicts) =>
            conflicts.findIndex((other) => JSON.stringify(other) === JSON.stringify(conflict)) ===
            index,
        );
        result.steps.push({
          schema: "ResearchStep/v1",
          round,
          query: query.text,
          status: response.partial ? "partial" : "complete",
          newEvidence: added,
          sourceIds: result.evidence.map((source) => source.id),
        });
        refreshGaps();
        publish();
        if (stop) break;
      }
      await reverify();
      if (stop) break;
      if (!additions) {
        stop = "no-new-evidence";
        break;
      }
      if (
        result.evidence.length &&
        result.usage.planningModelCalls < budget.maxPlanningModelCalls &&
        result.usage.reservedPlanningTokens < budget.maxPlanningTokens
      ) {
        const maxTokens = Math.min(
          8000,
          Math.floor(
            (budget.maxPlanningTokens - result.usage.reservedPlanningTokens) /
              (budget.maxPlanningModelCalls - result.usage.planningModelCalls),
          ),
        );
        const maxCostUsd = Math.max(
          0,
          (budget.maxCostUsd - result.usage.reservedCostUsd) /
            (budget.maxPlanningModelCalls - result.usage.planningModelCalls),
        );
        result.phase = "planning";
        result.usage.planningModelCalls++;
        result.usage.reservedPlanningTokens += maxTokens;
        result.usage.reservedCostUsd += maxCostUsd;
        publish();
        try {
          const planning = await bounded(
            options.planNext({
              plan,
              evidence: [...result.evidence],
              gaps: result.gaps,
              round,
              maxTokens,
              maxCostUsd,
              signal,
            }),
          );
          await reverify();
          signal.throwIfAborted();
          if (
            (planning.actualTokens !== null &&
              (!Number.isSafeInteger(planning.actualTokens) ||
                planning.actualTokens < 0 ||
                planning.actualTokens > maxTokens)) ||
            (planning.actualCostUsd !== null &&
              (!Number.isFinite(planning.actualCostUsd) ||
                planning.actualCostUsd < 0 ||
                planning.actualCostUsd > maxCostUsd))
          )
            throw new Error("Research planning usage exceeded its reservation");
          result.usage.actualPlanningTokens =
            planning.actualTokens === null || result.usage.actualPlanningTokens === null
              ? null
              : result.usage.actualPlanningTokens + planning.actualTokens;
          result.usage.actualCostUsd =
            planning.actualCostUsd === null || result.usage.actualCostUsd === null
              ? null
              : result.usage.actualCostUsd + planning.actualCostUsd;
          const review = validateResearchReview(
            JSON.stringify(planning.review),
            plan,
            result.evidence,
          );
          if (!planning.retainedEvidence)
            throw new Error("Research planning has no DCS retained evidence receipt");
          const retainedQuotes =
            planning.retainedEvidence?.units.flatMap((unit) => unit.citations) ?? [];
          for (const quote of [
            ...review.coverage,
            ...review.conflicts.flatMap((conflict) => conflict.citations),
          ]) {
            const source = result.evidence.find((source) => source.id === quote.sourceId)!;
            if (
              !retainedQuotes.some(
                (citation) =>
                  (citation.intentId ?? citation.refId) === source.id &&
                  citation.chunkDigest === source.contentDigest &&
                  citation.sourceDigest === source.sourceRef.sourceDigest,
              )
            )
              throw new Error("Research quotation was not retained by DCS");
          }
          if (planning.retainedEvidence) result.retainedEvidence.push(planning.retainedEvidence);
          const validCoverage = review.coverage.filter((row) =>
            result.evidence.some(
              (source) => source.id === row.sourceId && Boolean(source.updatedAt),
            ),
          );
          result.coverage = [...result.coverage, ...validCoverage].filter(
            (row, index, rows) =>
              rows.findIndex((other) => JSON.stringify(row) === JSON.stringify(other)) === index,
          );
          validCoverage.forEach((row) => covered.add(row.question));
          result.inferences = [...new Set([...result.inferences, ...review.inferences])];
          result.conflicts = [...result.conflicts, ...review.conflicts].filter(
            (conflict, index, conflicts) =>
              conflicts.findIndex((other) => JSON.stringify(other) === JSON.stringify(conflict)) ===
              index,
          );
          const projection = recomputeResearchCoverage(result, planning.retainedEvidence);
          if (projection.evidence.length < result.evidence.length) {
            result.evidence = projection.evidence;
            result.coverage = projection.coverage;
            result.inferences = projection.inferences;
            result.conflicts = projection.conflicts;
            result.graph = projection.graph;
            covered.clear();
            result.coverage.forEach((row) => covered.add(row.question));
            pending = pending.filter(
              (query) =>
                !query.sourceId || result.evidence.some((source) => source.id === query.sourceId),
            );
            notes.add("dcs-evidence-not-retained");
            partial = true;
          }
          planningNotes = review.gaps;
          if (planning.actualTokens === null || planning.actualCostUsd === null) {
            notes.add("planning-usage-unknown");
            partial = true;
          }
          const unqueried = review.queries.filter((text) => !seenQueries.has(queryKey(text)));
          pending.unshift(
            ...unqueried.map(
              (text) =>
                pending.find((query) => queryKey(query.text) === queryKey(text)) ?? {
                  text,
                  depth: 0,
                },
            ),
          );
          if (
            covered.size === plan.questions.length &&
            !result.conflicts.length &&
            !review.gaps.length
          )
            stop = "covered";
          else if (!pending.length)
            stop = review.queries.length ? "repeated-query" : "queries-exhausted";
        } catch (error) {
          if (signal.aborted || (error as { code?: string })?.code === "RESEARCH_OWNER_CHANGED")
            throw error;
          notes.add("planning-unavailable");
          partial = true;
          result.usage.actualPlanningTokens = null;
          result.usage.actualCostUsd = null;
        }
      }
      refreshGaps();
      publish();
      if (!pending.length && !stop) stop = "queries-exhausted";
      if (seenQueries.size >= budget.maxQueries && !stop) stop = "query-budget";
    }
    await reverify();
    stop ??= "round-budget";
  } catch (error) {
    const ownerChanged =
      (error as { code?: string })?.code === "RESEARCH_OWNER_CHANGED" ||
      (options.signal?.reason as { code?: string })?.code === "RESEARCH_OWNER_CHANGED";
    stop = ownerChanged
      ? "scope-changed"
      : options.signal?.aborted
        ? "cancelled"
        : deadline.signal.aborted
          ? "deadline"
          : "unavailable";
    if (stop === "scope-changed") {
      result.evidence = [];
      result.steps = [];
      result.coverage = [];
      covered.clear();
      result.inferences = [];
      result.conflicts = [];
      result.graph = { nodes: [], edges: [], truncated: false };
      result.retainedEvidence = [];
    }
    notes.add(stop);
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (result.graph.truncated) {
    notes.add("graph-budget");
    partial = true;
  }
  refreshGaps();
  result.phase = "finished";
  result.stopReason = stop;
  result.status =
    stop === "cancelled"
      ? "cancelled"
      : !result.evidence.length
        ? "unavailable"
        : stop === "covered" && !partial && !result.gaps.length && !result.conflicts.length
          ? "complete"
          : "partial";
  publish();
  return result;
}
