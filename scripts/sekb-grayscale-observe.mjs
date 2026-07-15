#!/usr/bin/env node
/**
 * SEKB Hermes Tier B grayscale observation (capture + report only).
 *
 * Builds an evidence pack under artifacts/sekb-hermes-phase-a5/:
 * - inventory counts vs export record counts
 * - task_type / context_tags distribution
 * - shadow score + retain distribution
 * - sqlite size
 * - privacy-bounded export checks
 * - operator-report honesty snapshot (if dist available)
 * - grayscale status JSON + markdown notes
 *
 * Does NOT:
 * - enable Phase C/D
 * - enable batch LLM
 * - fabricate human dual-review
 * - claim evaluable_for_promotion
 * - auto-write principles / ContextBlocks
 *
 * Usage:
 *   node scripts/sekb-grayscale-observe.mjs
 *   node scripts/sekb-grayscale-observe.mjs --key <pseudonymizationKey>
 *   node scripts/sekb-grayscale-observe.mjs --skip-export
 *   node scripts/sekb-grayscale-observe.mjs --sample-size 20
 */
import { DatabaseSync } from "node:sqlite";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  statSync,
  copyFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const artifactDir = path.join(repoRoot, "artifacts", "sekb-hermes-phase-a5");
const sekbDist = path.join(repoRoot, "openclaw_runtime", "dist", "knowledge", "sekb", "index.js");
const opsScript = path.join(repoRoot, "scripts", "sekb-hermes-ops.mjs");
const enableScript = path.join(repoRoot, "scripts", "sekb-enable-shadow-local.mjs");
const SHADOW_THRESHOLD = 50;
const SHADOW_METADATA_MAX_BYTES = 2048;

