/**
 * C5 symbol lease + patch-flow + isolation matrix acceptance.
 * Run from openclaw_runtime: node --import tsx scripts/coding-c5-acceptance.mts
 */
import { mkdirSync, writeFileSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  __resetSymbolLeases,
  acquireSymbolLease,
  releaseSymbolLease,
} from "../src/context-engine/factstore/symbol-lease.ts";
import {
  isCodingPatchFlowDefault,
  isCodingSymbolLeaseEnabled,
  resolveSymbolLeaseMode,
} from "../src/context-engine/coding-runtime-flags.ts";
import { applyPatchProposalsSerial } from "../src/agents/patch-flow.ts";
import { recommendIsolationMode } from "../src/agents/isolation-mode-matrix.ts";
import { normalizeIsolationMode } from "../src/agents/orchestration-protocol.ts";
import { createOrchestratorPlan } from "../src/agents/orchestrator.ts";
import { BUILT_IN_ROLE_CONTRACTS } from "../src/agents/role-contract.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function patchLines(...lines: string[]): string {
  return ["*** Begin Patch", ...lines, "*** End Patch"].join("\n");
}

async function main(): Promise<void> {
  __resetSymbolLeases();
  const root = mkdtempSync(path.join(tmpdir(), "c5-accept-"));

  // C5-1 lease held + conflict + expire reacquire
  const a = acquireSymbolLease({
    workspaceRoot: root,
    holderId: "sess-a",
    symbolName: "login",
    filePath: "src/auth.ts",
    ttlMs: 100,
    nowMs: 1000,
    mode: "memory",
  });
  assert(a.ok === true, "first acquire must hold");
  const leaseHeld = true;

  const b = acquireSymbolLease({
    workspaceRoot: root,
    holderId: "sess-b",
    symbolName: "login",
    filePath: "src/auth.ts",
    ttlMs: 100,
    nowMs: 1001,
    mode: "memory",
  });
  assert(b.ok === false, "second holder must be blocked");
  const leaseConflictBlocked = true;

  const afterExpire = acquireSymbolLease({
    workspaceRoot: root,
    holderId: "sess-b",
    symbolName: "login",
    filePath: "src/auth.ts",
    ttlMs: 1000,
    nowMs: 1000 + 101,
    mode: "memory",
  });
  assert(afterExpire.ok === true, "expired lease reacquire");
  const leaseExpireReacquire = true;
  releaseSymbolLease({
    workspaceRoot: root,
    holderId: "sess-b",
    symbolName: "login",
    filePath: "src/auth.ts",
    mode: "memory",
  });

  // C5-2 patch-flow serial apply + conflict observability + destructive path
  writeFileSync(path.join(root, "a.txt"), "one\n", "utf8");
  writeFileSync(path.join(root, "b.txt"), "two\n", "utf8");
  writeFileSync(path.join(root, "c.txt"), "base\n", "utf8");
  writeFileSync(path.join(root, "gone.txt"), "x\n", "utf8");

  const serial = await applyPatchProposalsSerial({
    cwd: root,
    proposals: [
      {
        workerId: "w1",
        patchText: patchLines("*** Update File: a.txt", "@@", "-one", "+ONE"),
      },
      {
        workerId: "w2",
        patchText: patchLines("*** Update File: b.txt", "@@", "-two", "+TWO"),
      },
    ],
  });
  assert(serial.every((r) => r.ok), "serial multi-worker apply");
  assert(readFileSync(path.join(root, "a.txt"), "utf8") === "ONE\n", "a applied");
  assert(readFileSync(path.join(root, "b.txt"), "utf8") === "TWO\n", "b applied");
  const patchFlowSerialApply = true;

  const conflict = await applyPatchProposalsSerial({
    cwd: root,
    proposals: [
      {
        workerId: "w3",
        patchText: patchLines("*** Update File: c.txt", "@@", "-base", "+first"),
      },
      {
        workerId: "w4",
        patchText: patchLines("*** Update File: c.txt", "@@", "-base", "+second"),
      },
    ],
  });
  assert(conflict[0]?.ok === true && conflict[1]?.ok === false, "conflict observable");

  const destructiveBlocked = await applyPatchProposalsSerial({
    cwd: root,
    proposals: [
      {
        workerId: "w-del",
        patchText: patchLines("*** Delete File: gone.txt"),
      },
    ],
  });
  assert(
    destructiveBlocked[0]?.ok === false &&
      String(destructiveBlocked[0]?.error ?? "").includes("destructive_requires_approval"),
    "destructive approval path",
  );
  const destructiveApprovalPath = true;

  // C5-3 matrix
  const light = recommendIsolationMode({ durationMinutes: 5, workerCount: 1, writeDensity: 0.1 });
  assert(light.mode === "shared", "low density => shared");
  const multi = recommendIsolationMode({ durationMinutes: 15, workerCount: 2, writeDensity: 0.4 });
  assert(multi.mode === "worktree", "multi worker => worktree");
  const dense = recommendIsolationMode({ durationMinutes: 45, workerCount: 4, writeDensity: 0.7 });
  assert(dense.mode === "patch-flow", "high density => patch-flow recommend");
  const matrixRecommend = {
    light: light.mode,
    multi: multi.mode,
    dense: dense.mode,
  };

  // Defaults still safe
  assert(isCodingSymbolLeaseEnabled() === false, "lease default off");
  assert(resolveSymbolLeaseMode() === "memory", "lease mode default memory");
  assert(isCodingPatchFlowDefault() === false, "patch-flow default false");
  assert(normalizeIsolationMode(undefined) === "shared", "isolation normalize shared");
  const plan = createOrchestratorPlan({
    task: "default isolation",
    roles: BUILT_IN_ROLE_CONTRACTS,
    workers: [{ roleName: "implementer", task: "edit" }],
  });
  assert(plan.isolation === "shared", "orchestrator default shared");
  const defaultStillShared = true;

  const evidence = {
    ok: true,
    card: "C5",
    completionClass: "done (interface)",
    leaseHeld,
    leaseConflictBlocked,
    leaseExpireReacquire,
    patchFlowSerialApply,
    destructiveApprovalPath,
    matrixRecommend,
    defaultStillShared,
    flags: {
      symbolLeaseEnabled: isCodingSymbolLeaseEnabled(),
      symbolLeaseMode: resolveSymbolLeaseMode(),
      patchFlowDefault: isCodingPatchFlowDefault(),
    },
    howToEnable: {
      symbolLease:
        "runtime.coding.symbolLease.enabled=true (optional mode=memory|wal; default mode memory)",
      patchFlow:
        "call applyPatchProposalsSerial() / recommendIsolationMode(); do not set runtime.coding.patchFlow.default=true without C5-H evidence",
      isolationRecommend: "recommendIsolationMode({ durationMinutes, workerCount, writeDensity })",
    },
    notC5H: true,
    multiProcessWalHardened: false,
    ts: new Date().toISOString(),
  };

  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const outDir = path.join(repoRoot, "artifacts", "coding-c5");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, "acceptance.json"), JSON.stringify(evidence, null, 2) + "\n", "utf8");
  writeFileSync(
    path.join(outDir, "gates.json"),
    JSON.stringify(
      {
        ok: true,
        cards: {
          "C5-1": "symbol/path lease acquire/release/expire; write-tool wrap flag default off",
          "C5-2": "patch-flow workers propose; lead serial apply+verify; destructive approval surface",
          "C5-3": "recommendIsolationMode shared|worktree|patch-flow (recommend only)",
        },
        honesty: {
          completionClass: "done (interface)",
          defaultIsolation: "shared",
          symbolLeaseDefaultEnabled: false,
          patchFlowDefault: false,
          multiProcessWalHardened: false,
          notC5H: true,
        },
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  rmSync(root, { recursive: true, force: true });
  __resetSymbolLeases();
  console.log(JSON.stringify(evidence, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});