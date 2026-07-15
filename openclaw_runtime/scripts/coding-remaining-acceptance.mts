/**
 * C1-2 + C3-4 + C4-C7 acceptance bundle.
 * Run: node --import tsx scripts/coding-remaining-acceptance.mts
 */
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { codingObservability } from "../src/context-engine/coding-observability.ts";
import {
  CODING_AB_FIXTURES,
  evaluateAbGate,
  simulateAbArm,
} from "../src/context-engine/coding-ab-fixtures.ts";
import {
  __resetTokenBudgets,
  chargeTokenBudget,
  createTokenBudget,
} from "../src/agents/orchestration-token-budget.ts";
import {
  __resetWorktreeRegistry,
  createWorktreeService,
} from "../src/agents/worktree-service.ts";
import {
  __resetSymbolLeases,
  acquireSymbolLease,
  releaseSymbolLease,
} from "../src/context-engine/factstore/symbol-lease.ts";
import { recommendIsolationMode } from "../src/agents/isolation-mode-matrix.ts";
import { archiveLowHeatBlocks, filterBlocksByLifecycle } from "../src/context-engine/block-lifecycle.ts";
import { selectBlocksUnderTokenPressure } from "../src/context-engine/token-pressure.ts";
import { compressToolOutputText } from "../src/agents/tool-output-compress.ts";
import { appendRoutingMemo, readRoutingMemo, routingMemoToShadowBlock } from "../src/knowledge/routing-memo-shadow.ts";
import { handleVerifierFailure } from "../src/agents/verifier-discipline.ts";
import { buildExecutionWaves, type OrchestrationTaskNode } from "../src/agents/orchestration-protocol.ts";

function node(id: string, writeSet?: string[]): OrchestrationTaskNode {
  return {
    taskNodeId: id,
    roleName: id,
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

async function main() {
  codingObservability.reset();
  __resetTokenBudgets();
  __resetWorktreeRegistry();
  __resetSymbolLeases();

  // C1-2
  const abResults = CODING_AB_FIXTURES.flatMap((f) => [
    simulateAbArm(f, "baseline"),
    simulateAbArm(f, "factstore"),
    simulateAbArm(f, "mcp_control"),
  ]);
  for (const r of abResults) {
    codingObservability.recordReplayTask({
      dupToolCalls: r.toolCalls,
      tokenCost: r.tokenCost,
      passed: r.passed,
      routingCorrect: r.routingCorrect,
    });
  }
  const ab = evaluateAbGate(abResults);
  if (!ab.meetsGate) throw new Error(ab.reason);

  // C3-4 3 disjoint modules same wave
  const waves = buildExecutionWaves({
    graphRunId: "e2e",
    mode: "flat",
    status: "planned",
    nodes: [node("m1", ["a.ts"]), node("m2", ["b.ts"]), node("m3", ["c.ts"])],
    edges: [],
  });
  if (waves.length !== 1 || waves[0]!.taskNodeIds.length !== 3) {
    throw new Error(`expected 1 wave of 3, got ${JSON.stringify(waves)}`);
  }
  createTokenBudget({ goalId: "g", goalBudgetTokens: 10, waveBudgetTokens: 10 });
  if (chargeTokenBudget("g", 20).ok) throw new Error("expected abort");

  // C4
  const root = mkdtempSync(path.join(tmpdir(), "rem-accept-"));
  mkdirSync(path.join(root, "src"), { recursive: true });
  writeFileSync(path.join(root, "src", "a.ts"), "export const a=1\n");
  const svc = createWorktreeService(root);
  const w1 = svc.create("w1", { seedFiles: ["src/a.ts"] });
  const w2 = svc.create("w2", { seedFiles: ["src/a.ts"] });
  writeFileSync(path.join(w1.root, "src", "a.ts"), "export const a=2\n");
  writeFileSync(path.join(w2.root, "src", "a.ts"), "export const a=3\n");
  svc.enqueueMerge({ worktreeId: "w1", changedFiles: ["src/a.ts"] });
  svc.enqueueMerge({ worktreeId: "w2", changedFiles: ["src/a.ts"] });
  const merge = svc.processMergeQueue();
  if (merge[0]?.status !== "merged" || merge[1]?.status !== "conflict") {
    throw new Error(`merge unexpected ${JSON.stringify(merge)}`);
  }

  // C5
  const lease1 = acquireSymbolLease({ workspaceRoot: root, holderId: "h1", symbolName: "a", filePath: "src/a.ts" });
  if (!lease1.ok) throw new Error("lease1");
  const lease2 = acquireSymbolLease({ workspaceRoot: root, holderId: "h2", symbolName: "a", filePath: "src/a.ts" });
  if (lease2.ok) throw new Error("lease2 should fail");
  releaseSymbolLease({ workspaceRoot: root, holderId: "h1", symbolName: "a", filePath: "src/a.ts" });
  const mode = recommendIsolationMode({ durationMinutes: 40, workerCount: 3, writeDensity: 0.6 });
  if (mode.mode !== "patch-flow") throw new Error(`mode ${mode.mode}`);

  // C6
  const archived = archiveLowHeatBlocks([
    {
      block_id: "n1",
      block_type: "notes",
      source_system: "agent-notes",
      presence: { always_on: false },
      entities: [],
      valid_at: new Date(),
      mutability: "system_managed",
      summary: "n",
      full_content: "n",
      compression_depth: 0,
      entity_extraction_status: "empty",
      heat: 0,
    },
  ]);
  if (filterBlocksByLifecycle(archived).length !== 0) throw new Error("archive filter");
  if (!compressToolOutputText("x".repeat(9000)).truncated) throw new Error("compress");
  const pressure = selectBlocksUnderTokenPressure({
    blocks: archived.map((b) => ({ ...b, lifecycle_state: "active" as const, block_type: "persona" as const })),
    tokenBudget: 100,
    mode: "emergency",
  });
  void pressure;

  // C7
  appendRoutingMemo(root, {
    atMs: Date.now(),
    sessionId: "s",
    query: "callers of login",
    chosenTool: "context_impact",
    success: true,
  });
  if (readRoutingMemo(root).length < 1) throw new Error("memo");
  const shadow = routingMemoToShadowBlock(readRoutingMemo(root)[0]!);
  if (shadow.block_type !== "notes") throw new Error("shadow");
  const ver = handleVerifierFailure({ reason: "fail" });
  if (ver.status !== "failed" || ver.selfRepairAllowed) throw new Error("verifier");

  const report = {
    ok: true,
    c1_2: ab,
    c3_4: {
      wave: waves[0]!.taskNodeIds,
      tokenBudgetAborts: codingObservability.snapshot().tokenBudgetAborts,
      waveConflictRate: codingObservability.rates().waveConflictRate,
    },
    c4: { merge: merge.map((m) => m.status), mergeReworkRate: codingObservability.rates().mergeReworkRate },
    c5: { leaseHeld: !lease2.ok, mode: mode.mode },
    c6: { compaction: codingObservability.snapshot().compactionLayerHits },
    c7: { memoCount: readRoutingMemo(root).length, verifierNoSelfRepair: true },
    rates: codingObservability.rates(),
  };
  console.log(JSON.stringify(report, null, 2));
  rmSync(root, { recursive: true, force: true });
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
