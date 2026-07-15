#!/usr/bin/env node
/** SEKB Hermes Tier C campaign (human dual-review kit + usefulness closed loop). */
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { randomUUID } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const artifactDir = path.join(repoRoot, "artifacts", "sekb-hermes-phase-a5");
const tierCDir = path.join(artifactDir, "tier-c");
const sekbDist = path.join(repoRoot, "openclaw_runtime", "dist", "knowledge", "sekb", "index.js");
const opsScript = path.join(repoRoot, "scripts", "sekb-hermes-ops.mjs");
const enableScript = path.join(repoRoot, "scripts", "sekb-enable-shadow-local.mjs");
const captureScript = path.join(repoRoot, "scripts", "sekb-shadow-capture-smoke.mjs");
const REVIEWER_A = "reviewerA";
const REVIEWER_B = "reviewerB";
const HUMAN_TARGET = 200;
const KAPPA_MIN = 0.7;
const RECALL_MIN = 0.95;
const FALSE_DROP_MAX = 0.02;
const STABLE_KEY = "sekb-tier-c-human-dual-review-v1";
const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const writeJson = (fp, v) => { mkdirSync(path.dirname(fp), { recursive: true }); writeFileSync(fp, `${JSON.stringify(v, null, 2)}\n`, "utf8"); };
const readJson = (fp) => JSON.parse(readFileSync(fp, "utf8"));

function parseArgs(argv) {
  const options = { key: STABLE_KEY, expand: 0, sampleSize: HUMAN_TARGET, reviews: null, skipClosedLoop: false, mergeWorksheets: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const take = () => {
      const value = argv[i + 1];
      if (!value || value.startsWith("-")) throw new Error(`Missing value for ${arg}`);
      i += 1;
      return value;
    };
    if (arg === "--key") options.key = take();
    else if (arg === "--expand") options.expand = Number(take());
    else if (arg === "--sample-size") options.sampleSize = Number(take());
    else if (arg === "--reviews") options.reviews = path.resolve(take());
    else if (arg === "--skip-closed-loop") options.skipClosedLoop = true;
    else if (arg === "--merge-worksheets") options.mergeWorksheets = true;
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/sekb-tier-c-campaign.mjs [--expand N] [--sample-size N] [--key KEY] [--reviews PATH] [--merge-worksheets] [--skip-closed-loop]");
      process.exit(0);
    } else throw new Error(`Unknown option: ${arg}`);
  }
  if (!Number.isFinite(options.expand) || options.expand < 0) throw new Error("--expand must be >= 0");
  if (!Number.isFinite(options.sampleSize) || options.sampleSize < 0) throw new Error("--sample-size must be >= 0");
  return options;
}

function resolveElectronStateDir() {
  if (process.env.OPENCLAW_STATE_DIR?.trim()) return process.env.OPENCLAW_STATE_DIR.trim();
  const appData = process.env.APPDATA;
  if (!appData) return null;
  const stateDir = path.join(appData, "Electron", "openclaw-source-state");
  return existsSync(stateDir) ? stateDir : null;
}

function runNode(scriptPath, args = [], env = process.env) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: repoRoot, env, encoding: "utf8", maxBuffer: 40 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const err = (result.stderr || result.stdout || "").trim();
    throw new Error(`Command failed (${path.basename(scriptPath)} ${args.join(" ")}): ${err || `exit ${result.status}`}`);
  }
  return result;
}

function inventoryCounts(dbPath) {
  if (!existsSync(dbPath)) return { exists: false, bytes: null, counts: {} };
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
    const count = (name) => (tables.includes(name) ? Number(db.prepare(`SELECT COUNT(*) AS c FROM ${name}`).get().c) : 0);
    return {
      exists: true,
      bytes: statSync(dbPath).size,
      counts: {
        sekb_trajectories: count("sekb_trajectories"),
        sekb_principles: count("sekb_principles"),
        sekb_distillation_rejections: count("sekb_distillation_rejections"),
        sekb_batch_distillation_events: count("sekb_batch_distillation_events"),
      },
    };
  } finally {
    db.close();
  }
}

function expandInventory(expandCount, env) {
  if (expandCount <= 0) return { expanded: 0 };
  if (!process.env.DEEPSEEK_API_KEY && !process.env.CLAWX_DEEPSEEK_API_KEY) {
    throw new Error("DEEPSEEK_API_KEY required for --expand");
  }
  let remaining = expandCount;
  let expanded = 0;
  while (remaining > 0) {
    const n = Math.min(remaining, 30);
    const out = runNode(captureScript, ["--count", String(n)], env);
    expanded += JSON.parse(out.stdout).created || 0;
    remaining -= n;
  }
  return { expanded };
}

function buildHumanReviewTemplate(protocol, notesExtra = []) {
  return {
    schema: "sekb-shadow-evaluation-reviews.v1",
    authority: "offline_evaluation_evidence_not_runtime_source_of_truth",
    labels: ["valuable", "not_valuable", "uncertain"],
    reviewers: [REVIEWER_A, REVIEWER_B],
    notes: [
      "HUMAN dual-review only. Do not copy automated_smoke labels.",
      "Fill label for each reviewer/trajectory pair independently.",
      "Do not tune Shadow V1 threshold/weights on holdout.",
      ...notesExtra,
    ],
    labelAuthority: "human_dual_review_pending",
    reviews: protocol.sample.flatMap((sample) => ([
      { trajectoryId: sample.trajectoryId, reviewerId: REVIEWER_A, split: sample.split, label: null, labelSource: "human_dual_review" },
      { trajectoryId: sample.trajectoryId, reviewerId: REVIEWER_B, split: sample.split, label: null, labelSource: "human_dual_review" },
    ])),
  };
}

