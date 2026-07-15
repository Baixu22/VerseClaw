/**
 * C3 L0 writeSet coordination acceptance.
 * Run from openclaw_runtime: node --import tsx scripts/coding-c3-acceptance.mts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { codingObservability } from "../src/context-engine/coding-observability.ts";
import {
  buildExecutionWaves,
  buildTaskGraph,
  impactRadiiConflict,
  resolveWorkerWriteSet,
  writeSetsConflict,
  type OrchestrationTaskGraph,
  type OrchestrationTaskNode,
} from "../src/agents/orchestration-protocol.ts";
import { createOrchestratorPlan } from "../src/agents/orchestrator.ts";
import { BUILT_IN_ROLE_CONTRACTS } from "../src/agents/role-contract.ts";
import {
  __resetTokenBudgets,
  chargeTokenBudget,
  createTokenBudget,
} from "../src/agents/orchestration-token-budget.ts";

function node(id: string, writeSet?: string[]): OrchestrationTaskNode {
  return {
    taskNodeId: id,
    roleName: `role-${id}`,
    task: id,
    phase: "implementation",
    dependsOn: [],
    scope: "repo",
    requiredCapabilities: [],
    attemptPolicy: { maxRepairAttempts: 0, maxRedoAttempts: 0 },
    status: "planned",
    writeSet,
  };
}

function graph(nodes: OrchestrationTaskNode[]): OrchestrationTaskGraph {
  return {
    graphRunId: "c3-accept",
    mode: "flat",
    status: "planned",
    nodes,
    edges: [],
  };
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function main(): Promise<void> {
  codingObservability.reset();
  __resetTokenBudgets();

  // C3-1/C3-2: empty = no constraint; intersection splits waves
  assert(writeSetsConflict(undefined, ["a.ts"]) === false, "empty writeSet must not conflict");
  assert(writeSetsConflict(["a.ts"], ["b.ts"]) === false, "disjoint writeSets ok");
  assert(writeSetsConflict(["a.ts"], ["a.ts"]) === true, "intersecting writeSets conflict");

  const splitWaves = buildExecutionWaves(
    graph([node("t1", ["src/a.ts"]), node("t2", ["src/b.ts"]), node("t3", ["src/a.ts"])]),
  );
  const waveOf = (id: string) => splitWaves.find((w) => w.taskNodeIds.includes(id))?.wave;
  assert(waveOf("t1") === waveOf("t2"), "disjoint should share wave");
  assert(waveOf("t3") !== waveOf("t1"), "intersecting must split waves");
  const waveSplitOnConflict = true;

  const emptyCompatWaves = buildExecutionWaves(graph([node("a"), node("b"), node("c", ["x.ts"])]));
  assert(emptyCompatWaves.length === 1, "missing writeSet must pack compatibly");
  const emptyWriteSetCompatible = true;

  // C3-3 impact radius (opt-in map)
  const impact = new Map<string, readonly string[]>([
    ["t1", ["shared/util.ts"]],
    ["t2", ["shared/util.ts"]],
  ]);
  assert(impactRadiiConflict(impact.get("t1"), impact.get("t2")) === true, "impact intersect");
  const impactWaves = buildExecutionWaves(
    graph([node("t1", ["mod-a.ts"]), node("t2", ["mod-b.ts"])]),
    undefined,
    { impactByNodeId: impact },
  );
  assert(impactWaves.length === 2, "impact radius should split when provided");
  const impactOff = buildExecutionWaves(
    graph([node("t1", ["mod-a.ts"]), node("t2", ["mod-b.ts"])]),
    undefined,
    { impactByNodeId: impact, impactRadiusEnabled: false },
  );
  assert(impactOff.length === 1, "impact radius flag off must not force split");
  const impactRadiusMode = "opt-in-via-impactByNodeId";

  // pass-through + metrics
  const tg = buildTaskGraph({
    graphRunId: "c3-pass",
    mode: "router",
    graphMode: "flat",
    workers: [
      { roleName: "impl-a", task: "a", writeSet: ["src/a.ts"] },
      { roleName: "impl-b", task: "b", writeSet: ["src/b.ts"] },
      { roleName: "impl-c", task: "c", writeSet: ["src/c.ts"] },
    ],
    requiredCapabilities: [],
  });
  const pack = buildExecutionWaves(tg);
  assert(pack.length === 1 && pack[0]!.taskNodeIds.length === 3, "3 disjoint pack in 1 wave");

  // partial planner fill
  assert(
    resolveWorkerWriteSet({ roleName: "implementer", fileHints: ["src/x.ts"] })?.[0] === "src/x.ts",
    "writer inherits fileHints",
  );
  assert(
    resolveWorkerWriteSet({ roleName: "reviewer", fileHints: ["src/x.ts"] }) === undefined,
    "non-writer stays empty",
  );
  const plan = createOrchestratorPlan({
    task: "implement feature",
    fileHints: ["src/a.ts", "src/b.ts"],
    roles: BUILT_IN_ROLE_CONTRACTS,
    workers: [
      { roleName: "implementer", task: "edit" },
      { roleName: "reviewer", task: "review" },
    ],
  });
  assert(plan.taskGraph.nodes.find((n) => n.roleName === "implementer")?.writeSet?.length === 2, "partial fill");
  assert(plan.taskGraph.nodes.find((n) => n.roleName === "reviewer")?.writeSet === undefined, "reviewer empty");
  const plannerFill = "partial";

  // C3-4 token budget
  createTokenBudget({ goalId: "g1", goalBudgetTokens: 100, waveBudgetTokens: 100 });
  assert(chargeTokenBudget("g1", 90).ok === true, "budget charge ok");
  assert(chargeTokenBudget("g1", 20).ok === false, "budget abort");
  const snap = codingObservability.snapshot();
  const rates = codingObservability.rates();
  assert(snap.tokenBudgetAborts >= 1, "tokenBudgetAborts recorded");
  assert(snap.waveConflictChecks >= 0, "waveConflictChecks present");
  const metricsPresent = true;

  const evidence = {
    ok: true,
    card: "C3",
    waveSplitOnConflict,
    emptyWriteSetCompatible,
    impactRadiusMode,
    impactRadiusDefaultOff: true,
    plannerFill,
    metricsPresent,
    packWavesForDisjoint: pack.length,
    tokenBudgetAborts: snap.tokenBudgetAborts,
    waveConflictChecks: snap.waveConflictChecks,
    waveConflicts: snap.waveConflicts,
    writeSetNodesTotal: snap.writeSetNodesTotal,
    writeSetNodesPopulated: snap.writeSetNodesPopulated,
    rates: {
      waveConflictRate: rates.waveConflictRate,
      writeSetCoverageRate: rates.writeSetCoverageRate,
      writeSetPredAccuracy: rates.writeSetPredAccuracy,
    },
    ts: new Date().toISOString(),
  };

  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const outDir = path.join(repoRoot, "artifacts", "coding-c3");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, "acceptance.json"), JSON.stringify(evidence, null, 2) + "\n", "utf8");
  writeFileSync(
    path.join(outDir, "gates.json"),
    JSON.stringify(
      {
        ok: true,
        cards: {
          "C3-1": "writeSet field + partial planner fill",
          "C3-2": "same-wave non-overlap via buildExecutionWaves",
          "C3-3": "impact radius opt-in (impactByNodeId)",
          "C3-4": "token budget + concurrent metrics",
        },
        honesty: {
          plannerFill: "partial",
          freeTextInvention: false,
          impactRadiusDefault: "off",
        },
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  console.log(JSON.stringify(evidence, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});