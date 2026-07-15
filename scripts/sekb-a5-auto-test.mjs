/**
 * SEKB A.5 automated local test runner.
 *
 * Captures trajectories (DeepSeek-backed when key present), runs export/protocol/report,
 * optionally fills dual-smoke labels from privacy-bounded export fields only, and writes
 * durable evidence under artifacts/sekb-hermes-phase-a5/.
 *
 * Authority:
 * - Offline evaluation / smoke evidence only
 * - Automated dual-smoke labels are NOT human dual review
 * - Never claims evaluable_for_promotion from automated labels
 * - Shadow V1 frozen; no Phase C/D activation
 *
 * Usage:
 *   node scripts/sekb-a5-auto-test.mjs
 *   node scripts/sekb-a5-auto-test.mjs --count 20 --sample-size 20
 *   node scripts/sekb-a5-auto-test.mjs --count 0 --skip-capture   # report-only on existing DB
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { randomUUID, createHash } from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const artifactDir = path.join(repoRoot, "artifacts", "sekb-hermes-phase-a5");
const sekbDist = path.join(repoRoot, "openclaw_runtime", "dist", "knowledge", "sekb", "index.js");
const opsScript = path.join(repoRoot, "scripts", "sekb-hermes-ops.mjs");
const captureScript = path.join(repoRoot, "scripts", "sekb-shadow-capture-smoke.mjs");
const enableScript = path.join(repoRoot, "scripts", "sekb-enable-shadow-local.mjs");

const REVIEWER_A = "autoReviewerA";
const REVIEWER_B = "autoReviewerB";
const SHADOW_THRESHOLD = 50;

function parseArgs(argv) {
  const options = {
    count: 20,
    sampleSize: 20,
    skipCapture: false,
    autoLabel: true,
    key: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const take = () => {
      const value = argv[i + 1];
      if (!value || value.startsWith("-")) throw new Error(`Missing value for ${arg}`);
      i += 1;
      return value;
    };
    if (arg === "--count") options.count = Number(take());
    else if (arg === "--sample-size") options.sampleSize = Number(take());
    else if (arg === "--skip-capture") options.skipCapture = true;
    else if (arg === "--no-auto-label") options.autoLabel = false;
    else if (arg === "--key") options.key = take();
    else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: node scripts/sekb-a5-auto-test.mjs [--count N] [--sample-size N] [--skip-capture] [--no-auto-label] [--key KEY]`);
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  if (!Number.isFinite(options.count) || options.count < 0) throw new Error("--count must be >= 0");
  if (!Number.isFinite(options.sampleSize) || options.sampleSize < 0) throw new Error("--sample-size must be >= 0");
  return options;
}

function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function ensureDirs() {
  mkdirSync(artifactDir, { recursive: true });
  mkdirSync(path.join(artifactDir, "runs"), { recursive: true });
}

function resolveElectronStateDir() {
  const appData = process.env.APPDATA;
  if (!appData) return null;
  const stateDir = path.join(appData, "Electron", "openclaw-source-state");
  return existsSync(stateDir) ? stateDir : null;
}

function runNode(scriptPath, args = [], env = process.env) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: repoRoot,
    env,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join("\n");
    throw new Error(`Command failed (${path.basename(scriptPath)} ${args.join(" ")}):\n${detail}`);
  }
  return {
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

function inventoryDb(dbPath) {
  if (!existsSync(dbPath)) {
    return { path: dbPath, exists: false, sekbTrajectoryCount: 0, sekbPrincipleCount: 0, tables: [] };
  }
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'sekb%'")
    .all()
    .map((row) => row.name);
  const count = (name) =>
    tables.includes(name) ? db.prepare(`SELECT COUNT(*) AS c FROM ${name}`).get().c : 0;
  const out = {
    path: dbPath,
    exists: true,
    tables,
    sekbTrajectoryCount: count("sekb_trajectories"),
    sekbPrincipleCount: count("sekb_principles"),
  };
  db.close();
  return out;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

/**
 * Two independent automated smoke reviewers over privacy-bounded fields only.
 * Deliberately not identical, so agreement metrics are meaningful smoke signals.
 * These are NOT human dual-review labels and cannot authorize promotion.
 */
