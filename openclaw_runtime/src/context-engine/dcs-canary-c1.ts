/**
 * C1 canary (non-human live) A/B runner + graduation decision package.
 * Reads synthetic-agent corpus, evaluates evaluateAbGate, writes honest decision
 * via shared graduation hard-rules helper.
 * Never enables view tools default-on; never claims live.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { evaluateAbGate, type AbReport } from "./coding-ab-fixtures.js";
import {
  loadCorpus,
  validateCorpus,
  type DcsCorpusDocument,
} from "./dcs-corpus-schema.js";
import {
  corpusEntriesToAbResults,
  generateSyntheticAgentCorpus,
  DEFAULT_SYNTHETIC_CORPUS_SEED,
} from "./dcs-corpus-synthetic.js";
import {
  assertPackagingDefaultsUnchanged,
  assertProductApprovalHardRules,
  buildGraduationDecision,
  type GraduationDecision,
} from "./dcs-graduation-decision.js";

export type C1CanaryAbMetrics = {
  ok: true;
  kind: "synthetic-agent";
  live: false;
  seed: number | null;
  taskCount: number;
  entryCount: number;
  ab: AbReport;
  reductionDefinition: {
    formula: string;
    corpusId: string;
    corpus: string;
    fixtureCount: number;
    meanOffCalls: number;
    meanOnCalls: number;
    live: false;
    evidenceClass: "simulated-arm-synthetic";
    role: "reference-only";
    eligibleForGateAuthority: false;
    authoritativeDecision: string;
    reconciliation: string;
  };
  ts: string;
};

export type C1CanaryRunResult = {
  abMetrics: C1CanaryAbMetrics;
  decision: GraduationDecision & {
    ok: true;
    card: "C1-CANARY";
    wave: "C1";
    viewToolsDefaultUnchanged: true;
  };
};

export type RunC1CanaryOptions = {
  /** Load corpus from path; if omitted, generate deterministic synthetic corpus in-memory. */
  corpusPath?: string;
  /** In-memory corpus override (tests). */
  corpus?: DcsCorpusDocument;
  seed?: number;
  productApproved?: boolean;
  liveReady?: boolean;
  ts?: string;
};

export function resolveC1Corpus(options?: RunC1CanaryOptions): DcsCorpusDocument {
  if (options?.corpus) {
    return validateCorpus(options.corpus);
  }
  if (options?.corpusPath) {
    return loadCorpus(options.corpusPath);
  }
  return generateSyntheticAgentCorpus({
    seed: options?.seed ?? DEFAULT_SYNTHETIC_CORPUS_SEED,
  });
}

/**
 * Run C1 canary A/B evaluation + honest packaging decision.
 */