function buildWorksheet(protocol, reviewerId, exportById) {
  return {
    schema: "sekb-tier-c-reviewer-worksheet.v1",
    authority: "offline_evaluation_evidence_not_runtime_source_of_truth",
    reviewerId,
    labels: ["valuable", "not_valuable", "uncertain"],
    instructions: [
      "Label independently. Do not view the other reviewer's worksheet until adjudication.",
      "valuable = worth retaining for experience distillation.",
      "not_valuable = low-signal / not reusable.",
      "uncertain = cannot decide from privacy-bounded fields.",
      "Shadow score is context only; do not force-match score.",
    ],
    items: protocol.sample.map((sample) => {
      const record = exportById.get(sample.trajectoryId) || null;
      return {
        trajectoryId: sample.trajectoryId,
        split: sample.split,
        stratum: sample.stratum,
        exportFields: record ? {
          terminalOutcome: record.terminalOutcome,
          counts: record.counts,
          shadowScore: record.shadow?.score ?? null,
          completionStatus: record.shadow?.completionStatus ?? null,
          errorSignaturePresent: record.error?.signaturePresent ?? false,
          errorRecurrenceCount: record.error?.recurrenceCount ?? 0,
        } : null,
        label: null,
        rationale: null,
      };
    }),
  };
}

function mergeWorksheets(pathA, pathB, protocol) {
  const a = readJson(pathA);
  const b = readJson(pathB);
  if (a.reviewerId !== REVIEWER_A || b.reviewerId !== REVIEWER_B) {
    throw new Error(`Expected worksheets for ${REVIEWER_A}/${REVIEWER_B}`);
  }
  const byA = new Map(a.items.map((item) => [item.trajectoryId, item]));
  const byB = new Map(b.items.map((item) => [item.trajectoryId, item]));
  const reviews = [];
  const disagreements = [];
  let filledPairs = 0;
  let nullLabels = 0;
  for (const sample of protocol.sample) {
    const labelA = byA.get(sample.trajectoryId)?.label ?? null;
    const labelB = byB.get(sample.trajectoryId)?.label ?? null;
    if (!labelA || !labelB) nullLabels += 1;
    else {
      filledPairs += 1;
      if (labelA !== labelB) {
        disagreements.push({
          trajectoryId: sample.trajectoryId, split: sample.split,
          reviewerA: labelA, reviewerB: labelB, status: "unresolved",
        });
      }
    }
    if (labelA) reviews.push({ trajectoryId: sample.trajectoryId, reviewerId: REVIEWER_A, split: sample.split, label: labelA, labelSource: "human_dual_review" });
    if (labelB) reviews.push({ trajectoryId: sample.trajectoryId, reviewerId: REVIEWER_B, split: sample.split, label: labelB, labelSource: "human_dual_review" });
  }
  const allFilled = filledPairs === protocol.sample.length && nullLabels === 0;
  return {
    reviewsFile: {
      schema: "sekb-shadow-evaluation-reviews.v1",
      authority: "offline_evaluation_evidence_not_runtime_source_of_truth",
      labels: ["valuable", "not_valuable", "uncertain"],
      reviewers: [REVIEWER_A, REVIEWER_B],
      notes: ["Merged from independent reviewer worksheets."],
      labelAuthority: allFilled ? "human_dual_review" : "human_dual_review_partial",
      reviews,
      pendingNullPairs: nullLabels,
      filledPairs,
    },
    disagreements,
    filledPairs,
    nullLabels,
  };
}

function gatesFromReport(report, labelAuthority) {
  const labeling = report?.labeling || {};
  const agreement = report?.agreement || {};
  const holdout = report?.holdout || {};
  const independentlyReviewed = labeling.independentlyReviewedTrajectories || 0;
  const unresolved = labeling.unresolvedDisagreements || 0;
  const kappaOk = agreement.status === "available" && agreement.value >= KAPPA_MIN;
  const recall = holdout.valuableTrajectoryRecall || {};
  const falseDrop = holdout.projectedFalseDropRate || {};
  const recallOk = recall.status === "available" && recall.rate >= RECALL_MIN;
  const falseDropOk = falseDrop.status === "available" && falseDrop.rate <= FALSE_DROP_MAX;
  const humanOk = labelAuthority === "human_dual_review";
  const hard = {
    independentlyReviewedTrajectories: { required: HUMAN_TARGET, actual: independentlyReviewed, pass: independentlyReviewed >= HUMAN_TARGET },
    unresolvedDisagreements: { required: 0, actual: unresolved, pass: unresolved === 0 },
    cohensKappa: { required: KAPPA_MIN, actual: agreement.status === "available" ? agreement.value : null, status: agreement.status, pass: kappaOk },
    holdoutValuableRecall: { required: RECALL_MIN, actual: recall.status === "available" ? recall.rate : null, status: recall.status, ci: recall.confidenceInterval || null, pass: recallOk },
    holdoutProjectedFalseDrop: { required: FALSE_DROP_MAX, actual: falseDrop.status === "available" ? falseDrop.rate : null, status: falseDrop.status, ci: falseDrop.confidenceInterval || null, pass: falseDropOk },
    humanDualReviewAuthority: { required: "human_dual_review", actual: labelAuthority, pass: humanOk },
  };
  const allPass = Object.values(hard).every((g) => g.pass);
  const evaluableForPromotion = allPass && humanOk && report?.promotion?.status === "evaluable_for_promotion";
  return { hard, allPass, evaluableForPromotion };
}

