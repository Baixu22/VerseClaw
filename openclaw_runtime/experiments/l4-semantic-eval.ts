/**
 * C6-5: L4 semantic embedding evaluation only.
 * Never flips hybrid-retriever L4 permanent defaults.
 */
export type L4Decision = "defer" | "candidate";

export type L4EvalReport = {
  decision: L4Decision;
  evaluatedAt: string;
  hybridRetrieverMode: "exact_keyword_fts_rrf_graph";
  semanticBranchPresent: boolean;
  embeddingDefaultOn: boolean;
  criteria: {
    recallLiftVsBaseline: number | null;
    latencyBudgetMs: number | null;
    costAcceptable: boolean | null;
    ablationComplete: boolean;
  };
  thresholds: {
    minRecallLift: number;
    maxLatencyMs: number;
  };
  evidence: string[];
  recommendation: string;
  notes: string[];
};

/**
 * Evaluate whether L4 embedding should be considered for a later product wave.
 * Current mainline hybrid-retriever is FTS/exact/RRF/graph only (semantic removed).
 */
export function evaluateL4SemanticReadiness(params?: {
  recallLiftVsBaseline?: number | null;
  latencyBudgetMs?: number | null;
  costAcceptable?: boolean | null;
  ablationComplete?: boolean;
  fixtureNotes?: string[];
}): L4EvalReport {
  const thresholds = { minRecallLift: 0.08, maxLatencyMs: 250 };
  const criteria = {
    recallLiftVsBaseline:
      typeof params?.recallLiftVsBaseline === "number" ? params.recallLiftVsBaseline : null,
    latencyBudgetMs: typeof params?.latencyBudgetMs === "number" ? params.latencyBudgetMs : null,
    costAcceptable:
      typeof params?.costAcceptable === "boolean" ? params.costAcceptable : null,
    ablationComplete: params?.ablationComplete === true,
  };

  const evidence = [
    "hybrid-retriever.ts documents semantic branch removed (FTS + exact + RRF + graph only)",
    "runtime-embedding-adapter remains available but not permanently defaulted for L4",
    ...(params?.fixtureNotes ?? []),
  ];

  const meetsLift =
    typeof criteria.recallLiftVsBaseline === "number" &&
    criteria.recallLiftVsBaseline >= thresholds.minRecallLift;
  const meetsLatency =
    typeof criteria.latencyBudgetMs === "number" &&
    criteria.latencyBudgetMs <= thresholds.maxLatencyMs;
  const meetsCost = criteria.costAcceptable === true;
  const meetsAblation = criteria.ablationComplete === true;

  const candidate = meetsLift && meetsLatency && meetsCost && meetsAblation;
  const decision: L4Decision = candidate ? "candidate" : "defer";
  const notes: string[] = [];
  if (!meetsLift) notes.push("recall lift missing or below floor");
  if (!meetsLatency) notes.push("latency budget missing or over max");
  if (!meetsCost) notes.push("cost acceptance not proven");
  if (!meetsAblation) notes.push("ablation incomplete");
  notes.push("C6-5 is evaluation-only; this wave must not permanently enable L4 embedding");

  return {
    decision,
    evaluatedAt: new Date().toISOString(),
    hybridRetrieverMode: "exact_keyword_fts_rrf_graph",
    semanticBranchPresent: false,
    embeddingDefaultOn: false,
    criteria,
    thresholds,
    evidence,
    recommendation:
      decision === "candidate"
        ? "Suggest follow-up product wave to reinsert L4 embedding behind explicit flag graduation"
        : "Defer L4 embedding reinsert; keep hybrid-retriever non-semantic defaults",
    notes,
  };
}
