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
  input: investigationScript(),
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

function investigationScript() {
  return String.raw`
const helperModule = await import("./tests/unit/helpers/agent-map-investment-investigation.ts");
const helper = helperModule.default ?? helperModule;
const report = await helper.investigateAgentMapInvestment();
const summary = {
  node: process.version,
  platform: process.platform + "/" + process.arch,
  replayCorpus: report.replayCorpus,
  lowPollutionGate: report.lowPollutionGate,
  explicitPilotQuality: report.explicitPilotQuality,
  recommendation: report.recommendation,
  recommendationReasons: report.recommendationReasons,
  observations: report.observations,
  constraints: {
    deterministicReplayInputs: report.deterministicReplayInputs,
    noRuntimeAuthorityChange: report.noRuntimeAuthorityChange,
    noDefaultOnRecommendation: report.noDefaultOnRecommendation,
    allowedConsumer: report.allowedConsumer,
  },
};

console.log("[agent-map-investigation] node=" + summary.node);
console.log("[agent-map-investigation] platform=" + summary.platform);
console.log("[agent-map-investigation] replayCorpusStatus=" + summary.replayCorpus.status +
  " cases=" + summary.replayCorpus.caseCount +
  " expectedSymbolRecall=" + summary.replayCorpus.expectedSymbolRecall.toFixed(3));
console.log("[agent-map-investigation] explicitPilotQuality=" +
  summary.explicitPilotQuality.status +
  " score=" + summary.explicitPilotQuality.qualityScore);
console.log("[agent-map-investigation] lowPollutionGate=" +
  summary.lowPollutionGate.status +
  " processPollutionCount=" + summary.lowPollutionGate.processPollutionCount +
  " reliability=" + summary.lowPollutionGate.reliability);
console.log("[agent-map-investigation] recommendation=" + summary.recommendation);
for (const reason of summary.recommendationReasons) {
  console.log("[agent-map-investigation] " + reason);
}
console.log("AGENT_MAP_INVESTMENT_INVESTIGATION_SUMMARY " + JSON.stringify(summary));
`;
}