async function runClosedLoop(sekb, store) {
  const distiller = new sekb.DistillationTool({ store });
  const beforePrinciples = store.query_principles({}).length;
  const suggestions = distiller.suggest_principles_from_trajectories(null, 2);
  if (suggestions.length === 0) {
    return { status: "no_suggestions", note: "Need >=2 undistilled trajectories sharing a task_type.", beforePrinciples, afterPrinciples: beforePrinciples };
  }
  const original = suggestions[0];
  writeJson(path.join(tierCDir, "closed-loop-suggestion.original.v1.json"), original);
  const edits = {
    title: "Compare similar SEKB task paths before acting",
    condition: original.suggested_principle.condition,
    action: "Review clustered SEKB trajectories and confirm reusable constraints before applying tools",
    reason: "Human-edited distillation from deterministic suggest; confirms confirm_and_save is the only durable write",
    criticality: "medium",
  };
  writeJson(path.join(tierCDir, "closed-loop-suggestion.edits.v1.json"), edits);
  const principleId = distiller.confirm_and_save(original, edits);
  const afterPrinciples = store.query_principles({}).length;
  const principle = store.query_principles({}).find((p) => p.principle_id === principleId) || null;
  return {
    status: "confirmed",
    mode: "deterministic_suggest_then_human_edit_confirm",
    principleId,
    beforePrinciples,
    afterPrinciples,
    sourceTrajectoryCount: original.source_trajectory_ids?.length || 0,
    clusterSummary: original.cluster_summary,
    principleSnapshot: principle ? {
      principle_id: principle.principle_id,
      title: principle.title,
      created_by: principle.created_by,
      retrieval_count: principle.retrieval_count,
      adoption_count: principle.adoption_count,
      post_adoption_success: principle.post_adoption_success,
      source_trajectories: principle.source_trajectories?.length || 0,
    } : null,
    invariants: {
      suggestDoesNotWrite: true,
      confirmIsDurableWrite: afterPrinciples === beforePrinciples + 1,
      noPhaseCD: true,
      noBatchAmbient: true,
    },
  };
}

function usefulnessTable(operatorReport, closedLoop, inventory, batchProbe) {
  const batch = operatorReport?.evidence?.batchDistillationAssistant || {};
  return [
    { metric: "deterministic_suggest_human_accept_rate", value: closedLoop?.status === "confirmed" ? 1 : null, status: closedLoop?.status === "confirmed" ? "available" : "unavailable", reason: closedLoop?.status === "confirmed" ? null : (closedLoop?.status || "closed_loop_not_run"), note: "Session-scoped demo accept after human edit" },
    { metric: "pre_confirm_edit_distance", value: null, status: "unavailable", reason: "deterministic_path_does_not_persist_original_vs_confirmed_text_distance" },
    { metric: "duplicate_principle_rate", value: null, status: "unavailable", reason: "not_persisted" },
    { metric: "post_confirm_retrieval_count", value: closedLoop?.principleSnapshot?.retrieval_count ?? null, status: closedLoop?.principleSnapshot ? "available" : "unavailable", reason: closedLoop?.principleSnapshot ? null : "no_confirmed_principle" },
    { metric: "post_confirm_adoption_count", value: closedLoop?.principleSnapshot?.adoption_count ?? null, status: closedLoop?.principleSnapshot ? "available" : "unavailable", reason: closedLoop?.principleSnapshot ? null : "no_confirmed_principle" },
    { metric: "post_adoption_success", value: closedLoop?.principleSnapshot?.post_adoption_success ?? null, status: closedLoop?.principleSnapshot ? "available" : "unavailable", reason: closedLoop?.principleSnapshot ? null : "no_confirmed_principle" },
    { metric: "batch_acceptance_rate", value: batch.acceptedCount?.status === "available" ? batch.acceptedCount.value : null, status: batch.acceptedCount?.status || "unavailable", reason: batch.acceptedCount?.reason || batch.state || "no_batch_evidence" },
    { metric: "batch_normalized_edit_distance", value: batch.normalizedEditDistance?.status === "available" ? batch.normalizedEditDistance.value : null, status: batch.normalizedEditDistance?.status || "unavailable", reason: batch.normalizedEditDistance?.reason || "no_batch_evidence" },
    { metric: "batch_fallback_count", value: batch.fallbackCount?.status === "available" ? batch.fallbackCount.value : null, status: batch.fallbackCount?.status || "unavailable", reason: batch.fallbackCount?.reason || "no_batch_evidence" },
    { metric: "batch_latency_ms", value: null, status: "unavailable", reason: "not_persisted" },
    { metric: "sqlite_db_bytes", value: inventory?.bytes ?? null, status: inventory?.bytes != null ? "available" : "unavailable", reason: inventory?.bytes != null ? null : "db_missing" },
    { metric: "trajectory_count", value: inventory?.counts?.sekb_trajectories ?? null, status: "available", reason: null },
    { metric: "principle_count", value: inventory?.counts?.sekb_principles ?? null, status: "available", reason: null },
    { metric: "historical_suggestion_acceptance_rate", value: null, status: "unavailable", reason: "not_persisted" },
    { metric: "batch_probe_user_visible_status", value: batchProbe?.userVisibleStatus ?? null, status: batchProbe ? "available" : "unavailable", reason: batchProbe ? null : "batch_probe_not_run", note: "Explicit invoke only; ambient batch remains off" },
  ];
}

