import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

const repoRoot = process.cwd();
const tierCDir = path.join(repoRoot, "artifacts/sekb-hermes-phase-a5/tier-c");
const sekbDist = path.join(repoRoot, "openclaw_runtime/dist/knowledge/sekb/index.js");
const stateDir =
  process.env.OPENCLAW_STATE_DIR ||
  path.join(process.env.APPDATA, "Electron", "openclaw-source-state");
process.env.OPENCLAW_STATE_DIR = stateDir;
const dbPath = path.join(stateDir, "state", "openclaw.sqlite");

const closedLoop = JSON.parse(
  readFileSync(path.join(tierCDir, "closed-loop.v1.json"), "utf8"),
);
if (closedLoop.status !== "confirmed") {
  throw new Error("expected prior confirmed closed-loop");
}

const sekb = await import(pathToFileURL(sekbDist).href);
const store = new sekb.KnowledgeStore({
  database: { env: { ...process.env, OPENCLAW_STATE_DIR: stateDir } },
});
const operatorReport = sekb.buildSekbOperatorReport(store, {
  includeUnavailable: true,
});
writeFileSync(
  path.join(tierCDir, "operator-report.snapshot.v1.json"),
  `${JSON.stringify(operatorReport, null, 2)}\n`,
);

const db = new DatabaseSync(dbPath, { readOnly: true });
const count = (t) => Number(db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c);
const inventory = {
  exists: true,
  bytes: statSync(dbPath).size,
  counts: {
    sekb_trajectories: count("sekb_trajectories"),
    sekb_principles: count("sekb_principles"),
  },
};
db.close();

const principle =
  store.query_principles({}).find((p) => p.principle_id === closedLoop.principleId) ||
  null;
if (principle) {
  closedLoop.principleSnapshot = {
    principle_id: principle.principle_id,
    title: principle.title,
    created_by: principle.created_by,
    retrieval_count: principle.retrieval_count,
    adoption_count: principle.adoption_count,
    post_adoption_success: principle.post_adoption_success,
    source_trajectories: principle.source_trajectories?.length || 0,
  };
  closedLoop.afterPrinciples = inventory.counts.sekb_principles;
  writeFileSync(
    path.join(tierCDir, "closed-loop.v1.json"),
    `${JSON.stringify(closedLoop, null, 2)}\n`,
  );
}

