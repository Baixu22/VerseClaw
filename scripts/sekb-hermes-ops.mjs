#!/usr/bin/env node
/**
 * SEKB Hermes ops surface (CLI only, no GUI).
 * Offline evaluation + manual distillation helpers.
 * Never activates capture filtering, scheduler, or automatic principle writes.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const runtimeRoot = path.join(repoRoot, "openclaw_runtime");
const sekbDist = path.join(runtimeRoot, "dist", "knowledge", "sekb", "index.js");
const artifactDirName = path.join("artifacts", "sekb-hermes-phase-a5");

const usage = `Usage:
  node scripts/sekb-hermes-ops.mjs <command> [options]

Commands:
  export   --key <pseudonymizationKey> [--workspace <root>] [--no-write]
  protocol --key <pseudonymizationKey> [--workspace <root>] [--sample-size N]
  report   --reviews <path> --export <path> --protocol <path> --reviewers A,B [--workspace <root>]
  suggest  [--trajectory-ids id1,id2] [--min-cluster-size N] [--batch]
  confirm  --suggestion <json-file> [--edits <json-file>]
  reject   --suggestion <json-file> [--reason <text>]
  would-trigger  Explicit Phase C evidence-only evaluation (default-off flag / env)
  gate     Run focused SEKB tests + contract:check + harness validate

Notes:
  - Default-off. Batch mode still requires SEKB + batchDistillation flags/env.\n  - Batch uses DEEPSEEK_API_KEY only on explicit --batch when flags allow; otherwise deterministic fallback.
  - Local ops require openclaw_runtime/dist/knowledge/sekb/index.js (pnpm build:runtime or --sekb-only).
  - Offline artifacts are non-authoritative evaluation evidence only.
  - No automatic principle/ContextBlock writes; confirm is the only durable write path.
  - would-trigger never mutates store; requires SEKB + phaseCWouldTrigger flags/env.
`;

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {
    command,
    key: null,
    workspace: repoRoot,
    write: true,
    sampleSize: undefined,
    reviews: null,
    exportPath: null,
    protocolPath: null,
    reviewers: ["reviewerA", "reviewerB"],
    trajectoryIds: null,
    minClusterSize: 2,
    batch: false,
    suggestion: null,
    edits: null,
    reason: "rejected",
    forceFlag: false,
    limit: 50,
  };
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === "--help" || arg === "-h") {
      console.log(usage);
      process.exit(0);
    }
    if (arg === "--no-write") {
      options.write = false;
      continue;
    }
    if (arg === "--batch") {
      options.batch = true;
      continue;
    }
    if (arg === "--force-flag-on") {
      options.forceFlag = true;
      continue;
    }
    const take = () => {
      const value = rest[i + 1];
      if (!value || value.startsWith("-")) fail(`Missing value for ${arg}`);
      i += 1;
      return value;
    };
    if (arg === "--key") options.key = take();
    else if (arg === "--workspace") options.workspace = path.resolve(take());
    else if (arg === "--sample-size") options.sampleSize = Number(take());
    else if (arg === "--reviews") options.reviews = path.resolve(take());
    else if (arg === "--export") options.exportPath = path.resolve(take());
    else if (arg === "--protocol") options.protocolPath = path.resolve(take());
    else if (arg === "--reviewers") options.reviewers = take().split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
    else if (arg === "--trajectory-ids") options.trajectoryIds = take().split(",").map((s) => s.trim()).filter(Boolean);
    else if (arg === "--min-cluster-size") options.minClusterSize = Number(take());
    else if (arg === "--suggestion") options.suggestion = path.resolve(take());
    else if (arg === "--edits") options.edits = path.resolve(take());
    else if (arg === "--reason") options.reason = take();
    else if (arg === "--limit") options.limit = Number(take());
    else fail(`Unknown option: ${arg}`);
  }
  return options;
}

async function loadSekb() {
  if (!existsSync(sekbDist)) {
    fail(
      [
        `SEKB runtime dist not found at ${sekbDist}.`,
        "Build the local ops module first:",
        "  pnpm exec node scripts/build-openclaw-runtime.mjs --sekb-only",
        "  # or full: pnpm build:runtime",
        "gate does not require dist (unit/contract/harness only).",
      ].join("\n"),
    );
  }
  return import(pathToFileURL(sekbDist).href);
}

/** Match Host knowledge-api flag resolution: Electron state dir first, then ~/.openclaw. */
function resolveOpsStateDir() {
  if (process.env.OPENCLAW_STATE_DIR?.trim()) {
    return process.env.OPENCLAW_STATE_DIR.trim();
  }
  const appData = process.env.APPDATA || path.join(process.env.USERPROFILE || process.env.HOME || "", "AppData", "Roaming");
  return path.join(appData, "Electron", "openclaw-source-state");
}

