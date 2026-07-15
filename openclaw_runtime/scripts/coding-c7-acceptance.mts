/**
 * C7 unified memory/knowledge shadow acceptance.
 * Run from openclaw_runtime: node --import tsx scripts/coding-c7-acceptance.mts
 */
import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  isCodingRoutingMemoShadowEnabled,
  isCodingSekbExperienceShadowEnabled,
} from "../src/context-engine/coding-runtime-flags.ts";
import {
  readRoutingMemo,
  recordRoutingMemoShadow,
} from "../src/knowledge/routing-memo-shadow.ts";
import {
  assessExperienceShadowWindow,
  productizeExperienceShadow,
  readExperienceShadowEvents,
} from "../src/knowledge/sekb/experience-shadow-product.ts";
import { handleConfirmAndSave } from "../src/knowledge/sekb/experience-block-bridge.ts";
import {
  DEFAULT_VERIFIER_DISCIPLINE,
  handleVerifierFailure,
} from "../src/agents/verifier-discipline.ts";
import { createOrchestratorPlan } from "../src/agents/orchestrator.ts";
import { BUILT_IN_ROLE_CONTRACTS } from "../src/agents/role-contract.ts";
import type { DistillationSuggestion, Principle } from "../src/knowledge/sekb/types.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function makePrinciple(): Principle {
  return {
    principle_id: "principle-c7",
    created_at: "2026-07-15T00:00:00.000Z",
    updated_at: "2026-07-15T00:00:00.000Z",
    title: "Prefer small diffs",
    condition: "When editing multi-file modules",
    action: "Prefer small diffs",
    reason: "Reduces conflict rate",
    full_content:
      "When editing multi-file modules, Prefer small diffs because Reduces conflict rate.",
    task_types: ["coding"],
    context_tags: ["edit"],
    embedding: null,
    source_trajectories: ["traj-c7"],
    created_by: "distiller",
    status: "staging",
    retrieval_count: 0,
    adoption_count: 0,
    post_adoption_success: 0,
    criticality: "medium",
    pinned: false,
    metadata: {},
  };
}

function makeSuggestion(): DistillationSuggestion {
  return {
    cluster_summary: "coding edit trajectories",
    source_trajectory_ids: ["traj-c7"],
    suggested_principle: {
      title: "Prefer small diffs",
      task_types: ["coding"],
      context_tags: ["edit"],
      criticality: "medium",
    },
    confidence: 0.9,
  };
}

