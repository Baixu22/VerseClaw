#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const PNPM = "pnpm";
const VERIFY_DEPS_FLAG = "--config.verify-deps-before-run=false";

const result = spawnPnpm([
  VERIFY_DEPS_FLAG,
  "exec",
  "tsx",
  "-",
], {
  cwd: process.cwd(),
  env: process.env,
  input: evalScript(),
  encoding: "utf8",
  maxBuffer: 32 * 1024 * 1024,
});

if (result.stdout) {
  process.stdout.write(result.stdout);
}
if (result.stderr) {
  process.stderr.write(result.stderr);
}
if (result.error) {
  throw result.error;
}
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

function spawnPnpm(args, options) {
  if (process.platform !== "win32") {
    return spawnSync(PNPM, args, options);
  }
  return spawnSync(process.env.ComSpec ?? "cmd.exe", [
    "/d",
    "/s",
    "/c",
    [PNPM, ...args].map(quoteWindowsCommandArg).join(" "),
  ], options);
}

function quoteWindowsCommandArg(value) {
  if (/^[A-Za-z0-9_./:=@-]+$/u.test(value)) {
    return value;
  }
  return '"' + value.replace(/(["^&|<>])/gu, "^$1") + '"';
}

function evalScript() {
  return String.raw`
const helperModule = await import("./tests/unit/helpers/agent-map-benefit-eval.ts");
const helper = helperModule.default ?? helperModule;
const report = await helper.evaluateAgentMapBenefit();
const summary = {
  node: process.version,
  platform: process.platform + "/" + process.arch,
  corpusShape: {
    scenarios: report.metrics.corpusSize,
    scenarioIds: report.metrics.scenarioIds,
    budgets: report.metrics.budgetProfiles,
    decisionBudget: report.metrics.decisionBudget,
    provenance: report.provenance,
    deterministic: report.deterministic,
    noUserRealData: report.noUserRealData,
  },
  metrics: report.metrics,
  perScenarioDeltas: report.scenarios.map((scenario) => {
    const baseline = scenario.observations.find((entry) =>
      entry.arm === "baseline" &&
      entry.budget === report.metrics.decisionBudget
    );
    const naive = scenario.observations.find((entry) =>
      entry.arm === "naiveContext" &&
      entry.budget === report.metrics.decisionBudget
    );
    const agentMap = scenario.observations.find((entry) =>
      entry.arm === "agentMapExplicit" &&
      entry.budget === report.metrics.decisionBudget
    );
    return {
      id: scenario.id,
      expectedNoOp: scenario.expectedNoOp,
      positiveBenefit: scenario.positiveBenefit,
      agentMapStatus: agentMap?.status,
      recallLiftVsBaseline:
        (agentMap?.relevantSymbolRecall ?? 0) -
        (baseline?.relevantSymbolRecall ?? 0),
      precisionLiftVsNaive:
        (agentMap?.precision ?? 0) -
        (naive?.precision ?? 0),
      generatedLeaks: agentMap?.generatedLeaks.length ?? 0,
      promptPresentLeaks: agentMap?.promptPresentLeaks.length ?? 0,
      mustRejectLeaks: agentMap?.mustRejectLeaks.length ?? 0,
    };
  }),
  recommendation: report.metrics.investmentRecommendation,
  recommendationReasons: report.recommendationReasons,
};

console.log("[agent-map-benefit-eval] node=" + summary.node);
console.log("[agent-map-benefit-eval] platform=" + summary.platform);
console.log("[agent-map-benefit-eval] scenarios=" + summary.corpusShape.scenarios +
  " budgets=" + summary.corpusShape.budgets.join(","));
console.log("[agent-map-benefit-eval] recommendation=" + summary.recommendation +
  " benefitScore=" + summary.metrics.benefitScore);
for (const reason of summary.recommendationReasons) {
  console.log("[agent-map-benefit-eval] " + reason);
}
console.log("AGENT_MAP_BENEFIT_EVAL_SUMMARY " + JSON.stringify(summary));
`;
}
