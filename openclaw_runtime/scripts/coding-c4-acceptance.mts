/**
 * C4 worktree isolation interface acceptance.
 * Run from openclaw_runtime: node --import tsx scripts/coding-c4-acceptance.mts
 */
import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { codingObservability } from "../src/context-engine/coding-observability.ts";
import { resolveWorktreeBackend } from "../src/context-engine/coding-runtime-flags.ts";
import { buildChildHandoffPack } from "../src/context-engine/handlers/task-loop-handler.ts";
import { parseHandoffPack } from "../src/context-engine/block-store.ts";
import {
  __resetWorktreeRegistry,
  createWorktreeService,
  writeWorktreeFile,
} from "../src/agents/worktree-service.ts";
import { createOrchestratorPlan } from "../src/agents/orchestrator.ts";
import { normalizeIsolationMode } from "../src/agents/orchestration-protocol.ts";
import { BUILT_IN_ROLE_CONTRACTS } from "../src/agents/role-contract.ts";
import { writeFileSync as writeFs, mkdirSync as mkdirFs } from "node:fs";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function main(): Promise<void> {
  codingObservability.reset();
  __resetWorktreeRegistry();

  const root = mkdtempSync(path.join(tmpdir(), "c4-accept-"));
  mkdirFs(path.join(root, "src"), { recursive: true });
  writeFs(path.join(root, "src", "a.ts"), "export const a = 1;\n");

  // C4-1 create/merge/cleanup
  const svc = createWorktreeService(root);
  assert(svc.backend === "inprocess", "default backend inprocess");
  assert(resolveWorktreeBackend() === "inprocess", "flag default inprocess");
  const w1 = svc.create("w1", { seedFiles: ["src/a.ts"], writeSet: ["src/a.ts"] });
  const w2 = svc.create("w2", { seedFiles: ["src/a.ts"], writeSet: ["src/a.ts"] });
  assert(w1.root.includes(path.join(".openclaw", "worktrees")), "worktree under .openclaw/worktrees");
  writeWorktreeFile(w1.root, "src/a.ts", "export const a = 2;\n");
  writeWorktreeFile(w2.root, "src/a.ts", "export const a = 3;\n");
  // both workers complete in isolation
  const createMergeCleanup = true;

  // C4-2 serial merge + conflict
  svc.enqueueMerge({ worktreeId: "w1", changedFiles: ["src/a.ts"] });
  svc.enqueueMerge({ worktreeId: "w2", changedFiles: ["src/a.ts"] });
  const results = svc.processMergeQueue();
  assert(results[0]?.status === "merged", "first merge wins");
  assert(results[1]?.status === "conflict", "second conflict");
  const mergeQueueSerial = true;
  const conflictHandled = true;

  svc.cleanup("w1");
  svc.cleanup("w2");
  assert(svc.list().every((r) => r.status === "cleaned"), "cleanup");

  // C4-3 HandoffPack fields
  const pack = buildChildHandoffPack({
    objective: "c4 handoff",
    currentPhase: "running",
    recentActions: [],
    parentSessionId: "agent:parent:main",
    writeSet: ["src/a.ts"],
    worktreeId: "w1",
    isolation: "worktree",
  });
  const parsed = parseHandoffPack(JSON.stringify(pack));
  assert(parsed?.writeSet?.[0] === "src/a.ts", "handoff writeSet");
  assert(parsed?.worktreeId === "w1", "handoff worktreeId");
  assert(parsed?.isolation === "worktree", "handoff isolation");
  const emptyPack = buildChildHandoffPack({
    objective: "empty",
    currentPhase: "running",
    recentActions: [],
    parentSessionId: "agent:parent:main",
  });
  assert(parseHandoffPack(JSON.stringify(emptyPack)), "empty writeSet compatible");
  const handoffFields = true;

  // C4-4 default isolation shared
  assert(normalizeIsolationMode(undefined) === "shared", "normalize default shared");
  const plan = createOrchestratorPlan({
    task: "default isolation",
    roles: BUILT_IN_ROLE_CONTRACTS,
    workers: [{ roleName: "implementer", task: "edit" }],
  });
  assert(plan.isolation === "shared", "plan default shared");
  const planWt = createOrchestratorPlan({
    task: "worktree opt-in",
    isolation: "worktree",
    roles: BUILT_IN_ROLE_CONTRACTS,
    workers: [{ roleName: "implementer", task: "edit", worktreeId: "wt-1" }],
  });
  assert(planWt.isolation === "worktree", "plan accepts worktree");
  const defaultIsolationShared = true;

  const windowsNotes = [
    "Interface uses directory simulation under .openclaw/worktrees/<id> (inprocess).",
    "Git backend is opt-in via createWorktreeService({ backend: 'git' }) / runtime.coding.worktree.backend.",
    "Windows path separators normalized in tests; no claim of production-hardened git worktree or pnpm hardlink install.",
    "File locks / long paths not hardened in this wave - do not flip isolation default to worktree.",
  ];

  const evidence = {
    ok: true,
    card: "C4",
    completionClass: "done (interface)",
    createMergeCleanup,
    mergeQueueSerial,
    conflictHandled,
    handoffFields,
    defaultIsolationShared,
    backendDefault: resolveWorktreeBackend(),
    twoWorkerConflict: {
      first: results[0]?.status,
      second: results[1]?.status,
      reason: results[1]?.reason,
    },
    rates: {
      mergeReworkRate: codingObservability.rates().mergeReworkRate,
    },
    windowsNotes,
    notC4H: true,
    ts: new Date().toISOString(),
  };

  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const outDir = path.join(repoRoot, "artifacts", "coding-c4");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, "acceptance.json"), JSON.stringify(evidence, null, 2) + "\n", "utf8");
  writeFileSync(
    path.join(outDir, "gates.json"),
    JSON.stringify(
      {
        ok: true,
        cards: {
          "C4-1": "worktree create/merge/cleanup under .openclaw/worktrees/<id>",
          "C4-2": "serial merge queue + configurable conflict policy (default mark_conflict)",
          "C4-3": "HandoffPack writeSet + worktreeId + isolation coordinates",
          "C4-4": "isolation request shared|worktree (default shared)",
        },
        honesty: {
          completionClass: "done (interface)",
          defaultIsolation: "shared",
          defaultBackend: "inprocess",
          productionGitWorktreeHardened: false,
          notC4H: true,
        },
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  rmSync(root, { recursive: true, force: true });
  __resetWorktreeRegistry();
  console.log(JSON.stringify(evidence, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});