async function main(): Promise<void> {
  const root = mkdtempSync(path.join(tmpdir(), "c7-accept-"));

  // Defaults: memory shadows off; no production injection cutover.
  assert(isCodingRoutingMemoShadowEnabled() === false, "routingMemo.shadow default false");
  assert(isCodingSekbExperienceShadowEnabled() === false, "experienceShadow default false");
  const defaultInjectionUnchanged = true;

  // C7-1: flag off = zero behavior
  const off = recordRoutingMemoShadow({
    workspaceRoot: root,
    enabled: false,
    entry: {
      atMs: 1,
      sessionId: "s-off",
      query: "should not write",
      chosenTool: "context_impact",
      success: true,
    },
  });
  assert(off.written === false, "disabled shadow writes nothing");
  assert(readRoutingMemo(root).length === 0, "no jsonl when off");

  // C7-1: flag on = jsonl + shadow block
  const on = recordRoutingMemoShadow({
    workspaceRoot: root,
    enabled: true,
    entry: {
      atMs: 2,
      sessionId: "s-on",
      query: "who calls login",
      chosenTool: "context_impact",
      success: true,
    },
  });
  assert(on.written === true, "enabled writes");
  assert(on.shadowBlock?.block_type === "notes", "shadow block notes");
  assert(readRoutingMemo(root).length === 1, "jsonl row present");
  const routingMemoShadow = true;

  // C7-2: disabled productize no-op
  const disabled = productizeExperienceShadow({
    workspaceRoot: root,
    enabled: false,
    dualWrite: false,
    build: {
      principle: makePrinciple(),
      suggestion: makeSuggestion(),
      sessionId: "s-exp-off",
    },
  });
  assert(disabled.journaled === false && !disabled.block, "experience disabled no-op");

  // C7-2: shadow confirm path (no production sink) journals only when enabled
  await handleConfirmAndSave({
    principle: makePrinciple(),
    suggestion: makeSuggestion(),
    sessionId: "s-exp-shadow",
    experienceShadow: {
      workspaceRoot: root,
      enabled: true,
      dualWrite: false,
    },
  });
  const shadowEvents = readExperienceShadowEvents(root);
  assert(shadowEvents.length >= 1, "shadow journal after confirm");
  const assessment = assessExperienceShadowWindow({
    workspaceRoot: root,
    requiredDays: 0,
    nowMs: Date.now() + 15 * 24 * 60 * 60 * 1000,
  });
  assert(assessment.cutoverAllowed === false, "cutover never auto-allowed");
  const sekbExperienceShadow = true;
  const experienceHitRate = assessment.hitRate;

  // C7-3: fail -> lead fix task; default discipline true on plan
  const fail = handleVerifierFailure({ reason: "tests failed" });
  assert(fail.status === "failed", "verifier failed");
  if (fail.status !== "failed") throw new Error("unreachable");
  assert(fail.selfRepairAllowed === false, "no self repair");
  assert(fail.createFixTask === true, "creates fix task");
  assert(fail.fixTask?.kind === "lead-fix-task", "lead fix task factory");
  assert(DEFAULT_VERIFIER_DISCIPLINE.verifierNoSelfRepair === true, "default discipline on");
  const plan = createOrchestratorPlan({
    task: "c7 verifier discipline",
    roles: BUILT_IN_ROLE_CONTRACTS,
    workers: [{ roleName: "implementer", task: "edit" }],
  });
  assert(plan.verifierNoSelfRepair === true, "plan default verifierNoSelfRepair true");
  const verifierNoSelfRepair = true;
  const failCreatesLeadFixTask = true;

  const evidence = {
    ok: true,
    routingMemoShadow,
    defaultInjectionUnchanged,
    sekbExperienceShadow,
    experienceHitRate,
    verifierNoSelfRepair,
    failCreatesLeadFixTask,
    completionClass: "done (shadow)",
    cutoverRecommended: false,
    flags: {
      "runtime.coding.routingMemo.shadow": isCodingRoutingMemoShadowEnabled(),
      "runtime.coding.sekb.experienceShadow": isCodingSekbExperienceShadowEnabled(),
    },
    residual: [
      "C7-2 productization partial: shadow journal + confirm hook exist; full production confirm chain metrics still fixture-level",
      "No default COMPASS/role-memory/routing production prompt injection cutover",
      "C7-H dual-write/cutover requires explicit user approval after stable window",
    ],
    howToEnableShadow: {
      routingMemo: "runtime.coding.routingMemo.shadow=true or recordRoutingMemoShadow({enabled:true})",
      experience: "runtime.coding.sekb.experienceShadow=true or confirm options.experienceShadow.enabled=true",
      verifier: "verifierNoSelfRepair defaults true; set false only to opt out of lead fix factory",
    },
    ts: new Date().toISOString(),
  };

  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const outDir = path.join(repoRoot, "artifacts", "coding-c7");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, "acceptance.json"), JSON.stringify(evidence, null, 2) + "\n", "utf8");
  writeFileSync(
    path.join(outDir, "gates.json"),
    JSON.stringify(
      {
        ok: true,
        cards: {
          "C7-1": "routing-memo JSONL dual-write shadow (default off)",
          "C7-2": "SEKB experience confirm shadow journal (default off; cutoverAllowed always false)",
          "C7-3": "verifierNoSelfRepair + lead fix task factory",
        },
        honesty: {
          completionClass: "done (shadow)",
          defaultInjectionUnchanged: true,
          cutoverRecommended: false,
          notC7H: true,
        },
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  rmSync(root, { recursive: true, force: true });
  console.log(JSON.stringify(evidence, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});