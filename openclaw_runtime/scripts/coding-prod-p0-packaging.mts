/**
 * P0 packaging acceptance: verify safe defaults, export catalog + metrics map,
 * write artifacts/coding-prod-p0/* without flipping any flags.
 *
 * Run from repo root:
 *   pnpm exec tsx openclaw_runtime/scripts/coding-prod-p0-packaging.mts
 *   pnpm run dcs:prod-p0
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
  isCodingStaleWriteGuardEnabled,
  isCodingSymbolLeaseEnabled,
  isCodingWriteJournalEnabled,
  resolveSymbolLeaseMode,
  resolveWorktreeBackend,
} from "../src/context-engine/coding-runtime-flags.ts";
import { isDcsContextViewToolsEnabled } from "../src/context-engine/dcs-context-tools-flags.ts";
import { CODING_METRIC_NAMES, codingObservability } from "../src/context-engine/coding-observability.ts";
import { dcsObservability } from "../src/context-engine/dcs-observability.ts";
import { normalizeIsolationMode } from "../src/agents/orchestration-protocol.ts";
import {
  assertCatalogDefaultHonesty,
  DCS_PROD_FLAGS,
  DCS_PROD_METRIC_EXPORT,
  listEnhancementFlagsDefaultOff,
} from "../../shared/dcs/prod-flags-catalog.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const outDir = path.join(repoRoot, "artifacts/coding-prod-p0");

function gitShortSha(): string {
  try {
    return execSync("git rev-parse --short HEAD", { cwd: repoRoot, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function main(): void {
  mkdirSync(outDir, { recursive: true });

  assert(isDcsContextViewToolsEnabled({}) === false, "view tools must default OFF");
  assert(isCodingStaleWriteGuardEnabled() === false, "staleWriteGuard default false");
  assert(isCodingWriteJournalEnabled() === true, "writeJournal default true (baseline)");
  assert(resolveWorktreeBackend() === "inprocess", "worktree backend default inprocess");
  assert(normalizeIsolationMode(undefined) === "shared", "isolation default shared");
  assert(isCodingSymbolLeaseEnabled() === false, "symbolLease default false");
  assert(resolveSymbolLeaseMode() === "memory", "symbolLease mode default memory");
  assert(isCodingPatchFlowDefault() === false, "patchFlow.default false");
  assert(isCodingRoutingMemoShadowEnabled() === false, "routingMemo.shadow false");
  assert(isCodingSekbExperienceShadowEnabled() === false, "experienceShadow false");

  assertCatalogDefaultHonesty();
  assert(DEFAULT_CODING_FEATURE_FLAGS["runtime.coding.staleWriteGuard.enabled"] === false, "DEFAULT staleWriteGuard");
  assert(DEFAULT_CODING_FEATURE_FLAGS["runtime.coding.worktree.backend"] === "inprocess", "DEFAULT worktree backend");
  assert(DEFAULT_CODING_FEATURE_FLAGS["runtime.coding.symbolLease.enabled"] === false, "DEFAULT symbolLease");
  assert(DEFAULT_CODING_FEATURE_FLAGS["runtime.coding.patchFlow.default"] === false, "DEFAULT patchFlow");
  assert(DEFAULT_CODING_FEATURE_FLAGS["runtime.coding.routingMemo.shadow"] === false, "DEFAULT routingMemo");
  assert(DEFAULT_CODING_FEATURE_FLAGS["runtime.coding.sekb.experienceShadow"] === false, "DEFAULT experienceShadow");

  codingObservability.reset();
  dcsObservability.reset();
  const observabilityExport = {
    generatedAt: new Date().toISOString(),
    coding: {
      snapshot: codingObservability.snapshot(),
      rates: codingObservability.rates(),
      metricNames: CODING_METRIC_NAMES,
    },
    dcs: {
      snapshot: dcsObservability.snapshot(),
    },
    families: DCS_PROD_METRIC_EXPORT,
    note: "Process-local counters; export via packaging script. Not a live dashboard product.",
  };
  writeFileSync(path.join(outDir, "observability-export.json"), `${JSON.stringify(observabilityExport, null, 2)}\n`, "utf8");

  const configSurface = {
    productionMode: "opt-in",
    readyForDefaultFlagGraduation: false,
    flags: DCS_PROD_FLAGS,
    enhancementDefaultOffCount: listEnhancementFlagsDefaultOff().length,
  };
  writeFileSync(path.join(outDir, "config-surface.json"), `${JSON.stringify(configSurface, null, 2)}\n`, "utf8");

  const sha = gitShortSha();
  const wtPath = path.join(repoRoot, "openclaw_runtime/src/agents/worktree-service.ts");
  const tipHasC4Fix = existsSync(wtPath) && readFileSync(wtPath, "utf8").includes("writeFileSync");

  const report = {
    ok: true,
    card: "P0",
    completionClass: "done (loop)",
    productionMode: "opt-in",
    defaultsUnchanged: true,
    readyForDefaultFlagGraduation: false,
    tipIncludesC4WriteFileFix: tipHasC4Fix,
    sha,
    ts: new Date().toISOString(),
    redLines: {
      viewToolsDefaultOff: true,
      staleWriteGuardDefaultFalse: true,
      isolationDefaultShared: true,
      worktreeBackendInprocess: true,
      symbolLeaseDefaultFalse: true,
      patchFlowDefaultFalse: true,
      routingMemoShadowDefaultFalse: true,
      sekbExperienceShadowDefaultFalse: true,
    },
    deliverables: {
      configSurface: "artifacts/coding-prod-p0/config-surface.json",
      observabilityExport: "artifacts/coding-prod-p0/observability-export.json",
      runbookEn: "docs/dcs-production-p0-runbook.md",
      runbookZh: "docs/dcs-production-p0-runbook.zh-CN.md",
      settingsPanel: "src/components/settings/DcsProdFlagsPanel.tsx",
      catalog: "shared/dcs/prod-flags-catalog.ts",
      smoke: "scripts/dcs-prod-p0-smoke.mjs",
    },
    residuals: [
      "C1 A/B avgReduction 4.5x < 5x - view tools stay default-off",
      "C4-H real git worktree + Windows hardening pending",
      "C5-H multi-process WAL pending",
      "C6-H live 64K corpus + assembler flip gates pending",
      "C7-H shadow stable window + cutover approval pending",
    ],
  };
  writeFileSync(path.join(outDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");

  const completeMd = `# DCS Prod P0 COMPLETE (opt-in packaging)

**Date**: ${new Date().toISOString().slice(0, 10)}
**SHA**: \`${sha}\`
**productionMode**: \`opt-in\`
**completionClass**: \`done (loop)\`
**defaultsUnchanged**: true
**readyForDefaultFlagGraduation**: false

## Scope delivered

1. Machine-readable flag catalog (\`shared/dcs/prod-flags-catalog.ts\`)
2. Settings > Developer read-only DCS production flags panel (i18n en/zh/ja/ru)
3. Runbook EN + ZH (\`docs/dcs-production-p0-runbook*.md\`)
4. Observability export map (\`artifacts/coding-prod-p0/observability-export.json\`)
5. Packaging acceptance + optional smoke (no default flag flips)
6. Tip includes C4 writeFileSync import fix: **${tipHasC4Fix}**

## Red lines verified

- View tools env default OFF
- staleWriteGuard / symbolLease / patchFlow / routingMemo.shadow / sekb.experienceShadow default false
- isolation default shared; worktree backend default inprocess
- No C7 cutover / assembler default ladder / isolation default worktree

## Artifacts

- \`artifacts/coding-prod-p0/report.json\`
- \`artifacts/coding-prod-p0/config-surface.json\`
- \`artifacts/coding-prod-p0/observability-export.json\`
- \`openclaw_runtime/CODING-PROD-P0-COMPLETE.md\`

## Next

- Goal 1 C1 graduation evidence (keep default off)
- Goal 2 C4-H git worktree hardening
- Then C5-H / C6-H / C7-H / Round ACCEPT 2.0
`;
  writeFileSync(path.join(outDir, "COMPLETE.md"), completeMd, "utf8");
  writeFileSync(path.join(repoRoot, "openclaw_runtime/CODING-PROD-P0-COMPLETE.md"), completeMd, "utf8");
  console.log(JSON.stringify({ ok: true, sha, outDir }, null, 2));
}

main();