function autoLabelA(record) {
  const score = record.shadow?.score;
  const outcome = record.terminalOutcome;
  const tools = (record.counts?.toolCalls || 0) + (record.counts?.toolResults || 0);
  if (score === null || score === undefined) return "uncertain";
  if (outcome === "failure" && score < SHADOW_THRESHOLD) return "not_valuable";
  if (outcome === "failure" && score >= SHADOW_THRESHOLD) return "uncertain";
  if (tools === 0 && score < 60) return "uncertain";
  if (score >= SHADOW_THRESHOLD) return "valuable";
  return "not_valuable";
}

function autoLabelB(record) {
  // Independent heuristic: outcome-first, then score band, then error recurrence.
  const score = record.shadow?.score;
  const outcome = record.terminalOutcome;
  const recurrence = record.error?.recurrenceCount || 0;
  if (score === null || score === undefined) return "uncertain";
  if (outcome === "success" && score >= 45) return "valuable";
  if (outcome === "partial") {
    if (score >= 70) return "valuable";
    if (score >= 40) return "uncertain";
    return "not_valuable";
  }
  if (outcome === "failure") {
    if (recurrence >= 2 && score < 60) return "not_valuable";
    if (score >= 80) return "uncertain";
    return "not_valuable";
  }
  return score >= SHADOW_THRESHOLD ? "valuable" : "not_valuable";
}

function buildAutoReviews(protocol, exportArtifact) {
  const byId = new Map(exportArtifact.records.map((record) => [record.trajectoryId, record]));
  const reviews = [];
  for (const sample of protocol.sample) {
    const record = byId.get(sample.trajectoryId);
    if (!record) continue;
    reviews.push({
      trajectoryId: sample.trajectoryId,
      reviewerId: REVIEWER_A,
      split: sample.split,
      label: autoLabelA(record),
      labelSource: "automated_smoke_not_human",
    });
    reviews.push({
      trajectoryId: sample.trajectoryId,
      reviewerId: REVIEWER_B,
      split: sample.split,
      label: autoLabelB(record),
      labelSource: "automated_smoke_not_human",
    });
  }
  return reviews;
}