function createOpsKnowledgeStore(sekb) {
  const stateDir = resolveOpsStateDir();
  return new sekb.KnowledgeStore({
    database: {
      env: {
        ...process.env,
        OPENCLAW_STATE_DIR: stateDir,
      },
    },
  });
}

function readSekbFlagConfig() {
  try {
    const candidates = [
      path.join(resolveOpsStateDir(), "openclaw.json"),
      path.join(process.env.USERPROFILE || process.env.HOME || "", ".openclaw", "openclaw.json"),
    ];
    for (const configPath of candidates) {
      if (!configPath || !existsSync(configPath)) continue;
      return JSON.parse(readFileSync(configPath, "utf8"));
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function cmdExport(options) {
  if (!options.key) fail("--key is required");
  const sekb = await loadSekb();
  const store = createOpsKnowledgeStore(sekb);
  const trajectories = store.query_trajectories({});
  if (!options.write) {
    const artifact = sekb.buildSekbShadowEvaluationExport({
      trajectories,
      pseudonymizationKey: options.key,
    });
    console.log(JSON.stringify(artifact, null, 2));
    return;
  }
  const written = sekb.writeSekbShadowEvaluationExportArtifact({
    trajectories,
    pseudonymizationKey: options.key,
    workspaceRoot: options.workspace,
  });
  console.log(JSON.stringify({
    authority: "offline_evaluation_evidence_not_runtime_source_of_truth",
    artifactPath: written.artifactPath,
    recordCount: written.artifact.records.length,
  }, null, 2));
}

async function cmdProtocol(options) {
  if (!options.key) fail("--key is required");
  const sekb = await loadSekb();
  const store = createOpsKnowledgeStore(sekb);
  const trajectories = store.query_trajectories({});
  const artifact = sekb.buildSekbShadowEvaluationExport({
    trajectories,
    pseudonymizationKey: options.key,
  });
  const protocol = sekb.createSekbShadowEvaluationReviewProtocol(artifact, {
    sampleSize: Number.isFinite(options.sampleSize) ? options.sampleSize : undefined,
  });
  const dir = path.join(options.workspace, artifactDirName);
  const protocolPath = path.join(dir, "shadow-evaluation-review-protocol.v1.json");
  const templatePath = path.join(dir, "shadow-evaluation-reviews.template.v1.json");
  if (options.write) {
    sekb.writeSekbShadowEvaluationExportArtifact({
      trajectories,
      pseudonymizationKey: options.key,
      workspaceRoot: options.workspace,
    });
    writeJson(protocolPath, protocol);
    writeJson(templatePath, {
      schema: "sekb-shadow-evaluation-reviews.v1",
      authority: "offline_evaluation_evidence_not_runtime_source_of_truth",
      labels: ["valuable", "not_valuable", "uncertain"],
      reviewers: ["reviewerA", "reviewerB"],
      notes: [
        "Fill label for each reviewer/trajectory pair.",
        "Do not tune score weights or thresholds on holdout.",
        "Kit readiness is not promotion; need >=200 dual reviews before evaluable_for_promotion.",
      ],
      reviews: protocol.sample.flatMap((sample) => ([
        { trajectoryId: sample.trajectoryId, reviewerId: "reviewerA", split: sample.split, label: null },
        { trajectoryId: sample.trajectoryId, reviewerId: "reviewerB", split: sample.split, label: null },
      ])),
    });
  }
  console.log(JSON.stringify({
    authority: "offline_evaluation_evidence_not_runtime_source_of_truth",
    protocolPath: options.write ? protocolPath : null,
    reviewsTemplatePath: options.write ? templatePath : null,
    sampleCount: protocol.sample.length,
  }, null, 2));
}

async function cmdReport(options) {
  if (!options.reviews || !options.exportPath || !options.protocolPath) {
    fail("--reviews, --export, and --protocol are required");
  }
  if (options.reviewers.length !== 2) fail("--reviewers must list exactly two ids");
  const sekb = await loadSekb();
  const exportArtifact = readJson(options.exportPath);
  const protocol = readJson(options.protocolPath);
  const reviewsFile = readJson(options.reviews);
  const reviews = Array.isArray(reviewsFile) ? reviewsFile : reviewsFile.reviews;
  if (!Array.isArray(reviews)) fail("reviews file must be an array or { reviews: [] }");
  const filled = reviews.filter((row) => row && typeof row.label === "string");
  const report = sekb.buildSekbOfflineEvaluationReport({
    artifact: exportArtifact,
    protocol,
    reviews: filled,
    reviewers: [options.reviewers[0], options.reviewers[1]],
  });
  let artifactPath = null;
  if (options.write) {
    artifactPath = sekb.writeSekbOfflineEvaluationReportArtifact({
      report,
      workspaceRoot: options.workspace,
    }).artifactPath;
  }
  console.log(JSON.stringify({
    authority: "offline_evaluation_evidence_not_runtime_source_of_truth",
    artifactPath,
    promotion: report.promotion,
    status: report.status,
  }, null, 2));
}

async function cmdSuggest(options) {
  const sekb = await loadSekb();
  const store = createOpsKnowledgeStore(sekb);
  const distiller = new sekb.DistillationTool({ store });
  if (!options.batch) {
    const suggestions = distiller.suggest_principles_from_trajectories(
      options.trajectoryIds,
      options.minClusterSize,
    );
    console.log(JSON.stringify({ mode: "deterministic", suggestions }, null, 2));
    return;
  }
  const enabled = sekb.isSekbBatchDistillationAssistantEnabled(readSekbFlagConfig(), process.env);
  const provider = enabled && typeof sekb.createDeepSeekSekbBatchDistillationProvider === "function"
    ? sekb.createDeepSeekSekbBatchDistillationProvider()
    : undefined;
  const assistant = new sekb.SekbBatchDistillationAssistant({
    store,
    enabled,
    ...(provider ? { provider } : {}),
    fallback: (ids, min) => distiller.suggest_principles_from_trajectories(ids, min),
  });
  const result = await assistant.suggest({
    trajectoryIds: options.trajectoryIds,
    minClusterSize: options.minClusterSize,
  });
  console.log(JSON.stringify({
    mode: enabled ? "batch" : "feature_disabled",
    userVisibleStatus: result.userVisibleStatus,
    operatorEvidence: result.operatorEvidence,
    suggestions: result.suggestions,
  }, null, 2));
}

async function cmdConfirm(options) {
  if (!options.suggestion) fail("--suggestion <json-file> is required");
  const sekb = await loadSekb();
  const store = createOpsKnowledgeStore(sekb);
  const distiller = new sekb.DistillationTool({ store });
  const suggestion = readJson(options.suggestion);
  const edits = options.edits ? readJson(options.edits) : null;
  const principleId = distiller.confirm_and_save(suggestion, edits);
  console.log(JSON.stringify({ principleId }, null, 2));
}

async function cmdReject(options) {
  if (!options.suggestion) fail("--suggestion <json-file> is required");
  const sekb = await loadSekb();
  const store = createOpsKnowledgeStore(sekb);
  const distiller = new sekb.DistillationTool({ store });
  const suggestion = readJson(options.suggestion);
  distiller.reject_suggestion(suggestion, options.reason);
  console.log(JSON.stringify({ rejected: true }, null, 2));
}

function run(command, args, cwd = repoRoot) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env,
  });
  if (result.status !== 0) {
    fail(`Command failed (${command} ${args.join(" ")}) with exit ${result.status}`);
  }
}


