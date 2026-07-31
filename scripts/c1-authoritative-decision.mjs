/**
 * Build the FP-P4-05 authoritative C1 gate decision from the two historical
 * source artifacts. Fails closed when their formula, corpus identity, or
 * safety markers drift.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FORMULA = "mean(offArm toolCalls) / mean(onArm toolCalls) (ratio of means)";
const METRIC_THRESHOLD = 5;

function parseArgs(argv) {
  const rootArg = argv.find((arg) => arg.startsWith("--root="));
  return {
    root: rootArg
      ? path.resolve(rootArg.slice("--root=".length))
      : path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
    check: argv.includes("--check"),
  };
}

function readJson(root, relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error("missing required C1 artifact: " + relativePath);
  }
  return JSON.parse(fs.readFileSync(absolutePath, "utf8"));
}

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function approximatelyEqual(left, right) {
  return Math.abs(left - right) < 0.000001;
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function buildC1AuthoritativeDecision(root) {
  const codingPath = "artifacts/coding-c1/ab-metrics.json";
  const syntheticMetricsPath = "artifacts/dcs-canary/c1/ab-metrics.json";
  const syntheticDecisionPath = "artifacts/dcs-canary/c1/decision.json";
  const coding = readJson(root, codingPath);
  const synthetic = readJson(root, syntheticMetricsPath);
  const syntheticDecision = readJson(root, syntheticDecisionPath);

  requireCondition(
    Array.isArray(coding.pairs) && coding.pairs.length === 4,
    "C1 authority requires exactly four hand-authored real-tool fixtures",
  );
  requireCondition(coding.reductionDefinition?.formula === FORMULA, "C1 authority formula drifted");
  requireCondition(
    coding.reductionDefinition?.corpusId === "coding-c1-hand-authored-real-tools",
    "C1 authority corpus identity drifted",
  );
  requireCondition(
    coding.reductionDefinition?.evidenceClass === "real-tool-execution-fixture",
    "C1 authority must execute real context tools",
  );
  requireCondition(
    coding.reductionDefinition?.role === "gate-authority",
    "C1 real-tool corpus must be the sole gate authority",
  );
  requireCondition(
    coding.reductionDefinition?.live === false,
    "C1 hand-authored fixtures must remain non-live evidence",
  );
  requireCondition(
    coding.results?.filter((item) => item.arm === "on").every((item) => item.pass === true),
    "C1 authority contains a failing on-arm fixture",
  );

  const meanOffCalls = mean(coding.pairs.map((pair) => pair.offCalls));
  const meanOnCalls = mean(coding.pairs.map((pair) => pair.onCalls));
  const authoritativeReduction = meanOffCalls / meanOnCalls;
  requireCondition(
    approximatelyEqual(coding.avgReduction, authoritativeReduction),
    "C1 authority reduction does not equal ratio of means",
  );
  requireCondition(
    approximatelyEqual(coding.reductionDefinition.meanOffCalls, meanOffCalls),
    "C1 authority meanOffCalls drifted",
  );
  requireCondition(
    approximatelyEqual(coding.reductionDefinition.meanOnCalls, meanOnCalls),
    "C1 authority meanOnCalls drifted",
  );
  requireCondition(
    approximatelyEqual(authoritativeReduction, 4.5),
    "historical real-tool reduction must remain 4.5x",
  );

  requireCondition(
    synthetic.live === false && synthetic.reductionDefinition?.live === false,
    "synthetic C1 corpus cannot be marked live",
  );
  requireCondition(synthetic.kind === "synthetic-agent", "C1 reference corpus must remain synthetic-agent");
  requireCondition(
    synthetic.reductionDefinition?.corpusId === "dcs-canary-c1-synthetic-seed-42",
    "C1 synthetic corpus identity drifted",
  );
  requireCondition(
    synthetic.taskCount === 32 && synthetic.ab?.fixtureCount === 32,
    "C1 synthetic scale reference must retain 32 tasks",
  );
  requireCondition(synthetic.reductionDefinition?.formula === FORMULA, "C1 synthetic formula drifted");
  requireCondition(
    synthetic.reductionDefinition?.role === "reference-only",
    "C1 synthetic corpus must remain reference-only",
  );
  requireCondition(
    synthetic.reductionDefinition?.eligibleForGateAuthority === false,
    "C1 synthetic corpus cannot become gate authority",
  );
  requireCondition(
    synthetic.reductionDefinition?.evidenceClass === "simulated-arm-synthetic",
    "C1 synthetic evidence class drifted",
  );
  requireCondition(
    approximatelyEqual(synthetic.ab.reductionFactor, 5.125),
    "historical synthetic reduction must remain 5.125x",
  );
  requireCondition(
    approximatelyEqual(syntheticDecision.metrics?.reductionFactor, synthetic.ab.reductionFactor),
    "C1 synthetic decision and metrics disagree",
  );
  requireCondition(
    syntheticDecision.recommendation === "keep-off",
    "C1 synthetic decision must remain keep-off",
  );
  requireCondition(
    syntheticDecision.meetsGate === false,
    "C1 synthetic packaging decision must remain meetsGate=false",
  );
  requireCondition(
    syntheticDecision.liveReady === false && syntheticDecision.productApproved === false,
    "C1 synthetic decision cannot claim live or product approval",
  );
  requireCondition(
    syntheticDecision.defaultsUnchanged === true,
    "C1 synthetic decision must preserve defaults",
  );

  const authorityMeetsMetricThreshold = authoritativeReduction >= METRIC_THRESHOLD;
  const generatedAt = [coding.generatedAt, synthetic.ts, syntheticDecision.ts]
    .filter(Boolean)
    .sort()
    .at(-1);

  return {
    schema: "first-product-preview/fp-p4-05-c1-authoritative-decision/v1",
    taskId: "FP-P4-05",
    generatedAt,
    flagId: "runtime.coding.contextViewTools",
    metric: {
      formula: FORMULA,
      threshold: METRIC_THRESHOLD,
      thresholdUnit: "x tool-call reduction",
    },
    authority: {
      source: codingPath,
      corpusId: coding.reductionDefinition.corpusId,
      corpus: coding.reductionDefinition.corpus,
      role: "gate-authority",
      selectionReason:
        "The on-arm executes real context view tools; execution fidelity outranks the larger simulated corpus.",
      rejectedAlternative:
        "The 32-task synthetic corpus improves scale coverage but its arms are simulated, so it is reference-only.",
      fixtureCount: coding.pairs.length,
      meanOffCalls,
      meanOnCalls,
      reductionFactor: authoritativeReduction,
      allOnArmPassed: true,
      live: false,
      meetsMetricThreshold: authorityMeetsMetricThreshold,
    },
    references: [
      {
        source: syntheticMetricsPath,
        decisionSource: syntheticDecisionPath,
        corpusId: synthetic.reductionDefinition.corpusId,
        role: "reference-only",
        evidenceClass: synthetic.reductionDefinition.evidenceClass,
        fixtureCount: synthetic.ab.fixtureCount,
        reductionFactor: synthetic.ab.reductionFactor,
        meetsSimulationThreshold: synthetic.ab.meetsGate,
        eligibleForGateAuthority: false,
        live: false,
      },
    ],
    decision: {
      meetsGate: authorityMeetsMetricThreshold,
      recommendation: "keep-off",
      defaultOn: false,
      defaultsUnchanged: true,
      liveReady: false,
      productApproved: false,
      reason: authorityMeetsMetricThreshold
        ? "Metric threshold alone cannot authorize default-on without live evidence and product approval."
        : "Authoritative reduction " + authoritativeReduction.toFixed(3) +
          "x is below the unchanged " + METRIC_THRESHOLD + "x threshold.",
    },
    historicalEvidence: {
      valuesPreserved: true,
      codingRealToolReduction: authoritativeReduction,
      syntheticScaleReduction: synthetic.ab.reductionFactor,
      reconciliation:
        "artifacts/first-product-preview/FP-P0-05/reduction-factor-reconciliation.md",
    },
    evidenceLimits: {
      humanRuns: 0,
      live: false,
      syntheticReferenceIsProductEvidence: false,
      unblocksTf0006: false,
      authorizesGa: false,
    },
  };
}

function renderMarkdown(decision) {
  return [
    "# FP-P4-05 C1 authoritative gate decision",
    "",
    "- Gate authority: `" + decision.authority.corpusId + "`",
    "- Authoritative reduction: **" + decision.authority.reductionFactor.toFixed(3) + "x**",
    "- Threshold: **" + decision.metric.threshold + "x**",
    "- Gate result: **" + (decision.decision.meetsGate ? "pass" : "fail") + "**",
    "- Recommendation: **" + decision.decision.recommendation + "**",
    "",
    "## Corpus decision",
    "",
    "The four hand-authored fixtures are authoritative because their on-arm executes",
    "the real context view tools. The 32-task deterministic synthetic corpus remains",
    "a scale and routing reference only; its **" + decision.references[0].reductionFactor.toFixed(3) + "x**",
    "result cannot supersede real-tool execution evidence.",
    "",
    "## Product boundary",
    "",
    "The authoritative result is below the unchanged 5x threshold. Context view",
    "tools remain default-off. `liveReady=false`, `productApproved=false`, and",
    "`defaultOn=false`. This decision does not unblock TF-0006 or authorize GA.",
    "",
  ].join("\n");
}

function writeOrCheck(root, decision, check) {
  const outDir = path.join(root, "artifacts/first-product-preview/FP-P4-05");
  const jsonPath = path.join(outDir, "decision.json");
  const markdownPath = path.join(outDir, "decision.md");
  const json = JSON.stringify(decision, null, 2) + "\n";
  const markdown = renderMarkdown(decision);

  if (check) {
    requireCondition(fs.existsSync(jsonPath), "missing FP-P4-05 decision.json");
    requireCondition(fs.existsSync(markdownPath), "missing FP-P4-05 decision.md");
    requireCondition(fs.readFileSync(jsonPath, "utf8") === json, "FP-P4-05 decision.json is stale");
    requireCondition(
      fs.readFileSync(markdownPath, "utf8") === markdown,
      "FP-P4-05 decision.md is stale",
    );
    return;
  }

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(jsonPath, json, "utf8");
  fs.writeFileSync(markdownPath, markdown, "utf8");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const decision = buildC1AuthoritativeDecision(args.root);
  writeOrCheck(args.root, decision, args.check);
  console.log(
    JSON.stringify(
      {
        ok: true,
        check: args.check,
        authority: decision.authority.corpusId,
        reductionFactor: decision.authority.reductionFactor,
        meetsGate: decision.decision.meetsGate,
        recommendation: decision.decision.recommendation,
      },
      null,
      2,
    ),
  );
}