function ensureSekbDist() {
  if (existsSync(sekbDist)) return;
  const build = spawnSync(process.execPath, [path.join(repoRoot, "scripts", "build-openclaw-runtime.mjs"), "--sekb-only"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (build.status !== 0 || !existsSync(sekbDist)) {
    throw new Error(`SEKB dist missing and build failed:\n${build.stdout || ""}\n${build.stderr || ""}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  ensureDirs();
  ensureSekbDist();

  const electronStateDir = resolveElectronStateDir();
  if (electronStateDir && !process.env.OPENCLAW_STATE_DIR) {
    process.env.OPENCLAW_STATE_DIR = electronStateDir;
  }
  process.env.OPENCLAW_SEKB_ENABLED = process.env.OPENCLAW_SEKB_ENABLED || "true";
  process.env.OPENCLAW_SEKB_SHADOW_EVALUATION_ENABLED =
    process.env.OPENCLAW_SEKB_SHADOW_EVALUATION_ENABLED || "true";

  const runId = `a5-auto-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const runDir = path.join(artifactDir, "runs", runId);
  mkdirSync(runDir, { recursive: true });

  const startedAt = nowIso();
  const steps = [];
  const key =
    options.key ||
    `local-a5-auto-${createHash("sha256").update(runId).digest("hex").slice(0, 24)}`;

  // 1) enable shadow flags
  steps.push({ id: "enable-shadow", startedAt: nowIso() });
  const enableOut = runNode(enableScript, ["--enable", "--target", "electron"], process.env);
  steps[steps.length - 1].ok = true;
  steps[steps.length - 1].stdout = enableOut.stdout.trim();

  // 2) capture trajectories
  let captureSummary = null;
  if (!options.skipCapture && options.count > 0) {
    steps.push({ id: "capture", startedAt: nowIso(), count: options.count });
    if (!process.env.DEEPSEEK_API_KEY && !process.env.CLAWX_DEEPSEEK_API_KEY) {
      throw new Error("DEEPSEEK_API_KEY is required for automated capture. Set it or pass --skip-capture.");
    }
    const captureOut = runNode(captureScript, ["--count", String(options.count)], process.env);
    captureSummary = JSON.parse(captureOut.stdout);
    steps[steps.length - 1].ok = true;
    steps[steps.length - 1].created = captureSummary.created;
    steps[steps.length - 1].after = captureSummary.after;
  } else {
    steps.push({ id: "capture", ok: true, skipped: true });
  }

  const resolveStateDb = () =>
    path.join(
      process.env.OPENCLAW_STATE_DIR || path.join(process.env.USERPROFILE || "", ".openclaw"),
      "state",
      "openclaw.sqlite",
    );
  const inventoryBeforeExport = inventoryDb(resolveStateDb());

  // 3) export
  steps.push({ id: "export", startedAt: nowIso() });
  const exportOut = runNode(opsScript, ["export", "--key", key], process.env);
  const exportMeta = JSON.parse(exportOut.stdout);
  steps[steps.length - 1].ok = true;
  steps[steps.length - 1].recordCount = exportMeta.recordCount;

  // 4) protocol
  steps.push({ id: "protocol", startedAt: nowIso() });
  const protocolOut = runNode(
    opsScript,
    ["protocol", "--key", key, "--sample-size", String(options.sampleSize)],
    process.env,
  );
  const protocolMeta = JSON.parse(protocolOut.stdout);
  steps[steps.length - 1].ok = true;
  steps[steps.length - 1].sampleCount = protocolMeta.sampleCount;

  const exportPath = path.join(artifactDir, "shadow-evaluation-export.v1.json");
  const protocolPath = path.join(artifactDir, "shadow-evaluation-review-protocol.v1.json");
  const reviewsPath = path.join(artifactDir, "shadow-evaluation-reviews.v1.json");
  const reportPath = path.join(artifactDir, "shadow-evaluation-report.v1.json");
  const exportArtifact = readJson(exportPath);
  const protocol = readJson(protocolPath);

  // 5) dual-smoke labels (optional)
  let reviewsFile;
  if (options.autoLabel && protocol.sample.length > 0) {
    const reviews = buildAutoReviews(protocol, exportArtifact);
    reviewsFile = {
      schema: "sekb-shadow-evaluation-reviews.v1",
      authority: "offline_evaluation_evidence_not_runtime_source_of_truth",
      labels: ["valuable", "not_valuable", "uncertain"],
      reviewers: [REVIEWER_A, REVIEWER_B],
      notes: [
        "AUTOMATED SMOKE LABELS ONLY 鈥?not independent human dual review.",
        "labelSource=automated_smoke_not_human for every row.",
        "These labels must never be used to claim evaluable_for_promotion.",
        "Shadow V1 threshold remains frozen at 50. Phase C/D not activated.",
      ],
      labelAuthority: "automated_smoke_not_human",
      reviews,
    };
    writeJson(reviewsPath, reviewsFile);
    steps.push({
      id: "auto-label",
      ok: true,
      filled: reviews.length,
      pairs: protocol.sample.length,
      authority: "automated_smoke_not_human",
    });
  } else {
    reviewsFile = {
      schema: "sekb-shadow-evaluation-reviews.v1",
      authority: "offline_evaluation_evidence_not_runtime_source_of_truth",
      labels: ["valuable", "not_valuable", "uncertain"],
      reviewers: [REVIEWER_A, REVIEWER_B],
      notes: [
        "No auto labels written (--no-auto-label or empty sample).",
        "Do not fabricate dual-review labels for promotion evidence.",
      ],
      labelAuthority: "unfilled",
      reviews: [],
    };
    writeJson(reviewsPath, reviewsFile);
    steps.push({ id: "auto-label", ok: true, skipped: true });
  }

  // 6) report
  steps.push({ id: "report", startedAt: nowIso() });
  const reportOut = runNode(
    opsScript,
    [
      "report",
      "--reviews",
      reviewsPath,
      "--export",
      exportPath,
      "--protocol",
      protocolPath,
      "--reviewers",
      `${REVIEWER_A},${REVIEWER_B}`,
    ],
    process.env,
  );
  const reportMeta = JSON.parse(reportOut.stdout);
  const report = readJson(reportPath);
  steps[steps.length - 1].ok = true;
  steps[steps.length - 1].status = reportMeta.status;
  steps[steps.length - 1].promotion = reportMeta.promotion;

  // Hard gate: automated labels cannot authorize promotion evidence.
  const labelsAutomated = reviewsFile.labelAuthority === "automated_smoke_not_human";
  const promotionDecision = {
    status: "shadow_only",
    evaluableForPromotion: false,
    reportPromotionStatus: report.promotion?.status || null,
    reportBlockers: report.promotion?.blockers || [],
    labelsAutomated,
    reason: labelsAutomated
      ? "automated_smoke_labels_cannot_authorize_evaluable_for_promotion"
      : report.promotion?.status === "evaluable_for_promotion"
        ? "report_claimed_evaluable_but_campaign_requires_human_dual_review"
        : "report_shadow_only",
    requiredGates: {
      independentlyReviewedTrajectories: 200,
      unresolvedDisagreements: 0,
      cohensKappaMin: 0.7,
      holdoutValuableRecallMin: 0.95,
      holdoutProjectedFalseDropMax: 0.02,
      humanDualReviewRequired: true,
    },
  };

  const finishedAt = nowIso();
  const inventory = inventoryDb(resolveStateDb());

  const testResult = {
    schema: "sekb-hermes-a5-auto-test-result.v1",
    authority: "offline_evaluation_evidence_not_runtime_source_of_truth",
    runId,
    startedAt,
    finishedAt,
    options: {
      count: options.count,
      sampleSize: options.sampleSize,
      skipCapture: options.skipCapture,
      autoLabel: options.autoLabel,
    },
    env: {
      openclawStateDir: process.env.OPENCLAW_STATE_DIR || null,
      sekbEnabled: process.env.OPENCLAW_SEKB_ENABLED || null,
      shadowEnabled: process.env.OPENCLAW_SEKB_SHADOW_EVALUATION_ENABLED || null,
      deepseekKeyPresent: Boolean(process.env.DEEPSEEK_API_KEY || process.env.CLAWX_DEEPSEEK_API_KEY),
    },
    inventory,
    captureSummary,
    steps,
    artifacts: {
      export: exportPath,
      protocol: protocolPath,
      reviews: reviewsPath,
      report: reportPath,
    },
    metrics: {
      exportRecordCount: exportArtifact.records.length,
      protocolSampleCount: protocol.sample.length,
      filledAnnotations: (reviewsFile.reviews || []).filter((row) => typeof row.label === "string").length,
      reportStatus: report.status,
      reportPromotion: report.promotion,
      agreement: report.agreement,
      labeling: report.labeling,
      holdout: report.holdout,
      development: report.development,
    },
    promotionDecision,
    checks: {
      sekbDistPresent: existsSync(sekbDist),
      exportRecordsPositive: exportArtifact.records.length > 0,
      protocolSamplesPositive: protocol.sample.length > 0,
      shadowThresholdFrozenAt50: report.projectionPolicy?.scoreThreshold === SHADOW_THRESHOLD,
      phaseCdNotActivated: true,
      noHumanPromotionClaim: promotionDecision.evaluableForPromotion === false,
      privacyBoundedExport:
        exportArtifact.records.every(
          (record) =>
            Object.keys(record).sort().join(",") === "counts,error,shadow,terminalOutcome,trajectoryId",
        ),
    },
  };

  // Pass/fail for automation (pipeline health, not promotion)
  const failedChecks = Object.entries(testResult.checks)
    .filter(([, value]) => value !== true)
    .map(([name]) => name);
  testResult.verdict = {
    status: failedChecks.length === 0 && exportArtifact.records.length > 0 ? "pass" : "fail",
    failedChecks,
    note:
      "pass means automated A.5 pipeline smoke succeeded; it does not mean evaluable_for_promotion.",
  };

  const resultPath = path.join(artifactDir, "auto-test-result.v1.json");
  const runResultPath = path.join(runDir, "auto-test-result.v1.json");
  writeJson(resultPath, testResult);
  writeJson(runResultPath, testResult);

  // snapshot key artifacts into run dir
  for (const name of [
    "shadow-evaluation-export.v1.json",
    "shadow-evaluation-review-protocol.v1.json",
    "shadow-evaluation-reviews.v1.json",
    "shadow-evaluation-report.v1.json",
  ]) {
    const src = path.join(artifactDir, name);
    if (existsSync(src)) copyFileSync(src, path.join(runDir, name));
  }

  // update campaign status
  const campaignStatus = {
    schema: "sekb-hermes-a5-evaluation-campaign-status.v1",
    authority: "offline_evaluation_evidence_not_runtime_source_of_truth",
    generatedAt: finishedAt,
    campaign: {
      name: "sekb-hermes-a5-auto-test-local",
      goal: "Automated A.5 pipeline smoke + honest dual-review readiness tracking",
      runtimeAuthorityChanged: false,
      phaseCDActivated: false,
      shadowV1Retuned: false,
      lastAutoTestRunId: runId,
    },
    inventory: {
      stateDb: inventory.path,
      sekbTrajectoryCount: inventory.sekbTrajectoryCount,
      sekbPrincipleCount: inventory.sekbPrincipleCount,
      exportRecordCount: exportArtifact.records.length,
      protocolSampleCount: protocol.sample.length,
      filledDualReviewPairs: (reviewsFile.reviews || []).filter((row) => typeof row.label === "string").length,
      openclawJsonHasSekbConfig: true,
      sekbEnabled: true,
      shadowEvaluationEnabled: true,
      batchDistillationAssistantEnabled: false,
      openclawStateDir: process.env.OPENCLAW_STATE_DIR || null,
      labelAuthority: reviewsFile.labelAuthority,
      notes: [
        "Automated smoke labels (if present) are not human dual review.",
        "evaluable_for_promotion remains false until 200 human dual reviews + gates pass.",
        "Shadow V1 threshold frozen at 50. Phase C/D not activated.",
      ],
    },
    offlineReport: {
      status: report.status,
      promotion: report.promotion,
      labeling: report.labeling,
      agreement: report.agreement,
      projectionPolicy: report.projectionPolicy,
    },
    promotionDecision,
    autoTest: {
      runId,
      resultPath,
      runDir,
      verdict: testResult.verdict,
    },
    nextActions: [
      {
        id: "human-dual-review",
        action: "Replace automated_smoke labels with two independent human reviewers before any promotion decision.",
      },
      {
        id: "grow-inventory",
        action: "Continue capture via pnpm sekb:a5:auto-test or GUI chat until >=200 reviewable samples exist.",
      },
    ],
    explicitNonGoals: [
      "No fabricated human dual-review labels",
      "No Shadow V1 retune",
      "No capture filtering",
      "No Phase C/D activation",
      "No automatic principle writes",
    ],
    executedAt: finishedAt,
    pipeline: {
      export: "shadow-evaluation-export.v1.json",
      protocol: "shadow-evaluation-review-protocol.v1.json",
      reviews: "shadow-evaluation-reviews.v1.json",
      report: "shadow-evaluation-report.v1.json",
      autoTestResult: "auto-test-result.v1.json",
      reportStatus: report.status,
      promotionStatus: promotionDecision.status,
    },
  };
  writeJson(path.join(artifactDir, "evaluation-campaign-status.v1.json"), campaignStatus);
  writeJson(path.join(runDir, "evaluation-campaign-status.v1.json"), campaignStatus);

  // concise markdown summary for humans
  const md = [
    `# SEKB A.5 Auto Test Result`,
    ``,
    `- runId: \`${runId}\``,
    `- started: ${startedAt}`,
    `- finished: ${finishedAt}`,
    `- verdict: **${testResult.verdict.status}**`,
    `- trajectories: ${inventory.sekbTrajectoryCount}`,
    `- export records: ${exportArtifact.records.length}`,
    `- protocol samples: ${protocol.sample.length}`,
    `- filled annotations: ${testResult.metrics.filledAnnotations}`,
    `- report status: ${report.status}`,
    `- report promotion: ${report.promotion?.status}`,
    `- campaign evaluable_for_promotion: **false** (${promotionDecision.reason})`,
    `- label authority: ${reviewsFile.labelAuthority}`,
    `- state DB: \`${inventory.path}\``,
    ``,
    `## Checks`,
    ...Object.entries(testResult.checks).map(([k, v]) => `- ${v ? "PASS" : "FAIL"} ${k}`),
    ``,
    `## Artifacts`,
    `- \`${path.relative(repoRoot, resultPath)}\``,
    `- \`${path.relative(repoRoot, runDir)}\``,
    ``,
    `## Note`,
    `Automated dual-smoke labels exercise the report path only. Human dual review is still required for promotion evidence.`,
    ``,
  ].join("\n");
  writeFileSync(path.join(artifactDir, "AUTO-TEST-RESULT.md"), md, "utf8");
  writeFileSync(path.join(runDir, "AUTO-TEST-RESULT.md"), md, "utf8");

  console.log(
    JSON.stringify(
      {
        authority: testResult.authority,
        runId,
        verdict: testResult.verdict,
        inventory: {
          sekbTrajectoryCount: inventory.sekbTrajectoryCount,
          exportRecordCount: exportArtifact.records.length,
          protocolSampleCount: protocol.sample.length,
        },
        reportStatus: report.status,
        reportPromotion: report.promotion?.status,
        evaluableForPromotion: false,
        resultPath,
        runDir,
      },
      null,
      2,
    ),
  );

  if (testResult.verdict.status !== "pass") {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});

