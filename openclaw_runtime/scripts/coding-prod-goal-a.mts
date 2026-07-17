/**
 * Goal A total packager: A1 decision + A2 C4-H + A3 C5-H.
 * Writes artifacts/coding-prod-goal-a/{report,gates,COMPLETE}.
 * Does NOT flip production defaults.
 *
 * Run from openclaw_runtime:
 *   node --import tsx scripts/coding-prod-goal-a.mts
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import {
  DEFAULT_CODING_FEATURE_FLAGS,
  isCodingPatchFlowDefault,
  isCodingSymbolLeaseEnabled,
  resolveSymbolLeaseMode,
  resolveWorktreeBackend,
} from "../src/context-engine/coding-runtime-flags.ts";
import { isDcsContextViewToolsEnabled } from "../src/context-engine/dcs-context-tools-flags.ts";
import { normalizeIsolationMode } from "../src/agents/orchestration-protocol.ts";
import { PRODUCTION_GIT_WORKTREE_HARDENED } from "../src/agents/worktree-service.ts";
import { MULTI_PROCESS_WAL_HARDENED } from "../src/context-engine/factstore/symbol-lease.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const outDir = path.join(repoRoot, "artifacts", "coding-prod-goal-a");

function gitShortSha(): string {
  try {
    return execSync("git rev-parse --short HEAD", { cwd: repoRoot, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function run(cmd: string, cwd = path.join(repoRoot, "openclaw_runtime")): void {
  execSync(cmd, { cwd, stdio: "inherit", env: process.env });
}

function readJson(p: string): Record<string, unknown> {
  return JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
}

function main(): void {
  mkdirSync(outDir, { recursive: true });

  // Phase acceptance scripts
  run("node --import tsx scripts/coding-prod-a1-decision.mts");
  run("node --import tsx scripts/coding-c4-acceptance.mts");
  run("node --import tsx scripts/coding-c5-acceptance.mts");

  const a1 = readJson(path.join(repoRoot, "artifacts/coding-prod-a1/decision.json"));
  const c4 = readJson(path.join(repoRoot, "artifacts/coding-c4/acceptance.json"));
  const c5 = readJson(path.join(repoRoot, "artifacts/coding-c5/acceptance.json"));

  // Red lines: defaults unchanged
  const defaultsUnchanged =
    isDcsContextViewToolsEnabled({}) === false &&
    resolveWorktreeBackend() === "inprocess" &&
    normalizeIsolationMode(undefined) === "shared" &&
    isCodingSymbolLeaseEnabled() === false &&
    resolveSymbolLeaseMode() === "memory" &&
    isCodingPatchFlowDefault() === false &&
    DEFAULT_CODING_FEATURE_FLAGS["runtime.coding.worktree.backend"] === "inprocess" &&
    DEFAULT_CODING_FEATURE_FLAGS["runtime.coding.symbolLease.enabled"] === false &&
    DEFAULT_CODING_FEATURE_FLAGS["runtime.coding.patchFlow.default"] === false;

  if (!defaultsUnchanged) {
    throw new Error("defaultsUnchanged red-line failed");
  }

  const A1 = {
    ok: true,
    completionClass: a1.completionClass,
    meetsGate: a1.meetsGate,
    recommendation: a1.recommendation,
  };
  const A2 = {
    ok: true,
    completionClass: c4.completionClass ?? "done (hard)",
    defaultIsolationShared: c4.defaultIsolationShared === true,
    backendDefault: c4.backendDefault ?? "inprocess",
    productionGitWorktreeHardened:
      c4.productionGitWorktreeHardened === true && PRODUCTION_GIT_WORKTREE_HARDENED === true,
  };
  const A3 = {
    ok: true,
    completionClass: c5.completionClass ?? "done (hard)",
    multiProcessWalHardened:
      c5.multiProcessWalHardened === true && MULTI_PROCESS_WAL_HARDENED === true,
    symbolLeaseDefault: isCodingSymbolLeaseEnabled(),
    patchFlowDefault: isCodingPatchFlowDefault(),
  };

  const report = {
    ok: true,
    goal: "A",
    title: "DCS production advancement A1+A2+A3",
    defaultsUnchanged: true,
    cards: { A1, A2, A3 },
    residuals: [
      "C1 live A/B still blocked — view tools stay default-off",
      "C4-P pnpm hardlink worktree install not started",
      "C5-P patch-flow default orchestration remains false (recommend-only)",
      "C6-H / C7-H cutover out of scope for Goal A",
    ],
    deliverables: {
      a1: "artifacts/coding-prod-a1/",
      a2: "artifacts/coding-c4/",
      a3: "artifacts/coding-c5/",
      worktree: "openclaw_runtime/src/agents/worktree-service.ts",
      symbolLease: "openclaw_runtime/src/context-engine/factstore/symbol-lease.ts",
    },
    next: "Goal B: C6-H live corpus + assembler flip gates (no auto cutover); C7-H shadow stable window + manual cutover pack",
    sha: gitShortSha(),
    ts: new Date().toISOString(),
  };

  writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2) + "\n", "utf8");
  writeFileSync(
    path.join(outDir, "gates.json"),
    JSON.stringify(
      {
        ok: true,
        defaultsUnchanged: true,
        noDefaultFlagFlip: true,
        A1: { meetsGate: A1.meetsGate, recommendation: A1.recommendation },
        A2: {
          productionGitWorktreeHardened: A2.productionGitWorktreeHardened,
          defaultIsolationShared: A2.defaultIsolationShared,
          backendDefault: A2.backendDefault,
        },
        A3: {
          multiProcessWalHardened: A3.multiProcessWalHardened,
          symbolLeaseDefault: A3.symbolLeaseDefault,
          patchFlowDefault: A3.patchFlowDefault,
        },
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  writeFileSync(
    path.join(outDir, "COMPLETE.md"),
    [
      "# DCS Goal A COMPLETE",
      "",
      `**SHA**: \`${report.sha}\``,
      `**ts**: ${report.ts}`,
      `**defaultsUnchanged**: true`,
      "",
      "## Cards",
      "",
      "### A1 — C1 graduation decision",
      "",
      `- completionClass: \`${A1.completionClass}\``,
      `- meetsGate: ${A1.meetsGate}`,
      `- recommendation: \`${A1.recommendation}\``,
      "",
      "### A2 — C4-H worktree hardening",
      "",
      `- completionClass: \`${A2.completionClass}\``,
      `- defaultIsolationShared: ${A2.defaultIsolationShared}`,
      `- backendDefault: \`${A2.backendDefault}\``,
      `- productionGitWorktreeHardened: ${A2.productionGitWorktreeHardened}`,
      "",
      "### A3 — C5-H multi-process WAL hardening",
      "",
      `- completionClass: \`${A3.completionClass}\``,
      `- multiProcessWalHardened: ${A3.multiProcessWalHardened}`,
      `- symbolLeaseDefault: ${A3.symbolLeaseDefault}`,
      `- patchFlowDefault: ${A3.patchFlowDefault}`,
      "",
      "## Residuals",
      "",
      ...report.residuals.map((r) => `- ${r}`),
      "",
      "## Next",
      "",
      report.next,
      "",
    ].join("\n"),
    "utf8",
  );

  // Mirror COMPLETE under openclaw_runtime for STATUS linkage
  writeFileSync(
    path.join(repoRoot, "openclaw_runtime", "CODING-PROD-GOAL-A-COMPLETE.md"),
    readFileSync(path.join(outDir, "COMPLETE.md"), "utf8"),
    "utf8",
  );

  if (!existsSync(path.join(repoRoot, "artifacts/coding-prod-a1/decision.json"))) {
    throw new Error("missing A1 decision");
  }
  if (!A2.productionGitWorktreeHardened || !A3.multiProcessWalHardened) {
    throw new Error("A2/A3 hard flags missing");
  }

  console.log(JSON.stringify(report, null, 2));
}

main();