export function runC1Canary(options?: RunC1CanaryOptions): C1CanaryRunResult {
  const corpus = resolveC1Corpus(options);
  if (corpus.kind === "live") {
    throw new Error("C1 canary refuses kind=live corpus (use residual live path separately)");
  }
  // Honesty: never treat synthetic as live
  const liveReady = options?.liveReady === true && (corpus.kind as string) === "live" ? true : false;

  const abResults = corpusEntriesToAbResults(corpus);
  const ab = evaluateAbGate(abResults);
  const taskIds = new Set(abResults.map((r) => r.fixtureId));
  const ts = options?.ts ?? new Date().toISOString();

  const abMetrics: C1CanaryAbMetrics = {
    ok: true,
    kind: "synthetic-agent",
    live: false,
    seed: corpus.seed ?? null,
    taskCount: taskIds.size,
    entryCount: corpus.entries.length,
    ab: {
      ...ab,
      reductionFactor: Number(ab.reductionFactor.toFixed(4)),
      baselineAvgCalls: Number(ab.baselineAvgCalls.toFixed(4)),
      factstoreAvgCalls: Number(ab.factstoreAvgCalls.toFixed(4)),
      baselinePassRate: Number(ab.baselinePassRate.toFixed(4)),
      factstorePassRate: Number(ab.factstorePassRate.toFixed(4)),
      routingAccuracy: Number(ab.routingAccuracy.toFixed(4)),
    },
    reductionDefinition: {
      formula: "mean(offArm toolCalls) / mean(onArm toolCalls) (ratio of means)",
      corpusId: "dcs-canary-c1-synthetic-seed-" + (corpus.seed ?? "unknown"),
      corpus: "synthetic-agent generated corpus, seed " + (corpus.seed ?? "unknown"),
      fixtureCount: ab.fixtureCount,
      meanOffCalls: Number(ab.baselineAvgCalls.toFixed(4)),
      meanOnCalls: Number(ab.factstoreAvgCalls.toFixed(4)),
      live: false,
      evidenceClass: "simulated-arm-synthetic",
      role: "reference-only",
      eligibleForGateAuthority: false,
      authoritativeDecision: "artifacts/first-product-preview/FP-P4-05/decision.json",
      reconciliation:
        "artifacts/first-product-preview/FP-P0-05/reduction-factor-reconciliation.md",
    },
    ts,
  };

  const baseDecision = buildGraduationDecision({
    flagId: "runtime.coding.contextViewTools",
    metricsGate: ab.meetsGate,
    metrics: {
      fixtureCount: ab.fixtureCount,
      reductionFactor: abMetrics.ab.reductionFactor,
      baselineAvgCalls: abMetrics.ab.baselineAvgCalls,
      factstoreAvgCalls: abMetrics.ab.factstoreAvgCalls,
      baselinePassRate: abMetrics.ab.baselinePassRate,
      factstorePassRate: abMetrics.ab.factstorePassRate,
      routingAccuracy: abMetrics.ab.routingAccuracy,
      corpusKind: corpus.kind,
      live: false,
      reductionDefinition: abMetrics.reductionDefinition as unknown as string,
    },
    productApproved: options?.productApproved === true,
    liveReady,
    desiredRecommendation: ab.meetsGate ? "consider-default-on" : "keep-off",
    completionClass: ab.meetsGate
      ? "done (sim-canary+keep-off)"
      : "done (sim-canary-partial+keep-off)",
    residual: [
      "C1 canary uses synthetic-agent corpus only - not human live A/B",
      "View tools / DEFAULT_* remain unchanged by this pack",
    ],
    howToEnable:
      "Opt-in only: set OPENCLAW_DCS_CONTEXT_VIEW_TOOLS=1 (or OPENCLAW_DCS_CONTEXT_TOOLS=1) and restart gateway/runtime. Do not flip production defaults from this canary.",
    killSwitch:
      "Unset OPENCLAW_DCS_CONTEXT_VIEW_TOOLS / OPENCLAW_DCS_CONTEXT_TOOLS; leave runtime coding view-tools defaults false.",
    notes: [
      ab.reason,
      "recommendation must not be default-on without productApproved",
      "liveReady forced false for synthetic canary",
    ],
    packagingPath: true,
    ts,
  });

  assertProductApprovalHardRules(baseDecision);
  assertPackagingDefaultsUnchanged(baseDecision);

  if (baseDecision.recommendation === "default-on") {
    throw new Error("C1 canary hard rule: recommendation must not be default-on");
  }
  if (baseDecision.liveReady !== false) {
    throw new Error("C1 canary hard rule: liveReady must be false");
  }
  if (baseDecision.defaultsUnchanged !== true) {
    throw new Error("C1 canary hard rule: defaultsUnchanged must be true");
  }

  const decision: C1CanaryRunResult["decision"] = {
    ...baseDecision,
    ok: true,
    card: "C1-CANARY",
    wave: "C1",
    viewToolsDefaultUnchanged: true,
    liveReady: false,
    recommendation: baseDecision.recommendation,
    meetsGate: false, // packaging: never meetsGate for default-on auto path
  };

  return { abMetrics, decision };
}

export type WriteC1CanaryArtifactsOptions = RunC1CanaryOptions & {
  outDir: string;
};

/**
 * Run canary and write ab-metrics.json + decision.json under outDir.
 */
export function writeC1CanaryArtifacts(
  options: WriteC1CanaryArtifactsOptions,
): C1CanaryRunResult {
  const result = runC1Canary(options);
  mkdirSync(options.outDir, { recursive: true });
  writeFileSync(
    path.join(options.outDir, "ab-metrics.json"),
    JSON.stringify(result.abMetrics, null, 2) + "\n",
    "utf8",
  );
  writeFileSync(
    path.join(options.outDir, "decision.json"),
    JSON.stringify(result.decision, null, 2) + "\n",
    "utf8",
  );
  return result;
}