async function cmdWouldTrigger(options) {
  const sekb = await loadSekb();
  const store = createOpsKnowledgeStore(sekb);
  const cfg = readSekbFlagConfig();
  const env = { ...process.env };
  if (options.forceFlag) {
    env.OPENCLAW_SEKB_ENABLED = env.OPENCLAW_SEKB_ENABLED || "1";
    env.OPENCLAW_SEKB_PHASE_C_WOULD_TRIGGER_ENABLED = "1";
  }
  const flagEnabled = sekb.isSekbPhaseCWouldTriggerEnabled(cfg, env);
  const owner = sekb.resolveSekbPhaseCWouldTriggerOwner(cfg);
  const timeoutMs = sekb.resolveSekbPhaseCWouldTriggerTimeoutMs(cfg);
  const trajectories = store.query_trajectories({}).slice(0, options.limit || 50);
  const beforePrinciples = store.query_principles({}).length;
  const beforeTrajectories = store.query_trajectories({}).length;
  const scheduler = new sekb.SekbPhaseCWouldTriggerScheduler({
    owner,
    workspaceKey: resolveOpsStateDir(),
    timeoutMs,
  });
  const result = await scheduler.evaluate({ flagEnabled, trajectories });
  const afterPrinciples = store.query_principles({}).length;
  const afterTrajectories = store.query_trajectories({}).length;
  const observation = {
    schema: "sekb-phase-c-would-trigger-observation.v1",
    generatedAt: new Date().toISOString(),
    flagEnabled,
    owner,
    timeoutMs,
    durableMutation: false,
    storeParity: {
      principlesBefore: beforePrinciples,
      principlesAfter: afterPrinciples,
      trajectoriesBefore: beforeTrajectories,
      trajectoriesAfter: afterTrajectories,
      unchanged: beforePrinciples === afterPrinciples && beforeTrajectories === afterTrajectories,
    },
    observability: sekb.snapshotPhaseCObservability(scheduler, flagEnabled),
    evidenceCount: result.evidence.length,
    wouldTriggerTrue: result.counters.wouldTriggerTrue,
    sampleEvidence: result.evidence.slice(0, 10),
    notes: [
      "Mutation-free Phase C evidence only",
      "Offline artifacts not used as runtime authority",
      "Shadow V1 threshold frozen at 50",
      "Not production filtering; D2 not authorized by this command",
    ],
  };
  const outDir = path.join(options.workspace, artifactDirName, "tier-d");
  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "d1-observation.v1.json");
  if (options.write) {
    writeJson(outPath, observation);
  }
  console.log(JSON.stringify({
    flagEnabled,
    durableMutation: false,
    storeParity: observation.storeParity,
    observability: observation.observability,
    wrote: options.write ? outPath : null,
  }, null, 2));
}

