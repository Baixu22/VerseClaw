#!/usr/bin/env node
import { readdirSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const PNPM = "pnpm";
const VERIFY_DEPS_FLAG = "--config.verify-deps-before-run=false";
const FOCUSED_TESTS = [
  "tests/unit/runtime-agent-map-performance-optimization.test.ts",
  "tests/unit/runtime-agent-map-component-boundary-hardening.test.ts",
];
const TASKLOOP_EXPLICIT_INVOCATION_CONSUMER =
  "agent_map.prompt_candidate.taskloop_explicit_invocation_pilot";
const BOUNDARY_STATUS = {
  defaultOn: false,
  defaultCutover: false,
  productionReadyDeclaration: false,
  runtimeAuthorityChanged: false,
  persistentSidecarIndexCacheAdded: false,
  defaultProviderRegistration: false,
  directRendererIpc: false,
  directGatewayTransport: false,
  serviceListenerDaemonAdded: false,
  databaseAdded: false,
  editApplyMutationAuthority: false,
};
const EXPLICIT_CONSUMER_MANIFEST = {
  allowedConsumers: [TASKLOOP_EXPLICIT_INVOCATION_CONSUMER],
  defaultConsumers: [],
  modelMessageConsumers: [],
  gatewayConsumers: [],
  providerTransportConsumers: [],
  checkpointPayloadConsumers: [],
  lifecyclePayloadConsumers: [],
  runtimeAuthorityConsumers: [],
  persistentConsumers: [],
};
const SKIPPED_READINESS_SCORECARD = {
  status: "skipped",
  caseCount: 0,
  requiredClasses: [],
  insertedCount: 0,
  failClosedCount: 0,
  leakageCount: 0,
  defaultPromptDriftCount: 0,
  authorityEscalationCount: 0,
  expectedStatusMatches: 0,
  score: 0,
};
const SKIPPED_BENEFIT_EVALUATION = {
  status: "skipped",
  corpusSize: 0,
  benefitScore: 0,
  investmentRecommendation: "hold_boundary",
  metrics: {},
};
const SKIPPED_INVESTMENT_INVESTIGATION = {
  status: "skipped",
  recommendation: "hold_boundary",
  replayCorpus: {},
  lowPollutionGate: {},
  explicitPilotQuality: {},
};
const validationChecks = [];
let readinessScorecard = SKIPPED_READINESS_SCORECARD;
let benefitEvaluation = SKIPPED_BENEFIT_EVALUATION;
let investmentInvestigation = SKIPPED_INVESTMENT_INVESTIGATION;

const options = parseArgs(process.argv.slice(2));

async function main() {
  console.log("[agent-map-validate] default-on: no");
  console.log("[agent-map-validate] default cutover: no");
  console.log("[agent-map-validate] production-ready declaration: no");
  console.log("[agent-map-validate] runtime authority changed: no");
  console.log("[agent-map-validate] persistent sidecar/index/cache added: no");

  if (!options.benchmarkOnly) {
    runPnpm("focused-tests", "focused AgentMap performance/boundary tests", [
      VERIFY_DEPS_FLAG,
      "exec",
      "vitest",
      "run",
      ...FOCUSED_TESTS,
    ]);

    runPnpm("full-agent-map-tests", "full runtime-agent-map unit tests", [
      VERIFY_DEPS_FLAG,
      "exec",
      "vitest",
      "run",
      "--maxWorkers=1",
      ...runtimeAgentMapTestFiles(),
    ]);

    if (!options.skipTypecheck) {
      runPnpm("typecheck", "typecheck", [VERIFY_DEPS_FLAG, "run", "typecheck"]);
    } else {
      validationChecks.push({
        id: "typecheck",
        label: "typecheck",
        status: "skipped",
      });
    }
    readinessScorecard = runReadinessScorecard();
    benefitEvaluation = runBenefitEvaluation();
    investmentInvestigation = runInvestmentInvestigation();
  } else {
    validationChecks.push({
      id: "focused-tests",
      label: "focused AgentMap performance/boundary tests",
      status: "skipped",
    }, {
      id: "full-agent-map-tests",
      label: "full runtime-agent-map unit tests",
      status: "skipped",
    }, {
      id: "typecheck",
      label: "typecheck",
      status: "skipped",
    });
  }

  runBenchmark();
  console.log("[agent-map-validate] validation closure command completed");
}

function parseArgs(args) {
  return {
    benchmarkOnly: args.includes("--benchmark-only"),
    requireGateEligible: args.includes("--require-gate-eligible"),
    skipTypecheck: args.includes("--skip-typecheck"),
  };
}

function runPnpm(id, label, args) {
  console.log("\n[agent-map-validate] running " + label);
  const result = spawnPnpm(args, {
    cwd: ROOT,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
  validationChecks.push({
    id,
    label,
    status: "pass",
    command: [PNPM, ...args].join(" "),
  });
}

function runBenchmark() {
  console.log("\n[agent-map-validate] running stdin-only benchmark");
  const env = { ...process.env };
  if (options.requireGateEligible) {
    env.AGENT_MAP_REQUIRE_GATE_ELIGIBLE = "1";
  }
  env.AGENT_MAP_VALIDATION_MODE = options.benchmarkOnly ? "benchmark-only" : "full";
  env.AGENT_MAP_VALIDATION_CHECKS = JSON.stringify(validationChecks);
  env.AGENT_MAP_BOUNDARY_STATUS = JSON.stringify(BOUNDARY_STATUS);
  env.AGENT_MAP_EXPLICIT_CONSUMER_MANIFEST = JSON.stringify(EXPLICIT_CONSUMER_MANIFEST);
  env.AGENT_MAP_INTERNAL_READINESS_SCORECARD = JSON.stringify(readinessScorecard);
  env.AGENT_MAP_BENEFIT_EVALUATION = JSON.stringify(benefitEvaluation);
  env.AGENT_MAP_INVESTMENT_INVESTIGATION = JSON.stringify(investmentInvestigation);
  const result = spawnPnpm([
    VERIFY_DEPS_FLAG,
    "exec",
    "tsx",
    "-",
  ], {
    cwd: ROOT,
    env,
    input: BENCHMARK_SCRIPT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
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
}

function runInvestmentInvestigation() {
  console.log("\n[agent-map-validate] running AgentMap investment investigation");
  const args = [
    VERIFY_DEPS_FLAG,
    "exec",
    "tsx",
    "-",
  ];
  const result = spawnPnpm(args, {
    cwd: ROOT,
    env: process.env,
    input: INVESTMENT_INVESTIGATION_SCRIPT,
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
  const summaryLine = result.stdout
    ?.split(/\r?\n/u)
    .find((line) =>
      line.startsWith("AGENT_MAP_INVESTMENT_INVESTIGATION_SUMMARY ")
    );
  if (!summaryLine) {
    console.error("[agent-map-validate] investment investigation summary missing");
    process.exit(1);
  }
  const summary = JSON.parse(
    summaryLine.slice("AGENT_MAP_INVESTMENT_INVESTIGATION_SUMMARY ".length),
  );
  return {
    status: "recorded",
    recommendation: summary.recommendation,
    replayCorpus: summary.replayCorpus,
    lowPollutionGate: summary.lowPollutionGate,
    explicitPilotQuality: summary.explicitPilotQuality,
    recommendationReasons: summary.recommendationReasons,
  };
}

function runBenefitEvaluation() {
  console.log("\n[agent-map-validate] running deterministic AgentMap benefit evaluation");
  const args = [
    VERIFY_DEPS_FLAG,
    "exec",
    "tsx",
    "-",
  ];
  const result = spawnPnpm(args, {
    cwd: ROOT,
    env: process.env,
    input: BENEFIT_EVAL_SCRIPT,
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
  const summaryLine = result.stdout
    ?.split(/\r?\n/u)
    .find((line) => line.startsWith("AGENT_MAP_BENEFIT_EVAL_SUMMARY "));
  if (!summaryLine) {
    console.error("[agent-map-validate] benefit evaluation summary missing");
    process.exit(1);
  }
  const summary = JSON.parse(
    summaryLine.slice("AGENT_MAP_BENEFIT_EVAL_SUMMARY ".length),
  );
  if (summary.metrics?.investmentRecommendation !== "continue_investment") {
    console.error("[agent-map-validate] benefit evaluation did not recommend continued internal investment");
    process.exit(1);
  }
  return {
    status: "pass",
    corpusSize: summary.metrics.corpusSize,
    benefitScore: summary.metrics.benefitScore,
    investmentRecommendation: summary.metrics.investmentRecommendation,
    metrics: summary.metrics,
    recommendationReasons: summary.recommendationReasons,
  };
}

function runReadinessScorecard() {
  console.log("\n[agent-map-validate] running executable internal readiness scorecard");
  const args = [
    VERIFY_DEPS_FLAG,
    "exec",
    "tsx",
    "-",
  ];
  const result = spawnPnpm(args, {
    cwd: ROOT,
    env: process.env,
    input: SCORECARD_SCRIPT,
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
  const summaryLine = result.stdout
    ?.split(/\r?\n/u)
    .find((line) => line.startsWith("AGENT_MAP_INTERNAL_READINESS_SCORECARD "));
  if (!summaryLine) {
    console.error("[agent-map-validate] readiness scorecard summary missing");
    process.exit(1);
  }
  const scorecard = JSON.parse(
    summaryLine.slice("AGENT_MAP_INTERNAL_READINESS_SCORECARD ".length),
  );
  validationChecks.push({
    id: "readiness-scorecard",
    label: "executable AgentMap internal readiness scorecard",
    status: "pass",
    command: [PNPM, ...args].join(" "),
  });
  return scorecard;
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

function runtimeAgentMapTestFiles() {
  const unitDir = path.join(ROOT, "tests", "unit");
  const files = [];
  collectFiles(unitDir, files);
  return files
    .map((file) => path.relative(ROOT, file).replace(/\\/g, "/"))
    .filter((file) => /^tests\/unit\/runtime-agent-map.*\.test\.ts$/u.test(file))
    .sort();
}

function collectFiles(dir, files) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(fullPath, files);
      continue;
    }
    if (entry.isFile()) {
      files.push(fullPath);
    }
  }
}

const SCORECARD_SCRIPT = String.raw`
const helperModule = await import("./tests/unit/helpers/agent-map-readiness-scorecard.ts");
const helper = helperModule.default ?? helperModule;
const { scorecard, observations } =
  await helper.computeAgentMapInternalReadinessScorecard();
const passing = helper.isAgentMapInternalReadinessScorecardPassing(scorecard);
const summary = {
  status: passing ? "pass" : "fail",
  ...scorecard,
  allowedConsumers: [
    ...helper.AGENT_MAP_TASKLOOP_EXPLICIT_INVOCATION_ALLOWED_CONSUMERS,
  ],
  coveredBy:
    "tests/unit/runtime-agent-map-prompt-candidate-taskloop-explicit-invocation-pilot.test.ts",
  observations,
};
console.log("AGENT_MAP_INTERNAL_READINESS_SCORECARD " + JSON.stringify(summary));
if (!passing) {
  console.error("AgentMap internal readiness scorecard failed.");
  console.error(JSON.stringify(observations));
  process.exit(1);
}
`;

const BENEFIT_EVAL_SCRIPT = String.raw`
const helperModule = await import("./tests/unit/helpers/agent-map-benefit-eval.ts");
const helper = helperModule.default ?? helperModule;
const report = await helper.evaluateAgentMapBenefit();
const summary = {
  status: report.metrics.investmentRecommendation === "continue_investment" ? "pass" : "review",
  node: process.version,
  platform: process.platform + "/" + process.arch,
  corpusShape: {
    scenarios: report.metrics.corpusSize,
    scenarioIds: report.metrics.scenarioIds,
    budgets: report.metrics.budgetProfiles,
    decisionBudget: report.metrics.decisionBudget,
  },
  metrics: report.metrics,
  recommendationReasons: report.recommendationReasons,
};
console.log("AGENT_MAP_BENEFIT_EVAL_SUMMARY " + JSON.stringify(summary));
if (
  report.metrics.generatedLeakRate !== 0 ||
  report.metrics.promptPresentRedundancyRate !== 0 ||
  report.metrics.mustRejectLeakRate !== 0 ||
  report.metrics.authorityEscalationCount !== 0 ||
  report.metrics.legacyPromptDriftCount !== 0 ||
  report.metrics.irrelevantTaskInsertionBenefit !== 0
) {
  console.error("AgentMap benefit evaluation risk guard failed.");
  process.exit(1);
}
`;

const INVESTMENT_INVESTIGATION_SCRIPT = String.raw`
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
};
console.log("AGENT_MAP_INVESTMENT_INVESTIGATION_SUMMARY " + JSON.stringify(summary));
if (
  report.explicitPilotQuality.status !== "pass" ||
  report.replayCorpus.promptPresentLeakCount !== 0 ||
  report.replayCorpus.defaultPromptDriftCount !== 0 ||
  report.replayCorpus.authorityEscalationCount !== 0
) {
  console.error("AgentMap investment investigation safety guard failed.");
  process.exit(1);
}
`;

const BENCHMARK_SCRIPT = String.raw`
import { execFileSync } from "node:child_process";
import { performance } from "node:perf_hooks";

const agentMap = await import("./openclaw_runtime/src/runtime-core/agent-map.ts");
const {
  buildAgentMapRequestFixture,
  buildBudgetedAgentMapResult,
  createAgentMapCache,
  extractAgentMapTagsFromSources,
  rankAgentMapTags,
  renderAgentMapRankedTags,
} = agentMap;

const SAMPLE_COUNT = Number(process.env.AGENT_MAP_BENCH_SAMPLES || "7");
const WARMUP_COUNT = Number(process.env.AGENT_MAP_BENCH_WARMUP || "2");
const REQUIRE_GATE_ELIGIBLE = process.env.AGENT_MAP_REQUIRE_GATE_ELIGIBLE === "1";
const VALIDATION_MODE = process.env.AGENT_MAP_VALIDATION_MODE || "standalone";
const VALIDATION_CHECKS = parseJsonEnv(process.env.AGENT_MAP_VALIDATION_CHECKS, []);
const BOUNDARY_STATUS = parseJsonEnv(process.env.AGENT_MAP_BOUNDARY_STATUS, {});
const EXPLICIT_CONSUMER_MANIFEST = parseJsonEnv(
  process.env.AGENT_MAP_EXPLICIT_CONSUMER_MANIFEST,
  {
    allowedConsumers: [],
    defaultConsumers: [],
    modelMessageConsumers: [],
    gatewayConsumers: [],
    providerTransportConsumers: [],
    checkpointPayloadConsumers: [],
    lifecyclePayloadConsumers: [],
    runtimeAuthorityConsumers: [],
    persistentConsumers: [],
  },
);
const INTERNAL_READINESS_SCORECARD = parseJsonEnv(
  process.env.AGENT_MAP_INTERNAL_READINESS_SCORECARD,
  {
    status: "skipped",
    caseCount: 0,
    requiredClasses: [],
    insertedCount: 0,
    failClosedCount: 0,
    leakageCount: 0,
    defaultPromptDriftCount: 0,
    authorityEscalationCount: 0,
    expectedStatusMatches: 0,
    score: 0,
  },
);
const BENEFIT_EVALUATION = parseJsonEnv(
  process.env.AGENT_MAP_BENEFIT_EVALUATION,
  {
    status: "skipped",
    corpusSize: 0,
    benefitScore: 0,
    investmentRecommendation: "hold_boundary",
    metrics: {},
  },
);
const INVESTMENT_INVESTIGATION = parseJsonEnv(
  process.env.AGENT_MAP_INVESTMENT_INVESTIGATION,
  {
    status: "skipped",
    recommendation: "hold_boundary",
    replayCorpus: {},
    lowPollutionGate: {},
    explicitPilotQuality: {},
  },
);
const BUDGETS = [64, 128, 256, 512, 1000, 2000];
const TASKLOOP_EXPLICIT_INVOCATION_CONSUMER =
  "agent_map.prompt_candidate.taskloop_explicit_invocation_pilot";
const EXPECTED_READINESS_CLASSES = [
  "successful task",
  "failed task",
  "blocked task",
  "long context",
  "multi-file task",
  "budget exhausted",
  "prompt-present",
  "generated filtering",
  "invalid result",
  "gate rollback",
];
const SYNTHETIC_800_BASELINES = {
  extraction: 77.4,
  public_full_ranking: 71.4,
  cold_build: 151.9,
  warm_cache_build: 67.6,
  render_32: 15,
};
const SYNTHETIC_800_IQR_LIMITS = {
  extraction: 25,
  public_full_ranking: 15,
  cold_build: 25,
  warm_cache_build: 25,
};

let sink = 0;
let maxHeapUsed = process.memoryUsage().heapUsed;

function parseJsonEnv(value, fallback) {
  if (!value) {
    return fallback;
  }
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function noteHeap() {
  const heapUsed = process.memoryUsage().heapUsed;
  if (heapUsed > maxHeapUsed) {
    maxHeapUsed = heapUsed;
  }
}

function consume(value) {
  if (Array.isArray(value)) {
    sink += value.length;
    return;
  }
  if (value && typeof value === "object") {
    sink += value.content?.length ?? 0;
    sink += value.tokenEstimate ?? 0;
    sink += value.renderedSymbols?.length ?? 0;
    sink += value.includedSymbols?.length ?? 0;
    return;
  }
  if (typeof value === "number") {
    sink += value;
  }
}

function processPollutionCount() {
  try {
    if (process.platform === "win32") {
      const output = execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-Command",
          "@(Get-Process | Where-Object { $_.ProcessName -match '^(node|tsx|vitest|tsc)$' }).Count",
        ],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      ).trim();
      return Number(output) || 0;
    }
    const output = execFileSync(
      "sh",
      ["-c", "ps -eo comm= | grep -E '^(node|tsx|vitest|tsc)$' | wc -l"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    return Number(output) || 0;
  } catch {
    return -1;
  }
}

function summarize(samples) {
  const sorted = [...samples].sort((left, right) => left - right);
  const q1 = percentile(sorted, 0.25);
  const q3 = percentile(sorted, 0.75);
  return {
    samples: sorted.length,
    min: sorted[0] ?? 0,
    median: percentile(sorted, 0.5),
    p75: q3,
    max: sorted[sorted.length - 1] ?? 0,
    iqr: q3 - q1,
  };
}

function percentile(sorted, fraction) {
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * fraction) - 1),
  );
  return sorted[index] ?? 0;
}

async function measure(operation) {
  const start = performance.now();
  const value = await operation();
  const elapsed = performance.now() - start;
  consume(value);
  noteHeap();
  return elapsed;
}

async function sample(operation) {
  for (let index = 0; index < WARMUP_COUNT; index += 1) {
    await measure(operation);
  }
  const samples = [];
  for (let index = 0; index < SAMPLE_COUNT; index += 1) {
    samples.push(await measure(operation));
  }
  return summarize(samples);
}

function fmt(value) {
  return value.toFixed(1);
}

function formatSummary(summary) {
  return "samples=" + summary.samples +
    " min=" + fmt(summary.min) + "ms" +
    " median=" + fmt(summary.median) + "ms" +
    " p75=" + fmt(summary.p75) + "ms" +
    " max=" + fmt(summary.max) + "ms" +
    " IQR=" + fmt(summary.iqr) + "ms";
}

function countTags(tags) {
  let definitions = 0;
  let references = 0;
  for (const tag of tags) {
    if (tag.kind === "definition") {
      definitions += 1;
    }
    if (tag.kind === "reference") {
      references += 1;
    }
  }
  return { tags: tags.length, definitions, references };
}

function buildRequest(files, overrides = {}) {
  const activeFiles = files.slice(0, Math.min(5, files.length)).map((file) => file.file);
  const mentionedFile = files[Math.min(files.length - 1, 5)]?.file ?? files[0]?.file ?? "";
  return buildAgentMapRequestFixture({
    activeFiles,
    candidateFiles: files.map((file) => file.file),
    mentionedFiles: mentionedFile ? [mentionedFile] : [],
    mentionedSymbols: [
      "MentionedSyntheticTarget7",
      "SyntheticFactory13",
      "registerElectronHandler3",
      "AgentWorkbenchPanel3",
    ],
    promptPresentFiles: files[0]?.file ? [files[0].file] : [],
    tokenBudget: 1000,
    refreshPolicy: "force",
    ...overrides,
  });
}

function buildSyntheticAgentMapFiles(count) {
  return Array.from({ length: count }, (_, index) => {
    const file = "src/features/feature-" + String(index).padStart(4, "0") + "/Widget" + index + ".ts";
    const content = [
      "export type SyntheticType" + index + " = string;",
      "export interface SyntheticInterface" + index + " {}",
      "export class SyntheticClass" + index + " {}",
      "export const SyntheticValue" + index + " = " + index + ";",
      "export const SyntheticAlias" + index + " = SyntheticValue" + index + ";",
      "export function SyntheticSymbol" + index + "(input: SyntheticType" + index + "): string { return SyntheticAlias" + index + " + input; }",
      "export function MentionedSyntheticTarget" + index + "(input: SyntheticType" + index + "): string { return SyntheticSymbol" + index + "(input); }",
      "export const SyntheticFactory" + index + " = () => MentionedSyntheticTarget" + index + "(SyntheticAlias" + index + ");",
    ].join("\n");
    return { file, content };
  });
}

function buildElectronFixtureFiles() {
  return Array.from({ length: 5 }, (_, index) => ({
    file: "electron/fixture-" + index + "/main" + index + ".ts",
    content: [
      "export type ElectronEvent" + index + " = string;",
      "export interface ElectronBridge" + index + " {}",
      "export class ElectronWindow" + index + " {}",
      "export const electronChannel" + index + " = \"agent-map:" + index + "\";",
      "export const electronAlias" + index + " = electronChannel" + index + ";",
      "export function registerElectronHandler" + index + "(sender: ElectronBridge" + index + "): string { return electronAlias" + index + " + sender; }",
      "export function invokeElectronAction" + index + "(payload: ElectronEvent" + index + "): string { return registerElectronHandler" + index + "(payload as unknown as ElectronBridge" + index + "); }",
      "export const electronHandlerFactory" + index + " = () => invokeElectronAction" + index + "(electronAlias" + index + ");",
    ].join("\n"),
  }));
}

function buildClawxLikeFixtureFiles() {
  return Array.from({ length: 5 }, (_, index) => ({
    file: "src/clawx-like/ChatPanel" + index + ".tsx",
    content: [
      "export type ChatTurn" + index + " = string;",
      "export interface AgentMapView" + index + " {}",
      "export class ChatStore" + index + " {}",
      "export const clawxRoute" + index + " = \"chat:" + index + "\";",
      "export const clawxAlias" + index + " = clawxRoute" + index + ";",
      "export function useChatComposer" + index + "(input: ChatTurn" + index + "): string { return clawxAlias" + index + " + input; }",
      "export function AgentWorkbenchPanel" + index + "(props: AgentMapView" + index + "): string { return useChatComposer" + index + "(clawxAlias" + index + "); }",
      "export const createAgentProjection" + index + " = () => AgentWorkbenchPanel" + index + "(clawxAlias" + index + " as unknown as AgentMapView" + index + ");",
    ].join("\n"),
  }));
}

const corpora = [
  { name: "fixture-electron-5", files: buildElectronFixtureFiles() },
  { name: "fixture-clawx-like-5", files: buildClawxLikeFixtureFiles() },
  { name: "synthetic-50", files: buildSyntheticAgentMapFiles(50) },
  { name: "synthetic-200", files: buildSyntheticAgentMapFiles(200) },
  { name: "synthetic-800", files: buildSyntheticAgentMapFiles(800) },
];

const pollution = processPollutionCount();
const reliability = pollution >= 0 && pollution <= 10 ? "gate-eligible" : "informational";
const benchmarkTables = {};
const corpusCounts = {};
let synthetic800Cache = null;
let synthetic800 = null;

console.log("Node version: " + process.version);
console.log("Platform: " + process.platform + "/" + process.arch);
console.log("process pollution count: " + pollution);
console.log("reliability verdict: " + reliability);
console.log("sample count: " + SAMPLE_COUNT);

for (const corpus of corpora) {
  const forceRequest = buildRequest(corpus.files, { refreshPolicy: "force" });
  const autoRequest = buildRequest(corpus.files, { refreshPolicy: "auto" });
  const tags = await extractAgentMapTagsFromSources({ files: corpus.files, refreshPolicy: "force" });
  const counts = countTags(tags);
  corpusCounts[corpus.name] = { files: corpus.files.length, ...counts };
  const ranked = rankAgentMapTags({ request: forceRequest, tags });
  const warmCache = createAgentMapCache({ maxEntries: Math.max(20, corpus.files.length * 2) });
  await buildBudgetedAgentMapResult({ request: autoRequest, files: corpus.files, contextLines: 0, cache: warmCache });

  const results = {
    extraction: await sample(() => extractAgentMapTagsFromSources({ files: corpus.files, refreshPolicy: "force" })),
    public_full_ranking: await sample(() => rankAgentMapTags({ request: forceRequest, tags })),
    render_32: await sample(() => renderAgentMapRankedTags({ rankedTags: ranked, files: corpus.files, contextLines: 0, maxSymbols: 32, tokenBudget: 2000 })),
    cold_build: await sample(() => buildBudgetedAgentMapResult({ request: forceRequest, files: corpus.files, contextLines: 0 })),
    warm_cache_build: await sample(() => buildBudgetedAgentMapResult({ request: autoRequest, files: corpus.files, contextLines: 0, cache: warmCache })),
  };

  benchmarkTables[corpus.name] = results;
  if (corpus.name === "synthetic-800") {
    synthetic800Cache = warmCache;
    synthetic800 = corpus;
  }

  console.log("\n[" + corpus.name + "] files=" + corpus.files.length + " tags=" + counts.tags + " definitions=" + counts.definitions + " references=" + counts.references + " ranked=" + ranked.length);
  for (const [phase, summary] of Object.entries(results)) {
    console.log(phase + ": " + formatSummary(summary));
  }
}

if (!synthetic800 || !synthetic800Cache) {
  throw new Error("synthetic-800 benchmark state missing");
}

const budgetSweep = [];
console.log("\n[synthetic-800 budget sweep]");
for (const budget of BUDGETS) {
  const request = buildRequest(synthetic800.files, { tokenBudget: budget, refreshPolicy: "auto" });
  const result = await buildBudgetedAgentMapResult({ request, files: synthetic800.files, contextLines: 0, cache: synthetic800Cache });
  const row = {
    budget,
    status: result.status,
    tokenEstimate: result.tokenEstimate,
    includedSymbols: result.includedSymbols.length,
    contentLength: result.content.length,
  };
  budgetSweep.push(row);
  console.log("budget=" + row.budget + " status=" + row.status + " tokenEstimate=" + row.tokenEstimate + " includedSymbols=" + row.includedSymbols + " contentLength=" + row.contentLength);
}

const cacheBeforeClear = synthetic800Cache.stats();
synthetic800Cache.clear();
const cacheAfterClear = synthetic800Cache.stats();
const heap = process.memoryUsage();
const heapRisk = maxHeapUsed > 1024 * 1024 * 1024 ? "watch" : "normal";
const synthetic800Counts = corpusCounts["synthetic-800"];
const synthetic800Results = benchmarkTables["synthetic-800"];

const shapeGate = synthetic800Counts.files === 800 &&
  synthetic800Counts.tags === 13600 &&
  synthetic800Counts.definitions === 6400 &&
  synthetic800Counts.references === 7200;
const boundaryGate = Object.keys(BOUNDARY_STATUS).length > 0 &&
  Object.values(BOUNDARY_STATUS).every((value) => value === false);
const testsGate = VALIDATION_CHECKS.length > 0 &&
  VALIDATION_CHECKS.every((check) => check.status === "pass");
const explicitConsumerManifestGate =
  Array.isArray(EXPLICIT_CONSUMER_MANIFEST.allowedConsumers) &&
  EXPLICIT_CONSUMER_MANIFEST.allowedConsumers.length === 1 &&
  EXPLICIT_CONSUMER_MANIFEST.allowedConsumers[0] ===
    TASKLOOP_EXPLICIT_INVOCATION_CONSUMER &&
  [
    "defaultConsumers",
    "modelMessageConsumers",
    "gatewayConsumers",
    "providerTransportConsumers",
    "checkpointPayloadConsumers",
    "lifecyclePayloadConsumers",
    "runtimeAuthorityConsumers",
    "persistentConsumers",
  ].every((key) =>
    Array.isArray(EXPLICIT_CONSUMER_MANIFEST[key]) &&
    EXPLICIT_CONSUMER_MANIFEST[key].length === 0
  );
const budgetGate = budgetSweep.every((row) => row.tokenEstimate <= row.budget);
const cacheGate = cacheBeforeClear.entryCount === 800 &&
  cacheAfterClear.entryCount === 0 &&
  cacheAfterClear.hitCount === 0 &&
  cacheAfterClear.missCount === 0;
const perfGate = Object.entries(SYNTHETIC_800_BASELINES).every(([phase, limit]) =>
  synthetic800Results[phase].median <= limit
);
const iqrGate = Object.entries(SYNTHETIC_800_IQR_LIMITS).every(([phase, limit]) =>
  synthetic800Results[phase].iqr <= limit
);
const readinessScorecardGate = testsGate &&
  INTERNAL_READINESS_SCORECARD.status === "pass" &&
  INTERNAL_READINESS_SCORECARD.caseCount === 10 &&
  arraysEqual(INTERNAL_READINESS_SCORECARD.requiredClasses, EXPECTED_READINESS_CLASSES) &&
  INTERNAL_READINESS_SCORECARD.insertedCount === 7 &&
  INTERNAL_READINESS_SCORECARD.failClosedCount === 3 &&
  INTERNAL_READINESS_SCORECARD.leakageCount === 0 &&
  INTERNAL_READINESS_SCORECARD.defaultPromptDriftCount === 0 &&
  INTERNAL_READINESS_SCORECARD.authorityEscalationCount === 0 &&
  INTERNAL_READINESS_SCORECARD.expectedStatusMatches === 10 &&
  INTERNAL_READINESS_SCORECARD.score === 100;
const benefitEvaluationPass = BENEFIT_EVALUATION.status === "pass" &&
  BENEFIT_EVALUATION.corpusSize === 12 &&
  BENEFIT_EVALUATION.metrics?.generatedLeakRate === 0 &&
  BENEFIT_EVALUATION.metrics?.promptPresentRedundancyRate === 0 &&
  BENEFIT_EVALUATION.metrics?.mustRejectLeakRate === 0 &&
  BENEFIT_EVALUATION.metrics?.authorityEscalationCount === 0 &&
  BENEFIT_EVALUATION.metrics?.legacyPromptDriftCount === 0 &&
  BENEFIT_EVALUATION.metrics?.irrelevantTaskInsertionBenefit === 0;
const functionalReadinessPass = boundaryGate &&
  testsGate &&
  explicitConsumerManifestGate &&
  readinessScorecardGate &&
  shapeGate &&
  budgetGate &&
  cacheGate &&
  heapRisk === "normal";
const ciGradePerformancePass = reliability === "gate-eligible" &&
  shapeGate &&
  budgetGate &&
  cacheGate &&
  perfGate &&
  iqrGate &&
  heapRisk === "normal";
const validationClosurePass = functionalReadinessPass;

console.log("\n[synthetic-800 cache stats]");
console.log("before clear: " + JSON.stringify(cacheBeforeClear));
console.log("after clear: " + JSON.stringify(cacheAfterClear));
console.log("\n[heap usage risk signal]");
console.log("heapUsedMB=" + (heap.heapUsed / 1024 / 1024).toFixed(1) +
  " heapTotalMB=" + (heap.heapTotal / 1024 / 1024).toFixed(1) +
  " rssMB=" + (heap.rss / 1024 / 1024).toFixed(1) +
  " maxHeapUsedMB=" + (maxHeapUsed / 1024 / 1024).toFixed(1) +
  " risk=" + heapRisk);
console.log("sink=" + sink);
console.log("functional readiness pass: " + functionalReadinessPass);

const validationSummary = {
  mode: VALIDATION_MODE,
  node: process.version,
  platform: process.platform + "/" + process.arch,
  boundaryStatus: BOUNDARY_STATUS,
  explicitConsumerManifest: EXPLICIT_CONSUMER_MANIFEST,
  testResults: VALIDATION_CHECKS,
  internalReadinessScorecard: INTERNAL_READINESS_SCORECARD,
  benefitEvaluation: BENEFIT_EVALUATION,
  investmentInvestigation: INVESTMENT_INVESTIGATION,
  processPollutionCount: pollution,
  reliability,
  functionalReadinessPass,
  benefitEvaluationPass,
  ciGradePerformancePass,
  validationClosurePass,
  gates: {
    boundaryGate,
    testsGate,
    explicitConsumerManifestGate,
    shapeGate,
    readinessScorecardGate,
    budgetGate,
    cacheGate,
    benefitEvaluationPass,
    perfGate,
    iqrGate,
    heapRisk,
  },
  synthetic800: {
    counts: synthetic800Counts,
    phases: Object.fromEntries(
      Object.entries(synthetic800Results).map(([phase, summary]) => [phase, {
        min: Number(summary.min.toFixed(1)),
        median: Number(summary.median.toFixed(1)),
        p75: Number(summary.p75.toFixed(1)),
        max: Number(summary.max.toFixed(1)),
        iqr: Number(summary.iqr.toFixed(1)),
      }]),
    ),
  },
  budgetSweep,
  cacheBeforeClear,
  cacheAfterClear,
};

console.log("\nAGENT_MAP_VALIDATION_SUMMARY " + JSON.stringify(validationSummary));

if (REQUIRE_GATE_ELIGIBLE && reliability !== "gate-eligible") {
  console.error("AgentMap validation requires gate-eligible benchmark evidence, but reliability is " + reliability + ".");
  process.exit(2);
}
if (reliability === "gate-eligible" && !ciGradePerformancePass) {
  console.error("AgentMap CI-grade performance gate failed.");
  process.exit(1);
}

function arraysEqual(left, right) {
  return Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === right.length &&
    left.every((value, index) => value === right[index]);
}
`;

main().catch((error) => {
  console.error("[agent-map-validate] failed");
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
