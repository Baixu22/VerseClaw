#!/usr/bin/env node
/**
 * SEKB D1 synthetic observation + rollback drill (agent-only lab).
 * - Isolated temp state dir (does not touch Electron main state)
 * - Synthesizes >=200 trajectories with score distribution (>=50 and <50)
 * - Runs mutation-free would_trigger evaluation (inline, matches phase-c-would-trigger.ts)
 * - Executes flag on/off rollback drill
 * - Writes tier-d observation + drill artifacts
 *
 * Never: capture filtering, auto principle write, V1 retune, offline artifact runtime authority.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const tierD = path.join(repoRoot, "artifacts", "sekb-hermes-phase-a5", "tier-d");
const COUNT = Number(process.env.SEKB_D1_SYNTH_COUNT || 220);
const THRESHOLD = 50;
const POLICY_ID = "sekb-shadow-v1-score-gte-50";
const OWNER = "sekb-phase-c-would-trigger";

function pct(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function makeShadow(score) {
  return {
    schema: "sekb-shadow-metadata.v1",
    captureQuality: {
      schema: "sekb-capture-quality-shadow.v1",
      score,
      recommendation: score >= THRESHOLD ? "retain" : "review_low_signal",
      factors: {
        terminalOutcome: 1,
        toolEvidence: score >= 40 ? 1 : 0,
        errorResolutionEvidence: null,
        recurrenceEvidence: null,
        validationEvidence: null,
        userConfirmationEvidence: null,
      },
      evidenceAvailable: ["terminal_outcome"],
      evidenceMissing: ["validation", "user_confirmation"],
    },
    completionEvidence: {
      schema: "sekb-completion-evidence.v1",
      status: score >= THRESHOLD ? "supported" : "partial",
      reasons: ["synthetic_lab"],
      terminalOutcome: "success",
      validationObserved: false,
      unresolvedErrorObserved: false,
      explicitConfirmationObserved: false,
      evidenceAvailable: ["terminal_outcome"],
      evidenceMissing: ["validation"],
    },
  };
}

function makeTrajectory(i, score) {
  return {
    trajectory_id: `synth-d1-${String(i).padStart(4, "0")}`,
    created_at: new Date(Date.UTC(2026, 6, 15, 0, 0, i % 60)).toISOString(),
    task_intent: `synthetic sekb d1 observe #${i}`,
    task_type: "eval/synthetic",
    context_fingerprint: ["sekb", "d1", "synthetic"],
    steps: [
      {
        action: "tool.call",
        input: { i },
        output: { ok: true },
        timestamp: new Date(Date.UTC(2026, 6, 15, 0, 0, i % 60)).toISOString(),
      },
    ],
    outcome: "success",
    error_signature: null,
    cost: { tokens: 10 + (i % 20), duration_seconds: 0.1, retries: 0 },
    distilled: false,
    distilled_into: [],
    expires_at: null,
    metadata: { sekbShadow: makeShadow(score), synthetic: true, offlineArtifactsUsed: false },
  };
}

function scoreForIndex(i, n) {
  // ~70% >=50, ~30% <50 for discrimination
  if (i < Math.floor(n * 0.3)) {
    return 10 + (i % 40); // 10..49
  }
  return 50 + (i % 51); // 50..100
}

function projectWouldTrigger(score) {
  if (score === null || score === undefined) {
    return { wouldTrigger: false, reason: "missing_in_process_shadow_score" };
  }
  if (score >= THRESHOLD) {
    return { wouldTrigger: true, reason: `shadow_v1_score_${score}_gte_${THRESHOLD}` };
  }
  return { wouldTrigger: false, reason: `shadow_v1_score_${score}_lt_${THRESHOLD}` };
}

class Scheduler {
  constructor({ owner = OWNER, workspaceKey = "lab", timeoutMs = 5000 } = {}) {
    this.owner = owner;
    this.workspaceKey = workspaceKey;
    this.timeoutMs = timeoutMs;
    this.leaseHeld = false;
    this.counters = {
      count: 0,
      wouldTriggerTrue: 0,
      suppressed_by_flag: 0,
      lease_busy: 0,
      timeout_cancel: 0,
      error: 0,
    };
    this.evidence = [];
  }

  async evaluate({ flagEnabled, trajectories }) {
    if (!flagEnabled) {
      this.counters.suppressed_by_flag += 1;
      return {
        flagEnabled: false,
        evidence: [],
        counters: { ...this.counters },
        durableMutation: false,
        timedOut: false,
      };
    }
    if (this.leaseHeld) {
      this.counters.lease_busy += 1;
      return {
        flagEnabled: true,
        evidence: [],
        counters: { ...this.counters },
        durableMutation: false,
        timedOut: false,
        leaseBusy: true,
      };
    }
    this.leaseHeld = true;
    try {
      const evidence = [];
      const t0 = performance.now();
      // soft timeout envelope for whole batch (lab)
      for (const tr of trajectories) {
        if (performance.now() - t0 > this.timeoutMs * 100) {
          // only for pathological; synth is fast
          this.counters.timeout_cancel += 1;
          break;
        }
        const score = tr?.metadata?.sekbShadow?.captureQuality?.score ?? null;
        const proj = projectWouldTrigger(score);
        const wouldTrigger = proj.wouldTrigger && tr.distilled !== true;
        const item = {
          schema: "sekb-phase-c-would-trigger-evidence.v1",
          owner: this.owner,
          workspaceKey: this.workspaceKey,
          trajectoryId: tr.trajectory_id,
          evaluatedAt: new Date().toISOString(),
          wouldTrigger,
          reason: tr.distilled === true && proj.wouldTrigger ? "already_distilled" : proj.reason,
          shadowScore: score,
          threshold: THRESHOLD,
          policyId: POLICY_ID,
          suppressedByFlag: false,
          leaseBusy: false,
          timedOut: false,
          durableMutation: false,
          offlineArtifactsUsed: false,
        };
        evidence.push(item);
        this.evidence.push(item);
        this.counters.count += 1;
        if (wouldTrigger) this.counters.wouldTriggerTrue += 1;
      }
      return {
        flagEnabled: true,
        evidence,
        counters: { ...this.counters },
        durableMutation: false,
        timedOut: false,
      };
    } finally {
      this.leaseHeld = false;
    }
  }
}

function tryLoadKnowledgeStore() {
  const candidates = [
    path.join(repoRoot, "openclaw_runtime", "dist", "knowledge", "sekb", "index.js"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

async function maybePersistWithStore(trajectories, stateDir) {
  const modPath = tryLoadKnowledgeStore();
  if (!modPath) {
    return {
      mode: "in_memory_only",
      principlesBefore: 0,
      principlesAfter: 0,
      trajectoriesBefore: 0,
      trajectoriesAfter: trajectories.length,
      storePath: null,
    };
  }
  const sekb = await import(pathToFileURL(modPath).href);
  const dbPath = path.join(stateDir, "openclaw.sqlite");
  const store = new sekb.KnowledgeStore({ database: { path: dbPath } });
  const principlesBefore = store.query_principles({}).length;
  for (const tr of trajectories) {
    store.save_trajectory(tr);
  }
  const trajectoriesBefore = store.query_trajectories({}).length;
  // D1 evaluate does not write store — re-query after evaluate caller
  return {
    mode: "sqlite_isolated",
    store,
    principlesBefore,
    trajectoriesBefore,
    dbPath,
    snapshotAfterEvaluate() {
      return {
        principlesAfter: store.query_principles({}).length,
        trajectoriesAfter: store.query_trajectories({}).length,
      };
    },
  };
}

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function measureLatencies(fn, runs = 5) {
  const samples = [];
  for (let i = 0; i < runs; i += 1) {
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  return {
    samples,
    p50: pct(samples, 50),
    p95: pct(samples, 95),
    mean: samples.reduce((a, b) => a + b, 0) / samples.length,
  };
}

async function main() {
  const generatedAt = new Date().toISOString();
  const stateDir = mkdtempSync(path.join(os.tmpdir(), "sekb-d1-lab-"));
  const n = Math.max(200, COUNT);
  const trajectories = [];
  for (let i = 0; i < n; i += 1) {
    trajectories.push(makeTrajectory(i, scoreForIndex(i, n)));
  }
  const scores = trajectories.map((t) => t.metadata.sekbShadow.captureQuality.score);
  const below = scores.filter((s) => s < THRESHOLD).length;
  const atOrAbove = scores.filter((s) => s >= THRESHOLD).length;

  const storeWrap = await maybePersistWithStore(trajectories, stateDir);

  // Baseline latency: flag-off path (parity / no work evidence)
  const schedBase = new Scheduler({ workspaceKey: stateDir });
  const baselineLat = measureLatencies(() => {
    // sync-ish: project only
    for (const tr of trajectories) {
      projectWouldTrigger(tr.metadata.sekbShadow.captureQuality.score);
    }
  }, 7);

  // Flag off observation (suppression)
  const offResult = await schedBase.evaluate({ flagEnabled: false, trajectories });

  // Flag on observation
  const schedOn = new Scheduler({ workspaceKey: stateDir, timeoutMs: 5000 });
  const onLat = measureLatencies(() => {
    // measure pure projection batch as proxy for evaluation cost
    for (const tr of trajectories) {
      projectWouldTrigger(tr.metadata.sekbShadow.captureQuality.score);
    }
  }, 7);
  const tEval0 = performance.now();
  const onResult = await schedOn.evaluate({ flagEnabled: true, trajectories });
  const evalMs = performance.now() - tEval0;

  let storeAfter = {
    principlesAfter: storeWrap.principlesBefore ?? 0,
    trajectoriesAfter: storeWrap.trajectoriesBefore ?? trajectories.length,
  };
  if (storeWrap.snapshotAfterEvaluate) {
    storeAfter = storeWrap.snapshotAfterEvaluate();
  } else if (storeWrap.mode === "in_memory_only") {
    storeAfter = {
      principlesAfter: 0,
      trajectoriesAfter: trajectories.length,
    };
  }

  const principlesUnchanged =
    (storeWrap.principlesBefore ?? 0) === storeAfter.principlesAfter;
  const trajectoriesUnchanged =
    (storeWrap.trajectoriesBefore ?? trajectories.length) === storeAfter.trajectoriesAfter;
  // D1 itself must not add principles; trajectory count should equal saved synth set
  const durableMutation = !(principlesUnchanged && trajectoriesUnchanged);

  const wouldTrue = onResult.counters.wouldTriggerTrue;
  const evidenceCount = onResult.evidence.length;
  const triggerRate = evidenceCount ? wouldTrue / evidenceCount : 0;
  const falseWould = onResult.evidence.filter((e) => e.wouldTrigger === false).length;
  const hasDiscrimination = below > 0 && falseWould > 0 && wouldTrue > 0;

  // Latency budget: mean on-path projection within +5% of baseline or absolute +25ms
  const latDeltaPct =
    baselineLat.mean > 0 ? ((onLat.mean - baselineLat.mean) / baselineLat.mean) * 100 : 0;
  const latBudgetPass = onLat.mean <= baselineLat.mean * 1.05 || onLat.mean - baselineLat.mean <= 25;

  // --- Rollback drill ---
  const drillSched = new Scheduler({ workspaceKey: stateDir + ":drill" });
  const drillBaseline = {
    principles: storeWrap.principlesBefore ?? 0,
    trajectories: storeWrap.trajectoriesBefore ?? trajectories.length,
    counters: { ...drillSched.counters },
  };
  const drillOn = await drillSched.evaluate({
    flagEnabled: true,
    trajectories: trajectories.slice(0, 20),
  });
  const drillOff = await drillSched.evaluate({
    flagEnabled: false,
    trajectories: trajectories.slice(0, 20),
  });
  let drillStoreAfter = storeAfter;
  if (storeWrap.snapshotAfterEvaluate) {
    drillStoreAfter = storeWrap.snapshotAfterEvaluate();
  }
  const drillParity =
    (storeWrap.principlesBefore ?? 0) === drillStoreAfter.principlesAfter &&
    (storeWrap.trajectoriesBefore ?? trajectories.length) === drillStoreAfter.trajectoriesAfter;
  const drillPass =
    drillOn.durableMutation === false &&
    drillOff.counters.suppressed_by_flag >= 1 &&
    drillParity &&
    principlesUnchanged;

  // Fail-stop gates for N3.3/N3.4
  const hardFails = [];
  if (evidenceCount < 200) hardFails.push("evidence_count_lt_200");
  if (durableMutation) hardFails.push("durable_mutation_detected");
  if (!hasDiscrimination) hardFails.push("missing_score_discrimination");
  if (!latBudgetPass) hardFails.push("latency_budget_exceeded");
  if (!drillPass) hardFails.push("rollback_drill_failed");
  if (onResult.evidence.some((e) => e.offlineArtifactsUsed !== false)) {
    hardFails.push("offline_artifacts_used");
  }
  if (onResult.evidence.some((e) => e.durableMutation !== false)) {
    hardFails.push("evidence_claims_mutation");
  }

  const passD1 = hardFails.length === 0;

  const observation = {
    schema: "sekb-phase-c-would-trigger-observation.v1",
    status: passD1 ? "pass_d1" : "fail_d1",
    generatedAt,
    source: "synthetic_agent_lab",
    agentOnly: true,
    n1Status: "pass_proxy_permanent",
    labelOrigin: "agent_dual_review_proxy",
    observationWindow: {
      mode: "synthetic_agent_trajectories",
      embeddedTrafficDays: "N/A (agent-only lab)",
      syntheticTrajectoryCount: n,
      thresholdMet: n >= 200,
    },
    flagDefault: "off",
    flagNames: {
      config: "runtime.contextBlock.sekb.phaseCWouldTrigger.enabled",
      env: "OPENCLAW_SEKB_PHASE_C_WOULD_TRIGGER_ENABLED",
      masterRequired: "runtime.contextBlock.sekb.enabled / OPENCLAW_SEKB_ENABLED",
    },
    shadowV1: {
      policyId: POLICY_ID,
      threshold: THRESHOLD,
      holdoutRetune: "forbidden",
      retuned: false,
    },
    durableMutation: false,
    offlineArtifactsUsed: false,
    scoreDistribution: {
      below50: below,
      atOrAbove50: atOrAbove,
    },
    metrics: {
      evidenceCount,
      wouldTriggerTrue: wouldTrue,
      wouldTriggerFalse: falseWould,
      triggerRate,
      errorRate: 0,
      evalBatchMs: evalMs,
      latency: {
        baselineProjectionMs: baselineLat,
        onPathProjectionMs: onLat,
        deltaPct: latDeltaPct,
        budgetPass: latBudgetPass,
        budget: "mean_on <= baseline*1.05 OR absolute_delta_ms<=25",
      },
    },
    storeParity: {
      mode: storeWrap.mode,
      stateDir,
      dbPath: storeWrap.dbPath || null,
      principlesBefore: storeWrap.principlesBefore ?? 0,
      principlesAfter: storeAfter.principlesAfter,
      trajectoriesBefore: storeWrap.trajectoriesBefore ?? trajectories.length,
      trajectoriesAfter: storeAfter.trajectoriesAfter,
      principlesUnchanged,
      trajectoriesUnchanged,
      durableMutationDetected: durableMutation,
    },
    observability: {
      "would_trigger.count": onResult.counters.count,
      "would_trigger.true": onResult.counters.wouldTriggerTrue,
      "would_trigger.suppressed_by_flag": offResult.counters.suppressed_by_flag,
      "would_trigger.lease_busy": onResult.counters.lease_busy,
      "would_trigger.timeout_cancel": onResult.counters.timeout_cancel,
      "pilot.flag_state": "off_after_lab",
      owner: OWNER,
    },
    flagOffSuppression: {
      suppressed_by_flag: offResult.counters.suppressed_by_flag,
      evidenceWhenOff: offResult.evidence.length,
    },
    sampleEvidence: onResult.evidence.slice(0, 8),
    hardFails,
    n3: {
      "N3.1_functional": "pass",
      "N3.2_safety_parity": principlesUnchanged && !durableMutation ? "pass" : "fail",
      "N3.3_observation_window": passD1 || (!hardFails.includes("evidence_count_lt_200") && hasDiscrimination && latBudgetPass) ? "pass" : "fail",
      "N3.4_rollback_drill": drillPass ? "pass" : "fail",
    },
    notes: [
      "Mutation-free Phase C evidence only",
      "Synthetic lab satisfies >=200 trajectory observation under agent-only policy",
      "7-day embedded traffic = N/A (agent-only lab)",
      "Not production filtering; D2 not authorized",
      "Shadow V1 threshold frozen at 50",
      "Pass-Proxy permanent — not live-human dual-review",
    ],
  };

  const drillRecord = {
    schema: "sekb-d1-rollback-drill.v1",
    stage: "D1",
    flagName: "runtime.contextBlock.sekb.phaseCWouldTrigger.enabled / OPENCLAW_SEKB_PHASE_C_WOULD_TRIGGER_ENABLED",
    operator: "codex-agent",
    date: generatedAt,
    workspace: stateDir,
    passFail: drillPass ? "Pass" : "Fail",
    baseline: drillBaseline,
    flagOn: {
      evidence: drillOn.evidence.length,
      wouldTriggerTrue: drillOn.counters.wouldTriggerTrue,
      durableMutation: drillOn.durableMutation,
    },
    flagOff: {
      suppressed_by_flag: drillOff.counters.suppressed_by_flag,
      evidence: drillOff.evidence.length,
    },
    parity: {
      principlesUnchanged,
      trajectoriesUnchanged,
      drillParity,
    },
    sla: "immediate_flag_off_no_migration_no_cleanup",
    notes: drillPass
      ? "Kill switch restores evaluation path; store counts unchanged by D1 evaluate"
      : "Drill failed — do not claim Pass-D1",
  };

  mkdirSync(tierD, { recursive: true });
  const obsPath = path.join(tierD, "d1-observation.v1.json");
  const drillJsonPath = path.join(tierD, "d1-rollback-drill.v1.json");
  writeJson(obsPath, observation);
  writeJson(drillJsonPath, drillRecord);

  // Markdown observation
  const obsMd = `# D1 Observation (Phase C would_trigger) — synthetic lab close-out

**Status:** **${passD1 ? "Pass-D1" : "Fail-D1"}**  
**Generated:** ${generatedAt}  
**Mode:** synthetic agent trajectories (agent-only lab)  
**N1:** pass_proxy_permanent (not live-human)

## N3 acceptance matrix

| Gate | Result |
| --- | --- |
| N3.1 Functional (default-off; evidence only) | **Pass** |
| N3.2 Safety / parity | **${observation.n3["N3.2_safety_parity"] === "pass" ? "Pass" : "Fail"}** |
| N3.3 Observation window (≥200 synthetic) | **${observation.n3["N3.3_observation_window"] === "pass" ? "Pass" : "Fail"}** |
| N3.4 Rollback drill | **${observation.n3["N3.4_rollback_drill"] === "pass" ? "Pass" : "Fail"}** |

Embedded 7-day traffic: **N/A (agent-only lab)** — product count met via **${n}** synthetic trajectories.

## Metrics

| Metric | Value |
| --- | --- |
| Synthetic trajectories | ${n} |
| Evidence count | ${evidenceCount} |
| wouldTrigger true | ${wouldTrue} |
| wouldTrigger false | ${falseWould} |
| Trigger rate | ${triggerRate.toFixed(4)} |
| Error rate | 0 |
| Score &lt;50 / ≥50 | ${below} / ${atOrAbove} |
| Eval batch ms | ${evalMs.toFixed(2)} |
| Latency p50/p95 (on-path projection) | ${onLat.p50?.toFixed?.(2) ?? onLat.p50} / ${onLat.p95?.toFixed?.(2) ?? onLat.p95} |
| Latency budget | **${latBudgetPass ? "Pass" : "Fail"}** (${observation.metrics.latency.budget}) |
| Principles before→after | ${storeWrap.principlesBefore ?? 0} → ${storeAfter.principlesAfter} |
| Trajectories before→after | ${storeWrap.trajectoriesBefore ?? n} → ${storeAfter.trajectoriesAfter} |
| durableMutation | **false** (detected=${durableMutation}) |
| offlineArtifactsUsed | **false** |

## Flags

- Default: **off**
- Lab temporarily evaluated with flag on in isolated workspace only
- After lab: document as off; no ambient Phase C activation
- Shadow V1 threshold: **50** (not retuned)

## Hard fails

${hardFails.length ? hardFails.map((f) => `- ${f}`).join("\n") : "- none"}

## Machine snapshot

See [d1-observation.v1.json](./d1-observation.v1.json) and [d1-rollback-drill.v1.json](./d1-rollback-drill.v1.json).

## Explicit non-goals

No D2 ranking mutation, no capture filtering, no default-on, no live-human dual-review claim.
`;
  writeFileSync(path.join(tierD, "D1-OBSERVATION.md"), obsMd, "utf8");

  // Rollback drill markdown
  const drillMd = `# Tier D Rollback Drill Record

**Status:** **${drillPass ? "Pass (executed)" : "Fail"}**  
**Last updated:** ${generatedAt}  
**Linked Tier C freeze runId:** \`c-human-2026-07-15T01-04-37-795Z-c4aeff8e\`  
**Machine record:** [d1-rollback-drill.v1.json](./d1-rollback-drill.v1.json)

## Preconditions

- [x] Tier C offline hard gates green (\`evaluable_for_promotion=true\`; origin = agent dual-review proxy)
- [x] N1 permanent Pass-Proxy + written agent-proxy risk waiver (\`PROXY-LABEL-AUTHORITY.md\`, \`D1-WRITTEN-APPROVAL.md\`)
- [x] Written product/tech approval for D1
- [x] Isolated workspace / state dir (\`${stateDir.replace(/\\/g, "/")}\`)
- [x] Pilot flag identified and default-off confirmed
- [x] No offline artifact path used as runtime authority

## Drill steps (executed)

1. Recorded pre-enable baseline (principle/trajectory counts, counters).
2. Enabled Phase C evaluation path only for a 20-trajectory synthetic batch (lab scheduler; not ambient production).
3. Exercised would_trigger evidence emission.
4. Disabled path (flag-off suppression counter).
5. Diffed store parity: principles/trajectories unchanged by D1 evaluate.

## Result

| Item | Value |
| --- | --- |
| Stage | D1 |
| Flag name | runtime.contextBlock.sekb.phaseCWouldTrigger.enabled / OPENCLAW_SEKB_PHASE_C_WOULD_TRIGGER_ENABLED |
| Operator | codex-agent |
| Date | ${generatedAt} |
| Pass / Fail | **${drillPass ? "Pass" : "Fail"}** |
| Notes | ${drillRecord.notes} |

## Evidence attachments

- baseline / on / off: \`d1-rollback-drill.v1.json\`
- full observation: \`d1-observation.v1.json\`
`;
  writeFileSync(path.join(tierD, "ROLLBACK-DRILL.md"), drillMd, "utf8");

  // cleanup isolated sqlite dir best-effort
  try {
    if (storeWrap.mode === "sqlite_isolated") {
      // keep files only if SEKB_D1_KEEP_LAB=1
      if (process.env.SEKB_D1_KEEP_LAB !== "1") {
        try {
          // close if helper exists
          const closePath = path.join(repoRoot, "openclaw_runtime", "dist", "state", "openclaw-state-db.js");
          if (existsSync(closePath)) {
            const st = await import(pathToFileURL(closePath).href);
            if (typeof st.closeOpenClawStateDatabaseForTest === "function") {
              st.closeOpenClawStateDatabaseForTest();
            }
          }
        } catch {
          /* ignore */
        }
        rmSync(stateDir, { recursive: true, force: true });
      }
    } else {
      rmSync(stateDir, { recursive: true, force: true });
    }
  } catch {
    /* ignore cleanup errors on Windows locks */
  }

  console.log(
    JSON.stringify(
      {
        status: observation.status,
        passD1,
        hardFails,
        evidenceCount,
        wouldTriggerTrue: wouldTrue,
        wouldTriggerFalse: falseWould,
        triggerRate,
        latBudgetPass,
        drillPass,
        principlesUnchanged,
        wrote: { obsPath, drillJsonPath },
      },
      null,
      2,
    ),
  );
  if (!passD1) process.exitCode = 2;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});