const batchProbe = JSON.parse(
  readFileSync(path.join(tierCDir, "batch-probe.v1.json"), "utf8"),
);
const batch = operatorReport?.evidence?.batchDistillationAssistant || {};
const rows = [
  {
    metric: "deterministic_suggest_human_accept_rate",
    value: 1,
    status: "available",
    reason: null,
    note: "Session-scoped demo accept after human edit (prior confirmed closed-loop; not re-confirmed this run)",
  },
  {
    metric: "pre_confirm_edit_distance",
    value: null,
    status: "unavailable",
    reason: "deterministic_path_does_not_persist_original_vs_confirmed_text_distance",
  },
  {
    metric: "duplicate_principle_rate",
    value: null,
    status: "unavailable",
    reason: "not_persisted",
  },
  {
    metric: "post_confirm_retrieval_count",
    value: closedLoop?.principleSnapshot?.retrieval_count ?? null,
    status: closedLoop?.principleSnapshot ? "available" : "unavailable",
    reason: closedLoop?.principleSnapshot ? null : "no_confirmed_principle",
  },
  {
    metric: "post_confirm_adoption_count",
    value: closedLoop?.principleSnapshot?.adoption_count ?? null,
    status: closedLoop?.principleSnapshot ? "available" : "unavailable",
    reason: closedLoop?.principleSnapshot ? null : "no_confirmed_principle",
  },
  {
    metric: "post_adoption_success",
    value: closedLoop?.principleSnapshot?.post_adoption_success ?? null,
    status: closedLoop?.principleSnapshot ? "available" : "unavailable",
    reason: closedLoop?.principleSnapshot ? null : "no_confirmed_principle",
  },
  {
    metric: "batch_acceptance_rate",
    value:
      batch.acceptedCount?.status === "available"
        ? batch.acceptedCount.value
        : null,
    status: batch.acceptedCount?.status || "unavailable",
    reason: batch.acceptedCount?.reason || batch.state || "no_batch_evidence",
  },
  {
    metric: "batch_normalized_edit_distance",
    value:
      batch.normalizedEditDistance?.status === "available"
        ? batch.normalizedEditDistance.value
        : null,
    status: batch.normalizedEditDistance?.status || "unavailable",
    reason: batch.normalizedEditDistance?.reason || "no_batch_evidence",
  },
  {
    metric: "batch_fallback_count",
    value:
      batch.fallbackCount?.status === "available"
        ? batch.fallbackCount.value
        : null,
    status: batch.fallbackCount?.status || "unavailable",
    reason: batch.fallbackCount?.reason || "no_batch_evidence",
  },
  {
    metric: "batch_latency_ms",
    value: null,
    status: "unavailable",
    reason: "not_persisted",
  },
  {
    metric: "sqlite_db_bytes",
    value: inventory.bytes,
    status: "available",
    reason: null,
  },
  {
    metric: "trajectory_count",
    value: inventory.counts.sekb_trajectories,
    status: "available",
    reason: null,
  },
  {
    metric: "principle_count",
    value: inventory.counts.sekb_principles,
    status: "available",
    reason: null,
  },
  {
    metric: "historical_suggestion_acceptance_rate",
    value: null,
    status: "unavailable",
    reason: "not_persisted",
  },
  {
    metric: "batch_probe_user_visible_status",
    value: batchProbe?.userVisibleStatus ?? null,
    status: batchProbe ? "available" : "unavailable",
    reason: batchProbe ? null : "batch_probe_not_run",
    note: "Explicit invoke only; ambient batch remains off",
  },
];

const um = {
  schema: "sekb-tier-c-usefulness-metrics.v1",
  generatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  source: "restored_from_prior_confirmed_closed_loop",
  closedLoopPrincipleId: closedLoop.principleId,
  rows,
};
writeFileSync(
  path.join(tierCDir, "usefulness-metrics.v1.json"),
  `${JSON.stringify(um, null, 2)}\n`,
);

const md = [
  "# SEKB Hermes Tier C Usefulness Metrics",
  "",
  "Missing metrics are **unavailable**. No estimates are substituted.",
  "",
  `Restored from prior confirmed closed-loop (\`${closedLoop.principleId}\`); this refresh did not re-run confirm_and_save.`,
  "",
  "| Metric | Status | Value | Reason / note |",
  "| --- | --- | --- | --- |",
];
for (const row of rows) {
  const value =
    row.value === null || row.value === undefined ? "-" : String(row.value);
  const reason = [row.reason, row.note].filter(Boolean).join("; ") || "-";
  md.push(`| \`${row.metric}\` | ${row.status} | ${value} | ${reason} |`);
}
writeFileSync(path.join(tierCDir, "USEFULNESS-METRICS.md"), `${md.join("\n")}\n`);

const statusPath = path.join(tierCDir, "evaluation-campaign-status.v1.json");
const status = JSON.parse(readFileSync(statusPath, "utf8"));
status.closedLoop = closedLoop;
status.usefulnessMetrics = rows;
status.inventory.dbBytes = inventory.bytes;
status.inventory.sekbTrajectoryCount = inventory.counts.sekb_trajectories;
status.inventory.sekbPrincipleCount = inventory.counts.sekb_principles;
if (status.tierC) {
  status.tierC.closedLoopNote =
    "prior confirmed closed-loop retained; skip-closed-loop refresh restored metrics without new durable write";
}
writeFileSync(statusPath, `${JSON.stringify(status, null, 2)}\n`);