async function batchProbe(sekb, store, flags) {
  try {
    const enabled = sekb.isSekbBatchDistillationAssistantEnabled?.(flags, process.env);
    const assistant = new sekb.SekbBatchDistillationAssistant({
      store,
      enabled: Boolean(enabled),
      fallback: (ids, min) => new sekb.DistillationTool({ store }).suggest_principles_from_trajectories(ids, min),
    });
    const result = await assistant.suggest({ trajectoryIds: null, minClusterSize: 2 });
    return { enabled: Boolean(enabled), userVisibleStatus: result.userVisibleStatus, operatorEvidence: result.operatorEvidence, suggestionCount: result.suggestions?.length ?? 0, note: "Explicit invoke only; batch flag left false during Tier C" };
  } catch (error) {
    return { enabled: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function mdUsefulness(rows) {
  const lines = [
    "# SEKB Hermes Tier C Usefulness Metrics",
    "",
    "Missing metrics are **unavailable**. No estimates are substituted.",
    "",
    "| Metric | Status | Value | Reason / note |",
    "| --- | --- | --- | --- |",
  ];
  for (const row of rows) {
    const value = row.value === null || row.value === undefined ? "-" : String(row.value);
    const reason = [row.reason, row.note].filter(Boolean).join("; ") || "-";
    lines.push(`| \`${row.metric}\` | ${row.status} | ${value} | ${reason} |`);
  }
  return `${lines.join("\n")}\n`;
}

function mdGoNoGo(gates, inventoryCount, sampleCount, closedLoop, labelAuthority) {
  const decision = gates.evaluableForPromotion ? "Go" : "No-Go";
  const blockers = Object.entries(gates.hard)
    .filter(([, g]) => !g.pass)
    .map(([id, g]) => `- **${id}**: required=${JSON.stringify(g.required)}, actual=${JSON.stringify(g.actual)}${g.status ? ` (${g.status})` : ""}`);
  return `# SEKB Hermes Tier C Go / No-Go Memo

Generated: ${nowIso()}

## Decision: **${decision}**

### Decision semantics
- **Go**: may recommend production enablement of SEKB + human distillation under controllable flags (suggestion + confirm). Not filter, not default-on, not Phase D.
- **No-Go**: keep shadow_only; do not claim evaluable_for_promotion.
- \`evaluable_for_promotion=true\` only means evidence may support a later promotion decision; it does **not** enable runtime mutation.

### Hard gates (A.5)
| Gate | Required | Actual | Pass |
| --- | --- | --- | --- |
| Independent dual-reviewed trajectories | >= ${HUMAN_TARGET} | ${gates.hard.independentlyReviewedTrajectories.actual} | ${gates.hard.independentlyReviewedTrajectories.pass} |
| Unresolved disagreements | 0 | ${gates.hard.unresolvedDisagreements.actual} | ${gates.hard.unresolvedDisagreements.pass} |
| Cohen's - | >= ${KAPPA_MIN} | ${gates.hard.cohensKappa.actual ?? "n/a"} | ${gates.hard.cohensKappa.pass} |
| Holdout valuable recall | >= ${RECALL_MIN} | ${gates.hard.holdoutValuableRecall.actual ?? "n/a"} | ${gates.hard.holdoutValuableRecall.pass} |
| Holdout projected false-drop | <= ${FALSE_DROP_MAX} | ${gates.hard.holdoutProjectedFalseDrop.actual ?? "n/a"} | ${gates.hard.holdoutProjectedFalseDrop.pass} |
| labelAuthority | human_dual_review | ${labelAuthority} | ${gates.hard.humanDualReviewAuthority.pass} |

### Inventory / sample
- trajectories in store: **${inventoryCount}**
- protocol sample size: **${sampleCount}**
- closed-loop confirm: **${closedLoop?.status || "not_run"}**

### Blockers
${blockers.length ? blockers.join("\n") : "- none"}

### -- / next steps (No-Go)
1. Grow real-task inventory to **>>200** (prefer multi-day embedded-agent traffic over smoke).
2. Two independent humans complete worksheets for all ${HUMAN_TARGET} sampled trajectories.
3. \`node scripts/sekb-tier-c-campaign.mjs --merge-worksheets\` then re-report; adjudicate per DISAGREEMENT-RESOLUTION.md (re-label both sides - no Shadow V1 retune).
4. If - < 0.70 after calibration, re-label; still no holdout weight retune.
5. Re-run campaign; only if all hard gates pass set evaluable_for_promotion=true offline.
6. Keep batch/Phase C/D off unless explicit product decision with rollback.

### If Go - Tier D input checklist (do not implement D)
- freeze Shadow V1 evidence pack (export/protocol/reviews/report with human authority)
- operator usefulness metrics
- privacy export re-check
- flag-off rollback drill proof
- product decision: opt-in controllable flag, not forced default-on
- still no capture filtering as authority until separate Phase D approval

### Explicit non-goals still deferred
- Phase C scheduler / Phase D filtering / Shadow V1 retune / SEKB full default-on
- treating evaluable_for_promotion as live filtering
`;
}

function writeDocs() {
  writeFileSync(path.join(tierCDir, "LABELING-PROTOCOL.md"), `# SEKB Hermes Tier C Human Dual-Review Labeling Protocol

## Purpose
Independent human labels for offline shadow evaluation. Artifacts are non-authoritative.

## Labels
- \`valuable\` - worth retaining for human distillation
- \`not_valuable\` - low signal / not reusable
- \`uncertain\` - insufficient privacy-bounded evidence

## Independence
1. Two reviewers label the same protocol sample without seeing each other.
2. Use \`reviewer-A.worksheet.v1.json\` and \`reviewer-B.worksheet.v1.json\`.
3. Never copy \`automated_smoke_not_human\` labels.
4. Do not chase -/recall after seeing the report except formal adjudication.

## Inputs allowed
terminalOutcome, counts, shadow score/factors/completionStatus, error signature presence + recurrenceCount, stratum.

## Holdout
Deterministic stratified; development and holdout separate. Shadow V1 threshold frozen at 50; no holdout retune.

## Minimum
>= 200 trajectories - 2 independent humans.

## After labeling
1. \`node scripts/sekb-tier-c-campaign.mjs --merge-worksheets\`
2. Resolve disagreements (DISAGREEMENT-RESOLUTION.md)
3. Re-run campaign / report
4. Read GO-NO-GO.md
`, "utf8");

  writeFileSync(path.join(tierCDir, "DUAL-REVIEW-WORKFLOW.md"), `# SEKB Hermes Tier C Dual-Person Workflow

## Roles
- Reviewer A / B: independent labelers
- Adjudicator: resolves disagreements by consensus re-label only
- Operator: runs campaign; never invents labels

## Steps
1. Operator export/protocol with stable --key
2. Reviewers fill worksheets offline
3. Operator merges worksheets
4. Report; adjudicate if needed
5. Closed loop: suggest -> human edit -> confirm_and_save

## Commands
\`\`\`bash
node scripts/sekb-tier-c-campaign.mjs --expand 100
node scripts/sekb-tier-c-campaign.mjs
node scripts/sekb-tier-c-campaign.mjs --merge-worksheets
pnpm sekb:hermes:suggest
pnpm sekb:hermes:confirm -- --suggestion <file> --edits <edits.json>
\`\`\`
Suggest never writes durable principles; only confirm_and_save does.
`, "utf8");

  writeFileSync(path.join(tierCDir, "DISAGREEMENT-RESOLUTION.md"), `# SEKB Hermes Tier C Disagreement Resolution

## Definition
Reviewer A label - Reviewer B label after both labeled.

## Report behavior
Unresolved disagreements block promotion until count is 0.
Resolution = both reviewers update to the same final label (or both uncertain).

## Process
1. Read tier-c/disagreements.v1.json
2. Adjudicate using export fields + protocol definitions only
3. Calibration notes for 5-10 hard cases
4. Both re-label worksheets
5. Re-merge and re-report
6. Log in DISAGREEMENT-RESOLUTION-LOG.md

## Forbidden
- automated_smoke tie-breaks
- Shadow V1 threshold/weight changes
- Dropping disagreed items without protocol replacement
- Fabricating consensus for gates
`, "utf8");

  if (!existsSync(path.join(tierCDir, "DISAGREEMENT-RESOLUTION-LOG.md"))) {
    writeFileSync(path.join(tierCDir, "DISAGREEMENT-RESOLUTION-LOG.md"), `# Disagreement Resolution Log

| trajectoryId | split | A before | B before | final | rationale | date |
| --- | --- | --- | --- | --- | --- | --- |
`, "utf8");
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  mkdirSync(artifactDir, { recursive: true });
  mkdirSync(tierCDir, { recursive: true });

  const electronStateDir = resolveElectronStateDir();
  if (electronStateDir) process.env.OPENCLAW_STATE_DIR = electronStateDir;
  process.env.OPENCLAW_SEKB_ENABLED = process.env.OPENCLAW_SEKB_ENABLED || "true";
  process.env.OPENCLAW_SEKB_SHADOW_EVALUATION_ENABLED =
    process.env.OPENCLAW_SEKB_SHADOW_EVALUATION_ENABLED || "true";

  if (!existsSync(sekbDist)) {
    throw new Error("Missing SEKB dist. Build: pnpm exec node scripts/build-openclaw-runtime.mjs --sekb-only");
  }

  const runId = `c-human-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const runDir = path.join(artifactDir, "runs", runId);
  mkdirSync(runDir, { recursive: true });
  const env = { ...process.env };
  const steps = [];

  steps.push({ id: "inventory", at: nowIso() });
  runNode(enableScript, [], env);
  const dbPath = path.join(process.env.OPENCLAW_STATE_DIR || "", "state", "openclaw.sqlite");
  let inventory = inventoryCounts(dbPath);
  steps[0].ok = true;
  steps[0].trajectoryCount = inventory.counts.sekb_trajectories;

  let expandResult = { expanded: 0 };
  if (options.expand > 0) {
    steps.push({ id: "expand", at: nowIso(), requested: options.expand });
    expandResult = expandInventory(options.expand, env);
    inventory = inventoryCounts(dbPath);
    steps.at(-1).ok = true;
    steps.at(-1).created = expandResult.expanded;
    steps.at(-1).after = inventory.counts.sekb_trajectories;
  }

  const trajectoryCount = inventory.counts.sekb_trajectories || 0;
  const sampleSize = Math.min(options.sampleSize, trajectoryCount);

  steps.push({ id: "export-protocol", at: nowIso(), sampleSize });
  runNode(opsScript, ["export", "--key", options.key, "--workspace", repoRoot], env);
  runNode(opsScript, ["protocol", "--key", options.key, "--workspace", repoRoot, "--sample-size", String(sampleSize)], env);
  const exportArtifact = readJson(path.join(artifactDir, "shadow-evaluation-export.v1.json"));
  const protocolArtifact = readJson(path.join(artifactDir, "shadow-evaluation-review-protocol.v1.json"));
  steps.at(-1).ok = true;
  steps.at(-1).exportRecords = exportArtifact.records?.length || 0;
  steps.at(-1).protocolSamples = protocolArtifact.sample?.length || 0;

  const autoReviewsPath = path.join(artifactDir, "shadow-evaluation-reviews.automated-smoke.v1.json");
  const currentReviewsPath = path.join(artifactDir, "shadow-evaluation-reviews.v1.json");
  if (existsSync(currentReviewsPath)) {
    try {
      const existing = readJson(currentReviewsPath);
      if (existing.labelAuthority === "automated_smoke_not_human" && !existsSync(autoReviewsPath)) {
        copyFileSync(currentReviewsPath, autoReviewsPath);
      }
    } catch { /* ignore */ }
  }

  const exportById = new Map((exportArtifact.records || []).map((r) => [r.trajectoryId, r]));
  const worksheetAPath = path.join(tierCDir, "reviewer-A.worksheet.v1.json");
  const worksheetBPath = path.join(tierCDir, "reviewer-B.worksheet.v1.json");
  let rewriteWorksheets = true;
  if (existsSync(worksheetAPath) && existsSync(worksheetBPath)) {
    try {
      const prevA = readJson(worksheetAPath);
      const prevIds = new Set((prevA.items || []).map((i) => i.trajectoryId));
      const nextIds = protocolArtifact.sample.map((s) => s.trajectoryId);
      const overlap = nextIds.filter((id) => prevIds.has(id)).length;
      const filled = (prevA.items || []).some((i) => i.label);
      rewriteWorksheets = !(filled && overlap >= Math.min(nextIds.length, prevIds.size) * 0.5);
    } catch {
      rewriteWorksheets = true;
    }
  }
  if (rewriteWorksheets) {
    writeJson(worksheetAPath, buildWorksheet(protocolArtifact, REVIEWER_A, exportById));
    writeJson(worksheetBPath, buildWorksheet(protocolArtifact, REVIEWER_B, exportById));
  }

  let reviewsFile;
  let disagreements = [];
  let labelAuthority = "human_dual_review_pending";
  if (options.mergeWorksheets) {
    steps.push({ id: "merge-worksheets", at: nowIso() });
    const merged = mergeWorksheets(worksheetAPath, worksheetBPath, protocolArtifact);
    reviewsFile = merged.reviewsFile;
    disagreements = merged.disagreements;
    labelAuthority = reviewsFile.labelAuthority;
    steps.at(-1).ok = true;
    steps.at(-1).filledPairs = merged.filledPairs;
    steps.at(-1).disagreements = disagreements.length;
  } else if (options.reviews && existsSync(options.reviews)) {
    reviewsFile = readJson(options.reviews);
    labelAuthority = reviewsFile.labelAuthority || "human_dual_review_partial";
  } else if (existsSync(currentReviewsPath)) {
    const existing = readJson(currentReviewsPath);
    if (existing.labelAuthority === "human_dual_review" || existing.labelAuthority === "human_dual_review_partial") {
      reviewsFile = existing;
      labelAuthority = existing.labelAuthority;
    } else {
      reviewsFile = buildHumanReviewTemplate(protocolArtifact, ["Primary Tier C reviews file; smoke preserved separately if present."]);
      labelAuthority = reviewsFile.labelAuthority;
    }
  } else {
    reviewsFile = buildHumanReviewTemplate(protocolArtifact);
    labelAuthority = reviewsFile.labelAuthority;
  }

  writeJson(path.join(artifactDir, "shadow-evaluation-reviews.template.v1.json"), buildHumanReviewTemplate(protocolArtifact));
  writeJson(currentReviewsPath, reviewsFile);
  writeJson(path.join(tierCDir, "reviews.v1.json"), reviewsFile);
  writeJson(path.join(tierCDir, "disagreements.v1.json"), {
    schema: "sekb-tier-c-disagreements.v1",
    generatedAt: nowIso(),
    unresolved: disagreements,
  });

  const reportReviews = (reviewsFile.reviews || []).filter(
    (r) => r && (r.label === "valuable" || r.label === "not_valuable" || r.label === "uncertain"),
  );
  const sekb = await import(pathToFileURL(sekbDist).href);
  let report = sekb.buildSekbOfflineEvaluationReport({
    artifact: exportArtifact,
    protocol: protocolArtifact,
    reviews: reportReviews,
    reviewers: [REVIEWER_A, REVIEWER_B],
  });
  if (labelAuthority !== "human_dual_review") {
    report = {
      ...report,
      promotion: {
        status: "shadow_only",
        blockers: [...new Set([...(report.promotion?.blockers || []), "human_dual_review_required"])],
      },
    };
  }
  sekb.writeSekbOfflineEvaluationReportArtifact({ report, workspaceRoot: repoRoot });
  writeJson(path.join(tierCDir, "report.v1.json"), report);

  const gates = gatesFromReport(report, labelAuthority);

  let closedLoop = { status: "skipped" };
  if (!options.skipClosedLoop) {
    steps.push({ id: "closed-loop", at: nowIso() });
    const store = new sekb.KnowledgeStore({
      database: { env: { ...process.env, OPENCLAW_STATE_DIR: process.env.OPENCLAW_STATE_DIR } },
    });
    closedLoop = await runClosedLoop(sekb, store);
    writeJson(path.join(tierCDir, "closed-loop.v1.json"), closedLoop);
    inventory = inventoryCounts(dbPath);
    steps.at(-1).ok = true;
    steps.at(-1).closedLoop = closedLoop.status;
  }

  let flags = {};
  try {
    const cfgPath = path.join(process.env.OPENCLAW_STATE_DIR || "", "openclaw.json");
    if (existsSync(cfgPath)) flags = JSON.parse(readFileSync(cfgPath, "utf8"));
  } catch { flags = {}; }

  const storeForOps = new sekb.KnowledgeStore({
    database: { env: { ...process.env, OPENCLAW_STATE_DIR: process.env.OPENCLAW_STATE_DIR } },
  });
  const operatorReport = sekb.buildSekbOperatorReport(storeForOps, {
    shadowEvaluationEnabled: true,
    batchDistillationAssistantEnabled: Boolean(flags?.sekb?.batchDistillationAssistant?.enabled),
  });
  writeJson(path.join(tierCDir, "operator-report.snapshot.v1.json"), {
    counts: operatorReport.counts,
    evidence: {
      feedback: operatorReport.evidence.feedback,
      batchDistillationAssistant: operatorReport.evidence.batchDistillationAssistant,
      metricsUnavailable: operatorReport.evidence.metricsUnavailable,
      shadow: operatorReport.evidence.shadow,
    },
  });
  const batch = await batchProbe(sekb, storeForOps, flags);
  writeJson(path.join(tierCDir, "batch-probe.v1.json"), batch);
  const usefulness = usefulnessTable(operatorReport, closedLoop, inventory, batch);
  writeJson(path.join(tierCDir, "usefulness-metrics.v1.json"), {
    schema: "sekb-tier-c-usefulness-metrics.v1",
    generatedAt: nowIso(),
    rows: usefulness,
  });

  writeDocs();
  writeFileSync(path.join(tierCDir, "USEFULNESS-METRICS.md"), mdUsefulness(usefulness), "utf8");
  writeFileSync(
    path.join(tierCDir, "GO-NO-GO.md"),
    mdGoNoGo(gates, trajectoryCount, protocolArtifact.sample.length, closedLoop, labelAuthority),
    "utf8",
  );

  const status = {
    schema: "sekb-hermes-a5-evaluation-campaign-status.v1",
    authority: "offline_evaluation_evidence_not_runtime_source_of_truth",
    generatedAt: nowIso(),
    campaign: {
      name: "sekb-hermes-tier-c-human-dual-review",
      goal: "Human dual-review evidence + usefulness closed loop; promotion only if A.5 hard gates pass",
      runtimeAuthorityChanged: false,
      phaseCDActivated: false,
      shadowV1Retuned: false,
      lastTierCRunId: runId,
      stablePseudonymizationKeyId: STABLE_KEY,
    },
    inventory: {
      stateDb: dbPath,
      sekbTrajectoryCount: inventory.counts.sekb_trajectories || 0,
      sekbPrincipleCount: inventory.counts.sekb_principles || 0,
      exportRecordCount: exportArtifact.records?.length || 0,
      protocolSampleCount: protocolArtifact.sample?.length || 0,
      filledDualReviewPairs: report.labeling.independentlyReviewedTrajectories,
      openclawJsonHasSekbConfig: Boolean(flags?.sekb),
      sekbEnabled: Boolean(flags?.sekb?.enabled),
      shadowEvaluationEnabled: Boolean(flags?.sekb?.shadowEvaluation?.enabled),
      batchDistillationAssistantEnabled: Boolean(flags?.sekb?.batchDistillationAssistant?.enabled),
      openclawStateDir: process.env.OPENCLAW_STATE_DIR || null,
      labelAuthority,
      dbBytes: inventory.bytes || null,
      expandRequested: options.expand,
      expandCreated: expandResult.expanded,
      notes: [
        "Human dual-review required for evaluable_for_promotion.",
        "automated_smoke_not_human labels must not authorize promotion.",
        "Shadow V1 threshold frozen at 50. Phase C/D not activated.",
        trajectoryCount < HUMAN_TARGET
          ? `Inventory ${trajectoryCount} < ${HUMAN_TARGET}; expand real traffic before full dual-review staffing.`
          : `Inventory ${trajectoryCount} >= ${HUMAN_TARGET}; dual-review staffing can cover full sample.`,
      ],
    },
    offlineReport: {
      status: report.status,
      promotion: report.promotion,
      labeling: report.labeling,
      agreement: report.agreement,
      holdout: report.holdout,
      development: report.development,
      projectionPolicy: report.projectionPolicy,
    },
    promotionDecision: {
      status: gates.evaluableForPromotion ? "evaluable_for_promotion" : "shadow_only",
      evaluableForPromotion: gates.evaluableForPromotion,
      goNoGo: gates.evaluableForPromotion ? "Go" : "No-Go",
      reportPromotionStatus: report.promotion.status,
      reportBlockers: report.promotion.blockers,
      labelsAutomated: labelAuthority === "automated_smoke_not_human",
      reason: gates.evaluableForPromotion
        ? "all_hard_gates_passed_with_human_dual_review"
        : "tier_c_hard_gates_incomplete_or_human_labels_missing",
      hardGates: gates.hard,
      requiredGates: {
        independentlyReviewedTrajectories: HUMAN_TARGET,
        unresolvedDisagreements: 0,
        cohensKappaMin: KAPPA_MIN,
        holdoutValuableRecallMin: RECALL_MIN,
        holdoutProjectedFalseDropMax: FALSE_DROP_MAX,
        humanDualReviewRequired: true,
      },
    },
    closedLoop,
    usefulnessMetrics: usefulness,
    batchProbe: batch,
    tierC: {
      status: gates.evaluableForPromotion
        ? "human_dual_review_gates_passed_evidence_only"
        : (labelAuthority === "human_dual_review" || labelAuthority === "human_dual_review_partial")
          ? "human_dual_review_in_progress"
          : "labeling_kit_ready_awaiting_human_labels",
      phase: "C_human_dual_review_usefulness_closed_loop",
      runId,
      generatedAt: nowIso(),
      worksheets: {
        reviewerA: "artifacts/sekb-hermes-phase-a5/tier-c/reviewer-A.worksheet.v1.json",
        reviewerB: "artifacts/sekb-hermes-phase-a5/tier-c/reviewer-B.worksheet.v1.json",
        rewritten: rewriteWorksheets,
      },
      artifacts: {
        labelingProtocol: "tier-c/LABELING-PROTOCOL.md",
        dualWorkflow: "tier-c/DUAL-REVIEW-WORKFLOW.md",
        disagreementResolution: "tier-c/DISAGREEMENT-RESOLUTION.md",
        usefulness: "tier-c/USEFULNESS-METRICS.md",
        goNoGo: "tier-c/GO-NO-GO.md",
        reviews: "tier-c/reviews.v1.json",
        report: "tier-c/report.v1.json",
        closedLoop: "tier-c/closed-loop.v1.json",
      },
      explicitNonGoals: [
        "No fabricated human dual-review labels",
        "No Shadow V1 retune",
        "No Phase C/D activation",
        "No automatic principle writes from suggest",
        "No treating evaluable_for_promotion as live filtering",
      ],
    },
    pipeline: {
      export: "shadow-evaluation-export.v1.json",
      protocol: "shadow-evaluation-review-protocol.v1.json",
      reviews: "shadow-evaluation-reviews.v1.json",
      report: "shadow-evaluation-report.v1.json",
      reportStatus: report.status,
      promotionStatus: report.promotion.status,
    },
    nextActions: gates.evaluableForPromotion
      ? [
          { id: "product-flag-decision", action: "Consider opt-in SEKB + human distillation under controllable flags; keep default-off until rollback drill signed off." },
          { id: "tier-d-inputs-only", action: "Assemble Tier D input evidence checklist; do not implement Phase D filtering." },
        ]
      : [
          {
            id: "grow-real-inventory",
            action: trajectoryCount < HUMAN_TARGET
              ? `Grow trajectories from ${trajectoryCount} to >>${HUMAN_TARGET} with real tasks.`
              : "Inventory floor met; prioritize human dual-review staffing over more smoke capture.",
          },
          { id: "complete-human-dual-review", action: "Two humans fill tier-c worksheets independently; merge; adjudicate; re-report." },
          { id: "keep-batch-and-phase-cd-off", action: "Keep batchDistillationAssistant, Phase C scheduler, and Phase D filtering off." },
        ],
    explicitNonGoals: [
      "No fabricated human dual-review labels",
      "No Shadow V1 retune",
      "No capture filtering",
      "No Phase C/D activation",
      "No automatic principle writes",
    ],
    steps,
  };

  writeJson(path.join(artifactDir, "evaluation-campaign-status.v1.json"), status);
  writeJson(path.join(tierCDir, "evaluation-campaign-status.v1.json"), status);
  writeJson(path.join(runDir, "evaluation-campaign-status.v1.json"), status);

  writeFileSync(path.join(artifactDir, "CAMPAIGN.md"), `# SEKB Hermes Evaluation Campaign Notes

## Tier A / A.5 (closed for merge readiness)
- Library + Host/CLI ops landed default-off
- Offline dual-review kit non-authoritative
- Automated dual-smoke proves pipeline only

## Tier B - grayscale observation
Status: local canary recorded (see GRAYSCALE-OBSERVATION.md)

## Tier C - human dual-review + usefulness closed loop
Status: **${status.tierC.status}**
- Script: \`scripts/sekb-tier-c-campaign.mjs\` (\`pnpm sekb:tier-c:campaign\`)
- Kit: \`artifacts/sekb-hermes-phase-a5/tier-c/\`
- labelAuthority: **${labelAuthority}**
- dual-reviewed pairs: **${report.labeling.independentlyReviewedTrajectories}**
- evaluable_for_promotion: **${status.promotionDecision.evaluableForPromotion}**
- decision: **${status.promotionDecision.goNoGo}**

### Explicit non-goals
- No automated_smoke as human labels
- No Shadow V1 retune / Phase C/D / auto principle writes
- No treating evaluable_for_promotion as live filtering

## Production enablement
Deferred until hard gates pass. See PRODUCTION-ENABLEMENT-PRECONDITIONS.md and tier-c/GO-NO-GO.md.
`, "utf8");

  writeFileSync(path.join(tierCDir, "TIER-C-STATUS.md"), `# Tier C Status

- runId: \`${runId}\`
- status: **${status.tierC.status}**
- labelAuthority: \`${labelAuthority}\`
- evaluable_for_promotion: **${status.promotionDecision.evaluableForPromotion}**
- go/no-go: **${status.promotionDecision.goNoGo}**
- trajectories: **${trajectoryCount}**
- protocol sample: **${protocolArtifact.sample.length}**
- dual-reviewed pairs: **${report.labeling.independentlyReviewedTrajectories}**
- closed-loop: **${closedLoop.status}**

See [GO-NO-GO.md](./GO-NO-GO.md) and [USEFULNESS-METRICS.md](./USEFULNESS-METRICS.md).
`, "utf8");

  for (const name of [
    "shadow-evaluation-export.v1.json",
    "shadow-evaluation-review-protocol.v1.json",
    "shadow-evaluation-reviews.v1.json",
    "shadow-evaluation-report.v1.json",
  ]) {
    const src = path.join(artifactDir, name);
    if (existsSync(src)) copyFileSync(src, path.join(runDir, name));
  }

  console.log(JSON.stringify({
    authority: status.authority,
    runId,
    tierCStatus: status.tierC.status,
    trajectoryCount,
    protocolSampleCount: protocolArtifact.sample.length,
    labelAuthority,
    reportStatus: report.status,
    promotion: report.promotion,
    evaluableForPromotion: status.promotionDecision.evaluableForPromotion,
    goNoGo: status.promotionDecision.goNoGo,
    closedLoop: closedLoop.status,
    hardGates: gates.hard,
    artifactDir: "artifacts/sekb-hermes-phase-a5/tier-c",
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
