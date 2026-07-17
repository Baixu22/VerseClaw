/**
 * Goal B total packager: B1 C6-H + B2 C7-H.
 * Writes artifacts/coding-prod-goal-b/{report,gates,COMPLETE}.
 * Does NOT flip production defaults or auto-cutover.
 *
 * Run from openclaw_runtime:
 *   node --import tsx scripts/coding-prod-goal-b.mts
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const outDir = path.join(repoRoot, "artifacts", "coding-prod-goal-b");

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

  run("node --import tsx scripts/coding-prod-b1-c6h.mts");
  run("node --import tsx scripts/coding-prod-b2-c7h.mts");

  const b1 = readJson(path.join(repoRoot, "artifacts/coding-prod-b1/acceptance.json"));
  const b2 = readJson(path.join(repoRoot, "artifacts/coding-prod-b2/acceptance.json"));
  const b1Decision = readJson(path.join(repoRoot, "artifacts/coding-prod-b1/decision.json"));
  const b2Pack = readJson(path.join(repoRoot, "artifacts/coding-prod-b2/cutover-pack.json"));

  const defaultsUnchanged =
    isDcsContextViewToolsEnabled({}) === false &&
    resolveWorktreeBackend() === "inprocess" &&
    normalizeIsolationMode(undefined) === "shared" &&
    isCodingSymbolLeaseEnabled() === false &&
    resolveSymbolLeaseMode() === "memory" &&
    isCodingPatchFlowDefault() === false &&
    isCodingRoutingMemoShadowEnabled() === false &&
    isCodingSekbExperienceShadowEnabled() === false &&
    DEFAULT_CODING_FEATURE_FLAGS["runtime.coding.worktree.backend"] === "inprocess" &&
    DEFAULT_CODING_FEATURE_FLAGS["runtime.coding.symbolLease.enabled"] === false &&
    DEFAULT_CODING_FEATURE_FLAGS["runtime.coding.patchFlow.default"] === false &&
    DEFAULT_CODING_FEATURE_FLAGS["runtime.coding.routingMemo.shadow"] === false &&
    DEFAULT_CODING_FEATURE_FLAGS["runtime.coding.sekb.experienceShadow"] === false;

  if (!defaultsUnchanged) {
    throw new Error("defaultsUnchanged red-line failed");
  }

  if (b1.autoAppliedAssemblerFlip !== false) {
    throw new Error("B1 auto assembler flip red-line failed");
  }
  if (b1.readyToConsiderAssemblerFlip !== false) {
    throw new Error("B1 readyToConsider must be false without product review in packaging");
  }
  if (b2.cutoverAllowed !== false) {
    throw new Error("B2 cutoverAllowed red-line failed");
  }

  const B1 = {
    ok: true as const,
    completionClass: String(b1.completionClass ?? "done (hard-gates)"),
    live64k: b1.live64k === true,
    recorded64k: b1.recorded64k === true,
    synthetic64k: b1.synthetic64k === true,
    corpusKind: b1.corpusKind,
    readyToConsiderAssemblerFlip: false as const,
    autoAppliedAssemblerFlip: false as const,
    recommendation: b1.recommendation,
    metricGatesGreen: (b1Decision.metricGates as { allMetricGatesGreen?: boolean })?.allMetricGatesGreen === true,
  };

  const B2 = {
    ok: true as const,
    completionClass: String(b2.completionClass ?? "done (shadow+stable-window)"),
    stableWindowMet: b2.stableWindowMet === true,
    cutoverAllowed: false as const,
    cutoverRecommended: b2.cutoverRecommended === true,
    flagsDefaultOff: true as const,
    manualCutoverPackComplete: Boolean(b2Pack.manualSteps),
  };

  const report = {
    ok: true,
    goal: "B",
    title: "DCS production advancement B1+B2 (C6-H / C7-H)",
    defaultsUnchanged: true,
    cards: { B1, B2 },
    residuals: [
      B1.live64k
        ? null
        : "C6-H live 64K production corpus still residual (recorded/synthetic evidence complete)",
      "Assembler production flip remains out-of-band; readyToConsider requires product review",
      "C7-H production dual-write/cutover requires explicit user approval (cutoverAllowed always false)",
      "C1 live A/B still blocked — view tools stay default-off",
      "C4-P pnpm hardlink worktree install not started",
      "C5-P patch-flow default orchestration remains false (recommend-only)",
    ].filter(Boolean),
    deliverables: {
      b1: "artifacts/coding-prod-b1/",
      b2: "artifacts/coding-prod-b2/",
      corpus: "openclaw_runtime/src/context-engine/coding-c6h-corpus.ts",
      flipDecision: "openclaw_runtime/src/context-engine/coding-c6h-flip-decision.ts",
      cutoverPack: "openclaw_runtime/src/knowledge/sekb/experience-shadow-cutover-pack.ts",
      recordedFixture: "openclaw_runtime/src/context-engine/fixtures/c6h-recorded-64k.json",
    },
    next: "Goal C / Round ACCEPT 2.0: C1 live A/B residual, C4-P hardlink, C5-P patch-flow residual, or ACCEPT refresh",
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
        noAutoAssemblerFlip: true,
        noAutoCutover: true,
        B1: {
          live64k: B1.live64k,
          recorded64k: B1.recorded64k,
          readyToConsiderAssemblerFlip: B1.readyToConsiderAssemblerFlip,
          autoAppliedAssemblerFlip: B1.autoAppliedAssemblerFlip,
          recommendation: B1.recommendation,
          metricGatesGreen: B1.metricGatesGreen,
        },
        B2: {
          stableWindowMet: B2.stableWindowMet,
          cutoverAllowed: B2.cutoverAllowed,
          cutoverRecommended: B2.cutoverRecommended,
          flagsDefaultOff: B2.flagsDefaultOff,
        },
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  const completeMd = [
    "# DCS Goal B COMPLETE",
    "",
    `**SHA**: \`${report.sha}\``,
    `**ts**: ${report.ts}`,
    `**defaultsUnchanged**: true`,
    `**report.ok**: true`,
    "",
    "## Cards",
    "",
    "### B1 — C6-H corpus + assembler flip gates",
    "",
    `- completionClass: \`${B1.completionClass}\``,
    `- corpusKind: \`${B1.corpusKind}\``,
    `- live64k: ${B1.live64k}`,
    `- recorded64k: ${B1.recorded64k}`,
    `- synthetic64k: ${B1.synthetic64k}`,
    `- readyToConsiderAssemblerFlip: ${B1.readyToConsiderAssemblerFlip}`,
    `- autoAppliedAssemblerFlip: ${B1.autoAppliedAssemblerFlip}`,
    `- recommendation: \`${B1.recommendation}\``,
    `- metricGatesGreen: ${B1.metricGatesGreen}`,
    "",
    "### B2 — C7-H stable window + manual cutover pack",
    "",
    `- completionClass: \`${B2.completionClass}\``,
    `- stableWindowMet: ${B2.stableWindowMet}`,
    `- cutoverAllowed: ${B2.cutoverAllowed}`,
    `- cutoverRecommended: ${B2.cutoverRecommended}`,
    `- flagsDefaultOff: ${B2.flagsDefaultOff}`,
    `- manualCutoverPackComplete: ${B2.manualCutoverPackComplete}`,
    "",
    "## Red lines held",
    "",
    "- No assembler production default flip",
    "- No C7 auto cutover (`cutoverAllowed` always false)",
    "- No routingMemo / experienceShadow default-on",
    "- Honest live64k (false unless live corpus supplied)",
    "",
    "## Residuals",
    "",
    ...report.residuals.map((r) => `- ${r}`),
    "",
    "## Next",
    "",
    report.next,
    "",
  ].join("\n");

  writeFileSync(path.join(outDir, "COMPLETE.md"), completeMd, "utf8");
  writeFileSync(
    path.join(repoRoot, "openclaw_runtime", "CODING-PROD-GOAL-B-COMPLETE.md"),
    completeMd,
    "utf8",
  );

  if (!existsSync(path.join(repoRoot, "artifacts/coding-prod-b1/decision.json"))) {
    throw new Error("missing B1 decision");
  }
  if (!existsSync(path.join(repoRoot, "artifacts/coding-prod-b2/cutover-pack.json"))) {
    throw new Error("missing B2 cutover pack");
  }

  console.log(JSON.stringify(report, null, 2));
}

main();