const statusMd = `# Tier C Status

- runId: \`${status.tierC?.runId || status.campaign?.lastTierCRunId}\`
- status: **labeling_kit_ready_awaiting_human_labels**
- labelAuthority: \`human_dual_review_pending\`
- evaluable_for_promotion: **false**
- go/no-go: **No-Go**
- trajectories: **${inventory.counts.sekb_trajectories}**
- protocol sample: **200**
- dual-reviewed pairs: **0**
- closed-loop: **confirmed** (prior; metrics restored, no re-confirm)

See [GO-NO-GO.md](./GO-NO-GO.md) and [USEFULNESS-METRICS.md](./USEFULNESS-METRICS.md).
`;
writeFileSync(path.join(tierCDir, "TIER-C-STATUS.md"), statusMd);

let gongo = readFileSync(path.join(tierCDir, "GO-NO-GO.md"), "utf8");
gongo = gongo.replace(
  /closed-loop confirm: \*\*.*\*\*/,
  "closed-loop confirm: **confirmed** (prior; not re-run)",
);
writeFileSync(path.join(tierCDir, "GO-NO-GO.md"), gongo);

// human handoff note
const handoff = `# Tier C Human Dual-Review Handoff

Generated: ${new Date().toISOString().replace(/\\.\\d{3}Z$/, "Z")}

## Operator status (this session)
- Kit ready; **No-Go**
- labelAuthority: \`human_dual_review_pending\`
- dual-reviewed pairs: **0 / 200**
- evaluable_for_promotion: **false**
- Shadow V1 threshold: **frozen 50**
- Phase C/D: **off**
- closed-loop: prior **confirmed** (no new durable write)

## Why labeling was not automated
Operator must **not** invent human labels. Filling worksheets and setting
\`labelAuthority=human_dual_review\` without two independent humans would
violate Tier C hard gates and the campaign explicit non-goal
"No fabricated human dual-review labels".

## Sample composition (privacy-bounded fields only)
| Dimension | Counts |
| --- | --- |
| split | development 160 / holdout 40 |
| terminalOutcome | success 100 / failure 50 / partial 50 |
| toolActivity | none 50 / observed 150 |
| shadowScore stratum | high 200 |
| errorRecurrence | none 150 / recurring 50 |
| numeric shadowScore | 50×51, 75×99, 100×50 (all >= 50) |

## Worksheets
- Reviewer A: \`artifacts/sekb-hermes-phase-a5/tier-c/reviewer-A.worksheet.v1.json\`
- Reviewer B: \`artifacts/sekb-hermes-phase-a5/tier-c/reviewer-B.worksheet.v1.json\`
- 200 items each; all \`label\` / \`rationale\` currently null

## Reviewer instructions (independent)
1. Open only your worksheet.
2. For each item, set \`label\` to \`valuable\` | \`not_valuable\` | \`uncertain\`.
3. Optional one-line \`rationale\`.
4. Allowed fields only: terminalOutcome, counts, shadowScore/completionStatus,
   errorSignaturePresent + errorRecurrenceCount, stratum, split (context only).
5. Do **not** force-match shadow score; do not copy smoke labels; do not look
   at the other worksheet until adjudication.

## After both worksheets are full
\`\`\`bash
pnpm sekb:tier-c:merge
# or: node scripts/sekb-tier-c-campaign.mjs --merge-worksheets --skip-closed-loop
\`\`\`
If \`disagreements.v1.json\` has unresolved items:
1. Consensus re-label both sides (or both uncertain)
2. Log \`DISAGREEMENT-RESOLUTION-LOG.md\`
3. Merge again
4. No auto smoke tie-break, no V1 retune, no dropping samples

## Explicit non-claims
- \`evaluable_for_promotion=true\` (only if all hard gates pass) ≠ production filtering
- D1/D2 runtime mutation still requires a separate approval
- This handoff does **not** authorize Go
`;
writeFileSync(path.join(tierCDir, "HUMAN-LABELING-HANDOFF.md"), handoff);

console.log(
  JSON.stringify(
    {
      restored: true,
      principleId: closedLoop.principleId,
      trajectories: inventory.counts.sekb_trajectories,
      principles: inventory.counts.sekb_principles,
      acceptRate: rows[0].value,
    },
    null,
    2,
  ),
);