function parseArgs(argv) {
  const options = {
    key: null,
    skipExport: false,
    sampleSize: 20,
    write: true,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const take = () => {
      const value = argv[i + 1];
      if (!value || value.startsWith("-")) throw new Error(`Missing value for ${arg}`);
      i += 1;
      return value;
    };
    if (arg === "--key") options.key = take();
    else if (arg === "--skip-export") options.skipExport = true;
    else if (arg === "--sample-size") options.sampleSize = Number(take());
    else if (arg === "--no-write") options.write = false;
    else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: node scripts/sekb-grayscale-observe.mjs [--key KEY] [--sample-size N] [--skip-export] [--no-write]`);
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  if (!Number.isFinite(options.sampleSize) || options.sampleSize < 0) {
    throw new Error("--sample-size must be >= 0");
  }
  return options;
}

function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function resolveElectronStateDir() {
  if (process.env.OPENCLAW_STATE_DIR?.trim()) {
    return process.env.OPENCLAW_STATE_DIR.trim();
  }
  const appData = process.env.APPDATA;
  if (!appData) return null;
  return path.join(appData, "Electron", "openclaw-source-state");
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

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function readSekbFlags(stateDir) {
  const candidates = [
    path.join(stateDir || "", "openclaw.json"),
    path.join(process.env.USERPROFILE || process.env.HOME || "", ".openclaw", "openclaw.json"),
  ];
  for (const configPath of candidates) {
    if (!configPath || !existsSync(configPath)) continue;
    try {
      const cfg = JSON.parse(readFileSync(configPath, "utf8"));
      return {
        path: configPath,
        sekb: cfg?.runtime?.contextBlock?.sekb ?? null,
      };
    } catch {
      continue;
    }
  }
  return { path: null, sekb: null };
}

function analyzeDb(dbPath) {
  if (!existsSync(dbPath)) {
    return {
      path: dbPath,
      exists: false,
      sekbTrajectoryCount: 0,
      sekbPrincipleCount: 0,
      bytes: 0,
      taskTypeDistribution: {},
      contextTagDistribution: {},
      outcomeDistribution: {},
      shadow: {
        withMetadata: 0,
        withoutMetadata: 0,
        scoreBuckets: {},
        retain: 0,
        reviewLowSignal: 0,
        metadataBytes: { max: 0, over2KiB: 0 },
      },
      createdAtRange: null,
    };
  }

  const db = new DatabaseSync(dbPath, { readOnly: true });
  const sekbTrajectoryCount = db.prepare("SELECT COUNT(*) AS c FROM sekb_trajectories").get().c;
  const sekbPrincipleCount = existsSyncTable(db, "sekb_principles")
    ? db.prepare("SELECT COUNT(*) AS c FROM sekb_principles").get().c
    : 0;
  const batchEvents = existsSyncTable(db, "sekb_batch_distillation_events")
    ? db.prepare("SELECT COUNT(*) AS c FROM sekb_batch_distillation_events").get().c
    : 0;

  const rows = db
    .prepare(
      `SELECT trajectory_id, task_type, outcome, context_fingerprint_json, metadata_json, created_at
       FROM sekb_trajectories`,
    )
    .all();
  db.close();

  const taskTypeDistribution = {};
  const contextTagDistribution = {};
  const outcomeDistribution = {};
  const scoreBuckets = {
    "0-24": 0,
    "25-49": 0,
    "50-74": 0,
    "75-100": 0,
    missing: 0,
  };
  let withMetadata = 0;
  let withoutMetadata = 0;
  let retain = 0;
  let reviewLowSignal = 0;
  let maxMetaBytes = 0;
  let over2KiB = 0;
  let minCreated = null;
  let maxCreated = null;

  for (const row of rows) {
    const taskType = row.task_type || "(empty)";
    taskTypeDistribution[taskType] = (taskTypeDistribution[taskType] || 0) + 1;
    outcomeDistribution[row.outcome || "(empty)"] =
      (outcomeDistribution[row.outcome || "(empty)"] || 0) + 1;

    let tags = [];
    try {
      tags = JSON.parse(row.context_fingerprint_json || "[]");
      if (!Array.isArray(tags)) tags = [];
    } catch {
      tags = [];
    }
    for (const tag of tags) {
      const key = String(tag);
      contextTagDistribution[key] = (contextTagDistribution[key] || 0) + 1;
    }

    let meta = null;
    const metaRaw = row.metadata_json || "";
    const metaBytes = Buffer.byteLength(metaRaw, "utf8");
    maxMetaBytes = Math.max(maxMetaBytes, metaBytes);
    if (metaBytes > SHADOW_METADATA_MAX_BYTES) over2KiB += 1;
    try {
      meta = metaRaw ? JSON.parse(metaRaw) : null;
    } catch {
      meta = null;
    }
    const shadow = meta?.sekbShadow?.captureQuality;
    if (shadow && typeof shadow.score === "number") {
      withMetadata += 1;
      const score = shadow.score;
      if (score < 25) scoreBuckets["0-24"] += 1;
      else if (score < 50) scoreBuckets["25-49"] += 1;
      else if (score < 75) scoreBuckets["50-74"] += 1;
      else scoreBuckets["75-100"] += 1;
      if (shadow.recommendation === "retain") retain += 1;
      else if (shadow.recommendation === "review_low_signal") reviewLowSignal += 1;
    } else {
      withoutMetadata += 1;
      scoreBuckets.missing += 1;
    }

    if (row.created_at) {
      if (!minCreated || row.created_at < minCreated) minCreated = row.created_at;
      if (!maxCreated || row.created_at > maxCreated) maxCreated = row.created_at;
    }
  }

  return {
    path: dbPath,
    exists: true,
    sekbTrajectoryCount,
    sekbPrincipleCount,
    batchDistillationEventCount: batchEvents,
    bytes: statSync(dbPath).size,
    taskTypeDistribution,
    contextTagDistribution,
    outcomeDistribution,
    shadow: {
      withMetadata,
      withoutMetadata,
      scoreBuckets,
      retain,
      reviewLowSignal,
      retainRatio: sekbTrajectoryCount > 0 ? Number((retain / sekbTrajectoryCount).toFixed(4)) : 0,
      metadataBytes: { max: maxMetaBytes, over2KiB },
    },
    createdAtRange: minCreated ? { min: minCreated, max: maxCreated } : null,
  };
}

function existsSyncTable(db, name) {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name);
  return Boolean(row);
}

function privacyCheckExport(exportArtifact) {
  const forbiddenKeys = [
    "intent",
    "task_intent",
    "prompt",
    "systemPrompt",
    "raw",
    "diff",
    "secret",
    "apiKey",
    "token",
    "password",
    "toolArgs",
    "tool_args",
    "tags",
  ];
  const findings = [];
  const sample = exportArtifact?.records?.[0] || null;
  const recordKeys = sample ? Object.keys(sample) : [];
  for (const key of recordKeys) {
    if (forbiddenKeys.includes(key)) {
      findings.push({ severity: "P0", id: "export_forbidden_top_level_key", key });
    }
  }
  const blob = JSON.stringify(exportArtifact || {});
  for (const needle of ["sk-", "BEGIN PRIVATE KEY", "api_key", "password="]) {
    if (blob.toLowerCase().includes(needle.toLowerCase())) {
      findings.push({ severity: "P0", id: "export_possible_secret_literal", needle });
    }
  }
  // keyed-pseudonymous: trajectory ids present but export should not include free-text intent
  const hasIntentLike = /"task_intent"|"user_prompt"|"system_prompt"/.test(blob);
  if (hasIntentLike) {
    findings.push({ severity: "P0", id: "export_contains_intent_like_fields" });
  }
  return {
    ok: findings.length === 0,
    recordCount: exportArtifact?.records?.length || 0,
    sampleKeys: recordKeys,
    findings,
  };
}

function classifyCollapse(taskTypeDistribution) {
  const keys = Object.keys(taskTypeDistribution || {});
  const total = Object.values(taskTypeDistribution || {}).reduce((a, b) => a + b, 0);
  const agentTask = taskTypeDistribution["agent/task"] || 0;
  const agentRatio = total > 0 ? agentTask / total : 0;
  return {
    distinctTaskTypes: keys.length,
    agentTaskCount: agentTask,
    agentTaskRatio: Number(agentRatio.toFixed(4)),
    collapsedToAgentTask: total > 0 && agentRatio >= 0.8,
    note:
      total === 0
        ? "no trajectories"
        : agentRatio >= 0.8
          ? "classifier appears collapsed toward agent/task on most captures"
          : "task_type distribution has meaningful spread (or smoke scenarios forced types)",
  };
}

function buildOperatorSnapshot(sekb, store, flags) {
  if (!sekb?.buildSekbOperatorReport) {
    return {
      state: "unavailable",
      reason: "buildSekbOperatorReport_missing",
    };
  }
  try {
    const report = sekb.buildSekbOperatorReport(store, {
      shadowEvaluationEnabled: flags?.shadowEvaluation?.enabled === true,
      batchDistillationAssistantEnabled: flags?.batchDistillationAssistant?.enabled === true,
    });
    return {
      state: report?.evidence?.state || "unknown",
      counts: report?.counts || null,
      shadow: report?.evidence?.shadow || null,
      batch: report?.evidence?.batchDistillationAssistant || null,
      honestStatesAllowed: ["disabled", "unavailable", "unknown", "insufficient_data", "ready"],
    };
  } catch (error) {
    return {
      state: "unknown",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

function readinessForTierC(analysis, flags, privacy, exportCount) {
  const blockers = [];
  const warnings = [];

  if (!flags?.enabled) {
    blockers.push("sekb_master_flag_not_enabled_for_grayscale");
  }
  if (analysis.sekbTrajectoryCount < 100) {
    blockers.push("trajectory_count_below_100_recommended_floor");
  }
  if (analysis.sekbTrajectoryCount < 200) {
    warnings.push("trajectory_count_below_200_human_dual_review_target");
  }
  if (exportCount !== analysis.sekbTrajectoryCount) {
    blockers.push("export_count_mismatch_vs_sqlite");
  }
  if (!privacy.ok) {
    blockers.push("privacy_export_checks_failed");
  }
  if (analysis.shadow.metadataBytes.over2KiB > 0) {
    blockers.push("shadow_metadata_exceeds_2kib");
  }
  if ((analysis.batchDistillationEventCount || 0) > 0) {
    warnings.push("batch_distillation_events_present_unexpected_for_tier_b");
  }
  if (analysis.shadow.retainRatio > 0.95 && analysis.sekbTrajectoryCount >= 20) {
    warnings.push("very_high_retain_ratio_expected_because_capture_value_neq_task_success");
  }

  return {
    tierCTrafficStabilityReady: blockers.length === 0,
    blockers,
    warnings,
    note:
      blockers.length === 0
        ? "Traffic/stability premises for Tier C dual-review campaign look acceptable; human dual review still required and promotion remains deferred."
        : "Not ready to enter Tier C dual-review campaign until blockers are cleared.",
    explicitNonGoals: [
      "No fabricated human dual-review labels",
      "No Shadow V1 retune",
      "No Phase C/D activation",
      "No automatic principle writes",
      "No production benefit claim from grayscale alone",
    ],
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  mkdirSync(artifactDir, { recursive: true });
  mkdirSync(path.join(artifactDir, "runs"), { recursive: true });

  const stateDir = resolveElectronStateDir();
  if (stateDir && !process.env.OPENCLAW_STATE_DIR) {
    process.env.OPENCLAW_STATE_DIR = stateDir;
  }
  const dbPath = path.join(process.env.OPENCLAW_STATE_DIR || "", "state", "openclaw.sqlite");

  const runId = `b-gray-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const runDir = path.join(artifactDir, "runs", runId);
  mkdirSync(runDir, { recursive: true });
  const startedAt = nowIso();

  // Inventory only (must not enable).
  const inventoryOut = runNode(enableScript, [], process.env);
  const inventoryJson = JSON.parse(inventoryOut.stdout);

  const flagsInfo = readSekbFlags(process.env.OPENCLAW_STATE_DIR);
  const analysis = analyzeDb(dbPath);

  let exportMeta = null;
  let protocolMeta = null;
  let exportArtifact = null;
  let protocolArtifact = null;
  let reportArtifact = null;
  const key =
    options.key ||
    `local-b-gray-${createHash("sha256").update(runId).digest("hex").slice(0, 24)}`;

  if (!options.skipExport) {
    if (!existsSync(sekbDist)) {
      throw new Error(`Missing SEKB dist at ${sekbDist}. Build with: pnpm exec node scripts/build-openclaw-runtime.mjs --sekb-only`);
    }
    const exportOut = runNode(opsScript, ["export", "--key", key], process.env);
    exportMeta = JSON.parse(exportOut.stdout);
    exportArtifact = readJson(path.join(artifactDir, "shadow-evaluation-export.v1.json"));

    const protocolOut = runNode(
      opsScript,
      ["protocol", "--key", key, "--sample-size", String(options.sampleSize)],
      process.env,
    );
    protocolMeta = JSON.parse(protocolOut.stdout);
    protocolArtifact = readJson(path.join(artifactDir, "shadow-evaluation-review-protocol.v1.json"));

    // Report without fabricating human labels: use empty/unfilled reviews for honest status.
    const reviewsPath = path.join(artifactDir, "shadow-evaluation-reviews.grayscale.v1.json");
    const reviewsFile = {
      schema: "sekb-shadow-evaluation-reviews.v1",
      authority: "offline_evaluation_evidence_not_runtime_source_of_truth",
      labels: ["valuable", "not_valuable", "uncertain"],
      reviewers: ["reviewerA", "reviewerB"],
      notes: [
        "Tier B grayscale observation uses unfilled reviews on purpose.",
        "Do not treat automated smoke labels as human dual review.",
        "evaluable_for_promotion remains false.",
      ],
      labelAuthority: "unfilled_grayscale_observation",
      reviews: [],
    };
    writeJson(reviewsPath, reviewsFile);

    const reportOut = runNode(
      opsScript,
      [
        "report",
        "--reviews",
        reviewsPath,
        "--export",
        path.join(artifactDir, "shadow-evaluation-export.v1.json"),
        "--protocol",
        path.join(artifactDir, "shadow-evaluation-review-protocol.v1.json"),
        "--reviewers",
        "reviewerA,reviewerB",
      ],
      process.env,
    );
    const reportMeta = JSON.parse(reportOut.stdout);
    reportArtifact = {
      meta: reportMeta,
      report: existsSync(path.join(artifactDir, "shadow-evaluation-report.v1.json"))
        ? readJson(path.join(artifactDir, "shadow-evaluation-report.v1.json"))
        : null,
    };
  } else if (existsSync(path.join(artifactDir, "shadow-evaluation-export.v1.json"))) {
    exportArtifact = readJson(path.join(artifactDir, "shadow-evaluation-export.v1.json"));
    exportMeta = { recordCount: exportArtifact.records?.length || 0, reused: true };
  }

  const privacy = privacyCheckExport(exportArtifact || { records: [] });
  const collapse = classifyCollapse(analysis.taskTypeDistribution);
  const exportCount = exportMeta?.recordCount ?? exportArtifact?.records?.length ?? null;
  const countMatch =
    exportCount === null ? null : exportCount === analysis.sekbTrajectoryCount;

  let operatorSnapshot = { state: "unavailable", reason: "sekb_dist_not_loaded" };
  if (existsSync(sekbDist)) {
    const sekb = await import(pathToFileURL(sekbDist).href);
    const store = new sekb.KnowledgeStore({
      database: {
        env: {
          ...process.env,
          OPENCLAW_STATE_DIR: process.env.OPENCLAW_STATE_DIR,
        },
      },
    });
    operatorSnapshot = buildOperatorSnapshot(sekb, store, flagsInfo.sekb);
  }

  const readiness = readinessForTierC(
    analysis,
    flagsInfo.sekb,
    privacy,
    exportCount ?? -1,
  );

  const findings = [];
  if (countMatch === false) {
    findings.push({
      severity: "P0",
      id: "host_export_sqlite_count_mismatch",
      detail: {
        sqlite: analysis.sekbTrajectoryCount,
        export: exportCount,
        stateDir: process.env.OPENCLAW_STATE_DIR,
      },
      blocksTierC: true,
    });
  }
  for (const f of privacy.findings) {
    findings.push({ ...f, blocksTierC: f.severity === "P0" });
  }
  if (analysis.shadow.metadataBytes.over2KiB > 0) {
    findings.push({
      severity: "P0",
      id: "shadow_metadata_over_2kib",
      count: analysis.shadow.metadataBytes.over2KiB,
      maxBytes: analysis.shadow.metadataBytes.max,
      blocksTierC: true,
    });
  }
  if (collapse.collapsedToAgentTask) {
    findings.push({
      severity: "P1",
      id: "task_type_collapsed_to_agent_task",
      detail: collapse,
      blocksTierC: false,
      note: "Does not block dual-review campaign start, but harms stratified sampling quality.",
    });
  }
  if (analysis.shadow.retainRatio >= 0.9 && analysis.sekbTrajectoryCount >= 20) {
    findings.push({
      severity: "P1",
      id: "high_shadow_retain_ratio",
      retainRatio: analysis.shadow.retainRatio,
      blocksTierC: false,
      note: "Expected while capture value != task success; do not retune Shadow V1 threshold in Tier B.",
    });
  }
  // home vs electron path drift advisory
  const homeInv = inventoryJson.inventory?.find((x) => x.label === "home-openclaw");
  const electronInv = inventoryJson.inventory?.find((x) => x.label === "electron-source-state");
  if (
    homeInv?.exists &&
    electronInv?.exists &&
    (homeInv.counts?.sekb_trajectories || 0) > 0 &&
    homeInv.counts.sekb_trajectories !== electronInv.counts?.sekb_trajectories
  ) {
    findings.push({
      severity: "P1",
      id: "state_dir_split_brain",
      detail: {
        electron: electronInv.counts?.sekb_trajectories,
        home: homeInv.counts?.sekb_trajectories,
      },
      blocksTierC: false,
      note: "Ensure Host/CLI/Gateway share OPENCLAW_STATE_DIR / Electron openclaw-source-state.",
    });
  }
  if (flagsInfo.sekb?.batchDistillationAssistant?.enabled === true) {
    findings.push({
      severity: "P1",
      id: "batch_flag_enabled_during_tier_b",
      blocksTierC: false,
      note: "Tier B keeps batch off; disable nested batchDistillationAssistant.enabled.",
    });
  }

  const status = {
    schema: "sekb-hermes-b-grayscale-observation-status.v1",
    authority: "offline_evaluation_evidence_not_runtime_source_of_truth",
    generatedAt: nowIso(),
    runId,
    phase: "B_grayscale_capture_report_only",
    startedAt,
    finishedAt: nowIso(),
    stateDir: process.env.OPENCLAW_STATE_DIR || null,
    flags: {
      configPath: flagsInfo.path,
      sekb: flagsInfo.sekb,
      masterEnabled: flagsInfo.sekb?.enabled === true,
      shadowEnabled: flagsInfo.sekb?.shadowEvaluation?.enabled === true,
      batchEnabled: flagsInfo.sekb?.batchDistillationAssistant?.enabled === true,
    },
    inventory: {
      sqlite: analysis,
      exportRecordCount: exportCount,
      exportMatchesSqlite: countMatch,
      protocolSampleCount: protocolMeta?.sampleCount ?? protocolArtifact?.sample?.length ?? null,
    },
    distributions: {
      taskType: analysis.taskTypeDistribution,
      contextTags: analysis.contextTagDistribution,
      outcomes: analysis.outcomeDistribution,
      classifierCollapse: collapse,
      shadow: analysis.shadow,
    },
    privacy,
    operatorReport: operatorSnapshot,
    offlineReport: reportArtifact
      ? {
          status: reportArtifact.report?.status || reportArtifact.meta?.status || null,
          promotion: reportArtifact.report?.promotion || reportArtifact.meta?.promotion || null,
        }
      : null,
    promotion: {
      status: "shadow_only",
      evaluableForPromotion: false,
      reason: "tier_b_grayscale_observation_only_human_dual_review_required_for_tier_c",
    },
    readiness,
    findings,
    pipeline: {
      export: "shadow-evaluation-export.v1.json",
      protocol: "shadow-evaluation-review-protocol.v1.json",
      grayscaleReviews: "shadow-evaluation-reviews.grayscale.v1.json",
      report: "shadow-evaluation-report.v1.json",
      status: "grayscale-observation-status.v1.json",
    },
    explicitNonGoals: readiness.explicitNonGoals,
    notes: [
      "Grayscale is opt-in; production default remains off.",
      "Human dual review (Tier C) is still required before any promotion decision.",
      "Shadow V1 threshold frozen at 50; no retune in this phase.",
      "confirm_and_save remains the only durable L2 write path.",
    ],
  };

  if (options.write) {
    const statusPath = path.join(artifactDir, "grayscale-observation-status.v1.json");
    writeJson(statusPath, status);
    writeJson(path.join(runDir, "grayscale-observation-status.v1.json"), status);
    copyIfExists(path.join(artifactDir, "shadow-evaluation-export.v1.json"), path.join(runDir, "shadow-evaluation-export.v1.json"));
    copyIfExists(path.join(artifactDir, "shadow-evaluation-review-protocol.v1.json"), path.join(runDir, "shadow-evaluation-review-protocol.v1.json"));
    copyIfExists(path.join(artifactDir, "shadow-evaluation-report.v1.json"), path.join(runDir, "shadow-evaluation-report.v1.json"));
    writeJson(path.join(runDir, "inventory-snapshot.v1.json"), inventoryJson);

    const md = renderMarkdown(status);
    writeFileSync(path.join(artifactDir, "GRAYSCALE-OBSERVATION.md"), md, "utf8");
    writeFileSync(path.join(runDir, "GRAYSCALE-OBSERVATION.md"), md, "utf8");
  }

  console.log(JSON.stringify({
    authority: status.authority,
    runId,
    trajectoryCount: analysis.sekbTrajectoryCount,
    exportRecordCount: exportCount,
    exportMatchesSqlite: countMatch,
    findings: findings.length,
    tierCTrafficStabilityReady: readiness.tierCTrafficStabilityReady,
    blockers: readiness.blockers,
    statusPath: path.join(artifactDir, "grayscale-observation-status.v1.json"),
  }, null, 2));
}

function copyIfExists(src, dest) {
  if (existsSync(src)) copyFileSync(src, dest);
}

function renderMarkdown(status) {
  const f = status.findings || [];
  const p0 = f.filter((x) => x.severity === "P0");
  const p1 = f.filter((x) => x.severity === "P1");
  return `# SEKB Hermes Tier B Grayscale Observation

- runId: \`${status.runId}\`
- generatedAt: ${status.generatedAt}
- authority: offline evaluation evidence only (not runtime source of truth)
- promotion: **shadow_only** / evaluable_for_promotion=**false**

## Flags
- master enabled: ${status.flags.masterEnabled}
- shadow enabled: ${status.flags.shadowEnabled}
- batch enabled: ${status.flags.batchEnabled} (must stay false in Tier B)
- stateDir: \`${status.stateDir || "(unset)"}\`
- config: \`${status.flags.configPath || "(missing)"}\`

## Inventory
- sqlite trajectories: **${status.inventory.sqlite.sekbTrajectoryCount}**
- export records: **${status.inventory.exportRecordCount}**
- match: **${status.inventory.exportMatchesSqlite}**
- sqlite bytes: ${status.inventory.sqlite.bytes}
- principles: ${status.inventory.sqlite.sekbPrincipleCount}
- batch events: ${status.inventory.sqlite.batchDistillationEventCount}

## Distributions
### task_type
\`\`\`json
${JSON.stringify(status.distributions.taskType, null, 2)}
\`\`\`

### classifier collapse check
\`\`\`json
${JSON.stringify(status.distributions.classifierCollapse, null, 2)}
\`\`\`

### shadow scores
\`\`\`json
${JSON.stringify(status.distributions.shadow, null, 2)}
\`\`\`

## Privacy
- ok: **${status.privacy.ok}**
- sample keys: ${(status.privacy.sampleKeys || []).join(", ")}

## Operator report
- evidence state: **${status.operatorReport?.state || "unknown"}**

## Offline report (unfilled grayscale reviews)
\`\`\`json
${JSON.stringify(status.offlineReport, null, 2)}
\`\`\`

## Findings
### P0 (${p0.length})
${p0.length ? p0.map((x) => `- \`${x.id}\`: ${JSON.stringify(x.detail || x)}`).join("\n") : "- none"}

### P1 (${p1.length})
${p1.length ? p1.map((x) => `- \`${x.id}\`: ${x.note || JSON.stringify(x.detail || x)}`).join("\n") : "- none"}

## Tier C readiness (traffic/stability only)
- ready: **${status.readiness.tierCTrafficStabilityReady}**
- blockers: ${status.readiness.blockers.length ? status.readiness.blockers.join(", ") : "none"}
- warnings: ${status.readiness.warnings.length ? status.readiness.warnings.join(", ") : "none"}
- note: ${status.readiness.note}

## Explicit non-goals
${status.explicitNonGoals.map((x) => `- ${x}`).join("\n")}
`;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