function cmdGate() {
  run("pnpm", [
    "--dir", "openclaw_runtime", "exec", "node", "scripts/run-vitest.mjs", "run",
    "--config", "test/vitest/vitest.unit.config.ts",
    "src/knowledge/sekb/shadow-evaluator.test.ts",
    "src/knowledge/sekb/shadow-evaluation-offline.test.ts",
    "src/knowledge/sekb/batch-distillation-assistant.test.ts",
    "src/knowledge/sekb/sekb.test.ts",
    "src/knowledge/sekb/phase-c-would-trigger.test.ts",
  ]);
  run("pnpm", [
    "--dir", "openclaw_runtime", "exec", "node", "scripts/run-vitest.mjs", "run",
    "--config", "test/vitest/vitest.agents-embedded-agent.config.ts",
    "src/agents/embedded-agent-runner/sekb-runtime.test.ts",
  ]);
  run("pnpm", [
    "--dir", "openclaw_runtime", "exec", "node", "scripts/run-vitest.mjs", "run",
    "--config", "test/vitest/vitest.runtime-config.config.ts",
    "src/config/runtime-context-block-sekb.test.ts",
  ]);
  run("pnpm", ["exec", "vitest", "run", "tests/unit/knowledge-api.test.ts", "--config", "vitest.config.ts"]);
  run("pnpm", ["contract:check"]);
  run("pnpm", ["harness", "validate", "--spec", "harness/specs/tasks/sekb-hermes-gap-closure.md"]);
  console.log("sekb:hermes:gate passed");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.command || options.command === "help") {
    console.log(usage);
    process.exit(0);
  }
  switch (options.command) {
    case "export":
      await cmdExport(options);
      break;
    case "protocol":
      await cmdProtocol(options);
      break;
    case "report":
      await cmdReport(options);
      break;
    case "suggest":
      await cmdSuggest(options);
      break;
    case "confirm":
      await cmdConfirm(options);
      break;
    case "reject":
      await cmdReject(options);
      break;
    case "would-trigger":
      await cmdWouldTrigger(options);
      break;
    case "gate":
      cmdGate();
      break;
    default:
      fail(`Unknown command: ${options.command}\n\n${usage}`);
  }
}

main().catch((error) => {
  fail(error instanceof Error ? error.stack || error.message : String(error));
});
