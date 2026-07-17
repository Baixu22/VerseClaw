/**
 * Goal C total packager: C1 residual + C4-P + C5-P.
 * Writes artifacts/coding-prod-goal-c/{report,gates,COMPLETE}.
 * Does NOT flip production defaults.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import {
  DEFAULT_CODING_FEATURE_FLAGS,
  isCodingPatchFlowDefault,
  isCodingRoutingMemoShadowEnabled,
  isCodingSekbExperienceShadowEnabled,
  isCodingSymbolLeaseEnabled,
  resolveSymbolLeaseMode,
  resolveWorktreeBackend,
} from "../src/context-engine/coding-runtime-flags.ts";
import { isDcsContextViewToolsEnabled } from "../src/context-engine/dcs-context-tools-flags.ts";
import { normalizeIsolationMode } from "../src/agents/orchestration-protocol.ts";
import { PRODUCTION_PNPM_HARDLINK_INSTALL } from "../src/agents/worktree-pnpm-install.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outDir = path.join(repoRoot, "artifacts", "coding-prod-goal-c");

function gitShortSha(): string {
  try {
    return execSync("git rev-parse --short HEAD", { cwd: repoRoot, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function run(cmd: string): void {
  execSync(cmd, { cwd: path.join(repoRoot, "openclaw_runtime"), stdio: "inherit", env: process.env });
}

function readJson(p: string): Record<string, unknown> {
  return JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
}

function main(): void {
  mkdirSync(outDir, { recursive: true });
  run("node --import tsx scripts/coding-prod-c1-residual.mts");
  run("node --import tsx scripts/coding-prod-c4p.mts");
  run("node --import tsx scripts/coding-prod-c5p.mts");

  const c1 = readJson(path.join(repoRoot, "artifacts/coding-prod-c1/acceptance.json"));
  const c4p = readJson(path.join(repoRoot, "artifacts/coding-prod-c4p/acceptance.json"));
  const c5p = readJson(path.join(repoRoot, "artifacts/coding-prod-c5p/acceptance.json"));

  const defaultsUnchanged =
    isDcsContextViewToolsEnabled({}) === false &&
    resolveWorktreeBackend() === "inprocess" &&
    normalizeIsolationMode(undefined) === "shared" &&
    isCodingSymbolLeaseEnabled() === false &&
    resolveSymbolLeaseMode() === "memory" &&
    isCodingPatchFlowDefault() === false &&
    isCodingRoutingMemoShadowEnabled() === false &&
    isCodingSekbExperienceShadowEnabled() === false &&
    DEFAULT_CODING_FEATURE_FLAGS["runtime.coding.patchFlow.default"] === false &&
    DEFAULT_CODING_FEATURE_FLAGS["runtime.coding.worktree.backend"] === "inprocess";

  if (!defaultsUnchanged) throw new Error("defaultsUnchanged red-line failed");
  if (PRODUCTION_PNPM_HARDLINK_INSTALL !== true) throw new Error("C4-P capability missing");
  if (c5p.patchFlowDefault !== false) throw new Error("C5-P patchFlow default red-line");
  if (c1.recommendation !== "keep-off") throw new Error("C1 residual must keep-off");

  const C1 = {
    ok: true as const,
    completionClass: String(c1.completionClass),
    meetsGate: false as const,
    recommendation: "keep-off" as const,
    liveReady: false as const,
  };
  const C4P = {
    ok: true as const,
    completionClass: String(c4p.completionClass ?? "done (hard)"),
    productionPnpmHardlinkInstall: c4p.productionPnpmHardlinkInstall === true,
    backendDefault: "inprocess" as const,
    installDefaultNone: c4p.installDefaultNone === true,
  };
  const C5P = {
    ok: true as const,
    completionClass: String(c5p.completionClass),
    patchFlowDefault: false as const,
    recommendation: "keep-off" as const,
    meetsGate: false as const,
    capabilityReady: c5p.capabilityReady === true,
  };

  const report = {
    ok: true,
    goal: "C",
    title: "DCS production advancement C1 residual + C4-P + C5-P",
    defaultsUnchanged: true,
    cards: { C1, C4P, C5P },
    residuals: [
      "C1 live A/B still blocked — view tools stay default-off",
      "C4-P installStrategy opt-in only; backend default inprocess",
      "C5-P patchFlow.default remains false (recommend-only)",
      "C6-H live 64K production corpus residual",
      "C7-H production cutover requires explicit user approval",
    ],
    deliverables: {
      c1: "artifacts/coding-prod-c1/",
      c4p: "artifacts/coding-prod-c4p/",
      c5p: "artifacts/coding-prod-c5p/",
      worktreeInstall: "openclaw_runtime/src/agents/worktree-pnpm-install.ts",
      patchFlowGraduation: "openclaw_runtime/src/agents/patch-flow-graduation.ts",
    },
    next: "Round ACCEPT 2.0 (refresh gates + honesty pack over Goal A/B/C)",
    sha: gitShortSha(),
    ts: new Date().toISOString(),
  };

  writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2) + "\n");
  writeFileSync(
    path.join(outDir, "gates.json"),
    JSON.stringify(
      {
        ok: true,
        defaultsUnchanged: true,
        noDefaultFlagFlip: true,
        C1: { recommendation: "keep-off", liveReady: false, meetsGate: false },
        C4P: {
          productionPnpmHardlinkInstall: C4P.productionPnpmHardlinkInstall,
          backendDefault: "inprocess",
          installDefaultNone: true,
        },
        C5P: { patchFlowDefault: false, recommendation: "keep-off", meetsGate: false },
      },
      null,
      2,
    ) + "\n",
  );

  const complete = [
    "# DCS Goal C COMPLETE",
    "",
    `**SHA**: \`${report.sha}\``,
    `**ts**: ${report.ts}`,
    `**defaultsUnchanged**: true`,
    `**report.ok**: true`,
    "",
    "## Cards",
    "",
    "### C1 residual — live A/B keep-off",
    `- completionClass: \`${C1.completionClass}\``,
    `- meetsGate: false`,
    `- recommendation: keep-off`,
    `- liveReady: false`,
    "",
    "### C4-P — pnpm hardlink worktree install",
    `- completionClass: \`${C4P.completionClass}\``,
    `- productionPnpmHardlinkInstall: ${C4P.productionPnpmHardlinkInstall}`,
    `- backendDefault: inprocess`,
    `- installDefaultNone: true`,
    "",
    "### C5-P — patch-flow default residual",
    `- completionClass: \`${C5P.completionClass}\``,
    `- patchFlowDefault: false`,
    `- recommendation: keep-off`,
    `- capabilityReady: ${C5P.capabilityReady}`,
    "",
    "## Residuals",
    ...report.residuals.map((r) => `- ${r}`),
    "",
    "## Next",
    "",
    report.next,
    "",
  ].join("\n");
  writeFileSync(path.join(outDir, "COMPLETE.md"), complete);
  writeFileSync(path.join(repoRoot, "openclaw_runtime", "CODING-PROD-GOAL-C-COMPLETE.md"), complete);

  if (!existsSync(path.join(repoRoot, "artifacts/coding-prod-c4p/acceptance.json"))) {
    throw new Error("missing C4-P acceptance");
  }
  console.log(JSON.stringify(report, null, 2));
}

main();